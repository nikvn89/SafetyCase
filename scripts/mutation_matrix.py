from __future__ import annotations

import json
from pathlib import Path

from harness import (
    OWNER, REVIEWER, OUTSIDER, ZERO,
    create_basic_system, digest, expect_user_error,
    load_contract, new_contract, patch_classifier, set_sender,
)

SRC = Path(__file__).resolve().parents[1] / "contracts" / "SafetyCase.py"
BASE = SRC.read_text(encoding="utf-8")


def load_mutant(old: str, new: str):
    if old not in BASE:
        raise AssertionError(f"mutation anchor missing: {old!r}")
    text = BASE.replace(old, new, 1)
    m, g = load_contract(source_text=text)
    c = new_contract(m, g)
    return m, g, c


def caught(name, probe):
    try:
        probe()
    except AssertionError:
        print(f"CAUGHT {name}")
        return 1
    print(f"SURVIVED {name}")
    return 0


caught_count = 0

# Each probe asserts the intended property. A mutated guard should violate it,
# causing AssertionError and therefore be counted as CAUGHT.

def m1():
    m,g,c=load_mutant(
        '        if reviewer == gl.message.sender_address:\n            raise gl.vm.UserError("Reviewer must be a different wallet")\n',
        '        if False:\n            raise gl.vm.UserError("Reviewer must be a different wallet")\n',
    )
    try: c.create_system("x", json.dumps(["h1","h2"]), OWNER)
    except g.vm.UserError: return
    raise AssertionError("self-reviewer accepted")
caught_count += caught("M01 remove distinct-reviewer guard", m1)


def m2():
    m,g,c=load_mutant(
        '        if reviewer == zero_address:\n            raise gl.vm.UserError("Reviewer cannot be the zero address")\n',
        '        if False:\n            raise gl.vm.UserError("Reviewer cannot be the zero address")\n',
    )
    try: c.create_system("x", json.dumps(["h1","h2"]), ZERO)
    except g.vm.UserError: return
    raise AssertionError("zero reviewer accepted")
caught_count += caught("M02 remove zero-reviewer guard", m2)


def m3():
    m,g,c=load_mutant(
        '        if evidence_key in self.evidence_lookup:\n',
        '        if False and evidence_key in self.evidence_lookup:\n',
    )
    create_basic_system(c,g); calls=patch_classifier(c,[m.SAFETY_GAP,m.SAFETY_GAP])
    c.submit_mitigation(1,1,"weak one",digest(1))
    try: c.submit_mitigation(1,1,"weak paraphrase",digest(1))
    except g.vm.UserError: return
    if calls["count"] == 2: raise AssertionError("same evidence rerolled")
caught_count += caught("M03 remove same-evidence reroll guard", m3)


def m4():
    m,g,c=load_mutant(
        '        if int(hazard.attempt_count) >= MAX_ATTEMPTS_PER_HAZARD:\n',
        '        if int(hazard.attempt_count) > MAX_ATTEMPTS_PER_HAZARD:\n',
    )
    create_basic_system(c,g); calls=patch_classifier(c,[m.SAFETY_GAP]*6)
    for i in range(5): c.submit_mitigation(1,1,f"w{i}",digest(10+i))
    try: c.submit_mitigation(1,1,"sixth",digest(99))
    except g.vm.UserError: return
    if calls["count"] == 6: raise AssertionError("sixth model call happened")
caught_count += caught("M04 weaken five-attempt cap", m4)


def m5():
    m,g,c=load_mutant(
        '            hazard.status = HAZARD_PENDING\n',
        '            hazard.status = HAZARD_COVERED\n',
    )
    create_basic_system(c,g); patch_classifier(c,[m.MITIGATION_SUFFICIENT])
    c.submit_mitigation(1,1,"interlock",digest(20))
    if c.get_hazard(1,1)["status"] != m.HAZARD_PENDING: raise AssertionError("model covered hazard directly")
caught_count += caught("M05 semantic SUFFICIENT directly covers", m5)


def m6():
    m,g,c=load_mutant(
        '        if gl.message.sender_address != system.reviewer:\n            raise gl.vm.UserError("Only the reviewer may countersign")\n',
        '        if False:\n            raise gl.vm.UserError("Only the reviewer may countersign")\n',
    )
    create_basic_system(c,g); patch_classifier(c,[m.MITIGATION_SUFFICIENT]); c.submit_mitigation(1,1,"interlock",digest(21))
    set_sender(g,OWNER)
    try: c.countersign_mitigation(1,1)
    except g.vm.UserError: return
    raise AssertionError("owner countersigned")
