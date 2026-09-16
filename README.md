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
through service-role SQL functions; clients read with the anon key and
receive updates over Supabase Realtime (1s polling inside the Zoom client,
whose webview has no WebSocket).

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
from that exact meeting; the first such user to start a round becomes the
host and only they can start or stop afterwards, enforced in SQL. Zoom's
context carries no role, so this is a first-claim model; the Phase 3
upgrade is the `meeting.started` webhook, which carries the real host id.
Sandbox sessions (demo and join-link keys) are ownerless so anyone can run
the clock, which is what the concurrency tests rely on.

Testing. `BASE_URL=http://127.0.0.1:5173 npm run test:race` runs the
concurrency suite (bid storms, identical amounts, expiry boundary,
colliding extensions, host stop vs in-flight bids, validation). Add
`SESSION_SECRET=<server value>` to also run the host-rule and forged-cookie
scenarios with minted cookies.

Environment: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, and `ZOOM_CLIENT_SECRET`
(the Development app's secret for the tunnel, the Production app's for
Vercel Production).

Known gaps, tracked deliberately for later phases: host is first-claim
rather than webhook-verified, no rate limiting, sessions never expire, and
the leaderboard with private amounts is not built yet.

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
- OAuth and server-side role verification are intentionally not part of this frontend-only milestone.
- Host-only auction actions must be verified by the backend when they are implemented.
