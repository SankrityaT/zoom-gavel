# In-meeting test runbook

Goal: one full auction, start to finish, in a real Zoom meeting with at
least two other people, with no manual intervention. Record both screens.

## Before the meeting

- Marketplace Home URL (Development) is `https://zoomgavel.vercel.app/zoom-test`.
- Event subscription for `meeting.started` points at
  `https://zoomgavel.vercel.app/api/zoom/webhook` and its Secret Token is in
  Vercel as `ZOOM_WEBHOOK_SECRET_TOKEN`. Without it, host falls back to
  first claim; the test still runs, but step 3 checks the older rule.
- The second desktop tester has run
  `defaults write ZoomChat enableGuestModeTesting true` and restarted Zoom.
- Start the meeting AFTER the webhook is configured: the event only fires at
  meeting start.

## Steps and what you should see

1. **Open Gavel in the meeting** (host, desktop).
   - Header: `Meeting session · live stream`. If it says `1s polling`, the
     stream failed and fell back; screenshot the diagnostics block.
   - Badge: `Verified via Zoom`.
   - Diagnostics, TRANSPORT PROBE: note the three values (WebSocket,
     EventSource, Supabase wss). This settles the webview question for good.
2. **Second participant joins** via Collaborate (desktop with the guest flag)
   or opens the join link on a phone.
   - Same session, same price on both screens.
3. **Host rule.**
   - Host controls read `You are the host, verified by Zoom`.
   - On the other participant's screen: `Only the meeting host can run rounds`,
     and any start or stop attempt is refused.
4. **Start a round**: item, opening bid, reserve, 60 seconds.
5. **Bid back and forth.** Each bid lands on the other screen in well under a
   second. Names carry `#xxxx` suffixes; join-link bidders show `unverified`.
6. **Anti-snipe.** Bid with under 10 seconds left: `Late bid, clock extended
   +15s` on every screen, ring refills.
7. **Close.** Let it expire or stop it: `Sold` with the winner everywhere, or
   `Not sold: reserve not met`.
8. **Leave the panel open 5+ minutes** once. Streams recycle every 270s; the
   header must stay on `live stream` and bids must keep landing.

## If something breaks

Screenshot the panel header, the badge, and the diagnostics block, and note:

| Step | Device / client | Expected | Saw | Time |
| ---- | --------------- | -------- | --- | ---- |
|      |                 |          |     |      |
