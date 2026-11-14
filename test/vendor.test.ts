import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { preactBundleFile, preactBundleUrl, preactBundleVersion } from '../src/vendor.ts'
import { request } from './helpers.ts'

const root = join(import.meta.dirname, '..')
const packageJson = (dir: string) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
const ours = packageJson(root)
const bundle = packageJson(join(root, 'node_modules', 'preact-hook-signal-htm-bundle'))
const major = (versionOrRange: string) => Number(/\d+/.exec(versionOrRange)?.[0])

// The bundle compiles in its own Preact, htm and signals; its package.json lists the
// versions it was built from (as devDependencies, since nothing is installed beside it).
const builtWith = (name: string): string =>
  bundle.dependencies?.[name] ?? bundle.devDependencies?.[name]

test('the browser bundle is built on the same Preact major as the server renders with', () => {
  assert.equal(ours.dependencies['preact-hook-signal-htm-bundle'].startsWith('^3.'), true)
  for (const name of ['preact', 'htm', '@preact/signals']) {
    const range = builtWith(name)
    assert.ok(range, `the bundle names the ${name} it was built with`)
    const installed = packageJson(join(root, 'node_modules', name)).version
    assert.equal(major(range), major(ours.dependencies[name]), `${name}: bundle vs package.json`)
    assert.equal(major(range), major(installed), `${name}: bundle vs node_modules (${installed})`)
  }
  assert.equal(preactBundleVersion, bundle.version)
})

test('the bundle exports what shared components and islands need', async () => {
  const exports = await import(preactBundleFile)
  for (const name of ['h', 'Fragment', 'render', 'hydrate', 'createContext', 'options']) {
    assert.equal(typeof exports[name], name === 'options' ? 'object' : 'function', name)
  }
  for (const name of ['useState', 'useEffect', 'useContext', 'useRef', 'useId']) {
    assert.equal(typeof exports[name], 'function', name)
  }
  for (const name of ['signal', 'computed', 'effect', 'useSignal', 'useComputed']) {
    assert.equal(typeof exports[name], 'function', name)
  }
  assert.equal(typeof exports.html, 'function')
  // html is htm bound to the bundle's own h, so it makes that Preact's vnodes.
  const vnode = exports.html`<p class="x">hi</p>`
  assert.equal(vnode.type, 'p')
  assert.deepEqual(vnode.props, { class: 'x', children: 'hi' })
  // A single self-contained module: nothing for the browser to resolve.
  assert.doesNotMatch(readFileSync(preactBundleFile, 'utf8'), /\bimport\s*["'{*(]/)
})

test('the bundle is served from our origin at its versioned URL, cached for good', async () => {
  assert.equal(preactBundleUrl, `/static/vendor/preact-bundle@${bundle.version}.js`)
  const response = await request('GET', preactBundleUrl)
  assert.equal(response.statusCode, 200)
  assert.equal(response.contentType, 'text/javascript; charset=utf-8')
  assert.equal(response.headers['cache-control'], 'public, max-age=31536000, immutable')
  assert.equal(response.headers['x-content-type-options'], 'nosniff')
  assert.equal(response.body, readFileSync(preactBundleFile, 'utf8'))

  for (const path of [
    '/static/vendor/preact-bundle.js',
    '/static/vendor/preact-bundle@3.0.0.js',
    `/static/vendor/preact-bundle@${bundle.version}.mjs`,
    '/static/vendor/package.json',
  ]) {
    const missing = await request('GET', path)
    assert.equal(missing.statusCode, 404, path)
    assert.equal(missing.headers['cache-control']?.includes('immutable') ?? false, false, path)
  }
})
