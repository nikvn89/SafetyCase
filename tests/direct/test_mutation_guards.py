"""Real-GenVM mutation probes for the new v2 liveness/security guards.

Each test deploys an intentionally weakened contract and proves that the matching
regression property observes the bad behavior. These are mutation-effect tests:
they should PASS only when the mutant is actually distinguishable from the
production contract by the stated invariant.
"""
from pathlib import Path

from conftest import SUFFICIENT, GAP, HAZ_A, HAZ_B, dig

BASE = (Path(__file__).resolve().parents[2] / "contracts" / "SafetyCase.py").read_text()
ZERO = "0x0000000000000000000000000000000000000000"


def addr_hex(a):
    """Stable hex form regardless of whether a contract has been deployed yet.

    gltest fixtures return raw `bytes` until the first direct_deploy installs
    the genlayer Address wrapper. Tests that deploy inside the body therefore
    resolve `reviewer` BEFORE the wrapper exists, and str() yields a Python
    bytes repr instead of a 0x address.
    """
    if isinstance(a, (bytes, bytearray)):
        return "0x" + bytes(a).hex()
    return str(a)




def deploy_mutant(direct_deploy, tmp_path, old: str, new: str, name: str):
    assert old in BASE, f"mutation anchor missing: {name}"
    src = BASE.replace(old, new, 1)
    path = tmp_path / f"SafetyCase_{name}.py"
    path.write_text(src)
    return direct_deploy(str(path))


def create_system(sc, reviewer):
    import json
    sc.create_system("A conveyor line.", json.dumps([HAZ_A, HAZ_B]), addr_hex(reviewer))


def test_mutant_without_lifetime_ceiling_is_detected(direct_deploy, direct_vm, reviewer, tmp_path):
    sc = deploy_mutant(
        direct_deploy,
        tmp_path,
        '        if int(hazard.lifetime_attempt_count) >= MAX_LIFETIME_ATTEMPTS_PER_HAZARD:\n            raise gl.vm.UserError(\n                "Lifetime attempt ceiling for this hazard is reached"\n            )\n',
        '        if False:\n            raise gl.vm.UserError(\n                "Lifetime attempt ceiling for this hazard is reached"\n            )\n',
        "no_lifetime_ceiling",
    )
    create_system(sc, reviewer)
    direct_vm.mock_llm(r".*", SUFFICIENT)
    for i in range(15):
        sc.submit_mitigation(1, 1, f"candidate {i}", dig(f"mut-life-{i}"))
        with direct_vm.prank(reviewer):
            sc.challenge_coverage(1, 1, f"reject {i}")
    # Production source refuses this; the mutant accepts it, so the regression
    # property can distinguish/catch the removed ceiling.
    sc.submit_mitigation(1, 1, "candidate 16", dig("mut-life-16"))
    assert sc.get_hazard(1, 1)["lifetime_attempt_count"] == 16


def test_mutant_without_challenge_reset_recreates_brick(direct_deploy, direct_vm, reviewer, tmp_path):
    sc = deploy_mutant(
        direct_deploy,
        tmp_path,
        '        hazard.attempt_count = u256(0)\n',
        '        hazard.attempt_count = hazard.attempt_count\n',
        "no_cycle_reset",
    )
    create_system(sc, reviewer)
    direct_vm.mock_llm(r".*", GAP)
    for i in range(4):
        sc.submit_mitigation(1, 1, f"weak {i}", dig(f"mut-reset-gap-{i}"))
    direct_vm.clear_mocks()
    direct_vm.mock_llm(r".*", SUFFICIENT)
    sc.submit_mitigation(1, 1, "hardwired interlock", dig("mut-reset-good"))
    with direct_vm.prank(reviewer):
        sc.countersign_mitigation(1, 1)
        sc.challenge_coverage(1, 1, "revoke")
    assert sc.get_hazard(1, 1)["attempt_count"] == 5
    with direct_vm.expect_revert():
        sc.submit_mitigation(1, 1, "replacement interlock", dig("mut-reset-new"))


