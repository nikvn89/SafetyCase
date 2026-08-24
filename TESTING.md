# SafetyCase — Testing & Runtime Evidence

This document separates **observed runtime evidence** from additional regression checks. It does not claim PASS for behavior that was not observed.

## Canonical deployment

```text
Contract: 0xFbF0a1890e8dAe6907B4DBC9Fbb023A3d13Edd8e
Network: StudioNet 61999
Version: 1.1
Live dApp: https://safety-case-bice.vercel.app/
Explorer: https://explorer-studio.genlayer.com/address/0xFbF0a1890e8dAe6907B4DBC9Fbb023A3d13Edd8e
```

## Local bootstrap

```bash
npm install
npm test
npm run build
npm run dev
```

## Observed browser flow — System #1

### TX1 — Create safety case

Purpose:

```text
Autonomous treasury agent safety case - e894d20f
```

Hazards:

```text
H1: The agent can send an irreversible payment to the wrong recipient.
H2: The agent can write an API key into diagnostic logs.
```

Observed after finalization:

```text
System #1
required hazards: 2
covered: 0
open: 2
mitigation attempts: 0
release: not declared
```

**Result: PASS**

The frontend resolved the newly created system by owner + purpose + exact hazard set and loaded the correct workspace.

### TX2 — Weak mitigation for H1

Submitted mitigation:

```text
Record every payment in an audit log after the transfer is completed and notify an operator for later review.
```

Observed verdict/state:

```text
SAFETY_GAP
H1: OPEN
H1 attempts: 1
covered: 0/2
history: 1
```

**Result: PASS**

The mitigation only records/reviews the payment after execution, so it does not prevent the stated hazard.

### TX3 — Strong mitigation for H1

Submitted mitigation:

```text
Before any irreversible payment is executed, the recipient address must match an approved allowlist entry and the payment must receive a second independent authorization. If either check fails, the transfer is blocked before execution.
```

Observed verdict/state:

```text
MITIGATION_SUFFICIENT
H1: COVERED
H1 attempts: 2
covered: 1/2
history: 2
```

**Result: PASS**

### TX4 — Strong mitigation for H2

Submitted mitigation:

```text
Before diagnostic logging occurs, all API keys and other secrets are detected and redacted from log output. Any log entry containing an unredacted secret is blocked from being written.
```

Observed verdict/state:

```text
MITIGATION_SUFFICIENT
H2: COVERED
H2 attempts: 1
covered: 2/2
open: 0
history: 3
```

**Result: PASS**

### TX5 — Declare release readiness

Before TX5, the deterministic gate showed:

```text
2/2 covered
0 open
GATE OPEN
```

After `mark_release_ready(1)` finalized:

```text
READINESS DECLARED
Release: DECLARED
2/2 covered
0 open
3 mitigation attempts
```

**Result: PASS**

## Final append-only history

Observed history for System #1:

```text
#1 H1 -> SAFETY_GAP
#2 H1 -> MITIGATION_SUFFICIENT
#3 H2 -> MITIGATION_SUFFICIENT
```

The earlier failed H1 attempt remains visible after H1 is later covered.

**Result: PASS**

## Live Vercel verification

The production deployment at:

```text
https://safety-case-bice.vercel.app/
```

was checked against the same canonical StudioNet contract.

Observed:

```text
MetaMask connection on StudioNet: PASS
Live config version 1.1: PASS
Contract address 0xFbF0...Edd8e: PASS
Registry read: 1 system onchain
Load System #1: PASS
Overview final state: 2/2 + READINESS DECLARED
Hazards: H1 COVERED, H2 COVERED
History: 3 append-only attempts
No undefined/NaN state observed
```

No extra production write transaction was needed: the full write flow above had already been executed against the same canonical StudioNet contract through the local frontend.

## Frontend behavior verified during the flow

Observed through the successful flow:

- MetaMask writes completed and state refreshed after finalization.
- No duplicate write was required.
- The app loaded the exact created System #1.
- Covered hazards disabled further mitigation submission.
- Release remained unavailable until 100% declared-hazard coverage.
- `READINESS DECLARED` wording remained distinct from a real-world safety claim.
- The live deployment could read StudioNet through `/genlayer-rpc`.

## Additional regression checks

These remain useful when changing frontend or contract code:

### Wrong-chain handling

Switch MetaMask away from StudioNet.

Expected:

```text
visible wrong-chain warning
Switch to StudioNet action available
writes call ensureStudioChain()
```

### Exact replay

Repeat an exact recent mitigation.

Expected:

```text
frontend detects recent replay before MetaMask
contract-level exact replay remains a no-op
```

### Incompatible schema

Point the frontend at an older/incompatible deployment.

Expected:

```text
clear v1.1 schema error
writes disabled
no undefined/NaN state treated as valid
```

## Scope note

A successful SafetyCase run proves coverage only for the hazards declared onchain. It does not prove that the declared list is complete or that accepted mitigations were implemented in the real world.
