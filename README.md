# SafetyCase

**Authenticated safety-case coverage for GenLayer.**

SafetyCase v2.0 turns an immutable declared hazard set into a reviewer-controlled release gate. The owner proposes mitigations and GenLayer validators answer one narrow semantic question per hazard: whether the mitigation is sufficient for that declared hazard. A `MITIGATION_SUFFICIENT` verdict does **not** cover anything by itself; it creates `PENDING_COUNTERSIGNATURE`. Only the distinct reviewer wallet fixed at system creation can countersign the candidate into `COVERED`.

## Frozen StudioNet deployment

- Contract: `0x26F508c59e7874dE289C8B8ae0F7937D229d621F`
- Source: `contracts/SafetyCase.py`
- Frozen SHA-256: `27afc982cffd9f6abdb960a9bf7ec9de07714ca12a23dd16b21f224753abd06f`
- Contract version: `2.0`
- Deployment screenshot: `evidence/00_v2_deployment_ACCEPTED_SUCCESS.png`

The deployed source is frozen. Frontend work must not change the contract bytes.

## Why v2.0 is stronger

### Authenticated second party

`create_system` stores a reviewer that must be non-zero and distinct from the owner. A semantic `MITIGATION_SUFFICIENT` result only creates a pending candidate. `countersign_mitigation` is reviewer-only and is the step that changes the hazard to `COVERED`.

### Evidence binding without overclaiming verification

Each mitigation is bound to a 32-byte SHA-256 evidence digest. The digest makes the claimed artifact identity immutable and prevents the same artifact from purchasing another semantic roll on the same hazard. The contract does **not** fetch, validate, or prove that the artifact exists. The separately authenticated reviewer must verify that artifact off-chain before countersigning.

### Bounded retries

Each hazard has:

- 5 semantic classifications per retry cycle;
- 15 classifications over its lifetime;
- exact mitigation-text replay blocking;
- same-evidence-digest reroll blocking;
- no additional submissions while a candidate is pending countersignature.

If an OPEN hazard reaches 5/5 while still below 15/15, the reviewer may call `reopen_attempts`. This resets only the cycle counter; lifetime history and text/evidence locks stay intact.

### Challenge and revocation

The reviewer may call `challenge_coverage` on a PENDING or COVERED hazard. The hazard returns to `OPEN`. If the hazard was COVERED, `covered_count` is decremented, and any previously open `release_ready` gate is closed again. Challenges are append-only and queryable.

## Public write surface

1. `create_system(system_purpose, hazards_json, reviewer_hex)`
2. `submit_mitigation(system_id, hazard_index, mitigation_text, evidence_digest_hex)`
3. `countersign_mitigation(system_id, hazard_index)`
4. `challenge_coverage(system_id, hazard_index, reason_text)`
5. `reopen_attempts(system_id, hazard_index)`
6. `mark_release_ready(system_id)`

`mark_release_ready` is deterministic and permissionless. It succeeds only when `covered_count == required_hazard_count`.

## Frontend v2.0

The dApp exposes the complete v2 workflow:

- owner + distinct reviewer at creation;
- local SHA-256 hashing of an evidence file (the file never leaves the browser);
- owner mitigation submission;
- reviewer countersign;
- reviewer challenge / revocation;
- reviewer reopen of an exhausted OPEN retry cycle;
- cycle `attempt_count / 5` and lifetime `lifetime_attempt_count / 15` side-by-side;
- append-only mitigation and challenge audit trails;
- source-address-SHA verification panel.

Contract rules are not duplicated as hard client-side blocks. The UI forecasts likely refusal in red, but structurally buildable calls remain submit-able so the on-chain role/state gates remain demonstrable. A synchronous UI mutation lock plus an RPC write guard prevents accidental double submission while a transaction is being processed and its finalized postcondition is checked.

The wallet flow uses standard EIP-1193 MetaMask methods (`eth_requestAccounts`, `eth_chainId`, `wallet_switchEthereumChain`, `wallet_addEthereumChain`) and does not request MetaMask Snaps.

## Honest scope

- The declared hazard list is complete only as declared by the creator; SafetyCase does not discover undisclosed real-world hazards.
- The SHA-256 digest is an immutable binding, not contract-side evidence verification.
- The contract does not prove a mitigation was implemented in the real world.
- The reviewer is chosen by the owner at creation and cannot be replaced. A reviewer who refuses every candidate can permanently prevent a hazard from reaching `COVERED`; this is an explicit consequence of requiring second-party consent.
- Direct Mode is not StudioNet runtime proof. The deployed contract still needs live semantic/runtime evidence before final resubmission.

## Local checks

Frontend:

```bash
npm ci
npm run build
npm test
```

Contract logic / hardening:

```bash
python -m py_compile contracts/SafetyCase.py scripts/*.py
python scripts/check_contract_ast.py
python scripts/test_contract_logic.py
python scripts/fence_probe.py
python scripts/mutation_matrix.py
```

Real GenVM Direct Mode:

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
pytest -q tests/direct/
```

The reviewed frozen candidate passed 89 real-GenVM checks (74 shipped R1/R2 checks, 14 independent R2 probes, and a 400-operation invariant fuzz) before deployment. StudioNet runtime proof remains a separate required gate.
