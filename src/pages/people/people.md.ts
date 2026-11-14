import type { PeopleData } from './data.ts'
import { home } from '../shared/blurts.md.ts'
import { link, type Markdown, md } from '../shared/markdown.ts'
import { plural } from '../../ui/text.ts'
import { peoplePageUrl } from '../../ui/urls.ts'

// Everyone on the site (/people) as Markdown: the same data as the HTML, for text/markdown
// and text/plain clients (curl, LLMs, terminals). Forms are described instead of rendered.

export function peopleMarkdown({ people, next }: PeopleData): Markdown {
  return md`
    # People

    ${home}

    Everyone, alphabetically.

    ${people.map(
      (person) =>
        md`- ${link(person.username, `/${person.username}/`)}: ${plural(person.blurtCount, 'blurt')}, ${plural(person.followerCount, 'follower')}, joined ${person.joinedAt.toISOString().slice(0, 10)}${person.lastBlurtAt ? `, last blurt ${person.lastBlurtAt.toISOString().slice(0, 10)}` : ''}`,
    )}

    ${next && link('Next', peoplePageUrl(next))}
  `
}
