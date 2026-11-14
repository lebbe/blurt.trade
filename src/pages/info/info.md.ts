import type { Contact } from '../../config.ts'
import { pageContext } from '../../page-context.ts'
import { noPasswordReset } from '../auth/data.ts'
import type { InfoPageData } from './data.ts'
import { home, javascriptSetting } from '../shared/blurts.md.ts'
import { code, link, type Markdown, md } from '../shared/markdown.ts'
import { gridDescription } from '../../shared/geo.ts'
import { blurtMaxLength } from '../../shared/limits.ts'
import { javascriptSettingPath } from '../../ui/urls.ts'

// The fixed pages: /about, /terms and /privacy as Markdown: the same data as the HTML, for
// text/markdown and text/plain clients (curl, LLMs, terminals). Forms are described instead
// of rendered.

// How to reach the owner privately, or a pointer to /about when no address is set up.
function privateContact({ email }: Contact): Markdown {
  return email
    ? md`email ${link(email, `mailto:${email}`)}`
    : md`the contact on the ${link('About page', '/about')}`
}

export function aboutMarkdown({ contact }: InfoPageData): Markdown {
  const { email, issuesUrl, securityUrl } = contact
  const security = securityUrl
    ? md`report it privately with GitHub's ${link('Report a vulnerability', securityUrl)}${email ? ', or by email' : ''}.`
    : 'email it.'
  return md`
    # About blurt.trade

    ${home}

    blurt.trade is a small hobby site for short posts, blurts, of up to ${blurtMaxLength} characters. It has no ads and no tracking, and collects as little about you as it can: see ${link('Privacy', '/privacy')} and ${link('Terms', '/terms')}. It works fully without JavaScript, which is optional (below).

    ## JavaScript

    ${javascriptSetting('about')}

    ## Contact

    ${issuesUrl && md`Questions, bugs and ideas: open an issue on ${link('GitHub', issuesUrl)}.`}

    ${email && md`Anything that shouldn't be public: ${link(email, `mailto:${email}`)}.`}

    ${!issuesUrl && !email && 'No contact address has been set up yet.'}

    ${
      issuesUrl &&
      md`
        **GitHub issues are public**: anyone can read them. Never put these in one:

        - A security hole: ${security}
        - Illegal content, or someone's private information posted here: use the Report button on the blurt (when you're logged in)${email ? ', or email' : ''}. Don't repeat the content or the information anywhere public.
        - Anything about your own account or data: ${email ? link('email', `mailto:${email}`) : 'ask without details'}.
      `
    }
  `
}

export function termsMarkdown({ contact }: InfoPageData): Markdown {
  return md`
    # Terms

    ${home}

    By using blurt.trade you agree to these terms. They're short on purpose.

    ## Your posts

    You're responsible for what you post. Everything you post is public: blurts, replies and your profile. You keep the rights to it, and let blurt.trade show it, which is the point.

    ## What's not allowed

    Nothing illegal. No harassment, no threats, no spam, and no one else's private information. Don't try to break the site or get around its limits.

    ## Removal

    The owner can remove any blurt or profile, and close any account, at any time and without notice, for example when it breaks these terms.

    ## Age

    You must be at least 13 years old to use blurt.trade.

    ## Your password

    ${noPasswordReset}

    ## No warranty

    blurt.trade is a hobby project, provided as it is, with no warranty of any kind. It may be down, lose data, change or shut down. As far as the law allows, the owner isn't liable for any loss from using it.

    ## Changes

    These terms may change; this page always has the current version. Questions: ${privateContact(contact)}.
  `
}

export function privacyMarkdown({ contact, inviteOnly }: InfoPageData): Markdown {
  return md`
    # Privacy

    ${home}

    blurt.trade collects as little as it can. No email address, no real name, no phone number. No analytics, no ads, no tracking, and nothing loaded from other sites.

    ## Who is responsible

    Lars-Erik Bruce is responsible for the site and its data (the controller under the GDPR). To reach him: ${privateContact(contact)}.

    blurt.trade runs on a server owned and operated by a private individual in Norway, who hosts it on Lars-Erik's behalf and has access to it only to keep it running.

    ## What is stored

    For each account:

    - Your username, a hash of your password (Argon2id: the password itself is never stored), and when you signed up.
    - The profile fields you fill in: bio, homepage and social links, your avatar's settings, the colour theme, time zone and share card colour you picked, and whether you turned JavaScript off.
    - Only if you set it: a coarse location, ${gridDescription}. Only you see it, but it puts your blurts in "Near you" for people nearby.
    - Your blurts and replies, with when you posted them, and for each one an embedding: numbers describing what it's about, for related blurts and "You might like". It's computed on our own server; your text isn't sent anywhere.
    - If you attach one, a blurt's picture: only a rough drawing of it, made on our own server. The photo you upload is never stored.
    - If you upload one, your profile picture: likewise only a rough drawing, and where you clicked for its mouth. It's public, like the avatar.
    - Who you follow.
    - Your notifications: a row per reply, reblurt, quote or (if you switched it on) new blurt from someone you follow, with who did it, which blurt and when, and whether you've read it. Read ones are deleted after 90 days. Which kinds you want is stored with your profile. Only you see them.
    - Blurts you like, and when. Only the number of likes on a blurt is public: nobody else sees who liked it.
    - Blurts you reblurt, and when. Reblurts are public: they show on your profile and in your followers' feeds. A quote is a blurt of your own, with the quoted blurt under it.
    ${
      inviteOnly &&
      md`
- Your invite codes, and who signed up with them. Who invited you shows on your profile.
      `
    }
    - Blurts you report, with your reason and when.
    - Your sessions: one record per login, with when it started and was last used. No IP address and no browser details.

    The waitlist stores only the username you'd like, whether you've signed up since, and when you joined it.

    For deleted accounts, only the username is kept, in lower case and with nothing else, so it can't be taken again.

    Public: your username, profile, avatar, blurts, reblurts, follower, like and reblurt counts, and who invited you. Everything else is private, though admins see who reported what.

    ## What is not stored

    - No email address. So we can't contact you, and there's **no password reset**: a lost password can't be recovered, and neither can the account.
    - No IP addresses in the database or in the app's logs. Rate limiting counts requests per IP address in memory only, until the limit has refilled (an hour at most), and never writes them down. The web server's access log keeps addresses shortened (the last part dropped) for at most 14 days, to spot abuse.
    - The app's logs hold what was asked for and how it went (method, path, status, time), never what you posted, your password or your cookies.

    ## Cookies

    Up to four, all strictly necessary for things you ask the site to do, none for tracking or analytics, so there's no cookie banner. Visitors who aren't logged in get none, unless they turn JavaScript off. All four are HttpOnly, Secure and SameSite=Lax, and only sent to blurt.trade.

    The site works fully without JavaScript. Its JavaScript is optional (${link('you can turn it off', javascriptSettingPath(pageContext().viewer !== null))}), comes only from blurt.trade, and stores nothing in your browser: no local storage, no other cookies.

    | Cookie | What it's for | Lasts |
    | --- | --- | --- |
    | ${code('__Host-access_token')} | Shows you're logged in, with your colour theme, time zone, language and whether JavaScript is on | 5 minutes |
    | ${code('__Host-refresh_token')} | Keeps you logged in and renews the one above | Until you close the browser, or, if you ticked *Keep me logged in*, 400 days without a visit. Gone when you log out. |
    | ${code('recent_write')} | After you post or change something, makes sure you see your own change straight away | 10 seconds |
    | ${code('javascript')} | Only once you turn JavaScript off: remembers that in this browser. Logged in, it's saved on your account too, and the account's setting counts | 400 days, or until you turn JavaScript back on |

    ## Why we may use your data

    - Your account, posts, follows, likes and the rest, to provide the service you signed up for (contract, GDPR Art. 6(1)(b)).
    - The optional coarse location, because you chose to set it (consent, Art. 6(1)(a)). Clear it to withdraw.
    - Rate limiting and the web server's access log, to protect the site from abuse (legitimate interests, Art. 6(1)(f)).

    ## Backups

    There are no backups. If the server's disk fails, the data is gone, and deleting your account removes it everywhere.

    ## Deleting your account

    ${link('Settings', '/settings')} has "Delete my account", which asks for your password. It deletes at once, in one go, everything above that belongs to the account: your profile, avatar and location, the text of your blurts and their embeddings, your reblurts, who you follow and who follows you, your likes (and the likes on your blurts), your notifications, ${inviteOnly ? 'your invite codes, ' : ''}your reports, your sessions and your waitlist entry. You're logged out everywhere.

    What stays: an empty record of the account, with no username, password or profile, and an empty row for each of your blurts, with no text, which shows nowhere and names nobody. A blurt someone replied to shows as an empty placeholder, with no text and no author, so the thread still reads. ${inviteOnly ? 'The invite code you signed up with stays marked as used, with nothing linking it to you. ' : ''}Your username goes on the list of retired names, with nothing else, so nobody can sign up as you later. The count of sign-ups so far doesn't go down.

    ## Your rights

    You can ask what is stored about you, and have it corrected, deleted or handed to you in a form you can reuse (data portability), and you can object to how it is used: ${privateContact(contact)}. You can also complain to the Norwegian Data Protection Authority, ${link('Datatilsynet', 'https://www.datatilsynet.no')}.
  `
}
