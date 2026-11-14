import { h } from 'preact'
import type { NearData } from './data.ts'
import { ButtonLink, LocationMap, NextPageLink, SupportLinks } from '../shared/components.ts'
import { Composer } from '../shared/composer.ts'
import { Page, renderDocument, siteDescription } from '../shared/layout.ts'
import { formatLocation, gridDescription } from '../../shared/geo.ts'
import { BlurtCard } from '../../ui/blurt-card.ts'
import { SubmitButton } from '../../ui/forms.ts'
import { html } from '../../ui/html.ts'
import { nearPageUrl } from '../../ui/urls.ts'

function NearPage({ viewer, location, radius, radii, blurts, next }: NearData) {
  const edit = `/${viewer.username}/edit`
  return html`
    <${Page}
      title="Blurts near you"
      tagline="What people around you are blurting."
      actions=${html`<${ButtonLink}
        href=${`${edit}#location`}
        icon="pin"
        label="Change location"
      />`}
      aside=${html`
        <section class="panel">
          <h3>Local context</h3>
          <p class="tiny">
            Only ${gridDescription} is stored for anyone, never the exact spot, and nobody sees
            yours. Set or remove it on <a href=${`${edit}#location`}>your edit page</a>.
          </p>
        </section>
        <${SupportLinks} />
      `}
    >
      ${
        !location &&
        html`<section class="panel" aria-label="Set your location">
          <h2>Set your location</h2>
          <p>
            You haven't set a location. Click the map to pick one and see blurts from people near
            you. Only ${gridDescription} is stored.
          </p>
          <${LocationMap} location=${location} returnTo="near" />
        </section>`
      }
      <${Composer} heading="Blurt from your area" placeholder="Local thought? Share it." />
      ${
        location
          ? html`
              <section class="panel" aria-label="Radius">
                <h2>Radius</h2>
                <p>
                  From people within ${radius} km of ${formatLocation(location)}.${' '}
                  <a href=${`${edit}#location`}>Change your location</a>
                </p>
                <form method="get" action="/near" class="radius-form">
                  <label
                    >Radius
                    <select name="radius">
                      ${radii.map(
                        (km) =>
                          html`<option value=${km} selected=${km === radius}>${km} km</option>`,
                      )}
                    </select>
                  </label>
                  <${SubmitButton} icon="pin" label="Show" kind="secondary" />
                </form>
              </section>
              <section aria-label="Blurts" class="panel" data-new-blurts="start">
                <h2>Nearby blurts</h2>
                ${
                  blurts.length > 0
                    ? blurts.map(
                        (blurt) =>
                          html`<${BlurtCard}
                            blurt=${blurt}
                            viewer=${viewer}
                            replies=${blurt.replies}
                          />`,
                      )
                    : html`<p class="empty">Nobody near you has blurted yet.</p>`
                }
                ${
                  next &&
                  html`<${NextPageLink}
                    href=${nearPageUrl(radius, next)}
                    label="Older blurts"
                    list="feed"
                  />`
                }
              </section>
            `
          : null
      }
    <//>
  `
}

function nearCanonical(radius: number): string {
  return `/near?radius=${radius}`
}

export function renderNearPage(data: NearData): string {
  return renderDocument(h(NearPage, data), {
    title: 'Blurts near you',
    description: siteDescription,
    canonical: nearCanonical(data.radius),
    noindex: true,
  })
}