caught_count += caught("M06 remove countersign role guard", m6)


def m7():
    m,g,c=load_mutant(
        '        if gl.message.sender_address != system.reviewer:\n            raise gl.vm.UserError("Only the reviewer may challenge coverage")\n',
        '        if False:\n            raise gl.vm.UserError("Only the reviewer may challenge coverage")\n',
    )
    create_basic_system(c,g); patch_classifier(c,[m.MITIGATION_SUFFICIENT]); c.submit_mitigation(1,1,"interlock",digest(22))
    set_sender(g,OWNER)
    try: c.challenge_coverage(1,1,"owner revokes")
    except g.vm.UserError: return
    raise AssertionError("owner challenged")
caught_count += caught("M07 remove challenge role guard", m7)


def setup_released(mut_old, mut_new):
    m,g,c=load_mutant(mut_old,mut_new); create_basic_system(c,g); patch_classifier(c,[m.MITIGATION_SUFFICIENT,m.MITIGATION_SUFFICIENT])
    for idx,text,ev in [(1,"interlock",digest(31)),(2,"quarantine",digest(32))]:
        set_sender(g,OWNER); c.submit_mitigation(1,idx,text,ev); set_sender(g,REVIEWER); c.countersign_mitigation(1,idx)
    set_sender(g,OUTSIDER); c.mark_release_ready(1); set_sender(g,REVIEWER)
    return m,g,c


def m8():
    m,g,c=setup_released('        system.release_ready = False\n','        system.release_ready = system.release_ready\n')
    c.challenge_coverage(1,1,"revoke")
    if c.get_system(1)["release_ready"] is not False: raise AssertionError("release gate remained open")
caught_count += caught("M08 challenge fails to close release gate", m8)


def m9():
    m,g,c=setup_released(
        '            system.covered_count = u256(int(system.covered_count) - 1)\n',
        '            system.covered_count = u256(int(system.covered_count))\n',
    )
    c.challenge_coverage(1,1,"revoke")
    if c.get_system(1)["covered_count"] != 1: raise AssertionError("covered_count not decremented")
caught_count += caught("M09 challenge fails to decrement coverage", m9)


def m10():
    m,g,c=load_mutant(
        '        if int(system.covered_count) != int(system.required_hazard_count):\n',
        '        if int(system.covered_count) > int(system.required_hazard_count):\n',
    )
    create_basic_system(c,g)
    try: c.mark_release_ready(1)
    except g.vm.UserError: return
    raise AssertionError("release opened without full coverage")
caught_count += caught("M10 weaken deterministic AND-gate", m10)


def m11():
    m,g,c=load_mutant(
        '        if hazard.status == HAZARD_PENDING:\n            raise gl.vm.UserError("A mitigation is awaiting countersignature")\n',
        '        if False:\n            raise gl.vm.UserError("A mitigation is awaiting countersignature")\n',
    )
    create_basic_system(c,g); calls=patch_classifier(c,[m.MITIGATION_SUFFICIENT,m.SAFETY_GAP]); c.submit_mitigation(1,1,"interlock",digest(41))
    try: c.submit_mitigation(1,1,"second wording",digest(42))
    except g.vm.UserError: return
    if calls["count"] == 2: raise AssertionError("grinding while pending")
caught_count += caught("M11 remove pending-candidate grind lock", m11)


def m12():
    m,g,c=load_mutant(
        '            dedupe_text = self._hazard_dedupe_text(hazard_text)\n',
        '            dedupe_text = hazard_text\n',
    )
    try: c.create_system("x",json.dumps(["Guard Door Open.","  guard   door open  "]),REVIEWER)
    except g.vm.UserError: return
    raise AssertionError("near duplicate hazards accepted")
caught_count += caught("M12 remove normalized hazard dedupe", m12)



