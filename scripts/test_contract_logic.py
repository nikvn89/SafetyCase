from __future__ import annotations

import json
from pathlib import Path

from harness import (
    OWNER, REVIEWER, OUTSIDER, ZERO,
    create_basic_system, digest, expect_user_error,
    load_contract, new_contract, patch_classifier, set_sender,
)


def main():
    mod, gl = load_contract()
    checks = []

    def check(name, fn):
        fn()
        checks.append(name)
        print(f"PASS  {name}")

    def fresh():
        m, g = load_contract()
        c = new_contract(m, g)
        return m, g, c

    def t_config():
        m, g, c = fresh()
        cfg = c.get_config()
        assert cfg["version"] == "2.0"
        assert cfg["reviewer_required"] is True
        assert cfg["challenge_enabled"] is True
        assert cfg["max_attempts_per_hazard"] == 5
        assert cfg["max_lifetime_attempts_per_hazard"] == 15
        assert cfg["same_evidence_reroll_blocked"] is True
        assert "PENDING_COUNTERSIGNATURE" in cfg["hazard_statuses"]
    check("v2 config exposes reviewer, pending, retry cap, challenge, evidence binding", t_config)

    def t_create_roles():
        m, g, c = fresh()
        create_basic_system(c, g)
        s = c.get_system(1)
        assert s["owner"].lower() == OWNER.lower()
        assert s["reviewer"].lower() == REVIEWER.lower()
        assert s["covered_count"] == 0
        assert s["release_ready"] is False
    check("create_system stores authenticated distinct reviewer", t_create_roles)

    def t_same_reviewer_reject():
        m, g, c = fresh()
        set_sender(g, OWNER)
        expect_user_error(lambda: c.create_system("x", json.dumps(["h1", "h2"]), OWNER), "different wallet")
        assert int(c.system_counter) == 0
    check("owner cannot appoint self as reviewer", t_same_reviewer_reject)

    def t_zero_reviewer_reject():
        m, g, c = fresh()
        expect_user_error(lambda: c.create_system("x", json.dumps(["h1", "h2"]), ZERO), "zero address")
        assert int(c.system_counter) == 0
    check("zero reviewer is rejected", t_zero_reviewer_reject)

    def t_near_duplicate_hazard():
        m, g, c = fresh()
        expect_user_error(
            lambda: c.create_system("x", json.dumps(["Guard Door Open.", "  guard   door open  "]), REVIEWER),
            "Duplicate hazard",
        )
    check("near-duplicate hazards normalize before dedupe", t_near_duplicate_hazard)

    def t_gap_attempt():
        m, g, c = fresh(); create_basic_system(c, g)
        calls = patch_classifier(c, [m.SAFETY_GAP])
        c.submit_mitigation(1, 1, "Log every restart after it happens.", digest(1))
        h = c.get_hazard(1, 1); s = c.get_system(1)
        assert h["status"] == m.HAZARD_OPEN
        assert h["attempt_count"] == 1
        assert h["lifetime_attempt_count"] == 1
        assert s["gap_attempts"] == 1
        assert s["covered_count"] == 0
        assert calls["count"] == 1
    check("SAFETY_GAP stays OPEN and increments only completed attempt", t_gap_attempt)

    def t_exact_replay_no_model():
        m, g, c = fresh(); create_basic_system(c, g)
        calls = patch_classifier(c, [m.SAFETY_GAP])
        text = "Log every restart after it happens."
        c.submit_mitigation(1, 1, text, digest(1))
        expect_user_error(lambda: c.submit_mitigation(1, 1, text, digest(2)), "exact mitigation")
        assert calls["count"] == 1
        assert c.get_hazard(1, 1)["attempt_count"] == 1
    check("exact mitigation replay is refused before a second semantic call", t_exact_replay_no_model)

    def t_same_evidence_no_reroll():
        m, g, c = fresh(); create_basic_system(c, g)
        calls = patch_classifier(c, [m.SAFETY_GAP])
        c.submit_mitigation(1, 1, "Log every restart after it happens.", digest(7))
        expect_user_error(
            lambda: c.submit_mitigation(1, 1, "A differently worded logging proposal.", digest(7)),
            "evidence was already adjudicated",
        )
        assert calls["count"] == 1
        assert c.get_hazard(1, 1)["attempt_count"] == 1
    check("same evidence digest cannot buy a paraphrased semantic reroll", t_same_evidence_no_reroll)

    def t_sufficient_is_pending():
        m, g, c = fresh(); create_basic_system(c, g)
        patch_classifier(c, [m.MITIGATION_SUFFICIENT])
        c.submit_mitigation(1, 1, "Hardwired interlock removes motor power while guard is open.", digest(10))
        h = c.get_hazard(1, 1); s = c.get_system(1)
        assert h["status"] == m.HAZARD_PENDING
        assert h["pending_mitigation_id"] == 1
        assert h["covered_by"] == 0
        assert s["covered_count"] == 0
        assert s["pending_count"] == 1
        assert s["open_count"] == 1
    check("SUFFICIENT creates PENDING_COUNTERSIGNATURE, not COVERED", t_sufficient_is_pending)

    def t_pending_blocks_grind():
        m, g, c = fresh(); create_basic_system(c, g)
        calls = patch_classifier(c, [m.MITIGATION_SUFFICIENT])
        c.submit_mitigation(1, 1, "Hardwired interlock removes motor power while guard is open.", digest(10))
        expect_user_error(lambda: c.submit_mitigation(1, 1, "Another wording", digest(11)), "awaiting countersignature")
        assert calls["count"] == 1
    check("pending candidate blocks further owner grinding", t_pending_blocks_grind)

    def t_countersign_roles():
        m, g, c = fresh(); create_basic_system(c, g)
        patch_classifier(c, [m.MITIGATION_SUFFICIENT])
        c.submit_mitigation(1, 1, "Hardwired interlock removes motor power while guard is open.", digest(10))
        set_sender(g, OWNER)
        expect_user_error(lambda: c.countersign_mitigation(1, 1), "Only the reviewer")
        set_sender(g, OUTSIDER)
        expect_user_error(lambda: c.countersign_mitigation(1, 1), "Only the reviewer")
        set_sender(g, REVIEWER)
        c.countersign_mitigation(1, 1)
        h = c.get_hazard(1, 1); s = c.get_system(1)
        assert h["status"] == m.HAZARD_COVERED
        assert h["covered_by"] == 1
        assert h["pending_mitigation_id"] == 0
        assert s["covered_count"] == 1
    check("only reviewer countersigns and COVERED changes deterministically", t_countersign_roles)

    def t_early_release_reject():
        m, g, c = fresh(); create_basic_system(c, g)
        expect_user_error(lambda: c.mark_release_ready(1), "All declared hazards")
        assert c.get_system(1)["release_ready"] is False
    check("release gate refuses incomplete coverage", t_early_release_reject)

    def t_release_and_attribution():
        m, g, c = fresh(); create_basic_system(c, g)
        patch_classifier(c, [m.MITIGATION_SUFFICIENT, m.MITIGATION_SUFFICIENT])
        for idx, text, ev in [
            (1, "Hardwired interlock removes motor power while guard is open.", digest(20)),
            (2, "Dispatch gate diverts every out-of-tolerance pallet to quarantine.", digest(21)),
        ]:
            set_sender(g, OWNER); c.submit_mitigation(1, idx, text, ev)
            set_sender(g, REVIEWER); c.countersign_mitigation(1, idx)
        set_sender(g, OUTSIDER)
        c.mark_release_ready(1)
        s = c.get_system(1)
        assert s["release_ready"] is True
        assert s["released_by"].lower() == OUTSIDER.lower()
        expect_user_error(lambda: c.mark_release_ready(1), "already release-ready")
    check("permissionless release is deterministic and records released_by", t_release_and_attribution)

    def t_challenge_covered_reopens():
        m, g, c = fresh(); create_basic_system(c, g)
        patch_classifier(c, [m.MITIGATION_SUFFICIENT, m.MITIGATION_SUFFICIENT])
        for idx, text, ev in [
            (1, "Hardwired interlock removes motor power while guard is open.", digest(30)),
            (2, "Dispatch gate diverts every out-of-tolerance pallet to quarantine.", digest(31)),
        ]:
            set_sender(g, OWNER); c.submit_mitigation(1, idx, text, ev)
            set_sender(g, REVIEWER); c.countersign_mitigation(1, idx)
        set_sender(g, OUTSIDER); c.mark_release_ready(1)
        set_sender(g, OWNER)
        expect_user_error(lambda: c.challenge_coverage(1, 1, "owner tries"), "Only the reviewer")
        set_sender(g, REVIEWER)
        c.challenge_coverage(1, 1, "Evidence artifact no longer validates the asserted control implementation.")
        s = c.get_system(1); h = c.get_hazard(1, 1)
        assert s["covered_count"] == 1
        assert s["release_ready"] is False
        assert s["challenge_count"] == 1
        assert h["status"] == m.HAZARD_OPEN
        assert h["covered_by"] == 0
        assert h["pending_mitigation_id"] == 0
        ch = c.get_challenge(1)
        assert ch["previous_status"] == m.HAZARD_COVERED
        assert ch["mitigation_id"] == 1
        assert ch["challenged_by"].lower() == REVIEWER.lower()
    check("reviewer challenge revokes coverage and closes an open release gate", t_challenge_covered_reopens)

    def t_challenge_pending():
        m, g, c = fresh(); create_basic_system(c, g)
        patch_classifier(c, [m.MITIGATION_SUFFICIENT])
        c.submit_mitigation(1, 1, "Hardwired interlock removes motor power while guard is open.", digest(40))
        set_sender(g, REVIEWER)
        c.challenge_coverage(1, 1, "Submitted evidence digest does not match the reviewed artifact.")
        h = c.get_hazard(1, 1); s = c.get_system(1)
        assert h["status"] == m.HAZARD_OPEN
        assert h["attempt_count"] == 0
        assert h["lifetime_attempt_count"] == 1
        assert s["covered_count"] == 0
        assert c.get_challenge(1)["previous_status"] == m.HAZARD_PENDING
    check("reviewer may reject a pending sufficient candidate onchain", t_challenge_pending)

    def t_recovery_cycle():
        m, g, c = fresh(); create_basic_system(c, g)
        patch_classifier(c, [m.MITIGATION_SUFFICIENT, m.MITIGATION_SUFFICIENT])
        c.submit_mitigation(1, 1, "Hardwired interlock removes motor power while guard is open.", digest(50))
        set_sender(g, REVIEWER); c.countersign_mitigation(1, 1)
        c.challenge_coverage(1, 1, "First evidence package was revoked.")
        set_sender(g, OWNER)
        c.submit_mitigation(1, 1, "A dual-channel guard interlock removes motor enable before any restart.", digest(51))
        set_sender(g, REVIEWER); c.countersign_mitigation(1, 1)
        h = c.get_hazard(1, 1); s = c.get_system(1)
        assert h["status"] == m.HAZARD_COVERED
        assert h["attempt_count"] == 1
        assert h["lifetime_attempt_count"] == 2
        assert s["challenge_count"] == 1
        assert s["covered_count"] == 1
    check("COVERED -> challenge -> OPEN -> new evidence -> PENDING -> COVERED", t_recovery_cycle)

    def t_budget_reset_after_fifth_attempt_challenge():
        m, g, c = fresh(); create_basic_system(c, g)
        calls = patch_classifier(c, [m.SAFETY_GAP] * 4 + [m.MITIGATION_SUFFICIENT, m.MITIGATION_SUFFICIENT])
        for i in range(4):
            c.submit_mitigation(1, 1, f"weak measure {i}", digest(500+i))
        c.submit_mitigation(1, 1, "Hardwired guard interlock v1", digest(510))
        set_sender(g, REVIEWER); c.countersign_mitigation(1, 1)
        c.challenge_coverage(1, 1, "The reviewed artifact was withdrawn.")
        h = c.get_hazard(1, 1)
        assert h["status"] == m.HAZARD_OPEN
        assert h["attempt_count"] == 0
        assert h["lifetime_attempt_count"] == 5
        set_sender(g, OWNER)
        c.submit_mitigation(1, 1, "Dual-channel guard interlock v2", digest(511))
        set_sender(g, REVIEWER); c.countersign_mitigation(1, 1)
        h = c.get_hazard(1, 1)
        assert h["status"] == m.HAZARD_COVERED
        assert h["attempt_count"] == 1
        assert h["lifetime_attempt_count"] == 6
        assert calls["count"] == 6
    check("challenge after fifth attempt restores a fresh per-cycle budget", t_budget_reset_after_fifth_attempt_challenge)

    def t_lifetime_ceiling_across_challenge_cycles():
        m, g, c = fresh(); create_basic_system(c, g)
        calls = patch_classifier(c, [m.MITIGATION_SUFFICIENT] * 15)
        for i in range(15):
            set_sender(g, OWNER)
            c.submit_mitigation(1, 1, f"candidate cycle {i}", digest(600+i))
            set_sender(g, REVIEWER)
            c.challenge_coverage(1, 1, f"review rejected candidate {i}")
            h = c.get_hazard(1, 1)
            assert h["status"] == m.HAZARD_OPEN
            assert h["attempt_count"] == 0
            assert h["lifetime_attempt_count"] == i + 1
        set_sender(g, OWNER)
        expect_user_error(
            lambda: c.submit_mitigation(1, 1, "candidate beyond lifetime ceiling", digest(699)),
            "Lifetime attempt ceiling",
        )
        h = c.get_hazard(1, 1)
        assert h["lifetime_attempt_count"] == 15
        assert h["attempt_count"] == 0
        assert calls["count"] == 15
    check("challenge resets remain bounded by a 15-attempt lifetime ceiling", t_lifetime_ceiling_across_challenge_cycles)

    def t_challenge_preserves_old_text_and_evidence_locks():
        m, g, c = fresh(); create_basic_system(c, g)
        calls = patch_classifier(c, [m.MITIGATION_SUFFICIENT, m.MITIGATION_SUFFICIENT])
        text = "Hardwired interlock artifact A"
        ev = digest(710)
        c.submit_mitigation(1, 1, text, ev)
        set_sender(g, REVIEWER); c.challenge_coverage(1, 1, "Artifact A failed review.")
        set_sender(g, OWNER)
        expect_user_error(lambda: c.submit_mitigation(1, 1, text, digest(711)), "exact mitigation")
        expect_user_error(lambda: c.submit_mitigation(1, 1, "Different words", ev), "evidence was already adjudicated")
        c.submit_mitigation(1, 1, "Hardwired interlock artifact B", digest(712))
        assert calls["count"] == 2
    check("challenge restores budget without freeing prior text/evidence reroll locks", t_challenge_preserves_old_text_and_evidence_locks)

    def t_hazard_history_survives_cycle_reset():
        m, g, c = fresh(); create_basic_system(c, g)
        patch_classifier(c, [m.MITIGATION_SUFFICIENT, m.SAFETY_GAP])
        first_ev = digest(715)
        second_ev = digest(716)
        c.submit_mitigation(1, 1, "interlock candidate A", first_ev)
        set_sender(g, REVIEWER); c.challenge_coverage(1, 1, "candidate A rejected")
        set_sender(g, OWNER); c.submit_mitigation(1, 1, "logging fallback B", second_ev)
        h = c.get_hazard(1, 1)
        assert h["attempt_count"] == 1
        assert h["lifetime_attempt_count"] == 2
        rows = c.get_hazard_attempts(1, 1, 1, 10)
        assert len(rows) == 2
        assert rows[0]["evidence_digest"] == first_ev
        assert rows[1]["evidence_digest"] == second_ev
        assert rows[0]["mitigation_id"] != rows[1]["mitigation_id"]
    check("hazard attempt history remains append-only across challenge budget resets", t_hazard_history_survives_cycle_reset)

    def t_covered_count_recounts_after_every_write():
        m, g, c = fresh(); create_basic_system(c, g)
        patch_classifier(c, [m.MITIGATION_SUFFICIENT] * 4)
        def recount():
            hazards = c.get_hazards(1, 1, 10)
            actual = sum(1 for h in hazards if h["status"] == m.HAZARD_COVERED)
            assert c.get_system(1)["covered_count"] == actual
        recount()
        set_sender(g, OWNER); c.submit_mitigation(1, 1, "control h1 v1", digest(720)); recount()
        set_sender(g, REVIEWER); c.countersign_mitigation(1, 1); recount()
        c.challenge_coverage(1, 1, "control h1 v1 revoked"); recount()
        set_sender(g, OWNER); c.submit_mitigation(1, 1, "control h1 v2", digest(721)); recount()
        set_sender(g, REVIEWER); c.countersign_mitigation(1, 1); recount()
        set_sender(g, OWNER); c.submit_mitigation(1, 2, "control h2", digest(722)); recount()
        set_sender(g, REVIEWER); c.countersign_mitigation(1, 2); recount()
        set_sender(g, OUTSIDER); c.mark_release_ready(1); recount()
        set_sender(g, REVIEWER); c.challenge_coverage(1, 2, "control h2 revoked"); recount()
        assert c.get_system(1)["release_ready"] is False
    check("covered_count equals a hazard-status recount throughout the state machine", t_covered_count_recounts_after_every_write)

    def t_all_gap_cycle_reviewer_reopen():
        m, g, c = fresh(); create_basic_system(c, g)
        calls = patch_classifier(c, [m.SAFETY_GAP] * 5 + [m.MITIGATION_SUFFICIENT])
        for i in range(5):
            set_sender(g, OWNER)
            c.submit_mitigation(1, 1, f"weak all-gap {i}", digest(800+i))
        h = c.get_hazard(1, 1)
        assert h["status"] == m.HAZARD_OPEN
        assert h["attempt_count"] == 5 and h["lifetime_attempt_count"] == 5
        set_sender(g, OWNER)
        expect_user_error(lambda: c.reopen_attempts(1, 1), "Only the reviewer")
        set_sender(g, REVIEWER)
        c.reopen_attempts(1, 1)
        h = c.get_hazard(1, 1)
        assert h["status"] == m.HAZARD_OPEN
        assert h["attempt_count"] == 0 and h["lifetime_attempt_count"] == 5
        set_sender(g, OWNER)
        c.submit_mitigation(1, 1, "hardwired interlock after reopen", digest(806))
        assert c.get_hazard(1, 1)["status"] == m.HAZARD_PENDING
        set_sender(g, REVIEWER)
        c.countersign_mitigation(1, 1)
        assert c.get_hazard(1, 1)["status"] == m.HAZARD_COVERED
        assert calls["count"] == 6
    check("all-GAP exhausted OPEN cycle can be reviewer-reopened and recovered", t_all_gap_cycle_reviewer_reopen)

    def t_budget_before_model():
        m, g, c = fresh(); create_basic_system(c, g)
        calls = patch_classifier(c, [m.SAFETY_GAP] * 5)
        for i in range(5):
            c.submit_mitigation(1, 1, f"Weak mitigation variant {i}", digest(100+i))
        assert c.get_hazard(1, 1)["attempt_count"] == 5
        expect_user_error(lambda: c.submit_mitigation(1, 1, "Sixth distinct mitigation", digest(200)), "budget")
        assert calls["count"] == 5
        assert c.get_hazard(1, 1)["attempt_count"] == 5
    check("sixth distinct attempt is refused before semantic consensus", t_budget_before_model)

    def t_malformed_reverts_before_write():
        m, g, c = fresh(); create_basic_system(c, g)
        calls = {"count": 0}
        def bad(_h, _m):
            calls["count"] += 1
            raise g.vm.UserError("Invalid consensus verdict")
        c._classify_mitigation = bad
        expect_user_error(lambda: c.submit_mitigation(1, 1, "Candidate", digest(300)), "Invalid consensus")
        h = c.get_hazard(1, 1); s = c.get_system(1)
        assert h["attempt_count"] == 0
        assert s["mitigation_count"] == 0
        assert int(c.mitigation_counter) == 0
        assert calls["count"] == 1
    check("semantic failure writes no attempt/history/counter state", t_malformed_reverts_before_write)

    def t_bool_ids():
        m, g, c = fresh(); create_basic_system(c, g)
        expect_user_error(lambda: c.get_system(True), "Invalid system id")
        expect_user_error(lambda: c.get_hazard(1, True), "Invalid hazard index")
    check("bool ids cannot pass as integer ids", t_bool_ids)

    def t_evidence_visible_in_history():
        m, g, c = fresh(); create_basic_system(c, g)
        patch_classifier(c, [m.SAFETY_GAP])
        ev = digest(400)
        c.submit_mitigation(1, 1, "Log-only mitigation", ev)
        assert c.get_mitigation(1)["evidence_digest"] == ev
        assert c.get_system_mitigations(1, 1, 10)[0]["evidence_digest"] == ev
        assert c.get_hazard_attempts(1, 1, 1, 10)[0]["evidence_digest"] == ev
    check("evidence digest is preserved in all mitigation history views", t_evidence_visible_in_history)

    print(f"\nCORE: {len(checks)}/{len(checks)} PASS")


if __name__ == "__main__":
    main()
