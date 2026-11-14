import type { NearData } from './data.ts'
import { blurtMarkdown, home } from '../shared/blurts.md.ts'
import { code, join, link, type Markdown, md } from '../shared/markdown.ts'
import { formatLocation } from '../../shared/geo.ts'
import { nearPageUrl } from '../../ui/urls.ts'

// Blurts near you (/near) as Markdown: the same data as the HTML, for text/markdown and
// text/plain clients (curl, LLMs, terminals). Forms are described instead of rendered.

export function nearMarkdown({ location, radius, radii, blurts, next }: NearData): Markdown {
  return md`
    # Blurts near you

    ${home}

    ${
      location
        ? md`
            From people within ${radius} km of ${formatLocation(location)}. Other radii: ${join(
              radii.filter((km) => km !== radius).map((km) => link(`${km} km`, nearPageUrl(km))),
              ', ',
            )}.

            ${blurts.length > 0 ? blurts.map((blurt) => blurtMarkdown(blurt, blurt.replies)) : 'Nobody near you has blurted yet.'}

            ${next && link('Older blurts', nearPageUrl(radius, next))}
          `
        : md`You haven't set a location. Send ${code('POST /api/location')} with ${code('lat')} and ${code('lon')} first.`
    }
  `
}
