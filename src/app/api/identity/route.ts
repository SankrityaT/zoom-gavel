import { NextResponse } from 'next/server'
import { IDENTITY_COOKIE, identityCookieAttributes } from '@/lib/gavel/auth'
import { issueIdentity } from '@/lib/gavel/identity'
import { LIMITS, clientIp, enforce, rule } from '@/lib/gavel/rate-limit'
import { boundedString, rejectCrossSite } from '@/lib/gavel/validate'

// The panel's own way to prove who it is: it asks the Zoom client for a
// signed app-context token (zoomSdk.getAppContext) and posts it here. The
// token is the same encrypted blob Zoom sends as x-zoom-app-context, so it
// is verified the same way, and only a real Zoom client can produce one.
export async function POST(request: Request) {
  const crossSite = rejectCrossSite(request)
  if (crossSite) return NextResponse.json({ error: crossSite }, { status: 403 })
  const limited = await enforce([rule(`identity:ip:${clientIp(request)}`, LIMITS.identityPerIp)])
  if (limited) return limited

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 })
  }
  const token = boundedString((body as Record<string, unknown>).context, 8192)
  if (token === null) return NextResponse.json({ error: 'context is required' }, { status: 400 })

  const issued = await issueIdentity(token)
  if (!issued.ok) {
    if (issued.reason === 'not_configured') {
      return NextResponse.json({ error: 'identity not configured' }, { status: 503 })
    }
    console.warn('identity token rejected:', issued.detail)
    return NextResponse.json({ error: 'invalid context' }, { status: 401 })
  }

  const response = NextResponse.json({ verified: true })
  const secure = new URL(request.url).protocol === 'https:' || process.env.NODE_ENV === 'production'
  response.cookies.set({
    name: IDENTITY_COOKIE,
    value: issued.cookieValue,
    ...identityCookieAttributes(secure),
  })
  return response
}
