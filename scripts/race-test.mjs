#!/usr/bin/env node
// Concurrency and host-rule test suite for the auction API.
//
//   BASE_URL=http://127.0.0.1:5173 npm run test:race
//   BASE_URL=... SESSION_SECRET=<same as the server> npm run test:race   # also runs S11/S12
//   ... ZOOM_WEBHOOK_SECRET_TOKEN=<same as the server>                    # also runs S14
//
// No dependencies. Uses fresh sandbox keys per scenario; S11/S12 mint valid
// identity cookies when SESSION_SECRET is provided.

import { createHmac, randomBytes } from 'node:crypto'

const BASE_URL = process.env.BASE_URL
if (!BASE_URL) {
  console.error('BASE_URL is required, e.g. BASE_URL=http://127.0.0.1:5173')
  process.exit(2)
}
const SESSION_SECRET = process.env.SESSION_SECRET ?? null
const WEBHOOK_TOKEN = process.env.ZOOM_WEBHOOK_SECRET_TOKEN ?? null

let failures = 0
const results = []

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
function key(prefix = 'race') {
  return `${prefix}-${randomBytes(6).toString('hex')}`
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}
function mintCookie(uid, mid, { expired = false, badSig = false } = {}) {
  const now = Date.now()
  const payload = b64url(JSON.stringify({ v: 1, uid, mid, iat: now, exp: expired ? now - 1000 : now + 3600e3 }))
  const sig = b64url(createHmac('sha256', badSig ? 'wrong' : SESSION_SECRET).update(payload).digest())
  return `gavel_ctx=${payload}.${sig}`
}
function meetingKey(mid) {
  return `mtg-${b64url(Buffer.from(mid, 'utf8'))}`
}

