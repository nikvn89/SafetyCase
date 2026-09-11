// Regression test for FE-1: absolute (non-delta) postconditions report success
// for transactions the contract refused.
//
// Run: node tests/postcondition.test.mjs
//
// This harness reimplements waitForStateChange exactly as src/genlayer.ts does,
// then drives the isDone predicates taken verbatim from src/App.tsx against a
// fake chain whose state DOES NOT CHANGE (which is what happens when the
// contract reverts: writeContract still returns a hash, execution fails
// on-chain, finalized state is untouched).

let pass = 0, fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${name}`) }
  else { fail++; console.error(`FAIL  ${name}  ${detail}`) }
}

// --- copy of waitForStateChange (src/genlayer.ts:58) -----------------------
async function waitForStateChange({ read, isDone, intervalMs = 1, timeoutMs = 20 }) {
  const startedAt = Date.now()
  let lastValue
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await read()
      lastValue = value
      if (isDone(value)) return { status: 'confirmed', value }
    } catch { /* transient */ }
    const remaining = timeoutMs - (Date.now() - startedAt)
    if (remaining <= 0) break
    await new Promise((r) => setTimeout(r, Math.min(intervalMs, remaining)))
  }
  return { status: 'pending', ...(lastValue === undefined ? {} : { lastValue }) }
}

const frozen = (state) => () => Promise.resolve({ ...state })

// =========================================================================
// CURRENT predicates, verbatim from src/App.tsx
// =========================================================================
const CURRENT = {
  // App.tsx:338  handleCountersign
  countersign: () => (value) => value.status === 'COVERED',
  // App.tsx:376  handleReopen   (lifetime captured from React state before write)
  reopen: (before) => (value) =>
    value.attempt_count === 0 && value.lifetime_attempt_count === before.lifetime_attempt_count,
  // App.tsx:392  handleRelease
  release: () => (value) => value.release_ready,
  // App.tsx:311  handleMitigate  (delta - correct)
  mitigate: (before) => (value) => value.lifetime_attempt_count > before.lifetime_attempt_count,
  // App.tsx:356  handleChallenge (delta - correct)
  challenge: (before) => (value) =>
    value.challenge_count > before.challenge_count && !value.release_ready,
}

// =========================================================================
// PATCHED predicates: every one requires an observed transition
// =========================================================================
const PATCHED = {
  countersign: (before) => (value) =>
    value.status === 'COVERED' && value.covered_by !== before.covered_by,
  reopen: (before) => (value) =>
    value.attempt_count === 0 &&
    before.attempt_count !== 0 &&
    value.lifetime_attempt_count === before.lifetime_attempt_count,
  release: (before) => (value) => value.release_ready && !before.release_ready,
  mitigate: CURRENT.mitigate,
  challenge: CURRENT.challenge,
}

// =========================================================================
// Refused-transaction states: the chain rejected the call, state is unchanged
// =========================================================================
const REFUSED = {
  // owner/outsider clicks Countersign on a hazard the reviewer already covered
  // -> contract: "No mitigation is awaiting countersignature" / role refusal
  countersign: { status: 'COVERED', covered_by: 7, attempt_count: 2, lifetime_attempt_count: 2 },
  // anyone clicks Reopen when the cycle is not exhausted (e.g. right after a
  // successful reopen) -> contract: "Attempt cycle is not exhausted"
  reopen: { status: 'OPEN', covered_by: 0, attempt_count: 0, lifetime_attempt_count: 5 },
  // second click on Mark release ready -> contract: "System is already release-ready"
  release: { release_ready: true, challenge_count: 0, covered_count: 2, required_hazard_count: 2 },
  // owner resubmits an exact replay -> contract: "already attempted"
  mitigate: { status: 'OPEN', attempt_count: 3, lifetime_attempt_count: 3 },
  // owner clicks Challenge (reviewer-only) -> role refusal
  challenge: { release_ready: false, challenge_count: 1 },
}

console.log('--- CURRENT predicates against a REFUSED (unchanged) chain state ---')
const currentResults = {}
for (const key of Object.keys(REFUSED)) {
  const before = REFUSED[key]
  const r = await waitForStateChange({ read: frozen(before), isDone: CURRENT[key](before) })
  currentResults[key] = r.status
  console.log(`      ${key.padEnd(12)} -> ${r.status}${r.status === 'confirmed' ? '   <-- FALSE SUCCESS' : ''}`)
}

check('BUG REPRODUCED: countersign reports success for a refused tx',
  currentResults.countersign === 'confirmed')
check('BUG REPRODUCED: reopen reports success for a refused tx',
  currentResults.reopen === 'confirmed')
check('BUG REPRODUCED: release reports success for a refused tx',
  currentResults.release === 'confirmed')
check('mitigate is already delta-safe', currentResults.mitigate === 'pending')
check('challenge is already delta-safe', currentResults.challenge === 'pending')

console.log('\n--- PATCHED predicates against the same REFUSED states ---')
for (const key of Object.keys(REFUSED)) {
  const before = REFUSED[key]
  const r = await waitForStateChange({ read: frozen(before), isDone: PATCHED[key](before) })
  console.log(`      ${key.padEnd(12)} -> ${r.status}`)
  check(`patched ${key} does NOT report success for a refused tx`, r.status === 'pending')
}

// =========================================================================
// No-regression: the patched predicates must still confirm real successes
// =========================================================================
console.log('\n--- PATCHED predicates against a SUCCEEDED chain state ---')
const SUCCEEDED = [
  ['countersign',
    { status: 'PENDING_COUNTERSIGNATURE', covered_by: 0, attempt_count: 2, lifetime_attempt_count: 2 },
    { status: 'COVERED', covered_by: 9, attempt_count: 2, lifetime_attempt_count: 2 }],
  ['reopen',
    { status: 'OPEN', covered_by: 0, attempt_count: 5, lifetime_attempt_count: 5 },
    { status: 'OPEN', covered_by: 0, attempt_count: 0, lifetime_attempt_count: 5 }],
  ['release',
    { release_ready: false, challenge_count: 0 },
    { release_ready: true, challenge_count: 0 }],
  ['mitigate',
    { status: 'OPEN', attempt_count: 3, lifetime_attempt_count: 3 },
    { status: 'OPEN', attempt_count: 4, lifetime_attempt_count: 4 }],
  ['challenge',
    { release_ready: true, challenge_count: 1 },
    { release_ready: false, challenge_count: 2 }],
]
for (const [key, before, after] of SUCCEEDED) {
  const r = await waitForStateChange({ read: frozen(after), isDone: PATCHED[key](before) })
  console.log(`      ${key.padEnd(12)} -> ${r.status}`)
  check(`patched ${key} still confirms a real success`, r.status === 'confirmed')
}

// =========================================================================
// Stale-baseline probe: the patched predicates must read `before` FRESH.
// If `before` comes from React state that is one transaction old, a delta
// predicate can also fire on pre-existing state.
// =========================================================================
console.log('\n--- stale-baseline hazard (why `before` must be a fresh read) ---')
const staleBefore = { status: 'OPEN', attempt_count: 1, lifetime_attempt_count: 1 }
const actualNow  = { status: 'OPEN', attempt_count: 3, lifetime_attempt_count: 3 }
const r = await waitForStateChange({ read: frozen(actualNow), isDone: CURRENT.mitigate(staleBefore) })
console.log(`      mitigate with a 2-attempt-stale baseline -> ${r.status}`)
check('stale React baseline can confirm without any new transaction',
  r.status === 'confirmed')

console.log(`\nTOTAL: ${pass + fail} checks, ${fail} failed`)
process.exit(fail ? 1 : 0)
