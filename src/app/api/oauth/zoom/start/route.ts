import { NextResponse } from 'next/server'
import { LIMITS, clientIp, enforce, rule } from '@/lib/gavel/rate-limit'
import { signJson } from '@/lib/gavel/auth'
import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_MAX_AGE_SECONDS,
  authorizeUrl,
  oauthConfigured,
  publicOrigin,
  randomToken,
  safeReturnTo,
  type OAuthState,
} from '@/lib/gavel/zoom-oauth'

// Starts "Sign in with Zoom": remembers a one-time state and PKCE verifier in
// a short-lived signed cookie (so only this browser can finish the sign-in),
// then sends the person to Zoom.
export async function GET(request: Request) {
  if (!oauthConfigured()) {
    return NextResponse.json({ error: 'sign-in with Zoom is not set up' }, { status: 503 })
  }
  const limited = await enforce([rule(`oauth:ip:${clientIp(request)}`, LIMITS.oauthPerIp)])
  if (limited) return limited

  const state = randomToken(16)
  const verifier = randomToken(32)
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get('return'))
  const cookie: OAuthState = { state, verifier, returnTo, exp: Date.now() + OAUTH_STATE_MAX_AGE_SECONDS * 1000 }

  const response = NextResponse.redirect(await authorizeUrl(request, state, verifier), 302)
  response.cookies.set({
    name: OAUTH_STATE_COOKIE,
    value: await signJson(cookie, process.env.SESSION_SECRET as string),
    httpOnly: true,
    secure: publicOrigin(request).startsWith('https:') || process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/oauth',
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
  })
  response.headers.set('Cache-Control', 'no-store')
  return response
}