async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(`${BASE_URL}/api/session/${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
  let json = null
  try {
    json = await res.json()
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json }
}
const get = (k, cookie) => api(encodeURIComponent(k), { cookie })
const init = (k) => api(encodeURIComponent(k), { method: 'POST', body: { init: true, itemName: 'Race lot', openingBid: 100 } })
const bid = (k, amount, name, cookie) =>
  api(encodeURIComponent(k), { method: 'POST', body: { amount, bidderId: name }, cookie })
const start = (k, opts = {}, cookie) =>
  api(`${encodeURIComponent(k)}/round`, {
    method: 'POST',
    cookie,
    body: { action: 'start', itemName: 'Race lot', openingBid: 100, reservePrice: null, seconds: 30, extendWindowSeconds: 10, extendBySeconds: 15, ...opts },
  })
const stop = (k, cookie) => api(`${encodeURIComponent(k)}/round`, { method: 'POST', body: { action: 'stop' }, cookie })

// Bid amounts are private, so scenarios read the public leaderboard: one
// entry per bidder with a bid count and last-bid time, amounts withheld.
const totalBids = (state) => state.leaderboard.reduce((sum, e) => sum + e.bids, 0)

function histogram(list) {
  return list.reduce((acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {})
}

function check(name, cond, detail = '') {
  if (!cond) failures++
  results.push({ name, ok: Boolean(cond), detail })
}

async function scenario(id, title, fn) {
  const before = failures
  try {
    await fn()
  } catch (error) {
    failures++
    results.push({ name: `${id} threw`, ok: false, detail: String(error) })
  }
  console.log(`${failures === before ? 'PASS' : 'FAIL'}  ${id} ${title}`)
}

await scenario('S1', 'distinct-amount storm', async () => {
  const k = key()
  await init(k)
  await start(k)
  const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => bid(k, 100 + 25 * i, `racer-${i}`)))
  const h = histogram(rs)
  const accepted = rs.filter((r) => r.status === 200).map((r) => r.json.state.session.currentBid)
  const { json } = await get(k)
  check('S1 all 200/409', (h[200] ?? 0) + (h[409] ?? 0) === 20, JSON.stringify(h))
  check('S1 rejections are too_low', rs.filter((r) => r.status === 409).every((r) => r.json.reason === 'too_low'))
  check('S1 currentBid is max accepted', json.session.currentBid === Math.max(...accepted))
  check('S1 bid count', totalBids(json) === (h[200] ?? 0), `${totalBids(json)} vs ${h[200]}`)
  check('S1 leader holds the current price', json.leaderboard[0]?.amount === json.session.currentBid)
  const order = json.leaderboard.map((e) => new Date(e.lastBidAt).getTime())
  check('S1 ranks follow bid order', order.every((v, i) => i === 0 || v < order[i - 1]), order.join(','))
  check('S1 other amounts withheld', json.leaderboard.slice(1).every((e) => e.amount === null))
})

await scenario('S2', 'identical amount collision', async () => {
  const k = key()
  await init(k)
  await start(k)
  const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => bid(k, 200, `dup-${i}`)))
  const h = histogram(rs)
  const { json } = await get(k)
  check('S2 exactly one accepted', h[200] === 1 && h[409] === 9, JSON.stringify(h))
  check('S2 one bid row', totalBids(json) === 1)
})

await scenario('S3', 'bid after expiry', async () => {
  const k = key()
  await init(k)
  await start(k, { seconds: 5, extendWindowSeconds: 0 })
  await sleep(5600)
  const r = await bid(k, 150, 'late')
  const { json } = await get(k)
  check('S3 rejected as expired/not_open', r.status === 409 && ['expired', 'not_open'].includes(r.json.reason), JSON.stringify(r.json?.reason))
  check('S3 status closed', json.session.status === 'closed')
  check('S3 closedAt == endsAt', json.session.closedAt === json.session.endsAt, `${json.session.closedAt} vs ${json.session.endsAt}`)
})

await scenario('S4', 'bids at the expiry boundary', async () => {
  const k = key()
  await init(k)
  const s = await start(k, { seconds: 5, extendWindowSeconds: 0 })
  const endsAt = new Date(s.json.state.session.endsAt).getTime()
  const offset = new Date(s.json.state.serverNow).getTime() - Date.now()
  const fireAt = (deltaMs) => endsAt + deltaMs - offset
  // Verdicts are judged at arrival on the server, so "before" bids need a
  // margin larger than request latency; the invariant under test is that
  // nothing accepted lands after endsAt and nothing after it is accepted.
  const plan = [
    [-1200, 150, 'b1'],
    [-800, 175, 'b2'],
    [150, 200, 'b3'],
    [400, 225, 'b4'],
  ]
  const rs = await Promise.all(
    plan.map(async ([delta, amount, name]) => {
      await sleep(Math.max(0, fireAt(delta) - Date.now()))
      return bid(k, amount, name)
    }),
  )
  check('S4 pre-boundary bids not expired', rs.slice(0, 2).every((r) => r.status === 200 || r.json?.reason === 'too_low'), JSON.stringify(rs.slice(0, 2).map((r) => [r.status, r.json?.reason])))
  check('S4 post-boundary bids rejected', rs.slice(2).every((r) => r.status === 409 && ['expired', 'not_open'].includes(r.json.reason)), JSON.stringify(rs.slice(2).map((r) => [r.status, r.json?.reason])))
  const { json } = await get(k)
  check('S4 accepted bids before endsAt', json.leaderboard.every((e) => new Date(e.lastBidAt).getTime() <= new Date(json.session.endsAt).getTime() + 50))
})

await scenario('S5', 'anti-snipe extension', async () => {
  const k = key()
  await init(k)
  const s = await start(k, { seconds: 5, extendWindowSeconds: 10, extendBySeconds: 15 })
  await sleep(1000)
  const r = await bid(k, 150, 'sniper')
  check('S5 accepted and extended', r.status === 200 && r.json.extended === true, JSON.stringify(r.json?.extended))
  const serverNow = new Date(r.json.state.serverNow).getTime()
  const endsAt = new Date(r.json.state.session.endsAt).getTime()
  check('S5 endsAt pushed ~15s out', endsAt >= serverNow + 14_500, `${endsAt - serverNow}ms`)
  check('S5 endsAt moved forward', endsAt > new Date(s.json.state.session.endsAt).getTime())
})

await scenario('S6', 'colliding extensions', async () => {
  const k = key()
  await init(k)
  await start(k, { seconds: 5, extendWindowSeconds: 10, extendBySeconds: 15 })
  const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => bid(k, 150 + 10 * i, `ext-${i}`)))
  const accepted = rs.filter((r) => r.status === 200)
  // Only bids that land inside the closing window extend; once the first
  // late bid pushes the deadline out, the rest are no longer late. So at
  // least one extension, never a regression of the deadline.
  check('S6 at least one extension', accepted.some((r) => r.json.extended === true), `${accepted.length} accepted`)
  const finalEnds = Math.max(...accepted.map((r) => new Date(r.json.state.session.endsAt).getTime()))
  const finalNow = Math.max(...accepted.map((r) => new Date(r.json.state.serverNow).getTime()))
  check('S6 deadline pushed ~15s', finalEnds >= finalNow + 10_000, `${finalEnds - finalNow}ms`)
  const ordered = accepted
    .map((r) => ({ amount: r.json.amount, endsAt: new Date(r.json.state.session.endsAt).getTime() }))
    .sort((a, b) => a.amount - b.amount)
  check('S6 endsAt non-decreasing', ordered.every((v, i) => i === 0 || v.endsAt >= ordered[i - 1].endsAt))
})

await scenario('S7', 'host stop vs in-flight bids', async () => {
  const k = key()
  await init(k)
  await start(k)
  const rs = await Promise.all([
    ...Array.from({ length: 10 }, (_, i) => bid(k, 150 + 10 * i, `inflight-${i}`)),
    stop(k),
  ])
  const bids = rs.slice(0, 10)
  const { json } = await get(k)
  check('S7 closed', json.session.status === 'closed')
  const acceptedAmounts = bids.filter((r) => r.status === 200).map((r) => r.json.state.session.currentBid)
  check('S7 accepted bids all recorded', totalBids(json) === acceptedAmounts.length, `${totalBids(json)} vs ${acceptedAmounts.length}`)
  check('S7 currentBid is max accepted', acceptedAmounts.length === 0 || json.session.currentBid === Math.max(...acceptedAmounts))
  check('S7 rejections are not_open/too_low', bids.filter((r) => r.status === 409).every((r) => ['not_open', 'too_low', 'expired'].includes(r.json.reason)))
  const closedAt = new Date(json.session.closedAt).getTime()
  check('S7 no bid after closedAt', json.leaderboard.every((e) => new Date(e.lastBidAt).getTime() <= closedAt + 50))
})

await scenario('S8', 'bid on idle session', async () => {
  const k = key()
  await init(k)
  const r = await bid(k, 150, 'early')
  check('S8 not_open', r.status === 409 && r.json.reason === 'not_open', JSON.stringify(r.json))
})

await scenario('S9', 'validation', async () => {
  const k = key()
  await init(k)
  await start(k)
  const r1 = await bid(k, 1_000_001, 'max')
  const r2 = await start(key(), { seconds: 4 })
  const r3 = await start(key(), { seconds: 3601 })
  const r4 = await api(encodeURIComponent(k), { method: 'POST', body: 'not json' })
  check('S9 over max 400', r1.status === 400, String(r1.status))
  check('S9 seconds 4 -> 400', r2.status === 400, String(r2.status))
  check('S9 seconds 3601 -> 400', r3.status === 400, String(r3.status))
  check('S9 non-JSON 400', r4.status === 400, String(r4.status))
})

await scenario('S10', 'start while open', async () => {
  const k = key()
  await init(k)
  await start(k)
  const r = await start(k)
  check('S10 round_open 409', r.status === 409 && r.json.reason === 'round_open', JSON.stringify(r.json?.reason))
})

if (SESSION_SECRET) {
  await scenario('S11', 'host rule on meeting sessions', async () => {
    const mid = `race-mid-${randomBytes(4).toString('hex')}`
    const k = meetingKey(mid)
    const cookieA = mintCookie('userA', mid)
    const cookieB = mintCookie('userB', mid)
    const cookieAOther = mintCookie('userA', 'other-meeting')
    const r1 = await start(k)
    check('S11a no cookie -> 401', r1.status === 401, String(r1.status))
    const r2 = await start(k, {}, cookieA)
    check('S11b host A starts', r2.status === 200 && r2.json.state.session.hostClaimed === true && r2.json.state.viewer.isHost === true, JSON.stringify([r2.status, r2.json?.state?.viewer]))
    const r3 = await stop(k, cookieB)
    check('S11c B cannot stop -> 403', r3.status === 403, String(r3.status))
    const r3b = await start(k, {}, cookieB)
    check('S11c B cannot start -> 403 or 409', [403, 409].includes(r3b.status), String(r3b.status))
    const r4 = await stop(k, cookieAOther)
    check('S11d A from other meeting -> 403', r4.status === 403, String(r4.status))
    const rb = await bid(k, 150, 'Bee', cookieB)
    check('S11 verified bid accepted', rb.status === 200 && rb.json.state.leaderboard[0].verified === true)
    const r5 = await stop(k, cookieA)
    check('S11e A stops', r5.status === 200 && r5.json.state.session.status === 'closed', String(r5.status))
  })

  await scenario('S12', 'forged or expired cookies', async () => {
    const mid = `race-mid-${randomBytes(4).toString('hex')}`
    const k = meetingKey(mid)
    const r1 = await start(k, {}, mintCookie('userA', mid, { badSig: true }))
    const r2 = await start(k, {}, mintCookie('userA', mid, { expired: true }))
    check('S12 bad signature -> 401', r1.status === 401, String(r1.status))
    check('S12 expired -> 401', r2.status === 401, String(r2.status))
  })
} else {
  console.log('SKIP  S11/S12 host rule (set SESSION_SECRET to run)')
}

await scenario('S13', 'rate limit on one bidder', async () => {
  const k = key()
  await init(k)
  await start(k)
  // Per-bidder bucket: 10 bids per 5s. 14 rapid bids from one name must
  // see at least one 429 with Retry-After, and the session stays sane.
  const rs = await Promise.all(Array.from({ length: 14 }, (_, i) => bid(k, 100 + 25 * i, 'spammer')))
  const h = histogram(rs)
  check('S13 some 429', (h[429] ?? 0) >= 1, JSON.stringify(h))
  check('S13 only 200/409/429', (h[200] ?? 0) + (h[409] ?? 0) + (h[429] ?? 0) === 14, JSON.stringify(h))
  const limited = rs.find((r) => r.status === 429)
  check('S13 429 carries retryAfter', !limited || (limited.json?.reason === 'rate_limited' && limited.json.retryAfter >= 1))
  const other = await bid(k, 5000, 'someone-else')
  check('S13 other bidder unaffected', other.status === 200, String(other.status))
})

// Reads SSE events until `want` returns true or timeout. Like EventSource,
// it reconnects once if the server ends a stream before sending anything.
async function readStream(k, options = {}, want) {
  const first = await readStreamOnce(k, options, want)
  if (first.status !== 200 || first.events.length > 0) return first
  await sleep(1000)
  return readStreamOnce(k, options, want)
}

async function readStreamOnce(k, { timeoutMs = 15000, cookie } = {}, want) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const events = []
  try {
    const res = await fetch(`${BASE_URL}/api/session/${encodeURIComponent(k)}/stream`, {
      headers: cookie ? { cookie } : {},
      signal: controller.signal,
    })
    if (!res.ok || !res.body) return { status: res.status, events }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        const name = /^event: (.*)$/m.exec(block)?.[1]
        const data = /^data: (.*)$/m.exec(block)?.[1]
        if (name) {
          events.push({ name, data: data ? JSON.parse(data) : null, at: Date.now() })
          if (want(events)) {
            controller.abort()
            return { status: res.status, events }
          }
        }
      }
    }
    return { status: res.status, events }
  } catch {
    return { status: 0, events }
  } finally {
    clearTimeout(timer)
  }
}

await scenario('S15', 'SSE stream pushes bids', async () => {
  const k = key()
  await init(k)
  await start(k)
  // Bid only once the snapshot has arrived, so the push is what we measure.
  let bidSentAt = 0
  let bidRequest = null
  const { status, events } = await readStream(k, { timeoutMs: 15000 }, (evts) => {
    if (!bidRequest && evts.some((e) => e.name === 'state')) {
      bidSentAt = Date.now()
      bidRequest = bid(k, 175, 'streamer')
    }
    return evts.some((e) => e.name === 'session' && e.data?.session?.currentBid === 175)
  })
  const r = bidRequest ? await bidRequest : { status: 0 }
  const names = events.map((e) => e.name)
  check('S15 stream 200', status === 200, String(status))
  check('S15 snapshot first', names[0] === 'state' && events[0].data?.session?.uuid === k, names.join(','))
  check('S15 bid accepted', r.status === 200, String(r.status))
  const pushed = events.find((e) => e.name === 'session' && e.data?.session?.currentBid === 175)
  check('S15 bid pushed', pushed?.data?.leaderboard?.length === 1 && pushed.data.leaderboard[0].bids === 1, JSON.stringify(pushed?.data?.leaderboard))
  check('S15 push under 1.5s', pushed && pushed.at - bidSentAt < 1500, pushed ? `${pushed.at - bidSentAt}ms` : 'none')
  check('S15 no host_key leak', !JSON.stringify(events).includes('host_key'))
  check('S15 no per-bid events', !events.some((e) => e.name === 'bid'))
  const bad = await fetch(`${BASE_URL}/api/session/${encodeURIComponent('bad key!')}/stream`)
  check('S15 invalid key 400', bad.status === 400, String(bad.status))
})

if (WEBHOOK_TOKEN && SESSION_SECRET) {
  const signed = (bodyObj, { token = WEBHOOK_TOKEN, ts = Math.floor(Date.now() / 1000) } = {}) => {
    const body = JSON.stringify(bodyObj)
    const sig = createHmac('sha256', token).update(`v0:${ts}:${body}`).digest('hex')
    return fetch(`${BASE_URL}/api/zoom/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zm-signature': `v0=${sig}`, 'x-zm-request-timestamp': String(ts) },
      body,
    })
  }

  await scenario('S14', 'webhook-verified host', async () => {
    const plainToken = randomBytes(8).toString('hex')
    const v = await signed({ event: 'endpoint.url_validation', payload: { plainToken } })
    const vj = await v.json()
    check('S14a url validation', v.status === 200 && vj.encryptedToken === createHmac('sha256', WEBHOOK_TOKEN).update(plainToken).digest('hex'))
    const forged = await signed({ event: 'endpoint.url_validation', payload: { plainToken } }, { token: 'wrong' })
    check('S14b forged signature -> 401', forged.status === 401, String(forged.status))
    const stale = await signed({ event: 'endpoint.url_validation', payload: { plainToken } }, { ts: Math.floor(Date.now() / 1000) - 600 })
    check('S14c stale timestamp -> 401', stale.status === 401, String(stale.status))

    const mid = `race-mid-${randomBytes(4).toString('hex')}`
    const k = meetingKey(mid)
    // A participant claims host first, then Zoom reports the real host.
    const squatter = mintCookie('userSquat', mid)
    const host = mintCookie('userHost', mid)
    const r1 = await start(k, {}, squatter)
    check('S14d first claim works before webhook', r1.status === 200, String(r1.status))
    const w = await signed({ event: 'meeting.started', payload: { object: { uuid: mid, host_id: 'userHost', id: 1 } } })
    check('S14e meeting.started 200', w.status === 200, String(w.status))
    const r2 = await stop(k, squatter)
    check('S14f squatter loses control -> 403', r2.status === 403, String(r2.status))
    const r3 = await stop(k, host)
    check('S14g real host stops', r3.status === 200 && r3.json.state.viewer.isHost === true && r3.json.state.session.hostVerified === true, JSON.stringify([r3.status, r3.json?.state?.viewer]))
    const r4 = await start(k, {}, squatter)
    check('S14h squatter cannot restart -> 403', r4.status === 403, String(r4.status))
    const r5 = await start(k, {}, host)
    check('S14i real host restarts', r5.status === 200, String(r5.status))
  })
} else {
  console.log('SKIP  S14 webhook host (set ZOOM_WEBHOOK_SECRET_TOKEN and SESSION_SECRET to run)')
}

