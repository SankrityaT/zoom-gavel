import { NextResponse } from 'next/server'
import {
  IDENTITY_COOKIE,
  identityCookieAttributes,
  readCookieValue,
  verifyIdentity,
} from '@/lib/gavel/auth'
import { rejectCrossSite } from '@/lib/gavel/validate'
import { oauthConfigured } from '@/lib/gavel/zoom-oauth'

// What a browser needs to know about itself: whether it is signed in with
// Zoom (and under what name), and whether signing in is on offer at all.
export async function GET(request: Request) {
  const secret = process.env.SESSION_SECRET
  const identity = secret ? await verifyIdentity(readCookieValue(request, IDENTITY_COOKIE), secret) : null
  return NextResponse.json(
    {
      signedIn: identity !== null,
      // Only a browser sign-in carries a name; in a meeting the panel has Zoom's.
      name: identity?.nm ?? null,
      canSignIn: oauthConfigured(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

// Sign out: forget the identity cookie.
export async function DELETE(request: Request) {
  const crossSite = rejectCrossSite(request)
  if (crossSite) return NextResponse.json({ error: crossSite }, { status: 403 })
  const response = NextResponse.json({ signedIn: false })
  response.cookies.set({
    name: IDENTITY_COOKIE,
    value: '',
    ...identityCookieAttributes(new URL(request.url).protocol === 'https:' || process.env.NODE_ENV === 'production'),
    maxAge: 0,
  })
  return response
}
