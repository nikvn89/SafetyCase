const FALLBACK_CONTRACT_ADDRESS =
  '0xFbF0a1890e8dAe6907B4DBC9Fbb023A3d13Edd8e' as const

const envAddress = (import.meta.env.VITE_CONTRACT_ADDRESS ?? '').trim()

export const CONTRACT_ADDRESS =
  /^0x[a-fA-F0-9]{40}$/.test(envAddress)
    ? (envAddress as `0x${string}`)
    : FALLBACK_CONTRACT_ADDRESS

export const EXPLORER_BASE = 'https://explorer-studio.genlayer.com'
export const STUDIO_CHAIN_ID = 61999
export const MAX_SYSTEM_PURPOSE_LENGTH = 1000

export const DEMO_PURPOSE_PREFIX = 'Autonomous treasury agent safety case'

export const DEMO_HAZARDS = [
  'The agent can send an irreversible payment to the wrong recipient.',
  'The agent can write an API key into diagnostic logs.',
]

export const DEMO_MITIGATIONS = {
  weakPayment:
    'The agent records every payment in an audit log after the transfer completes.',
  strongPayment:
    'Any transfer to an address outside the immutable recipient allowlist requires approval from a second signer before the transaction can be signed, and the agent does not hold that second signing key.',
  apiRedaction:
    'Diagnostic logging uses a redaction layer that removes credential-pattern values before log serialization, and the logging process receives only the redacted payload rather than the raw API key.',
}
