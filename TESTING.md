# SafetyCase v2.0 — testing

## Deployment under test

```text
Network: GenLayer StudioNet
Contract: 0x26F508c59e7874dE289C8B8ae0F7937D229d621F
Frozen source SHA-256: 27afc982cffd9f6abdb960a9bf7ec9de07714ca12a23dd16b21f224753abd06f
Version: 2.0
```

The deployment transaction has been observed as `ACCEPTED`, with GenVM `SUCCESS` and consensus `Accepted`. That proves deployment success only; it does not replace runtime testing of the load-bearing v2 state machine.

## Local exact-source gates

```bash
python -m py_compile contracts/SafetyCase.py scripts/*.py
python scripts/check_contract_ast.py
python scripts/test_contract_logic.py
python scripts/fence_probe.py
python scripts/mutation_matrix.py
```

Expected reviewed baseline:

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

The frozen predeploy candidate was independently exercised under `genlayer-test==0.29.2`, `GENVM_VERSION=v0.2.12`, and `genvm-linter==0.11.0` with 89 checks and 0 failures. The suite includes cycle/lifetime retry bounds, malicious-reviewer behavior, role isolation, replay/evidence locks, challenge liveness, `reopen_attempts`, append-only history, mutation guards, and a 400-operation invariant fuzz.

## Frontend v2 checks

```bash
npm ci
npm run build
npm test
```

The frontend must verify `get_config()` reports:

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

## Required StudioNet runtime path before resubmission

Use at least two distinct wallets:

```text
Wallet A = owner
Wallet B = reviewer
```

A third outsider wallet is recommended for one role-refusal transaction.

Run a fresh system with at least two hazards. Capture transaction hashes and finalized post-state for this path:

1. Wallet A creates a system with Wallet B as reviewer. Confirm both hazards are `OPEN`, `covered_count=0`, and both retry counters start at zero.
2. Attempt a create with reviewer == owner and preserve the on-chain refusal evidence.
3. Wallet A submits a weak mitigation with a fresh SHA-256 digest. Confirm `SAFETY_GAP`; hazard remains `OPEN`; cycle/lifetime each increment exactly once.
4. Wallet A submits a strong mitigation with a different fresh digest. Confirm `MITIGATION_SUFFICIENT` produces `PENDING_COUNTERSIGNATURE`, not `COVERED`, and `covered_count` remains unchanged.
5. From a non-reviewer wallet, call `countersign_mitigation` and preserve the refusal evidence.
6. Wallet B countersigns. Confirm the hazard becomes `COVERED` and `covered_count` increments.
7. Cover the second hazard through submit + reviewer countersign.
8. Call `mark_release_ready`. Confirm `release_ready=true` only after both hazards are COVERED.
9. Wallet B challenges hazard 1. Confirm `COVERED -> OPEN`, `covered_count` decrements, challenge history grows, and `release_ready` becomes `false`.
10. Exercise the cycle bound on an OPEN hazard until `attempt_count=5` while lifetime remains below 15. Confirm a sixth semantic attempt is refused before another classification.
11. Wallet B calls `reopen_attempts`. Confirm cycle becomes `0/5`, lifetime is unchanged, and old text/evidence digests remain unusable.
12. Submit fresh text + fresh evidence, reach PENDING, countersign again, and confirm the system can recover to complete coverage.

### Evidence wording

Use this wording when describing the evidence mechanism:

> The mitigation is bound to an immutable SHA-256 identity of an evidence artifact, and a separately authenticated reviewer must verify that artifact off-chain before countersigning. The digest also prevents the same artifact from purchasing another semantic roll on the same hazard.

Do not say the contract verifies, validates, fetches, or proves the evidence artifact.

## dApp refusal-path rule

The UI may forecast a likely refusal, but must not suppress a structurally buildable write merely because the connected role or current contract state looks invalid. This allows a reviewer/steward to exercise and observe the contract's own role and state gates.

All write controls use a mutation lock. One click must disable further write/navigation controls until the submitted write has either failed or its expected finalized postcondition has been checked.
