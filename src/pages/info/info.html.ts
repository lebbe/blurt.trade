import { type ComponentChildren, h } from 'preact'
import type { Contact } from '../../config.ts'
import { noPasswordReset } from '../auth/data.ts'
import type { InfoPageData } from './data.ts'
import { JavaScriptSetting, SupportLinks } from '../shared/components.ts'
import { Page, renderDocument } from '../shared/layout.ts'
import { gridDescription } from '../../shared/geo.ts'
import { blurtMaxLength } from '../../shared/limits.ts'
import { usePageContext } from '../../ui/context.ts'
import { html } from '../../ui/html.ts'
import { javascriptSettingPath } from '../../ui/urls.ts'

// How to reach the owner privately, or a note that no address is set up.
function PrivateContact({ contact }: { contact: Contact }) {
  return contact.email
    ? html`email <a href=${`mailto:${contact.email}`}>${contact.email}</a>`
    : html`the contact on the <a href="/about">About page</a>`
}

// About, Terms and Privacy: one panel of text.
function InfoPage({
  title,
  tagline,
  children,
}: {
  title: string
  tagline: string
  children?: ComponentChildren
}) {
  return html`
    <${Page} title=${title} tagline=${tagline} aside=${html`<${SupportLinks} />`}>
      <section class="panel prose">${children}</section>
    <//>
  `
}

