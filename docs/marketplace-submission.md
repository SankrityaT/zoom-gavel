# Zoom Marketplace submission pack

Everything Zoom asks for when submitting Gavel for Zoom Meetings for review,
written once so it can be pasted into the Marketplace forms. Sources checked
against Zoom's published review docs on 2026-10-19:
[submit for review](https://developers.zoom.us/docs/distribute/app-submission/submit-apps-review/),
[common rejection issues](https://developers.zoom.us/docs/distribute/app-submission/common-rejection-issues/),
[security requirements](https://developers.zoom.us/docs/distribute/security-requirements/).

## Where it stands (2026-10-20)

Done in the Marketplace app, by Aside, nothing submitted:

- Scopes: `zoomapp:inmeeting`, `meeting:read:meeting`, `meeting:read:participant` (Zoom required it for the role-change event), `user:read:user` (browser sign-in).
- Events, Development and Production: Start Meeting, Participant role changed. Production endpoint `https://zoomgavel.vercel.app/api/zoom/webhook` validated.
- OAuth allow list includes `https://zoomgavel.vercel.app/api/oauth/zoom/callback`.
- Listing: short and long description, icon, three gallery images (in `docs/marketplace/`), category Event Management, industry Other.
- Technical Design: technology stack, architecture diagram, the SSDLC, SAST/DAST and penetration-test answers, the three security answers, and the evidence PDFs.
- The webhook Secret Token was rotated on 2026-10-20 (Zoom shares one token across Development and Production) and is in Vercel production as `ZOOM_WEBHOOK_SECRET_TOKEN`. `ZOOM_CLIENT_ID` (Development app) is set, which turned browser sign-in on. The variable accepts several comma separated tokens, in case the two apps ever get different ones.

Still open, in Zoom's wording, and why:

| Item | Needs | Who |
|------|-------|-----|
| Privacy Policy, Terms of Use, Support and Documentation URLs | A domain you own (Zoom validates ownership and discourages `vercel.app`). `gavel-app.sankrityat.com` is live (DNS moved to Squarespace nameservers on 2026-10-20, certificate issued, `SITE` and the metadata base switched). The Marketplace app still has to be pointed at it: Home URL, domain allow list, OAuth allow list, webhook endpoint, and the four links. | You |
| Privacy Policy acknowledgment is required | A checkbox only you can tick | You |
| EU & Discoverability (9 business, bank and ID items) | Either untick "Available in the EU" (no business details needed) or provide a trader's name, address, email, phone, bank name and last 4 digits, a trade register number, an ID document and the compliance declaration | You |
| Switch to the **Production** credentials | Production Client Secret into `ZOOM_CLIENT_SECRET` and its Client ID into `ZOOM_CLIENT_ID` in Vercel, then redeploy | You or Aside |
| A real in-meeting run of `docs/in-meeting-test.md`, including co-host and browser sign-in | The Zoom desktop app and two other people | You |
| The one sign-in test Aside could not do: sign in with Zoom in your own browser | Your Zoom password | You |

## Listing

- **App name:** Gavel for Zoom Meetings
- **Short description (150 max, this is 121):**
  Live auctions inside your Zoom meeting. Queue items, bid in real time, set a max bid, get alerts, and export the results.
- **Long description:**

  Gavel turns a Zoom meeting into a live auction house, without anyone leaving the call.

  The host fills in one sentence (what is for sale, the starting bid, an optional reserve and Buy Now price) and starts the clock. Everyone in the meeting bids from a panel beside the video. Bids land on every screen in well under a second, the clock extends when a bid arrives in the last seconds so nobody wins by sniping, and the hammer falls with a Sold stamp.

  For hosts: line up as many items as you like and start each with one tap. Watch every bidder's amount, and download the results as a CSV when the night is done. Invite people who are not on Zoom with a link; they bid from a browser.

  For bidders: set a max bid and Gavel bids for you, one step at a time and only as far as it takes to stay ahead. Get a banner and a sound the moment you are outbid, when the clock runs low, and when a lot sells. Your own amount is visible only to you and the host.

  Gavel records bids and winners. It does not take payment; the host and the winner settle up themselves.

- **Category:** Events / Fundraising (pick the closest available)
- **Gallery** (1200×780, in `docs/marketplace/`):
  `gallery-1-run-an-auction.png`, `gallery-2-max-bid-and-alerts.png`, `gallery-3-sold-and-results.png`
- **Demo video** (MP4, 40 MB limit): `.context/zoom-gavel-demo-v2.mp4` (47 seconds, 15.6 MB, recorded on the live app). Not committed to git.
- **App icon:** `src/app/icon.png` (the gavel badge; check it meets the size Zoom asks for).

## Links and support

| Field | Value (replace the host with your domain) |
|-------|-------|
| Home URL | `https://<domain>/zoom-test` |
| Privacy policy | `https://<domain>/privacy` |
| Terms of use | `https://<domain>/terms` |
| Support | `https://<domain>/support`, email `sankritya.apps@gmail.com` |
| Documentation (add, use, remove) | `https://<domain>/guide` |
| Event notification and deauthorization URL | `https://<domain>/api/zoom/webhook` |
| OAuth redirect URL (and allow list) | `https://<domain>/api/oauth/zoom/callback` |

## Scopes and APIs, with the reason for each

| Item | Why the app needs it |
|------|----------------------|
| `zoomapp:inmeeting` | To run inside a meeting at all. |
| `meeting:read:meeting` | To subscribe to Zoom's `meeting.started` notification, which names the meeting's host so only they can run the auction. The app does not call the Meetings API or read participants. (Confirm on the Scopes page that this is what the scope is attached to.) |
| `getRunningContext`, `getUserContext`, `getMeetingUUID` | Know it is in a meeting, which one, and the person's display name. |
| `getAppContext` | Fetch Zoom's signed app context so the server can prove who the person is. |
| `startCollaborate`, `onCollaborateChange` | Let the host open the app for everyone in the meeting (Invite all). |
| `onRunningContextChange` | Keep the panel correct when the app moves between the side panel and a shared view. |
| Event `app_deauthorized` | Erase a person's data when they remove the app. |
| Event `meeting.participant_role_changed` | Learn when someone becomes a co-host (or stops being one), so co-hosts can run the auction. Only the participant's Zoom user ID and the new role are used; the rest of the event is ignored. (Check on the Event Subscriptions page which scope Zoom attaches to it.) |
| OAuth scope `user:read:user` | "Sign in with Zoom" for people bidding from a browser: read the signed-in person's Zoom user ID and display name once, to make them the same verified bidder as in the meeting. No token is stored. Redirect URL: `https://<domain>/api/oauth/zoom/callback`. |

Domain allow list: the production domain only. Inside Zoom the panel talks to
its own origin (server-sent events and plain HTTPS), never to another host.

## Notes for the reviewer (paste into "Release notes for reviewer")

> Gavel needs no separate sign-in; Zoom authorizes it when you add it. You will
> need a meeting you host and a second participant (a second Zoom account, or a
> browser on the link from the host's panel).
>
> 1. Start a meeting as the host. Apps, search "Gavel for Zoom Meetings", Add, Authorize. The panel opens and says "You're hosting".
> 2. Type an item and a starting bid, click Add to queue twice (two lots), then Start the first. A second participant sees the lot, a clock and a "Bidding is open" banner.
> 3. The second participant bids. The price changes on both screens in under a second.
> 4. The second participant taps "Set a max bid", enters an amount above the price. The host (or a third participant) bids against it: Gavel bids for the max-bid holder automatically.
> 5. Bid past the max: the first participant gets an "outbid" banner and a sound.
> 6. Let the clock run out: Sold appears on every screen. The host clicks "Start (next item)" to open the second lot, and "Download CSV" for the results.
> 7. To test removal: Apps, My Apps, Remove. Zoom calls our deauthorization URL; the person's name on bids and sales becomes "Removed bidder" and their max bids are deleted.
>
> Scopes: `zoomapp:inmeeting` runs the app in a meeting; `meeting:read:meeting` is only used to receive `meeting.started` so the host can be verified. No meeting content, chat, audio, video or participant list is read.

## Technical design (for Zoom's compliance review)

**Stack.** Next.js 16 (React 19) on Vercel, functions pinned to Portland (`pdx1`).
Postgres on Supabase (AWS us-west-2) for all state. The panel is a web app
loaded in the Zoom webview.

**Real time.** One session per meeting. Bids are accepted atomically inside
Postgres under a row lock, so two buyers can never both win. Updates reach
Zoom clients over server-sent events from our own origin, which hold one
Supabase Realtime channel per session per server instance; browsers outside
Zoom subscribe to the same private channel directly. A server-side read every
3 seconds per live session catches anything a dropped broadcast missed. Bid to
screen is 160 to 400 ms measured on production.

**Identity.** Zoom sends `x-zoom-app-context` (and `zoomSdk.getAppContext()`
returns the same token): AES-256-GCM encrypted with a key derived from the
app's Client Secret. The server decrypts it, checks it, and issues a signed
`HttpOnly; Secure; SameSite=None; Partitioned` cookie valid 6 hours. Every
API route trusts only that cookie. The host comes from Zoom's signed
`meeting.started` webhook (HMAC-SHA256 with the Secret Token, 5 minute
timestamp window), stored as a hash.

**Data held.** See the privacy policy. Zoom user IDs are stored only as a
keyed hash (HMAC-SHA256, truncated), never in the clear. Screen names, the
meeting UUID (base64url in the session key), bids, max bids, lots and results
are stored. No email address, no payment data, no meeting content. IP
addresses live in rate-limit counters for at most an hour; Vercel's own request
logs hold them under Vercel's retention.

**Retention and deletion.** Browser and demo sessions are deleted 24 hours
after last activity, meeting sessions after 30 days, by an hourly database job.
On `app_deauthorized` the app deletes the person's max bids and replaces their
name on bids and won lots with "Removed bidder" (migration 010, tested).

**Controls.** TLS 1.2+ (Vercel), HSTS, a Content Security Policy that allows
only our own origin and the database, `frame-ancestors` limited to Zoom,
`X-Content-Type-Options: nosniff`, strict referrer policy. All writes go
through service-role SQL functions; the public database key can read no table
and call no function. Rate limits live in Postgres (per IP and per bidder).
Inputs are validated and bounded. Webhook bodies are size-limited and signed.

**Testing.**
- A 185-assertion concurrency and security suite (`npm run test:race`), run on every deploy against production: bid storms, expiry boundaries, forged identity, bid privacy, webhook verification, max-bid contests, the lot queue, app removal.
- `scripts/oauth-test.mjs`: the whole "Sign in with Zoom" flow against a fake Zoom, including forged state, replay, login CSRF, a tampered handshake cookie, open-redirect attempts and refused consent.
- `scripts/stress-test.mjs`: hundreds of simulated bidders, 100 to 250 simultaneous live streams, 24 concurrent max-bid contests, queue churn, and a SQL check of the ledger afterwards. Results: zero errors and a clean ledger at every size; the database itself does a bid in about 1.4 ms.
- Independent code reviews of the server code, the last one on 2026-10-19 (findings fixed or listed below).
- `npm audit --omit=dev`: 0 vulnerabilities (Next.js 16.4.2).

**Operations.** Secrets are Vercel environment variables, never in the repo.
Rotation: Client Secret and webhook Secret Token are rotated in the Marketplace
and Vercel together; the session signing secret rotates by redeploying (it
signs only 6 hour cookies).

## Known limits to be upfront about

- A browser bidder who has not signed in with Zoom is a **guest**: their identity is the name they type plus a private random secret kept in their browser. Nobody can bid or change a max bid as a guest they have only seen on the leaderboard, but a guest has no Zoom-backed identity, and clearing browser storage makes them a new guest. Signing in with Zoom gives a verified identity. Sign-in proves who someone is, not that they are in the meeting.
- A co-host is whoever Zoom's `meeting.participant_role_changed` notice names while the app is subscribed; someone made co-host before opening the app, with no later change, has no controls until the role is given again. Built and tested against signed notices, not yet in a real meeting.
- Two equal max bids: the one that was leading keeps it. A plain hand bid that lands exactly on a hidden max bid now loses to the max bid.
- Payment happens outside the app, by design.
- The panel has not been run through a full in-meeting test since the Oct 5 week's features (queue, max bid, alerts) were added.