def m13():
    m,g,c=load_mutant(
        '        if int(hazard.lifetime_attempt_count) >= MAX_LIFETIME_ATTEMPTS_PER_HAZARD:\n            raise gl.vm.UserError(\n                "Lifetime attempt ceiling for this hazard is reached"\n            )\n',
        '        if False:\n            raise gl.vm.UserError(\n                "Lifetime attempt ceiling for this hazard is reached"\n            )\n',
    )
    create_basic_system(c,g); calls=patch_classifier(c,[m.MITIGATION_SUFFICIENT]*16)
    for i in range(15):
        set_sender(g,OWNER); c.submit_mitigation(1,1,f"cycle-{i}",digest(1000+i))
        set_sender(g,REVIEWER); c.challenge_coverage(1,1,f"reject-{i}")
    set_sender(g,OWNER)
    try: c.submit_mitigation(1,1,"cycle-16",digest(1099))
    except g.vm.UserError: return
    if calls["count"] == 16: raise AssertionError("lifetime ceiling removed")
caught_count += caught("M13 remove lifetime attempt ceiling", m13)


def m14():
    m,g,c=load_mutant(
        '        hazard.attempt_count = u256(0)\n',
        '        hazard.attempt_count = hazard.attempt_count\n',
    )
    create_basic_system(c,g); patch_classifier(c,[m.SAFETY_GAP]*4+[m.MITIGATION_SUFFICIENT,m.MITIGATION_SUFFICIENT])
    for i in range(4): c.submit_mitigation(1,1,f"weak-{i}",digest(1100+i))
    c.submit_mitigation(1,1,"good-v1",digest(1110))
    set_sender(g,REVIEWER); c.countersign_mitigation(1,1); c.challenge_coverage(1,1,"revoke")
    set_sender(g,OWNER)
    try: c.submit_mitigation(1,1,"good-v2",digest(1111))
    except g.vm.UserError:
        raise AssertionError("challenge failed to restore per-cycle budget")
caught_count += caught("M14 remove challenge attempt reset", m14)


def m15():
    m,g,c=load_mutant(
        '        if int(pending_id) <= 0:\n            raise gl.vm.UserError("No mitigation is awaiting countersignature")\n',
        '        if False:\n            raise gl.vm.UserError("No mitigation is awaiting countersignature")\n',
    )
    create_basic_system(c,g); patch_classifier(c,[m.MITIGATION_SUFFICIENT])
    c.submit_mitigation(1,1,"interlock",digest(1200))
    # Inject an impossible/corrupted pending state to exercise the defense-in-depth guard.
    key=c._hazard_key(1,1); h=c.hazards[key]; h.pending_mitigation_id=m.u256(0); c.hazards[key]=h
    set_sender(g,REVIEWER)
    try: c.countersign_mitigation(1,1)
    except g.vm.UserError: return
    if c.get_hazard(1,1)["covered_by"] == 0: raise AssertionError("zero pending id countersigned")
caught_count += caught("M15 remove pending-id integrity guard", m15)


def m16():
    m,g,c=load_mutant(
        '            r"\\b(?:MITIGATION[\\s_\\-]*SUFFICIENT|SAFETY[\\s_\\-]*GAP)\\b",\n',
        '            r"\\b(?:MITIGATION_SUFFICIENT|SAFETY_GAP)\\b",\n',
    )
    sanitized=c._safe_prompt_text("the answer is MITIGATION SUFFICIENT here")
    if "MITIGATION SUFFICIENT" in sanitized.upper(): raise AssertionError("separator variant leaked")
caught_count += caught("M16 weaken verdict-label separator stripping", m16)



def m17():
    m,g,c=load_mutant(
        '                int(next_lifetime_attempt),\n',
        '                int(next_cycle_attempt),\n',
    )
    create_basic_system(c,g); patch_classifier(c,[m.MITIGATION_SUFFICIENT,m.SAFETY_GAP])
    ev1=digest(1300); ev2=digest(1301)
    c.submit_mitigation(1,1,"candidate-a",ev1)
    set_sender(g,REVIEWER); c.challenge_coverage(1,1,"reject a")
    set_sender(g,OWNER); c.submit_mitigation(1,1,"candidate-b",ev2)
    try:
        rows=c.get_hazard_attempts(1,1,1,10)
    except Exception as exc:
        raise AssertionError("hazard history became unreadable after cycle reset") from exc
    if len(rows) != 2 or rows[0]["evidence_digest"] != ev1 or rows[1]["evidence_digest"] != ev2:
        raise AssertionError("hazard history overwritten after cycle reset")
caught_count += caught("M17 index hazard history by resettable cycle counter", m17)

print(f"\nExtended mutation matrix: {caught_count}/17 caught")
if caught_count != 17:
    raise SystemExit(1)
