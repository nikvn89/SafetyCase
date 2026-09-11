"""
Independent probes of the NEW R2 surface (reopen_attempts) and of the
invariants R2 claims about it. Written fresh, not derived from the pack.
"""
import json
import pytest
from conftest import SUFFICIENT, GAP, HAZ_A, HAZ_B, dig


def _exhaust(sc, direct_vm, hazard=1, tag="x"):
    direct_vm.clear_mocks()
    direct_vm.mock_llm(r".*", GAP)
    for i in range(5):
        sc.submit_mitigation(1, hazard, f"{tag} weak {i}", dig(f"{tag}{hazard}{i}"))


# ---------------------------------------------------------------
# R2-1 — reopen_attempts must touch NOTHING except the cycle counter
# ---------------------------------------------------------------

def test_R2_1_reopen_is_surgical(sys1, direct_vm, reviewer):
    """Snapshot the whole observable state, reopen, diff it."""
    direct_vm.mock_llm(r".*", SUFFICIENT)
    sys1.submit_mitigation(1, 2, "h2 good", dig("h2good"))
    with direct_vm.prank(reviewer):
        sys1.countersign_mitigation(1, 2)
    _exhaust(sys1, direct_vm, hazard=1, tag="a")

    before_sys = sys1.get_system(1)
    before_h1 = sys1.get_hazard(1, 1)
    before_h2 = sys1.get_hazard(1, 2)
    before_hist = sys1.get_hazard_attempts(1, 1, 1, 50)
    before_sysmit = sys1.get_system_mitigations(1, 1, 50)

    with direct_vm.prank(reviewer):
        sys1.reopen_attempts(1, 1)

    after_sys = sys1.get_system(1)
    after_h1 = sys1.get_hazard(1, 1)
    after_h2 = sys1.get_hazard(1, 2)
    after_hist = sys1.get_hazard_attempts(1, 1, 1, 50)
    after_sysmit = sys1.get_system_mitigations(1, 1, 50)

    sys_delta = {k: (before_sys[k], after_sys[k])
                 for k in before_sys if before_sys[k] != after_sys[k]}
    h1_delta = {k: (before_h1[k], after_h1[k])
                for k in before_h1 if before_h1[k] != after_h1[k]}
    print(f"\n  system delta : {sys_delta}")
    print(f"  hazard1 delta: {h1_delta}")
    assert sys_delta == {}, "reopen_attempts mutated system-level state"
    assert h1_delta == {"attempt_count": (5, 0)}, "reopen changed more than the cycle counter"
    assert before_h2 == after_h2, "reopen touched another hazard"
    assert before_hist == after_hist, "reopen altered attempt history"
    assert before_sysmit == after_sysmit, "reopen altered system mitigation index"


def test_R2_1b_reopen_does_not_reopen_release_ready(sys1, direct_vm, reviewer):
    """A fully covered, released system has no OPEN hazard to reopen."""
    direct_vm.mock_llm(r".*", SUFFICIENT)
    for i in (1, 2):
        sys1.submit_mitigation(1, i, f"m{i}", dig(f"r{i}"))
        with direct_vm.prank(reviewer):
            sys1.countersign_mitigation(1, i)
    sys1.mark_release_ready(1)
    for hz in (1, 2):
        with direct_vm.prank(reviewer):
            with direct_vm.expect_revert():
                sys1.reopen_attempts(1, hz)
    s = sys1.get_system(1)
    print(f"\n  release_ready still {s['release_ready']}, covered {s['covered_count']}")
    assert s["release_ready"] is True and s["covered_count"] == 2


# ---------------------------------------------------------------
# R2-2 — reopen cannot launder old text or evidence
# ---------------------------------------------------------------

def test_R2_2_locks_survive_reopen(sys1, direct_vm, reviewer):
    direct_vm.mock_llm(r".*", GAP)
    texts = [f"weak {i}" for i in range(5)]
    digs = [dig(f"L{i}") for i in range(5)]
    for t, d in zip(texts, digs):
        sys1.submit_mitigation(1, 1, t, d)
    with direct_vm.prank(reviewer):
        sys1.reopen_attempts(1, 1)

    for t, d in zip(texts, digs):
        with direct_vm.expect_revert():
            sys1.submit_mitigation(1, 1, t, d)                # same text + same evidence
        with direct_vm.expect_revert():
            sys1.submit_mitigation(1, 1, t, dig("brand-new")) # same text, new evidence
        with direct_vm.expect_revert():
            sys1.submit_mitigation(1, 1, "brand new text", d) # new text, same evidence
    print("\n  all 5 previous text and evidence identities remain consumed after reopen")
    assert sys1.get_hazard(1, 1)["attempt_count"] == 0


