// Zoom webhook verification. Zoom signs every event, including the
// endpoint.url_validation challenge:
//   x-zm-signature: v0=<hex HMAC-SHA256(secretToken, "v0:<timestamp>:<raw body>")>
// Web Crypto only, and MACs are compared by subtle.verify, never as strings.

const encoder = new TextEncoder()
// Zoom retries a failed delivery after 5, 20 and 60 minutes, and does not say
// whether a retry carries a fresh timestamp. A tight window would reject the
// retry of an event we deliberately answered 500 to. Every event we act on is
// idempotent or ordered (the host is set to the same host, co-host rows keep
// the newest event_ts, erasure repeats harmlessly), so a replay inside this
// window can change nothing that was not already true.
const MAX_SKEW_SECONDS = 65 * 60

async function hmacKey(secret: string, usages: KeyUsage[]) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages,
  )
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2))
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

export async function hmacHex(secret: string, message: string) {
  const key = await hmacKey(secret, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)))
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('')
}

// Zoom sends the timestamp in seconds; tolerate milliseconds too.
function timestampSeconds(raw: string | null) {
  if (!raw || !/^\d+$/.test(raw)) return null
  const n = Number(raw)
  return n > 1e12 ? Math.floor(n / 1000) : n
}

export async function verifyZoomWebhook(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
  secretToken: string,
  now: number = Date.now(),
): Promise<boolean> {
  const ts = timestampSeconds(timestamp)
  if (ts === null || Math.abs(now / 1000 - ts) > MAX_SKEW_SECONDS) return false
  if (!signature?.startsWith('v0=')) return false
  const expected = hexToBytes(signature.slice(3))
  if (!expected) return false
  const key = await hmacKey(secretToken, ['verify'])
  return crypto.subtle.verify(
    'HMAC',
    key,
    expected,
    encoder.encode(`v0:${timestamp}:${rawBody}`),
  )
}

// Constant-time equality for two secrets of any length: both are MACed with a
// throwaway key and the digests compared without early exit.
export async function secretsMatch(a: string, b: string) {
  const key = await crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const [da, db] = await Promise.all([crypto.subtle.sign('HMAC', key, encoder.encode(a)), crypto.subtle.sign('HMAC', key, encoder.encode(b))])
  const x = new Uint8Array(da)
  const y = new Uint8Array(db)
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

export type ZoomWebhookEvent = {
  event?: string
  /** Milliseconds since the epoch, when Zoom produced the event. */
  event_ts?: number
  payload?: {
    plainToken?: string
    object?: {
      uuid?: string
      host_id?: string
      id?: string | number
      /** meeting.participant_role_changed: who changed, and to what. */
      participant?: { participant_user_id?: string; old_role?: string; new_role?: string }
    }
    /** app_deauthorized: the person who removed the app. */
    user_id?: string
  }
}
