import type { FollowStats } from '../routes/state/follows.ts'
import { FollowForm, followTagline } from '../ui/follow.ts'
import { html } from '../ui/html.ts'
import { announce } from './announce.ts'
import type { EnhancerContext } from './enhance.ts'
import { replaceRendered } from './render.ts'
import { submitForm, submitForReal } from './requests.ts'

// <form data-enhance="follow">: Follow / Unfollow on a profile (FollowForm, src/ui/follow.ts)
// without a page load. The button changes at once, then the form and the profile's
// follower count are rendered from the answer (the new follow stats). Refused, it goes
// back and the live region says why; the server out of reach, it goes back and the form
// is submitted for real.

export function enhance(form: HTMLFormElement, context: EnhancerContext): void {
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    void send(form, event.submitter, context)
  })
}

function show(form: HTMLFormElement, following: boolean, context: EnhancerContext) {
  const username = (form.elements.namedItem('username') as HTMLInputElement).value
  const fresh = replaceRendered(
    form,
    html`<${FollowForm} username=${username} following=${following} />`,
    context.page,
  ) as HTMLFormElement
  void context.enhance(fresh)
  return fresh
}

async function send(
  form: HTMLFormElement,
  submitter: HTMLElement | null,
  context: EnhancerContext,
) {
  const username = (form.elements.namedItem('username') as HTMLInputElement).value
  const follow = new URL(form.action).pathname === '/api/follow'
  const pending = submitForm<FollowStats>(form, { submitter, fallback: false })
  const optimistic = show(form, follow, context)
  const outcome = await pending
  if (outcome.kind === 'success' && outcome.data) {
    show(optimistic, outcome.data.viewerFollows, context)
    const tagline = document.querySelector('.page-title .tagline')
    if (tagline) {
      tagline.textContent = followTagline(outcome.data)
    }
    announce(
      outcome.data.viewerFollows ? `You follow ${username}.` : `You no longer follow ${username}.`,
    )
    return
  }
  const back = show(optimistic, !follow, context)
  if (outcome.kind === 'errors') {
    announce(outcome.errors.map((error) => error.message).join(' '))
  } else {
    submitForReal(back)
  }
}
