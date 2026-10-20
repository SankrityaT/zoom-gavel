#!/usr/bin/env node
// Load and invariant test for the auction API. Where race-test.mjs asks
// "does each rule hold under a burst", this asks "does everything still hold
// when hundreds of people use it at once, and how fast is it".
//
//   BASE_URL=http://127.0.0.1:5180 node scripts/stress-test.mjs
//   ... STRESS_SESSIONS=30 STRESS_BIDDERS=10 STRESS_SECONDS=25   # load shape
//   ... STRESS_STREAMS=250                                       # SSE fan-out size
//   ... STRESS_ONLY=fanout,load,max,queue,lostpush               # pick phases (lostpush needs the SQL token)
//   ... SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=...        # also checks the ledger in SQL
//
// Point it at a local `next start`, not the public site: it spreads load over
// invented client addresses (x-forwarded-for), which Vercel would overwrite,
// and the per-IP limits would otherwise be the thing being measured. The
// database it talks to is whatever that server is configured for, so sessions
// are namespaced `stress-` and removed at the end.
//
// No dependencies.

import { randomBytes } from 'node:crypto'
import { execSync } from 'node:child_process'

const BASE_URL = process.env.BASE_URL
if (!BASE_URL) {
  console.error('BASE_URL is required, e.g. BASE_URL=http://127.0.0.1:5180')
  process.exit(2)
}
const SESSIONS = Number(process.env.STRESS_SESSIONS ?? 20)
const BIDDERS = Number(process.env.STRESS_BIDDERS ?? 10)
const SECONDS = Number(process.env.STRESS_SECONDS ?? 25)
const STREAMS = Number(process.env.STRESS_STREAMS ?? 200)
const ONLY = (process.env.STRESS_ONLY ?? 'fanout,load,max,queue,lostpush').split(',')
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const REF = process.env.SUPABASE_PROJECT_REF

const RUN = randomBytes(3).toString('hex')
const keyOf = (name) => `stress-${RUN}-${name}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rand = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1))

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  [${detail}]` : ''}`)
}

// Every virtual client gets its own address, so the limiter sees a crowd of
// people, not one machine.
let nextIp = 1
const ipFor = () => `10.${(nextIp >> 16) & 255}.${(nextIp >> 8) & 255}.${nextIp++ & 255}`

async function api(path, { method = 'GET', body, ip } = {}) {
  const started = performance.now()
  let res
  try {
    res = await fetch(`${BASE_URL}/api/session/${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip ?? ipFor() },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    return { status: 0, ms: performance.now() - started, json: null, error: String(error) }
  }
  let json = null
  try {
    json = await res.json()
  } catch {
    /* non-JSON */
  }
  return { status: res.status, ms: performance.now() - started, json }
}
const enc = encodeURIComponent
const initSession = (k) => api(enc(k), { method: 'POST', body: { init: true, itemName: 'Stress lot', openingBid: 100 } })
const startRound = (k, o = {}) =>
  api(`${enc(k)}/round`, {
    method: 'POST',
    body: { action: 'start', itemName: 'Stress lot', openingBid: 100, reservePrice: null, seconds: 30, extendWindowSeconds: 10, extendBySeconds: 15, ...o },
  })
const placeBid = (k, amount, who, ip) => api(enc(k), { method: 'POST', body: { amount, bidderId: who }, ip })
const setMax = (k, amount, who, ip) => api(`${enc(k)}/max`, { method: 'POST', body: { amount, bidderId: who }, ip })
const queueCall = (k, body) => api(`${enc(k)}/queue`, { method: 'POST', body })

function pct(list, p) {
  if (list.length === 0) return 0
  const sorted = [...list].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}
