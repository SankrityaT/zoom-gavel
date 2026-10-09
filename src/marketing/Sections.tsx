import Image from 'next/image'
import logoMark from './assets/logo.png'
import { AppSidebar, HostDeskPanel } from './demo'

const REPO = 'https://github.com/SankrityaT/zoom-gavel'

export function Statement() {
  return (
    <section className="statement" aria-label="What Gavel is">
      <div className="wrap">
        <p className="statement-text" data-rise>
          Gavel is a Zoom App. It opens in the side panel of the meeting your bidders are already in, and puts the
          lot, the price, the clock and one bid button next to the host&apos;s camera.
        </p>
        <p className="statement-note" data-rise>
          Built as an ASU Next Lab and Zoom fellowship project. The code is public.
        </p>
      </div>
    </section>
  )
}

// What the server does with one bid, in order.
const BID_STEPS = ['Tap Bid', 'Bidder verified', 'One bid at a time', 'Clock extended if late', 'On every screen']

export function BidPath() {
  return (
    <section className="path" aria-labelledby="path-title">
      <div className="wrap">
        <div className="path-head">
          <h2 id="path-title" className="title title--light" data-lines>
            <span className="mask">
              <span className="line">What happens to a bid</span>
            </span>
          </h2>
          <p className="path-figure" data-rise>
            <span className="path-number">
              160<span>to</span>370<small>ms</small>
            </span>
            <span className="path-caption">
              from the tap to every other screen, measured on the production deployment inside a meeting.
            </span>
          </p>
        </div>

        <ol className="path-steps" data-rise="group">
          {BID_STEPS.map((step, index) => (
            <li key={step}>
              <span className="path-dot" aria-hidden="true">
                {index + 1}
              </span>
              <h3>{step}</h3>
            </li>
          ))}
        </ol>

        <p className="path-suite" data-rise>
          Two people bidding the same amount, a bid on the last tick of the clock and two buyers on Buy Now at once
          are all in the repository&apos;s test suite.
        </p>
      </div>
    </section>
  )
}

// Example lots: anything a host can hold up to a camera.
const LOTS = [
  { no: 12, item: 'Signed team jersey', price: '40', note: 'Booster club night', swing: -7, tilt: -2.5 },
  { no: 3, item: 'A week at the lake cabin', price: '300', note: 'Reserve $500', swing: 6, tilt: 2 },
  { no: 27, item: 'Grandfather clock', price: '650', note: 'Buy Now $1,200', swing: -5, tilt: -1.5 },
  { no: 8, item: 'Front-row parking, one year', price: '25', note: 'Staff fundraiser', swing: 8, tilt: 3 },
]

const TODAY = [
  ['Rounds', 'Opening bid, optional reserve, optional Buy Now, 30 seconds to 5 minutes'],
  ['Lot queue', 'Line the night up, then start each lot with one tap'],
  ['Max bids', 'The server bids for a bidder up to their limit'],
  ['Private amounts', 'Ranks are public, amounts are not'],
  ['Late-bid extension', 'A bid in the last 10 seconds adds time'],
  ['Join by link', 'Anyone outside the Zoom client can bid from a browser'],
  ['Invite all', 'The host opens the panel for the whole meeting'],
  ['Results', 'A receipt for the host and a CSV of every lot'],
]

const NOT_YET = [
  ['Checkout', 'Winners pay outside the app, from the host’s CSV'],
  ['Co-hosts', 'Only the meeting host can start and stop lots'],
]

