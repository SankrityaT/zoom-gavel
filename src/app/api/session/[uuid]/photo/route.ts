import { NextResponse } from 'next/server'
import { readViewer } from '@/lib/gavel/auth'
import { hostKeyFor } from '@/lib/gavel/host'
import { LIMITS, clientIp, enforce, rule } from '@/lib/gavel/rate-limit'
import { addPhoto } from '@/lib/gavel/server'
import { isSessionKey, rejectCrossSite } from '@/lib/gavel/validate'

// A lot's photo, added by the host or a co-host before the lot starts. The
// browser has already shrunk it (about 800 pixels, a few tens of kilobytes) and
// re-drawn it, which drops any location data. The server still checks the
// bytes really are a JPEG or WebP and refuses anything large, so the endpoint
// cannot be used to store other files.
const MAX_BYTES = 200 * 1024

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

function imageType(bytes: Uint8Array): 'image/jpeg' | 'image/webp' | null {
  if (bytes.length > 12 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (
    bytes.length > 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  ) {
    return 'image/webp'
  }
  return null
}

export async function POST(
  request: Request,
  { params }: RouteContext<'/api/session/[uuid]/photo'>,
) {
  const { uuid } = await params
  if (!isSessionKey(uuid)) return badRequest('invalid session key')
  const crossSite = rejectCrossSite(request, ['image/jpeg', 'image/webp'])
  if (crossSite) return NextResponse.json({ error: crossSite }, { status: 403 })

  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > MAX_BYTES) return badRequest('photo is too large', 413)

  try {
    const limited = await enforce([rule(`photo:up:${clientIp(request)}`, LIMITS.photoUploadPerIp)])
    if (limited) return limited
    const viewer = await readViewer(request, uuid)
    const host = await hostKeyFor(uuid, viewer)
    if ('refusal' in host) return host.refusal

    const bytes = new Uint8Array(await request.arrayBuffer())
    if (bytes.length > MAX_BYTES) return badRequest('photo is too large', 413)
    const type = imageType(bytes)
    if (type === null) return badRequest('photo must be a JPEG or WebP image', 415)

    const outcome = await addPhoto(uuid, host.hostKey, type, Buffer.from(bytes))
    if (outcome.ok) return NextResponse.json({ ok: true, id: outcome.id })
    switch (outcome.reason) {
      case 'unverified':
        return NextResponse.json({ error: 'zoom identity required' }, { status: 401 })
      case 'not_host':
        return NextResponse.json({ error: 'not the host' }, { status: 403 })
      case 'too_many':
        return NextResponse.json({ error: 'too many photos for this auction', reason: 'too_many' }, { status: 409 })
      default:
        return badRequest('photo was not accepted')
    }
  } catch (error) {
    console.error('photo upload failed:', error)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
