import { NextResponse } from 'next/server'
import {
  IDENTITY_COOKIE,
  IDENTITY_MAX_AGE_SECONDS,
  identityCookieAttributes,
  readCookieValue,
  signIdentity,
  verifyJson,
} from '@/lib/gavel/auth'
import { LIMITS, clientIp, enforce, rule } from '@/lib/gavel/rate-limit'
import { rateLimitHit } from '@/lib/gavel/server'
import {
  OAUTH_STATE_COOKIE,
  oauthConfigured,
  publicOrigin,
  safeReturnTo,
  whoSignedIn,
  type OAuthState,
} from '@/lib/gavel/zoom-oauth'

// Where Zoom sends the person back. Every way this can go wrong ends the same
// way, with a redirect to the page they came from and a flag the panel turns
// into a plain message, and with the handshake cookie gone so a code cannot be
// replayed.
function back(request: Request, returnTo: string, failed: boolean) {
  const target = new URL(returnTo, publicOrigin(request))
  if (failed) target.searchParams.set('signin', 'failed')
  const response = NextResponse.redirect(target, 302)
  response.cookies.set({ name: OAUTH_STATE_COOKIE, value: '', path: '/api/oauth', maxAge: 0 })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

export async function GET(request: Request) {
  if (!oauthConfigured()) {
    return NextResponse.json({ error: 'sign-in with Zoom is not set up' }, { status: 503 })
  }
  const limited = await enforce([rule(`oauth:ip:${clientIp(request)}`, LIMITS.oauthPerIp)])
  if (limited) return limited

  const sessionSecret = process.env.SESSION_SECRET as string
  const saved = await verifyJson<OAuthState>(readCookieValue(request, OAUTH_STATE_COOKIE), sessionSecret)
  const returnTo = safeReturnTo(saved?.returnTo ?? null)
  const params = new URL(request.url).searchParams

  if (!saved || typeof saved.exp !== 'number' || saved.exp <= Date.now()) return back(request, returnTo, true)
  // The person said no, or Zoom reported a problem.
  if (params.get('error')) return back(request, returnTo, true)
  const code = params.get('code')
  const state = params.get('state')
  if (!code || code.length > 2048 || !state || state !== saved.state) return back(request, returnTo, true)

  // One attempt per handshake. The cookie is cleared in the browser, but a
  // copy of it is still a valid signature, so the server remembers the state
  // it has seen and answers a repeat as a failure without calling Zoom.
  try {
    const wait = await rateLimitHit([{ bucket: `oauth:state:${saved.state}`, limit: 1, windowSeconds: 600 }])
    if (wait > 0) return back(request, returnTo, true)
  } catch {
    // The counter is a second line of defence; the single-use code is the first.
  }

  let who: Awaited<ReturnType<typeof whoSignedIn>> = null
  try {
    who = await whoSignedIn(code, saved.verifier, request)
  } catch (error) {
    console.warn('zoom sign-in exchange failed:', error instanceof Error ? error.message : 'unknown')
  }
  if (!who) return back(request, returnTo, true)

  const now = Date.now()
  const response = back(request, returnTo, false)
  response.cookies.set({
    name: IDENTITY_COOKIE,
    value: await signIdentity(
      { v: 1, uid: who.id, mid: null, nm: who.name, iat: now, exp: now + IDENTITY_MAX_AGE_SECONDS * 1000 },
      sessionSecret,
    ),
    ...identityCookieAttributes(publicOrigin(request).startsWith('https:') || process.env.NODE_ENV === 'production'),
  })
  return response
}
