import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CONTRACT_ADDRESS,
  EXPLORER_BASE,
  FROZEN_SOURCE_SHA256,
  MAX_SYSTEM_PURPOSE_LENGTH,
  ZERO_ADDRESS,
} from './config'
import {
  challengeCoverage,
  connectWallet,
  countersignMitigation,
  createSystem,
  ensureStudioChain,
  getChallenges,
  getConfig,
  getHazard,
  getHazardAttempts,
  getHazards,
  getSystem,
  getSystemMitigations,
  markReleaseReady,
  reopenAttempts,
  submitMitigation,
  waitForCreatedSystem,
  waitForStateChange,
} from './genlayer'
import { reportError } from './errors'
import type {
  Address,
  ChallengeRecord,
  GateConfig,
  HazardAttempt,
  HazardRecord,
  SystemMitigation,
  SystemRecord,
} from './types'

type Tab = 'overview' | 'create' | 'work' | 'audit' | 'verification'
type Banner = { kind: 'info' | 'success' | 'warning' | 'error'; message: string }

const LAST_SYSTEM_KEY = `safetycase:v2:last-system:${CONTRACT_ADDRESS.toLowerCase()}`
const addressPattern = /^0x[a-fA-F0-9]{40}$/

function shortAddress(value: string) {
  if (!value || value.length < 12) return value || '—'
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

function shortDigest(value: string) {
  if (!value) return '—'
  return value.length > 22 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value
}

function sameAddress(a?: string | null, b?: string | null) {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase())
}

function badgeClass(status: string) {
  if (status === 'COVERED' || status === 'MITIGATION_SUFFICIENT') return 'badge badge-good'
  if (status === 'PENDING_COUNTERSIGNATURE') return 'badge badge-pending'
  if (status === 'SAFETY_GAP') return 'badge badge-gap'
  return 'badge badge-open'
}

