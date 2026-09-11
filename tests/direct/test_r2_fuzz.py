"""Randomised state-machine fuzz. Checks core invariants after EVERY operation."""
import json, random
from conftest import SUFFICIENT, GAP, HAZ_A, HAZ_B, dig

def test_invariants_hold_under_random_operation_sequences(sc, direct_vm, direct_bob):
    sc.create_system("fuzz", json.dumps([HAZ_A, HAZ_B]), str(direct_bob))
    reviewer = direct_bob
    rnd = random.Random(20260910)
    ops, applied = 0, 0

    def check(tag):
        s = sc.get_system(1)
        hz = sc.get_hazards(1, 1, 10)
        actual_cov = sum(1 for h in hz if h["status"] == "COVERED")
        assert actual_cov == s["covered_count"], f"{tag}: covered_count diverged"
        assert s["covered_count"] <= s["required_hazard_count"]
        for h in hz:
            assert 0 <= h["attempt_count"] <= 5, f"{tag}: cycle {h['attempt_count']}"
            assert 0 <= h["lifetime_attempt_count"] <= 15, f"{tag}: lifetime {h['lifetime_attempt_count']}"
            assert h["attempt_count"] <= h["lifetime_attempt_count"]
            assert h["status"] in ("OPEN", "PENDING_COUNTERSIGNATURE", "COVERED")
            if h["status"] == "COVERED":
                assert h["covered_by"] > 0 and h["pending_mitigation_id"] == 0
            if h["status"] == "PENDING_COUNTERSIGNATURE":
                assert h["pending_mitigation_id"] > 0 and h["covered_by"] == 0
            if h["status"] == "OPEN":
                assert h["covered_by"] == 0 and h["pending_mitigation_id"] == 0
        if s["release_ready"]:
            assert s["covered_count"] == s["required_hazard_count"], f"{tag}: released while uncovered"
        # per-hazard history must be exactly lifetime_attempt_count rows, in order
        for h in hz:
            rows = sc.get_hazard_attempts(1, h["hazard_index"], 1, 50)
            assert len(rows) == h["lifetime_attempt_count"], f"{tag}: history len mismatch"
            assert [r["hazard_attempt_index"] for r in rows] == list(range(1, len(rows) + 1))

    check("init")
    for i in range(400):
        hz_i = rnd.choice([1, 2])
        op = rnd.choice(["submit", "submit", "submit", "countersign",
                         "challenge", "reopen", "release"])
        try:
            if op == "submit":
                direct_vm.clear_mocks()
                direct_vm.mock_llm(r".*", SUFFICIENT if rnd.random() < 0.5 else GAP)
                sc.submit_mitigation(1, hz_i, f"m{i}", dig(f"f{i}"))
            elif op == "countersign":
                with direct_vm.prank(reviewer):
                    sc.countersign_mitigation(1, hz_i)
            elif op == "challenge":
                with direct_vm.prank(reviewer):
                    sc.challenge_coverage(1, hz_i, f"r{i}")
            elif op == "reopen":
                with direct_vm.prank(reviewer):
                    sc.reopen_attempts(1, hz_i)
            else:
                sc.mark_release_ready(1)
            applied += 1
        except Exception:
            pass
        ops += 1
        check(f"op{i}:{op}")

    s = sc.get_system(1)
    hz = sc.get_hazards(1, 1, 10)
    print(f"\n  {ops} operations attempted, {applied} applied, all invariants held")
    print(f"  final: covered={s['covered_count']}/{s['required_hazard_count']} release_ready={s['release_ready']}")
    for h in hz:
        print(f"    hazard {h['hazard_index']}: {h['status']:24s} cycle={h['attempt_count']} lifetime={h['lifetime_attempt_count']}")
    assert applied > 30, "fuzz did not exercise enough successful operations"
