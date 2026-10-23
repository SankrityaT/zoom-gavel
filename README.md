# Zoom Gavel

Live auctions inside a Zoom meeting. The host opens Gavel from the Zoom Apps
panel, puts an item up, and everyone in the meeting bids in real time from a
side panel, without leaving the call. People outside the host's Zoom account
join from a browser link and bid the same way.

Built by Sankritya Thakur for the ASU Next Lab x Zoom fellowship
(Aug 27 to Dec 1, 2026).

- Live site: https://gavel-app.sankrityat.com
- The in-meeting panel: https://gavel-app.sankrityat.com/zoom-test
- Stack: Next.js 16, React 19, Zoom Apps SDK, Supabase Postgres + Realtime, Vercel

## What it does today

For the host:

- **Start a lot the way you would say it.** "Sell a signed poster starting at
  $100, reserve None, Buy Now $900", pick a round length, start.
- **Queue multiple items.** Line items up ahead of time and start the next one
  with a single tap.
- **Run the clock.** A server-side countdown that extends when a bid lands in
  the closing seconds, so nobody wins by sniping.
- **Results and export.** Every finished round is saved. The host sees a
  running receipt and can download a CSV of winners and prices to collect
  payment.
- **Tell winners how to pay.** The host types one line (a Venmo or Zelle handle, say) and only the people who win a lot see it, with a Copy button. Gavel never takes the money.
- **Bring people in.** One button invites the whole meeting; a copyable link
  lets anyone bid from a browser.

For bidders:

- **One-tap bidding** with a quick bid button, plus and minus steps, or a
  typed amount.
- **Max bid.** Set the most you would pay and Gavel bids for you in $25 steps,
  only as far as it takes to stay ahead.
- **Buy Now.** If the host set a Buy Now price, the first person to take it
  wins instantly.
- **Live leaderboard with private bids.** Everyone sees the ranking and the
  current price; each bidder's own amount is visible only to them and the host.
- **Alerts and sound cues.** A banner and a sound when you are outbid, when a
  lot opens, when the clock runs low, and when the item sells. Mute button in
  the header.

Under the hood:

- **Real time.** Bid to screen in about 160 to 370 ms, measured on production.
- **Race-safe.** Bids are accepted atomically in Postgres; two people can never
  both win.
- **Verified identity.** Zoom tells the server who each person is and who the
  meeting host is; only the host can run rounds in their meeting.
- **No shill bidding.** The host and co-hosts run the auction and do not bid in it. The server refuses their bids and max bids in real meetings (`host_cannot_bid`), and their panel shows no bid controls. Practice rooms stay open to everyone.
- **Co-hosts and browser sign-in.** Co-hosts Zoom names run the auction like the host. People bidding from a browser can sign in with Zoom to be verified bidders, or bid as guests that nobody can impersonate.
- **Tested.** A 185-assertion concurrency and security suite runs against the
  live site (bid storms, simultaneous Buy Now, forged identity, privacy of bid
  amounts, max-bid contests, the queue, erasing a person who removes the app),
  and a stress test drives hundreds of simulated bidders and live streams and
  checks the ledger in SQL afterwards.
- **Erases on request.** Remove the app from Zoom and Zoom's notice makes the
  app delete that person's max bids and replace their name on bids and sales.

## Screenshots

| Host: items queued | Bidder: setting a max | Bidder: max bidding for them |
|---|---|---|
| ![Host queue](docs/screenshots/host-queue.png) | ![Set a max bid](docs/screenshots/bidder-set-max.png) | ![Max bid active](docs/screenshots/bidder-max-active.png) |

| Host: sold, next item ready | Bidder: round over | Bidder: waiting for the first lot |
|---|---|---|
| ![Sold and next up](docs/screenshots/host-sold-next-up.png) | ![Round over](docs/screenshots/bidder-round-over.png) | ![Waiting](docs/screenshots/bidder-waiting.png) |

## Progress so far

- **Foundations.** Zoom App running inside a meeting, meeting identity, shared
  session per meeting, marketing site.
- **Real time in Zoom.** Live updates inside the Zoom client over a
  server-sent event stream, with automatic fallbacks.
