import json
from conftest import SUFFICIENT, GAP, dig

def test_views_and_counts(sys1, direct_vm, reviewer):
    direct_vm.mock_llm(r".*", GAP)
    sys1.submit_mitigation(1, 1, "weak", dig("w"))
    direct_vm.clear_mocks(); direct_vm.mock_llm(r".*", SUFFICIENT)
    sys1.submit_mitigation(1, 1, "strong", dig("s"))
    s = sys1.get_system(1)
    print(f"\n  open={s['open_count']} pending={s['pending_count']} covered={s['covered_count']} required={s['required_hazard_count']}")
    assert s["open_count"] + s["pending_count"] + s["covered_count"] == s["required_hazard_count"]

    att = sys1.get_hazard_attempts(1, 1, 1, 10)
    print(f"  hazard attempts: {[(a['hazard_attempt_index'], a['verdict'], a['evidence_digest'][:8]) for a in att]}")
    assert len(att) == 2 and att[0]["verdict"] == "SAFETY_GAP" and att[1]["verdict"] == "MITIGATION_SUFFICIENT"

    sm = sys1.get_system_mitigations(1, 1, 10)
    print(f"  system mitigations: {len(sm)}")
    assert len(sm) == 2

def test_pagination_edges(sys1, direct_vm):
    direct_vm.mock_llm(r".*", GAP)
    sys1.submit_mitigation(1, 1, "a", dig("a"))
    for fn, args in [("get_hazards", (1, 1, 0)), ("get_hazards", (1, 0, 5)),
                     ("get_hazards", (1, 1, 51)), ("get_hazard_attempts", (1, 1, 0, 5))]:
        try:
            getattr(sys1, fn)(*args); print(f"  {fn}{args} -> ACCEPTED")
        except Exception as e:
            print(f"  {fn}{args} -> refused")