def test_mutant_without_zero_reviewer_guard_accepts_zero(direct_deploy, direct_vm, tmp_path):
    import json
    sc = deploy_mutant(
        direct_deploy,
        tmp_path,
        '        if reviewer == zero_address:\n            raise gl.vm.UserError("Reviewer cannot be the zero address")\n',
        '        if False:\n            raise gl.vm.UserError("Reviewer cannot be the zero address")\n',
        "no_zero_reviewer_guard",
    )
    sc.create_system("A conveyor line.", json.dumps([HAZ_A, HAZ_B]), ZERO)
    assert sc.get_system(1)["reviewer"].lower() == ZERO.lower()


ASSIGNMENT = '            hazard.pending_mitigation_id = new_mitigation_id\n'
BROKEN_ASSIGNMENT = '            hazard.pending_mitigation_id = u256(0)\n'
GUARD = '        if int(pending_id) <= 0:\n            raise gl.vm.UserError("No mitigation is awaiting countersignature")\n'
NO_GUARD = '        if False:\n            raise gl.vm.UserError("No mitigation is awaiting countersignature")\n'


def test_pending_id_guard_refuses_corrupted_pending_state(direct_deploy, direct_vm, reviewer, tmp_path):
    """Mutate ONLY the assignment: production guard must refuse the countersign.

    Split from the original single test because gltest Direct Mode permits one
    contract class per VM context; deploying two mutants in one test raises
    ImportError("only one contract is allowed").
    """
    assert ASSIGNMENT in BASE and GUARD in BASE
    src = BASE.replace(ASSIGNMENT, BROKEN_ASSIGNMENT, 1)
    path = tmp_path / "SafetyCase_corrupt_pending_guarded.py"
    path.write_text(src)
    sc = direct_deploy(str(path))
    create_system(sc, reviewer)
    direct_vm.mock_llm(r".*", SUFFICIENT)
    sc.submit_mitigation(1, 1, "interlock", dig("mut-pending-a"))
    with direct_vm.prank(reviewer):
        with direct_vm.expect_revert():
            sc.countersign_mitigation(1, 1)
    print("\n  guarded mutant: countersign REFUSED (guard is load-bearing)")


def test_pending_id_guard_removal_is_observable(direct_deploy, direct_vm, reviewer, tmp_path):
    """Compound mutant: broken assignment AND removed guard reaches COVERED with covered_by=0."""
    src = BASE.replace(ASSIGNMENT, BROKEN_ASSIGNMENT, 1).replace(GUARD, NO_GUARD, 1)
    path = tmp_path / "SafetyCase_corrupt_pending_unguarded.py"
    path.write_text(src)
    sc = direct_deploy(str(path))
    create_system(sc, reviewer)
    direct_vm.mock_llm(r".*", SUFFICIENT)
    sc.submit_mitigation(1, 1, "interlock", dig("mut-pending-b"))
    with direct_vm.prank(reviewer):
        sc.countersign_mitigation(1, 1)
    h = sc.get_hazard(1, 1)
    print(f"\n  unguarded mutant: status={h['status']} covered_by={h['covered_by']} (guard removal observable)")
    assert h["status"] == "COVERED" and h["covered_by"] == 0


def test_mutant_using_cycle_index_breaks_append_only_hazard_history(direct_deploy, direct_vm, reviewer, tmp_path):
    sc = deploy_mutant(
        direct_deploy,
        tmp_path,
        '                int(next_lifetime_attempt),\n',
        '                int(next_cycle_attempt),\n',
        "cycle_history_index",
    )
    create_system(sc, reviewer)
    direct_vm.mock_llm(r".*", SUFFICIENT)
    ev1 = dig("mut-history-a")
    ev2 = dig("mut-history-b")
    sc.submit_mitigation(1, 1, "history A", ev1)
    with direct_vm.prank(reviewer):
        sc.challenge_coverage(1, 1, "reject A")
    direct_vm.clear_mocks()
    direct_vm.mock_llm(r".*", GAP)
    sc.submit_mitigation(1, 1, "history B", ev2)
    # The mutant reuses ordinal 1 after reset, so the lifetime-indexed view can
    # no longer return both immutable records. Detect either corruption mode.
    broken = False
    try:
        rows = sc.get_hazard_attempts(1, 1, 1, 10)
        broken = len(rows) != 2 or rows[0]["evidence_digest"] != ev1 or rows[1]["evidence_digest"] != ev2
    except Exception:
        broken = True
    assert broken, "cycle-index mutant unexpectedly preserved append-only history"
