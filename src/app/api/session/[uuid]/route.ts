import { NextResponse } from 'next/server'
import { ensureSession, getSession, placeBid } from '@/lib/gavel/server'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ uuid: string }> }

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { uuid } = await params
  const session = await getSession(uuid)
  if (!session) {
    return NextResponse.json({ error: 'session not found' }, { status: 404 })
  }
  return NextResponse.json(session)
}

export async function POST(request: Request, { params }: RouteContext) {
  const { uuid } = await params
  if (!uuid || uuid.length > 200) return badRequest('invalid uuid')

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return badRequest('body must be JSON')
  }
  const payload = body as {
    init?: boolean
    itemName?: string
    openingBid?: number
    amount?: number
    bidderId?: string
  }

  if (payload.init) {
    const itemName =
      typeof payload.itemName === 'string' && payload.itemName.trim()
        ? payload.itemName.trim().slice(0, 120)
        : 'Test lot'
    const openingBid =
      Number.isInteger(payload.openingBid) && (payload.openingBid as number) >= 0
        ? (payload.openingBid as number)
        : 0
    const session = await ensureSession(uuid, itemName, openingBid)
    return NextResponse.json(session, { status: 201 })
  }

  if (!Number.isInteger(payload.amount) || (payload.amount as number) <= 0) {
    return badRequest('amount must be a positive integer')
  }
  if (typeof payload.bidderId !== 'string' || !payload.bidderId.trim()) {
    return badRequest('bidderId is required')
  }

  const session = await placeBid(
    uuid,
    payload.amount as number,
    payload.bidderId.trim().slice(0, 120),
  )
  if (!session) {
    return NextResponse.json(
      { error: 'bid rejected: must be higher than the current bid on an open session' },
      { status: 409 },
    )
  }
  return NextResponse.json(session)
}
