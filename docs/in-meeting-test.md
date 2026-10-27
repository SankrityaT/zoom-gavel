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

- Marketplace Home URL (Development) is `https://gavel-app.sankrityat.com/zoom-test`
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
8b. **How winners pay.** Before the lot ends, type "Venmo @test" under How winners pay and Save. When the lot sells the winner gets a green card with that text and a Copy button; the others see nothing. The card also has Keep this link: copy it and open it in a browser outside Zoom; it should show the lot and the amount. The host's So far list has a circle beside the lot: tick it and the page says paid (the card follows within 30 seconds). If Copy does nothing inside Zoom, the text can still be selected by hand; note it.
8c. **Lot photo.** Before starting a lot, tap Add a photo and pick a picture (inside Zoom the file picker may behave differently from a browser: note exactly what happens, including whether Zoom opens its own picker or nothing happens). The host panel shows a thumbnail; start the lot and it appears on every bidder's lot card; the winner's private page shows it. If the picker does not open inside Zoom, photos still work from a browser tab on the join link.
9. **Next lot.** Host clicks Start (second item): it opens on every screen with
   one tap, and nobody's old max carries over.
10. **Results.** The host's receipt lists both lots and the total. Click
    Download CSV and check the file saves and opens. This has never been tried
    inside the Zoom client. If the download is blocked, try Copy as text next to it (and, if copying is blocked too, the text appears in a box to select by hand); note exactly what Zoom shows.
11. **Mute.** A bidder taps the speaker icon: no further sounds.
12. **Leave the panel open 5+ minutes** once. Streams recycle every 270 seconds;
    bids must keep landing with no gap.
13. **Co-host.** In Zoom, make Bidder A a co-host (Participants, More, Make co-host).
    - A's panel changes to "You're co-hosting" and shows the host controls (it may take a few seconds).
    - A can start a lot, use the queue, end a round and download the CSV. The host's panel still says "You're hosting" and can still end a round.
    - A's panel shows no bid buttons while A is a co-host. Hosts and co-hosts watch the bids and do not place them.
    - Take the co-host role away: A's controls disappear. If A got no controls at all, note it: it means Zoom's `participant_user_id` did not match the ID Gavel sees for A, which needs a one-line fix.
14. **Browser sign-in.** On Bidder B's browser (join link, not in Zoom), click Sign in with Zoom at the top, allow, and land back signed in as your Zoom name.
    - B bids; the host sees B's name. B reloads and is still signed in.
    - In the same meeting, Bidder A (in Zoom, same Zoom account as B) shows as the same bidder, not a second one.
15. **Remove the app** (only if you are done testing): Apps, My Apps, Remove,
    then add it again from the Marketplace Local Test page.

## If something breaks

Screenshot the panel and note:

| Step | Device / client | Expected | Saw | Time |
| ---- | --------------- | -------- | --- | ---- |
|      |                 |          |     |      |
