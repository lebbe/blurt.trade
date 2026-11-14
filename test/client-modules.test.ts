import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { join } from 'node:path'
import {
  clientBuild,
  clientModulePaths,
  clientModuleUrl,
  importMap,
  mainModulePreloads,
  mainModuleUrl,
  modulePreloads,
  resolveImport,
  staticImports,
  unresolvableImports,
} from '../src/client-modules.ts'
import { preactBundleUrl } from '../src/vendor.ts'
import { request } from './helpers.ts'

const srcDir = join(import.meta.dirname, '..', 'src')

test('serves every client module type-stripped, versioned and immutable', async () => {
  const paths = clientModulePaths()
  for (const folder of ['ui', 'shared', 'client']) {
    assert.ok(
      paths.some((path) => path.startsWith(`${folder}/`)),
      `has modules from src/${folder}`,
    )
  }
  assert.ok(paths.includes('client/main.ts'))
  assert.match(clientBuild, /^[0-9a-f]{12}$/)
  assert.equal(mainModuleUrl, `/static/js/${clientBuild}/client/main.ts`)

  for (const path of paths) {
    const source = readFileSync(join(srcDir, path), 'utf8')
    const response = await request('GET', clientModuleUrl(path))
    assert.equal(response.statusCode, 200, path)
    assert.equal(response.contentType, 'text/javascript; charset=utf-8', path)
    assert.equal(response.headers['cache-control'], 'public, max-age=31536000, immutable', path)
    assert.equal(response.headers['x-content-type-options'], 'nosniff', path)
    assert.match(String(response.headers.etag), /^"[\w-]+"$/, path)
    // Types are blanked out, not removed, so every line and column stays where it was.
    assert.equal(response.body, stripTypeScriptTypes(source, { mode: 'strip' }), path)
    assert.equal(response.body.length, source.length, path)
    assert.equal(response.body.split('\n').length, source.split('\n').length, path)
    // Nothing TypeScript-only is left to trip the browser.
    assert.doesNotMatch(response.body, /^\s*(import|export) type\b/m, path)
    assert.doesNotMatch(response.body, /\bas (unknown|const)\b|\binterface \w/, path)
  }

  const main = await request('GET', mainModuleUrl)
  const again = await request('GET', mainModuleUrl, '', {
    'if-none-match': String(main.headers.etag),
  })
  assert.equal(again.statusCode, 304)
  assert.equal(again.body, '')
  const head = await request('HEAD', mainModuleUrl)
  assert.equal(head.statusCode, 200)
  assert.equal(head.body, '')
})

test('nothing but the client folders can be fetched, however the path is written', async () => {
  const base = `/static/js/${clientBuild}`
  const refused = [
    // Server code, by its real path.
    `${base}/config.ts`,
    `${base}/server.ts`,
    `${base}/routes/home.ts`,
    `${base}/routes/state.ts`,
    `${base}/middleware/auth.ts`,
    `${base}/templates/layout.ts`,
    `${base}/tz-lookup.d.ts`,
    // Climbing out of a client folder.
    `${base}/ui/../config.ts`,
    `${base}/ui/../../package.json`,
    `${base}/ui/../../.env`,
    `${base}/client/../routes/home.ts`,
    `${base}/ui/%2e%2e/config.ts`,
    `${base}/ui/%2E%2E/config.ts`,
    `${base}/ui/%252e%252e/config.ts`,
    `${base}/ui%2f..%2fconfig.ts`,
    `${base}/ui%2F..%2Fconfig.ts`,
    `${base}/ui/..%2fconfig.ts`,
    `${base}/ui/..%5cconfig.ts`,
    `${base}/ui\\..\\config.ts`,
    `${base}//etc/passwd`,
    `${base}/ui/html.ts%00.png`,
    `${base}/ui/./html.ts`,
    `${base}/ui//html.ts`,
    `${base}/%75i/html.ts`,
    // Not exactly a module.
    `${base}/UI/html.ts`,
    `${base}/ui/HTML.ts`,
    `${base}/ui/html.js`,
    `${base}/ui/html`,
    `${base}/ui/html.ts.map`,
    `${base}/ui/`,
    `${base}/ui`,
    `${base}/`,
    `${base}/ui/no-such-file.ts`,
    // Not this build.
    '/static/js/000000000000/client/main.ts',
    '/static/js/client/main.ts',
    `/static/js/${clientBuild.toUpperCase()}/client/main.ts`,
    `/static/js/${clientBuild}0/client/main.ts`,
    '/static/js/',
    '/static/client/main.ts',
    '/src/client/main.ts',
    '/src/config.ts',
  ]
  for (const path of refused) {
    const response = await request('GET', path)
    assert.equal(response.statusCode, 404, path)
    assert.doesNotMatch(response.body, /process\.env|export /, path)
  }
  // A query string is ignored, as for any static file: still only the module.
  const withQuery = await request('GET', `${base}/ui/text.ts?../../config.ts`)
  assert.equal(withQuery.statusCode, 200)
  assert.equal(withQuery.body, (await request('GET', `${base}/ui/text.ts`)).body)
})

test('every import of a client module resolves in the browser', () => {
  // Relative imports reach only client modules, bare ones only what the import map maps.
  assert.deepEqual(unresolvableImports(), [])
  assert.deepEqual(
    Object.keys(importMap.imports).sort(),
    ['@preact/signals', clientModuleUrl('ui/html.ts'), 'htm', 'preact', 'preact/hooks'].sort(),
  )
  for (const target of Object.values(importMap.imports)) {
    assert.equal(target, preactBundleUrl)
  }
  assert.equal(resolveImport('client/main.ts', './enhance.ts'), 'client/enhance.ts')
  assert.equal(resolveImport('client/main.ts', '../ui/context.ts'), 'ui/context.ts')
  assert.equal(resolveImport('ui/x.ts', '../../config.ts'), 'config.ts')
  assert.deepEqual(
    staticImports(
      "import { a } from './a.ts'\nimport {\n  b,\n} from 'preact'\nimport './c.ts'\nexport * from './d.ts'\nconst e = await import('./e.ts')",
    ),
    ['./a.ts', 'preact', './c.ts', './d.ts'],
  )
})

test('main.ts and what it imports are preloaded, with the bundle and without html.ts', () => {
  assert.equal(mainModulePreloads[0], preactBundleUrl)
  assert.ok(mainModulePreloads.includes(mainModuleUrl))
  assert.ok(mainModulePreloads.includes(clientModuleUrl('client/enhance.ts')))
  assert.ok(!mainModulePreloads.includes(clientModuleUrl('ui/html.ts')))
  assert.equal(new Set(mainModulePreloads).size, mainModulePreloads.length)
  // A module that uses html.ts needs the bundle, and pulls in its own imports.
  const card = modulePreloads('ui/blurt-card.ts')
  assert.ok(card.includes(preactBundleUrl))
  assert.ok(card.includes(clientModuleUrl('ui/text.ts')))
  assert.ok(!card.includes(clientModuleUrl('ui/html.ts')))
})
