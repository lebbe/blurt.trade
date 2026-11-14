import { h } from 'preact'
import type { PeopleData } from './data.ts'
import { NextPageLink, SupportLinks } from '../shared/components.ts'
import { Page, renderDocument } from '../shared/layout.ts'
import { html } from '../../ui/html.ts'
import { PersonItem } from '../../ui/people.ts'
import { peoplePageUrl } from '../../ui/urls.ts'

function PeoplePage({ people, next }: PeopleData) {
  return html`
    <${Page}
      title="People"
      tagline="Everyone on blurt.trade, A to Z."
      aside=${html`<${SupportLinks} />`}
    >
      <section aria-label="People" class="panel">
        ${
          people.length > 0
            ? html`<ul class="people">
                ${people.map((person) => html`<${PersonItem} person=${person} />`)}
              </ul>`
            : html`<p class="empty">Nobody here yet.</p>`
        }
        ${next && html`<${NextPageLink} href=${peoplePageUrl(next)} label="Next" list="people" />`}
      </section>
    <//>
  `
}

export function renderPeoplePage(data: PeopleData): string {
  return renderDocument(h(PeoplePage, data), {
    title: 'People',
    description: 'Everyone on blurt.trade, in alphabetical order.',
    canonical: peoplePageUrl(),
    noindex: true,
  })
}
