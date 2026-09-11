import { createClient } from 'genlayer-js'
import { studionet } from 'genlayer-js/chains'
import { CONTRACT_ADDRESS } from './config'
import { errorCode, normalizeError } from './errors'
import type {
  Address,
  ChallengeRecord,
  GateConfig,
  HazardAttempt,
  HazardRecord,
  SystemMitigation,
  SystemRecord,
} from './types'

export type ConnectResult = { address: Address; warning?: string }
export type StateWaitResult<T> =
  | { status: 'confirmed'; value: T }
  | { status: 'pending'; lastValue?: T }

export interface WaitForStateChangeOptions<T> {
  read: () => Promise<T>
  isDone: (value: T) => boolean
  intervalMs?: number
  timeoutMs?: number
}

export const STUDIO_CHAIN_ID = 61999
export const STUDIO_CHAIN_ID_HEX = '0xf22f'

const STUDIO_CHAIN_PARAMS = {
  chainId: STUDIO_CHAIN_ID_HEX,
  chainName: 'GenLayer Studio Network',
  rpcUrls: ['https://studio.genlayer.com/api'],
  nativeCurrency: { name: 'GEN Token', symbol: 'GEN', decimals: 18 },
  blockExplorerUrls: ['https://explorer-studio.genlayer.com'],
}

const RPC_URL = `${window.location.origin}/genlayer-rpc`
const rpcStudionet = {
  ...studionet,
  rpcUrls: {
    ...studionet.rpcUrls,
    default: { ...studionet.rpcUrls.default, http: [RPC_URL] as [string] },
  },
} as typeof studionet

const readClient = createClient({ chain: rpcStudionet })
let rpcWriteInFlight = false

function normalize<T>(value: unknown): T {
  return value as T
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms))
}

export async function waitForStateChange<T>({
  read,
  isDone,
  intervalMs = 4_000,
  timeoutMs = 180_000,
}: WaitForStateChangeOptions<T>): Promise<StateWaitResult<T>> {
  const startedAt = Date.now()
  let lastValue: T | undefined
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await read()
      lastValue = value
      if (isDone(value)) return { status: 'confirmed', value }
    } catch {
      // StudioNet reads can transiently fail while a write finalizes.
    }
    const remaining = timeoutMs - (Date.now() - startedAt)
    if (remaining <= 0) break
    await sleep(Math.min(intervalMs, remaining))
  }
  return { status: 'pending', ...(lastValue === undefined ? {} : { lastValue }) }
}

export async function ensureStudioChain(): Promise<void> {
  if (!window.ethereum) throw new Error('MetaMask is not installed.')
  const current = (await window.ethereum.request({ method: 'eth_chainId' })) as string
  if (typeof current === 'string' && current.toLowerCase() === STUDIO_CHAIN_ID_HEX) return

  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: STUDIO_CHAIN_ID_HEX }],
    })
    return
  } catch (switchError) {
    if (String(errorCode(switchError) ?? '') !== '4902') throw switchError
  }

  await window.ethereum.request({
    method: 'wallet_addEthereumChain',
    params: [STUDIO_CHAIN_PARAMS],
  })
  await window.ethereum.request({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: STUDIO_CHAIN_ID_HEX }],
  })
}

export async function connectWallet(): Promise<ConnectResult> {
  if (!window.ethereum) throw new Error('MetaMask is not installed.')
  const accounts = (await window.ethereum.request({ method: 'eth_requestAccounts' })) as string[]
  if (!accounts?.[0]) throw new Error('No wallet account returned.')

  const address = accounts[0] as Address
  let warning: string | undefined
  try {
    await ensureStudioChain()
  } catch (chainError) {
    warning = `Connected, but MetaMask is not on GenLayer Studio yet: ${normalizeError(chainError).message}`
  }
  return warning ? { address, warning } : { address }
}

function writeClient(account: Address) {
  if (!window.ethereum) throw new Error('MetaMask is not installed.')
  return createClient({ chain: rpcStudionet, account, provider: window.ethereum })
}

async function write(account: Address, functionName: string, args: any[]) {
  if (rpcWriteInFlight) {
    throw new Error('Another write request is already being submitted. Wait for it to finish.')
  }
  rpcWriteInFlight = true
  try {
    await ensureStudioChain()
    const client = writeClient(account)
    const hash = await client.writeContract({
      address: CONTRACT_ADDRESS,
      functionName,
      args,
      value: 0n,
    })
    return { hash }
  } finally {
    rpcWriteInFlight = false
  }
}

async function read<T>(functionName: string, args: any[]): Promise<T> {
  const value = await readClient.readContract({ address: CONTRACT_ADDRESS, functionName, args })
  return normalize<T>(value)
}

