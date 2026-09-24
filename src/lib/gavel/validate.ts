import { MAX_BID } from './demo'
export { anonBidderKey } from './demo'

// Positive integer within the bid ceiling, or null.
export function boundedInt(value: unknown, min: number, max: number = MAX_BID): number | null {
  if (!Number.isInteger(value)) return null
  const n = value as number
  if (n < min || n > max) return null
  return n
}

export function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > max) return null
  return trimmed
}

// The identity cookie is SameSite=None (the Zoom web client embeds the app
// cross-site), so browser POSTs must prove same-origin: reject a foreign
// Origin header and any non-JSON body. Non-browser clients send no Origin.
export function rejectCrossSite(request: Request): string | null {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return 'content-type must be application/json'
  }
  const origin = request.headers.get('origin')
  if (origin) {
    // Compare hosts from the headers the browser actually used. request.url
    // is rewritten to localhost by `next start` and behind the dev tunnel,
    // which would reject legitimate same-origin posts. A cross-site page
    // cannot set Host or X-Forwarded-Host, so this stays a CSRF guard.
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
    let originHost: string | null = null
    try {
      originHost = new URL(origin).host
    } catch {
      originHost = null
    }
    if (!host || originHost !== host) return 'cross-site request rejected'
  }
  return null
}

// Session keys are base64url meeting ids (mtg-...) or demo/join ids.
const SESSION_KEY_PATTERN = /^[A-Za-z0-9_-]{1,200}$/

export function isSessionKey(value: string) {
  return SESSION_KEY_PATTERN.test(value)
}
