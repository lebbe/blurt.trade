import { h } from 'preact'
import type { PeopleData } from './data.ts'
import { NextPageLink, SupportLinks } from '../shared/components.ts'
import { Page, renderDocument } from '../shared/layout.ts'
import { AvatarView } from '../../ui/avatar.ts'
import { Timestamp } from '../../ui/blurt-card.ts'
import { html } from '../../ui/html.ts'
import { plural, preview } from '../../ui/text.ts'
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
                ${people.map(
                  (person) =>
                    html`<li>
                      <a href="/${person.username}/" class="person-avatar"
                        ><${AvatarView} avatar=${person.avatar}
                      /></a>
                      <div class="person-body">
                        <strong><a href="/${person.username}/">${person.username}</a></strong>
                        <span class="tiny"
                          >${plural(person.blurtCount, 'blurt')} ·
                          ${plural(person.followerCount, 'follower')}</span
                        >
                        ${person.bio !== '' && html`<p class="tiny">${preview(person.bio, 120)}</p>`}
                        <span class="tiny"
                          >Joined <${Timestamp} date=${person.joinedAt} />${
                            person.lastBlurtAt &&
                            html` · Last blurt <${Timestamp} date=${person.lastBlurtAt} />`
                          }</span
                        >
                      </div>
                    </li>`,
                )}
              </ul>`
            : html`<p class="empty">Nobody here yet.</p>`
        }
        ${next && html`<${NextPageLink} href=${peoplePageUrl(next)} label="Next" />`}
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
