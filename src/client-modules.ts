import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { join } from 'node:path'
import type { Express, NextFunction, Request, Response } from 'express'
import { preactBundleUrl } from './vendor.ts'

// TypeScript for the browser, with no build step: the same files Node runs, with their
// types stripped by Node's own stripTypeScriptTypes() (node:module). Mode 'strip' replaces
// the types with spaces, so every line and column stays where it was in the source and the
// browser's devtools point at the right place without a source map.
//
// Only three folders are client code, and only they can be fetched:
//
//   src/ui      components shared with the server (they also render the pages)
//   src/shared  the data those components need (limits, time zones, themes, avatars)
//   src/client  browser-only code: main.ts, the enhancers, small helpers
//
// Everything else in src/ (routes, middleware, config, pages) never leaves the server.
// The modules are read once, at startup, from those folders only, and a request can only
// get one of them by its exact path: no file system lookup happens per request, so `..`,
// encoded slashes and the like have nothing to find. The path pattern below is a second
// lock in front of that.
//
// URLs carry a build hash, /static/js/<hash>/ui/blurt-card.ts, made from the contents of
// every client file, so any change gives every module a new URL and the browser can cache
// them for a year as immutable. Relative imports inside the modules ('./text.ts') resolve
// under the same prefix by themselves; nothing is rewritten. An old hash (a page loaded
// before a deploy) is a 404: main.ts catches the failed import and the page carries on
// without that enhancer, as it would with JavaScript off.
//
// Imports need no rewriting: browsers go by the Content-Type, not the file extension, so
// `import { x } from './x.ts'` works as it does in Node. Bare specifiers ('preact', 'htm',
// …) and src/ui/html.ts are pointed at the Preact bundle by the import map (importMap
// below), so the browser has exactly one Preact (src/vendor.ts).
//
// In development `npm run dev` restarts on any change under src/ (--watch-path), and the
// hash is recomputed at startup, so there is nothing else to invalidate.

const srcDir = import.meta.dirname

export const clientFolders = ['ui', 'shared', 'client'] as const

// Lower-case names with dashes, in one of the folders, ending in .ts. Anything else (a
// `..`, an encoded character, a backslash, a .d.ts, a query string) can't match.
const modulePathPattern = /^(?:ui|shared|client)\/(?:[a-z0-9][a-z0-9-]*\/)*[a-z0-9][a-z0-9-]*\.ts$/

export const clientModulePrefix = '/static/js/'
const oneYear = 365 * 24 * 60 * 60

type ClientModule = {
  code: string // stripped, as sent
  etag: string
  // Static imports and re-exports, as written: './x.ts', '../ui/y.ts', 'preact'.
  imports: string[]
}

function listModules(folder: string): string[] {
  return readdirSync(join(srcDir, folder), { withFileTypes: true, recursive: true })
    .filter(
      (entry) => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts'),
    )
    .map((entry) =>
      join(entry.parentPath, entry.name)
        .slice(srcDir.length + 1)
        .replaceAll('\\', '/'),
    )
}

// The static imports of stripped code (after stripping, `import type` is gone and
// `import { type X }` is `import {        }`). Dynamic import() is left out: it loads on
// demand, so it is not preloaded.
export function staticImports(code: string): string[] {
  return [
    ...code.matchAll(/^\s*import\s+(?:[\w*{}\s,$]+\s+from\s+)?['"]([^'"]+)['"]/gm),
    ...code.matchAll(/^\s*export\s+(?:\*|\{[^}]*\})(?:\s+as\s+\w+)?\s+from\s+['"]([^'"]+)['"]/gm),
  ].map((match) => match[1] ?? '')
}

function loadModules(): Map<string, ClientModule> {
  const modules = new Map<string, ClientModule>()
  for (const path of clientFolders.flatMap(listModules).sort()) {
    if (!modulePathPattern.test(path)) {
      // It could never be fetched, so a page importing it would break: fail loudly.
      throw new Error(`Client module src/${path} needs a lower-case name with dashes`)
    }
    const code = stripTypeScriptTypes(readFileSync(join(srcDir, path), 'utf8'), { mode: 'strip' })
    const etag = `"${createHash('sha256').update(code).digest('base64url').slice(0, 27)}"`
    modules.set(path, { code, etag, imports: staticImports(code) })
  }
  return modules
}

const modules = loadModules()

