// <div data-enhance="push" data-vapid-key="…" data-endpoints="[…]" hidden>: "Notify me on
// this device" (src/ui/push.ts), under Notifications on the edit page. Hidden without
// JavaScript, since push needs it. The browser's permission is only asked for when the
// button is clicked: browsers hold a prompt that comes on its own against the site.
//
// With data-push-offer it is the offer at the top of the unread notifications, which only
// shows where it can help: not when this device is on already, the browser blocks
// notifications or can't show them (iPhones and iPads not on the Home Screen are told
// how), nor after "Not now" on this device (remembered in localStorage; the edit page
// still has the button).
//
// Turning it on registers the service worker (/sw.js, ./sw.ts), subscribes with our
// public VAPID key (src/push.ts) and hands the subscription to the server, which pushes
// to it from then on (empty pushes: the worker fetches what to show). Turning it off
// unsubscribes, tells the server and unregisters the worker, so nothing of ours stays in
// the browser. Whether it is on is the browser's subscription AND the server knowing it
// for this login (`data-endpoints`): after logging out and in again the browser may still
// hold a subscription the server has dropped, and then it is off until clicked.

type PushState = 'on' | 'off' | 'busy'

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

async function post(url: string, body: unknown): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
    })
    await response.text()
    return response.ok
  } catch {
    return false
  }
}

// iPhone and iPad: Safari offers push only to a site opened from the Home Screen.
function needsHomeScreen(): boolean {
  const ios =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))
  return ios && !matchMedia('(display-mode: standalone)').matches
}

const dismissedKey = 'push-offer-dismissed'

function offerDismissed(): boolean {
  try {
    return localStorage.getItem(dismissedKey) === '1'
  } catch {
    return false
  }
}

function dismissOffer(): void {
  try {
    localStorage.setItem(dismissedKey, '1')
  } catch {
    // Storage blocked: the offer comes back on the next visit, which is all that's lost.
  }
}

export async function enhance(element: HTMLElement): Promise<void> {
  const key = element.dataset.vapidKey ?? ''
  const known = new Set(JSON.parse(element.dataset.endpoints ?? '[]') as string[])
  const status = element.querySelector<HTMLElement>('[data-push-status]')
  const button = element.querySelector<HTMLButtonElement>('[data-push-toggle]')
  if (!key || !status || !button) {
    throw new Error('Not a push element')
  }
  const offer = element.hasAttribute('data-push-offer')
  if (offer && offerDismissed()) {
    return
  }
  const dismiss = element.querySelector<HTMLButtonElement>('[data-push-dismiss]')
  dismiss?.addEventListener('click', () => {
    dismissOffer()
    element.hidden = true
  })
  const say = (text: string) => {
    status.textContent = text
  }

  const supported =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (!supported) {
    if (offer && !needsHomeScreen()) {
      return
    }
    element.hidden = false
    button.hidden = true
    say(
      needsHomeScreen()
        ? 'On iPhone and iPad, add blurt.trade to your Home Screen first (Share, then Add to Home Screen) and open it from there. Then turn notifications on here.'
        : "This browser can't show notifications from websites.",
    )
    return
  }

  const subscription = async () => {
    const registration = await navigator.serviceWorker.getRegistration('/')
    return (await registration?.pushManager.getSubscription()) ?? null
  }
  let state: PushState = 'off'
  const render = (next: PushState) => {
    state = next
    button.disabled = next === 'busy'
    if (next === 'on') {
      button.textContent = 'Stop notifying this device'
    } else if (next === 'off') {
      button.textContent = 'Notify me on this device'
    }
  }
  const current = await subscription()
  const isOn = current !== null && known.has(current.endpoint)
  if (offer && (isOn || Notification.permission === 'denied')) {
    return
  }
  render(isOn ? 'on' : 'off')
  element.hidden = false
  say(
    isOn
      ? 'This device gets a notification when something new is waiting for you.'
      : Notification.permission === 'denied'
        ? "Notifications are blocked for this site in your browser's settings."
        : 'Get a notification on this device when something new is waiting for you, even when the site is closed.',
  )

  button.addEventListener('click', () => {
    if (state === 'busy') {
      return
    }
    const turnOn = state === 'off'
    render('busy')
    void (turnOn ? on() : off()).then((ok) => {
      render(ok === turnOn ? 'on' : 'off')
      if (dismiss) {
        // Once on, "Not now" makes no sense; the edit page is where it's turned off.
        dismiss.hidden = state === 'on'
      }
    })
  })

  async function on(): Promise<boolean> {
    say('Asking your browser…')
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      say(
        permission === 'denied'
          ? "Notifications are blocked for this site in your browser's settings."
          : 'Notifications were not allowed.',
      )
      return false
    }
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      })
      await navigator.serviceWorker.ready
      let pushSubscription = await registration.pushManager.getSubscription()
      const options = { userVisibleOnly: true, applicationServerKey: keyBytes(key) }
      try {
        pushSubscription ??= await registration.pushManager.subscribe(options)
      } catch {
        // Subscribed before with another key (the server's keys changed): start over.
        await pushSubscription?.unsubscribe()
        pushSubscription = await registration.pushManager.subscribe(options)
      }
      if (!(await post('/api/push/subscriptions', pushSubscription.toJSON()))) {
        say('Could not turn notifications on. Please try again.')
        return false
      }
      known.add(pushSubscription.endpoint)
      say('This device gets a notification when something new is waiting for you.')
      return true
    } catch (error) {
      console.error(error)
      say('This browser could not turn notifications on.')
      return false
    }
  }

  async function off(): Promise<boolean> {
    const existing = await subscription()
    if (existing) {
      known.delete(existing.endpoint)
      const told = await post('/api/push/subscriptions/delete', { endpoint: existing.endpoint })
      await existing.unsubscribe().catch(() => false)
      if (!told) {
        say(
          'Stopped on this device. The site may not know yet; it will after the next notification.',
        )
        return true
      }
    }
    const registration = await navigator.serviceWorker.getRegistration('/')
    await registration?.unregister()
    say('Notifications are off on this device.')
    return true
  }
}
