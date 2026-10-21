import type { Metadata } from 'next'
import Link from 'next/link'
import Doc from '@/legal/Doc'
import { APP_NAME, RESPONSE_TIME, SUPPORT_EMAIL, SUPPORT_HOURS } from '@/legal/contact'

export const metadata: Metadata = {
  title: 'Support',
  description: 'How to get help with Gavel for Zoom Meetings.',
}

export default function Support() {
  return (
    <Doc title="Support" lead={`Stuck with ${APP_NAME}? Try the fixes below, then write to us.`}>
      <h2>Contact us</h2>
      <p>
        Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. We read support email {SUPPORT_HOURS}, and reply within{' '}
        {RESPONSE_TIME}.
      </p>
      <p>
        To help us fix it quickly, tell us: whether you were the host or a bidder, the time it happened (with your time zone), what
        you expected, and what you saw. A screenshot helps. Please do not send passwords or payment details.
      </p>

      <h2>Common problems</h2>

      <h3>I can’t find Gavel in the Zoom Apps panel</h3>
      <p>
        Open Apps in the meeting toolbar and search for “Gavel”. You need the Zoom desktop app (not the browser or phone app) and an
        account that has added Gavel. Some organisations block Zoom apps; if the Apps button is missing for everyone in the meeting,
        the meeting’s host or admin has turned them off.
      </p>

      <h3>It says I’m not the host, or the host controls are missing</h3>
      <p>
        Only the person Zoom reports as the meeting’s host can run the auction. Close Gavel and open it again from Apps so it can ask
        Zoom who you are. If the host is signed in on more than one device, use the one that started the meeting.
      </p>

      <h3>I’m a co-host but I have no host controls</h3>
      <p>
        Zoom tells Gavel about a co-host at the moment the role is given. If you were made co-host before you opened Gavel and it still
        shows no controls, ask the host to remove your co-host role and give it again (Participants, More, Make co-host), then close and
        reopen Gavel from Apps.
      </p>

      <h3>People joining from a link can bid, but I can’t see their amounts</h3>
      <p>
        That is by design. Each person’s bid amount is private to them and the host. Everyone else sees only the ranking and the
        current price.
      </p>

      <h3>The price isn’t updating</h3>
      <p>
        The panel falls back to checking every second if live updates are blocked, so it keeps working. Close and reopen Gavel from
        Apps. If it stays stuck, tell us the time and the meeting’s host.
      </p>

      <h3>I won a lot but don’t see how to pay</h3>
      <p>
        The card appears right after your lot sells, and only if the host has filled in How winners pay. If it says the host will tell
        you how to pay, ask the host directly. Gavel never takes the money, so there is no payment button.
      </p>

      <h3>I don’t hear sounds</h3>
      <p>
        Sounds start after your first tap or click in the panel. Check the speaker button at the top right of the panel isn’t muted,
        and that the Zoom client’s own volume is up.
      </p>

      <h3>I want my data removed</h3>
      <p>
        Remove Gavel from Zoom (Apps, My Apps, Remove). We are told straight away and erase your name and your max bids. For anything
        else, email us and say the display name you bid under.
      </p>

      <h2>More</h2>
      <ul>
        <li>
          <Link href="/guide">How to add, use and remove Gavel</Link>
        </li>
        <li>
          <Link href="/privacy">Privacy policy</Link>
        </li>
        <li>
          <Link href="/terms">Terms of use</Link>
        </li>
      </ul>
    </Doc>
  )
}
