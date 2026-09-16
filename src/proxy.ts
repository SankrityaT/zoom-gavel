import { NextResponse, type NextRequest } from 'next/server'
import {
  IDENTITY_COOKIE,
  IDENTITY_MAX_AGE_SECONDS,
  identityCookieAttributes,
  signIdentity,
} from '@/lib/gavel/auth'
import { describeError } from '@/lib/gavel/demo'
import { decryptZoomContext } from '@/lib/gavel/zoom-context'

// Zoom attaches x-zoom-app-context only to the Home URL request. This turns
// that one-time proof of identity into a signed cookie the API routes trust.
// Never blocks the page: a bad header just means an unverified viewer.

export const config = {
  matcher: ['/zoom-test'],
}

let warnedMissingSecrets = false

export async function proxy(request: NextRequest) {
  const header = request.headers.get('x-zoom-app-context')
  if (!header) return NextResponse.next()

  const response = NextResponse.next()
  const clientSecret = process.env.ZOOM_CLIENT_SECRET
  const sessionSecret = process.env.SESSION_SECRET
  if (!clientSecret || !sessionSecret) {
    if (!warnedMissingSecrets) {
      console.warn('zoom context ignored: ZOOM_CLIENT_SECRET or SESSION_SECRET unset')
      warnedMissingSecrets = true
    }
    return response
  }

  try {
    const context = await decryptZoomContext(header, clientSecret)
    const now = Date.now()
    const value = await signIdentity(
      {
        v: 1,
        uid: context.uid,
        mid: context.mid,
        iat: now,
        exp: now + IDENTITY_MAX_AGE_SECONDS * 1000,
      },
      sessionSecret,
    )
    const secure =
      request.nextUrl.protocol === 'https:' || process.env.NODE_ENV === 'production'
    response.cookies.set({
      name: IDENTITY_COOKIE,
      value,
      ...identityCookieAttributes(secure),
    })
  } catch (error) {
    console.warn('zoom context rejected:', describeError(error))
    response.cookies.delete(IDENTITY_COOKIE)
  }

  return response
}
