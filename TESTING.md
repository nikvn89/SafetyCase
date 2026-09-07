# SafetyCase — Testing & Runtime Evidence

This document separates the clean public project deployment from the deployment used for load-bearing runtime validation.

## Frozen source identity

```text
Project:                 SafetyCase
Implementation:          SafetyCaseGate
Public contract file:    contracts/SafetyCase.py
Version:                 1.2
Network:                 StudioNet 61999
Frozen SHA256:           386a5f54a141c7a6010bd057308d1895aa2c8083d0f89348f41cb52f2f62edc1
```

## Deployments

### Clean project deployment

```text
0x463e2c0FEc2AD2251C7625B1C15d61E004395c09
```

Explorer:
https://explorer-studio.genlayer.com/address/0x463e2c0FEc2AD2251C7625B1C15d61E004395c09

Observed after deployment:

```text
name = SafetyCaseGate
version = 1.2
system_count = 0
```

Do not use this address for the historical runtime walkthrough; it is intentionally kept clean for the public project.

### Runtime evidence deployment

```text
0xf1FBdC8FA38adEaf2b34c897afe8a3168fc0E6ED
```

Explorer:
https://explorer-studio.genlayer.com/address/0xf1FBdC8FA38adEaf2b34c897afe8a3168fc0E6ED

## R2 load-bearing runtime validation

### T0 — Fresh configuration

`get_config()` observed the R2 profile:

```text
name = SafetyCaseGate
version = 1.2
min_hazards = 2
max_hazards = 8
coverage_gate = covered_count == required_hazard_count
prompt_inputs = HAZARD, MITIGATION
system_purpose_enters_prompt = false
global_admin = false
clock_used = false
system_count = 0
mitigation_count = 0
```

**PASS**

### T1 — Create immutable two-hazard system

Purpose:

```text
Warehouse safety release gate.
```

Hazards:

```text
H1: A warehouse conveyor can restart while the physical guard door is open.
H2: A pallet with an out-of-tolerance component can leave the dispatch bay.
```

Initial System #1:

```text
required_hazard_count = 2
covered_count = 0
open_count = 2
gap_attempts = 0
mitigation_count = 0
all_hazards_covered = false
release_ready = false
```

**PASS**

### T2 — Weak mitigation remains SAFETY_GAP

H1 mitigation:

```text
Every restart while the guard door is open is written to the safety event log and reported to the shift supervisor.
```

Observed:

```text
covered_count = 0
open_count = 2
gap_attempts = 1
mitigation_count = 1
release_ready = false
```

H1 remained `OPEN`.

**PASS**

### T3 — Exact mitigation replay is a no-op

Submitted the exact same H1 mitigation again.

Observed state remained:

```text
covered_count = 0
open_count = 2
gap_attempts = 1
mitigation_count = 1
release_ready = false
```

No new mitigation record/counter was created.

**PASS**

### T4 — Preventive H1 mitigation covers the hazard

Submitted:

```text
A hardwired interlock removes motor-enable power whenever the guard-door switch is open, and the conveyor cannot restart until the guard is closed.
```

Observed:

```text
covered_count = 1
open_count = 1
gap_attempts = 1
mitigation_count = 2
release_ready = false
```

**PASS**

### T5 — Early release rolls back with no write

Called:

```text
mark_release_ready(1)
```

at `1/2` coverage.

Observed transaction:

```text
Consensus status: ACCEPTED
Execution result: ERROR
[rollback] All declared hazards must be COVERED before release
```

Post-state remained:

```text
covered_count = 1
open_count = 1
gap_attempts = 1
mitigation_count = 2
release_ready = false
```

This directly demonstrates that `ACCEPTED` is not equivalent to execution success.

**PASS**

### T6 — Preventive H2 mitigation completes coverage

Submitted:

```text
Every pallet is measured at the dispatch gate, and any pallet outside tolerance is automatically diverted to a quarantine lane with no route to the dispatch bay.
```

Observed before final declaration:

```text
required_hazard_count = 2
covered_count = 2
open_count = 0
gap_attempts = 1
mitigation_count = 3
all_hazards_covered = true
release_ready = false
```

Full coverage does not automatically set release readiness.

**PASS**

### T7 — Deterministic release succeeds at full coverage

Called:

```text
mark_release_ready(1)
```

Final observed state:

```text
required_hazard_count = 2
covered_count = 2
open_count = 0
gap_attempts = 1
mitigation_count = 3
all_hazards_covered = true
release_ready = true
```

**PASS**

### T8 — Terminal release-ready protection

After `release_ready = true`, attempted a different mitigation for H1:

```text
The operator performs an additional manual visual inspection before every conveyor restart.
```

Observed:

```text
Consensus status: ACCEPTED
Execution result: ERROR
[rollback] System is already release-ready
```

Post-state remained unchanged at `2/2`, `mitigation_count = 3`, `release_ready = true`.

**PASS**

## Source-path audit — malformed/provider/non-convergence

The R2 source accepts only an exact semantic response containing one `verdict` field with one of:

```text
MITIGATION_SUFFICIENT
SAFETY_GAP
```

Source inspection confirms:

```text
provider/runtime exception
-> propagates; no semantic verdict

non-dict / missing field / extra field / unknown verdict
-> invalid sentinel
-> validator rejection / invalid consensus result
-> error before mitigation/history/counter writes

non-convergence
-> no semantic success
-> no consequential write
```

These are source-path guarantees and are not presented as runtime-triggered evidence.

## Public dApp verification after deployment

Production URL:

```text
https://safety-case-bice.vercel.app/
```

After deploying this exact project package, verify the following without writing to the clean project address:

```text
StudioNet 61999 visible
Project deployment = 0x463e...5c09
Runtime evidence = 0xf1FB...E6ED
Frozen source = 386a5f54...f2f62edc1
Live config version = 1.2
system_count = 0 on clean deployment
creation form contains no preloaded demo values
no undefined/NaN state
```

For a new user walkthrough, create a separate stateful system only if submission review requires reproduction. The recorded runtime evidence above remains on the dedicated evidence deployment.

## Scope note

A successful SafetyCase run proves coverage only for the hazards declared onchain. It does not prove that the declared list is complete, that accepted mitigations are implemented in the real world, or that the broader system is globally safe.
