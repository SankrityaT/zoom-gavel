# Zoom Gavel

Zoom Gavel is a Next.js Zoom App prototype for native, real-time auction bidding inside a Zoom meeting. The repository contains the marketing site, the in-meeting diagnostic panel at /zoom-test, and the live bid sync backend (Supabase Postgres + Realtime).

## Local setup

Requirements:

- Node.js 24 or newer
- npm 11 or newer

Install and start the app:

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. A normal browser intentionally shows the SDK as disconnected because `zoomSdk.config()` can only complete inside Zoom's embedded app browser.

## Test inside Zoom

Zoom Apps cannot use `localhost` as the Home URL. This project uses the named Cloudflare Tunnel at `https://gavel.sankrityat.com`, which forwards to local port `5173`. Start Next.js normally. The named tunnel runs as a user-level background service, but it can also be started manually if needed:

```bash
npm run dev
cloudflared tunnel run boop
```

`gavel.sankrityat.com` is permanently included in Next.js `allowedDevOrigins`.

Create a General App with the Zoom App surface, then configure:

- Home URL: `https://gavel.sankrityat.com/`
- Domain allow list: `gavel.sankrityat.com`
- Zoom scope: `zoomapp:inmeeting`
- In-client feature: Collaborate Mode
- Optional for later guest testing: Guest Mode

Under **Features > Zoom App SDK > Add APIs**, enable exactly the capabilities currently declared by the frontend:

- `getRunningContext`
- `getUserContext`
- `getMeetingUUID`
- `startCollaborate`
- `onCollaborateChange`
- `onRunningContextChange`

Use the Marketplace **Local Test** flow to add the app to your Zoom account. Open it inside a live meeting, then verify:

1. The status changes from `browser preview` to a Zoom running context.
2. SDK config reports connected.
3. Meeting identity becomes available.
4. The **Start Collaborate test** button becomes enabled.
5. Starting Collaborate Mode produces a Collaborate ID in the diagnostic panel.

The Collaborate ID identifies the shared session. It does not synchronize app state. Bid state will live in a backend keyed to that ID in the next phase.

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
The panel header names the transport in use (`live`, `live stream`, or
`1s polling`), and the diagnostics block has a transport probe that
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

Identity. Zoom sends `x-zoom-app-context` on the Home URL request;
`src/proxy.ts` decrypts it (AES-256-GCM, strict tag length) and issues a
signed `gavel_ctx` cookie (`SameSite=None; Partitioned`, needed because the
Zoom web client embeds the app cross-site). API routes trust only that
cookie. Verified bidders are stored as HMAC keys, never raw Zoom ids, since
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
hold across serverless instances: bids 120 per 10s per IP and 10 per 5s per
bidder per session, round start/stop 30 per minute per IP, init and stream
connects 120 per minute per IP. Exceeding one returns 429 with
`Retry-After`. A limiter error fails open.

Expiry. A pg_cron job (`gavel-expire-sessions`, hourly) runs
`expire_sessions()`: demo and join-link sessions are deleted 24h after
their last activity, meeting sessions after 30 days, never while a round
is live. Stale rate-limit buckets go with them.

Testing. `BASE_URL=http://127.0.0.1:5173 npm run test:race` runs the
concurrency suite (bid storms, identical amounts, expiry boundary,
colliding extensions, host stop vs in-flight bids, validation, rate
limits, SSE push latency). Add `SESSION_SECRET=<server value>` to also run
the host-rule and forged-cookie scenarios with minted cookies, and
`ZOOM_WEBHOOK_SECRET_TOKEN=<server value>` for the webhook-verified host
scenario. The suite itself counts against the per-IP round limit, so wait
a minute between back-to-back runs.

Environment: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, `ZOOM_CLIENT_SECRET`
(the Development app's secret for the tunnel, the Production app's for
Vercel Production), and `ZOOM_WEBHOOK_SECRET_TOKEN` (the app's event
subscription Secret Token; the webhook answers 503 without it).

Known gaps, tracked deliberately for later phases: co-hosts cannot run
rounds, and the leaderboard with private amounts is not built yet.

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