function AboutPage({ contact }: InfoPageData) {
  const { email, issuesUrl, securityUrl } = contact
  const { viewer, javascript } = usePageContext()
  return html`
    <${InfoPage} title="About blurt.trade" tagline="A small hobby site for blurting.">
      <p>
        blurt.trade is a small hobby site for short posts, blurts, of up to ${blurtMaxLength}${' '}
        characters. It has no ads and no tracking, and collects as little about you as it can:
        see${' '}
        <a href="/privacy">Privacy</a> and <a href="/terms">Terms</a>. It works fully without
        JavaScript, which is <a href="#javascript">optional</a>.
      </p>
      <section id="javascript" aria-label="JavaScript">
        <h2>JavaScript</h2>
        ${
          viewer
            ? html`<p>
                Everything works without JavaScript. The site's JavaScript is optional, and comes
                only from blurt.trade itself. It is ${javascript ? 'on' : 'off'} for your account:
                turn it ${javascript ? 'off' : 'on'} in${' '}
                <a href="/settings#javascript">Settings</a>.
              </p>`
            : html`<${JavaScriptSetting} />`
        }
      </section>
      <section aria-label="Contact">
        <h2>Contact</h2>
        ${
          issuesUrl &&
          html`<p>Questions, bugs and ideas: open an issue on <a href=${issuesUrl}>GitHub</a>.</p>`
        }
        ${email && html`<p>Anything that shouldn't be public: <a href=${`mailto:${email}`}>${email}</a>.</p>`}
        ${!issuesUrl && !email && html`<p>No contact address has been set up yet.</p>`}
        ${
          issuesUrl &&
          html`<p>
              <strong>GitHub issues are public</strong>: anyone can read them. Never put these in
              one:
            </p>
            <ul>
              <li>
                A security hole:
                ${
                  securityUrl
                    ? html`report it privately with GitHub's
                        <a href=${securityUrl}>Report a vulnerability</a
                        >${email ? ', or by email' : ''}.`
                    : 'email it.'
                }
              </li>
              <li>
                Illegal content, or someone's private information posted here: use the Report button
                on the blurt (when you're logged in)${email ? ', or email' : ''}. Don't repeat the
                content or the information anywhere public.
              </li>
              <li>
                Anything about your own account or data:
                ${email ? html`<a href=${`mailto:${email}`}>email</a>` : 'ask without details'}.
              </li>
            </ul>`
        }
      </section>
    <//>
  `
}

function TermsPage({ contact }: InfoPageData) {
  return html`
    <${InfoPage} title="Terms" tagline="Short on purpose.">
      <p>By using blurt.trade you agree to these terms. They're short on purpose.</p>
      <h2>Your posts</h2>
      <p>
        You're responsible for what you post. Everything you post is public: blurts, replies and
        your profile. You keep the rights to it, and let blurt.trade show it, which is the point.
      </p>
      <h2>What's not allowed</h2>
      <p>
        Nothing illegal. No harassment, no threats, no spam, and no one else's private information.
        Don't try to break the site or get around its limits.
      </p>
      <h2>Removal</h2>
      <p>
        The owner can remove any blurt or profile, and close any account, at any time and without
        notice, for example when it breaks these terms.
      </p>
      <h2>Age</h2>
      <p>You must be at least 13 years old to use blurt.trade.</p>
      <h2>Your password</h2>
      <p>${noPasswordReset}</p>
      <h2>No warranty</h2>
      <p>
        blurt.trade is a hobby project, provided as it is, with no warranty of any kind. It may be
        down, lose data, change or shut down. As far as the law allows, the owner isn't liable for
        any loss from using it.
      </p>
      <h2>Changes</h2>
      <p>
        These terms may change; this page always has the current version. Questions:
        <${PrivateContact} contact=${contact} />.
      </p>
    <//>
  `
}

function PrivacyPage({ contact, inviteOnly }: InfoPageData) {
  const { viewer } = usePageContext()
  return html`
    <${InfoPage} title="Privacy" tagline="As little as we can.">
      <p>
        blurt.trade collects as little as it can. No email address, no real name, no phone number.
        No analytics, no ads, no tracking, and nothing loaded from other sites.
      </p>
      <h2>Who is responsible</h2>
      <p>
        Lars-Erik Bruce is responsible for the site and its data (the controller under the GDPR). To
        reach him: <${PrivateContact} contact=${contact} />.
      </p>
      <p>
        blurt.trade runs on a server owned and operated by a private individual in Norway, who hosts
        it on Lars-Erik's behalf and has access to it only to keep it running.
      </p>
      <h2>What is stored</h2>
      <p>For each account:</p>
      <ul>
        <li>
          Your username, a hash of your password (Argon2id: the password itself is never stored),
          and when you signed up.
        </li>
        <li>
          The profile fields you fill in: bio, homepage and social links, your avatar's settings,
          the colour theme and share card colour you picked, and whether you turned JavaScript off.
        </li>
        <li>
          Only if you set it: a coarse location, ${gridDescription}. Only you see it, but it puts
          your blurts in "Near you" for people nearby.
        </li>
        <li>
          Your blurts and replies, with when you posted them, and for each one an embedding: numbers
          describing what it's about, for related blurts and "You might like". It's computed on our
          own server; your text isn't sent anywhere.
        </li>
        <li>
          If you attach one, a blurt's picture: only a rough drawing of it, made on our own server.
          The photo you upload is never stored.
        </li>
        <li>
          If you upload one, your profile picture: likewise only a rough drawing, and where you
          clicked for its mouth. It's public, like the avatar.
        </li>
        <li>Who you follow.</li>
        <li>
          Your notifications: a row per reply, reblurt, quote or (if you switched it on) new blurt
          from someone you follow, with who did it, which blurt and when, and whether you've read
          it. Read ones are deleted after 90 days. Which kinds you want is stored with your profile.
          Only you see them.
        </li>
        <li>
          Blurts you like, and when. Only the number of likes on a blurt is public: nobody else sees
          who liked it.
        </li>
        <li>
          Blurts you reblurt, and when. Reblurts are public: they show on your profile and in your
          followers' feeds. A quote is a blurt of your own, with the quoted blurt under it.
        </li>
        ${
          inviteOnly &&
          html`<li>
            Your invite codes, and who signed up with them. Who invited you shows on your profile.
          </li>`
        }
        <li>Blurts you report, with your reason and when.</li>
        <li>
          Your sessions: one record per login, with when it started and was last used. No IP address
          and no browser details.
        </li>
      </ul>
      <p>
        The waitlist stores only the username you'd like, whether you've signed up since, and when
        you joined it.
      </p>
      <p>
        For deleted accounts, only the username is kept, in lower case and with nothing else, so it
        can't be taken again.
      </p>
      <p>
        Public: your username, profile, avatar, blurts, reblurts, follower, like and reblurt counts,
        and who invited you. Everything else is private, though admins see who reported what.
      </p>
      <h2>What is not stored</h2>
      <ul>
        <li>
          No email address. So we can't contact you, and there's <strong>no password reset</strong>:
          a lost password can't be recovered, and neither can the account.
        </li>
        <li>
          No IP addresses in the database or in the app's logs. Rate limiting counts requests per IP
          address in memory only, until the limit has refilled (an hour at most), and never writes
          them down.
        </li>
        <li>
          The web server's access log, though, does keep the full IP address, time, method and path
          of each request for 14 days, to spot abuse. It doesn't name your account, but together
          with the app's logs it could be linked to it.
        </li>
        <li>
          The app's logs hold what was asked for and how it went (method, path, status, time), never
          what you posted, your password or your cookies. They are kept only until they are rotated
          out: they are capped by size, so roughly days to weeks.
        </li>
      </ul>
      <h2>Cookies</h2>
      <p>
        Up to four, all strictly necessary for things you ask the site to do, none for tracking or
        analytics, so there's no cookie banner. Visitors who aren't logged in get none, unless they
        turn JavaScript off. All four are HttpOnly, Secure and SameSite=Lax, and only sent to
        blurt.trade.
      </p>
      <p>
        The site works fully without JavaScript. Its JavaScript is optional (<a
          href=${javascriptSettingPath(viewer !== null)}
          >you can turn it off</a
        >), comes only from blurt.trade, and stores nothing in your browser: no local storage, no
        other cookies.
      </p>
      <table>
        <thead>
          <tr>
            <th>Cookie</th>
            <th>What it's for</th>
            <th>Lasts</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>__Host-access_token</code></td>
            <td>
              Shows you're logged in, with your colour theme, time zone, language and whether
              JavaScript is on
            </td>
            <td>5 minutes</td>
          </tr>
          <tr>
            <td><code>__Host-refresh_token</code></td>
            <td>Keeps you logged in and renews the one above</td>
            <td>
              Until you close the browser, or, if you ticked <em>Keep me logged in</em>, 400 days
              without a visit. Gone when you log out.
            </td>
          </tr>
          <tr>
            <td><code>recent_write</code></td>
            <td>
              After you post or change something, makes sure you see your own change straight away
            </td>
            <td>10 seconds</td>
          </tr>
          <tr>
            <td><code>javascript</code></td>
            <td>
              Only once you turn JavaScript off: remembers that in this browser. Logged in, it's
              saved on your account too, and the account's setting counts
            </td>
            <td>400 days, or until you turn JavaScript back on</td>
          </tr>
        </tbody>
      </table>
      <h2>Why we may use your data</h2>
      <ul>
        <li>
          Your account, posts, follows, likes and the rest, to provide the service you signed up for
          (contract, GDPR Art. 6(1)(b)).
        </li>
        <li>
          The optional coarse location, because you chose to set it (consent, Art. 6(1)(a)). Clear
          it to withdraw.
        </li>
        <li>
          Rate limiting and the web server's access log, to protect the site from abuse (legitimate
          interests, Art. 6(1)(f)).
        </li>
      </ul>
      <h2>Backups</h2>
      <p>
        There are no backups. If the server's disk fails, the data is gone, and deleting your
        account removes it everywhere.
      </p>
      <h2>Deleting your account</h2>
      <p>
        <a href="/settings">Settings</a> has "Delete my account", which asks for your password. It
        deletes at once, in one go, everything above that belongs to the account: your profile,
        avatar and location, the text of your blurts and their embeddings, your reblurts, who you
        follow and who follows you, your likes (and the likes on your blurts), your notifications,
        ${inviteOnly ? 'your invite codes, ' : ''}your reports, your sessions and your waitlist
        entry. You're logged out everywhere.
      </p>
      <p>
        What stays: an empty record of the account, with no username, password or profile, and an
        empty row for each of your blurts, with no text, which shows nowhere and names nobody. A
        blurt someone replied to shows as an empty placeholder, with no text and no author, so the
        thread still reads.
        ${
          inviteOnly
            ? 'The invite code you signed up with stays marked as used, with nothing linking it to you. '
            : ''
        }Your
        username goes on the list of retired names, with nothing else, so nobody can sign up as you
        later. The count of sign-ups so far doesn't go down.
      </p>
      <h2>Your rights</h2>
      <p>
        You can ask what is stored about you, and have it corrected, deleted or handed to you in a
        form you can reuse (data portability), and you can object to how it is used:
        <${PrivateContact} contact=${contact} />. You can also complain to the Norwegian Data
        Protection Authority, <a href="https://www.datatilsynet.no">Datatilsynet</a>.
      </p>
    <//>
  `
}

export function renderAboutPage(data: InfoPageData): string {
  return renderDocument(h(AboutPage, data), { title: 'About' })
}

export function renderTermsPage(data: InfoPageData): string {
  return renderDocument(h(TermsPage, data), { title: 'Terms' })
}

export function renderPrivacyPage(data: InfoPageData): string {
  return renderDocument(h(PrivacyPage, data), { title: 'Privacy' })
}
