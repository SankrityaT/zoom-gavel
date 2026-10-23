// The host's payment line is free text. When it holds a link to a service
// people already use, the winner's page offers a button that names it.
// Only these services are given a button; any other text stays plain text, so
// the button can never be a link the host typed to somewhere unexpected.
const SERVICES: { name: string; hosts: string[] }[] = [
  { name: 'Venmo', hosts: ['venmo.com', 'account.venmo.com'] },
  { name: 'PayPal', hosts: ['paypal.me', 'paypal.com'] },
  { name: 'Cash App', hosts: ['cash.app'] },
  { name: 'Stripe', hosts: ['buy.stripe.com', 'checkout.stripe.com', 'invoice.stripe.com'] },
]

export type PayLink = { service: string; url: string }

export function payLinkFrom(note: string | null): PayLink | null {
  if (!note) return null
  const found = note.match(/https:\/\/[^\s<>"']+/i)
  if (!found) return null
  let url: URL
  try {
    url = new URL(found[0].replace(/[.,;:!?)]+$/, ''))
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
  const host = url.hostname.toLowerCase()
  const service = SERVICES.find((s) => s.hosts.some((h) => host === h || host.endsWith(`.${h}`)))
  // A look-alike such as venmo.com.evil.example never ends in a listed host.
  return service ? { service: service.name, url: url.toString() } : null
}