- **Backend hardening.** Atomic bids, anti-snipe clock, verified host from the
  Zoom webhook, rate limits, session expiry, the race test suite.
- **Panel redesign.** Price-tag lot card, receipt-style results, rolling
  numbers, and a leaderboard whose rows move as the order changes.
- **Week of Sep 28.** Leaderboard with private bids, Buy Now price, auction
  results with CSV export.
- **Week of Oct 5.** Queue multiple items, max bid, outbid alerts and sound
  cues.

## Status and what is next

- The app is a development app on the Zoom Marketplace. It opens inside
  meetings hosted by the developer account; everyone else bids from the
  browser link. Publishing to the Marketplace is what lets anyone add it.
- Tested end to end in a real Zoom meeting once (Oct 2). The Oct 5 week's
  features are verified by automated tests and browser runs on the live site,
  and still need a pass inside a real meeting, sounds especially.
- Ready for Marketplace review, pending a few things only the owner can do
  (a domain they own, the support address, the deauthorization URL, production
  credentials): see `docs/marketplace-submission.md`, which holds every field
  Zoom asks for, the reviewer's test plan and the technical design. The public
  pages Zoom requires are built: `/privacy`, `/terms`, `/support`, `/guide`.
- Not built yet: checkout inside the app (the host's payment line tells winners
  where to send money; winners pay outside it) and Marketplace submission itself. Co-hosts and the browser Zoom sign-in are
  built and tested against signed notices and a fake Zoom, and still need a
  pass in a real meeting.

## Local setup

Requirements: Node.js 24 or newer, npm 11 or newer.

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173/zoom-test`. In a normal browser the panel runs as
a sandbox session where anyone can host, which is the easiest way to try it.
Add `?session=<any-name>` to share one session between several browser
windows.

## Test inside Zoom

See `docs/in-meeting-test.md` for the runbook (written before the panel
redesign, so some on-screen labels it quotes have changed). The Marketplace app is a
General App with the Zoom App surface:

- Home URL: `https://gavel-app.sankrityat.com/zoom-test`
- Scopes: `zoomapp:inmeeting`, `meeting:read:meeting`
- In-client features: Collaborate Mode, Guest Mode
- Event subscription: `meeting.started` to `/api/zoom/webhook`
- Zoom App SDK APIs: `getRunningContext`, `getUserContext`, `getMeetingUUID`,
  `getAppContext`, `startCollaborate`, `onCollaborateChange`,
  `onRunningContextChange`

Add it to your Zoom account with the Marketplace **Local Test** flow, start a
meeting on that account, and open Gavel from Apps. For local development
inside Zoom, point the Home URL at a tunnel to port 5173 instead (Zoom does
not accept `localhost`).

## The panel

`/zoom-test` is the in-meeting panel: the lot as a price tag, a leaderboard,
one bid button with a max-bid control, alerts with sound, and for the host a
setup sentence, the queue of lots, and a receipt of finished lots. The SDK diagnostics that used to fill the page are behind
`/zoom-test?debug=1`.

## Live auction architecture

State lives in Supabase Postgres: one `auction_sessions` row per session
plus an `auction_bids` ledger (see `supabase/migrations/`). All writes go
through service-role SQL functions; clients read through the API.

Push transport, as a ladder. Browsers subscribe to Supabase Realtime
directly. Inside the Zoom client (whose webview WebSocket support and
domain allow list are not ours to control) the panel uses Server-Sent
Events from our own origin: `GET /api/session/[key]/stream` holds one
Realtime channel per session per server instance, forwards sanitized
`session` / `bid` deltas after a viewer-specific `state` snapshot, and ends
each stream at 270s so EventSource reconnects well inside the 300s
function limit. Any failure drops a rung (realtime to SSE to 1s polling).
The diagnostics view (`?debug=1`) names the transport in use (`live`,
`live stream`, or `1s polling`) and has a transport probe that
reports whether WebSocket, EventSource, and a raw Supabase wss handshake
work in the current client. Functions are pinned to `pdx1` in
`vercel.json`, next to the Supabase project in us-west-2: every bid is
several sequential database calls, and running them cross-country tripled
bid latency. Measured on production, bid to screen on the SSE path is
160 to 370 ms.

