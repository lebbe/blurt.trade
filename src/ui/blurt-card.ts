import { AvatarView } from './avatar.ts'
import { renderBlurtText } from './blurt-text.ts'
import type { Viewer } from './context.ts'
import { usePageContext } from './context.ts'
import { ValidationError } from './forms.ts'
import { html } from './html.ts'
import { Icon, type IconName } from './icons.ts'
import { plural, preview } from './text.ts'
import { blurtAnchor, blurtUrl, deleteBlurtPath, parentUrl, quoteUrl } from './urls.ts'
import { reportReasonMaxLength } from '../shared/limits.ts'
import { shareTitleMax } from '../shared/share.ts'
import { formatTimestamp } from '../shared/time-zones.ts'
import type { Blurt, QuotedBlurt } from '../routes/state/blurts.ts'

// A blurt as a card, the same in every list: who said it and when, what they said (with
// its picture and the blurt it quotes), and what the viewer can do about it.

// Logged-in viewers can plain-reblurt anyone's blurt but their own (quoting is fine), and
// undo a reblurt they made. Placeholders take neither.
export function reblurtAction(viewer: Viewer, blurt: Blurt): 'reblurt' | 'unreblurt' | null {
  if (!viewer || blurt.deleted) {
    return null
  }
  if (blurt.viewerReblurted) {
    return 'unreblurt'
  }
  return viewer.username === blurt.username ? null : 'reblurt'
}

// Who may do what to a blurt, in every view: its author deletes it, anyone else logged in
// can report it. Placeholders take neither.
export function blurtActions(viewer: Viewer, blurt: Blurt): 'delete' | 'report' | null {
  if (!viewer || blurt.deleted) {
    return null
  }
  return viewer.username === blurt.username ? 'delete' : 'report'
}

// The count for everyone; logged-in viewers get it as a Like / Unlike button.
export function Likes({ blurt, viewer }: { blurt: Blurt; viewer: Viewer }) {
  const countLabel = blurt.likeCount === 1 ? 'like' : 'likes'
  if (!viewer) {
    return html`<span class="action-count"
      ><${Icon} name="heart" /><span class="like-count"
        >${blurt.likeCount} <span class="count-label">${countLabel}</span></span
      ></span
    >`
  }
  return html`
    <form method="post" action=${blurt.viewerLikes ? '/api/unlike' : '/api/like'} class="like-form">
      <input type="hidden" name="blurtId" value=${blurt.id} />
      <button
        type="submit"
        class="action"
        aria-label=${blurt.viewerLikes ? 'Unlike' : 'Like'}
        title=${blurt.viewerLikes ? 'Unlike' : 'Like'}
        aria-pressed=${blurt.viewerLikes ? 'true' : 'false'}
      >
        <${Icon} name="heart" /><span>${blurt.viewerLikes ? 'Unlike' : 'Like'}</span>
      </button>
      <span class="like-count"
        >${blurt.likeCount} <span class="count-label">${countLabel}</span></span
      >
    </form>
  `
}

// The count for everyone; a Reblurt / Undo reblurt button where reblurtAction allows one.
// Quoting is a link to the quote form on the blurt's page.
export function Reblurts({ blurt, viewer }: { blurt: Blurt; viewer: Viewer }) {
  const countLabel = blurt.reblurtCount === 1 ? 'reblurt' : 'reblurts'
  const count = html`<span class="like-count"
    >${blurt.reblurtCount} <span class="count-label">${countLabel}</span></span
  >`
  const action = reblurtAction(viewer, blurt)
  const quote =
    viewer &&
    html`<a href=${quoteUrl(blurt)} class="action" aria-label="Quote" title="Quote"
      ><${Icon} name="quote" /><span>Quote</span></a
    >`
  if (!action) {
    return html`<span class="action-count"><${Icon} name="reblurt" />${count}</span> ${quote}`
  }
  return html`
    <form method="post" action="/api/${action}" class="like-form">
      <input type="hidden" name="blurtId" value=${blurt.id} />
      <button
        type="submit"
        class="action"
        aria-label=${action === 'unreblurt' ? 'Undo reblurt' : 'Reblurt'}
        title=${action === 'unreblurt' ? 'Undo reblurt' : 'Reblurt'}
        aria-pressed=${action === 'unreblurt' ? 'true' : 'false'}
      >
        <${Icon} name="reblurt" /><span
          >${action === 'unreblurt' ? 'Undo reblurt' : 'Reblurt'}</span
        >
      </button>
      ${count}
    </form>
    ${quote}
  `
}

