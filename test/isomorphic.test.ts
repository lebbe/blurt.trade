import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { z } from 'zod'
import { isWebUrl, normalizedWebUrl } from '../src/shared/limits.ts'

// src/ui (components) and src/shared (the data they need) must run in a browser as well as
// on the server: see "Shared components" in docs/routes.md. oxlint's no-restricted-imports
// names the usual suspects (.oxlintrc.json); this test is the stricter lock. It reads what
// Node actually loads, the code with its types stripped (so `import type` is gone, and
// `import { type X }` still loads its module), and allows only the packages below and
// files inside the two folders.

const root = join(import.meta.dirname, '..')
const sharedDirs = ['src/ui', 'src/shared'].map((dir) => join(root, dir))
// In the browser the import map points all four at preact-hook-signal-htm-bundle (one
// Preact instance, src/vendor.ts), so shared code imports them, not the bundle by name.
const allowedPackages = new Set(['preact', 'preact/hooks', 'htm', '@preact/signals'])

function filesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesIn(join(dir, entry.name))
      : entry.name.endsWith('.ts')
        ? [join(dir, entry.name)]
        : [],
  )
}

// Static imports and re-exports (`export ... from`) of type-stripped code, and dynamic
// import(), which may load anything at runtime.
function runtimeImports(source: string): string[] {
  const code = stripTypeScriptTypes(source)
  const statics = [
    ...code.matchAll(/^\s*import\s+(?:[\w*{}\s,$]+\s+from\s+)?['"]([^'"]+)['"]/gm),
    ...code.matchAll(/^\s*export\s+(?:\*|\{[^}]*\})(?:\s+as\s+\w+)?\s+from\s+['"]([^'"]+)['"]/gm),
  ].map((match) => match[1] ?? '')
  const dynamic = /\bimport\s*\(/.test(code) ? ['import()'] : []
  return [...statics, ...dynamic]
}

test('src/ui and src/shared import nothing that only runs on the server', () => {
  const files = sharedDirs.flatMap(filesIn)
  assert.ok(files.length > 5, 'found the shared modules')
  const problems: string[] = []
  for (const file of files) {
    for (const specifier of runtimeImports(readFileSync(file, 'utf8'))) {
      const name = relative(root, file)
      if (specifier.startsWith('.')) {
        const target = resolve(dirname(file), specifier)
        if (!sharedDirs.some((dir) => target.startsWith(`${dir}/`))) {
          problems.push(`${name} imports ${relative(root, target)}`)
        }
      } else if (!allowedPackages.has(specifier)) {
        problems.push(`${name} imports ${specifier}`)
      }
    }
  }
  assert.deepEqual(problems, [])
})

// Browser-only code (src/client) may use the DOM, and the same modules and packages as
// src/ui and src/shared, nothing else. Its import() calls load enhancers on demand
// (src/client/main.ts); they must be literal relative paths inside src/client, so they
// resolve under the versioned URL the page loaded main.ts from (src/client-modules.ts).
test('src/client imports only client modules and the Preact packages', () => {
  const clientDir = join(root, 'src/client')
  const files = filesIn(clientDir)
  assert.ok(
    files.some((file) => file.endsWith('main.ts')),
    'found src/client/main.ts',
  )
  const problems: string[] = []
  for (const file of files) {
    const name = relative(root, file)
    const source = readFileSync(file, 'utf8')
    for (const specifier of runtimeImports(source)) {
      if (specifier === 'import()') {
        continue
      }
      if (specifier.startsWith('.')) {
        const target = resolve(dirname(file), specifier)
        if (![...sharedDirs, clientDir].some((dir) => target.startsWith(`${dir}/`))) {
          problems.push(`${name} imports ${relative(root, target)}`)
        }
      } else if (!allowedPackages.has(specifier)) {
        problems.push(`${name} imports ${specifier}`)
      }
    }
    const code = stripTypeScriptTypes(source)
    for (const [call] of code.matchAll(/\bimport\s*\((?!\))[^)]*\)/g)) {
      const literal = /^import\s*\(\s*'(\.\/[a-z0-9-]+\.ts)'\s*\)$/.exec(call)
      if (!literal) {
        problems.push(`${name} has ${call}`)
      }
    }
  }
  assert.deepEqual(problems, [])
})

test('the import check sees what Node loads', () => {
  assert.deepEqual(
    runtimeImports(
      [
        "import type { Blurt } from '../routes/state/blurts.ts'",
        "import { type Viewer } from './context.ts'",
        "import {\n  a,\n  b,\n} from 'node:fs'",
        "import 'zod'",
        "export * from './text.ts'",
        "export type { X } from '../config.ts'",
        "export { y } from '../page-context.ts'",
        "const later = await import('pg')",
      ].join('\n'),
    ),
    ['./context.ts', 'node:fs', 'zod', './text.ts', '../page-context.ts', 'import()'],
  )
})

// The web address check used to be zod's url() plus a refine; it is plain code now, so the
// browser can run it. It must accept and clean exactly what the zod schema did.
const zodWebUrl = z
  .string()
  .url()
  .refine((value) => {
    if (!/^https?:\/\//i.test(value)) {
      return false
    }
    try {
      return ['http:', 'https:'].includes(new URL(value).protocol)
    } catch {
      return false
    }
  })

test('the web address check matches what the zod schema accepted', () => {
  const cases = [
    'https://example.com',
    ' http://example.com/a?b=1 ',
    'HTTPS://EXAMPLE.COM/',
    'http:example.com',
    'https:/example.com',
    'http://',
    'http://a b',
    'http://exa\nmple.com/',
    '\thttps://example.com\t',
    'ht\ntp://example.com',
    'javascript:alert(1)',
    'data:text/html,hi',
    'ftp://example.com',
    'http:\\\\example.com',
    'http://[::1]:8080/x',
    'https://example.com/a_(b)',
    'https://user:pass@example.com',
    'example.com',
    '',
    'https://example.com/?utm_source=x&keep=1',
  ]
  for (const value of cases) {
    const parsed = zodWebUrl.safeParse(value)
    assert.equal(isWebUrl(value), parsed.success, JSON.stringify(value))
    if (parsed.success) {
      assert.ok(normalizedWebUrl(value), JSON.stringify(value))
    } else {
      assert.equal(normalizedWebUrl(value), undefined, JSON.stringify(value))
    }
  }
  assert.equal(normalizedWebUrl(' https://example.com/x '), 'https://example.com/x')
  assert.equal(
    normalizedWebUrl('https://exa\tmple.com/?utm_source=x&keep=1'),
    'https://example.com/?keep=1',
  )
})
