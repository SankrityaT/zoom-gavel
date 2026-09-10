import { NextResponse } from 'next/server'
import { MAX_BID } from '@/lib/gavel/demo'
import { ensureSession, getSession, placeBid } from '@/lib/gavel/server'

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

function serverError(error: unknown) {
  console.error('session route failed:', error)
  return NextResponse.json({ error: 'internal error' }, { status: 500 })
}

// Positive integer within the bid ceiling, or null.
function boundedInt(value: unknown, min: number): number | null {
  if (!Number.isInteger(value)) return null
  const n = value as number
  if (n < min || n > MAX_BID) return null
  return n
}

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > max) return null
  return trimmed
}

export async function GET(
  _request: Request,
  { params }: RouteContext<'/api/session/[uuid]'>,
) {
  const { uuid } = await params
  try {
    const session = await getSession(uuid)
    if (!session) {
      return NextResponse.json({ error: 'session not found' }, { status: 404 })
    }
    return NextResponse.json(session)
  } catch (error) {
    return serverError(error)
  }
}

export async function POST(
  request: Request,
  { params }: RouteContext<'/api/session/[uuid]'>,
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
    if ('init' in payload) {
      // Strict operation separation: an init request must be exactly an
      // init request, so a bid that accidentally carries the flag fails
      // loudly instead of being silently dropped.
      if (payload.init !== true) return badRequest('init must be true')
      if ('amount' in payload || 'bidderId' in payload) {
        return badRequest('init and bid are separate operations')
      }
      const itemName = boundedString(payload.itemName, 120) ?? 'Test lot'
      const openingBid = boundedInt(payload.openingBid, 0) ?? 0
      const session = await ensureSession(uuid, itemName, openingBid)
      return NextResponse.json(session, { status: 201 })
    }

    const amount = boundedInt(payload.amount, 1)
    if (amount === null) {
      return badRequest(
        `amount must be an integer between 1 and ${MAX_BID}`,
      )
    }
    const bidderId = boundedString(payload.bidderId, 120)
    if (bidderId === null) return badRequest('bidderId is required')

    const session = await placeBid(uuid, amount, bidderId)
    if (!session) {
      return NextResponse.json(
        { error: 'bid rejected: must be higher than the current bid on an open session' },
        { status: 409 },
      )
    }
    return NextResponse.json(session)
  } catch (error) {
    return serverError(error)
  }
}