# ---------------------------------------------------------------
# R2-3 — the lifetime ceiling is the real global bound
# ---------------------------------------------------------------

def test_R2_3_total_semantic_calls_per_hazard_capped_at_15(sys1, direct_vm, reviewer):
    """Drive reopen as hard as possible; count completed classifications."""
    direct_vm.mock_llm(r".*", GAP)
    completed = 0
    for _ in range(10):                       # far more cycles than the ceiling allows
        for k in range(5):
            try:
                sys1.submit_mitigation(1, 1, f"t{completed}", dig(f"D{completed}"))
                completed += 1
            except Exception:
                pass
        try:
            with direct_vm.prank(reviewer):
                sys1.reopen_attempts(1, 1)
        except Exception:
            pass
    h = sys1.get_hazard(1, 1)
    print(f"\n  completed classifications = {completed}, lifetime = {h['lifetime_attempt_count']}")
    assert completed == 15 and h["lifetime_attempt_count"] == 15


def test_R2_3b_reopen_refused_exactly_at_the_ceiling(sys1, direct_vm, reviewer):
    direct_vm.mock_llm(r".*", GAP)
    n = 0
    for cycle in range(3):
        for k in range(5):
            sys1.submit_mitigation(1, 1, f"c{cycle}k{k}", dig(f"c{cycle}k{k}")); n += 1
        if cycle < 2:
            with direct_vm.prank(reviewer):
                sys1.reopen_attempts(1, 1)
    assert n == 15 and sys1.get_hazard(1, 1)["lifetime_attempt_count"] == 15
    with direct_vm.prank(reviewer):
        with direct_vm.expect_revert():
            sys1.reopen_attempts(1, 1)
    print("\n  reopen at lifetime 15 -> REVERTED; hazard closes as designed")


def test_R2_3c_second_reopen_without_spending_is_refused(sys1, direct_vm, reviewer):
    """reopen must not be idempotent-spammable into a no-op success."""
    _exhaust(sys1, direct_vm, tag="s")
    with direct_vm.prank(reviewer):
        sys1.reopen_attempts(1, 1)
        with direct_vm.expect_revert():
            sys1.reopen_attempts(1, 1)
    print("\n  immediate second reopen -> REVERTED (no silent no-op)")


# ---------------------------------------------------------------
# R2-4 — role / id hardening on the new write
# ---------------------------------------------------------------

def test_R2_4_reopen_role_gates(sys1, direct_vm, reviewer, outsider):
    _exhaust(sys1, direct_vm, tag="r")
    with direct_vm.expect_revert():                 # owner
        sys1.reopen_attempts(1, 1)
    with direct_vm.prank(outsider):
        with direct_vm.expect_revert():
            sys1.reopen_attempts(1, 1)
    print("\n  owner and outsider reopen -> both REVERTED")


def test_R2_4b_reopen_rejects_bad_ids(sys1, direct_vm, reviewer):
    _exhaust(sys1, direct_vm, tag="b")
    bad = [(True, 1), (1, True), (0, 1), (99, 1), (1, 0), (1, 99), (-1, 1), (1, -1)]
    for sid, hid in bad:
        with direct_vm.prank(reviewer):
            with direct_vm.expect_revert():
                sys1.reopen_attempts(sid, hid)
    print(f"\n  all {len(bad)} malformed id pairs -> REVERTED")


def test_R2_4c_reviewer_of_one_system_cannot_reopen_another(sc, direct_vm, direct_bob, direct_charlie):
    """Cross-system role isolation on the new write."""
    sc.create_system("s1", json.dumps([HAZ_A, HAZ_B]), str(direct_bob))
    sc.create_system("s2", json.dumps([HAZ_A, HAZ_B]), str(direct_charlie))
    direct_vm.mock_llm(r".*", GAP)
    for i in range(5):
        sc.submit_mitigation(2, 1, f"w{i}", dig(f"cs{i}"))
    # bob is reviewer of system 1, not system 2
    with direct_vm.prank(direct_bob):
        with direct_vm.expect_revert():
            sc.reopen_attempts(2, 1)
    with direct_vm.prank(direct_charlie):
        sc.reopen_attempts(2, 1)
    print("\n  wrong-system reviewer REVERTED; correct reviewer accepted")
    assert sc.get_hazard(2, 1)["attempt_count"] == 0


# ---------------------------------------------------------------
# R2-5 — reopen interacts correctly with challenge
# ---------------------------------------------------------------

