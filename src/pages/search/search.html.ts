import { h } from 'preact'
import type { SearchData } from './data.ts'
import { LinkPanel, NextPageLink, SupportLinks } from '../shared/components.ts'
import { Page, renderDocument, shareTitleMax } from '../shared/layout.ts'
import { searchQueryMaxLength } from '../../shared/limits.ts'
import { AvatarView } from '../../ui/avatar.ts'
import { BlurtCard } from '../../ui/blurt-card.ts'
import { SubmitButton } from '../../ui/forms.ts'
import { html } from '../../ui/html.ts'
import { preview } from '../../ui/text.ts'
import { searchUrl } from '../../ui/urls.ts'

// The search box is the page here, so the header leaves its own out.
function SearchPage({ viewer, query, users, blurts, next }: SearchData) {
  return html`
    <${Page}
      title="Search"
      tagline="Find people and blurts."
      search=${false}
      aside=${html`
        <${LinkPanel}
          title="Browse instead"
          links=${[
            ['/everyone', 'Everyone'],
            ...(viewer ? ([['/near', 'Near you']] as [string, string][]) : []),
          ]}
        />
        <${SupportLinks} />
      `}
    >
      <section class="panel composer">
        <h2>Search people and blurts</h2>
        <form method="get" action="/search" role="search" class="search-form">
          <label for="site-search-q" class="visually-hidden">Search</label>
          <input
            id="site-search-q"
            type="search"
            name="q"
            value=${query}
            maxlength=${searchQueryMaxLength}
            placeholder="Usernames and blurts"
          />
          <div class="row">
            <span class="tiny">Usernames by name, blurts by every word.</span>
            <${SubmitButton} icon="search" label="Search" />
          </div>
        </form>
      </section>
      ${
        query === ''
          ? html`<section class="panel">
              <p class="empty">Type a username or some words in the search box above.</p>
            </section>`
          : html`
              <p class="results-for">Results for <q>${query}</q></p>
              ${
                users.length > 0 &&
                html`<section aria-label="People" class="panel">
                  <h2>People</h2>
                  <ul class="user-matches">
                    ${users.map(
                      (user) =>
                        html`<li>
                          <a href="/${user.username}/"
                            ><${AvatarView} avatar=${user.avatar} /> ${user.username}</a
                          >
                        </li>`,
                    )}
                  </ul>
                </section>`
              }
              <section aria-label="Blurts" class="panel">
                <h2>Blurts</h2>
                ${
                  blurts.length > 0
                    ? blurts.map((blurt) => html`<${BlurtCard} blurt=${blurt} viewer=${viewer} />`)
                    : html`<p class="empty">No blurts match.</p>`
                }
                ${
                  next &&
                  html`<${NextPageLink}
                    href=${searchUrl(query, next)}
                    label="Older blurts"
                    list="blurts"
                  />`
                }
              </section>
            `
      }
    <//>
  `
}

function searchCanonical(query: string): string {
  return `/search?q=${encodeURIComponent(query)}`
}

export function renderSearchPage(data: SearchData): string {
  const title = data.query === '' ? 'Search' : preview(data.query, shareTitleMax)
  const description =
    data.query === ''
      ? 'Search usernames and blurts.'
      : `Search results for “${preview(data.query, 80)}”.`
  return renderDocument(h(SearchPage, data), {
    title,
    description,
    canonical: searchCanonical(data.query),
    noindex: true,
  })
}
