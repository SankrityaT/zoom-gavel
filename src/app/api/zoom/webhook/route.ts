import { NextResponse } from 'next/server'
import { bidderKey, meetingSessionKey } from '@/lib/gavel/auth'
import { LIMITS, clientIp, enforce, rule } from '@/lib/gavel/rate-limit'
import { purgeZoomUser, setCohost, setMeetingHost } from '@/lib/gavel/server'
import { hmacHex, verifyZoomWebhook, type ZoomWebhookEvent } from '@/lib/gavel/zoom-webhook'

const MAX_BODY_BYTES = 64 * 1024

// Zoom event subscription endpoint. meeting.started names the real meeting
// host; storing HMAC(host_id) as the session's verified host replaces the
// first-to-start-claims-host rule for that meeting. The key derivation
// matches readViewer, so the host's own identity cookie (uid from the
// decrypted app context) resolves to the same bidder key.
export async function POST(request: Request) {
  // One Secret Token per Marketplace app: the Development app and the Production
  // app each have their own, and both send events here. List them separated by
  // commas; an event must verify against one of them.
  const secretTokens = (process.env.ZOOM_WEBHOOK_SECRET_TOKEN ?? '')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
  const secretToken = secretTokens[0]
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

  // The token that verified the event is the one that answers its challenge.
  let matchedToken: string | null = null
  for (const candidate of secretTokens) {
    if (
      await verifyZoomWebhook(
        rawBody,
        request.headers.get('x-zm-signature'),
        request.headers.get('x-zm-request-timestamp'),
        candidate,
      )
    ) {
      matchedToken = candidate
      break
    }
  }
  if (matchedToken === null) return NextResponse.json({ error: 'invalid signature' }, { status: 401 })

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
    return NextResponse.json({ plainToken, encryptedToken: await hmacHex(matchedToken, plainToken) })
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

  // Someone's role in the meeting changed. Zoom's app context carries no role,
  // so this signed notice is how the server learns of a co-host. Only the
  // Zoom user id (when they are signed in) and the new role are used; the rest
  // of the participant record is ignored.
  if (event.event === 'meeting.participant_role_changed') {
    const uuid = event.payload?.object?.uuid
    const participant = event.payload?.object?.participant
    const userId = participant?.participant_user_id
    if (typeof uuid !== 'string' || !uuid || typeof participant?.new_role !== 'string') {
      return NextResponse.json({ error: 'uuid and new_role required' }, { status: 400 })
    }
    // Guests who are not signed in have no user id: nothing to record.
    if (typeof userId !== 'string' || !userId) return NextResponse.json({ ok: true, ignored: 'no user id' })
    const on = participant.new_role === 'co-host' || participant.new_role === 'host'
    // Zoom retries, so notices can arrive out of order: the database keeps the
    // newest by Zoom's own timestamp and ignores an older one.
    const eventTs = typeof event.event_ts === 'number' && Number.isFinite(event.event_ts) ? Math.trunc(event.event_ts) : Date.now()
    try {
      const outcome = await setCohost(meetingSessionKey(uuid), await bidderKey(`zoom:${userId}`, sessionSecret), on, eventTs)
      if (!outcome.ok) console.warn('co-host notice not recorded:', outcome.reason)
    } catch (error) {
      console.error('webhook participant_role_changed failed:', error)
      return NextResponse.json({ error: 'internal error' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }

  // The person removed the app: forget them. Zoom retries on a non-2xx, so a
  // failed purge answers 500 and is attempted again.
  if (event.event === 'app_deauthorized') {
    const userId = event.payload?.user_id
    if (typeof userId !== 'string' || !userId) {
      return NextResponse.json({ error: 'user_id required' }, { status: 400 })
    }
    try {
      const outcome = await purgeZoomUser(await bidderKey(`zoom:${userId}`, sessionSecret))
      console.info('deauthorization: removed a user\'s data', JSON.stringify(outcome))
    } catch (error) {
      console.error('webhook app_deauthorized failed:', error)
      return NextResponse.json({ error: 'internal error' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }

  // Acknowledge everything else so Zoom does not retry events we ignore.
  return NextResponse.json({ ok: true, ignored: event.event ?? null })
}
