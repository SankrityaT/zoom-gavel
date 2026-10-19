# In-meeting test runbook

Goal: one full auction, start to finish, in a real Zoom meeting with at least
two other people, with nothing fixed by hand. This is the one thing the
automated tests cannot do: they run against the API and in browsers, never
inside the Zoom client. Record both screens if you can.

You need three people or devices:

- **Host**: the Zoom desktop app signed in as the developer account that owns
  the app (`sankritya.apps@gmail.com`), starting the meeting. Gavel only
  appears for that account until the app is published, and only in meetings
  that account hosts.
- **Bidder A**: another desktop participant, or a browser tab on the join link.
- **Bidder B**: a phone or second browser on the join link (Copy link in the
  host's panel).

## Before the meeting

- Marketplace Home URL (Development) is `https://zoomgavel.vercel.app/zoom-test`
  and the app shows under Apps, My Apps for the developer account.
- The `meeting.started` event subscription points at
  `/api/zoom/webhook` on the same site, and its Secret Token is in Vercel as
  `ZOOM_WEBHOOK_SECRET_TOKEN`. Start the meeting after this is set; the event
  only fires at meeting start.
- Sound: unmute the Zoom client's own volume, and tap once in the panel so the
  browser lets it play.

## Steps and what you should see

1. **Open Gavel in the meeting** (host, Apps, My Apps, Gavel).
   - Header reads "You're hosting", not "Unverified".
   - If the panel loads but stays on "Connecting", open `?debug=1` on the Home
     URL in a browser and use Test Supabase websocket; note all three values.
2. **Queue.** Add two lots with Add to queue (item, starting bid, a Buy Now on one).
   - Both list under Up next, with Remove links.
   - Bidders see "Up first: (item)" while waiting.
3. **Start.** Click Start (first item).
   - Every screen shows the lot, a clock, and a "Bidding is open" banner.
   - A chime plays for each bidder.
4. **Bid back and forth** from both bidders.
   - Each bid lands on the other screens in well under a second.
   - A bidder sees their own amount; others see only rank. The host sees all.
5. **Max bid.** Bidder A taps Set a max bid and enters an amount above the price.
   - The panel reads "Your max is $X. Gavel is bidding for you."
   - Bidder B bids against it: A is bid up automatically, and B is told
     "You were outbid straight away".
6. **Outbid alert.** B bids past A's max.
   - A gets a red "You've been outbid" banner and a two-note sound.
   - A's panel says "The bidding passed your max".
7. **Anti-snipe.** Bid with under 10 seconds left: the clock extends and says
   "Extended 15 sec" on every screen. It must not say this when a new lot opens.
8. **The clock.** Let it run out.
   - A double beep when the clock turns red, a tick for the last five seconds,
     then the gavel and a Sold stamp on every screen.
   - The winner sees "You won it" and a different sound; the others "Sold to (name)".
9. **Next lot.** Host clicks Start (second item): it opens on every screen with
   one tap, and nobody's old max carries over.
10. **Results.** The host's receipt lists both lots and the total. Click
    Download CSV and check the file saves and opens. This has never been tried
    inside the Zoom client; if the download is blocked, note exactly what Zoom shows.
11. **Mute.** A bidder taps the speaker icon: no further sounds.
12. **Leave the panel open 5+ minutes** once. Streams recycle every 270 seconds;
    bids must keep landing with no gap.
13. **Remove the app** (only if you are done testing): Apps, My Apps, Remove,
    then add it again from the Marketplace Local Test page.

## If something breaks

Screenshot the panel and note:

| Step | Device / client | Expected | Saw | Time |
| ---- | --------------- | -------- | --- | ---- |
|      |                 |          |     |      |
