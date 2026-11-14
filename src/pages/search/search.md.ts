import type { SearchData } from './data.ts'
import { blurtMarkdown, home } from '../shared/blurts.md.ts'
import { code, link, type Markdown, md } from '../shared/markdown.ts'
import { searchUrl } from '../../ui/urls.ts'

// Search (/search) as Markdown: the same data as the HTML, for text/markdown and text/plain
// clients (curl, LLMs, terminals). Forms are described instead of rendered.

export function searchMarkdown({ query, users, blurts, next }: SearchData): Markdown {
  return md`
    # Search

    ${home}

    Search usernames and blurts with ${code('GET /search?q=<words>')}.

    ${
      query === ''
        ? 'Nothing searched for yet.'
        : md`
            Results for ${code(query)}

            ${
              users.length > 0 &&
              md`
                ## People

                ${users.map((user) => md`- ${link(user.username, `/${user.username}/`)}`)}
              `
            }

            ## Blurts

            ${blurts.length > 0 ? blurts.map((blurt) => blurtMarkdown(blurt)) : 'No blurts match.'}

            ${next && link('Older blurts', searchUrl(query, next))}
          `
    }
  `
}
