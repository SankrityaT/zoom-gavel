import { IDENTITY_MAX_AGE_SECONDS, signIdentity } from './auth'
import { decryptZoomContext } from './zoom-context'

// Turns a Zoom app-context token into the signed identity cookie value.
// The token reaches us two ways: as the x-zoom-app-context header on the
// Home URL request (src/proxy.ts), and from zoomSdk.getAppContext() posted
// to /api/identity. The second exists because the first is not dependable:
// in a real meeting the panel loaded several times with no usable identity.
export type IdentityIssue =
  | { ok: true; cookieValue: string }
  | { ok: false; reason: 'not_configured' | 'rejected'; detail?: string }

export async function issueIdentity(contextToken: string): Promise<IdentityIssue> {
  const clientSecret = process.env.ZOOM_CLIENT_SECRET
  const sessionSecret = process.env.SESSION_SECRET
  if (!clientSecret || !sessionSecret) return { ok: false, reason: 'not_configured' }
  try {
    const context = await decryptZoomContext(contextToken, clientSecret)
    const now = Date.now()
    const cookieValue = await signIdentity(
      {
        v: 1,
        uid: context.uid,
        mid: context.mid,
        iat: now,
        exp: now + IDENTITY_MAX_AGE_SECONDS * 1000,
      },
      sessionSecret,
    )
    return { ok: true, cookieValue }
  } catch (error) {
    return { ok: false, reason: 'rejected', detail: error instanceof Error ? error.message : 'unknown' }
  }
}
