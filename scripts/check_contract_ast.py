from __future__ import annotations

import ast
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "contracts" / "SafetyCase.py"
source = SRC.read_text(encoding="utf-8")
tree = ast.parse(source)
errors = []


def require(cond, msg):
    if not cond:
        errors.append(msg)


classes = {n.name: n for n in tree.body if isinstance(n, ast.ClassDef)}
require("SafetyCaseGate" in classes, "missing SafetyCaseGate")
contract = classes.get("SafetyCaseGate")
methods = {}
if contract:
    methods = {n.name: n for n in contract.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}

for name in (
    "create_system", "submit_mitigation", "countersign_mitigation",
    "challenge_coverage", "reopen_attempts", "mark_release_ready", "get_config", "get_system",
    "get_hazard", "get_mitigation", "get_hazard_attempts", "get_challenges",
):
    require(name in methods, f"missing method {name}")

# Signature checks.
def args(name):
    fn = methods.get(name)
    return [a.arg for a in fn.args.args] if fn else []

require(args("create_system") == ["self", "system_purpose", "hazards_json", "reviewer_hex"], "create_system signature mismatch")
require(args("submit_mitigation") == ["self", "system_id", "hazard_index", "mitigation_text", "evidence_digest_hex"], "submit_mitigation signature mismatch")
require(args("countersign_mitigation") == ["self", "system_id", "hazard_index"], "countersign_mitigation signature mismatch")
require(args("challenge_coverage") == ["self", "system_id", "hazard_index", "reason_text"], "challenge_coverage signature mismatch")
require(args("reopen_attempts") == ["self", "system_id", "hazard_index"], "reopen_attempts signature mismatch")

# Structural properties tied directly to steward feedback.
require('reviewer: Address' in source, "reviewer not persisted")
require('HAZARD_PENDING = "PENDING_COUNTERSIGNATURE"' in source, "pending status missing")
require('MAX_ATTEMPTS_PER_HAZARD = 5' in source, "per-cycle attempt cap missing")
require('MAX_LIFETIME_ATTEMPTS_PER_HAZARD = 15' in source, "lifetime attempt ceiling missing")
require('lifetime_attempt_count: u256' in source, "lifetime attempt counter missing")
require('evidence_digest: str' in source, "evidence digest missing from mitigation record")
require('evidence_lookup: TreeMap[str, u256]' in source, "evidence replay map missing")
require('challenge_count: u256' in source and 'ChallengeRecord' in source, "append-only challenge history missing")
require('system.release_ready = False' in source, "challenge does not revoke release readiness")
require('system.released_by = gl.message.sender_address' in source, "release attribution missing")
require('"version": "2.0"' in source, "config version is not 2.0")

# Ordering: deterministic replay/budget gates must precede consensus call.
submit = methods.get("submit_mitigation")
if submit:
    seg = ast.get_source_segment(source, submit) or ""
    pos_evidence = seg.find("if evidence_key in self.evidence_lookup")
    pos_budget = seg.find("if int(hazard.attempt_count) >= MAX_ATTEMPTS_PER_HAZARD")
    pos_lifetime = seg.find("if int(hazard.lifetime_attempt_count) >= MAX_LIFETIME_ATTEMPTS_PER_HAZARD")
    pos_model = seg.find("self._classify_mitigation(")
    require(0 <= pos_evidence < pos_model, "evidence replay guard must precede semantic call")
    require(0 <= pos_budget < pos_model, "per-cycle attempt budget must precede semantic call")
    require(0 <= pos_lifetime < pos_model, "lifetime attempt ceiling must precede semantic call")
    require('next_lifetime_attempt = u256(int(hazard.lifetime_attempt_count) + 1)' in seg, "completed semantic attempt does not compute lifetime ordinal")
    require('int(next_lifetime_attempt)' in seg, "hazard history is not indexed by monotonic lifetime ordinal")
    require('hazard.lifetime_attempt_count = next_lifetime_attempt' in seg, "completed semantic attempt does not increment lifetime counter")
    require('hazard.status = HAZARD_PENDING' in seg, "SUFFICIENT does not transition to pending")
    require('hazard.status = HAZARD_COVERED' not in seg, "submit_mitigation must not directly COVER a hazard")

counter = methods.get("countersign_mitigation")
if counter:
    seg = ast.get_source_segment(source, counter) or ""
    require('gl.message.sender_address != system.reviewer' in seg, "countersign reviewer role guard missing")
    require('hazard.status = HAZARD_COVERED' in seg, "countersign does not cover")
    require('system.covered_count = u256(int(system.covered_count) + 1)' in seg, "countersign covered_count increment missing")

hazard_attempts = methods.get("get_hazard_attempts")
if hazard_attempts:
    seg = ast.get_source_segment(source, hazard_attempts) or ""
    require('int(hazard.lifetime_attempt_count)' in seg, "hazard attempt history must paginate over lifetime attempts")

challenge = methods.get("challenge_coverage")
if challenge:
    seg = ast.get_source_segment(source, challenge) or ""
    require('gl.message.sender_address != system.reviewer' in seg, "challenge reviewer role guard missing")
    require('hazard.status = HAZARD_OPEN' in seg, "challenge does not reopen hazard")
    require('system.release_ready = False' in seg, "challenge does not close release gate")
    require('hazard.attempt_count = u256(0)' in seg, "challenge does not restore per-cycle attempt budget")


reopen = methods.get("reopen_attempts")
if reopen:
    seg = ast.get_source_segment(source, reopen) or ""
    require('gl.message.sender_address != system.reviewer' in seg, "reopen reviewer role guard missing")
    require('hazard.status != HAZARD_OPEN' in seg, "reopen OPEN-state guard missing")
    require('int(hazard.attempt_count) < MAX_ATTEMPTS_PER_HAZARD' in seg, "reopen exhaustion guard missing")
    require('int(hazard.lifetime_attempt_count) >= MAX_LIFETIME_ATTEMPTS_PER_HAZARD' in seg, "reopen lifetime ceiling guard missing")
    require('hazard.attempt_count = u256(0)' in seg, "reopen does not restore per-cycle attempt budget")

# No external truth/oracle expansion in this v2 contract.
import_roots = set()
for node in ast.walk(tree):
    if isinstance(node, ast.Import):
        import_roots.update(alias.name.split(".")[0] for alias in node.names)
    elif isinstance(node, ast.ImportFrom) and node.module:
        import_roots.add(node.module.split(".")[0])
for bad_mod in ("requests", "urllib", "datetime", "time"):
    require(bad_mod not in import_roots, f"unexpected external/clock import: {bad_mod}")
for bad_expr in ("http://", "https://", "gl.nondet.web", "time.time"):
    require(bad_expr not in source, f"unexpected external/clock dependency: {bad_expr}")

if errors:
    print("AST/POLICY: FAIL")
    for e in errors:
        print(" -", e)
    raise SystemExit(1)

print("AST/POLICY: PASS")
print("required writes: create / submit / countersign / challenge / reopen / release")
print("semantic consequence split: submit -> PENDING; reviewer -> COVERED")
print("anti-reroll: exact text + evidence digest + 5-attempt cycle cap + 15-attempt lifetime ceiling")
print("challenge path: COVERED/PENDING -> OPEN, cycle budget reset, release_ready=False")
print("all-GAP liveness: exhausted OPEN cycle -> reviewer reopen -> fresh cycle, lifetime ceiling preserved")
