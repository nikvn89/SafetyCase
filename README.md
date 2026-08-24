# SafetyCase

**Consensus-gated hazard coverage on GenLayer.**

SafetyCase lets a system owner declare an immutable set of hazards, submit one mitigation at a time for GenLayer semantic review, and cross a deterministic release-readiness gate only after every declared hazard is covered.

## Live deployment

- **dApp:** https://safety-case-bice.vercel.app/
- **GitHub:** https://github.com/nikvn89/SafetyCase
- **StudioNet contract:** `0xFbF0a1890e8dAe6907B4DBC9Fbb023A3d13Edd8e`
- **Explorer:** https://explorer-studio.genlayer.com/address/0xFbF0a1890e8dAe6907B4DBC9Fbb023A3d13Edd8e
- **Contract version:** `1.1`
- **Packaged contract SHA-256:** `baeffd4d218ac4075de788a544c70b62ba117514a754ac4f83f8c8d5312f184a`

## Problem

A normal smart contract can count hazards and enforce a release gate, but it cannot reliably decide whether free-form mitigation text actually prevents or sufficiently constrains a specific hazard.

SafetyCase splits the problem into two layers:

1. **GenLayer semantic consensus** classifies a proposed mitigation against one exact hazard.
2. **Deterministic contract logic** records the result, latches covered hazards, counts coverage, and allows readiness to be declared only when the declared hazard set reaches 100% coverage.

## Semantic verdicts

The consensus surface is intentionally narrow:

```text
MITIGATION_SUFFICIENT
SAFETY_GAP
```

A sufficient mitigation irreversibly covers the selected hazard. A safety gap is preserved in append-only history but leaves the hazard open.

## Deterministic consequence

```text
Create immutable hazard set
→ submit mitigation for one hazard
→ GenLayer verdict
→ update append-only attempt history
→ COVERED latch or remain OPEN
→ repeat until covered_count == required_hazard_count
→ mark_release_ready
```

`mark_release_ready` is deterministic and permissionless once the coverage equality is true.

## Multi-tenant design

SafetyCase is not tied to the deployer. Any user can create a fresh safety case with their own wallet and immutable hazard set. Mitigation writes remain owner-only for that safety case, while the final readiness declaration is permissionless after the deterministic gate opens.

## dApp

The frontend is organized into three compact views:

```text
Overview
Hazards
History
```

Key reliability choices:

- StudioNet reads use same-origin `/genlayer-rpc`.
- Writes use MetaMask.
- The browser does not rely on direct transaction-receipt polling.
- State transitions are used to confirm finalization.
- Write buttons are protected against double-submit.
- The frontend validates the expected v1.1 schema before enabling writes.
- `create_system` refreshes `get_config()` immediately before submission.
- Newly created systems are resolved by `owner + exact purpose + exact hazard list`, scanning at most 50 new IDs.
- Wrong-chain state is surfaced with a StudioNet switch action.
- Exact recent mitigation replay is detected before prompting MetaMask.

## Observed runtime evidence

A complete browser flow was executed against the canonical StudioNet contract using **System #1**.

| Step | Observed result |
| --- | --- |
| Create system with 2 hazards | `0/2` covered, `2` open |
| Weak H1 logging mitigation | `SAFETY_GAP`, H1 remained `OPEN` |
| Strong H1 payment-control mitigation | `MITIGATION_SUFFICIENT`, H1 became `COVERED` |
| Strong H2 secret-redaction mitigation | `MITIGATION_SUFFICIENT`, H2 became `COVERED` |
| Deterministic gate | `2/2` covered, `0` open |
| Declare readiness | `READINESS DECLARED` / `DECLARED` |

The final history contains 3 append-only mitigation attempts: 1 `SAFETY_GAP` and 2 `MITIGATION_SUFFICIENT` verdicts.

The Vercel deployment was also verified to connect MetaMask on StudioNet, load System #1, show both hazards as covered, render the 3-item history, and display the final declared-readiness state.

## Honest limitation

SafetyCase proves coverage only over the immutable hazard set the creator **declared onchain**.

It does **not** prove that:

- the declared hazard list is complete;
- the system is safe in the real world;
- an accepted mitigation has actually been implemented;
- real-world operation matches the submitted text.

`READINESS DECLARED` therefore means only that every **declared** hazard received sufficient consensus-reviewed mitigation coverage and the deterministic coverage equality was satisfied.

## Local development

```bash
npm install
npm test
npm run build
npm run dev
```

The app defaults to the canonical deployment through `.env.example`:

```text
VITE_CONTRACT_ADDRESS=0xFbF0a1890e8dAe6907B4DBC9Fbb023A3d13Edd8e
```

## Vercel proxy

`vercel.json` maps:

```text
/genlayer-rpc
→ https://studio.genlayer.com/api
```

This keeps frontend reads same-origin while MetaMask handles writes.

## Repository structure

```text
contracts/   GenLayer Intelligent Contract
public/      SafetyCase + GenLayer branding assets
src/         React / TypeScript frontend
tests/       Frontend regression tests
README.md    Project overview
TESTING.md   Reproducible test evidence
```
