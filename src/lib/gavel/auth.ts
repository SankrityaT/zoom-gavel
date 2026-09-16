// Signed identity cookie minted from a verified Zoom app context, plus the
// viewer resolution every API route uses. Web Crypto only.

import { toSessionKey } from './demo'

export const IDENTITY_COOKIE = 'gavel_ctx'
export const IDENTITY_MAX_AGE_SECONDS = 6 * 60 * 60

export type Identity = {
  v: 1
  uid: string
  mid: string | null
  iat: number
  exp: number
}

export type Viewer = {
  verified: boolean
  /** Public, non-reversible identity used in bids. Null when unverified. */
  bidderKey: string | null
  inThisMeeting: boolean
  identity: Identity | null
}

const encoder = new TextEncoder()

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function hmacKey(secret: string, usages: KeyUsage[]) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages,
  )
}

export async function signIdentity(identity: Identity, secret: string) {
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify(identity)))
  const key = await hmacKey(secret, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return `${payload}.${bytesToBase64Url(new Uint8Array(sig))}`
}

// Constant-time verification via subtle.verify; never string-compare MACs.
export async function verifyIdentity(
  cookie: string | undefined,
  secret: string,
  now: number = Date.now(),
): Promise<Identity | null> {
  if (!cookie) return null
  const dot = cookie.indexOf('.')
  if (dot <= 0) return null
  const payload = cookie.slice(0, dot)
  const sig = cookie.slice(dot + 1)
  try {
    const key = await hmacKey(secret, ['verify'])
    const ok = await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlToBytes(sig),
      encoder.encode(payload),
    )
    if (!ok) return null
    const parsed = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(payload)),
    ) as Partial<Identity>
    if (parsed.v !== 1 || typeof parsed.uid !== 'string' || !parsed.uid) return null
    if (typeof parsed.exp !== 'number' || parsed.exp <= now) return null
    return {
      v: 1,
      uid: parsed.uid,
      mid: typeof parsed.mid === 'string' ? parsed.mid : null,
      iat: typeof parsed.iat === 'number' ? parsed.iat : 0,
      exp: parsed.exp,
    }
  } catch {
    return null
  }
}

// Public bidder identity: HMAC of the subject, truncated. Raw Zoom uids never
// reach the publicly readable tables.
export async function bidderKey(subject: string, secret: string) {
  const key = await hmacKey(secret, ['sign'])
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(subject)),
  )
  return Array.from(sig.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('')
}

export function meetingSessionKey(mid: string) {
  return `mtg-${toSessionKey(mid)}`
}

export function isMeetingSession(sessionKey: string) {
  return sessionKey.startsWith('mtg-')
}

function readCookie(request: Request, name: string) {
  const header = request.headers.get('cookie')
  if (!header) return undefined
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return rest.join('=')
  }
  return undefined
}

export async function readViewer(request: Request, sessionKey: string): Promise<Viewer> {
  const secret = process.env.SESSION_SECRET
  if (!secret) return { verified: false, bidderKey: null, inThisMeeting: false, identity: null }

  const identity = await verifyIdentity(readCookie(request, IDENTITY_COOKIE), secret)
  if (!identity) return { verified: false, bidderKey: null, inThisMeeting: false, identity: null }

  return {
    verified: true,
    bidderKey: await bidderKey(`zoom:${identity.uid}`, secret),
    inThisMeeting: identity.mid !== null && meetingSessionKey(identity.mid) === sessionKey,
    identity,
  }
}

export function identityCookieAttributes(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: 'none' as const,
    path: '/',
    maxAge: IDENTITY_MAX_AGE_SECONDS,
    partitioned: true,
  }
}
