# SafetyCase v2.0 — StudioNet runtime evidence index

Runtime date: 2026-09-11  
Network: GenLayer StudioNet  
Contract: `0x26F508c59e7874dE289C8B8ae0F7937D229d621F`  
Frozen source SHA-256: `27afc982cffd9f6abdb960a9bf7ec9de07714ca12a23dd16b21f224753abd06f`  
System under test: `#1`

Wallet roles used for the run:

- Owner: `0x6276095FAEA15108740445ff277fdA8c304657F4`
- Reviewer: `0x146e44881d35814bA582D265AF5b97ef2695ec8e`

The screenshots below are post-state/runtime evidence. Explorer finality is not treated as execution success by itself; where a refusal matters, the explorer execution result and unchanged post-state are preserved separately.

| File | What it proves |
|---|---|
| `01_system_created_baseline.png` | System #1 created with two immutable hazards, distinct reviewer, both hazards OPEN, covered 0/2. |
| `02_h1_safety_gap.png` | Weak H1 mitigation classified `SAFETY_GAP`; H1 stays OPEN; cycle/lifetime become 1/5 and 1/15. |
| `03_h1_pending_countersignature.png` | Strong H1 mitigation reaches `PENDING_COUNTERSIGNATURE`; semantic sufficiency alone does not create coverage. |
| `04_owner_countersign_refused_explorer.png` | Owner calls reviewer-only `countersign_mitigation`; consensus is Accepted but GenVM execution is ERROR/Rollback with `Only the reviewer may countersign`. |
| `05_refusal_state_unchanged.png` | After the refused owner countersign, H1 remains PENDING and covered stays 0/2; no false-green postcondition. |
| `06_h1_reviewer_countersigned.png` | Authenticated reviewer countersigns H1; H1 becomes COVERED and total coverage becomes 1/2. |
| `07_h2_cycle_exhausted_5_of_5.png` | H2 remains OPEN after five GAP classifications; cycle reaches 5/5, lifetime 5/15. |
| `08_h2_reopened_cycle_0_lifetime_5.png` | Reviewer `reopen_attempts` resets only the cycle to 0/5 while lifetime remains 5/15. |
| `09_h2_recovery_pending_lifetime_6.png` | Fresh post-reopen mitigation reaches PENDING; cycle 1/5 and lifetime 6/15 prove liveness without resetting lifetime. |
| `10_two_of_two_covered_pre_release.png` | Reviewer countersigns H2; both hazards are COVERED, 2/2, before release readiness is declared. |
| `11_release_ready_first_time.png` | Deterministic release gate becomes READY only after 2/2 coverage. |
| `12_challenge_closes_release_gate.png` | Reviewer challenge changes H2 COVERED→OPEN, coverage 2/2→1/2, and closes the previously READY release gate. |
| `13_post_challenge_recovery_pending.png` | Fresh post-challenge mitigation reaches PENDING; lifetime increases to 7/15. |
| `14_post_challenge_two_of_two_covered.png` | Reviewer countersigns the recovered H2; system returns to 2/2 COVERED. |
| `15_final_release_ready.png` | Owner declares release readiness again; final end-state is READY with both hazards COVERED. |
| `16_append_only_audit_trail.png` | Attempt history remains ordered and append-only across GAPs, reopen, challenge and recovery; Challenge #1 is retained. |
| `17_source_parity_honest_scope.png` | Live UI shows exact deployed address, frozen SHA, v2.0 schema, and honest scope: digest binding is not contract-side evidence verification. |

## Load-bearing runtime conclusions

- `MITIGATION_SUFFICIENT` creates only `PENDING_COUNTERSIGNATURE`; it cannot cover a hazard by itself.
- Reviewer role enforcement is on-chain and survives consensus finality: an owner countersign attempt finalizes with GenVM rollback and leaves state unchanged.
- Retry cycles are bounded at 5 semantic classifications; reviewer reopen restores liveness while preserving the 15-classification lifetime ceiling.
- Reviewer challenge is non-bypassable with respect to release readiness: challenging a covered hazard immediately reduces coverage and forces `release_ready=false`.
- Recovery after both reopen and challenge is demonstrated with fresh text/evidence identities.
- Per-hazard history remains append-only across cycle resets.
- Final live state for System #1 is 2/2 COVERED and release READY.
