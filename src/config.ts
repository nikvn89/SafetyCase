const FALLBACK_CONTRACT_ADDRESS =
  '0x26F508c59e7874dE289C8B8ae0F7937D229d621F' as const

const envAddress = (import.meta.env.VITE_CONTRACT_ADDRESS ?? '').trim()

export const CONTRACT_ADDRESS =
  /^0x[a-fA-F0-9]{40}$/.test(envAddress)
    ? (envAddress as `0x${string}`)
    : FALLBACK_CONTRACT_ADDRESS

export const FROZEN_SOURCE_SHA256 =
  '27afc982cffd9f6abdb960a9bf7ec9de07714ca12a23dd16b21f224753abd06f' as const

export const EXPLORER_BASE = 'https://explorer-studio.genlayer.com'
export const STUDIO_CHAIN_ID = 61999
export const MAX_SYSTEM_PURPOSE_LENGTH = 1000
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
