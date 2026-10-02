import { NextResponse, type NextRequest } from 'next/server'
import { IDENTITY_COOKIE, identityCookieAttributes } from '@/lib/gavel/auth'
import { issueIdentity } from '@/lib/gavel/identity'

// Zoom attaches x-zoom-app-context to the Home URL request. This turns that
// proof of identity into a signed cookie the API routes trust. Never blocks
// the page: a missing or bad header just means the panel establishes
// identity itself through /api/identity once the SDK is up.

export const config = {
  matcher: ['/zoom-test'],
}

export async function proxy(request: NextRequest) {
  const header = request.headers.get('x-zoom-app-context')
  if (!header) {
    // Worth knowing when Zoom's own client loads the page without it.
    if (/zoom/i.test(request.headers.get('user-agent') ?? '')) {
      console.info('zoom context: absent on a Zoom client page load')
    }
    return NextResponse.next()
  }

  const response = NextResponse.next()
  const issued = await issueIdentity(header)
  if (issued.ok) {
    const secure = request.nextUrl.protocol === 'https:' || process.env.NODE_ENV === 'production'
    response.cookies.set({
      name: IDENTITY_COOKIE,
      value: issued.cookieValue,
      ...identityCookieAttributes(secure),
    })
    console.info('zoom context: identity issued from the page-load header')
  } else if (issued.reason === 'rejected') {
    console.warn('zoom context rejected:', issued.detail)
    response.cookies.delete(IDENTITY_COOKIE)
  } else {
    console.warn('zoom context ignored: ZOOM_CLIENT_SECRET or SESSION_SECRET unset')
  }
  return response
}
