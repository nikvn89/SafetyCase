# SafetyCase Frontend — Planned Test Matrix

This file is a plan, not runtime evidence.

## Local bootstrap

```text
1. npm install
2. npm test
3. npm run build
4. npm run dev
```

## Empty-registry behavior

If `get_config().system_count == 0`:

```text
PASS if:
- shell and live config render;
- no invalid get_system(1) call is required;
- Fresh safety case is usable;
- no RPC error banner appears merely because no system exists.
```

## Existing-system read

Load a valid system id.

```text
PASS if:
- purpose, owner and counters match get_system;
- hazards match get_hazards;
- mitigation history matches get_system_mitigations;
- localStorage restores only a valid id for this exact contract address.
```

## Create flow / concurrency

Create a fresh demo.

```text
PASS if:
- one MetaMask write prompt appears;
- no receipt polling occurs;
- app resolves the created system by:
  owner + exact purpose + exact hazard text list;
- it does not blindly load global system_count;
- a timeout is neutral and does not claim failure after submission.
```

## Owner-only mitigation

With non-owner wallet:

```text
PASS if submit button is disabled and UI explains owner-only rule.
```

With owner wallet:

```text
PASS if:
- OPEN hazard accepts one mitigation submission;
- pending button blocks double-submit;
- app waits for hazard attempt_count/status change;
- verdict/state refreshes after finalization.
```

## Covered latch

```text
PASS if a COVERED hazard disables further mitigation submission.
```

## Exact replay

Repeat the exact same recent mitigation.

```text
PASS if frontend blocks before MetaMask and explains deterministic no-op.
```

If an old replay is not found in the recent 50-attempt window:

```text
PASS if timeout text stays neutral:
"may still be finalizing, or exact replay".
```

## Release gate

Before all hazards are covered:

```text
PASS if UI blocks mark_release_ready and shows remaining OPEN count.
```

After `all_hazards_covered == true`:

```text
PASS if any connected wallet can invoke mark_release_ready.
```

After `release_ready == true`:

```text
PASS if button becomes idempotent/disabled.
```

## Vercel

```text
- contract pill must show 0xFbF0...Edd8e, never "—";
- `/genlayer-rpc` reads must work;
- blank VITE_CONTRACT_ADDRESS must still fall back safely;
- refresh/F5 must preserve valid active system;
- MetaMask write flow must not use direct StudioNet receipt polling.
```

## Review-fix regression checks

### Schema guard
Point the app at an incompatible/older deployment.

```text
PASS if:
- app shows a clear SafetyCaseGate v1.1 schema error;
- create / mitigation / release writes remain disabled;
- no undefined/NaN coverage state is treated as valid.
```

### Fresh create baseline
Before `create_system`, app must call fresh `get_config()` and use that
`system_count` as the scan baseline.

### Scan ceiling
`waitForCreatedSystem` must inspect at most 50 ids after that fresh baseline.

### Wrong wallet network
Change MetaMask away from StudioNet after connecting.

```text
PASS if:
- reads continue through the proxy;
- a visible warning appears;
- Switch to StudioNet works;
- every write still runs ensureStudioChain().
```

### Honest scope
At 100% coverage and after readiness declaration, the gate card must still state
that declared hazards may be incomplete and implementation is not proven.
