import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Express } from 'express'

// The browser build of Preact: preact-hook-signal-htm-bundle, one ES module with Preact,
// preact/hooks, @preact/signals and `html` (htm bound to h), no imports of its own.
//
// We serve it ourselves, from node_modules, rather than from a CDN: the CSP only allows
// 'self', and the privacy page promises no third parties. It is a runtime dependency so
// `npm ci --omit=dev` in the Dockerfile installs it.
//
// The URL carries the installed package's version, read from its package.json, so it
// changes whenever the package does and the file can be cached for a year as immutable.
// Any other version, or no version, is not served (404).
//
// One Preact, not two: the bundle has its own copy of Preact compiled in (rollup
// nodeResolve), so in the browser it IS Preact. Shared modules (src/ui, src/shared) that
// import 'preact', 'preact/hooks', 'htm' or '@preact/signals' must resolve to this same
// file through the import map; loading node_modules/preact as well would give two
// Preact instances, and hooks and context only work within one. That is also why its
// Preact major must match ours (test/vendor.test.ts): the server renders with
// node_modules/preact, the browser hydrates with the bundle's.

const require = createRequire(import.meta.url)
const packageDir = dirname(require.resolve('preact-hook-signal-htm-bundle/package.json'))

export const preactBundleVersion: string = JSON.parse(
  readFileSync(join(packageDir, 'package.json'), 'utf8'),
).version

export const preactBundleFile = join(packageDir, 'dist', 'preact-bundle.js')

// For the import map: 'preact', 'preact/hooks', '@preact/signals' and the browser's
// html.ts all point here.
export const preactBundleUrl = `/static/vendor/preact-bundle@${preactBundleVersion}.js`

const oneYear = 365 * 24 * 60 * 60 * 1000

export function serveVendorFiles(app: Express): void {
  app.get(preactBundleUrl, (_request, response, next) => {
    response.sendFile(
      preactBundleFile,
      {
        maxAge: oneYear,
        immutable: true, // with maxAge: Cache-Control: public, max-age=31536000, immutable
        headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
      },
      // A client that hangs up mid-file is not our error.
      (error) => {
        if (error && !response.headersSent) next(error)
      },
    )
  })
}
