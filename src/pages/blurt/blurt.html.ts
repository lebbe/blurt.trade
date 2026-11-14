import { h } from 'preact'
import type { CardColorId } from '../../card-colors.ts'
import { blurtOgInput, ogHash, ogImagePath } from '../../og.ts'
import type { BlurtPageData } from './data.ts'
import { AnonymousActions, NextPageLink } from '../shared/components.ts'
import { Composer, type ComposerProps } from '../shared/composer.ts'
import { Page, type PageMeta, renderDocument } from '../shared/layout.ts'
import type { Blurt } from '../../routes/state/blurts.ts'
import { BlurtCard } from '../../ui/blurt-card.ts'
import { html } from '../../ui/html.ts'
import { preview } from '../../ui/text.ts'
import { blurtUrl, moreRepliesUrl } from '../../ui/urls.ts'

// Related blurts, in the thread page's aside: just enough to pick one.
function RelatedList({ blurts }: { blurts: Blurt[] }) {
  return html`
    <ul class="related">
      ${blurts.map(
        (blurt) => html`
          <li>
            <a href=${blurtUrl(blurt)}
              >${blurt.deleted ? 'A deleted blurt' : preview(blurt.text ?? '', 90)}</a
            >
            ${blurt.username && html`<span class="tiny"> · ${blurt.username}</span>`}
          </li>
        `,
      )}
    </ul>
  `
}

type BlurtPageProps = BlurtPageData & { composer?: ComposerProps; reportError?: string }

function BlurtPage({
  viewer,
  blurt,
  parent,
  reported,
  replies,
  next,
  related,
  composer,
  reportError,
  cardColor = null,
}: BlurtPageProps) {
  const cardPath = blurtCardPath(blurt, cardColor)
  const quoting = composer?.reblurtOfId !== undefined
  const aside = html`
    ${
      viewer &&
      !blurt.deleted &&
      html`<${Composer}
        ...${quoting ? composer : {}}
        id="quote"
        reblurtOfId=${blurt.id}
        heading="Quote"
        label="Your take, with this blurt under it"
        placeholder="Your take, with this blurt under it"
        button="Quote it"
      />`
    }
    <section class="panel" aria-label="Related blurts">
      <h3>Related blurts</h3>
      ${
        related.length > 0
          ? html`<${RelatedList} blurts=${related} />`
          : html`<p class="empty">Nothing related yet.</p>`
      }
    </section>
  `
  return html`
    <${Page}
      title=${blurt.username ?? 'Deleted blurt'}
      tagline="One blurt, its replies, and related chaos."
      aside=${aside}
    >
      ${
        parent &&
        html`<section class="panel" aria-label="In reply to">
          <h2>In reply to</h2>
          <${BlurtCard} blurt=${parent} viewer=${viewer} />
        </section>`
      }
      <section class="panel thread-main" aria-label="Blurt">
        <${BlurtCard}
          blurt=${blurt}
          viewer=${viewer}
          showActions=${false}
          inThread
          reported=${reported}
          reportError=${reportError}
          sharePath=${cardPath}
        />
      </section>
      ${
        blurt.deleted
          ? null
          : viewer
            ? html`<${Composer}
                ...${quoting ? {} : (composer ?? {})}
                parentId=${blurt.id}
                heading="Reply"
                label="Reply"
                placeholder="Reply to this blurt…"
                button="Reply"
              />`
            : html`<${AnonymousActions} heading="Reply" />`
      }
      <section class="panel" aria-label="Replies">
        <h2>Replies</h2>
        <div class="thread-children">
          ${
            replies.length > 0
              ? replies.map(
                  (reply) => html`<${BlurtCard} blurt=${reply} viewer=${viewer} inThread />`,
                )
              : html`<p class="empty">No replies yet.</p>`
          }
        </div>
        ${next && html`<${NextPageLink} href=${moreRepliesUrl(blurt, next)} label="More replies" />`}
      </section>
    <//>
  `
}

function blurtCardPath(blurt: Blurt, cardColor: CardColorId | null): string | undefined {
  return blurt.deleted || blurt.username === null || blurt.text === null
    ? undefined
    : ogImagePath(
        blurt.id,
        ogHash(
          blurtOgInput(
            {
              text: blurt.text,
              username: blurt.username,
              avatar: blurt.avatar,
              picture: blurt.picture,
            },
            cardColor,
          ),
        ),
        Boolean(blurt.picture),
      )
}

function blurtPageMeta({ blurt, cardColor = null }: BlurtPageData): PageMeta {
  const canonical = blurtUrl(blurt)
  const deleted = blurt.deleted || blurt.username === null
  const description = deleted ? 'This blurt was deleted.' : blurt.text!
  const username = blurt.username ?? 'deleted'
  const title = deleted ? 'Deleted blurt' : `${username} blurted`
  const image = deleted ? undefined : blurtCardPath(blurt, cardColor)
  return {
    title,
    description,
    canonical,
    author: deleted ? undefined : username,
    share: deleted
      ? { type: 'article', title, description }
      : {
          type: 'article',
          title,
          description,
          image,
          imageAlt: `${username}: ${description}`,
          imageType: blurt.picture ? 'image/jpeg' : 'image/png',
          publishedTime: blurt.createdAt.toISOString(),
          themeColor: blurt.text === 'BLURT' ? '#d4001c' : '#11152c',
        },
  }
}

export function renderBlurtPage(
  data: BlurtPageData,
  composer?: ComposerProps,
  reportError?: string,
): string {
  return renderDocument(h(BlurtPage, { ...data, composer, reportError }), blurtPageMeta(data))
}