function assertExpectedConfig(value: unknown): asserts value is GateConfig {
  const data = value as Partial<GateConfig> | null
  const ok = Boolean(data) &&
    data?.name === 'SafetyCaseGate' &&
    data?.version === '2.0' &&
    data?.reviewer_required === true &&
    data?.challenge_enabled === true &&
    data?.max_attempts_per_hazard === 5 &&
    data?.max_lifetime_attempts_per_hazard === 15 &&
    data?.evidence_binding === 'sha256_digest_per_mitigation' &&
    data?.same_evidence_reroll_blocked === true &&
    data?.coverage_gate === 'covered_count == required_hazard_count' &&
    Array.isArray(data?.hazard_statuses) &&
    data.hazard_statuses.includes('PENDING_COUNTERSIGNATURE') &&
    Array.isArray(data?.semantic_verdicts) &&
    data.semantic_verdicts.includes('MITIGATION_SUFFICIENT') &&
    data.semantic_verdicts.includes('SAFETY_GAP')

  if (!ok) {
    throw new Error(
      `Contract at ${CONTRACT_ADDRESS} does not expose the expected SafetyCaseGate v2.0 schema. Writes are disabled until the deployment address is corrected.`,
    )
  }
}

function assertExpectedSystem(value: unknown): asserts value is SystemRecord {
  const data = value as Partial<SystemRecord> | null
  const ok = Boolean(data) &&
    typeof data?.system_id === 'number' &&
    typeof data?.owner === 'string' &&
    typeof data?.reviewer === 'string' &&
    typeof data?.required_hazard_count === 'number' &&
    typeof data?.covered_count === 'number' &&
    typeof data?.open_count === 'number' &&
    typeof data?.pending_count === 'number' &&
    typeof data?.mitigation_count === 'number' &&
    typeof data?.challenge_count === 'number' &&
    typeof data?.all_hazards_covered === 'boolean' &&
    typeof data?.release_ready === 'boolean' &&
    typeof data?.released_by === 'string'
  if (!ok) throw new Error('Loaded system is incompatible with SafetyCaseGate v2.0.')
}

export async function getConfig(): Promise<GateConfig> {
  const value = await read<unknown>('get_config', [])
  assertExpectedConfig(value)
  return value
}

export async function getSystem(systemId: number): Promise<SystemRecord> {
  const value = await read<unknown>('get_system', [systemId])
  assertExpectedSystem(value)
  return value
}

export const getHazard = (systemId: number, hazardIndex: number) =>
  read<HazardRecord>('get_hazard', [systemId, hazardIndex])

export const getHazards = (systemId: number, fromIndex = 1, count = 8) =>
  read<HazardRecord[]>('get_hazards', [systemId, fromIndex, count])

export const getSystemMitigations = (systemId: number, fromIndex = 1, count = 50) =>
  read<SystemMitigation[]>('get_system_mitigations', [systemId, fromIndex, count])

export const getHazardAttempts = (
  systemId: number,
  hazardIndex: number,
  fromIndex = 1,
  count = 50,
) => read<HazardAttempt[]>('get_hazard_attempts', [systemId, hazardIndex, fromIndex, count])

export const getChallenges = (systemId: number, fromIndex = 1, count = 50) =>
  read<ChallengeRecord[]>('get_challenges', [systemId, fromIndex, count])

export const createSystem = (
  account: Address,
  systemPurpose: string,
  hazardsJson: string,
  reviewer: string,
) => write(account, 'create_system', [systemPurpose, hazardsJson, reviewer])

export const submitMitigation = (
  account: Address,
  systemId: number,
  hazardIndex: number,
  mitigationText: string,
  evidenceDigest: string,
) => write(account, 'submit_mitigation', [systemId, hazardIndex, mitigationText, evidenceDigest])

export const countersignMitigation = (account: Address, systemId: number, hazardIndex: number) =>
  write(account, 'countersign_mitigation', [systemId, hazardIndex])

export const challengeCoverage = (
  account: Address,
  systemId: number,
  hazardIndex: number,
  reason: string,
) => write(account, 'challenge_coverage', [systemId, hazardIndex, reason])

export const reopenAttempts = (account: Address, systemId: number, hazardIndex: number) =>
  write(account, 'reopen_attempts', [systemId, hazardIndex])

export const markReleaseReady = (account: Address, systemId: number) =>
  write(account, 'mark_release_ready', [systemId])

function sameAddress(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase()
}

function sameStringList(a: string[], b: string[]) {
  return a.length === b.length && a.every((item, index) => item === b[index])
}

export async function waitForCreatedSystem(
  account: Address,
  reviewer: string,
  purpose: string,
  hazards: string[],
  beforeSystemCount: number,
  timeoutMs = 180_000,
): Promise<StateWaitResult<SystemRecord>> {
  const startedAt = Date.now()
  const checked = new Set<number>()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const config = await getConfig()
      const upper = Math.min(config.system_count, beforeSystemCount + 50)
      for (let id = beforeSystemCount + 1; id <= upper; id += 1) {
        if (checked.has(id)) continue
        try {
          const system = await getSystem(id)
          if (
            sameAddress(system.owner, account) &&
            sameAddress(system.reviewer, reviewer) &&
            system.system_purpose === purpose
          ) {
            const onchainHazards = await getHazards(id, 1, system.required_hazard_count)
            if (sameStringList(onchainHazards.map((item) => item.text), hazards)) {
              return { status: 'confirmed', value: system }
            }
          }
          checked.add(id)
        } catch {
          // Retry this id after transient finalization/read failures.
        }
      }
    } catch {
      // Retry config while the write finalizes.
    }
    const remaining = timeoutMs - (Date.now() - startedAt)
    if (remaining <= 0) break
    await sleep(Math.min(4_000, remaining))
  }
  return { status: 'pending' }
}
