import { NextResponse } from 'next/server'
import { bidderKey, meetingSessionKey } from '@/lib/gavel/auth'
import { LIMITS, clientIp, enforce, rule } from '@/lib/gavel/rate-limit'
import { setMeetingHost } from '@/lib/gavel/server'
import { hmacHex, verifyZoomWebhook, type ZoomWebhookEvent } from '@/lib/gavel/zoom-webhook'

const MAX_BODY_BYTES = 64 * 1024

// Zoom event subscription endpoint. meeting.started names the real meeting
// host; storing HMAC(host_id) as the session's verified host replaces the
// first-to-start-claims-host rule for that meeting. The key derivation
// matches readViewer, so the host's own identity cookie (uid from the
// decrypted app context) resolves to the same bidder key.
export async function POST(request: Request) {
  const secretToken = process.env.ZOOM_WEBHOOK_SECRET_TOKEN
  const sessionSecret = process.env.SESSION_SECRET
  if (!secretToken || !sessionSecret) {
    return NextResponse.json({ error: 'webhook not configured' }, { status: 503 })
  }

  const limited = await enforce([rule(`webhook:ip:${clientIp(request)}`, LIMITS.webhookPerIp)])
  if (limited) return limited

  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'body too large' }, { status: 413 })
  }
  const rawBody = await request.text()
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'body too large' }, { status: 413 })
  }

  const valid = await verifyZoomWebhook(
    rawBody,
    request.headers.get('x-zm-signature'),
    request.headers.get('x-zm-request-timestamp'),
    secretToken,
  )
  if (!valid) return NextResponse.json({ error: 'invalid signature' }, { status: 401 })

  let event: ZoomWebhookEvent
  try {
    event = JSON.parse(rawBody) as ZoomWebhookEvent
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 })
  }

  if (event.event === 'endpoint.url_validation') {
    const plainToken = event.payload?.plainToken
    if (typeof plainToken !== 'string' || !plainToken) {
      return NextResponse.json({ error: 'plainToken required' }, { status: 400 })
    }
    return NextResponse.json({ plainToken, encryptedToken: await hmacHex(secretToken, plainToken) })
  }

  if (event.event === 'meeting.started') {
    const uuid = event.payload?.object?.uuid
    const hostId = event.payload?.object?.host_id
    if (typeof uuid !== 'string' || !uuid || typeof hostId !== 'string' || !hostId) {
      return NextResponse.json({ error: 'uuid and host_id required' }, { status: 400 })
    }
    try {
      const hostKey = await bidderKey(`zoom:${hostId}`, sessionSecret)
      await setMeetingHost(meetingSessionKey(uuid), hostKey)
    } catch (error) {
      console.error('webhook meeting.started failed:', error)
      return NextResponse.json({ error: 'internal error' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }

  // Acknowledge everything else so Zoom does not retry events we ignore.
  return NextResponse.json({ ok: true, ignored: event.event ?? null })
}
