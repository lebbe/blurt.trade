import type { NextFunction, Request, Response } from 'express'
import { importMapHash } from '../client-modules.ts'
import { criticalCssHashes } from '../themes.ts'

// Security headers on every response: pages, errors, JSON, Markdown and static files.
// Set by hand rather than with helmet: it is a handful of fixed strings.
//
// Two Content-Security-Policies, picked per response. Every response starts with
// `contentSecurityPolicy`, which has no script-src at all, so default-src 'none' blocks
// every script. That is what static files, pages for visitors who turned JavaScript off
// (src/javascript.ts) and anything answered before the page context is known get. Once
// the page-context middleware (src/server.ts) knows JavaScript is on for this request,
// allowScripts() swaps in `scriptingContentSecurityPolicy`, the same policy plus
//
//   script-src 'self' 'sha256-<import map>'
//
// (and blob: images and worker-src 'self', below)
// so the only scripts that can run are our own modules (/static/js/…, src/client-modules.ts,
// and the Preact bundle under /static/vendor/) and the page's one inline script, the
// import map, by its hash (computed at startup; it only changes with the build). No
// 'unsafe-inline', no 'unsafe-eval', no other origin. The page context JSON is a
// <script type="application/json">, a data block that never runs, so it needs nothing.
// Pages render their scripts from the same page-context flag, so a page never carries
// scripts its policy blocks, nor the other way around.
//
// CSS comes only from our own stylesheets plus, by hash, the small above-the-fold <style>
// of each theme (criticalCss in src/themes.ts); no other inline <style> or style="..."
// runs. Images only from us (the world map; avatars are inline SVG markup, which no
// policy restricts), and the manifest. Adding an inline script, inline style, font, worker or
// third-party resource means changing this policy (see docs/routes.md).
//
// connect-src 'self' is for our scripts' fetch() calls (src/client/requests.ts), and for
// tools that fetch from the page's context, like Lighthouse reading /robots.txt, which
// default-src 'none' would block.
//
// Speculation rules (src/speculation.ts) need nothing here. They come from the
// Speculation-Rules response header, fetched with the "speculationrules" destination,
// which no CSP fetch directive governs, so default-src 'none' doesn't block it (checked in
// Chromium). Only inline <script type="speculationrules"> would need script-src (with
// 'inline-speculation-rules' or a hash), and the header exists to avoid that. The
// prefetches themselves are navigation requests, outside connect-src and default-src.
// Cross-document View Transitions are plain CSS.
const basePolicy = [
  "default-src 'none'",
  "connect-src 'self'",
  `style-src 'self' ${criticalCssHashes.join(' ')}`,
  "img-src 'self'",
  // The web app manifest (/manifest.webmanifest), for Add to Home Screen.
  "manifest-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
]

export const contentSecurityPolicy = basePolicy.join('; ')

// With scripts, images may also be blob: URLs. Only a script on the page can make one
// (URL.createObjectURL), from data it already has: the drawing of a picture about to be
// uploaded, made in the browser (src/client/composer.ts, picture-upload.ts). Never
// another origin. And workers, from our own modules only: the one that draws those
// pictures (src/client/picture-worker.ts), and the service worker for push notifications
// (/sw.js, src/client/sw.ts). Each runs under the policy its script is served with
// (moduleContentSecurityPolicy in src/client-modules.ts, serviceWorkerContentSecurityPolicy
// in src/routes/push.ts). connect-src 'self' also covers the live-update stream
// (EventSource, /api/events).
export const scriptingContentSecurityPolicy = [
  ...basePolicy.map((directive) =>
    directive === "img-src 'self'" ? "img-src 'self' blob:" : directive,
  ),
  `script-src 'self' ${importMapHash}`,
  "worker-src 'self'",
].join('; ')

// For a response whose page may run our scripts (JavaScript on for this visitor).
export function allowScripts(response: Response): void {
  response.set('Content-Security-Policy', scriptingContentSecurityPolicy)
}

// Two years, the value hstspreload.org asks for. Only in production: on localhost over
// plain HTTP it would be ignored anyway, and on a dev hostname it would stick for years.
export const strictTransportSecurity = 'max-age=63072000; includeSubDomains'

// Nothing here needs any of these powerful features; deny them to us and any frame.
export const permissionsPolicy = [
  'accelerometer=()',
  'camera=()',
  'geolocation=()',
  'gyroscope=()',
  'magnetometer=()',
  'microphone=()',
  'payment=()',
  'usb=()',
  'browsing-topics=()',
].join(', ')

const production = process.env.NODE_ENV === 'production'

export function securityHeaders(_request: Request, response: Response, next: NextFunction): void {
  response.set({
    'Content-Security-Policy': contentSecurityPolicy,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': permissionsPolicy,
    // For browsers older than frame-ancestors.
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  })
  if (production) {
    response.set('Strict-Transport-Security', strictTransportSecurity)
  }
  next()
}
