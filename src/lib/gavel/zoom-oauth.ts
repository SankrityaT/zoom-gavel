// "Sign in with Zoom" for people bidding from a browser instead of the Zoom
// client. Standard OAuth 2.0 authorization code flow with PKCE. We keep
// nothing from it: the access token is used once, to ask Zoom who signed in,
// then dropped. The result is the same signed identity cookie in-meeting
// bidders get, with the same bidder key, so one person is one bidder.
//
// The bases are overridable so a test can stand in for Zoom.

// The bases can be pointed at a stand-in for Zoom, but only when a test says so
// explicitly. In production a stray variable would send the client secret
// somewhere else, so without the opt-in they are ignored.
const overridable = () => process.env.ZOOM_OAUTH_ALLOW_OVERRIDE === '1'
const OAUTH_BASE = () => (overridable() && process.env.ZOOM_OAUTH_BASE) || 'https://zoom.us'
const API_BASE = () => (overridable() && process.env.ZOOM_API_BASE) || 'https://api.zoom.us'

export const OAUTH_STATE_COOKIE = 'gavel_oauth'
export const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60

export type OAuthState = { state: string; verifier: string; returnTo: string; exp: number }

export function oauthConfigured() {
  return Boolean(process.env.ZOOM_CLIENT_ID && process.env.ZOOM_CLIENT_SECRET && process.env.SESSION_SECRET)
}

// Where to come back to: a path on this site, and nothing else. Anything that
// could leave the site (another host, a protocol-relative URL) is dropped.
export function safeReturnTo(value: string | null) {
  if (!value || value.length > 300) return '/zoom-test'
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/zoom-test'
  try {
    const url = new URL(value, 'https://placeholder.invalid')
    if (url.origin !== 'https://placeholder.invalid') return '/zoom-test'
  } catch {
    return '/zoom-test'
  }
  return value
}

function base64Url(bytes: Uint8Array) {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function randomToken(byteLength: number) {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteLength)))
}

export async function codeChallenge(verifier: string) {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
}

// The address people use to reach this site, which is what Zoom was told to
// send them back to. PUBLIC_ORIGIN pins it; otherwise the proxy's forwarded
// host (Vercel sets it); otherwise the request's own. Zoom only honours a
// redirect address registered in advance, so a forged host gets nowhere.
export function publicOrigin(request: Request) {
  const pinned = process.env.PUBLIC_ORIGIN
  if (pinned) return pinned.replace(/\/+$/, '')
  const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  if (host && /^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host)) {
    const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() === 'http' ? 'http' : 'https'
    return `${proto}://${host}`
  }
  return new URL(request.url).origin
}

export function redirectUri(request: Request) {
  return `${publicOrigin(request)}/api/oauth/zoom/callback`
}

export async function authorizeUrl(request: Request, state: string, verifier: string) {
  const url = new URL('/oauth/authorize', OAUTH_BASE())
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', process.env.ZOOM_CLIENT_ID as string)
  url.searchParams.set('redirect_uri', redirectUri(request))
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', await codeChallenge(verifier))
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

// Trades the one-time code for a token, asks Zoom who it belongs to, and
// returns only the id and a display name.
export async function whoSignedIn(
  code: string,
  verifier: string,
  request: Request,
): Promise<{ id: string; name: string } | null> {
  const clientId = process.env.ZOOM_CLIENT_ID as string
  const clientSecret = process.env.ZOOM_CLIENT_SECRET as string
  const tokenResponse = await fetch(`${OAUTH_BASE()}/oauth/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(request),
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(8000),
  })
  if (!tokenResponse.ok) return null
  const token = (await tokenResponse.json()) as { access_token?: unknown }
  if (typeof token.access_token !== 'string' || !token.access_token) return null

  const meResponse = await fetch(`${API_BASE()}/v2/users/me`, {
    headers: { authorization: `Bearer ${token.access_token}` },
    signal: AbortSignal.timeout(8000),
  })
  if (!meResponse.ok) return null
  const me = (await meResponse.json()) as {
    id?: unknown
    display_name?: unknown
    first_name?: unknown
    last_name?: unknown
  }
  if (typeof me.id !== 'string' || !me.id) return null
  const joined = [me.first_name, me.last_name].filter((p): p is string => typeof p === 'string' && p !== '').join(' ')
  const name = (typeof me.display_name === 'string' && me.display_name ? me.display_name : joined).trim()
  return { id: me.id, name: (name || 'Zoom user').slice(0, 60) }
}
