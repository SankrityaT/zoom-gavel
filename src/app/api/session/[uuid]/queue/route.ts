import { NextResponse } from 'next/server'
import { readViewer } from '@/lib/gavel/auth'
import { hostKeyFor } from '@/lib/gavel/host'
import { parseLot } from '@/lib/gavel/lot'
import { LIMITS, clientIp, enforce, rule } from '@/lib/gavel/rate-limit'
import { getQueue, getState, queueAdd, queueRemove, queueStartNext } from '@/lib/gavel/server'
import { isSessionKey, rejectCrossSite } from '@/lib/gavel/validate'

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

// The lots a host has lined up. Reading the full queue (prices included)
// and changing it are host-only on meeting sessions; everyone else only
// ever sees the count and the next lot's name, on the session itself.
export async function GET(
  request: Request,
  { params }: RouteContext<'/api/session/[uuid]/queue'>,
) {
  const { uuid } = await params
  if (!isSessionKey(uuid)) return badRequest('invalid session key')
  const limited = await enforce([rule(`queue:ip:${clientIp(request)}`, LIMITS.queuePerIp)])
  if (limited) return limited
  try {
    const viewer = await readViewer(request, uuid)
    const state = await getState(uuid, viewer)
    if (!state) return NextResponse.json({ error: 'session not found' }, { status: 404 })
    if (!state.viewer.canControl) {
      return NextResponse.json({ error: 'not the host' }, { status: viewer.verified ? 403 : 401 })
    }
    return NextResponse.json({ queue: await getQueue(uuid) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('queue read failed:', error)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}

export async function POST(
  request: Request,
  { params }: RouteContext<'/api/session/[uuid]/queue'>,
) {
  const { uuid } = await params
  if (!isSessionKey(uuid)) return badRequest('invalid session key')
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

    let outcome: Awaited<ReturnType<typeof queueAdd>>
    if (payload.action === 'add') {
      const parsed = parseLot(payload)
      if ('error' in parsed) return badRequest(parsed.error)
      const limited = await enforce([rule(`queue:ip:${clientIp(request)}`, LIMITS.queuePerIp)])
      if (limited) return limited
      outcome = await queueAdd(uuid, host.hostKey, parsed.lot)
    } else if (payload.action === 'remove') {
      if (!Number.isInteger(payload.id)) return badRequest('id is required')
      const limited = await enforce([rule(`queue:ip:${clientIp(request)}`, LIMITS.queuePerIp)])
      if (limited) return limited
      outcome = await queueRemove(uuid, host.hostKey, payload.id as number)
    } else if (payload.action === 'start') {
      const limited = await enforce([rule(`round:ip:${clientIp(request)}`, LIMITS.roundPerIp)])
      if (limited) return limited
      outcome = await queueStartNext(uuid, host.hostKey)
    } else {
      return badRequest("action must be 'add', 'remove' or 'start'")
    }

    const state = await getState(uuid, viewer)
    if (outcome.ok) return NextResponse.json({ ok: true, queue: outcome.queue, state })

    switch (outcome.reason) {
      case 'unverified':
        return NextResponse.json({ error: 'zoom identity required' }, { status: 401 })
      case 'not_host':
        return NextResponse.json({ error: 'not the host' }, { status: 403 })
      case 'bad_seconds':
      case 'bad_buy_now':
        return badRequest('lot settings out of bounds')
      default:
        return NextResponse.json({ ok: false, reason: outcome.reason, state }, { status: 409 })
    }
  } catch (error) {
    console.error('queue route failed:', error)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
