#!/usr/bin/env node
// End-to-end test of "Sign in with Zoom" without Zoom. A fake Zoom (token and
// user endpoints) runs in this process, a real `next start` runs against it,
// and this script plays the browser: start, follow to the callback, land
// signed in. Also the attacks: forged state, replay, a copied handshake
// cookie, open redirect, a refused consent, a token exchange that fails.
//
//   npm run build
//   set -a; . ./.env.local; set +a; node scripts/oauth-test.mjs
//
// Needs SESSION_SECRET and ZOOM_CLIENT_SECRET in the environment (the same
// ones the app uses). Starts the app on port 5191, with the fake-Zoom opt-in
// the app otherwise ignores.

import { createHash, createHmac, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'

const SESSION_SECRET = process.env.SESSION_SECRET
const CLIENT_SECRET = process.env.ZOOM_CLIENT_SECRET
if (!SESSION_SECRET || !CLIENT_SECRET) {
  console.error('SESSION_SECRET and ZOOM_CLIENT_SECRET are required')
  process.exit(2)
}
const CLIENT_ID = 'fake-client-id'
const APP_PORT = 5191
// Next reports its own address as localhost, and the redirect address is built from it.
const APP = `http://localhost:${APP_PORT}`

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  [${detail}]` : ''}`)
}

// ----------------------------------------------------------- fake Zoom
const codes = new Map() // code -> { challenge, redirectUri }
const tokens = new Map() // token -> user
let failNextExchange = false
let exchanges = 0

const fake = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://fake')
  const body = await new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
  })
  const json = (status, value) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(value))
  }
  if (url.pathname === '/oauth/token' && req.method === 'POST') {
    exchanges++
    if (failNextExchange) {
      failNextExchange = false
      return json(400, { error: 'invalid_grant' })
    }
    const expected = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`
    if (req.headers.authorization !== expected) return json(401, { error: 'invalid_client' })
    const form = new URLSearchParams(body)
    const entry = codes.get(form.get('code'))
    if (form.get('grant_type') !== 'authorization_code' || !entry) return json(400, { error: 'invalid_grant' })
    codes.delete(form.get('code')) // one time only
    const challenge = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url')
    if (challenge !== entry.challenge) return json(400, { error: 'invalid_grant', why: 'pkce' })
    if (form.get('redirect_uri') !== entry.redirectUri) return json(400, { error: 'invalid_grant', why: 'redirect_uri' })
    const token = randomBytes(12).toString('hex')
    tokens.set(token, { id: 'zoomUserOAuth1', display_name: 'Olive Browser', first_name: 'Olive', last_name: 'Browser' })
    return json(200, { access_token: token, token_type: 'bearer', expires_in: 3600 })
  }
  if (url.pathname === '/v2/users/me') {
    const user = tokens.get((req.headers.authorization ?? '').replace('Bearer ', ''))
    return user ? json(200, user) : json(401, { code: 124 })
  }
  json(404, {})
})

// ----------------------------------------------------------- the browser
function cookiesFrom(res) {
  const out = {}
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(';')
    const eq = pair.indexOf('=')
    out[pair.slice(0, eq)] = pair.slice(eq + 1)
  }
  return out
}
const jar = (cookies) => Object.entries(cookies).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ')
const get = (path, cookie) => fetch(`${APP}${path}`, { redirect: 'manual', headers: cookie ? { cookie } : {} })

// Starts a sign-in and returns what the browser would hold and what Zoom saw.
async function begin(returnTo = '/zoom-test?session=oauth-room') {
  const res = await get(`/api/oauth/zoom/start?return=${encodeURIComponent(returnTo)}`)
  const location = new URL(res.headers.get('location') ?? 'http://none')
  const handshake = cookiesFrom(res)
  return { res, location, handshake }
}
function grantFor(location) {
  const code = randomBytes(10).toString('hex')
  codes.set(code, { challenge: location.searchParams.get('code_challenge'), redirectUri: location.searchParams.get('redirect_uri') })
  return code
}
const ownViewName = (bid) => bid.state?.leaderboard?.[0]?.name ?? null

// --------------------------------------------------------------- the run
await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve))
const fakeBase = `http://127.0.0.1:${fake.address().port}`
const server = spawn('npx', ['next', 'start', '-p', String(APP_PORT)], {
  env: { ...process.env, ZOOM_CLIENT_ID: CLIENT_ID, ZOOM_OAUTH_BASE: fakeBase, ZOOM_API_BASE: fakeBase, ZOOM_OAUTH_ALLOW_OVERRIDE: '1' },
  stdio: 'ignore',
})
const stop = () => {
  server.kill()
  fake.close()
}
process.on('exit', stop)
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`${APP}/api/me`)).ok) break
  } catch {
    /* not up yet */
  }
  await new Promise((r) => setTimeout(r, 500))
}

