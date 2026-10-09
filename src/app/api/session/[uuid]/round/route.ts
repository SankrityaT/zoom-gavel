import { NextResponse } from 'next/server'
import { readViewer } from '@/lib/gavel/auth'
import { hostKeyFor } from '@/lib/gavel/host'
import { LIMITS, clientIp, enforce, rule } from '@/lib/gavel/rate-limit'
import { getState, startRound, stopRound, type RoundOutcome } from '@/lib/gavel/server'
import { boundedInt, boundedString, rejectCrossSite } from '@/lib/gavel/validate'

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
  const crossSite = rejectCrossSite(request)
  if (crossSite) return NextResponse.json({ error: crossSite }, { status: 403 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return badRequest('body must be JSON')
  }
  const payload = body as Record<string, unknown>

  try {
    const viewer = await readViewer(request, uuid)
    const host = hostKeyFor(uuid, viewer)
    if ('refusal' in host) return host.refusal
    const hostKey = host.hostKey

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
      const buyNowPrice =
        payload.buyNowPrice === undefined || payload.buyNowPrice === null
          ? null
          : boundedInt(payload.buyNowPrice, 1)
      if (payload.buyNowPrice != null && buyNowPrice === null) {
        return badRequest('buyNowPrice must be an integer within bounds')
      }
      if (buyNowPrice !== null && (buyNowPrice <= openingBid || (reservePrice !== null && buyNowPrice < reservePrice))) {
        return badRequest('buyNowPrice must be above the opening bid and not below the reserve')
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
      const limited = await enforce([rule(`round:ip:${clientIp(request)}`, LIMITS.roundPerIp)])
      if (limited) return limited
      outcome = await startRound(uuid, hostKey, {
        itemName,
        openingBid,
        reservePrice,
        buyNowPrice,
        seconds,
        extendWindowSeconds,
        extendBySeconds,
      })
    } else if (payload.action === 'stop') {
      const limited = await enforce([rule(`round:ip:${clientIp(request)}`, LIMITS.roundPerIp)])
      if (limited) return limited
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
      case 'bad_buy_now':
        return badRequest('buyNowPrice must be above the opening bid and not below the reserve')
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
