import json
from conftest import SUFFICIENT, GAP, HAZ_A, HAZ_B, dig

def test_deploy_and_create(sys1, reviewer, owner):
    cfg = sys1.get_config()
    print("\n  version:", cfg["version"], "| reviewer_required:", cfg["reviewer_required"],
          "| max_attempts:", cfg["max_attempts_per_hazard"])
    s = sys1.get_system(1)
    print("  owner:", s["owner"], "\n  reviewer:", s["reviewer"])
    assert cfg["version"] == "2.0"
    assert str(s["reviewer"]).lower() == str(reviewer).lower()

def test_sufficient_only_makes_pending(sys1, direct_vm):
    direct_vm.mock_llm(r".*", SUFFICIENT)
    sys1.submit_mitigation(1, 1, "A hardwired interlock cuts motor-enable power.", dig("ev1"))
    h = sys1.get_hazard(1, 1); s = sys1.get_system(1)
    print(f"\n  status={h['status']} covered_count={s['covered_count']} pending_id={h['pending_mitigation_id']}")
    assert h["status"] == "PENDING_COUNTERSIGNATURE"
    assert s["covered_count"] == 0

def test_reviewer_countersign_covers(sys1, direct_vm, reviewer):
    direct_vm.mock_llm(r".*", SUFFICIENT)
    sys1.submit_mitigation(1, 1, "interlock", dig("ev1"))
    with direct_vm.prank(reviewer):
        sys1.countersign_mitigation(1, 1)
    h = sys1.get_hazard(1, 1); s = sys1.get_system(1)
    print(f"\n  status={h['status']} covered_count={s['covered_count']} covered_by={h['covered_by']}")
    assert h["status"] == "COVERED" and s["covered_count"] == 1
