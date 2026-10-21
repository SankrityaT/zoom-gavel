import { NextResponse } from 'next/server'
import { readViewer } from '@/lib/gavel/auth'
import { hostKeyFor } from '@/lib/gavel/host'
import { LIMITS, clientIp, enforce, rule } from '@/lib/gavel/rate-limit'
import { getPaymentNote, getState, paymentForWinner, setPaymentNote } from '@/lib/gavel/server'
import { anonBidderKey, boundedString, guestSecretFrom, isSessionKey, rejectCrossSite } from '@/lib/gavel/validate'

// How winners pay. Gavel never takes money: the host says where to send it
// and only someone who has won a lot in this session can read that. The note
// is plain text the host types; it is shown as text, never run or fetched.

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

// The host's own view of the note, so they can see and change it.
export async function GET(
  request: Request,
  { params }: RouteContext<'/api/session/[uuid]/payment'>,
) {
  const { uuid } = await params
  if (!isSessionKey(uuid)) return badRequest('invalid session key')
  const limited = await enforce([rule(`payment:ip:${clientIp(request)}`, LIMITS.paymentPerIp)])
  if (limited) return limited
  try {
    const viewer = await readViewer(request, uuid)
    const state = await getState(uuid, viewer)
    if (!state) return NextResponse.json({ error: 'session not found' }, { status: 404 })
    if (!state.viewer.canControl) {
      return NextResponse.json({ error: 'not the host' }, { status: viewer.verified ? 403 : 401 })
    }
    return NextResponse.json({ note: await getPaymentNote(uuid) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('payment read failed:', error)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}

// action 'set': the host sets or clears the note. action 'mine': a winner asks
// what they owe and where to send it (an empty answer for anyone who has not won).
export async function POST(
  request: Request,
  { params }: RouteContext<'/api/session/[uuid]/payment'>,
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
    const limited = await enforce([rule(`payment:ip:${clientIp(request)}`, LIMITS.paymentPerIp)])
    if (limited) return limited
    const viewer = await readViewer(request, uuid)

    if (payload.action === 'set') {
      const host = await hostKeyFor(uuid, viewer)
      if ('refusal' in host) return host.refusal
      let note: string | null = null
      if (payload.note !== null && payload.note !== undefined) {
        // One line of plain text: control characters and newlines are dropped.
        const cleaned = typeof payload.note === 'string' ? payload.note.replace(/[\u0000-\u001f\u007f]+/g, ' ') : null
        note = boundedString(cleaned, 300)
        if (note === null) {
          if (typeof payload.note === 'string' && payload.note.trim() === '') note = null
          else return badRequest('note must be 1 to 300 characters')
        }
      }
      const outcome = await setPaymentNote(uuid, host.hostKey, note)
      if (outcome.ok) return NextResponse.json({ ok: true, note: outcome.note })
      switch (outcome.reason) {
        case 'unverified':
          return NextResponse.json({ error: 'zoom identity required' }, { status: 401 })
        case 'not_host':
          return NextResponse.json({ error: 'not the host' }, { status: 403 })
        default:
          return badRequest('note was not accepted')
      }
    }

    if (payload.action === 'mine') {
      // Same identity rule as a bid: the verified cookie, else name plus guest secret.
      let key: string | null
      if (viewer.verified) {
        key = viewer.bidderKey
      } else {
        const name = boundedString(payload.bidderId, 60)
        const secret = guestSecretFrom(payload.bidderSecret)
        if (name === null) return badRequest('bidderId is required')
        if (secret === undefined) return badRequest('bidderSecret is malformed')
        key = await anonBidderKey(name, secret)
      }
      return NextResponse.json(await paymentForWinner(uuid, key), { headers: { 'Cache-Control': 'no-store' } })
    }

    return badRequest("action must be 'set' or 'mine'")
  } catch (error) {
    console.error('payment route failed:', error)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
