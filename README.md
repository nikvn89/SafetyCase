# SafetyCase

**Consensus-gated hazard coverage on GenLayer.**

SafetyCase lets a system owner commit an immutable set of declared hazards, submit one mitigation at a time for GenLayer semantic review, and cross a deterministic release-readiness gate only after every declared hazard is covered.

## Project identity

- **Project / dApp:** SafetyCase
- **Intelligent Contract implementation:** `SafetyCaseGate`
- **Public contract file:** `contracts/SafetyCase.py`
- **Contract version:** `1.2`
- **Network:** StudioNet `61999`
- **dApp:** https://safety-case-bice.vercel.app/
- **GitHub:** https://github.com/nikvn89/SafetyCase

### Clean project deployment

`0x463e2c0FEc2AD2251C7625B1C15d61E004395c09`

Explorer:
https://explorer-studio.genlayer.com/address/0x463e2c0FEc2AD2251C7625B1C15d61E004395c09

This deployment is reserved for the public project and was left clean after deployment (`system_count = 0`).

### Runtime evidence deployment

`0xf1FBdC8FA38adEaf2b34c897afe8a3168fc0E6ED`

Explorer:
https://explorer-studio.genlayer.com/address/0xf1FBdC8FA38adEaf2b34c897afe8a3168fc0E6ED

### Frozen source

SHA256:

`386a5f54a141c7a6010bd057308d1895aa2c8083d0f89348f41cb52f2f62edc1`

The clean project deployment, runtime evidence deployment, and `contracts/SafetyCase.py` use the same frozen R2 contract source.

## Core model

SafetyCase separates semantic judgment from deterministic consequence:

1. The creator freezes a complete hazard set at system creation.
2. One semantic transaction evaluates exactly one committed `HAZARD + MITIGATION` pair.
3. Validators may return only `MITIGATION_SUFFICIENT` or `SAFETY_GAP`.
4. A sufficient mitigation irreversibly latches that hazard to `COVERED`; a gap remains `OPEN` and is preserved in append-only history.
5. Release readiness is deterministic and can be declared only when:

```text
covered_count == required_hazard_count
```

`mark_release_ready()` does not invoke semantic judgment.

## Authorization and replay protection

```text
create_system       permissionless
submit_mitigation   system owner only
mark_release_ready  permissionless after full coverage
```

Submitting the exact same mitigation text for the same system/hazard is a deterministic no-op before semantic evaluation, so the same attempt cannot be rerolled for a different verdict or counter increase.

A covered hazard is a one-way latch. Once the system reaches `release_ready = true`, further mitigation submissions are rejected.

## R2 runtime evidence

The recorded StudioNet run used a two-hazard warehouse safety case and demonstrated:

- fresh `get_config()` profile at version `1.2`;
- immutable two-hazard system creation;
- a weak H1 mitigation producing `SAFETY_GAP` while H1 remained `OPEN`;
- exact mitigation replay with no new mitigation record or counter increment;
- a preventive H1 mitigation producing `MITIGATION_SUFFICIENT` and `1/2` coverage;
- premature `mark_release_ready(1)` producing execution `ERROR` / rollback while `release_ready` remained `false`;
- a preventive H2 mitigation producing full `2/2` coverage while release readiness was still not automatically declared;
- deterministic `mark_release_ready(1)` success only at full coverage;
- terminal protection rejecting a new mitigation after `release_ready = true` with no state change.

Final observed System #1 state on the runtime evidence deployment:

```text
required_hazard_count = 2
covered_count = 2
open_count = 0
gap_attempts = 1
mitigation_count = 3
all_hazards_covered = true
release_ready = true
```

The runtime also directly demonstrated that consensus status such as `ACCEPTED` is not treated as execution success: premature release and post-release mitigation calls reached consensus but had execution result `ERROR` and rolled back.

## Semantic failure handling

R2 does not coerce malformed model output into a safety verdict. The model-facing response must contain exactly one field with one of the two valid verdicts. Non-dict output, missing/extra fields, or unknown verdicts are rejected before mitigation/history/counter writes. Provider/runtime failures and non-convergence are likewise not converted into semantic success.

These malformed/provider/non-convergence properties are source-path guarantees; the recorded runtime run did not add artificial production hooks solely to force those failures.

## dApp behavior

The frontend provides three views:

```text
Overview
Hazards
History
```

Reliability choices include:

- StudioNet reads through same-origin `/genlayer-rpc`;
- MetaMask for writes;
- post-state confirmation instead of treating submission/finalization labels as success;
- schema validation for `SafetyCaseGate v1.2` before writes;
- exact recent mitigation replay detection before prompting the wallet;
- owner-only mitigation controls;
- a clean creation form with no preloaded demo hazards or mitigation presets;
- live display of project deployment, runtime evidence deployment, and frozen source hash.

## Honest scope

SafetyCase proves deterministic coverage only over the immutable hazard set the creator **declared onchain**. It does not prove that the hazard list is complete, that a mitigation was implemented in the real world, that external evidence is authentic, or that the broader system is globally safe.

`READINESS DECLARED` therefore means only that every declared hazard received sufficient consensus-reviewed mitigation coverage and the deterministic coverage equality was satisfied.

## Local development

```bash
npm install
npm test
npm run build
npm run dev
```

The frontend defaults to the clean project deployment in `src/config.ts`. An optional valid `VITE_CONTRACT_ADDRESS` can override the project address for local development.

## Repository structure

```text
contracts/SafetyCase.py   Frozen Intelligent Contract source
public/                   SafetyCase + GenLayer branding assets
src/                      React / TypeScript frontend
tests/                    Frontend regression tests
README.md                 Project overview
TESTING.md                Runtime evidence and verification path
```
