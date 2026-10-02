import { NextResponse } from 'next/server'
import { rateLimitHit } from './server'

// Fixed-window limits enforced in Postgres, so they hold across every
// serverless instance. Per-IP buckets stop floods (anonymous bidders can
// rotate names, not addresses); per-identity buckets stop one bidder
// hammering one session. Generous enough for a meeting behind one NAT.
export const LIMITS = {
  bidPerIp: { limit: 120, windowSeconds: 10 },
  bidPerBidder: { limit: 10, windowSeconds: 5 },
  roundPerIp: { limit: 60, windowSeconds: 60 },
  initPerIp: { limit: 120, windowSeconds: 60 },
  streamPerIp: { limit: 120, windowSeconds: 60 },
  resultsPerIp: { limit: 60, windowSeconds: 60 },
  identityPerIp: { limit: 60, windowSeconds: 60 },
  webhookPerIp: { limit: 120, windowSeconds: 60 },
} as const

type Rule = { bucket: string; limit: number; windowSeconds: number }

// Vercel sets x-forwarded-for with the client address first.
export function clientIp(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for')
  const first = forwarded?.split(',')[0]?.trim()
  return first || request.headers.get('x-real-ip') || 'unknown'
}

export function rule(
  bucket: string,
  { limit, windowSeconds }: { limit: number; windowSeconds: number },
): Rule {
  return { bucket, limit, windowSeconds }
}

// Returns a 429 response when any bucket is exhausted, otherwise null.
// Fails open on a limiter error: the write that follows would hit the same
// database, and refusing every bid because the counter hiccuped is worse.
export async function enforce(rules: Rule[]): Promise<NextResponse | null> {
  let retryAfter: number
  try {
    retryAfter = await rateLimitHit(rules)
  } catch (error) {
    console.error('rate limiter failed open:', error)
    return null
  }
  if (retryAfter <= 0) return null
  return NextResponse.json(
    { error: 'rate limited', reason: 'rate_limited', retryAfter },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } },
  )
}
