import test from 'node:test'
import assert from 'node:assert/strict'
import { request } from './helpers.ts'

test('every icon a page uses is a symbol in the sprite at the top of its body', async () => {
  for (const path of ['/', '/about', '/login', '/nowhere-at-all']) {
    const { body } = await request('GET', path)
    const used = new Set([...body.matchAll(/<use href="#(icon-[a-zA-Z]+)"/g)].map((m) => m[1]))
    assert.ok(used.size > 0, path)
    for (const id of used) {
      assert.equal(body.split(`<symbol id="${id}"`).length, 2, `${path}: ${id} defined once`)
    }
    // The sprite comes before the first icon, and the page repeats no icon's paths.
    assert.ok(body.indexOf('<symbol ') < body.indexOf('<use '), path)
    assert.match(body, /<body><svg hidden aria-hidden="true"/, path)
  }
})
