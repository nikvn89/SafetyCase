/**
 * Error normalisation for wallet / RPC failures.
 *
 * Why this file exists: `String(err)` on a non-Error value produces the literal
 * text "[object Object]". Wallet providers reject with serialised EIP-1193
 * objects ({ code, message, data }), not Error instances, so every raw
 * `String(err)` in the UI was showing that string instead of a reason.
 *
 * Two rules:
 *   1. never render a raw thrown value;
 *   2. always console.error the raw value, so the next reproduction is
 *      diagnosable without another round trip.
 */

export type NormalizedError = {
  message: string
  code?: number | string
  raw: unknown
}

/** EIP-1193 / MetaMask codes this app can actually produce. */
const CODE_MESSAGES: Record<string, string> = {
  '4001': 'You rejected the request in your wallet.',
  '4100':
    'Your wallet has not authorised this account. Unlock MetaMask and try again.',
  '4902': 'GenLayer Studio is not added to your wallet yet.',
  '-32002':
    'MetaMask already has a pending request. Open the extension and finish it first.',
  '-32601':
    'Your wallet does not support the GenLayer Snap. The Snap is optional — you can keep using the app.',
  '-32603':
    'Your wallet reported an internal error. Check that MetaMask is on GenLayer Studio (chain 61999).',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Providers often wrap the real EIP-1193 code inside .data/.cause/.error.
 *
 * Example seen in browsers:
 *   outer code = -1 (generic RPC wrapper)
 *   nested code = 4902 (chain not added)
 *
 * Prefer a known actionable wallet code anywhere in the wrapper tree before
 * falling back to an outer generic code. This lets ensureStudioChain() detect
 * 4902 and call wallet_addEthereumChain instead of surfacing "code -1".
 */
const KNOWN_CODES = new Set(Object.keys(CODE_MESSAGES))

export function errorCode(value: unknown, depth = 0): number | string | undefined {
  if (!isRecord(value) || depth > 5) return undefined

  const direct = value.code ?? value.errorCode
  const hasDirect = typeof direct === 'number' || typeof direct === 'string'

  if (hasDirect && KNOWN_CODES.has(String(direct))) {
    return direct as number | string
  }

  let nestedFallback: number | string | undefined

  for (const key of ['data', 'cause', 'error', 'originalError'] as const) {
    const nested: unknown = value[key]
    if (nested && nested !== value) {
      const found = errorCode(nested, depth + 1)
      if (found !== undefined) {
        if (KNOWN_CODES.has(String(found))) return found
        if (nestedFallback === undefined) nestedFallback = found
      }
    }
  }

  if (hasDirect) return direct as number | string
  return nestedFallback
}

function errorMessage(value: unknown, depth = 0): string | undefined {
  if (depth > 4) return undefined
  if (typeof value === 'string') return value.trim() || undefined
  if (!isRecord(value)) return undefined

  for (const key of ['shortMessage', 'message', 'reason'] as const) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }

  for (const key of ['data', 'cause', 'error', 'originalError'] as const) {
    const nested: unknown = value[key]
    if (nested && nested !== value) {
      const found = errorMessage(nested, depth + 1)
      if (found) return found
    }
  }

  return undefined
}

export function normalizeError(raw: unknown): NormalizedError {
  const code = errorCode(raw)
  const known = code === undefined ? undefined : CODE_MESSAGES[String(code)]

  let message = known ?? errorMessage(raw)

  if (!message) {
    message =
      'Unexpected wallet or network error. Open the browser console for the raw details.'
  }

  // viem / JSON-RPC messages are multi-line blobs. Keep the first line only so
  // the banner stays readable; the full object is in the console.
  message = message.split('\n')[0]!.trim().slice(0, 240)

  return { message, ...(code === undefined ? {} : { code }), raw }
}

/** True when the user dismissed a wallet prompt rather than hitting a fault. */
export function isUserRejection(raw: unknown): boolean {
  return String(errorCode(raw) ?? '') === '4001'
}

/**
 * Log the raw value and return a string safe to show in the UI.
 * Use this at every catch site instead of `String(err)`.
 */
export function reportError(context: string, raw: unknown): string {
  const normalized = normalizeError(raw)

  console.error(`[SafetyCase] ${context} failed`, {
    code: normalized.code,
    message: normalized.message,
    raw,
  })

  return normalized.code === undefined
    ? normalized.message
    : `${normalized.message} (code ${normalized.code})`
}
