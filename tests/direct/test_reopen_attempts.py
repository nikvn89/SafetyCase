"""Verification of the proposed reopen_attempts fix. Runs only against the patched source."""
import pytest, json
from conftest import SUFFICIENT, GAP, dig

def test_all_gap_hazard_can_be_reopened(sys1, direct_vm, reviewer):
    direct_vm.mock_llm(r".*", GAP)
    for i in range(5):
        sys1.submit_mitigation(1, 1, f"weak {i}", dig(f"g{i}"))
    with direct_vm.expect_revert():
        sys1.submit_mitigation(1, 1, "sixth", dig("g5"))
    with direct_vm.prank(reviewer):
        sys1.reopen_attempts(1, 1)
    h = sys1.get_hazard(1, 1)
    print(f"\n  after reopen: cycle={h['attempt_count']} lifetime={h['lifetime_attempt_count']}")
    assert h["attempt_count"] == 0 and h["lifetime_attempt_count"] == 5
    direct_vm.clear_mocks(); direct_vm.mock_llm(r".*", SUFFICIENT)
    sys1.submit_mitigation(1, 1, "a real interlock", dig("good"))
    with direct_vm.prank(reviewer):
        sys1.countersign_mitigation(1, 1)
    print(f"  recovered -> {sys1.get_hazard(1,1)['status']}")
    assert sys1.get_hazard(1, 1)["status"] == "COVERED"

def test_reopen_cannot_exceed_lifetime(sys1, direct_vm, reviewer):
    direct_vm.mock_llm(r".*", GAP)
    for cycle in range(3):
        for k in range(5):
            sys1.submit_mitigation(1, 1, f"c{cycle}k{k}", dig(f"c{cycle}k{k}"))
        if cycle < 2:
            with direct_vm.prank(reviewer):
                sys1.reopen_attempts(1, 1)
    h = sys1.get_hazard(1, 1)
    print(f"\n  lifetime={h['lifetime_attempt_count']} (ceiling 15)")
    assert h["lifetime_attempt_count"] == 15
    with direct_vm.prank(reviewer):
        with direct_vm.expect_revert():
            sys1.reopen_attempts(1, 1)
    print("  reopen at lifetime ceiling -> REVERTED")

def test_reopen_role_and_state_gates(sys1, direct_vm, reviewer, outsider):
    direct_vm.mock_llm(r".*", GAP)
    sys1.submit_mitigation(1, 1, "one", dig("o1"))
    # not exhausted yet
    with direct_vm.prank(reviewer):
        with direct_vm.expect_revert():
            sys1.reopen_attempts(1, 1)
    print("\n  reopen before exhaustion -> REVERTED")
    for i in range(4):
        sys1.submit_mitigation(1, 1, f"x{i}", dig(f"x{i}"))
    with direct_vm.expect_revert():          # owner
        sys1.reopen_attempts(1, 1)
    with direct_vm.prank(outsider):
        with direct_vm.expect_revert():
            sys1.reopen_attempts(1, 1)
    print("  owner and outsider reopen -> both REVERTED")

def test_reopen_refused_on_pending_or_covered(sys1, direct_vm, reviewer):
    direct_vm.mock_llm(r".*", SUFFICIENT)
    sys1.submit_mitigation(1, 1, "m", dig("m"))
    with direct_vm.prank(reviewer):
        with direct_vm.expect_revert():
            sys1.reopen_attempts(1, 1)       # PENDING
        sys1.countersign_mitigation(1, 1)
        with direct_vm.expect_revert():
            sys1.reopen_attempts(1, 1)       # COVERED
    print("\n  reopen on PENDING and COVERED -> both REVERTED")
