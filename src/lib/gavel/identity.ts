import { IDENTITY_MAX_AGE_SECONDS, signIdentity } from './auth'
import { decryptZoomContext } from './zoom-context'

// Turns a Zoom app-context token into the signed identity cookie value.
// The token reaches us two ways: as the x-zoom-app-context header on the
// Home URL request (src/proxy.ts), and from zoomSdk.getAppContext() posted
// to /api/identity. The second exists because the first is not dependable:
// in a real meeting the panel loaded several times with no usable identity.
// ZOOM_CLIENT_SECRET may hold several Client Secrets, comma separated. The
// first is the one Sign in with Zoom uses together with ZOOM_CLIENT_ID.
export function clientSecretList() {
  return (process.env.ZOOM_CLIENT_SECRET ?? '')
    .split(',')
    .map((secret) => secret.trim())
    .filter(Boolean)
}

export type IdentityIssue =
  | { ok: true; cookieValue: string }
  | { ok: false; reason: 'not_configured' | 'rejected'; detail?: string }

export async function issueIdentity(contextToken: string): Promise<IdentityIssue> {
  const clientSecrets = clientSecretList()
  const sessionSecret = process.env.SESSION_SECRET
  if (clientSecrets.length === 0 || !sessionSecret) return { ok: false, reason: 'not_configured' }
  try {
    // The Development and Production apps each encrypt with their own Client
    // Secret, so a context may be sealed with any of the configured ones. A
    // forged or damaged one fails against all of them.
    let context: Awaited<ReturnType<typeof decryptZoomContext>> | null = null
    let lastError: unknown = null
    for (const secret of clientSecrets) {
      try {
        context = await decryptZoomContext(contextToken, secret)
        break
      } catch (error) {
        lastError = error
      }
    }
    if (!context) throw lastError instanceof Error ? lastError : new Error('context rejected')
    const now = Date.now()
    const cookieValue = await signIdentity(
      {
        v: 1,
        uid: context.uid,
        // One auction per meeting: inside a breakout room that is the main meeting.
        mid: context.pid ?? context.mid,
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