Rounds. A session is `idle` until the host starts a round, which sets the
item, opening bid, optional reserve, and a server-side `ends_at`. Bids are
accepted atomically under a row lock: the first bid may equal the opening
price, later bids must beat the leader, and a bid landing inside the
closing window pushes `ends_at` out (anti-snipe, never backwards). Expired
rounds close lazily on the next read or bid, so realtime subscribers see
the terminal row. Ceiling is $1,000,000 in the API and in SQL.

Buy Now. A round may carry an optional Buy Now price (above the opening
bid, never below the reserve). A bid at or above it is accepted at exactly
that price and closes the round inside the same locked transaction as any
other bid, so simultaneous buyers cannot both win: the rest find the round
closed.

Leaderboard with private bids. Clients never receive the bid ledger. They
get one leaderboard entry per bidder, ranked, with a bid count. An amount
is included only for the viewer's own entry (verified identity), for every
entry when the viewer is the host, and for the leader, whose amount is the
public current price. Pushes carry ranks only; the panel fills in the
viewer's own amount, which an unverified bidder's browser remembers for
itself because the server cannot tell anonymous viewers apart. The limit
of this is inherent to an open ascending auction: someone watching live
sees each new current price and who set it.

Max bids. A bidder may set a ceiling for the round (`POST
/api/session/[key]/max`). After every bid or ceiling change the server
resolves the contest inside the same transaction, the way a live auction
would: the highest ceiling leads at one $25 step above the runner-up's
ceiling, never above its own, and the price never stays below the reserve
while the leader's ceiling reaches it (a lone $600 ceiling on a $500 reserve
sells at $500; without that step the lot closed unsold at the opening price),
and a tie between two ceilings stays with
whoever led. A plain hand bid that lands exactly on someone's hidden ceiling
loses to it: the ceiling, committed first, takes the lead at that price (the
one place two ledger rows carry the same amount, the second always automatic;
the leaderboard breaks equal amounts by who bid last). Automatic bids are
marked as such in the ledger. A ceiling is private: a verified
bidder gets their own back from the server, an unverified bidder's browser
remembers it, and nobody else ever sees one.

Catching missed pushes. Supabase's realtime service can drop a broadcast after
a long quiet spell (seen on production: a bid made four seconds after the first
stream opened never arrived). So each live room also reads its session every 3
seconds (10 when idle) with the service role and emits whatever the broadcasts
missed, one read per room however many people watch. The same read closes a
round whose clock ran out. A stream is refused for a session nobody created.

Breakout rooms. Inside one, Zoom's app context carries the room's own UUID in
`mid` and the main meeting's in `pid`, and `getMeetingUUID` returns the same
pair (`meetingUUID`, `parentUUID`). The webhook names only the main meeting,
so both the panel and the server key the auction on the main meeting.
Otherwise a breakout room became its own session with no verified host.

Removal. Zoom's `app_deauthorized` notice (same signed webhook) calls
`purge_zoom_user` with the keyed hash of the Zoom id: max bids are deleted,
names on bids and on won lots become "Removed bidder", a host claim is
dropped. The record of each sale stays, naming nobody.

How winners pay. A host-typed line of plain text (300 characters, control
characters flattened) in `auction_payment`, set through `POST
/api/session/[key]/payment` under the same host rule as the queue (a co-host
acts with the host's key). It is on no public row and in no broadcast. A winner
asks `action: 'mine'` with their identity (the verified cookie, or guest name
plus secret) and gets back the lots they won in that session and the line, or
nothing at all if they have won nothing, so the name alone never reveals it.
Rendered as text, never as a link, because the panel runs inside Zoom where an
arbitrary link would need allow-listing. Removing a host erases their line.

Host analytics. The plan's "what did the night do" numbers, for the host (or a
co-host) only, at `GET /api/session/[key]/analytics`: total raised, lots sold,
how many different people bid, who bid on more than one lot, bids placed by max
bids, the uplift over starting bids, and, for placing a bid inside a lot, the
bids and the last bids of people who did not win by fifth of the lot's running
time. The only new fact kept is when each lot started (`auction_round_starts`,
filled by a trigger on the session's round number, so no start function
changed). A lot that missed its reserve has no winner, even though the round
row records its top bidder. Counts only: no names and no per-person amounts.
The panel shows it as "The night in numbers" under the receipt.