// In the viewer's time zone (UTC until they pick one) and the clock their browser's
// language uses. `datetime` stays UTC.
export function Timestamp({ date }: { date: Date }) {
  const { timeZone, locale } = usePageContext()
  return html`<time datetime=${date.toISOString()}
    >${formatTimestamp(date, timeZone, locale)}</time
  >`
}

// The blurt a quote quotes, under its text: one level, so a quote in it shows only its own
// text. A deleted one says so, and nothing else.
export function QuotedCard({ quoted }: { quoted: QuotedBlurt }) {
  if (quoted.deleted) {
    return html`<blockquote class="quoted"><p class="empty">Content is deleted.</p></blockquote>`
  }
  return html`
    <blockquote class="quoted">
      <div class="blurt-meta">
        <strong><a href="/${quoted.username}/">${quoted.username}</a></strong>
        <a href=${blurtUrl(quoted)}><${Timestamp} date=${quoted.createdAt} /></a>
      </div>
      <p>${renderBlurtText(quoted.text ?? '')}</p>
    </blockquote>
  `
}

export function ReplyingTo({ blurt }: { blurt: Blurt }) {
  const url = parentUrl(blurt)
  return (
    url &&
    html`<p class="replying-to">
      Replying to <a href=${url}>${blurt.parentUsername ?? 'a deleted blurt'}</a>
    </p>`
  )
}

// Two clicks, no JS: the <details> opens the form, its button deletes for good.
export function DeleteForm({ blurt }: { blurt: Blurt }) {
  return html`
    <details class="blurt-action">
      <summary aria-label="Delete" title="Delete">
        <${Icon} name="trash" /><span>Delete</span>
      </summary>
      <form method="post" action=${deleteBlurtPath(blurt)} class="inline-form">
        <span>Delete this blurt for good?</span>
        <button type="submit" class="danger">Delete</button>
      </form>
    </details>
  `
}

export function ReportForm({ blurt, error }: { blurt: Blurt; error?: string }) {
  return html`
    <details class="blurt-action" open=${Boolean(error)}>
      <summary aria-label="Report" title="Report">
        <${Icon} name="flag" /><span>Report</span>
      </summary>
      <form method="post" action="/api/report" class="inline-form">
        <${ValidationError} message=${error} />
        <input type="hidden" name="blurtId" value=${blurt.id} />
        <label>Reason (optional) <input name="reason" maxlength=${reportReasonMaxLength} /></label>
        <button type="submit" class="danger">Report</button>
      </form>
    </details>
  `
}

// What a card says instead of the Report form once the viewer has reported the blurt.
export function ReportedNote() {
  return html`<span class="empty">You reported this blurt.</span>`
}

// Share. Without JavaScript a link: to the blurt's page, or on that page to its share card
// image. With it (src/client/share.ts) the browser's own share sheet on phones, else a
// popup of share links (src/ui/share.ts), for the blurt's page with its text as the
// title. The card image goes along for Pinterest, where it is known.
function ShareAction({ blurt, sharePath }: { blurt: Blurt; sharePath?: string }) {
  const title = preview(blurt.text ?? '', shareTitleMax) || `${blurt.username} blurted`
  return html`<a
    href=${sharePath ?? blurtUrl(blurt)}
    class="action"
    aria-label="Share"
    title="Share"
    data-enhance="share"
    data-share-url=${blurtUrl(blurt)}
    data-share-title=${title}
    data-share-picture=${blurt.picture ? '' : undefined}
    data-share-media=${blurt.picture && sharePath ? sharePath : undefined}
    ><${Icon} name="share" /><span>Share</span></a
  >`
}

