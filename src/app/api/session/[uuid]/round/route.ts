import { NextResponse } from 'next/server'
import { readViewer } from '@/lib/gavel/auth'
import { getState, startRound, stopRound, type RoundOutcome } from '@/lib/gavel/server'
import { isSandboxKey } from '@/lib/gavel/types'
import { boundedInt, boundedString } from '@/lib/gavel/validate'

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

// Host authority. Meeting sessions require a verified Zoom identity from
// this exact meeting; the first such identity to start a round becomes the
// host and only it may control the session afterwards (enforced in SQL).
// Sandbox sessions (demo/join-link keys) are ownerless: anyone runs the clock.
export async function POST(
  request: Request,
  { params }: RouteContext<'/api/session/[uuid]/round'>,
) {
  const { uuid } = await params
  if (!uuid || uuid.length > 200) return badRequest('invalid session key')

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return badRequest('body must be JSON')
  }
  const payload = body as Record<string, unknown>

  try {
    const viewer = await readViewer(request, uuid)
    let hostKey: string | null = null
    if (!isSandboxKey(uuid)) {
      if (!viewer.verified) {
        return NextResponse.json({ error: 'zoom identity required' }, { status: 401 })
      }
      if (!viewer.inThisMeeting) {
        return NextResponse.json({ error: 'not in this meeting' }, { status: 403 })
      }
      hostKey = viewer.bidderKey
    }

    let outcome: RoundOutcome
    if (payload.action === 'start') {
      const itemName = boundedString(payload.itemName, 120)
      if (itemName === null) return badRequest('itemName is required')
      const openingBid = boundedInt(payload.openingBid, 0)
      if (openingBid === null) return badRequest('openingBid must be an integer within bounds')
      const reservePrice =
        payload.reservePrice === undefined || payload.reservePrice === null
          ? null
          : boundedInt(payload.reservePrice, 0)
      if (payload.reservePrice != null && reservePrice === null) {
        return badRequest('reservePrice must be an integer within bounds')
      }
      const seconds = boundedInt(payload.seconds, 5, 3600)
      if (seconds === null) return badRequest('seconds must be between 5 and 3600')
      const extendWindowSeconds =
        payload.extendWindowSeconds === undefined
          ? 10
          : boundedInt(payload.extendWindowSeconds, 0, 120)
      const extendBySeconds =
        payload.extendBySeconds === undefined ? 15 : boundedInt(payload.extendBySeconds, 0, 300)
      if (extendWindowSeconds === null || extendBySeconds === null) {
        return badRequest('extension settings out of bounds')
      }
      outcome = await startRound(uuid, hostKey, {
        itemName,
        openingBid,
        reservePrice,
        seconds,
        extendWindowSeconds,
        extendBySeconds,
      })
    } else if (payload.action === 'stop') {
      outcome = await stopRound(uuid, hostKey)
    } else {
      return badRequest("action must be 'start' or 'stop'")
    }

    const state = await getState(uuid, viewer)
    if (outcome.ok) return NextResponse.json({ ok: true, state })

    switch (outcome.reason) {
      case 'unverified':
        return NextResponse.json({ error: 'zoom identity required' }, { status: 401 })
      case 'not_host':
        return NextResponse.json({ error: 'not the host' }, { status: 403 })
      case 'bad_seconds':
        return badRequest('seconds must be between 5 and 3600')
      case 'not_found':
        return NextResponse.json({ error: 'session not found' }, { status: 404 })
      default:
        return NextResponse.json({ ok: false, reason: outcome.reason, state }, { status: 409 })
    }
  } catch (error) {
    console.error('round route failed:', error)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