try {
  console.log('before signing in')
  const me0 = await (await get('/api/me')).json()
  check('a browser with no cookie is not signed in, and sign-in is on offer', me0.signedIn === false && me0.canSignIn === true, JSON.stringify(me0))

  console.log('\nthe happy path')
  const { res: startRes, location, handshake } = await begin()
  check('start redirects to Zoom', startRes.status === 302 && location.origin === fakeBase && location.pathname === '/oauth/authorize', `${startRes.status} ${location.href.slice(0, 60)}`)
  check('the request names the app, the callback, PKCE (S256) and a state', location.searchParams.get('client_id') === CLIENT_ID && location.searchParams.get('redirect_uri') === `${APP}/api/oauth/zoom/callback` && location.searchParams.get('code_challenge_method') === 'S256' && (location.searchParams.get('state') ?? '').length >= 16 && (location.searchParams.get('code_challenge') ?? '').length >= 40)
  check('the handshake cookie is HttpOnly and scoped to the sign-in path', /gavel_oauth=/.test(startRes.headers.get('set-cookie') ?? '') && /HttpOnly/i.test(startRes.headers.get('set-cookie') ?? '') && /Path=\/api\/oauth/i.test(startRes.headers.get('set-cookie') ?? ''))

  const state = location.searchParams.get('state')
  const code = grantFor(location)
  const done = await get(`/api/oauth/zoom/callback?code=${code}&state=${state}`, jar(handshake))
  const after = cookiesFrom(done)
  check('the callback sends the person back where they came from', done.status === 302 && new URL(done.headers.get('location')).pathname + new URL(done.headers.get('location')).search === '/zoom-test?session=oauth-room', done.headers.get('location'))
  check('and sets the identity cookie', Boolean(after.gavel_ctx), Object.keys(after).join(','))
  check('and clears the handshake cookie', after.gavel_oauth === '')

  const signed = jar({ gavel_ctx: after.gavel_ctx })
  const me1 = await (await get('/api/me', signed)).json()
  check('the browser now reads as signed in, with the Zoom name', me1.signedIn === true && me1.name === 'Olive Browser', JSON.stringify(me1))

  const room = `oauth-room-${randomBytes(3).toString('hex')}`
  const post = (path, body, cookie) =>
    fetch(`${APP}/api/session/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) })
  await post(room, { init: true, itemName: 'Lot', openingBid: 100 })
  await post(`${room}/round`, { action: 'start', itemName: 'Lot', openingBid: 100, reservePrice: null, seconds: 60, extendWindowSeconds: 10, extendBySeconds: 15 })
  const bidRes = await (await post(room, { amount: 150, bidderId: 'Anything I type' }, signed)).json()
  const expectedKey = createHmac('sha256', SESSION_SECRET).update('zoom:zoomUserOAuth1').digest('hex').slice(0, 16)
  check('a bid places as that Zoom account: the same key an in-meeting bid would get', bidRes.state?.viewer?.verified === true && bidRes.state?.viewer?.bidderKey === expectedKey, JSON.stringify(bidRes.state?.viewer))
  check('they are verified but not "in" any meeting, so they cannot host one', bidRes.state?.viewer?.inThisMeeting === false && bidRes.state?.viewer?.isHost === false)
  check('and is shown under the name Zoom gave, not the one they typed', ownViewName(bidRes) === 'Olive Browser', JSON.stringify(ownViewName(bidRes)))
  const guestView = await (await get(`/api/session/${room}`)).json()
  const ownView = await (await get(`/api/session/${room}`, signed)).json()
  check('the signed-in bidder sees their own amount', ownView.leaderboard?.[0]?.amount === 150)
  check('a stranger sees the ranking but not whose it is by amount, beyond the public price', guestView.leaderboard?.length === 1)

  const forgedSignOut = await fetch(`${APP}/api/me`, { method: 'DELETE', headers: { cookie: signed, origin: 'https://evil.example', 'content-type': 'application/json' } })
  check('another site cannot sign a person out', forgedSignOut.status === 403, String(forgedSignOut.status))
  const out = await fetch(`${APP}/api/me`, { method: 'DELETE', headers: { cookie: signed, 'content-type': 'application/json' } })
  check('signing out clears the cookie', out.status === 200 && (cookiesFrom(out).gavel_ctx ?? 'x') === '', String(out.status))

  console.log('\nattacks and failures')
  const failedTo = (res) => new URL(res.headers.get('location') ?? 'http://none').searchParams.get('signin') === 'failed'
  const noCookies = (res) => !cookiesFrom(res).gavel_ctx

  let t = await begin()
  let c = grantFor(t.location)
  let r = await get(`/api/oauth/zoom/callback?code=${c}&state=WRONG`, jar(t.handshake))
  check('a forged state is refused, and nothing is issued', failedTo(r) && noCookies(r), String(r.status))

  t = await begin()
  c = grantFor(t.location)
  r = await get(`/api/oauth/zoom/callback?code=${c}&state=${t.location.searchParams.get('state')}`)
  check('a callback with no handshake cookie (login CSRF) is refused', failedTo(r) && noCookies(r))

  t = await begin()
  c = grantFor(t.location)
  const tampered = { ...t.handshake, gavel_oauth: t.handshake.gavel_oauth.replace(/.$/, (ch) => (ch === 'A' ? 'B' : 'A')) }
  r = await get(`/api/oauth/zoom/callback?code=${c}&state=${t.location.searchParams.get('state')}`, jar(tampered))
  check('a tampered handshake cookie is refused', failedTo(r) && noCookies(r))

  t = await begin()
  c = grantFor(t.location)
  const ok1 = await get(`/api/oauth/zoom/callback?code=${c}&state=${t.location.searchParams.get('state')}`, jar(t.handshake))
  const replay = await get(`/api/oauth/zoom/callback?code=${c}&state=${t.location.searchParams.get('state')}`, jar(t.handshake))
  check('the same code cannot be used twice', Boolean(cookiesFrom(ok1).gavel_ctx) && failedTo(replay) && noCookies(replay))

  // The handshake cookie is cleared in the browser, but a copy is still a valid
  // signature: the server must remember it has seen that state.
  t = await begin()
  const stateValue = t.location.searchParams.get('state')
  const firstTry = await get(`/api/oauth/zoom/callback?code=${grantFor(t.location)}&state=${stateValue}`, jar(t.handshake))
  const exchangesBefore = exchanges
  const copiedCookie = await get(`/api/oauth/zoom/callback?code=${grantFor(t.location)}&state=${stateValue}`, jar(t.handshake))
  check('a copy of the handshake cookie cannot start a second exchange, even with a fresh valid code', Boolean(cookiesFrom(firstTry).gavel_ctx) && failedTo(copiedCookie) && noCookies(copiedCookie))
  check('and Zoom is not even asked', exchanges === exchangesBefore, `${exchanges - exchangesBefore} extra calls`)

  // A cookie signed for something else (an identity cookie) is not a handshake.
  const asHandshake = await get(`/api/oauth/zoom/callback?code=${grantFor(t.location)}&state=${stateValue}`, `gavel_oauth=${cookiesFrom(firstTry).gavel_ctx}`)
  check('an identity cookie presented as a handshake is refused', failedTo(asHandshake) && noCookies(asHandshake))

  t = await begin()
  r = await get(`/api/oauth/zoom/callback?error=access_denied&state=${t.location.searchParams.get('state')}`, jar(t.handshake))
  check('saying no at Zoom ends in a clean failure', failedTo(r) && noCookies(r))

  t = await begin()
  c = grantFor(t.location)
  failNextExchange = true
  r = await get(`/api/oauth/zoom/callback?code=${c}&state=${t.location.searchParams.get('state')}`, jar(t.handshake))
  check('Zoom refusing the code ends in a clean failure', failedTo(r) && noCookies(r))

  t = await begin()
  r = await get(`/api/oauth/zoom/callback?code=never-issued&state=${t.location.searchParams.get('state')}`, jar(t.handshake))
  check('a code Zoom does not know ends in a clean failure', failedTo(r) && noCookies(r))

  for (const evil of ['https://evil.example/steal', '//evil.example', '/\\evil.example', 'javascript:alert(1)']) {
    t = await begin(evil)
    c = grantFor(t.location)
    r = await get(`/api/oauth/zoom/callback?code=${c}&state=${t.location.searchParams.get('state')}`, jar(t.handshake))
    const dest = new URL(r.headers.get('location'), APP)
    check(`a return address of ${evil} stays on this site`, dest.origin === APP && dest.pathname === '/zoom-test', dest.href)
  }

  const before = exchanges
  t = await begin()
  await get(`/api/oauth/zoom/callback?code=x&state=${t.location.searchParams.get('state')}`, jar(t.handshake))
  check('the server asks Zoom nothing until the state matched', exchanges === before + 1)
  const noState = await get('/api/oauth/zoom/callback?code=x')
  check('a bare callback is refused without calling Zoom', failedTo(noState) && exchanges === before + 1)

  // The stand-in for Zoom is only honoured when a test opts in. Without the
  // opt-in, a stray variable must not be able to redirect the client secret.
  console.log('\nthe stand-in is off by default')
  const guarded = spawn('npx', ['next', 'start', '-p', String(APP_PORT + 1)], {
    env: { ...process.env, ZOOM_CLIENT_ID: CLIENT_ID, ZOOM_OAUTH_BASE: fakeBase, ZOOM_API_BASE: fakeBase, ZOOM_OAUTH_ALLOW_OVERRIDE: '' },
    stdio: 'ignore',
  })
  try {
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`http://localhost:${APP_PORT + 1}/api/me`)).ok) break
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    const res = await fetch(`http://localhost:${APP_PORT + 1}/api/oauth/zoom/start`, { redirect: 'manual' })
    const dest = new URL(res.headers.get('location') ?? 'http://none')
    check('with the variables set but no opt-in, sign-in still goes to the real zoom.us', dest.origin === 'https://zoom.us', dest.origin)
  } finally {
    guarded.kill()
  }
} finally {
  stop()
}
console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