// `replies` are shown inline (the feed); the link below covers the rest of the thread.
// `viewer` decides the Delete / Report actions; `reported` says the viewer already did.
// `inThread`: shown under (or as) the blurt it replies to, so "Replying to" is left out.
// A plain reblurt in a list is its original with "Reblurted by" on top; every button acts
// on the original.
export function BlurtCard({
  blurt,
  viewer = null,
  replies = [],
  showActions = true,
  inThread = false,
  reported = false,
  reportError,
  sharePath,
}: {
  blurt: Blurt
  viewer?: Viewer
  replies?: Blurt[]
  showActions?: boolean
  inThread?: boolean
  reported?: boolean
  reportError?: string
  // What Share opens: the blurt's page, or on the blurt's own page its card image.
  sharePath?: string
}) {
  const hiddenReplies = blurt.replyCount - replies.length
  const threadLink =
    hiddenReplies <= 0
      ? blurt.deleted
        ? 'Thread'
        : 'Reply'
      : replies.length > 0
        ? plural(hiddenReplies, 'more reply', 'more replies')
        : plural(hiddenReplies, 'reply', 'replies')
  const threadIcon: IconName = hiddenReplies <= 0 && !blurt.deleted ? 'reply' : 'thread'
  const action = blurtActions(viewer, blurt)
  const replyCards =
    replies.length > 0 &&
    html`<div class="replies">
      ${replies.map((reply) => html`<${BlurtCard} blurt=${reply} viewer=${viewer} inThread />`)}
    </div>`

  if (blurt.deleted) {
    return html`
      <article class="blurt deleted">
        <div class="blurt-main">
          <div class="blurt-body">
            <div class="blurt-meta">
              <em>Deleted</em>
              <a href=${blurtUrl(blurt)}><${Timestamp} date=${blurt.createdAt} /></a>
            </div>
            <p class="empty">This blurt was deleted.</p>
          </div>
        </div>
        ${
          (showActions || replyCards) &&
          html`<div class="blurt-footer">
            ${
              showActions &&
              html`<div class="blurt-actions">
                <a
                  href=${blurtUrl(blurt)}
                  class="action"
                  aria-label=${threadLink}
                  title=${threadLink}
                  ><${Icon} name=${threadIcon} /><span>${threadLink}</span></a
                >
              </div>`
            }
            ${replyCards}
          </div>`
        }
      </article>
    `
  }

  // With JavaScript, the viewer's buttons on it (like, reblurt, delete, report) work
  // without a page load: src/client/blurt-actions.ts. Nothing to do for anonymous viewers.
  //
  // Two boxes. .blurt-main is what was said: avatar, nick, date, text and the picture (which
  // runs the full width of the card). .blurt-footer is what you can do about it: actions
  // and replies. The avatar sits on the left of odd blurts and the right of even ones (CSS).
  return html`
    <article
      class=${blurt.reblurtedBy ? 'blurt reblurt' : 'blurt'}
      id=${blurtAnchor(blurt)}
      data-enhance=${viewer ? 'blurt-actions' : undefined}
    >
      <div class="blurt-main">
        <${AvatarView} avatar=${blurt.avatar} />
        <div class="blurt-body">
          ${
            blurt.reblurtedBy &&
            html`<p class="reblurted-by">
              Reblurted by <a href="/${blurt.reblurtedBy}/">${blurt.reblurtedBy}</a>
            </p>`
          }
          ${!inThread && html`<${ReplyingTo} blurt=${blurt} />`}
          <div class="blurt-meta">
            <strong><a href="/${blurt.username}/">${blurt.username}</a></strong>
            <a href=${blurtUrl(blurt)}><${Timestamp} date=${blurt.createdAt} /></a>
          </div>
          <p>${renderBlurtText(blurt.text ?? '')}</p>
          ${blurt.quoted && html`<${QuotedCard} quoted=${blurt.quoted} />`}
        </div>
        ${
          blurt.picture &&
          html`<img
            class="blurt-picture"
            src="/pictures/${blurt.id}.svg"
            width=${blurt.picture.width}
            height=${blurt.picture.height}
            alt="Picture"
            loading="lazy"
          />`
        }
      </div>
      <div class="blurt-footer">
        <div class="blurt-actions">
          ${
            showActions &&
            html`<a
              href=${blurtUrl(blurt)}
              class="action"
              aria-label=${threadLink}
              title=${threadLink}
              ><${Icon} name=${threadIcon} /><span>${threadLink}</span></a
            >`
          }
          <${Likes} blurt=${blurt} viewer=${viewer} />
          <${Reblurts} blurt=${blurt} viewer=${viewer} />
          <${ShareAction} blurt=${blurt} sharePath=${sharePath} />
          ${action === 'delete' && html`<${DeleteForm} blurt=${blurt} />`}
          ${
            action === 'report' &&
            (reported
              ? html`<${ReportedNote} />`
              : html`<${ReportForm} blurt=${blurt} error=${reportError} />`)
          }
        </div>
        ${replyCards}
      </div>
    </article>
  `
}