async function sha256File(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function App() {
  const [tab, setTab] = useState<Tab>('overview')
  const [account, setAccount] = useState<Address | null>(null)
  const [config, setConfig] = useState<GateConfig | null>(null)
  const [schemaOk, setSchemaOk] = useState(false)
  const [wrongChain, setWrongChain] = useState(false)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [busy, setBusy] = useState('')
  const mutationLock = useRef(false)

  const [systemInput, setSystemInput] = useState('')
  const [system, setSystem] = useState<SystemRecord | null>(null)
  const [hazards, setHazards] = useState<HazardRecord[]>([])
  const [history, setHistory] = useState<SystemMitigation[]>([])
  const [challenges, setChallenges] = useState<ChallengeRecord[]>([])

  const [purpose, setPurpose] = useState('')
  const [reviewer, setReviewer] = useState('')
  const [draftHazards, setDraftHazards] = useState<string[]>(['', ''])

  const [selectedHazard, setSelectedHazard] = useState(1)
  const [mitigationText, setMitigationText] = useState('')
  const [evidenceDigest, setEvidenceDigest] = useState('')
  const [challengeReason, setChallengeReason] = useState('')
  const [attempts, setAttempts] = useState<HazardAttempt[]>([])

  const contractHref = `${EXPLORER_BASE}/address/${CONTRACT_ADDRESS}`
  const selected = hazards.find((item) => item.hazard_index === selectedHazard) ?? null
  const isOwner = sameAddress(account, system?.owner)
  const isReviewer = sameAddress(account, system?.reviewer)

  const coveragePct = useMemo(() => {
    if (!system?.required_hazard_count) return 0
    return Math.round((system.covered_count / system.required_hazard_count) * 100)
  }, [system])

  const refreshConfig = useCallback(async () => {
    const next = await getConfig()
    setConfig(next)
    setSchemaOk(true)
    return next
  }, [])

  const loadSystem = useCallback(async (id: number, quiet = false) => {
    if (!Number.isInteger(id) || id <= 0) {
      if (!quiet) setBanner({ kind: 'warning', message: 'Enter a valid system id.' })
      return
    }
    try {
      const record = await getSystem(id)
      const [nextHazards, nextHistory, nextChallenges] = await Promise.all([
        getHazards(id, 1, record.required_hazard_count),
        record.mitigation_count > 0
          ? getSystemMitigations(id, Math.max(1, record.mitigation_count - 49), Math.min(50, record.mitigation_count))
          : Promise.resolve([]),
        record.challenge_count > 0
          ? getChallenges(id, Math.max(1, record.challenge_count - 49), Math.min(50, record.challenge_count))
          : Promise.resolve([]),
      ])
      setSystem(record)
      setSystemInput(String(id))
      setHazards(nextHazards)
      setHistory(nextHistory)
      setChallenges(nextChallenges)
      setSelectedHazard((current) =>
        nextHazards.some((item) => item.hazard_index === current)
          ? current
          : (nextHazards[0]?.hazard_index ?? 1),
      )
      window.localStorage.setItem(LAST_SYSTEM_KEY, String(id))
      if (!quiet) setBanner({ kind: 'info', message: `Loaded SafetyCase system #${id}.` })
    } catch (error) {
      if (!quiet) setBanner({ kind: 'error', message: reportError('load system', error) })
    }
  }, [])

  const refreshCurrent = useCallback(async () => {
    if (system?.system_id) await loadSystem(system.system_id, true)
  }, [loadSystem, system?.system_id])

  useEffect(() => {
    let active = true
    const boot = async () => {
      try {
        const next = await getConfig()
        if (!active) return
        setConfig(next)
        setSchemaOk(true)
        const saved = Number(window.localStorage.getItem(LAST_SYSTEM_KEY) ?? '0')
        if (Number.isInteger(saved) && saved > 0 && saved <= next.system_count) {
          await loadSystem(saved, true)
        }
      } catch (error) {
        if (active) {
          setSchemaOk(false)
          setBanner({ kind: 'error', message: reportError('verify v2 schema', error) })
        }
      }
    }
    void boot()
    return () => { active = false }
  }, [loadSystem])

  useEffect(() => {
    if (!window.ethereum?.on) return
    const onAccounts = (accounts: string[]) => setAccount((accounts?.[0] as Address | undefined) ?? null)
    const onChain = (chainIdHex: string) => setWrongChain(typeof chainIdHex === 'string' && chainIdHex.toLowerCase() !== '0xf22f')
    window.ethereum.on('accountsChanged', onAccounts)
    window.ethereum.on('chainChanged', onChain)
    return () => {
      window.ethereum?.removeListener?.('accountsChanged', onAccounts)
      window.ethereum?.removeListener?.('chainChanged', onChain)
    }
  }, [])

  useEffect(() => {
    const run = async () => {
      if (!system || !selected) {
        setAttempts([])
        return
      }
      if (selected.lifetime_attempt_count <= 0) {
        setAttempts([])
        return
      }
      try {
        const from = Math.max(1, selected.lifetime_attempt_count - 49)
        setAttempts(await getHazardAttempts(system.system_id, selected.hazard_index, from, selected.lifetime_attempt_count - from + 1))
      } catch {
        setAttempts([])
      }
    }
    void run()
  }, [system, selected])

  const runMutation = async (name: string, task: () => Promise<void>) => {
    if (mutationLock.current) {
      setBanner({ kind: 'warning', message: 'A transaction is already in progress. Wait for finalized-state verification.' })
      return
    }
    mutationLock.current = true
    setBusy(name)
    try {
      await task()
    } catch (error) {
      // Pre-read / setup failures happen outside each handler's own try block.
      // Without this catch they become unhandled rejections and the user sees
      // no banner at all.
      setBanner({ kind: 'error', message: reportError(name, error) })
    } finally {
      setBusy('')
      mutationLock.current = false
    }
  }

  const handleConnect = async () => {
    if (busy) return
    setBusy('connect')
    try {
      const result = await connectWallet()
      setAccount(result.address)
      try {
        const chain = (await window.ethereum?.request({ method: 'eth_chainId' })) as string | undefined
        setWrongChain(Boolean(chain && chain.toLowerCase() !== '0xf22f'))
      } catch {}
      setBanner({ kind: result.warning ? 'warning' : 'success', message: result.warning ?? `Connected ${shortAddress(result.address)} on StudioNet.` })
    } catch (error) {
      setBanner({ kind: 'error', message: reportError('connect wallet', error) })
    } finally {
      setBusy('')
    }
  }

  const handleSwitch = async () => {
    if (busy) return
    setBusy('switch')
    try {
      await ensureStudioChain()
      setWrongChain(false)
      setBanner({ kind: 'success', message: 'MetaMask switched to GenLayer StudioNet.' })
    } catch (error) {
      setBanner({ kind: 'error', message: reportError('switch network', error) })
    } finally {
      setBusy('')
    }
  }

  const createWarnings = useMemo(() => {
    const warnings: string[] = []
    const cleanHazards = draftHazards.map((x) => x.trim()).filter(Boolean)
    if (purpose.trim().length === 0) warnings.push('The contract will refuse an empty system purpose.')
    if (purpose.trim().length > MAX_SYSTEM_PURPOSE_LENGTH) warnings.push('The contract will refuse an over-length system purpose.')
    if (!addressPattern.test(reviewer.trim())) warnings.push('The contract will refuse an invalid reviewer address.')
    if (sameAddress(account, reviewer.trim())) warnings.push('The contract will refuse reviewer == owner.')
    if (reviewer.trim().toLowerCase() === ZERO_ADDRESS) warnings.push('The contract will refuse the zero reviewer address.')
    if (config && (cleanHazards.length < config.min_hazards || cleanHazards.length > config.max_hazards)) warnings.push(`The contract requires ${config.min_hazards}-${config.max_hazards} declared hazards.`)
    return warnings
  }, [account, config, draftHazards, purpose, reviewer])

  const actionWarnings = useMemo(() => {
    const warnings: string[] = []
    if (!system || !selected || !config) return warnings
    if (!isOwner) warnings.push('submit_mitigation: contract will refuse this wallet because it is not the owner.')
    if (system.release_ready) warnings.push('submit_mitigation: contract will refuse because release_ready is already true.')
    if (selected.status === 'COVERED') warnings.push('submit_mitigation: contract will refuse a COVERED hazard.')
    if (selected.status === 'PENDING_COUNTERSIGNATURE') warnings.push('submit_mitigation: contract will refuse while countersignature is pending.')
    if (selected.attempt_count >= config.max_attempts_per_hazard) warnings.push('submit_mitigation: cycle budget is exhausted; reviewer may reopen only while lifetime budget remains.')
    if (selected.lifetime_attempt_count >= config.max_lifetime_attempts_per_hazard) warnings.push('submit_mitigation: lifetime ceiling is exhausted permanently.')
    if (!/^(0x)?[0-9a-fA-F]{64}$/.test(evidenceDigest.trim())) warnings.push('submit_mitigation: contract will refuse unless evidence digest is exactly 32-byte SHA-256 hex.')
    if (!mitigationText.trim()) warnings.push('submit_mitigation: contract will refuse empty mitigation text.')
    return warnings
  }, [config, evidenceDigest, isOwner, mitigationText, selected, system])

  const handleCreate = () => void runMutation('create', async () => {
    if (!account || !schemaOk) return
    const cleanHazards = draftHazards.map((x) => x.trim()).filter(Boolean)
    const fresh = await refreshConfig()
    setBanner({ kind: 'info', message: 'Confirm create_system. Controls stay locked until the new v2 system is verified in finalized state.' })
    try {
      await createSystem(account, purpose.trim(), JSON.stringify(cleanHazards), reviewer.trim())
      const result = await waitForCreatedSystem(account, reviewer.trim(), purpose.trim(), cleanHazards, fresh.system_count)
      await refreshConfig()
      if (result.status === 'confirmed') {
        await loadSystem(result.value.system_id, true)
        setBanner({ kind: 'success', message: `System #${result.value.system_id} created with authenticated reviewer ${shortAddress(result.value.reviewer)}.` })
        setTab('work')
      } else {
        setBanner({ kind: 'warning', message: 'Transaction was submitted but the exact new system was not resolved before timeout. Load it after finalization.' })
      }
    } catch (error) {
      setBanner({ kind: 'error', message: reportError('create system', error) })
    }
  })

  const handleMitigate = () => void runMutation('mitigate', async () => {
    if (!account || !system || !selected || !schemaOk) return
    const before = await getHazard(system.system_id, selected.hazard_index)
    const beforeLifetime = before.lifetime_attempt_count
    setBanner({ kind: 'info', message: 'Confirm submit_mitigation. The SHA-256 digest binds the claimed artifact identity; it is not evidence verification.' })
    try {
      await submitMitigation(account, system.system_id, selected.hazard_index, mitigationText.trim(), evidenceDigest.trim())
      const result = await waitForStateChange({
        read: () => getHazard(system.system_id, selected.hazard_index),
        isDone: (value) => value.lifetime_attempt_count > beforeLifetime,
      })
      await refreshCurrent()
      if (result.status === 'confirmed') {
        const latest = await getHazardAttempts(system.system_id, selected.hazard_index, result.value.lifetime_attempt_count, 1)
        const verdict = latest[0]?.verdict ?? 'recorded'
        setBanner({
          kind: verdict === 'MITIGATION_SUFFICIENT' ? 'success' : 'warning',
          message: verdict === 'MITIGATION_SUFFICIENT'
            ? 'MITIGATION_SUFFICIENT → PENDING_COUNTERSIGNATURE. The semantic verdict did not cover the hazard; reviewer approval is still required.'
            : `Consensus verdict: ${verdict}. Hazard remains OPEN.`,
        })
        setMitigationText('')
        setEvidenceDigest('')
      } else {
        setBanner({ kind: 'warning', message: 'Write was submitted but no new lifetime attempt was confirmed before timeout. Refresh before trying again.' })
      }
    } catch (error) {
      setBanner({ kind: 'error', message: reportError('submit mitigation', error) })
    }
  })

  const handleCountersign = () => void runMutation('countersign', async () => {
    if (!account || !system || !selected || !schemaOk) return
    const before = await getHazard(system.system_id, selected.hazard_index)
    setBanner({ kind: 'info', message: 'Confirm countersign_mitigation. Contract role/state gates remain authoritative.' })
    try {
      await countersignMitigation(account, system.system_id, selected.hazard_index)
      const result = await waitForStateChange({
        read: () => getHazard(system.system_id, selected.hazard_index),
        isDone: (value) => value.status === 'COVERED' && value.covered_by !== before.covered_by,
      })
      await refreshCurrent()
      setBanner(result.status === 'confirmed'
        ? { kind: 'success', message: 'Reviewer countersignature finalized: hazard is COVERED.' }
        : { kind: 'warning', message: 'Write submitted; COVERED was not confirmed before timeout. Refresh state.' })
    } catch (error) {
      setBanner({ kind: 'error', message: reportError('countersign mitigation', error) })
    }
  })

  const handleChallenge = () => void runMutation('challenge', async () => {
    if (!account || !system || !selected || !schemaOk) return
    const beforeChallenges = (await getSystem(system.system_id)).challenge_count
    setBanner({ kind: 'info', message: 'Confirm challenge_coverage. A successful challenge reopens the hazard and closes release readiness.' })
    try {
      await challengeCoverage(account, system.system_id, selected.hazard_index, challengeReason.trim())
      const result = await waitForStateChange({
        read: () => getSystem(system.system_id),
        isDone: (value) => value.challenge_count > beforeChallenges && !value.release_ready,
      })
      await refreshCurrent()
      setBanner(result.status === 'confirmed'
        ? { kind: 'success', message: 'Challenge finalized: hazard reopened and release_ready is false.' }
        : { kind: 'warning', message: 'Write submitted; challenge postcondition was not confirmed before timeout.' })
      if (result.status === 'confirmed') setChallengeReason('')
    } catch (error) {
      setBanner({ kind: 'error', message: reportError('challenge coverage', error) })
    }
  })

  const handleReopen = () => void runMutation('reopen', async () => {
    if (!account || !system || !selected || !schemaOk) return
    const before = await getHazard(system.system_id, selected.hazard_index)
    const lifetime = before.lifetime_attempt_count
    setBanner({ kind: 'info', message: 'Confirm reopen_attempts. Only the authenticated reviewer can reopen an exhausted OPEN cycle below the lifetime ceiling.' })
    try {
      await reopenAttempts(account, system.system_id, selected.hazard_index)
      const result = await waitForStateChange({
        read: () => getHazard(system.system_id, selected.hazard_index),
        isDone: (value) =>
          value.attempt_count === 0 &&
          before.attempt_count !== 0 &&
          value.lifetime_attempt_count === lifetime,
      })
      await refreshCurrent()
      setBanner(result.status === 'confirmed'
        ? { kind: 'success', message: `Retry cycle reopened: 0/${config?.max_attempts_per_hazard ?? 5}; lifetime remains ${lifetime}/${config?.max_lifetime_attempts_per_hazard ?? 15}.` }
        : { kind: 'warning', message: 'Write submitted; reset postcondition was not confirmed before timeout.' })
    } catch (error) {
      setBanner({ kind: 'error', message: reportError('reopen attempts', error) })
    }
  })

  const handleRelease = () => void runMutation('release', async () => {
    if (!account || !system || !schemaOk) return
    const beforeRelease = (await getSystem(system.system_id)).release_ready
    setBanner({ kind: 'info', message: 'Confirm mark_release_ready. The contract, not the UI, enforces complete reviewer-countersigned coverage.' })
    try {
      await markReleaseReady(account, system.system_id)
      const result = await waitForStateChange({
        read: () => getSystem(system.system_id),
        isDone: (value) => value.release_ready && !beforeRelease,
      })
      await refreshCurrent()
      setBanner(result.status === 'confirmed'
        ? { kind: 'success', message: 'Release readiness finalized onchain.' }
        : { kind: 'warning', message: 'Write submitted; release_ready was not confirmed before timeout.' })
    } catch (error) {
      setBanner({ kind: 'error', message: reportError('mark release ready', error) })
    }
  })

  const handleEvidenceFile = async (file?: File) => {
    if (!file) return
    try {
      setEvidenceDigest(await sha256File(file))
      setBanner({ kind: 'info', message: `Computed SHA-256 locally from ${file.name}. The file is not uploaded by this dApp.` })
    } catch (error) {
      setBanner({ kind: 'error', message: reportError('hash evidence file', error) })
    }
  }

  const loadFromInput = () => void loadSystem(Number(systemInput))
  const controlsLocked = Boolean(busy)

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><img src="/safetycase-logo.svg" alt="" /></div>
          <div><strong>SafetyCase</strong><span>Second-party safety assurance</span></div>
        </div>
        <div className="side-section-label">ASSURANCE FLOW</div>
        <nav className="nav-list">
          {([
            ['overview', '01', 'Overview', 'Coverage posture'],
            ['create', '02', 'Declare', 'Owner + reviewer'],
            ['work', '03', 'Mitigate', 'Classify & countersign'],
            ['audit', '04', 'Audit trail', 'Attempts & challenges'],
            ['verification', '05', 'Verification', 'Source parity'],
          ] as const).map(([key, icon, title, detail]) => (
            <button key={key} disabled={controlsLocked} className={tab === key ? 'nav-item active' : 'nav-item'} onClick={() => setTab(key)}>
              <span className="nav-icon">{icon}</span><span><b>{title}</b><small>{detail}</small></span>
            </button>
          ))}
        </nav>
        <div className="network-card">
          <div><small>NETWORK</small><span><i className="status-dot" /> StudioNet</span></div>
          <div><small>SCHEMA</small><b>{schemaOk ? 'v2.0 verified' : 'unverified'}</b></div>
          <div><small>CONTRACT</small><a href={contractHref} target="_blank" rel="noreferrer">{shortAddress(CONTRACT_ADDRESS)}</a></div>
        </div>
        <div className="sidebar-status">
          <div className="side-status-top"><span>RELEASE GATE</span><b className={system?.release_ready ? 'side-ready' : 'side-building'}>{system?.release_ready ? 'READY' : 'CONTROLLED'}</b></div>
          <strong>{system ? `${system.covered_count}/${system.required_hazard_count} covered` : 'No system loaded'}</strong>
          <p>{system ? `${system.open_count} open · ${system.pending_count} pending reviewer signature` : 'Load a system to inspect the immutable hazard set.'}</p>
          <div className="mini-progress"><span style={{ width: `${coveragePct}%` }} /></div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div><div className="breadcrumb">GenLayer StudioNet / SafetyCase v2.0</div><h1>Safety assurance console</h1></div>
          <div className="top-actions">
            {wrongChain && <button className="secondary-button" disabled={controlsLocked} onClick={handleSwitch}>Switch to StudioNet</button>}
            <a className="secondary-button" href={contractHref} target="_blank" rel="noreferrer">Explorer ↗</a>
            <button className="wallet-button" disabled={controlsLocked} onClick={handleConnect}>{account ? shortAddress(account) : busy === 'connect' ? 'Connecting…' : 'Connect wallet'}</button>
          </div>
        </header>

        {busy && <div className="lock-strip">Transaction in progress · controls locked until finalized-state verification completes.</div>}
        {banner && <div className={`banner ${banner.kind}`}>{banner.message}</div>}

        <section className="workspace">
          {tab === 'overview' && (
            <>
              <div className="hero compact"><div><span className="eyebrow">AUTHENTICATED SAFETY CASE</span><h2>Semantic sufficiency cannot open the release gate by itself.</h2><p>A mitigation first receives a bounded GenLayer verdict. A separately authenticated reviewer must then countersign it before the hazard becomes COVERED.</p></div><div className="hero-seal">2P<br/><small>CONTROL</small></div></div>
              <div className="stat-grid">
                <article><span>Contract</span><strong>v{config?.version ?? '—'}</strong><small>frozen deployment</small></article>
                <article><span>Retry cycle</span><strong>{config?.max_attempts_per_hazard ?? 5}</strong><small>semantic calls / cycle</small></article>
                <article><span>Lifetime ceiling</span><strong>{config?.max_lifetime_attempts_per_hazard ?? 15}</strong><small>classifications / hazard</small></article>
                <article><span>Evidence binding</span><strong>SHA-256</strong><small>artifact identity, reviewer verified</small></article>
              </div>
              <div className="panel load-panel">
                <div><span className="panel-label">LOAD FINALIZED SYSTEM</span><h3>Inspect a system by numeric ID</h3></div>
                <div className="load-row"><input value={systemInput} onChange={(e) => setSystemInput(e.target.value)} placeholder="System ID" /><button disabled={controlsLocked} onClick={loadFromInput}>Load finalized state</button></div>
              </div>
              {system && <SystemSummary system={system} hazards={hazards} />}
            </>
          )}

          {tab === 'create' && (
            <>
              <div className="section-head"><span className="eyebrow">IMMUTABLE DECLARATION</span><h2>Create a system with a distinct reviewer</h2><p>The reviewer address is fixed at creation. The declared hazard set is immutable.</p></div>
              <div className="two-col">
                <div className="panel form-panel">
                  <label>System purpose<textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="What system or release is this safety case for?" /></label>
                  <label>Reviewer wallet<input value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="0x… distinct from owner" /></label>
                  <div className="hazard-editor">
                    <div className="form-title"><span>Declared hazards</span><button type="button" disabled={controlsLocked || Boolean(config && draftHazards.length >= config.max_hazards)} onClick={() => setDraftHazards((v) => [...v, ''])}>+ Add hazard</button></div>
                    {draftHazards.map((value, index) => <div className="hazard-input" key={index}><b>H{index + 1}</b><input value={value} onChange={(e) => setDraftHazards((list) => list.map((x, i) => i === index ? e.target.value : x))} placeholder="Machine-reviewable hazard statement" /><button type="button" disabled={controlsLocked || draftHazards.length <= (config?.min_hazards ?? 2)} onClick={() => setDraftHazards((list) => list.filter((_, i) => i !== index))}>×</button></div>)}
                  </div>
                  <button className="primary-button" disabled={controlsLocked || !account || !schemaOk} onClick={handleCreate}>{busy === 'create' ? 'Creating…' : 'Create immutable safety case'}</button>
                </div>
                <div className="panel rule-panel"><span className="panel-label">CONTRACT PREDICTION</span><h3>{createWarnings.length ? 'This call is expected to be refused' : 'Call shape looks admissible'}</h3>{createWarnings.length ? <ul className="warning-list">{createWarnings.map((w) => <li key={w}>{w}</li>)}</ul> : <p className="good-note">Client-side checks are advisory only. The contract remains the authority.</p>}<p className="scope-note">The dApp intentionally does not hide contract refusal paths. If a call is structurally buildable, the wallet can submit it and the chain decides.</p></div>
              </div>
            </>
          )}

          {tab === 'work' && (
            <>
              <div className="section-head inline"><div><span className="eyebrow">MITIGATION CONTROL LOOP</span><h2>Classify → countersign → challenge / reopen</h2></div><div className="load-row compact-row"><input value={systemInput} onChange={(e) => setSystemInput(e.target.value)} placeholder="System ID"/><button disabled={controlsLocked} onClick={loadFromInput}>Load</button></div></div>
              {!system ? <EmptyState text="Load a finalized system first." /> : <>
                <SystemSummary system={system} hazards={hazards} />
                <div className="hazard-tabs">{hazards.map((hazard) => <button disabled={controlsLocked} key={hazard.hazard_index} className={selectedHazard === hazard.hazard_index ? 'hazard-tab active' : 'hazard-tab'} onClick={() => setSelectedHazard(hazard.hazard_index)}><span>H{hazard.hazard_index}</span><b className={badgeClass(hazard.status)}>{hazard.status === 'PENDING_COUNTERSIGNATURE' ? 'PENDING' : hazard.status}</b></button>)}</div>
                {selected && <div className="work-grid">
                  <div className="panel mitigation-panel">
                    <div className="hazard-heading"><span className="panel-label">H{selected.hazard_index} / OWNER SUBMISSION</span><h3>{selected.text}</h3></div>
                    <div className="budget-rail"><div><span>Cycle</span><strong>{selected.attempt_count}/{config?.max_attempts_per_hazard ?? 5}</strong></div><div><span>Lifetime</span><strong>{selected.lifetime_attempt_count}/{config?.max_lifetime_attempts_per_hazard ?? 15}</strong></div><div><span>Status</span><b className={badgeClass(selected.status)}>{selected.status}</b></div></div>
                    <label>Mitigation candidate<textarea value={mitigationText} onChange={(e) => setMitigationText(e.target.value)} placeholder="Describe the preventive control for this hazard." /></label>
                    <label>Evidence artifact SHA-256<input value={evidenceDigest} onChange={(e) => setEvidenceDigest(e.target.value)} placeholder="64 hex characters (0x optional)" /></label>
                    <label className="file-hash">Hash a local evidence file <input type="file" disabled={controlsLocked} onChange={(e) => void handleEvidenceFile(e.target.files?.[0])}/><small>The file stays local; only its SHA-256 identity is sent onchain.</small></label>
                    {actionWarnings.length > 0 && <div className="contract-warning"><strong>Contract refusal forecast</strong>{actionWarnings.map((w) => <div key={w}>• {w}</div>)}</div>}
                    <button className="primary-button" disabled={controlsLocked || !account || !schemaOk} onClick={handleMitigate}>{busy === 'mitigate' ? 'Waiting for finalized verdict…' : 'Submit mitigation for semantic review'}</button>
                  </div>
                  <div className="panel reviewer-panel">
                    <span className="panel-label">AUTHENTICATED REVIEWER</span><h3>{shortAddress(system.reviewer)}</h3><p className="scope-note">Semantic `MITIGATION_SUFFICIENT` creates only a pending candidate. Coverage requires this reviewer wallet.</p>
                    <div className="review-action"><div><span>Countersign pending mitigation</span><small>{isReviewer ? 'Connected reviewer' : `Contract expects ${shortAddress(system.reviewer)}`}</small></div><button disabled={controlsLocked || !account || !schemaOk} onClick={handleCountersign}>Countersign</button></div>
                    <label>Challenge / revocation reason<textarea value={challengeReason} onChange={(e) => setChallengeReason(e.target.value)} placeholder="Why should this coverage candidate be revoked?" /></label>
                    <button className="danger-button" disabled={controlsLocked || !account || !schemaOk} onClick={handleChallenge}>Challenge coverage</button>
                    <div className="review-action reopen"><div><span>Reopen exhausted OPEN cycle</span><small>Reviewer only · cycle must be 5/5 · lifetime &lt; 15</small></div><button disabled={controlsLocked || !account || !schemaOk} onClick={handleReopen}>Reopen attempts</button></div>
                    {!isReviewer && <div className="contract-warning">Contract will refuse reviewer-only actions from the currently connected wallet. Buttons remain available so the on-chain role gate can be demonstrated.</div>}
                  </div>
                </div>}
                <div className="panel release-panel"><div><span className="panel-label">DETERMINISTIC RELEASE GATE</span><h3>{system.release_ready ? 'Release readiness declared' : `${system.covered_count}/${system.required_hazard_count} hazards are COVERED`}</h3><p>No validator chooses this outcome. The contract checks `covered_count == required_hazard_count`.</p></div><button className="release-button" disabled={controlsLocked || !account || !schemaOk} onClick={handleRelease}>{busy === 'release' ? 'Finalizing…' : 'Mark release ready'}</button></div>
              </>}
            </>
          )}

          {tab === 'audit' && (
            <>
              <div className="section-head inline"><div><span className="eyebrow">APPEND-ONLY RECORD</span><h2>Attempt and challenge audit trail</h2></div><div className="load-row compact-row"><input value={systemInput} onChange={(e) => setSystemInput(e.target.value)} placeholder="System ID"/><button disabled={controlsLocked} onClick={loadFromInput}>Load</button></div></div>
              {!system ? <EmptyState text="Load a system to inspect its audit trail." /> : <div className="audit-grid">
                <div className="panel"><span className="panel-label">MITIGATION ATTEMPTS</span><div className="ledger">{history.length ? [...history].reverse().map((item) => <div className="ledger-row" key={item.mitigation_id}><div><b>#{item.mitigation_id} · H{item.hazard_index}</b><span className={badgeClass(item.verdict)}>{item.verdict}</span></div><p>{item.text}</p><code>{shortDigest(item.evidence_digest)}</code></div>) : <p className="empty-copy">No mitigation attempts recorded.</p>}</div></div>
                <div className="panel"><span className="panel-label">REVIEWER CHALLENGES</span><div className="ledger">{challenges.length ? [...challenges].reverse().map((item) => <div className="ledger-row" key={item.challenge_id}><div><b>Challenge #{item.challenge_id} · H{item.hazard_index}</b><span className="badge badge-gap">{item.previous_status} → OPEN</span></div><p>{item.reason}</p><code>{shortAddress(item.challenged_by)}</code></div>) : <p className="empty-copy">No reviewer challenges recorded.</p>}</div></div>
              </div>}
              {selected && attempts.length > 0 && <div className="panel"><span className="panel-label">SELECTED HAZARD LIFETIME HISTORY</span><div className="table-wrap"><table><thead><tr><th>Ordinal</th><th>Mitigation</th><th>Evidence digest</th><th>Verdict</th></tr></thead><tbody>{attempts.map((item) => <tr key={item.hazard_attempt_index}><td>{item.hazard_attempt_index}</td><td>{item.text}</td><td><code>{shortDigest(item.evidence_digest)}</code></td><td><span className={badgeClass(item.verdict)}>{item.verdict}</span></td></tr>)}</tbody></table></div></div>}
            </>
          )}

          {tab === 'verification' && (
            <div className="verification-grid">
              <div className="panel verify-card"><span className="panel-label">DEPLOYED SOURCE</span><h2>Frozen v2.0 deployment</h2><dl><dt>Contract</dt><dd><a href={contractHref} target="_blank" rel="noreferrer">{CONTRACT_ADDRESS}</a></dd><dt>SHA-256</dt><dd><code>{FROZEN_SOURCE_SHA256}</code></dd><dt>Schema</dt><dd>{schemaOk ? 'SafetyCaseGate v2.0 verified from live get_config()' : 'Not verified'}</dd></dl></div>
              <div className="panel verify-card"><span className="panel-label">HONEST SCOPE</span><h3>What this contract does not prove</h3><p>The SHA-256 digest binds a claimed evidence artifact identity; the contract does not fetch or validate the artifact. The separately authenticated reviewer verifies it off-chain before countersigning.</p><p>The declared hazard list may be incomplete, and the contract does not prove that a mitigation was implemented in the real world.</p><p>The reviewer is chosen at creation and cannot be replaced. A reviewer who refuses every candidate can permanently prevent a hazard from reaching COVERED.</p></div>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div className="panel empty-state">{text}</div>
}

function SystemSummary({ system, hazards }: { system: SystemRecord; hazards: HazardRecord[] }) {
  return <div className="panel system-summary">
    <div className="system-head"><div><span className="panel-label">SYSTEM #{system.system_id}</span><h3>{system.system_purpose}</h3></div><b className={system.release_ready ? 'badge badge-good' : 'badge badge-open'}>{system.release_ready ? 'RELEASE READY' : 'GATE CLOSED'}</b></div>
    <div className="role-strip"><div><span>Owner</span><b>{shortAddress(system.owner)}</b></div><div><span>Reviewer</span><b>{shortAddress(system.reviewer)}</b></div><div><span>Covered</span><b>{system.covered_count}/{system.required_hazard_count}</b></div><div><span>Pending</span><b>{system.pending_count}</b></div><div><span>Challenges</span><b>{system.challenge_count}</b></div></div>
    <div className="hazard-matrix">{hazards.map((hazard) => <div key={hazard.hazard_index}><span>H{hazard.hazard_index}</span><p>{hazard.text}</p><b className={badgeClass(hazard.status)}>{hazard.status}</b><small>cycle {hazard.attempt_count}/5 · lifetime {hazard.lifetime_attempt_count}/15</small></div>)}</div>
  </div>
}

export default App
