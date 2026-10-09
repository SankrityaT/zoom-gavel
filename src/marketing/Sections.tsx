import Image from 'next/image'
import logoMark from './assets/logo.png'
import { Crop, HostDeskPanel } from './demo'
import { ChapterHead } from './parts'

const REPO = 'https://github.com/SankrityaT/zoom-gavel'

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
    <section id="questions" className="chapter" aria-labelledby="questions-title">
      <ChapterHead id="questions-title" label="Questions" title="What people ask first." />
      <div className="questions rise">
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
    </section>
  )
}

/** The page's ending: the line and the two ways in on a dark panel, with the host's empty first lot rising from
 *  its bottom edge, then the footer. */
export function Ending() {
  return (
    <>
      <div className="wrap">
        <section className="ending rise" aria-labelledby="ending-title">
          <h2 id="ending-title">Put your first lot up.</h2>
          <p>Open the panel in a browser and run a sandbox auction now. No meeting needed.</p>
          <div className="ending-actions">
            <a className="button button--cream" href="/zoom-test">
              Open the panel
            </a>
            <a className="button button--line" href={REPO} target="_blank" rel="noreferrer">
              Read the source
            </a>
          </div>
          <div className="ending-panel" aria-hidden="true">
            <Crop>
              <HostDeskPanel blank />
            </Crop>
          </div>
        </section>
      </div>

      <footer className="footer">
        <div className="wrap footer-grid">
          <div className="footer-about">
            <span className="footer-brand">
              <Image src={logoMark} alt="" width={30} height={30} />
              Zoom Gavel
            </span>
            <p>Live bidding inside a Zoom meeting. An ASU Next Lab and Zoom fellowship project.</p>
          </div>
          <div>
            <h4>Product</h4>
            <a href="#lot">How a lot goes</a>
            <a href="#paddle">Try bidding</a>
            <a href="#bidders">For bidders</a>
            <a href="#questions">Questions</a>
          </div>
          <div>
            <h4>Use it</h4>
            <a href="/zoom-test">Open the panel</a>
            <a href={REPO} target="_blank" rel="noreferrer">
              Source on GitHub
            </a>
          </div>
          <div>
            <h4>Made by</h4>
            <a href="https://www.sankrityat.com" target="_blank" rel="noreferrer">
              Sankritya Thakur
            </a>
          </div>
          <div className="footer-legal">
            <span>&copy; 2026 Zoom Gavel.</span>
            <span>Every screen is Gavel itself, with made-up bidders and lots.</span>
          </div>
        </div>
      </footer>
    </>
  )
}