await scenario('S17', 'buy now race', async () => {
  const bad1 = await start(key(), { openingBid: 100, buyNowPrice: 100 })
  const bad2 = await start(key(), { openingBid: 100, reservePrice: 400, buyNowPrice: 300 })
  check('S17 buy now at opening -> 400', bad1.status === 400, String(bad1.status))
  check('S17 buy now under reserve -> 400', bad2.status === 400, String(bad2.status))

  const k = key()
  await init(k)
  const s = await start(k, { openingBid: 100, buyNowPrice: 500 })
  check('S17 round carries buy now', s.status === 200 && s.json.state.session.buyNowPrice === 500, JSON.stringify(s.json?.state?.session?.buyNowPrice))
  const normal = await bid(k, 150, 'steady')
  check('S17 bid under buy now stays open', normal.status === 200 && normal.json.bought === false && normal.json.state.session.status === 'open')
  // Ten buyers in the same instant, at and above the price: one wins, at
  // exactly the Buy Now price, and the round is closed for everyone else.
  const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => bid(k, 500 + 100 * i, `buyer-${i}`)))
  const h = histogram(rs)
  const winners = rs.filter((r) => r.status === 200)
  check('S17 exactly one buyer', winners.length === 1 && h[409] === 9, JSON.stringify(h))
  check('S17 sold at the buy now price', winners[0]?.json.bought === true && winners[0].json.amount === 500, JSON.stringify([winners[0]?.json.bought, winners[0]?.json.amount]))
  check('S17 losers see the round closed', rs.filter((r) => r.status === 409).every((r) => r.json.reason === 'not_open'), JSON.stringify(rs.map((r) => r.json?.reason)))
  const { json } = await get(k)
  check('S17 closed as bought', json.session.status === 'closed' && json.session.boughtNow === true && json.session.currentBid === 500)
  check('S17 two bids on record', totalBids(json) === 2, String(totalBids(json)))
  const late = await bid(k, 900, 'late')
  check('S17 no bids after buy now', late.status === 409 && late.json.reason === 'not_open')
})

