import { html } from './html.ts'
import { Icon, type IconName } from './icons.ts'

// Pieces of the plain HTML forms every action is (they work without JS).

export function ValidationError({ message }: { message?: string }) {
  return message ? html`<p class="validation-error" role="alert">${message}</p>` : null
}

export function SubmitButton({
  icon,
  label,
  kind = '',
}: {
  icon: IconName
  label: string
  kind?: '' | 'secondary' | 'danger'
}) {
  return html`<button type="submit" class=${kind || undefined}>
    <${Icon} name=${icon} /><span>${label}</span>
  </button>`
}
