# SafetyCase v2.0 — testing

## Deployment under test

```text
Network: GenLayer StudioNet
Contract: 0x26F508c59e7874dE289C8B8ae0F7937D229d621F
Frozen source SHA-256: 27afc982cffd9f6abdb960a9bf7ec9de07714ca12a23dd16b21f224753abd06f
Version: 2.0
Live dApp: https://safety-case-bice.vercel.app/
```

Deployment evidence records `ACCEPTED`, GenVM `SUCCESS`, and consensus `Accepted`. Deployment success is not used as a substitute for runtime state-machine proof.

## Local exact-source gates

```bash
python -m py_compile contracts/SafetyCase.py scripts/*.py
python scripts/check_contract_ast.py
python scripts/test_contract_logic.py
python scripts/fence_probe.py
python scripts/mutation_matrix.py
```

Reviewed baseline:

```text
Core logic                26/26 PASS
Prompt fence              0/18 bypasses
Mutation matrix           17/17 caught
```

## Real GenVM Direct Mode

Use the pinned toolchain:

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
pytest -q tests/direct/
```

The frozen candidate was exercised under `genlayer-test==0.29.2`, `GENVM_VERSION=v0.2.12`, and `genvm-linter==0.11.0` with 89 checks and 0 failures. The suite covers cycle/lifetime bounds, role isolation, replay/evidence locks, challenge liveness, `reopen_attempts`, append-only history, mutation guards, and invariant fuzzing.

## Frontend checks

```bash
npm ci
npm run build
npm test
```

The frontend verifies live `get_config()` values including:

```text
name = SafetyCaseGate
version = 2.0
reviewer_required = true
challenge_enabled = true
max_attempts_per_hazard = 5
max_lifetime_attempts_per_hazard = 15
evidence_binding = sha256_digest_per_mitigation
same_evidence_reroll_blocked = true
PENDING_COUNTERSIGNATURE present in hazard_statuses
```

Wallet connection must not invoke `wallet_getSnaps`, `wallet_requestSnaps`, or `client.connect('studionet')`.

## Completed StudioNet runtime case

Runtime evidence is stored in `evidence/runtime-v2/`. System #1 was used with:

```text
Owner:
0x6276095FAEA15108740445ff277fdA8c304657F4

Reviewer:
0x146e44881d35814bA582D265AF5b97ef2695ec8e
```

Declared hazards:

```text
H1: Forklift and pedestrian collision at the loading dock
H2: Unsecured pallet load falling into the pedestrian route
```

### Observed path and postconditions

1. **Create baseline** — System #1 created with the distinct reviewer and two hazards. Both hazards `OPEN`, coverage `0/2`, retry counters `0/5`, lifetime `0/15`.
2. **H1 GAP** — weak mitigation classified `SAFETY_GAP`; H1 stayed `OPEN`, cycle/lifetime became `1/5`, `1/15`.
3. **H1 sufficient but not covered** — fresh strong mitigation classified `MITIGATION_SUFFICIENT`; H1 became `PENDING_COUNTERSIGNATURE`, coverage remained `0/2`.
4. **On-chain role refusal** — Owner called `countersign_mitigation(1,1)`. Explorer showed consensus `Accepted` but GenVM `ERROR`, result `Rollback`, error `Only the reviewer may countersign`. H1 remained PENDING and coverage remained `0/2`.
5. **Reviewer countersign** — Reviewer countersigned H1; H1 became `COVERED`, coverage `1/2`.
6. **Exhaust H2 cycle** — five weak, fresh-text/fresh-digest submissions all classified `SAFETY_GAP`; H2 remained `OPEN`, cycle `5/5`, lifetime `5/15`.
7. **Reviewer reopen** — Reviewer called `reopen_attempts`; H2 stayed OPEN, cycle reset `5/5 → 0/5`, lifetime stayed `5/15`.
8. **Recover after reopen** — fresh strong H2 mitigation reached PENDING, cycle `1/5`, lifetime `6/15`; reviewer countersigned; system reached `2/2 COVERED`.
9. **First release** — `mark_release_ready` succeeded only at `2/2`; release gate became READY.
10. **Challenge after release** — Reviewer challenged H2. H2 changed `COVERED → OPEN`, coverage `2/2 → 1/2`, cycle reset to `0/5`, lifetime stayed `6/15`, and release gate became CONTROLLED/CLOSED.
11. **Recover after challenge** — fresh H2 mitigation reached PENDING, lifetime `7/15`; reviewer countersigned; system returned to `2/2 COVERED`.
12. **Final release** — release readiness declared again; final System #1 state is `2/2 COVERED`, `release_ready=true`, H2 cycle `1/5`, lifetime `7/15`.
13. **Audit history** — attempts #1–#9 remain ordered and append-only and Challenge #1 remains queryable; reopen did not overwrite prior history.
14. **Source parity / scope** — live Verification panel shows the exact contract address, frozen SHA-256, v2.0 schema and the evidence-binding limitations.

The screenshot mapping is documented in `evidence/runtime-v2/EVIDENCE_INDEX.md`.

## Exact path for a fresh tester

Use two distinct wallets. Wallet roles may be any addresses; do not reuse the runtime addresses above unless you control them.

1. Connect **Owner** wallet.
2. `Declare` → enter purpose → enter a distinct **Reviewer** address → declare **2–8 hazards** → create.
3. `Mitigate` → select H1 → submit weak mitigation + fresh 64-hex SHA-256 digest → expect `SAFETY_GAP` and OPEN.
4. Submit strong H1 mitigation + different fresh digest → expect `PENDING_COUNTERSIGNATURE`, not COVERED.
5. While still Owner, click `Countersign` → expect on-chain reviewer-role refusal; confirm explorer execution result/post-state, not consensus status alone.
6. Switch to Reviewer → countersign H1 → expect COVERED.
7. On H2, use fresh weak text + fresh digest for five GAP attempts → expect OPEN `5/5`, lifetime `5/15`.
8. Reviewer → `Reopen attempts` → expect OPEN `0/5`, lifetime unchanged `5/15`.
9. Owner → fresh strong H2 mitigation + fresh digest → expect PENDING; Reviewer countersigns → expect `2/2 COVERED`.
10. Owner → `Mark release ready` → expect READY.
11. Reviewer → enter challenge reason → `Challenge coverage` on a COVERED hazard → expect OPEN, coverage decrement and release gate CLOSED.
12. Owner → submit fresh recovery mitigation + fresh digest → PENDING; Reviewer countersigns → `2/2 COVERED` again.
13. Owner → `Mark release ready` again → final READY.
14. `Audit trail` → confirm earlier attempt rows are still present and challenge history is retained.
15. `Verification` → confirm deployed address, source SHA and honest-scope wording.

## Evidence wording

Use this wording when describing the evidence mechanism:

> The mitigation is bound to an immutable SHA-256 identity of an evidence artifact, and a separately authenticated reviewer must verify that artifact off-chain before countersigning. The digest also prevents the same artifact from purchasing another semantic roll on the same hazard.

Do not say the contract verifies, validates, fetches, or proves the evidence artifact.

## dApp refusal-path rule

The UI may forecast a likely refusal, but must not suppress a structurally buildable write merely because the connected role or current contract state looks invalid. This allows a reviewer/steward to exercise and observe the contract's own role and state gates.

All write controls use a mutation lock. A write is not reported as successful merely because a transaction reached finality; the dApp waits for an action-specific finalized postcondition. A refused write must leave the expected state unchanged and must not produce a green success banner.
