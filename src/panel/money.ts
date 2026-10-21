// Whole dollars from what a person typed. The old reading kept only the
// digits, so "250.00" became 25000: a binding $25,000 bid under a field that
// still said 250.00. Here a trailing ".0" or ".00" is accepted and dropped,
// and anything else with a decimal point (cents, a second dot) is refused, so
// the amount sent is always the amount shown.
export function parseDollars(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, '')
  if (!/^\d+(\.0{1,2})?$/.test(cleaned)) return null
  const whole = Number.parseInt(cleaned.split('.')[0], 10)
  return Number.isSafeInteger(whole) ? whole : null
}

export const hasCents = (text: string) => /\.\d*[1-9]/.test(text.replace(/[$,\s]/g, ''))

// Copy text. The Zoom webview has been seen without navigator.clipboard, so
// this falls back to the old selection trick; false means neither worked and
// the caller should leave the text selectable.
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the selection fallback.
  }
  try {
    const field = document.createElement('textarea')
    field.value = text
    field.setAttribute('readonly', '')
    field.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
    document.body.appendChild(field)
    field.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(field)
    return ok
  } catch {
    return false
  }
}
