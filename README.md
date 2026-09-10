# Zoom Gavel

Zoom Gavel is a Next.js Zoom App prototype for native, real-time auction bidding inside a Zoom meeting. The repository currently contains the Week 1 SDK diagnostic panel and the foundation for the marketing site. It does not sync bid state yet.

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

## Live bid sync architecture

Bid state lives in Supabase Postgres, one row per Zoom Collaborate UUID in
`auction_sessions` (see `supabase/migrations/`). The sync model:

- Writes go only through `POST /api/session/[uuid]` using the server-side
  service role key. Bids are accepted atomically by the `place_bid` SQL
  function: only a strictly higher bid on an open session wins, so
  concurrent bids cannot clobber each other. Rejected bids return 409.
- Reads and push: clients hold a Supabase Realtime websocket subscription
  (anon key, read-only via RLS) filtered to their session row. Every
  accepted bid is pushed to all participants instantly. No client polling.
- `GET /api/session/[uuid]` serves initial state on load.

Environment variables: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` (browser, read + realtime), and
`SUPABASE_SERVICE_ROLE_KEY` (server only, never exposed to the client).

The `/zoom-test` panel includes a Live Bid Sync section: inside a
Collaborate session it uses the Collaborate UUID; in a plain browser it
falls back to a shared `browser-test` session so sync can be verified in
two tabs without Zoom.

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
