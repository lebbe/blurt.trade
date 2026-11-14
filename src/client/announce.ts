// One polite live region for the whole page, for what happens without a page load that a
// screen reader would otherwise miss: "100 older blurts loaded", "Your blurt is posted".
// Made on first use and kept at the end of <body>.

let region: HTMLElement | undefined
let timer: ReturnType<typeof setTimeout> | undefined

export function announce(message: string): void {
  if (!region?.isConnected) {
    region = document.createElement('div')
    region.className = 'visually-hidden'
    region.setAttribute('role', 'status')
    region.setAttribute('aria-live', 'polite')
    region.dataset.announcer = ''
    document.body.append(region)
  }
  // Emptied first and filled a moment later: a region that was just made, or the same
  // message twice, is only read out when its text changes after it is in the page.
  const target = region
  target.textContent = ''
  clearTimeout(timer)
  timer = setTimeout(() => {
    target.textContent = message
  }, 50)
}
