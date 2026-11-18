import { h } from 'preact'
import { type FeedData, feedPath } from './data.ts'
import {
  AnonymousActions,
  ButtonLink,
  LinkPanel,
  NextPageLink,
  SupportLinks,
} from '../shared/components.ts'
import { Composer, type ComposerProps } from '../shared/composer.ts'
import { Page, type PageMeta, renderDocument, siteDescription } from '../shared/layout.ts'
import type { FeedItem } from '../../routes/state/blurts.ts'
import { blurtMaxLength } from '../../shared/limits.ts'
import { BlurtCard } from '../../ui/blurt-card.ts'
import { usePageContext, type Viewer } from '../../ui/context.ts'
import { Discovery, discoveryAfter } from '../../ui/discovery.ts'
import { html } from '../../ui/html.ts'
import { UnreadBadge } from '../../ui/notifications.ts'
import { notificationsPath, olderBlurtsUrl } from '../../ui/urls.ts'

function FeedTabs({ feed }: { feed: FeedData['feed'] }) {
  return html`
    <nav class="panel tabs" aria-label="Feeds">
      <a href="/" aria-current=${feed === 'following' ? 'page' : undefined}>Following</a>
      <a href="/everyone" aria-current=${feed === 'everyone' ? 'page' : undefined}>Everyone</a>
    </nav>
  `
}

// The feed pages' aside: shortcuts for logged-in viewers, the way in for everyone else.
function FeedAside({ viewer }: { viewer: Viewer }) {
  const { unreadNotifications } = usePageContext()
  if (!viewer) {
    return html`
      <section class="panel">
        <h2>What is this?</h2>
        <p>
          Short posts, blurts, of up to ${blurtMaxLength} characters. No ads, no tracking, no email
          address needed. Works fully without JavaScript, and you can${' '}
          <a href="/about#javascript">turn it off</a>.
        </p>
        <div class="actions">
          <${ButtonLink} href="/signup" icon="personPlus" label="Sign up" kind="" />
          <${ButtonLink} href="/login" icon="login" label="Log in" />
        </div>
      </section>
      <${SupportLinks} suggestions />
    `
  }
  return html`
    <${LinkPanel}
      title="Your corner"
      links=${[
        [`/${viewer.username}/`, 'Your profile'],
        [
          notificationsPath(viewer.username),
          unreadNotifications > 0
            ? html`Notifications <${UnreadBadge} unread=${unreadNotifications} />`
            : 'Notifications',
        ],
        [`/${viewer.username}/edit`, 'Edit profile, avatar and theme'],
        ['/near', 'Blurts near you'],
        ['/search', 'Search people and blurts'],
        ['/settings', 'Account settings'],
      ]}
    />
    <${SupportLinks} suggestions />
  `
}

function FeedPage(data: FeedData & { composer?: ComposerProps }) {
  const { viewer, feed, hasFollowingFeed, followedBlurts, blurts, discovery, next, composer } = data
  const cards = (items: FeedItem[]) =>
    items.map(
      (blurt) => html`<${BlurtCard} blurt=${blurt} viewer=${viewer} replies=${blurt.replies} />`,
    )
  const discoverySections = (count: number) =>
    discoveryAfter(discovery, count).map(
      (section) => html`<${Discovery} section=${section} viewer=${viewer} />`,
    )
  const everyonePage = feed === 'everyone' && hasFollowingFeed

  return html`
    <${Page}
      title=${everyonePage ? 'Everyone' : 'blurt.trade'}
      tagline=${everyonePage ? 'Every blurt, newest first.' : siteDescription}
      aside=${html`<${FeedAside} viewer=${viewer} />`}
    >
      ${viewer ? html`<${Composer} ...${composer ?? {}} />` : html`<${AnonymousActions} />`}
      ${hasFollowingFeed && html`<${FeedTabs} feed=${feed} />`}
      ${
        followedBlurts.length > 0 &&
        html`<section aria-label="From people you follow" class="panel followed">
          <h2>From people you follow</h2>
          ${cards(followedBlurts)}
        </section>`
      }
      <section
        aria-label="Blurts"
        class="panel"
        data-new-blurts="start"
        data-enhance=${viewer ? 'new-blurts' : undefined}
        data-feed=${viewer ? feed : undefined}
        data-feed-path=${viewer ? feedPath(data) : undefined}
      >
        <h2>${feed === 'following' ? 'Following' : 'Everyone'}</h2>
        ${
          blurts.length > 0
            ? blurts.map((blurt, index) => [cards([blurt]), discoverySections(index + 1)])
            : html`<p class="empty">
                ${
                  feed === 'following'
                    ? 'Nobody you follow has blurted yet.'
                    : 'Nothing has been blurted yet.'
                }
              </p>`
        }
        ${blurts.length === 0 && discoverySections(0)}
        ${
          next &&
          html`<${NextPageLink}
            href=${olderBlurtsUrl(feedPath(data), next)}
            label="Older blurts"
            list="feed"
          />`
        }
      </section>
    <//>
  `
}

function feedMeta(data: FeedData): PageMeta {
  const path = feedPath(data)
  return {
    title: data.feed === 'following' ? 'Following' : undefined,
    canonical: path,
  }
}

export function renderFeedPage(data: FeedData, composer?: ComposerProps): string {
  return renderDocument(h(FeedPage, { ...data, composer }), feedMeta(data))
}