Co-hosts. Zoom's app context carries no role, so the server cannot learn that
someone is a co-host from their own session. Zoom's signed
`meeting.participant_role_changed` notice (same webhook, same signature check)
says so: it records the person's keyed hash in `auction_cohosts` while the
role holds. A co-host sees and does what the host does, but SQL only knows one
host and starting a round stamps the starter as host, so the API substitutes
the host's own key when a verified co-host acts (`hostKeyFor`). The host's
claim is never overwritten, and if the host changed in between, the old key no
longer matches and SQL refuses.

The same read keeps hosts out of the bidding: before a bid or max bid is
accepted in a meeting session, `isHostBidding` checks whether the verified
viewer is the host or a named co-host and refuses with `host_cannot_bid`. Once
Zoom demotes a co-host, they can bid like anyone else.

Browser identity. A person outside the Zoom client is one of two things. A
guest: the name they type plus a private random secret in their browser, hashed
together, so the key cannot be reproduced from a name seen on the leaderboard
and nobody can bid or change a max bid as them. Or a Zoom sign-in: OAuth
authorization code with PKCE (`/api/oauth/zoom/start` and `/callback`), a
10-minute signed state cookie to bind the flow to the browser that began it,
`user:read:user` to read the person's Zoom ID and name once, then the token is
dropped. The result is the same `gavel_ctx` identity cookie an in-meeting
bidder gets, with the same bidder key, and no meeting, so they are a verified
bidder who cannot host. Returns only to a path on this site. Set
`ZOOM_CLIENT_ID` to turn it on; the base URLs are overridable so a fake Zoom can
stand in (`scripts/oauth-test.mjs`).

Lot queue. The host lines up lots in advance (`/api/session/[key]/queue`,
up to 30) and starts the next with one call that pops it and opens the
round atomically. Only the host can read or change the queue; everyone else
sees just how many lots are waiting and the name of the next one.

Alerts and sound. The panel raises a banner and a sound when the viewer is
outbid, a lot opens, the clock enters its last stretch (with a tick for each
of the final five seconds), and the hammer falls. Sounds are synthesized
with Web Audio, so there is nothing to download and nothing for the Zoom
client's allow list to block. The mute choice is remembered per browser.

Results. A trigger writes one `auction_rounds` row whenever a round stops
being open, whichever path closed it (expiry, host stop, Buy Now, or the
next round starting over an expired one). `GET /api/session/[key]/results`
returns them as JSON, or as a CSV with `?format=csv` for collecting payment
outside the app. Cells that would run as spreadsheet formulas are
neutralized. On meeting sessions only the host may read results.

Identity. Zoom sends `x-zoom-app-context` on the Home URL request;
`src/proxy.ts` decrypts it (AES-256-GCM, strict tag length) and issues a
signed `gavel_ctx` cookie. That header proved unreliable in a real meeting
(the panel loaded several times with no identity), so the panel also asks
the Zoom client for the same signed token with `zoomSdk.getAppContext()`
on every open and every 30 minutes, and trades it at `POST /api/identity`
for the same cookie. The cookie is `SameSite=None; Partitioned`, needed
because the Zoom web client embeds the app cross-site. API routes trust
only that cookie. Verified bidders are stored as HMAC keys, never raw Zoom ids, since
the tables are publicly readable. Join-link and browser users bid as
`unverified`.

Host authority. Meeting sessions (`mtg-` keys) require a verified identity
from that exact meeting. Zoom's app context carries no role, so the real
host comes from the `meeting.started` webhook (`POST /api/zoom/webhook`,
signature and timestamp checked): it stores HMAC(host_id) as the session's
verified host, and from then on only that identity can start or stop
rounds, enforced in SQL. When no webhook has arrived, the first verified
user to start a round claims host. Either kind of claim lapses after two
idle hours, since the webhook names the meeting owner, who is not always
the person running it (alternative hosts).
Sandbox sessions (demo and join-link keys) are ownerless so anyone can run
the clock, which is what the concurrency tests rely on.

