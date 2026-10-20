import type { NextFunction, Request, Response } from 'express'
import { criticalCssHashes } from '../themes.ts'

// Security headers on every response: pages, errors, JSON, Markdown and static files.
// Set by hand rather than with helmet: it is a handful of fixed strings.
//
// The pages use no JavaScript at all, so the Content-Security-Policy has no script-src
// and default-src 'none' blocks every script. CSS comes only from our own stylesheets
// plus, by hash, the small above-the-fold <style> of each theme (criticalCss in
// src/themes.ts); no other inline <style> or style="..." runs. Images only from us (the
// world map; avatars are inline SVG markup, which no policy restricts). Adding any
// script, inline style, font, fetch() or third-party resource means changing this policy
// (see docs/routes.md).
export const contentSecurityPolicy = [
  "default-src 'none'",
  `style-src 'self' ${criticalCssHashes.join(' ')}`,
  "img-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ')

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
