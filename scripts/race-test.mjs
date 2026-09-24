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
  const ladder = json.bids
  check('S1 all 200/409', (h[200] ?? 0) + (h[409] ?? 0) === 20, JSON.stringify(h))
  check('S1 rejections are too_low', rs.filter((r) => r.status === 409).every((r) => r.json.reason === 'too_low'))
  check('S1 currentBid is max accepted', json.session.currentBid === Math.max(...accepted))
  check('S1 ladder count', ladder.length === (h[200] ?? 0), `${ladder.length} vs ${h[200]}`)
  const byId = [...ladder].sort((a, b) => a.id - b.id).map((b) => b.amount)
  check('S1 ladder strictly increasing', byId.every((v, i) => i === 0 || v > byId[i - 1]), byId.join(','))
})

await scenario('S2', 'identical amount collision', async () => {
  const k = key()
  await init(k)
  await start(k)
  const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => bid(k, 200, `dup-${i}`)))
  const h = histogram(rs)
  const { json } = await get(k)
  check('S2 exactly one accepted', h[200] === 1 && h[409] === 9, JSON.stringify(h))
  check('S2 one bid row', json.bids.length === 1)
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
  check('S4 accepted bids before endsAt', json.bids.every((b) => new Date(b.createdAt).getTime() <= new Date(json.session.endsAt).getTime() + 50))
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
    .map((r) => ({ id: r.json.state.bids[0]?.id ?? 0, endsAt: new Date(r.json.state.session.endsAt).getTime() }))
    .sort((a, b) => a.id - b.id)
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
  check('S7 accepted bids in ladder', acceptedAmounts.every((a) => json.bids.some((b) => b.amount === a)))
  check('S7 currentBid is max accepted', acceptedAmounts.length === 0 || json.session.currentBid === Math.max(...acceptedAmounts))
  check('S7 rejections are not_open/too_low', bids.filter((r) => r.status === 409).every((r) => ['not_open', 'too_low', 'expired'].includes(r.json.reason)))
  const closedAt = new Date(json.session.closedAt).getTime()
  check('S7 no bid after closedAt', json.bids.every((b) => new Date(b.createdAt).getTime() <= closedAt + 50))
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
    check('S11 verified bid accepted', rb.status === 200 && rb.json.state.bids[0].verified === true)
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

// Reads SSE events from a fetch body until `want` returns true or timeout.
async function readStream(k, { timeoutMs = 15000, cookie } = {}, want) {
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
    return evts.some((e) => e.name === 'bid')
  })
  const r = bidRequest ? await bidRequest : { status: 0 }
  const names = events.map((e) => e.name)
  check('S15 stream 200', status === 200, String(status))
  check('S15 snapshot first', names[0] === 'state' && events[0].data?.session?.uuid === k, names.join(','))
  check('S15 bid accepted', r.status === 200, String(r.status))
  const bidEvent = events.find((e) => e.name === 'bid')
  check('S15 bid pushed', bidEvent?.data?.bid?.amount === 175, JSON.stringify(bidEvent?.data))
  check('S15 push under 1.5s', bidEvent && bidEvent.at - bidSentAt < 1500, bidEvent ? `${bidEvent.at - bidSentAt}ms` : 'none')
  const sessionEvent = events.find((e) => e.name === 'session')
  check('S15 no host_key leak', !JSON.stringify(events).includes('host_key'))
  check('S15 session delta', !sessionEvent || sessionEvent.data.session.currentBid >= 100)
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

console.log('')
for (const r of results) {
  if (!r.ok) console.log(`  ✗ ${r.name}${r.detail ? `: ${r.detail}` : ''}`)
}
console.log(`${results.filter((r) => r.ok).length}/${results.length} assertions passed`)
process.exit(failures === 0 ? 0 : 1)
