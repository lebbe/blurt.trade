import type { Request, Response } from 'express'

// Speculation Rules: Chromium prefetches a page when the pointer rests on a link to it
// (eagerness "moderate"), so clicking it is nearly instant. No JavaScript: the rules are
// a static JSON file, public/speculation-rules.json, named by the Speculation-Rules
// header on every HTML page. Browsers without support ignore the header.
//
// Prefetch only, no prerender: a prefetched page is just a response held in memory, while
// prerendering also loads its stylesheets and images, for little gain on pages this light.
// The rules leave out what a GET should not be fetched for on hover: /api/* (POST only
// anyway), /logout, the rate-limited and heavier pages (/search, /near), admin pages, and
// files that are not pages. Same-origin links only ("/*").
//
// A few GETs change something. Those refuse a prefetch (see refuseSpeculation), and the
// click then loads the page as a normal navigation, so nothing behaves differently:
// - visiting a blurt reads the viewer's notifications about it (src/routes/blurts.ts);
// - a request whose access token has run out rotates the refresh token (src/middleware/
//   auth.ts). Chromium does keep the cookies a prefetch sets, but a prefetch cut off on
//   the way loses the new token, and the old one coming back later revokes the session.
//
// Prefetched pages are only used by the page that fetched them, and only for a few
// minutes, so a stale page can't outlive the next form POST.
export const speculationRulesPath = '/static/speculation-rules.json'
export const speculationRulesType = 'application/speculationrules+json'

// A structured-field list of strings (RFC 8941), so the URL is quoted.
export function setSpeculationRules(response: Response): void {
  response.set('Speculation-Rules', `"${speculationRulesPath}"`)
}

// Chromium sends `Sec-Purpose: prefetch` (or `prefetch;prerender`) with speculative
// requests. A structured-field list; the token is what counts.
export function isSpeculative(request: Request): boolean {
  return /(^|,)\s*prefetch(\s*(;|,|$))/.test(request.get('sec-purpose') ?? '')
}

// Any status other than 2xx makes the browser drop the prefetch and load the page for
// real when the link is clicked. 503 says "not now"; the request logger doesn't count it
// as a server error (src/logging.ts).
export function refuseSpeculation(response: Response): void {
  response.locals.speculationRefused = true
  response.status(503).set('Cache-Control', 'no-store').type('text').send('Not prefetched')
}
