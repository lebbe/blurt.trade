import { type FeedData, feedPath } from './data.ts'
import { blurtMarkdown, viewerLine } from '../shared/blurts.md.ts'
import { link, type Markdown, md } from '../shared/markdown.ts'
import { discoveryAfter, type DiscoverySection, discoveryTitles } from '../../ui/discovery.ts'
import { olderBlurtsUrl } from '../../ui/urls.ts'

// The feed pages (/ and /everyone) as Markdown: the same data as the HTML, for
// text/markdown and text/plain clients (curl, LLMs, terminals). Forms are described instead
// of rendered.

function discoveryMarkdown(section: DiscoverySection): Markdown {
  const { title, description } = discoveryTitles[section.kind]
  return md`
    ## ${title}

    ${description}

    ${section.blurts.map((blurt) => blurtMarkdown(blurt))}
  `
}

export function feedMarkdown(data: FeedData): Markdown {
  const { viewer, feed, hasFollowingFeed, followedBlurts, blurts, discovery, next } = data
  const discoverySections = (count: number) =>
    discoveryAfter(discovery, count).map(discoveryMarkdown)
  return md`
    # blurt.trade

    Say the thing. Regret it later.

    ${viewerLine(viewer)}

    ${
      hasFollowingFeed &&
      (feed === 'following'
        ? md`Following · ${link('Everyone', '/everyone')}`
        : md`${link('Following', '/')} · Everyone`)
    }

    ${
      followedBlurts.length > 0 &&
      md`
        ## From people you follow

        ${followedBlurts.map((blurt) => blurtMarkdown(blurt, blurt.replies))}
      `
    }

    ## ${feed === 'following' ? 'Following' : 'Feed'}

    ${
      blurts.length > 0
        ? blurts.map((blurt, index) => [
            blurtMarkdown(blurt, blurt.replies),
            discoverySections(index + 1),
          ])
        : feed === 'following'
          ? 'Nobody you follow has blurted yet.'
          : 'Nothing has been blurted yet.'
    }

    ${blurts.length === 0 && discoverySections(0)}

    ${next && link('Older blurts', olderBlurtsUrl(feedPath(data), next))}
  `
}
