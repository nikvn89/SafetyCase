import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CONTRACT_ADDRESS,
  FROZEN_SOURCE_SHA256,
  RUNTIME_EVIDENCE_ADDRESS,
  EXPLORER_BASE,
  MAX_SYSTEM_PURPOSE_LENGTH,
} from './config'
import {
  connectWallet,
  createSystem,
  ensureStudioChain,
  getConfig,
  getHazard,
  getHazardAttempts,
  getHazards,
  getSystem,
  getSystemMitigations,
  markReleaseReady,
  submitMitigation,
  waitForCreatedSystem,
  waitForStateChange,
} from './genlayer'
import { reportError } from './errors'
import type {
  Address,
  GateConfig,
  HazardAttempt,
  HazardRecord,
  SystemMitigation,
  SystemRecord,
} from './types'

type Tab = 'overview' | 'hazards' | 'history'
type BannerKind = 'info' | 'success' | 'warning' | 'error'

type Banner = {
  kind: BannerKind
  message: string
}

const LAST_SYSTEM_KEY =
  `safetycase:last-system:${CONTRACT_ADDRESS.toLowerCase()}`

function shortAddress(value: string) {
  if (!value || value.length < 12) return value || '—'
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

function shortHash(value: string) {
  if (!value || value.length < 20) return value || '—'
  return `${value.slice(0, 10)}...${value.slice(-8)}`
}


function normalizedHazards(values: string[]) {
  return values.map((value) => value.trim()).filter(Boolean)
}

function uniqueStrings(values: string[]) {
  return new Set(values).size === values.length
}

function badgeClass(status: string) {
  if (status === 'COVERED' || status === 'MITIGATION_SUFFICIENT') {
    return 'badge badge-good'
  }
  if (status === 'SAFETY_GAP') return 'badge badge-gap'
  return 'badge badge-open'
}

function App() {
  const [tab, setTab] = useState<Tab>('overview')
  const [account, setAccount] = useState<Address | null>(null)
  const [config, setConfig] = useState<GateConfig | null>(null)

  const [systemId, setSystemId] = useState(0)
  const [systemInput, setSystemInput] = useState('')
  const [system, setSystem] = useState<SystemRecord | null>(null)
  const [hazards, setHazards] = useState<HazardRecord[]>([])
  const [history, setHistory] = useState<SystemMitigation[]>([])

  const [purpose, setPurpose] = useState('')
  const [draftHazards, setDraftHazards] = useState<string[]>(['', ''])

  const [selectedHazard, setSelectedHazard] = useState(1)
  const [mitigationText, setMitigationText] = useState('')
  const [selectedAttempts, setSelectedAttempts] = useState<HazardAttempt[]>([])

  const [banner, setBanner] = useState<Banner | null>(null)
  const [busy, setBusy] = useState('')
  const [loading, setLoading] = useState(true)
  const [schemaOk, setSchemaOk] = useState(false)
  const [wrongChain, setWrongChain] = useState(false)

  const isOwner = useMemo(
    () =>
      Boolean(
        account &&
          system &&
          account.toLowerCase() === system.owner.toLowerCase(),
      ),
    [account, system],
  )

  const coveragePct = useMemo(() => {
    if (!system?.required_hazard_count) return 0
    return Math.round(
      (system.covered_count / system.required_hazard_count) * 100,
    )
  }, [system])

  const contractHref =
    `${EXPLORER_BASE}/address/${CONTRACT_ADDRESS}`

  const runtimeEvidenceHref =
    `${EXPLORER_BASE}/address/${RUNTIME_EVIDENCE_ADDRESS}`

  const refreshConfig = useCallback(async () => {
    const next = await getConfig()
    setConfig(next)
    setSchemaOk(true)
    return next
  }, [])

  const loadSystem = useCallback(
    async (id: number, quiet = false) => {
      if (!Number.isInteger(id) || id <= 0) {
        if (!quiet) {
          setBanner({ kind: 'warning', message: 'Enter a valid system id.' })
        }
        return
      }

      if (!quiet) setLoading(true)

      try {
        const record = await getSystem(id)
        const [nextHazards, nextHistory] = await Promise.all([
          getHazards(id, 1, record.required_hazard_count),
          record.mitigation_count > 0
            ? (() => {
                const from = Math.max(1, record.mitigation_count - 49)
                const count = record.mitigation_count - from + 1
                return getSystemMitigations(id, from, count)
              })()
            : Promise.resolve([]),
        ])

        setSystem(record)
        setSystemId(id)
        setSystemInput(String(id))
        setHazards(nextHazards)
        setHistory(nextHistory)
        setSelectedHazard((current) => {
          const open = nextHazards.find((item) => item.status === 'OPEN')
          if (
            current > 0 &&
            current <= record.required_hazard_count
          ) {
            return current
          }
          return open?.hazard_index ?? 1
        })
        window.localStorage.setItem(LAST_SYSTEM_KEY, String(id))

        if (!quiet) {
          setBanner({
            kind: 'info',
            message: `Loaded SafetyCase system #${id}.`,
          })
        }
      } catch (error) {
        if (!quiet) {
          setBanner({
            kind: 'error',
            message: reportError('load system', error),
          })
        }
      } finally {
        if (!quiet) setLoading(false)
      }
    },
    [],
  )

  const refreshCurrent = useCallback(async () => {
    if (!systemId) return
    await loadSystem(systemId, true)
  }, [loadSystem, systemId])

  useEffect(() => {
    let active = true

    const bootstrap = async () => {
      setLoading(true)
      try {
        const next = await getConfig()
        if (!active) return
        setConfig(next)
        setSchemaOk(true)

        const saved = Number(
          window.localStorage.getItem(LAST_SYSTEM_KEY) ?? '0',
        )
        const preferred =
          Number.isInteger(saved) &&
          saved > 0 &&
          saved <= next.system_count
            ? saved
            : next.system_count > 0
              ? 1
              : 0

        if (preferred > 0) {
          await loadSystem(preferred, true)
        } else {
          setSystem(null)
          setSystemId(0)
          setSystemInput('')
          setHazards([])
          setHistory([])
        }
      } catch (error) {
        if (active) {
          setSchemaOk(false)
          setBanner({
            kind: 'error',
            message: reportError('bootstrap', error),
          })
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    void bootstrap()

    return () => {
      active = false
    }
  }, [loadSystem])

  useEffect(() => {
    if (!window.ethereum?.on) return

    const onAccounts = (accounts: string[]) => {
      setAccount((accounts?.[0] as Address | undefined) ?? null)
    }
    const onChain = (chainIdHex: string) => {
      setWrongChain(
        typeof chainIdHex === 'string' &&
          chainIdHex.toLowerCase() !== '0xf22f',
      )
    }

    window.ethereum.on('accountsChanged', onAccounts)
    window.ethereum.on('chainChanged', onChain)

    return () => {
      window.ethereum?.removeListener?.('accountsChanged', onAccounts)
      window.ethereum?.removeListener?.('chainChanged', onChain)
    }
  }, [refreshConfig])

  useEffect(() => {
    const updateAttempts = async () => {
      if (!systemId || selectedHazard <= 0) {
        setSelectedAttempts([])
        return
      }

      const hazard = hazards.find(
        (item) => item.hazard_index === selectedHazard,
      )

      if (!hazard || hazard.attempt_count <= 0) {
        setSelectedAttempts([])
        return
      }

      try {
        const from = Math.max(1, hazard.attempt_count - 49)
        const count = hazard.attempt_count - from + 1
        const attempts = await getHazardAttempts(
          systemId,
          selectedHazard,
          from,
          count,
        )
        setSelectedAttempts(attempts)
      } catch {
        setSelectedAttempts([])
      }
    }

    void updateAttempts()
  }, [hazards, selectedHazard, systemId])

  const handleConnect = async () => {
    setBusy('connect')
    setBanner(null)

    try {
      const result = await connectWallet()
      setAccount(result.address)

      try {
        const chainIdHex = (await window.ethereum?.request({
          method: 'eth_chainId',
        })) as string | undefined
        setWrongChain(
          typeof chainIdHex === 'string' &&
            chainIdHex.toLowerCase() !== '0xf22f',
        )
      } catch {
        // Every write still calls ensureStudioChain() before submission.
      }

      setBanner({
        kind: result.warning ? 'warning' : 'success',
        message:
          result.warning ??
          `Connected ${shortAddress(result.address)} on StudioNet.`,
      })
    } catch (error) {
      setBanner({
        kind: 'error',
        message: reportError('connect wallet', error),
      })
    } finally {
      setBusy('')
    }
  }

  const handleSwitchChain = async () => {
    setBusy('switch-chain')

    try {
      await ensureStudioChain()
      setWrongChain(false)
      setBanner({
        kind: 'success',
        message: 'MetaMask switched to GenLayer StudioNet (61999).',
      })
    } catch (error) {
      setBanner({
        kind: 'error',
        message: reportError('switch network', error),
      })
    } finally {
      setBusy('')
    }
  }

  const validateNewSystem = () => {
    if (!account) return 'Connect MetaMask first.'
    if (!schemaOk) {
      return 'Expected SafetyCaseGate v1.2 schema is not verified. Writes are disabled.'
    }

    const nextPurpose = purpose.trim()
    const nextHazards = normalizedHazards(draftHazards)

    if (!nextPurpose) return 'System purpose cannot be empty.'
    if (nextPurpose.length > MAX_SYSTEM_PURPOSE_LENGTH) {
      return `System purpose exceeds ${MAX_SYSTEM_PURPOSE_LENGTH} characters.`
    }
    if (!config) return 'Live contract configuration is not loaded yet.'
    if (nextHazards.length < config.min_hazards) {
      return `SafetyCase requires at least ${config.min_hazards} hazards.`
    }
    if (nextHazards.length > config.max_hazards) {
      return `SafetyCase allows at most ${config.max_hazards} hazards.`
    }
    if (!uniqueStrings(nextHazards)) {
      return 'Duplicate hazard text is not allowed.'
    }
    if (
      nextHazards.some(
        (item) => item.length > config.max_hazard_length,
      )
    ) {
      return `A hazard exceeds the ${config.max_hazard_length}-character limit.`
    }

    return ''
  }

  const handleCreate = async () => {
    const validation = validateNewSystem()
    if (validation) {
      setBanner({ kind: 'warning', message: validation })
      return
    }
    if (!account || !config || !schemaOk) return

    const nextPurpose = purpose.trim()
    const nextHazards = normalizedHazards(draftHazards)

    setBusy('create')
    setBanner({
      kind: 'info',
      message:
        'Confirm the create_system transaction in MetaMask. The app will resolve your exact new system after submission.',
    })

    try {
      const fresh = await getConfig()
      setConfig(fresh)
      setSchemaOk(true)
      const beforeCount = fresh.system_count

      await createSystem(
        account,
        nextPurpose,
        JSON.stringify(nextHazards),
      )

      setBanner({
        kind: 'info',
        message:
          'Transaction submitted. Waiting for the new immutable hazard set to appear onchain…',
      })

      const result = await waitForCreatedSystem(
        account,
        nextPurpose,
        nextHazards,
        beforeCount,
      )

      const nextConfig = await refreshConfig()

      if (result.status === 'confirmed') {
        await loadSystem(result.value.system_id, true)
        setBanner({
          kind: 'success',
          message: `System #${result.value.system_id} created and matched by owner + purpose + exact hazard set.`,
        })
        setTab('hazards')
      } else {
        setBanner({
          kind: 'warning',
          message:
            `Submission was sent, but the exact created system was not resolved before timeout. Current system_count is ${nextConfig.system_count}; use Existing system to load it after finalization.`,
        })
      }
    } catch (error) {
      setBanner({
        kind: 'error',
        message: reportError('create system', error),
      })
    } finally {
      setBusy('')
    }
  }

  const loadExisting = () => {
    const id = Number(systemInput)
    void loadSystem(id)
  }

  const addHazardField = () => {
    if (config && draftHazards.length >= config.max_hazards) return
    setDraftHazards((items) => [...items, ''])
  }

  const removeHazardField = (index: number) => {
    if (
      config &&
      draftHazards.length <= config.min_hazards
    ) {
      return
    }
    setDraftHazards((items) =>
      items.filter((_, itemIndex) => itemIndex !== index),
    )
  }

  const setHazardField = (index: number, value: string) => {
    setDraftHazards((items) =>
      items.map((item, itemIndex) =>
        itemIndex === index ? value : item,
      ),
    )
  }


  const handleSubmitMitigation = async () => {
    if (!account || !system || !config) {
      setBanner({ kind: 'warning', message: 'Connect MetaMask and load a system first.' })
      return
    }
    if (!schemaOk) {
      setBanner({
        kind: 'error',
        message: 'Expected SafetyCaseGate v1.2 schema is not verified. Writes are disabled.',
      })
      return
    }
    if (!isOwner) {
      setBanner({
        kind: 'warning',
        message: 'Only the system owner can submit mitigations.',
      })
      return
    }

    const hazard = hazards.find(
      (item) => item.hazard_index === selectedHazard,
    )
    if (!hazard) {
      setBanner({ kind: 'warning', message: 'Choose a valid hazard.' })
      return
    }
    if (hazard.status === 'COVERED') {
      setBanner({
        kind: 'warning',
        message: 'This hazard is already irreversibly COVERED.',
      })
      return
    }

    const text = mitigationText.trim()
    if (!text) {
      setBanner({ kind: 'warning', message: 'Mitigation text cannot be empty.' })
      return
    }
    if (text.length > config.max_mitigation_length) {
      setBanner({
        kind: 'warning',
        message: `Mitigation exceeds ${config.max_mitigation_length} characters.`,
      })
      return
    }

    const duplicate = selectedAttempts.some(
      (attempt) => attempt.text === text,
    )
    if (duplicate) {
      setBanner({
        kind: 'info',
        message:
          'This exact mitigation is already present in the recent onchain attempt history. The contract would treat an exact replay as a deterministic no-op.',
      })
      return
    }

    const beforeAttemptCount = hazard.attempt_count
    const beforeStatus = hazard.status

    setBusy('mitigate')
    setBanner({
      kind: 'info',
      message:
        'Confirm submit_mitigation in MetaMask. GenLayer consensus may take time; do not submit twice.',
    })

    try {
      await submitMitigation(
        account,
        system.system_id,
        selectedHazard,
        text,
      )

      setBanner({
        kind: 'info',
        message:
          'Mitigation submitted. Waiting for the hazard state or attempt count to change…',
      })

      const result = await waitForStateChange({
        read: () => getHazard(system.system_id, selectedHazard),
        isDone: (value) =>
          value.attempt_count > beforeAttemptCount ||
          (beforeStatus === 'OPEN' && value.status === 'COVERED'),
      })

      await refreshCurrent()

      if (result.status === 'confirmed') {
        const updated = result.value
        const attempts = updated.attempt_count > 0
          ? await getHazardAttempts(
              system.system_id,
              selectedHazard,
              Math.max(1, updated.attempt_count),
              1,
            )
          : []
        const latest = attempts[0]

        setBanner({
          kind:
            latest?.verdict === 'MITIGATION_SUFFICIENT'
              ? 'success'
              : 'warning',
          message: latest
            ? `Consensus verdict: ${latest.verdict}. Hazard is now ${updated.status}.`
            : `Onchain state changed. Hazard is now ${updated.status}.`,
        })
        setMitigationText('')
      } else {
        setBanner({
          kind: 'warning',
          message:
            'Submission was sent, but no state change was confirmed before timeout. It may still be finalizing, or the exact mitigation may have been a replay. Refresh before submitting again.',
        })
      }
    } catch (error) {
      setBanner({
        kind: 'error',
        message: reportError('submit mitigation', error),
      })
    } finally {
      setBusy('')
    }
  }

  const handleRelease = async () => {
    if (!account || !system) {
      setBanner({
        kind: 'warning',
        message: 'Connect MetaMask and load a system first.',
      })
      return
    }
    if (!schemaOk) {
      setBanner({
        kind: 'error',
        message: 'Expected SafetyCaseGate v1.2 schema is not verified. Writes are disabled.',
      })
      return
    }

    if (!system.all_hazards_covered) {
      setBanner({
        kind: 'warning',
        message:
          `Release gate is locked: ${system.open_count} declared hazard${system.open_count === 1 ? '' : 's'} remain OPEN.`,
      })
      return
    }

    if (system.release_ready) {
      setBanner({
        kind: 'info',
        message: 'Release readiness has already been declared.',
      })
      return
    }

    setBusy('release')
    setBanner({
      kind: 'info',
      message:
        'The deterministic coverage gate is open. Confirm mark_release_ready in MetaMask.',
    })

    try {
      await markReleaseReady(account, system.system_id)

      const result = await waitForStateChange({
        read: () => getSystem(system.system_id),
        isDone: (value) => value.release_ready,
      })

      await refreshCurrent()

      setBanner(
        result.status === 'confirmed'
          ? {
              kind: 'success',
              message:
                'Release readiness declared onchain. All declared hazards were already COVERED.',
            }
          : {
              kind: 'warning',
              message:
                'Transaction was submitted but release_ready was not confirmed before timeout. Refresh before retrying.',
            },
      )
    } catch (error) {
      setBanner({
        kind: 'error',
        message: reportError('mark release ready', error),
      })
    } finally {
      setBusy('')
    }
  }

  const selectedHazardRecord = hazards.find(
    (item) => item.hazard_index === selectedHazard,
  )

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <img src="/safetycase-logo.svg" alt="" />
          </div>
          <div>
            <strong>SafetyCase</strong>
            <span>Declared hazard coverage</span>
          </div>
        </div>

        <div className="side-section-label">WORKSPACE</div>

        <nav className="nav-list">
          <button
            className={tab === 'overview' ? 'nav-item active' : 'nav-item'}
            onClick={() => setTab('overview')}
          >
            <span className="nav-icon">⌂</span>
            <span><b>Overview</b><small>Gate & create</small></span>
          </button>
          <button
            className={tab === 'hazards' ? 'nav-item active' : 'nav-item'}
            onClick={() => setTab('hazards')}
          >
            <span className="nav-icon">◇</span>
            <span><b>Hazards</b><small>Mitigation review</small></span>
            <em>{hazards.length}</em>
          </button>
          <button
            className={tab === 'history' ? 'nav-item active' : 'nav-item'}
            onClick={() => setTab('history')}
          >
            <span className="nav-icon">≡</span>
            <span><b>History</b><small>Append-only attempts</small></span>
            <em>{history.length}</em>
          </button>
        </nav>

        <div className="side-section-label">NETWORK</div>
        <div className="network-card">
          <div><span className="status-dot" /> StudioNet <small>61999</small></div>
          <div>
            <span>Contract</span>
            <a href={contractHref} target="_blank" rel="noreferrer">
              {shortAddress(CONTRACT_ADDRESS)} ↗
            </a>
          </div>
        </div>

        <div className="sidebar-status">
          <div className="side-status-top">
            <span>{system ? `SYSTEM #${system.system_id}` : 'REGISTRY'}</span>
            <b className={system?.release_ready ? 'side-ready' : 'side-building'}>
              {system?.release_ready ? 'DECLARED' : 'BUILDING'}
            </b>
          </div>
          <strong>
            {system
              ? `${system.covered_count}/${system.required_hazard_count} hazards covered`
              : config
                ? `${config.system_count} systems onchain`
                : 'Loading…'}
          </strong>
          <p>
            {system
              ? system.system_purpose
              : 'Create or load a safety case.'}
          </p>
          <div className="mini-progress">
            <span style={{ width: `${coveragePct}%` }} />
          </div>
        </div>

        <div className="built-on">
          <span className="gen-symbol" aria-hidden="true">
            <img src="/genlayer-logo.png" alt="" />
          </span>
          <div><b>Built on GenLayer</b><small>AI consensus + deterministic gate</small></div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <span className="breadcrumb">SafetyCase / {tab === 'overview' ? 'Overview' : tab === 'hazards' ? 'Hazards' : 'History'}</span>
            <h1>{tab === 'overview' ? 'Overview' : tab === 'hazards' ? 'Hazard Coverage' : 'Mitigation History'}</h1>
          </div>

          <div className="top-actions">
            <span className="network-pill"><span className="status-dot" /> StudioNet 61999</span>
            <a className="contract-pill" href={contractHref} target="_blank" rel="noreferrer">
              {shortAddress(CONTRACT_ADDRESS)} ↗
            </a>
            <button
              className="wallet-btn"
              onClick={handleConnect}
              disabled={busy === 'connect'}
            >
              {account ? shortAddress(account) : busy === 'connect' ? 'Connecting…' : 'Connect MetaMask'}
            </button>
          </div>
        </header>

        <div className="content">
          {wrongChain && (
            <div className="banner banner-warning">
              <span>
                Wallet is not on GenLayer StudioNet (61999). Reads still work through the
                app proxy, but writes must use StudioNet.
              </span>
              <button
                className="mini-btn"
                onClick={handleSwitchChain}
                disabled={busy === 'switch-chain'}
              >
                {busy === 'switch-chain' ? 'Switching…' : 'Switch to StudioNet'}
              </button>
            </div>
          )}

          {banner && (
            <div className={`banner banner-${banner.kind}`}>
              <span>{banner.message}</span>
              <button onClick={() => setBanner(null)} aria-label="Dismiss">×</button>
            </div>
          )}

          {tab === 'overview' && (
            <>
              <section className="hero">
                <div className="hero-copy">
                  <span className="eyebrow">CONSENSUS-GATED SAFETY CASE</span>
                  <h2>Cover every declared hazard before release.</h2>
                  <p>
                    Freeze the hazard set, review one mitigation at a time with
                    GenLayer consensus, then cross a deterministic 100% coverage gate.
                  </p>
                  <div className="hero-tags">
                    <span>{config?.min_hazards ?? 2}+ immutable hazards</span>
                    <span>2 semantic verdicts</span>
                    <span>No URLs in consensus</span>
                  </div>
                </div>

                <div className="gate-card">
                  <div className="gate-card-top">
                    <span>RELEASE GATE</span>
                    <b className={system?.release_ready ? 'badge badge-good' : 'badge badge-open'}>
                      {system?.release_ready ? 'READINESS DECLARED' : system?.all_hazards_covered ? 'GATE OPEN' : 'LOCKED'}
                    </b>
                  </div>
                  <strong>
                    {system
                      ? `${system.covered_count}/${system.required_hazard_count} covered`
                      : config?.system_count === 0
                        ? 'No system loaded'
                        : 'Load a system'}
                  </strong>
                  <p>
                    {system
                      ? system.all_hazards_covered
                        ? system.release_ready
                          ? 'All declared hazards are covered and readiness is declared.'
                          : 'Coverage equality is true. Readiness can now be declared.'
                        : `${system.open_count} declared hazard${system.open_count === 1 ? '' : 's'} remain open.`
                      : 'The gate derives from covered_count == required_hazard_count.'}
                  </p>
                  <div className="big-progress">
                    <span style={{ width: `${coveragePct}%` }} />
                  </div>
                  <div className="scope-note">
                    <b>Scope:</b> this record only shows coverage over hazards declared onchain.
                    It does not prove the hazard list is complete, and it does not prove any
                    mitigation was implemented in the real world.
                  </div>
                  <div className="gate-numbers">
                    <span><b>{system?.covered_count ?? 0}</b> covered</span>
                    <span><b>{system?.open_count ?? 0}</b> open</span>
                    <span><b>{system?.gap_attempts ?? 0}</b> gaps</span>
                  </div>
                </div>
              </section>

              <section className="metrics-grid">
                <div className="metric-card">
                  <span>SYSTEM</span>
                  <strong>{system ? `#${system.system_id}` : '—'}</strong>
                  <small>{system ? shortAddress(system.owner) : 'No active workspace'}</small>
                </div>
                <div className="metric-card">
                  <span>HAZARDS</span>
                  <strong>{system ? `${system.covered_count}/${system.required_hazard_count}` : '—'}</strong>
                  <small>Immutable declared set</small>
                </div>
                <div className="metric-card">
                  <span>MITIGATIONS</span>
                  <strong>{system?.mitigation_count ?? '—'}</strong>
                  <small>Append-only attempts</small>
                </div>
                <div className="metric-card">
                  <span>RELEASE</span>
                  <strong>{system?.release_ready ? 'DECLARED' : '—'}</strong>
                  <small>{system?.all_hazards_covered ? 'Coverage gate open' : 'Needs 100% coverage'}</small>
                </div>
              </section>

              <section className="overview-grid">
                <div className="panel create-panel">
                  <div className="panel-head">
                    <div>
                      <span className="eyebrow">CREATE</span>
                      <h3>Fresh safety case</h3>
                      <p>Commit the complete hazard set at creation. It cannot be appended later.</p>
                    </div>
                  </div>

                  <label>
                    <span>SYSTEM PURPOSE · HUMAN CONTEXT ONLY</span>
                    <textarea
                      value={purpose}
                      onChange={(event) => setPurpose(event.target.value)}
                      placeholder="Describe the system boundary or release context."
                      rows={2}
                    />
                  </label>

                  <div className="hazard-builder-head">
                    <span>DECLARED HAZARDS</span>
                    <small>{draftHazards.length}/{config?.max_hazards ?? 8}</small>
                  </div>

                  <div className="hazard-builder">
                    {draftHazards.map((value, index) => (
                      <div className="hazard-input-row" key={index}>
                        <span>H{index + 1}</span>
                        <textarea
                          value={value}
                          onChange={(event) => setHazardField(index, event.target.value)}
                          placeholder={`Describe hazard ${index + 1}`}
                          rows={2}
                        />
                        <button
                          className="remove-btn"
                          onClick={() => removeHazardField(index)}
                          disabled={Boolean(config && draftHazards.length <= config.min_hazards)}
                          aria-label={`Remove hazard ${index + 1}`}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="form-actions">
                    <button
                      className="ghost-btn"
                      onClick={addHazardField}
                      disabled={Boolean(config && draftHazards.length >= config.max_hazards)}
                    >
                      + Add hazard
                    </button>
                    <button
                      className="primary-btn"
                      onClick={handleCreate}
                      disabled={busy === 'create' || !schemaOk}
                    >
                      {busy === 'create' ? 'Creating…' : 'Create SafetyCase'}
                    </button>
                  </div>
                </div>

                <div className="panel side-stack">
                  <div>
                    <span className="eyebrow">OPEN</span>
                    <h3>Existing system</h3>
                    <p>Read any system. Mitigation writes remain owner-only.</p>
                  </div>
                  <div className="inline-load">
                    <input
                      value={systemInput}
                      onChange={(event) => setSystemInput(event.target.value)}
                      inputMode="numeric"
                      placeholder="System ID"
                    />
                    <button className="secondary-btn" onClick={loadExisting}>Load</button>
                  </div>

                  <div className="rule" />

                  <div>
                    <span className="eyebrow">ONCHAIN</span>
                    <h3>Live configuration</h3>
                    <div className="config-list">
                      <div><span>Version</span><b>{config?.version ?? '—'}</b></div>
                      <div><span>Hazards</span><b>{config ? `${config.min_hazards}–${config.max_hazards}` : '—'}</b></div>
                      <div><span>Prompt</span><b>{config?.prompt_inputs?.join(' + ') ?? '—'}</b></div>
                      <div><span>Purpose in prompt</span><b>{config ? String(config.system_purpose_enters_prompt).toUpperCase() : '—'}</b></div>
                      <div><span>Global admin</span><b>{config ? String(config.global_admin).toUpperCase() : '—'}</b></div>
                      <div><span>Clock</span><b>{config ? String(config.clock_used).toUpperCase() : '—'}</b></div>
                      <div>
                        <span>Project deployment</span>
                        <a href={contractHref} target="_blank" rel="noreferrer">{shortAddress(CONTRACT_ADDRESS)} ↗</a>
                      </div>
                      <div>
                        <span>Runtime evidence</span>
                        <a href={runtimeEvidenceHref} target="_blank" rel="noreferrer">{shortAddress(RUNTIME_EVIDENCE_ADDRESS)} ↗</a>
                      </div>
                      <div>
                        <span>Frozen source</span>
                        <b title={FROZEN_SOURCE_SHA256}>{shortHash(FROZEN_SOURCE_SHA256)}</b>
                      </div>
                    </div>
                  </div>

                  <div className="rule" />

                  <button
                    className={system?.all_hazards_covered ? 'release-btn open' : 'release-btn'}
                    disabled={
                      busy === 'release' ||
                      !schemaOk ||
                      !system ||
                      !account ||
                      Boolean(system?.release_ready)
                    }
                    onClick={handleRelease}
                  >
                    {system?.release_ready
                      ? 'Readiness Declared ✓'
                      : system?.all_hazards_covered
                        ? busy === 'release' ? 'Declaring…' : 'Declare Release Ready'
                        : `Gate locked${system ? ` · ${system.open_count} open` : ''}`}
                  </button>
                  <small className="permission-note">
                    `mark_release_ready` is permissionless, but only after the deterministic coverage equality is true.
                  </small>
                </div>
              </section>
            </>
          )}

          {tab === 'hazards' && (
            <>
              <section className="section-intro">
                <div>
                  <span className="eyebrow">IMMUTABLE BASELINE</span>
                  <h2>Declared hazards</h2>
                  <p>
                    Each hazard is independently OPEN or irreversibly COVERED.
                    New hazards cannot be added after system creation.
                  </p>
                </div>
                <div className="system-chip">
                  {system ? `System #${system.system_id}` : 'No system loaded'}
                  {system && <b>{system.release_ready ? 'DECLARED' : `${system.covered_count}/${system.required_hazard_count}`}</b>}
                </div>
              </section>

              {!system ? (
                <div className="empty-card">
                  <strong>No system loaded</strong>
                  <p>Open Overview and load or create a SafetyCase first.</p>
                </div>
              ) : (
                <section className="hazard-layout">
                  <div className="hazard-grid">
                    {hazards.map((hazard) => (
                      <button
                        key={hazard.hazard_index}
                        className={
                          selectedHazard === hazard.hazard_index
                            ? 'hazard-card selected'
                            : 'hazard-card'
                        }
                        onClick={() => setSelectedHazard(hazard.hazard_index)}
                      >
                        <div className="hazard-card-top">
                          <span>H{hazard.hazard_index}</span>
                          <b className={badgeClass(hazard.status)}>{hazard.status}</b>
                        </div>
                        <p>{hazard.text}</p>
                        <div className="hazard-meta">
                          <span>{hazard.attempt_count} attempt{hazard.attempt_count === 1 ? '' : 's'}</span>
                          <span>{hazard.covered_by ? `covered by #${hazard.covered_by}` : 'not covered'}</span>
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="panel mitigation-panel">
                    <div className="panel-head">
                      <div>
                        <span className="eyebrow">CONSENSUS REVIEW</span>
                        <h3>
                          {selectedHazardRecord
                            ? `Mitigate H${selectedHazardRecord.hazard_index}`
                            : 'Choose a hazard'}
                        </h3>
                      </div>
                      {selectedHazardRecord && (
                        <b className={badgeClass(selectedHazardRecord.status)}>
                          {selectedHazardRecord.status}
                        </b>
                      )}
                    </div>

                    {selectedHazardRecord && (
                      <div className="selected-hazard-copy">
                        {selectedHazardRecord.text}
                      </div>
                    )}

                    <label>
                      <span>PROPOSED MITIGATION</span>
                      <textarea
                        value={mitigationText}
                        onChange={(event) => setMitigationText(event.target.value)}
                        rows={7}
                        placeholder="Describe the control that prevents or sufficiently constrains this exact hazard."
                        disabled={selectedHazardRecord?.status === 'COVERED'}
                      />
                    </label>

                    <button
                      className="primary-btn full"
                      onClick={handleSubmitMitigation}
                      disabled={
                        busy === 'mitigate' ||
                        !schemaOk ||
                        !account ||
                        !isOwner ||
                        !selectedHazardRecord ||
                        selectedHazardRecord.status === 'COVERED'
                      }
                    >
                      {!account
                        ? 'Connect MetaMask'
                        : !isOwner
                          ? 'Owner-only mitigation'
                          : selectedHazardRecord?.status === 'COVERED'
                            ? 'Hazard already COVERED'
                            : busy === 'mitigate'
                              ? 'Waiting for consensus…'
                              : 'Submit to GenLayer Consensus'}
                    </button>

                    <div className="permission-note">
                      Validators see only HAZARD + MITIGATION. System purpose is human context and never enters the semantic prompt.
                    </div>

                    <div className="attempt-preview">
                      <div className="attempt-preview-head">
                        <span>RECENT ATTEMPTS</span>
                        <b>{selectedAttempts.length}</b>
                      </div>
                      {selectedHazardRecord &&
                        selectedHazardRecord.attempt_count > 50 && (
                          <small className="history-window-note">
                            Showing the 50 most recent attempts. An exact replay older than this
                            window may be a contract-level no-op and produce no state change.
                          </small>
                        )}
                      {selectedAttempts.length === 0 ? (
                        <p>No attempts recorded for this hazard.</p>
                      ) : (
                        selectedAttempts
                          .slice()
                          .reverse()
                          .map((attempt) => (
                            <div className="attempt-row" key={attempt.mitigation_id}>
                              <span>#{attempt.mitigation_id}</span>
                              <p>{attempt.text}</p>
                              <b className={badgeClass(attempt.verdict)}>{attempt.verdict}</b>
                            </div>
                          ))
                      )}
                    </div>
                  </div>
                </section>
              )}
            </>
          )}

          {tab === 'history' && (
            <>
              <section className="section-intro">
                <div>
                  <span className="eyebrow">APPEND-ONLY AUDIT</span>
                  <h2>Mitigation history</h2>
                  <p>
                    Every distinct semantic attempt is preserved. Exact replay is a contract-level no-op.
                  </p>
                </div>
                <button
                  className="ghost-btn"
                  onClick={() => void refreshCurrent()}
                  disabled={!system || loading}
                >
                  Refresh
                </button>
              </section>

              {!system ? (
                <div className="empty-card">
                  <strong>No system loaded</strong>
                  <p>Load a SafetyCase to inspect its mitigation trail.</p>
                </div>
              ) : history.length === 0 ? (
                <div className="empty-card">
                  <strong>No mitigation attempts yet</strong>
                  <p>Open Hazards and submit a mitigation for one declared hazard.</p>
                </div>
              ) : (
                <div className="history-table">
                  <div className="history-head">
                    <span>#</span>
                    <span>Hazard</span>
                    <span>Mitigation</span>
                    <span>Verdict</span>
                  </div>
                  {history
                    .slice()
                    .reverse()
                    .map((item) => (
                      <div className="history-row" key={item.mitigation_id}>
                        <span className="mono">#{item.mitigation_id}</span>
                        <span>H{item.hazard_index}</span>
                        <p>{item.text}</p>
                        <b className={badgeClass(item.verdict)}>{item.verdict}</b>
                      </div>
                    ))}
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  )
}

export default App