// The build hash: every client file's path and contents. Stripping is deterministic, so
// hashing the stripped code is the same as hashing the source.
export const clientBuild = createHash('sha256')
  .update([...modules].map(([path, { code }]) => `${path}\0${code}`).join('\0'))
  .digest('hex')
  .slice(0, 12)

const buildPrefix = `${clientModulePrefix}${clientBuild}/`

// The URL of a client module, by its path under src/: clientModuleUrl('client/main.ts').
export function clientModuleUrl(path: string): string {
  if (!modules.has(path)) {
    throw new Error(`No client module src/${path}`)
  }
  return `${buildPrefix}${path}`
}

export function clientModulePaths(): string[] {
  return [...modules.keys()]
}

export const mainModuleUrl = clientModuleUrl('client/main.ts')

// html.ts is htm bound to the server's Preact; in the browser, the bundle's `html` takes
// its place, bound to the bundle's Preact.
const htmlModule = 'ui/html.ts'

// Every specifier the client modules may use that is not a relative path to another one.
// All of them are the one bundle (one Preact instance, see src/vendor.ts).
export const importMap = {
  imports: {
    preact: preactBundleUrl,
    'preact/hooks': preactBundleUrl,
    htm: preactBundleUrl,
    '@preact/signals': preactBundleUrl,
    [clientModuleUrl(htmlModule)]: preactBundleUrl,
  },
}

// The import map as it goes in the page's <script type="importmap">, byte for byte, and
// its CSP hash. `<` can't occur in these URLs, but is escaped anyway so the JSON can never
// end the <script> element.
export const importMapJson = JSON.stringify(importMap).replaceAll('<', '\\u003c')
export const importMapHash = `'sha256-${createHash('sha256').update(importMapJson, 'utf8').digest('base64')}'`

// What a module needs before it can run: every module its static imports reach, and the
// bundle if any of them (or it) uses Preact. For <link rel="modulepreload">, so the
// browser fetches them all at once instead of discovering them one level at a time.
// Unknown imports are left out here; test/client-modules.test.ts makes sure there are none.
export function modulePreloads(entry: string): string[] {
  const seen = new Set<string>()
  let bundle = false
  const visit = (path: string) => {
    if (path === htmlModule) {
      bundle = true
      return
    }
    const module = modules.get(path)
    if (!module || seen.has(path)) {
      return
    }
    seen.add(path)
    for (const specifier of module.imports) {
      if (specifier.startsWith('.')) {
        visit(resolveImport(path, specifier))
      } else if (specifier in importMap.imports) {
        bundle = true
      }
    }
  }
  visit(entry)
  return [...(bundle ? [preactBundleUrl] : []), ...[...seen].map((path) => `${buildPrefix}${path}`)]
}

// '../ui/text.ts' imported by 'client/main.ts' is 'ui/text.ts'; '' when it leaves src/.
export function resolveImport(from: string, specifier: string): string {
  const resolved = new URL(specifier, `https://src/${from}`)
  return resolved.host === 'src' ? resolved.pathname.slice(1) : ''
}

// Imports that would fail in the browser: a relative path that is not a client module,
// or a bare specifier the import map doesn't know. For tests.
export function unresolvableImports(): string[] {
  return [...modules].flatMap(([path, { imports }]) =>
    imports
      .filter((specifier) =>
        specifier.startsWith('.')
          ? !modules.has(resolveImport(path, specifier))
          : !(specifier in importMap.imports),
      )
      .map((specifier) => `${path} imports ${specifier}`),
  )
}

// The modules preloaded on every page with JavaScript on: main.ts and what it imports.
export const mainModulePreloads = modulePreloads('client/main.ts')

// GET /static/js/<build>/<folder>/<file>.ts. Anything else under /static/js/ is a 404,
// whatever the file system holds.
export function serveClientModules(app: Express): void {
  app.use(clientModulePrefix, (request: Request, response: Response, next: NextFunction) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      next()
      return
    }
    // request.path is not percent-decoded, so %2e%2e or %2f stay as they are and fail.
    const match = /^\/([0-9a-f]{12})\/(.+)$/.exec(request.path)
    const path = match?.[1] === clientBuild ? match[2] : undefined
    const module = path && modulePathPattern.test(path) ? modules.get(path) : undefined
    if (!module) {
      // Plain text: these are never pages, and a script request can't show one.
      response.status(404).type('text').send('Not found')
      return
    }
    response.set({
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': `public, max-age=${oneYear}, immutable`,
      ETag: module.etag,
    })
    // send() answers 304 itself when If-None-Match matches the ETag.
    response.send(module.code)
  })
}