await scenario('S18', 'results and CSV export', async () => {
  const k = key()
  await init(k)
  await start(k, { itemName: '=HYPERLINK("http://x","Lot, one")', openingBid: 100 })
  await bid(k, 150, 'Winner One')
  await stop(k)
  await start(k, { itemName: 'No takers', openingBid: 100 })
  await stop(k)
  await start(k, { itemName: 'Under reserve', openingBid: 100, reservePrice: 500 })
  await bid(k, 200, 'Too low')
  await stop(k)
  await start(k, { itemName: 'Instant', openingBid: 100, buyNowPrice: 300 })
  await bid(k, 300, 'Buyer')
  // Round 5 expires with nobody reading the session, then round 6 starts
  // straight over it: the unclosed round must still be recorded.
  await start(k, { itemName: 'Expired quietly', openingBid: 100, seconds: 5, extendWindowSeconds: 0 })
  await bid(k, 120, 'Quiet')
  await sleep(5600)
  await start(k, { itemName: 'Last lot', openingBid: 100 })
  await stop(k)

  const res = await fetch(`${BASE_URL}/api/session/${encodeURIComponent(k)}/results`)
  const rounds = (await res.json()).rounds
  check('S18 results 200', res.status === 200, String(res.status))
  check('S18 every finished round listed', rounds.length === 6, String(rounds.length))
  check('S18 outcomes', JSON.stringify(rounds.map((r) => r.outcome)) === JSON.stringify(['sold', 'no_bids', 'reserve_not_met', 'sold', 'sold', 'no_bids']), JSON.stringify(rounds.map((r) => r.outcome)))
  check('S18 winner and price', rounds[0].winner?.name === 'Winner One' && rounds[0].finalBid === 150 && rounds[0].bidCount === 1)
  check('S18 buy now flagged', rounds[3].boughtNow === true && rounds[3].finalBid === 300)
  check('S18 expired round recorded', rounds[4].winner?.name === 'Quiet' && rounds[4].finalBid === 120)

  const csvRes = await fetch(`${BASE_URL}/api/session/${encodeURIComponent(k)}/results?format=csv`)
  const csv = await csvRes.text()
  const lines = csv.trim().split('\r\n')
  check('S18 csv headers', csvRes.headers.get('content-type')?.startsWith('text/csv') && (csvRes.headers.get('content-disposition') ?? '').includes('attachment'))
  check('S18 csv has a row per round', lines.length === 7, String(lines.length))
  check('S18 csv neutralizes formulas', lines[1].startsWith(`1,"'=HYPERLINK(""http://x"",""Lot, one"")",Sold,150,Winner One,`), lines[1])
  check('S18 unsold rows carry no winner', lines[2].startsWith('2,No takers,Not sold (no bids),,,'), lines[2])
  const missing = await fetch(`${BASE_URL}/api/session/${encodeURIComponent(key())}/results`)
  check('S18 unknown session 404', missing.status === 404, String(missing.status))
})