const fmt = (ms) => `${Math.round(ms)}ms`
const lat = (list) => `p50 ${fmt(pct(list, 50))}  p95 ${fmt(pct(list, 95))}  p99 ${fmt(pct(list, 99))}  max ${fmt(Math.max(0, ...list))}`
const hist = (rs) => rs.reduce((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {})

async function sql(query) {
  if (!TOKEN || !REF) return null
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  if (!res.ok) throw new Error(`sql ${res.status}: ${await res.text()}`)
  return res.json()
}

function serverRssMb() {
  try {
    const port = new URL(BASE_URL).port || '80'
    const pid = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: 'utf8' }).split('\n')[0]
    return Math.round(Number(execSync(`ps -o rss= -p ${pid}`, { encoding: 'utf8' })) / 1024)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- fan-out
// One session, many watchers on the SSE stream. A bid must reach every one of
// them, and quickly.
async function fanout() {
  console.log(`\nFAN-OUT  ${STREAMS} live streams on one session`)
  const k = keyOf('fanout')
  await initSession(k)
  await startRound(k, { seconds: 120 })
  const rssBefore = serverRssMb()

  const clients = []
  const t0 = performance.now()
  const opened = await Promise.all(
    Array.from({ length: STREAMS }, async (_, i) => {
      const abort = new AbortController()
      const client = { i, abort, gotState: false, gotBid: null, bytes: 0 }
      clients.push(client)
      try {
        const res = await fetch(`${BASE_URL}/api/session/${enc(k)}/stream`, {
          headers: { 'x-forwarded-for': ipFor() },
          signal: abort.signal,
        })
        if (res.status !== 200) return { status: res.status }
        ;(async () => {
          const decoder = new TextDecoder()
          let buffer = ''
          try {
            for await (const chunk of res.body) {
              buffer += decoder.decode(chunk, { stream: true })
              let cut
              while ((cut = buffer.indexOf('\n\n')) >= 0) {
                const frame = buffer.slice(0, cut)
                buffer = buffer.slice(cut + 2)
                const name = /^event: (.+)$/m.exec(frame)?.[1]
                const data = /^data: (.+)$/m.exec(frame)?.[1]
                if (name === 'state') client.gotState = true
                if ((name === 'session' || name === 'state') && data) {
                  const session = JSON.parse(data).session
                  if (session && session.currentBid >= 300 && client.gotBid === null) client.gotBid = performance.now()
                }
              }
            }
          } catch {
            /* aborted */
          }
        })()
        return { status: 200, ms: performance.now() - t0 }
      } catch (error) {
        return { status: 0, error: String(error) }
      }
    }),
  )
  const okStreams = opened.filter((o) => o.status === 200)
  check(`all ${STREAMS} streams opened`, okStreams.length === STREAMS, JSON.stringify(hist(opened)))
  await sleep(4000)
  check('every stream got its opening snapshot', clients.filter((c) => c.gotState).length === okStreams.length, `${clients.filter((c) => c.gotState).length}/${okStreams.length}`)

  const sentAt = performance.now()
  const r = await placeBid(k, 300, 'stress-fan')
  check('bid accepted', r.status === 200, String(r.status))
  await sleep(6000)
  const got = clients.filter((c) => c.gotBid !== null)
  const lags = got.map((c) => c.gotBid - sentAt)
  check('the bid reached every stream', got.length === okStreams.length, `${got.length}/${okStreams.length}`)
  console.log(`  bid to screen: ${lat(lags)}`)
  check('slowest stream under 3s', Math.max(0, ...lags) < 3000, fmt(Math.max(0, ...lags)))
  const rssAfter = serverRssMb()
  if (rssBefore && rssAfter) console.log(`  server memory: ${rssBefore} MB before, ${rssAfter} MB with ${STREAMS} streams open`)

  for (const c of clients) c.abort.abort()
  await sleep(1500)
  const rssDone = serverRssMb()
  if (rssDone) console.log(`  server memory after closing them: ${rssDone} MB`)
}

// ------------------------------------------------------------------- load
// Many sessions at once, each with a crowd bidding and setting max bids while
// the rounds expire. Then the ledger is checked against what the API said.
const loadKeys = []
async function load() {
  console.log(`\nLOAD  ${SESSIONS} sessions x ${BIDDERS} bidders for ${SECONDS}s (${SESSIONS * BIDDERS} people)`)
  const keys = Array.from({ length: SESSIONS }, (_, i) => keyOf(`load-${i}`))
  loadKeys.push(...keys)
  const setup = []
  for (let i = 0; i < keys.length; i += 10) {
    setup.push(...(await Promise.all(keys.slice(i, i + 10).map(async (k) => [await initSession(k), await startRound(k, { seconds: SECONDS, extendWindowSeconds: 3, extendBySeconds: 4 })]))))
  }
  check('every session started', setup.every(([a, b]) => (a.status === 200 || a.status === 201) && b.status === 200), JSON.stringify(hist(setup.flat())))

  const bidLat = []
  const maxLat = []
  const statuses = []
  const accepted = new Map(keys.map((k) => [k, []]))
  const endAt = performance.now() + SECONDS * 1000 - 1500

  async function bidder(k, n) {
    const who = `u${n}`
    const ip = ipFor()
    let price = 100
    const wantsMax = n % 3 === 0
    await sleep(rand(0, 800))
    if (wantsMax) {
      const m = await setMax(k, rand(300, 1500), who, ip)
      maxLat.push(m.ms)
      statuses.push(m)
    }
    while (performance.now() < endAt) {
      const amount = price + 25 * rand(1, 4)
      const r = await placeBid(k, amount, who, ip)
      bidLat.push(r.ms)
      statuses.push(r)
      if (r.status === 200) {
        accepted.get(k).push({ who, amount: r.json.amount ?? amount })
        price = r.json.state.session.currentBid
      } else if (r.status === 409 && r.json?.state) {
        price = r.json.state.session.currentBid
      }
      await sleep(rand(900, 1700))
    }
  }

  const started = performance.now()
  await Promise.all(keys.flatMap((k, s) => Array.from({ length: BIDDERS }, (_, b) => bidder(k, s * BIDDERS + b + 1))))
  const elapsed = (performance.now() - started) / 1000
  const total = bidLat.length
  console.log(`  ${total} bids and ${maxLat.length} max bids in ${elapsed.toFixed(0)}s (${(total / elapsed).toFixed(1)} bids/s)`)
  console.log(`  bid latency:     ${lat(bidLat)}`)
  if (maxLat.length) console.log(`  max-bid latency: ${lat(maxLat)}`)
  const h = hist(statuses)
  console.log(`  statuses: ${JSON.stringify(h)}`)
  check('no server errors or dropped requests', (h[500] ?? 0) + (h[502] ?? 0) + (h[503] ?? 0) + (h[0] ?? 0) === 0)
  check('no rate limiting of normal use', (h[429] ?? 0) === 0, String(h[429] ?? 0))
  check('bid p95 under 1.5s', pct(bidLat, 95) < 1500, fmt(pct(bidLat, 95)))

  // Let every round close, then try to bid into the closed rounds.
  await sleep(4000)
  const states = await Promise.all(keys.map((k) => api(enc(k))))
  check('every round is closed', states.every((s) => s.json?.session?.status === 'closed'), JSON.stringify(hist(states.map((s) => ({ status: s.json?.session?.status })))))
  const late = await Promise.all(keys.flatMap((k) => Array.from({ length: 3 }, (_, i) => placeBid(k, 9_000 + i, 'latecomer'))))
  check('bids after the close are refused', late.every((r) => r.status === 409 && ['expired', 'not_open'].includes(r.json?.reason)), JSON.stringify(hist(late)))

  // Ledger invariants, straight from the database.
  const prefix = `stress-${RUN}-load-`
  const rows = await sql(`
    with b as (
      select session_uuid, round_no, id, amount, bidder_key, auto,
             lag(amount) over (partition by session_uuid, round_no order by id) as prev
        from auction_bids where session_uuid like '${prefix}%'
    )
    select
      (select count(*) from b)                                        as bids,
      (select count(*) from b where prev is not null and (amount < prev or (amount = prev and not auto))) as not_increasing,
      (select count(*) from auction_sessions s where s.uuid like '${prefix}%'
         and s.current_bid is distinct from (select max(amount) from auction_bids x where x.session_uuid = s.uuid and x.round_no = s.round_no)
         and exists (select 1 from auction_bids x where x.session_uuid = s.uuid and x.round_no = s.round_no)) as price_mismatch,
      (select count(*) from auction_sessions s where s.uuid like '${prefix}%'
         and s.last_bidder_id is distinct from (select bidder_key from auction_bids x where x.session_uuid = s.uuid and x.round_no = s.round_no order by id desc limit 1)
         and exists (select 1 from auction_bids x where x.session_uuid = s.uuid and x.round_no = s.round_no)) as leader_mismatch,
      (select count(*) from auction_rounds where session_uuid like '${prefix}%')      as round_rows,
      (select count(distinct session_uuid) from auction_rounds where session_uuid like '${prefix}%') as rounds_sessions,
      (select count(*) from auction_rounds r where r.session_uuid like '${prefix}%'
         and r.bid_count is distinct from (select count(*) from auction_bids x where x.session_uuid = r.session_uuid and x.round_no = r.round_no)) as bid_count_mismatch,
      (select count(*) from auction_rounds r where r.session_uuid like '${prefix}%'
         and r.final_bid is distinct from (select max(amount) from auction_bids x where x.session_uuid = r.session_uuid and x.round_no = r.round_no)) as final_mismatch,
      (select count(*) from auction_bids where session_uuid like '${prefix}%' and amount > 1000000)  as over_ceiling,
      (select count(*) from pg_stat_activity)                                                      as connections
  `)
  if (!rows) {
    console.log('  (no SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF: skipping the ledger checks)')
    return
  }
  const r = rows[0]
  console.log(`  ledger: ${r.bids} rows across ${SESSIONS} sessions, ${r.connections} database connections open`)
  check('ledger amounts never fall within a round (a tie is only ever an automatic bid)', Number(r.not_increasing) === 0, `${r.not_increasing} violations`)
  check('every session price equals its highest bid', Number(r.price_mismatch) === 0, `${r.price_mismatch}`)
  check('every session leader placed the last bid', Number(r.leader_mismatch) === 0, `${r.leader_mismatch}`)
  check('exactly one round record per session', Number(r.round_rows) === SESSIONS && Number(r.rounds_sessions) === SESSIONS, `${r.round_rows} rows`)
  check('round records agree with the ledger', Number(r.bid_count_mismatch) === 0 && Number(r.final_mismatch) === 0, `${r.bid_count_mismatch}/${r.final_mismatch}`)
  check('nothing over the ceiling', Number(r.over_ceiling) === 0)
  const apiBids = [...accepted.values()].reduce((s, l) => s + l.length, 0)
  check('every accepted manual bid is in the ledger', Number(r.bids) >= apiBids, `ledger ${r.bids} vs ${apiBids} accepted by hand (the rest are automatic)`)
}

// ----------------------------------------------------------- max contests
// Several bidders set ceilings at the same instant. However the requests
// interleave, the highest ceiling must lead, at one step above the runner up.
async function maxContests() {
  const TRIALS = 24
  const WHO = 8
  console.log(`\nMAX BIDS  ${TRIALS} contests, ${WHO} simultaneous ceilings each`)
  let wrong = 0
  let errors = 0
  let refused = 0
  const lats = []
  const detail = []
  await Promise.all(
    Array.from({ length: TRIALS }, async (_, t) => {
      const k = keyOf(`max-${t}`)
      await initSession(k)
      await startRound(k, { seconds: 120 })
      const pool = new Set()
      while (pool.size < WHO) pool.add(5 * rand(31, 400)) // 155 to 2000, distinct
      const ceilings = [...pool]
      const results = await Promise.all(ceilings.map((c, i) => setMax(k, c, `m${i}`, ipFor())))
      for (const r of results) lats.push(r.ms)
      // A ceiling already below the price when it lands cannot take the lead
      // and is refused with too_low; that is the rule, not a failure. Anything
      // else that is not a 200 is.
      if (results.some((r) => r.status !== 200 && !(r.status === 409 && r.json?.reason === 'too_low'))) {
        errors++
        return
      }
      refused += results.filter((r) => r.status === 409).length
      const state = (await api(enc(k))).json
      const taken = ceilings.filter((_, i) => results[i].status === 200)
      const sorted = [...taken].sort((a, b) => b - a)
      const topIndex = ceilings.indexOf(sorted[0])
      const expectedPrice = Math.min(sorted[0], sorted[1] + 25)
      const leader = state.leaderboard[0]
      const ok = state.session.currentBid === expectedPrice && leader?.name.startsWith(`m${topIndex}`)
      if (!ok) {
        wrong++
        detail.push(`${k}: ceilings ${sorted.slice(0, 3).join('/')} -> price ${state.session.currentBid} (expected ${expectedPrice}), leader ${leader?.name}`)
      }
    }),
  )
  console.log(`  max-bid latency: ${lat(lats)}; ${refused} of ${TRIALS * WHO} ceilings landed below the price and were refused`)
  check('every ceiling request was accepted or cleanly refused', errors === 0, `${errors} contests had a failed request`)
  check('highest ceiling leads, at runner up plus one step, every time', wrong === 0, detail.slice(0, 2).join(' | '))
}

// ------------------------------------------------------------------ queue
async function queue() {
  console.log('\nQUEUE  concurrent adds, removes and starts')
  const k = keyOf('queue')
  await initSession(k)
  const adds = await Promise.all(Array.from({ length: 40 }, (_, i) => queueCall(k, { action: 'add', itemName: `Lot ${i}`, openingBid: 50, reservePrice: null, buyNowPrice: null, seconds: 30 })))
  const okAdds = adds.filter((r) => r.status === 200)
  check('exactly 30 adds accepted, the rest refused as full', okAdds.length === 30 && adds.filter((r) => r.status === 409 && r.json?.reason === 'queue_full').length === 10, JSON.stringify(hist(adds)))
  let list = (await api(`${enc(k)}/queue`)).json?.queue ?? []
  check('the queue holds 30 distinct lots', list.length === 30 && new Set(list.map((l) => l.id)).size === 30, String(list.length))

  const victims = list.slice(5, 15).map((l) => l.id)
  const removes = await Promise.all(victims.map((id) => queueCall(k, { action: 'remove', id })))
  check('10 concurrent removes all succeed', removes.every((r) => r.status === 200), JSON.stringify(hist(removes)))
  list = (await api(`${enc(k)}/queue`)).json?.queue ?? []
  const state = (await api(enc(k))).json
  check('queue length and the public count agree (20)', list.length === 20 && state.session.queuedCount === 20, `${list.length} vs ${state.session.queuedCount}`)
  check('the next lot named on the session is the oldest remaining', state.session.upNext === list[0]?.itemName, `${state.session.upNext} vs ${list[0]?.itemName}`)

  const expectedFirst = list[0].itemName
  const starts = await Promise.all(Array.from({ length: 8 }, () => queueCall(k, { action: 'start' })))
  const won = starts.filter((r) => r.status === 200)
  check('8 simultaneous starts open exactly one round', won.length === 1 && starts.filter((r) => r.status === 409 && r.json?.reason === 'round_open').length === 7, JSON.stringify(hist(starts)))
  const after = (await api(enc(k))).json
  check('the lot that opened was the oldest', after.session.itemName === expectedFirst, `${after.session.itemName} vs ${expectedFirst}`)
  check('exactly one lot left the queue', after.session.queuedCount === 19, String(after.session.queuedCount))

  // Drain it: stop, start next, 60 times over, interleaved.
  let drained = 0
  for (let i = 0; i < 19; i++) {
    await api(`${enc(k)}/round`, { method: 'POST', body: { action: 'stop' } })
    const r = await queueCall(k, { action: 'start' })
    if (r.status === 200) drained++
  }
  const end = (await api(enc(k))).json
  check('draining the queue one at a time ends empty', drained === 19 && end.session.queuedCount === 0 && end.session.upNext === null, `${drained} started, ${end.session.queuedCount} left`)
  const empty = await queueCall(k, { action: 'start' })
  await api(`${enc(k)}/round`, { method: 'POST', body: { action: 'stop' } })
  const empty2 = await queueCall(k, { action: 'start' })
  check('starting from an empty queue is refused cleanly', empty.status === 409 && empty2.status === 409 && empty2.json?.reason === 'queue_empty', `${empty.status}/${empty2.status}`)
}

// ------------------------------------------------------------- lost push
// Supabase can drop a broadcast (seen after a long idle spell). The server
// reads each live session every few seconds, so an update that never arrived
// by push must still reach an open stream. Triggers are switched off for one
// statement to make the push impossible.
async function lostPush() {
  console.log('\nLOST PUSH  an update with no broadcast must still reach an open stream')
  if (!TOKEN || !REF) {
    console.log('  (needs SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF; skipped)')
    return
  }
  const k = keyOf('lostpush')
  await initSession(k)
  await startRound(k, { seconds: 120 })
  const abort = new AbortController()
  let sawAt = null
  let t0 = 0
  const res = await fetch(`${BASE_URL}/api/session/${enc(k)}/stream`, { headers: { 'x-forwarded-for': ipFor() }, signal: abort.signal })
  ;(async () => {
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true })
        let cut
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, cut)
          buffer = buffer.slice(cut + 2)
          const data = /^data: (.+)$/m.exec(frame)?.[1]
          if (data && JSON.parse(data).session?.currentBid === 555 && sawAt === null) sawAt = performance.now()
        }
      }
    } catch {
      /* aborted */
    }
  })()
  await sleep(3000)
  t0 = performance.now()
  await sql(`set session_replication_role = replica; update auction_sessions set current_bid = 555, updated_at = clock_timestamp() where uuid = '${k}'`)
  const direct = await api(enc(k))
  check('the update is in the database', direct.json?.session?.currentBid === 555, String(direct.json?.session?.currentBid))
  await sleep(7000)
  abort.abort()
  check('the open stream still heard about it, with no push', sawAt !== null, sawAt === null ? 'never arrived' : `${fmt(sawAt - t0)} later`)
  check('within 5 seconds', sawAt !== null && sawAt - t0 < 5000, sawAt === null ? '' : fmt(sawAt - t0))
}

// -------------------------------------------------------------------- run
console.log(`stress run ${RUN} against ${BASE_URL}`)
const t0 = performance.now()
try {
  if (ONLY.includes('fanout')) await fanout()
  if (ONLY.includes('load')) await load()
  if (ONLY.includes('max')) await maxContests()
  if (ONLY.includes('queue')) await queue()
  if (ONLY.includes('lostpush')) await lostPush()
} catch (error) {
  failures++
  console.error('THREW', error)
} finally {
  try {
    const gone = await sql(`delete from auction_sessions where uuid like 'stress-${RUN}-%' returning uuid`)
    if (gone) console.log(`\ncleaned up ${gone.length} sessions`)
    else console.log(`\nleft sessions named stress-${RUN}-* in place (they expire on their own after 24h)`)
  } catch (error) {
    console.log('cleanup failed:', String(error))
  }
}
console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`} in ${((performance.now() - t0) / 1000).toFixed(0)}s`)
process.exit(failures === 0 ? 0 : 1)
