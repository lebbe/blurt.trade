import { Router } from 'express'
import { publicUrl } from '../config.ts'

export const crawlRouter = Router()

const robotsDisallow = ['/login', '/createUser', '/settings', '/api/']

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
