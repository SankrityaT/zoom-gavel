import type { Metadata } from 'next'
import Link from 'next/link'
import Doc from '@/legal/Doc'
import { APP_NAME } from '@/legal/contact'

export const metadata: Metadata = {
  title: 'User guide',
  description: 'How to add, use and remove Gavel for Zoom Meetings.',
}

export default function Guide() {
  return (
    <Doc title="User guide" lead={`How to add ${APP_NAME}, run an auction, bid in one, and remove it.`}>
      <h2>Add it</h2>
      <ol>
        <li>Open the Zoom desktop app and join or start a meeting.</li>
        <li>In the meeting toolbar, click Apps. Search for “Gavel for Zoom Meetings” and click Add. Or open the Zoom Marketplace, find the app, and click Add.</li>
        <li>Zoom asks you to allow the app to run in your meetings. Accept.</li>
        <li>Gavel opens in a panel beside the meeting.</li>
      </ol>
      <p>
        What you need: the Zoom desktop app, and a meeting where apps are allowed. People who don’t have the app can still bid from a
        browser with a link from the host.
      </p>

      <h2>Run an auction (host)</h2>
      <p>You are the host if you started the meeting. Open Gavel from Apps; the panel says “You’re hosting”.</p>
      <ol>
        <li>
          Fill in the sentence: <em>Sell an item starting at $0, reserve None, Buy Now None.</em> Click a field and type. Reserve and Buy
          Now are optional. A Buy Now price lets the first person who takes it win at once.
        </li>
        <li>Pick how long the round runs: 30 seconds, 1 minute, 2 minutes or 5 minutes.</li>
        <li>Click Start bidding. Or click Add to queue to line the lot up for later, and add as many as you like.</li>
        <li>
          With lots queued, one click on Start (the next item) opens it. Bidding runs on a clock; a bid in the last seconds adds
          time, so nobody wins by sniping.
        </li>
        <li>When the clock ends, the lot shows Sold with the winner, or Not sold if the reserve wasn’t met. Start the next one.</li>
        <li>
          Under How winners pay, type where winners should send money, such as “Venmo @yourname”, and click Save. Only the people who
          win a lot see it, right after the lot sells. Gavel does not take the payment; you and the winner settle up yourselves.
        </li>
        <li>Click Copy link under Bring people in so anyone can join from a browser, or Invite all to prompt everyone in the meeting.</li>
        <li>Under So far you see every lot and the total raised. Download CSV saves the results for collecting payment.</li>
      </ol>

      <h2>Co-hosts</h2>
      <p>
        If you make someone a co-host in Zoom (Participants, More, Make co-host), Gavel is told, and they can run the auction exactly as
        you can: start and end lots, use the queue, see every bidder’s amount and download the results. Their panel says “You’re
        co-hosting”. If you take the role away, their controls go too. You stay the host throughout. Zoom only tells Gavel who a
        co-host is when they are signed in to Zoom, so a guest without an account cannot be recognised.
      </p>

      <h2>Bid (everyone else)</h2>
      <ol>
        <li>When the host starts a lot, the panel shows it with the price and a clock. You hear a chime if sounds are on.</li>
        <li>Click Bid to place the next bid. Use the plus and minus buttons for a higher or lower bid, or Enter an amount to type one.</li>
        <li>
          Click Set a max bid, enter the most you would pay, and Gavel bids for you in steps, only as far as it takes to stay ahead.
          You can change or remove it any time.
        </li>
        <li>A red banner and a sound tell you the moment you are outbid. The clock beeps when it runs low and ticks for the last five seconds.</li>
        <li>If there is a Buy Now price, Buy it now takes the lot at once; tap twice to confirm.</li>
        <li>If you win, a green card shows what you owe and the host’s payment line, with a Copy button. Send the payment yourself, outside Gavel.</li>
        <li>Your own bid amount is shown only to you and the host. Sounds are off by default inside Zoom; tap the speaker button at the top to turn them on, and again to mute them.</li>
      </ol>
      <h3>Bidding from a browser</h3>
      <p>
        Open the link the host shares. You can bid as a guest straight away. If you have a Zoom account, click Sign in with Zoom at the
        top: you will then be the same bidder as in the meeting, and nobody else can bid as you. Gavel asks Zoom only who you are and
        keeps nothing else.
      </p>
      <p>
        Gavel only records the sale. The host and the winner settle payment themselves, outside the app.
      </p>

      <h2>Remove it</h2>
      <ol>
        <li>In a Zoom meeting, click Apps, then My Apps.</li>
        <li>Find Gavel for Zoom Meetings and choose Remove. You can also remove it from the Zoom Marketplace under Manage, then Added Apps.</li>
      </ol>
      <p>
        Removing the app erases you: Zoom tells us, we delete your max bids, and your name on bids and on lots you won becomes
        “Removed bidder”. The record of each sale stays, with no name on it. More in the <Link href="/privacy">privacy policy</Link>.
      </p>

      <h2>Troubleshooting</h2>
      <p>
        Most problems are covered on the <Link href="/support">support page</Link>, including what to do if the app is missing from the
        Apps panel or the host controls don’t appear.
      </p>
    </Doc>
  )
}
