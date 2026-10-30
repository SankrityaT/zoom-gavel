import type { Metadata } from 'next'
import Link from 'next/link'
import Doc from '@/legal/Doc'
import { APP_NAME, DEVELOPER, SUPPORT_EMAIL } from '@/legal/contact'

export const metadata: Metadata = {
  title: 'Terms of use',
  description: 'The rules for using Gavel.',
}

export default function Terms() {
  return (
    <Doc
      title="Terms of use"
      lead={`The short version: use ${APP_NAME} to run honest auctions with people who agreed to take part, and settle payment yourselves.`}
    >
      <h2>What this is</h2>
      <p>
        {APP_NAME} is a Zoom app, built by {DEVELOPER}, that lets a host run live auctions in a Zoom meeting and lets participants bid.
        By opening or using it you agree to these terms. If you do not agree, do not use it.
      </p>

      <h2>The app does not take or move money</h2>
      <p>
        {APP_NAME} records bids and results. It does not collect payment, hold funds, ship anything or guarantee that a winner pays or
        that a host delivers. A bid is a promise between the bidder and the host. Settling up, and any dispute over it, is between
        them.
      </p>

      <h2>Hosts</h2>
      <ul>
        <li>The payment line you write is yours. Make it accurate and make sure it is really yours: winners will send money to it. Do not put in anything that is not a way to pay you, and never link to something harmful.</li>
        <li>You are responsible for what you sell and for following the laws and rules that apply to the sale, including any that apply to auctions or fundraising where you are.</li>
        <li>Describe lots honestly. Do not list anything unlawful, stolen or harmful.</li>
        <li>Only add a photo you have the right to share, and only of the lot. No photos of people who have not agreed, and nothing unlawful or harmful.</li>
        <li>You decide the rules of each lot (starting bid, reserve, Buy Now, length). Once a round has started, the app follows them.</li>
      </ul>

      <h2>Bidders</h2>
      <ul>
        <li>Gavel shows you the host’s payment line but cannot check it. Make sure it is the person you expect before you send money, and be careful with unexpected links.</li>
        <li>Bid only if you mean to pay. A winning bid is a commitment to the host.</li>
        <li>A max bid tells the app to bid for you, up to the amount you set, in steps. It may place bids for you until the round ends or your max is passed.</li>
        <li>Do not use more than one name to push a price up, and do not use scripts or tools to place bids faster than a person could.</li>
      </ul>

      <h2>Everyone</h2>
      <ul>
        <li>Do not try to break, overload or get around the app, or to reach data that is not yours.</li>
        <li>Do not use the app to harass anyone or to break the law.</li>
        <li>We may stop a session or block a source that does any of this.</li>
      </ul>

      <h2>Reporting a problem</h2>
      <p>
        Item names, photos, payment lines and the names people bid under come from hosts and bidders, not from us. If something in an auction is
        offensive, misleading or unsafe, write to <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> or use the link at the foot of
        the panel. We read reports on business days, usually answer within 2 business days, and remove content, end a session or block a
        source when it breaks these terms. Hosts decide who may bid in their own auction.
      </p>

      <h2>Your content</h2>
      <p>
        Item names, bids and the rest of what you put into the app stay yours. You let us store and show it to the people in your
        auction so the app can work. How we handle personal information is set out in the{' '}
        <Link href="/privacy">privacy policy</Link>.
      </p>

      <h2>No warranty</h2>
      <p>
        {APP_NAME} is a student project, offered as it is. We work to keep it running and correct, but we do not promise it will be
        available at any given time, free of errors, or fit for any particular purpose. Do not rely on it for an auction where a
        failure would cost you more than you can accept.
      </p>

      <h2>Limit of liability</h2>
      <p>
        To the extent the law allows, we are not liable for lost profits, lost sales, or indirect or consequential losses from using
        the app, or for anything that happens between a host and a bidder. Nothing here limits a liability that the law does not
        allow to be limited.
      </p>

      <h2>Ending your use</h2>
      <p>
        You can stop at any time by removing the app from Zoom, which also erases you as described in the privacy policy. We may
        change or end the app, and we will update this page when the terms change.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>
    </Doc>
  )
}