Security model, verified by review and black-box testing. The public anon
key cannot read or list any table (reads go only through the API, which
requires a session key) and cannot call any SQL function. Realtime uses
private per-session broadcast topics fed by triggers, so you can receive
a session's updates only if you already know its key. POST routes reject
cross-origin browser requests and non-JSON bodies (the identity cookie is
SameSite=None because the Zoom web client embeds the app). Every displayed
name carries a server-derived `#xxxx` key suffix, since names are
client-chosen even for verified bidders. Session broadcasts replace
`host_key` with a presence marker, so a session key does not reveal which
bids are the host's.

Rate limits live in Postgres (fixed windows via `rate_limit_hit`) so they
hold across serverless instances, and are sized for a meeting behind one
address (a class, a company): bids 400 per 10s per IP and 10 per 5s per bidder
per session, identity 600 per minute, stream connects 120 per minute, round
start/stop 60 per minute, queue 90, payment 300, and Zoom's own webhook
traffic is never throttled (only requests that fail verification count).
Exceeding one returns 429 with `Retry-After`; the panel retries its identity
call through a limit. A limiter error fails open.

Expiry. A pg_cron job (`gavel-expire-sessions`, hourly) runs
`expire_sessions()`: demo and join-link sessions are deleted 24h after
their last activity, meeting sessions after 30 days, never while a round
is live. Stale rate-limit buckets go with them.

Stress testing. `scripts/stress-test.mjs` is the load companion to the race
suite. Point it at a local `next start` (it spreads load over invented client
addresses, which Vercel would overwrite): `BASE_URL=http://127.0.0.1:5180 node
scripts/stress-test.mjs`. It runs a fan-out (every open stream must get one
bid, quickly), a load phase (sessions x bidders placing bids and max bids while
rounds expire, then SQL checks that ledger amounts rise, prices and leaders
match, and each round is recorded once), 24 simultaneous max-bid contests
(highest ceiling must lead at runner up plus one step), queue churn, and a
lost-push check. Add `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` for the
SQL checks; sessions are named `stress-*` and removed afterwards. Measured on
production: 100 live streams all got a bid in about 400 ms, bids took 170 to
230 ms typically, and the database does a bid in about 1.4 ms, so the ceiling
seen from a laptop (about 58 bids a second) is the laptop's network, not the app.

Testing. `BASE_URL=http://127.0.0.1:5173 npm run test:race` runs the
concurrency suite (bid storms, identical amounts, expiry boundary,
colliding extensions, host stop vs in-flight bids, validation, rate
limits, SSE push latency, the Buy Now race, results and CSV export, max-bid
contests, the lot queue). Add
`SESSION_SECRET=<server value>` to also run the host-rule, forged-cookie,
and bid-privacy scenarios with minted cookies, and
`ZOOM_WEBHOOK_SECRET_TOKEN=<server value>` for the webhook-verified host
scenario. The suite itself counts against the per-IP round limit, so wait
a minute between back-to-back runs.

Environment: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, `ZOOM_VERIFICATION_TOKEN` (optional;
accepts Zoom's older Authorization-header signing for the app-removal notice,
which Zoom's docs leave unclear), `ZOOM_CLIENT_ID` (optional; turns
on "Sign in with Zoom"), `ZOOM_CLIENT_SECRET`
(the Development app's secret for the tunnel, the Production app's for
Vercel Production), and `ZOOM_WEBHOOK_SECRET_TOKEN` (the app's event
subscription Secret Token; the webhook answers 503 without it).

Known gaps, tracked deliberately for later phases: payment is collected
outside the app (no checkout; winners are shown the host's payment line), a co-host made so before the app was opened has
no controls until the role is given again (Zoom only sends a notice on a
change), signing in with Zoom proves who someone is but not that they are in
the meeting, and the app is not yet published on the Zoom Marketplace.

## Commands

```bash
npm run dev        # Next.js development server on port 5173
npm run lint       # ESLint
npm run typecheck  # TypeScript validation
npm run build      # Next.js production build
npm run start      # Run the production server on port 5173
```

## Security notes

- Never place a Zoom client secret in a `NEXT_PUBLIC_*` variable. Next.js exposes those values to the browser bundle.
- Host-only auction actions are verified server-side: identity from the decrypted Zoom app context, host role from the signed `meeting.started` webhook.