export function Lots() {
  return (
    <section className="lots" aria-labelledby="lots-title">
      <div className="wrap">
        <div className="lots-head">
          <h2 id="lots-title" className="title" data-lines>
            <span className="mask">
              <span className="line">If you can hold it up to a camera,</span>
            </span>
            <span className="mask">
              <span className="line">you can sell it</span>
            </span>
          </h2>
          <p className="lede" data-rise>
            A school fundraiser, or a club&apos;s annual dinner that moved online and never moved back. The host
            needs a Zoom meeting and something to sell.
          </p>
        </div>
      </div>

      <div className="lots-line" aria-hidden="true">
        <svg className="lots-string" viewBox="0 0 1200 60" preserveAspectRatio="none">
          <path d="M0 8 Q 600 70 1200 8" fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
        </svg>
        <ul className="lots-tags">
          {LOTS.map((lot) => (
            <li key={lot.item} style={{ rotate: `${lot.tilt}deg` }} data-swing={lot.swing}>
              <span className="tag-knot" />
              <div className="tag">
                <span className="tag-hole" />
                <span className="tag-lot">Lot {lot.no}</span>
                <span className="tag-item">{lot.item}</span>
                <span className="tag-price">
                  <sup>$</sup>
                  {lot.price}
                </span>
                <span className="tag-note">{lot.note}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <p className="visually-hidden">
        Example lots: a signed team jersey starting at $40, a week at a lake cabin starting at $300, a grandfather
        clock starting at $650, and a year of front-row parking starting at $25.
      </p>

      <div className="wrap">
        <div className="ledger" data-rise>
          <div>
            <h3>What it does today</h3>
            <dl>
              {TODAY.map(([name, detail]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{detail}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <h3>What it does not do yet</h3>
            <dl>
              {NOT_YET.map(([name, detail]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{detail}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </section>
  )
}

const QUESTIONS = [
  {
    q: 'Do bidders have to install anything?',
    a: 'In Zoom, a bidder opens Gavel from Apps, or the host taps Invite all and everyone in the meeting gets a prompt. Anyone who is not in the Zoom client can bid from a browser with the join link.',
  },
  {
    q: 'Who can start and stop a lot?',
    a: 'The meeting host. Zoom tells the server who started the meeting through a signed webhook, and every host action is checked against it. Co-hosts cannot run lots yet.',
  },
  {
    q: 'Can other bidders see what I bid?',
    a: 'They see the ranking, how many bids each person has made, and the current price with the name of whoever set it. Your other amounts are shown only to you and to the host.',
  },
  {
    q: 'What if two people bid the same amount at the same moment?',
    a: 'The server takes bids for a lot one at a time. The first to arrive holds the price, and the other is told the new lowest bid.',
  },
  {
    q: 'How do winners pay?',
    a: 'Outside the app. The host downloads a CSV with each lot, its final price and its winner, and collects payment however they normally do. There is no checkout in the panel.',
  },
  {
    q: 'Can I try it without a meeting?',
    a: 'Yes. Opened in a browser, the panel runs as a sandbox session: start a lot, copy the join link into a second tab, and bid against yourself.',
  },
]

export function Questions() {
  return (
    <section className="questions" aria-labelledby="questions-title">
      <div className="wrap questions-grid">
        <h2 id="questions-title" className="title" data-lines>
          <span className="mask">
            <span className="line">Questions</span>
          </span>
        </h2>
        <div className="questions-list" data-rise="group">
          {QUESTIONS.map((item) => (
            <details key={item.q}>
              <summary>
                {item.q}
                <span aria-hidden="true" />
              </summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

export function Closing() {
  return (
    <section className="closing" aria-labelledby="closing-title">
      <div className="wrap closing-grid">
        <div className="closing-copy">
          <h2 id="closing-title" className="title title--light" data-lines>
            <span className="mask">
              <span className="line">Your first lot</span>
            </span>
            <span className="mask">
              <span className="line">is one sentence away</span>
            </span>
          </h2>
          <p className="lede lede--light" data-rise>
            Open the panel in a browser to run a sandbox auction now, or read how it is built.
          </p>
          <div className="closing-actions" data-rise>
            <a className="button button--cream" href="/zoom-test">
              Open the panel
            </a>
            <a className="button button--line" href={REPO} target="_blank" rel="noreferrer">
              Read the source
            </a>
          </div>
        </div>
        <div className="closing-panel" data-rise aria-hidden="true">
          <AppSidebar still>
            <HostDeskPanel blank />
          </AppSidebar>
        </div>
      </div>

      <footer className="footer">
        <div className="wrap footer-row">
          <span className="footer-brand">
            <Image src={logoMark} alt="" width={30} height={30} />
            Zoom Gavel
          </span>
          <nav className="footer-links" aria-label="Footer">
            <a href="#demo">Live demo</a>
            <a href="#lot">How a lot goes</a>
            <a href="#paddle">Try bidding</a>
            <a href={REPO} target="_blank" rel="noreferrer">
              GitHub
            </a>
          </nav>
          <span className="footer-note">
            An ASU Next Lab and Zoom fellowship project by{' '}
            <a href="https://www.sankrityat.com" target="_blank" rel="noreferrer">
              Sankritya
            </a>
          </span>
        </div>
      </footer>
    </section>
  )
}
