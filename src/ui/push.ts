import { html } from './html.ts'

// "Notify me on this device" (src/client/push.ts): a button only JavaScript can make work
// (the browser's permission, a service worker), so it is hidden until the client shows it.
// Used under Notifications on the edit page, and as an offer at the top of the unread
// notifications (`offer`), where people look for them. The offer has a "Not now" and
// stays hidden where it can't help: this device is on already, the browser blocks
// notifications, or it can't show them at all.

// `publicKey` is the server's VAPID key, which a browser subscribes with. `thisDevice` are
// the endpoints this login has (the client compares the browser's with them).
export type PushDevice = { publicKey: string; thisDevice: string[] }

export function PushDeviceButton({ push, offer = false }: { push: PushDevice; offer?: boolean }) {
  return html`
    <div
      class=${offer ? 'push-device push-offer panel' : 'push-device'}
      data-enhance="push"
      data-push-offer=${offer ? '' : undefined}
      data-vapid-key=${push.publicKey}
      data-endpoints=${JSON.stringify(push.thisDevice)}
      hidden
    >
      <p class="tiny" data-push-status></p>
      <div class="actions">
        <button type="button" class=${offer ? undefined : 'secondary'} data-push-toggle></button>
        ${offer && html`<button type="button" class="secondary" data-push-dismiss>Not now</button>`}
      </div>
    </div>
  `
}
