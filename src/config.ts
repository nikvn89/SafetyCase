const FALLBACK_CONTRACT_ADDRESS =
  '0x463e2c0FEc2AD2251C7625B1C15d61E004395c09' as const

const envAddress = (import.meta.env.VITE_CONTRACT_ADDRESS ?? '').trim()

export const CONTRACT_ADDRESS =
  /^0x[a-fA-F0-9]{40}$/.test(envAddress)
    ? (envAddress as `0x${string}`)
    : FALLBACK_CONTRACT_ADDRESS

export const RUNTIME_EVIDENCE_ADDRESS =
  '0xf1FBdC8FA38adEaf2b34c897afe8a3168fc0E6ED' as const

export const FROZEN_SOURCE_SHA256 =
  '386a5f54a141c7a6010bd057308d1895aa2c8083d0f89348f41cb52f2f62edc1' as const

export const EXPLORER_BASE = 'https://explorer-studio.genlayer.com'
export const STUDIO_CHAIN_ID = 61999
export const MAX_SYSTEM_PURPOSE_LENGTH = 1000
