import { LIMITS, clientIp, enforce, rule } from '@/lib/gavel/rate-limit'
import { getPhoto } from '@/lib/gavel/server'
import { isUuid } from '@/lib/gavel/validate'

// A lot's photo. The address holds a random id, so only people the auction
// showed it to can ask for it. Served as an image and nothing else.
export async function GET(
  request: Request,
  { params }: RouteContext<'/api/photo/[id]'>,
) {
  const { id } = await params
  if (!isUuid(id)) return new Response('not found', { status: 404 })
  const limited = await enforce([rule(`photo:read:${clientIp(request)}`, LIMITS.photoReadPerIp)])
  if (limited) return limited
  try {
    const photo = await getPhoto(id)
    if (!photo) return new Response('not found', { status: 404 })
    return new Response(new Uint8Array(photo.bytes), {
      headers: {
        'Content-Type': photo.type,
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
        'Referrer-Policy': 'no-referrer',
      },
    })
  } catch (error) {
    console.error('photo read failed:', error)
    return new Response('internal error', { status: 500 })
  }
}