def test_R2_5_reopen_then_full_recovery_to_release(sys1, direct_vm, reviewer):
    """End-to-end: all-GAP -> reopen -> SUFFICIENT -> countersign -> release."""
    _exhaust(sys1, direct_vm, hazard=1, tag="e")
    with direct_vm.prank(reviewer):
        sys1.reopen_attempts(1, 1)
    direct_vm.clear_mocks(); direct_vm.mock_llm(r".*", SUFFICIENT)
    sys1.submit_mitigation(1, 1, "a hardwired interlock", dig("fix1"))
    sys1.submit_mitigation(1, 2, "a quarantine lane", dig("fix2"))
    with direct_vm.prank(reviewer):
        sys1.countersign_mitigation(1, 1)
        sys1.countersign_mitigation(1, 2)
    sys1.mark_release_ready(1)
    s = sys1.get_system(1)
    print(f"\n  recovered to release_ready={s['release_ready']} covered={s['covered_count']}/{s['required_hazard_count']}")
    assert s["release_ready"] is True


def test_R2_5b_challenge_after_reopen_still_correct(sys1, direct_vm, reviewer):
    _exhaust(sys1, direct_vm, tag="q")
    with direct_vm.prank(reviewer):
        sys1.reopen_attempts(1, 1)
    direct_vm.clear_mocks(); direct_vm.mock_llm(r".*", SUFFICIENT)
    sys1.submit_mitigation(1, 1, "good one", dig("gq"))
    with direct_vm.prank(reviewer):
        sys1.countersign_mitigation(1, 1)
    assert sys1.get_system(1)["covered_count"] == 1
    with direct_vm.prank(reviewer):
        sys1.challenge_coverage(1, 1, "withdrawn")
    h = sys1.get_hazard(1, 1); s = sys1.get_system(1)
    print(f"\n  after challenge: status={h['status']} cycle={h['attempt_count']} "
          f"lifetime={h['lifetime_attempt_count']} covered={s['covered_count']}")
    assert h["status"] == "OPEN" and h["attempt_count"] == 0 and s["covered_count"] == 0
    assert h["lifetime_attempt_count"] == 6


def test_R2_5c_history_complete_across_reopen_and_challenge(sys1, direct_vm, reviewer):
    direct_vm.mock_llm(r".*", GAP)
    expected = []
    for i in range(5):
        d = dig(f"H{i}"); sys1.submit_mitigation(1, 1, f"h{i}", d); expected.append(d)
    with direct_vm.prank(reviewer):
        sys1.reopen_attempts(1, 1)
    direct_vm.clear_mocks(); direct_vm.mock_llm(r".*", SUFFICIENT)
    d = dig("H5"); sys1.submit_mitigation(1, 1, "h5", d); expected.append(d)
    with direct_vm.prank(reviewer):
        sys1.challenge_coverage(1, 1, "no")
    direct_vm.clear_mocks(); direct_vm.mock_llm(r".*", GAP)
    d = dig("H6"); sys1.submit_mitigation(1, 1, "h6", d); expected.append(d)

    rows = sys1.get_hazard_attempts(1, 1, 1, 50)
    got = [r["evidence_digest"] for r in rows]
    print(f"\n  history rows={len(rows)} ordinals={[r['hazard_attempt_index'] for r in rows]}")
    assert got == expected
    assert [r["hazard_attempt_index"] for r in rows] == list(range(1, 8))


# ---------------------------------------------------------------
# R2-6 — auditability of the new write
# ---------------------------------------------------------------

def test_R2_6_reopen_leaves_no_onchain_record(sys1, direct_vm, reviewer):
    """
    challenge_coverage appends a ChallengeRecord naming the actor and reason.
    reopen_attempts appends nothing. Recorded as an auditability asymmetry,
    not a security defect: the counter gap still reveals that reopens happened.
    """
    _exhaust(sys1, direct_vm, tag="au")
    before = sys1.get_challenges(1, 1, 50)
    with direct_vm.prank(reviewer):
        sys1.reopen_attempts(1, 1)
    after = sys1.get_challenges(1, 1, 50)
    h = sys1.get_hazard(1, 1)
    cfg = sys1.get_config()
    print(f"\n  challenge records before={len(before)} after={len(after)}")
    print(f"  challenge_count in config = {cfg['challenge_count']}")
    print(f"  only trace: lifetime={h['lifetime_attempt_count']} vs cycle={h['attempt_count']}")
    assert len(before) == len(after) == 0
    # The reopen count is derivable but the actor and the timing are not recorded.


def test_R2_6b_config_advertises_the_new_write_correctly(sys1):
    cfg = sys1.get_config()
    print(f"\n  version={cfg['version']} max_attempts={cfg['max_attempts_per_hazard']} "
          f"lifetime={cfg['max_lifetime_attempts_per_hazard']}")
    assert cfg["max_attempts_per_hazard"] == 5
    assert cfg["max_lifetime_attempts_per_hazard"] == 15