if (SESSION_SECRET) {
  await scenario('S16', 'bid amounts stay private', async () => {
    const mid = `race-mid-${randomBytes(4).toString('hex')}`
    const k = meetingKey(mid)
    const host = mintCookie('userHost', mid)
    const alice = mintCookie('userAlice', mid)
    const bob = mintCookie('userBob', mid)
    await start(k, {}, host)
    await bid(k, 150, 'Alice', alice)
    await bid(k, 200, 'Bob', bob)
    const top = await bid(k, 250, 'Guest')
    check('S16 three bidders ranked', top.status === 200 && top.json.state.leaderboard.length === 3, JSON.stringify(top.json?.state?.leaderboard?.length))

    const byName = (state) => Object.fromEntries(state.leaderboard.map((e) => [e.name, e.amount]))
    const asAlice = byName((await get(k, alice)).json)
    const asBob = byName((await get(k, bob)).json)
    const asHost = byName((await get(k, host)).json)
    const asAnon = byName((await get(k)).json)
    check('S16 leader amount is the public price', [asAlice, asBob, asHost, asAnon].every((v) => v.Guest === 250))
    check('S16 alice sees only her own', asAlice.Alice === 150 && asAlice.Bob === null, JSON.stringify(asAlice))
    check('S16 bob sees only his own', asBob.Bob === 200 && asBob.Alice === null, JSON.stringify(asBob))
    check('S16 host sees every amount', asHost.Alice === 150 && asHost.Bob === 200, JSON.stringify(asHost))
    check('S16 anonymous sees none', asAnon.Alice === null && asAnon.Bob === null, JSON.stringify(asAnon))
    const ranks = (await get(k)).json.leaderboard.map((e) => [e.rank, e.name])
    check('S16 ranks are public', JSON.stringify(ranks) === JSON.stringify([[1, 'Guest'], [2, 'Bob'], [3, 'Alice']]), JSON.stringify(ranks))

    // The push path must not carry them either, for anyone.
    let nudge = null
    const { events } = await readStream(k, { timeoutMs: 15000, cookie: alice }, (evts) => {
      if (!nudge && evts.some((e) => e.name === 'state')) nudge = bid(k, 300, 'Guest')
      return evts.some((e) => e.name === 'session' && e.data?.session?.currentBid === 300)
    })
    await nudge
    const pushed = events.find((e) => e.name === 'session')
    check('S16 push carries ranks without amounts', pushed?.data?.leaderboard?.length === 3 && pushed.data.leaderboard.slice(1).every((e) => e.amount === null), JSON.stringify(pushed?.data?.leaderboard))
    check('S16 push never names 150 or 200', !/"amount":(150|200)\b/.test(JSON.stringify(events.filter((e) => e.name === 'session'))))

    const anonResults = await fetch(`${BASE_URL}/api/session/${encodeURIComponent(k)}/results`)
    const aliceResults = await fetch(`${BASE_URL}/api/session/${encodeURIComponent(k)}/results`, { headers: { cookie: alice } })
    const hostResults = await fetch(`${BASE_URL}/api/session/${encodeURIComponent(k)}/results?format=csv`, { headers: { cookie: host } })
    check('S16 results need an identity -> 401', anonResults.status === 401, String(anonResults.status))
    check('S16 results refuse non-hosts -> 403', aliceResults.status === 403, String(aliceResults.status))
    check('S16 host can export', hostResults.status === 200, String(hostResults.status))
    await stop(k, host)
  })
} else {
  console.log('SKIP  S16 bid privacy (set SESSION_SECRET to run)')
}

console.log('')
for (const r of results) {
  if (!r.ok) console.log(`  ✗ ${r.name}${r.detail ? `: ${r.detail}` : ''}`)
}
console.log(`${results.filter((r) => r.ok).length}/${results.length} assertions passed`)
process.exit(failures === 0 ? 0 : 1)
