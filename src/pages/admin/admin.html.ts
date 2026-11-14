import { h } from 'preact'
import type { AdminReportsData, AdminToolsData } from './data.ts'
import { ButtonLink } from '../shared/components.ts'
import { Page, renderDocument } from '../shared/layout.ts'
import type { SignupState } from '../../routes/state.ts'
import { BlurtCard } from '../../ui/blurt-card.ts'
import { SubmitButton } from '../../ui/forms.ts'
import { html } from '../../ui/html.ts'
import { plural } from '../../ui/text.ts'
import { deleteBlurtPath } from '../../ui/urls.ts'

const signupStateLabels: Record<SignupState, string> = {
  open: 'open to everyone',
  invite: 'invite-only',
  waitlist: 'closed (waitlist)',
}

// The admin tools: one form per admin API.
function AdminToolsPage({ minted, limits }: AdminToolsData) {
  return html`
    <${Page} title="Admin" tagline="Tools for moderators.">
      <section class="panel" aria-label="Sign-up limits">
        <h2>Sign-up limits</h2>
        <p>
          ${plural(limits.count, 'sign-up')} so far. Sign-up is
          <strong>${signupStateLabels[limits.state]}</strong>.
        </p>
        <p class="tiny">
          Below the soft limit anyone can sign up. From there to the hard limit it takes an invite
          code, and at the hard limit sign-up closes and people can join the waitlist. Changes take
          effect at once.
        </p>
        <form method="post" action="/api/admin/signup-limits">
          <label
            >Soft limit (invite codes from here)
            <input
              name="softLimit"
              type="number"
              min="0"
              step="1"
              value=${limits.softLimit}
              required
          /></label>
          <label
            >Hard limit (closed from here)
            <input
              name="hardLimit"
              type="number"
              min="0"
              step="1"
              value=${limits.hardLimit}
              required
          /></label>
          <div class="actions">
            <${SubmitButton} icon="shield" label="Save limits" />
          </div>
        </form>
      </section>
      <section class="panel" aria-label="Reports">
        <h2>Reports</h2>
        <p>Blurts that people have reported.</p>
        <div class="actions">
          <${ButtonLink} href="/admin/reports" icon="flag" label="Open reports" />
        </div>
      </section>
      <section class="panel" aria-label="Delete a blurt">
        <h2>Delete a blurt</h2>
        <form method="post" action="/api/admin/blurts/delete">
          <label
            >Blurt id <input name="blurtId" inputmode="numeric" pattern="[0-9]+" required
          /></label>
          <div class="actions">
            <${SubmitButton} icon="trash" label="Delete blurt" kind="danger" />
          </div>
        </form>
      </section>
      <section class="panel" aria-label="Dismiss reports">
        <h2>Dismiss reports</h2>
        <p class="tiny">Closes every open report on the blurt, which stays up.</p>
        <form method="post" action="/api/admin/reports/dismiss">
          <label
            >Blurt id <input name="blurtId" inputmode="numeric" pattern="[0-9]+" required
          /></label>
          <div class="actions">
            <${SubmitButton} icon="shield" label="Dismiss reports" kind="secondary" />
          </div>
        </form>
      </section>
      <section class="panel" aria-label="Mint invite codes">
        <h2>Mint invite codes</h2>
        <p class="tiny">The codes belong to the user and are listed on their profile.</p>
        ${
          minted &&
          html`<div role="status">
            <p>${plural(minted.codes.length, 'code', 'codes')} for ${minted.username}:</p>
            <pre>${minted.codes.join('\n')}</pre>
          </div>`
        }
        <form method="post" action="/api/admin/invites">
          <label>Owner's username <input name="username" required /></label>
          <label
            >How many (1–1000)
            <input name="count" type="number" min="1" max="1000" value="10" required
          /></label>
          <label
            >Days until they expire (empty: never)
            <input name="days" type="number" min="1" step="1"
          /></label>
          <div class="actions">
            <${SubmitButton} icon="personPlus" label="Mint codes" />
          </div>
        </form>
      </section>
    <//>
  `
}

// Moderation: blurts with open reports, each with Delete and Dismiss buttons.
function AdminReportsPage({ reports }: AdminReportsData) {
  return html`
    <${Page} title="Reports" tagline="Open reports, the one waiting longest first.">
      ${
        reports.length > 0
          ? reports.map(
              ({ blurt, reports: open }) => html`
                <section class="panel report" aria-label="Reported blurt ${blurt.id}">
                  <${BlurtCard} blurt=${blurt} />
                  <ul>
                    ${open.map(
                      (report) =>
                        html`<li>
                          <a href="/${report.reporter}/">${report.reporter}</a>${': '}${
                            report.reason || html`<span class="empty">no reason given</span>`
                          }
                        </li>`,
                    )}
                  </ul>
                  <div class="actions">
                    <form method="post" action=${deleteBlurtPath(blurt)} class="inline">
                      <${SubmitButton} icon="trash" label="Delete blurt" kind="danger" />
                    </form>
                    <form method="post" action="/api/admin/reports/dismiss" class="inline">
                      <input type="hidden" name="blurtId" value=${blurt.id} />
                      <${SubmitButton} icon="shield" label="Dismiss" kind="secondary" />
                    </form>
                  </div>
                </section>
              `,
            )
          : html`<section class="panel"><p class="empty">No open reports.</p></section>`
      }
    <//>
  `
}

export function renderAdminToolsPage(data: AdminToolsData): string {
  return renderDocument(h(AdminToolsPage, data), { title: 'Admin', noindex: true })
}

export function renderAdminReportsPage(data: AdminReportsData): string {
  return renderDocument(h(AdminReportsPage, data), { title: 'Reports', noindex: true })
}
