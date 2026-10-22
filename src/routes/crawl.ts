import { Router } from 'express'
import { publicUrl } from '../config.ts'
import { siteDescription, siteName } from '../templates/layout.ts'

export const crawlRouter = Router()

const robotsDisallow = ['/login', '/signup', '/settings', '/api/']

crawlRouter.get('/robots.txt', (_request, response) => {
  const lines = [
    'User-agent: *',
    'Allow: /',
    ...robotsDisallow.map((path) => `Disallow: ${path}`),
    `Sitemap: ${publicUrl()}/sitemap.xml`,
  ]
  response
    .type('text/plain')
    .set('Cache-Control', 'public, max-age=3600')
    .send(`${lines.join('\n')}\n`)
})

// https://llmstxt.org: an H1, a blockquote summary, prose, then H2 sections of link lists.
// Pages are negotiated on the Accept header (docs/routes.md), so the links are the
// ordinary URLs and the text says how to get Markdown.
crawlRouter.get('/llms.txt', (_request, response) => {
  const origin = publicUrl()
  const body = `# ${siteName}

> ${siteName} is a small social network for short public posts ("blurts", up to 280 characters), with replies, quotes, likes, follows and nearby discovery. Tagline: ${siteDescription}

Every page is available as Markdown from its normal URL: send \`Accept: text/markdown\` (or \`text/plain\`). \`Accept: application/json\` returns the data the page is rendered from. HTML pages announce the Markdown version in a \`Link: rel="alternate"\` header, and responses carry \`Vary: Accept\`. There are no separate \`.md\` URLs. Profiles live at \`/{username}/\` and single blurts at \`/{username}/{id}\`. Writing needs an account, so only reading is described here.

## Browse

- [Home](${origin}/): The newest blurts
- [Everyone](${origin}/everyone): Every blurt, newest first
- [People](${origin}/people): Everyone with an account, A to Z
- [Search](${origin}/search?q=example): Full-text search of usernames and blurts, with \`?q=\`

## About

- [About and contact](${origin}/about): What the site is and how to reach the people behind it
- [Terms](${origin}/terms): The rules of use
- [Privacy](${origin}/privacy): What the database stores

## Optional

- [Sitemap](${origin}/sitemap.xml): Public pages for crawlers
- [robots.txt](${origin}/robots.txt): Crawl rules
`
  response
    .type('text/markdown; charset=utf-8')
    .set('Cache-Control', 'public, max-age=3600')
    .send(body)
})

type SitemapEntry = { path: string; changefreq: 'always' | 'daily' | 'weekly' | 'monthly' }

const sitemapEntries: SitemapEntry[] = [
  { path: '/', changefreq: 'always' },
  { path: '/everyone', changefreq: 'always' },
  { path: '/about', changefreq: 'monthly' },
  { path: '/terms', changefreq: 'monthly' },
  { path: '/privacy', changefreq: 'monthly' },
]

crawlRouter.get('/sitemap.xml', (_request, response) => {
  const origin = publicUrl()
  const rows = sitemapEntries
    .map(
      ({ path, changefreq }) =>
        `<url><loc>${origin}${path}</loc><changefreq>${changefreq}</changefreq></url>`,
    )
    .join('')
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${rows}</urlset>`
  response.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(xml)
})
