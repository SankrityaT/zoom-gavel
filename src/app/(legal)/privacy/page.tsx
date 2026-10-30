import type { Metadata } from 'next'
import Doc from '@/legal/Doc'
import { APP_NAME, DEVELOPER, SUPPORT_EMAIL } from '@/legal/contact'

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: 'What Gavel collects, why, who sees it, and how long it is kept.',
}

export default function Privacy() {
  return (
    <Doc
      title="Privacy policy"
      lead={`${APP_NAME} runs live auctions inside a Zoom meeting. This page says what it collects, why, who can see it, how long it is kept, and how to have it removed.`}
    >
      <h2>Who we are</h2>
      <p>
        {APP_NAME} is built and run by {DEVELOPER}, an independent developer. It is not made or endorsed by Zoom. Write to{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> about anything on this page.
      </p>

      <h2>What we collect, and why</h2>
      <table className="doc-table">
        <thead>
          <tr>
            <th>What</th>
            <th>Why we need it</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>Your Zoom user ID</strong>, kept only as a keyed one-way hash. The ID itself is never written to our database.
            </td>
            <td>To tell bidders apart, and to know which person is the meeting host.</td>
          </tr>
          <tr>
            <td>
              <strong>Your display name</strong> as Zoom reports it, or the name you type if you join from a browser.
            </td>
            <td>To show who is bidding and who won.</td>
          </tr>
          <tr>
            <td>
              <strong>The meeting’s ID</strong>, encoded into the name of the auction session.
            </td>
            <td>So everyone in one meeting shares one auction, and only that meeting’s host can run it.</td>
          </tr>
          <tr>
            <td>
              <strong>Your bids and max bids</strong>, with the times they were placed.
            </td>
            <td>To run the auction: pick the winner, show the leaderboard, and bid for you up to the max you set.</td>
          </tr>
          <tr>
            <td>
              <strong>What the host enters</strong>: item names, starting bid, reserve, Buy Now price, round length, and the lots lined up.
            </td>
            <td>To run each lot and to build the results list.</td>
          </tr>
          <tr>
            <td>
              <strong>A photo of a lot</strong>, if the host adds one: the picture the host chooses, shrunk and re-saved in their own
              browser first, so location and camera details in the original are dropped. We check that it is an image and keep it
              small.
            </td>
            <td>So bidders and the winner can see what is being sold. Only the host and co-hosts can add one. Anyone shown the lot can see it.</td>
          </tr>
          <tr>
            <td>
              <strong>How winners should pay</strong>: one short line of text the host types, such as a Venmo or Zelle handle. It can
              contain whatever the host chooses to put in it.
            </td>
            <td>So the winner of a lot knows where to send payment. Only people who have won something in that auction can read it.</td>
          </tr>
          <tr>
            <td>
              <strong>Your private winner page</strong>: when you win a lot, a random address that only you hold, and a tick the host can
              set when you have paid. The page shows the lots you won, what you owe and the host’s payment line, and no one else’s.
            </td>
            <td>So you can pay after the meeting ends. The address is not guessable and the page is hidden from search engines.</td>
          </tr>
          <tr>
            <td>
              <strong>If you sign in with Zoom in a browser</strong>: your Zoom user ID (kept only as the same keyed hash) and your
              Zoom display name.
            </td>
            <td>
              So only you can bid as you, and so you are the same bidder in a browser as in the meeting. We ask Zoom for read access to
              your basic profile for this, use it once, and keep no access token.
            </td>
          </tr>
          <tr>
            <td>
              <strong>Who is a co-host</strong>, as Zoom reports it: the Zoom user ID (as a hash) of a person whose role in the meeting
              changed.
            </td>
            <td>So co-hosts can run the auction, as the host can. Zoom’s notice also names the person; we use only the ID and the new role.</td>
          </tr>
          <tr>
            <td>
              <strong>Your IP address</strong>, inside short-lived counters.
            </td>
            <td>To stop one source flooding the service with requests.</td>
          </tr>
        </tbody>
      </table>
      <p>
        When Zoom tells us a meeting has started, we receive the meeting’s ID and its host’s ID. When someone’s role changes (for
        example they become a co-host) we receive who and which role. We use these to decide who may run the auction. We do not read
        the participant list, chat, audio, video, recordings, files or any other meeting content, and we do not store your email
        address.
      </p>

      <h2>Money</h2>
      <p>
        The app never handles payment. It records who won and for how much, and shows the winner the payment line the host wrote, on their own private page as well as in the app. The host can tick lots off as paid; that tick is the host’s own note and Gavel cannot see or check any payment. The
        host and the winner settle up themselves, outside the app. We collect no card or bank details, and we cannot check that a
        payment line is genuine.
      </p>

      <h2>Who can see what</h2>
      <ul>
        <li>Everyone in an auction sees the lot, the current price, who is leading, and the ranking of bidders by name.</li>
        <li>An amount you bid is shown only to you and the host. Other bidders see your rank, not your number.</li>
        <li>The host’s payment line is shown only to people who have won a lot in that auction, and to the host and co-hosts.</li>
        <li>The ceiling of a max bid is shown only to you. Nobody else, including the host, can see it. The bids it places for you appear like any other bid.</li>
        <li>
          The host can see every bidder’s amount and can download a results file (CSV) with each lot, the winner’s name and the final
          price.
        </li>
      </ul>

      <h2>Cookies and browser storage</h2>
      <ul>
        <li>
          <code>gavel_ctx</code>: a signed cookie, kept for 6 hours, that proves who you are to our server after Zoom has told us. If
          you sign in with Zoom in a browser it also holds your Zoom name.
        </li>
        <li>
          <code>gavel_oauth</code>: a short-lived cookie (10 minutes) used only while you are signing in with Zoom, then deleted.
        </li>
        <li>
          In your browser’s storage: whether you muted sounds, a random ID for demo sessions, a private random guest secret that keeps
          your name as a guest yours, and your own last bid and max bid for the current auction, so you still see them after a reload.
        </li>
        <li>We use no advertising or analytics cookies and no third-party trackers.</li>
      </ul>

      <h2>Who else handles the data</h2>
      <ul>
        <li>
          <strong>Vercel</strong> hosts the site and keeps ordinary request logs, including IP addresses, under its own retention
          rules.
        </li>
        <li>
          <strong>Supabase</strong> stores the auction data in a database in the United States (Oregon).
        </li>
        <li>
          <strong>Zoom</strong> provides the platform the app runs in and tells us who you are inside a meeting.
        </li>
      </ul>
      <p>We do not sell your data and we do not share it for advertising.</p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Auctions started from a browser link or the demo page are deleted 24 hours after their last activity.</li>
        <li>Auctions in a Zoom meeting are deleted 30 days after their last activity, along with the host’s payment line, every winner page and every lot photo.</li>
        <li>The counters that hold IP addresses are deleted within 1 hour of expiring.</li>
        <li>
          When you remove the app from Zoom, Zoom notifies us and we erase you straight away: your max bids are deleted, and your name
          is replaced by “Removed bidder” on your bids and on any lot you won, your private winner pages are deleted, and a payment line and any lot photos you added as host are deleted. The record of the sale stays; your name does not.
        </li>
      </ul>

      <h2>Your rights</h2>
      <p>
        Whatever the law where you live says, you may ask us what we hold about you, ask for it to be corrected or deleted, or object to
        how it is used. Removing the app from Zoom (Apps, then My Apps, then Remove) erases you automatically as described above. To
        ask for anything else, write to <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> from any address; tell us your display
        name and roughly when you bid, since we cannot look you up by email. We answer within 30 days.
      </p>

      <h2>How we protect it</h2>
      <ul>
        <li>The database provider encrypts stored data at rest, and the companies that host it handle it only to provide that service, under their own security and privacy terms.</li>
        <li>Everything travels over HTTPS.</li>
        <li>Zoom IDs are stored only as keyed hashes. The database cannot be read directly by the public; every read goes through our server.</li>
        <li>Each auction’s live updates use a private channel that only someone who already holds that auction’s key can join.</li>
        <li>Requests are rate limited, and the host’s powers are checked on the server, not in the browser.</li>
      </ul>

      <h2>Children</h2>
      <p>The app is not meant for anyone under 16 and we do not knowingly collect their data.</p>

      <h2>Changes</h2>
      <p>If this policy changes in a way that matters, the date at the foot of the page changes with it.</p>
    </Doc>
  )
}
