# SafetyCase — GenLayer dApp frontend

SafetyCase is the public dApp for the deployed `SafetyCaseGate v1.1`
Intelligent Contract.

## Canonical contract

```text
0xFbF0a1890e8dAe6907B4DBC9Fbb023A3d13Edd8e
```

Explorer:

```text
https://explorer-studio.genlayer.com/address/0xFbF0a1890e8dAe6907B4DBC9Fbb023A3d13Edd8e
```

Packaged contract SHA-256:

```text
baeffd4d218ac4075de788a544c70b62ba117514a754ac4f83f8c8d5312f184a
```

## Honest limitation

SafetyCase proves coverage only over the immutable hazard set the creator
**declared onchain**.

It does **not** prove:

```text
- that the declared hazard list is complete;
- that the system is safe in the real world;
- that a proposed mitigation has actually been implemented;
- that external operation matches the submitted text.
```

A `READINESS DECLARED` state therefore means only that every **declared**
hazard received sufficient consensus-reviewed mitigation coverage and the
deterministic coverage equality was satisfied.

## Product flow

```text
Create immutable hazard set
→ review one hazard + one mitigation with GenLayer consensus
→ hazard becomes COVERED or remains OPEN
→ repeat until covered_count == required_hazard_count
→ permissionless deterministic mark_release_ready
```

## UI structure

```text
Overview
Hazards
History
```

The frontend intentionally avoids a long single-page flow.

## Reliability choices

- StudioNet reads go through same-origin `/genlayer-rpc`.
- Writes use MetaMask.
- The browser does **not** poll transaction receipts.
- Writes are confirmed through observable contract-state transitions.
- Buttons are disabled while a write is pending to prevent double-submit.
- New-system resolution does not trust the latest global id; it scans newly
  created ids and matches `owner + exact purpose + exact immutable hazard set`.
- Empty deployments are handled without calling invalid system ids.
- `VITE_CONTRACT_ADDRESS` is validated; blank/invalid env values fall back to
  the canonical deployment.
- localStorage is namespaced by contract address.
- Mitigation UI is owner-only, matching the contract.
- `mark_release_ready` is shown as permissionless but disabled until the
  deterministic coverage equality is true.
- Exact mitigation replay is preflight-detected from recent onchain history;
  if no state change is observed, the timeout message explicitly warns that
  the submission may have been an exact replay.

## Development

```bash
npm install
npm test
npm run build
npm run dev
```

## Vercel

`vercel.json` proxies:

```text
/genlayer-rpc
→ https://studio.genlayer.com/api
```

Optional environment variable:

```text
VITE_CONTRACT_ADDRESS=0xFbF0a1890e8dAe6907B4DBC9Fbb023A3d13Edd8e
```

## Review status

This package is intentionally **pre-publication**. The included
`CLAUDE_FRONTEND_REVIEW.md` asks for an adversarial review of contract/frontend
signature parity, RPC behavior, concurrency, owner authorization, state polling,
replay UX, and deployment configuration.

Do not treat the frontend as production-verified until local + Vercel testing
has been completed.

## Pre-review static checks

See `PRE_REVIEW_CHECKS.md`.

Current local/static result:

```text
TypeScript source syntax transpile: PASS
Error normalizer regression suite: 58/58 PASS
Full dependency-resolved build: still to be verified
```

## Claude frontend review fixes applied

```text
HIGH 1    Fixed — honest limitation is always visible in gate UI and README.
HIGH 2    Fixed — runtime v1.1 schema guard; incompatible deployments disable writes.
MEDIUM 1  Fixed — fresh get_config() is read immediately before create_system.
MEDIUM 2  Fixed — created-id scan is capped at 50 ids.
MEDIUM 3  Fixed — >50-attempt replay-window limitation is disclosed.
MEDIUM 4  Fixed — wrong MetaMask chain is surfaced with a StudioNet switch action.
LOW 3     Polished — READY wording changed to READINESS DECLARED / DECLARED.
```

Remaining MUST-VERIFY before public Vercel:

```text
- canonical 0xFbF0...Edd8e deployment exposes the expected v1.1 source/schema;
- detect-then-block regression is repeated on that canonical deployment;
- production /genlayer-rpc rewrite is verified in browser Network tools.
```
