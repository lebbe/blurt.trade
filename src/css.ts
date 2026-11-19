import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Express, NextFunction, Request, Response } from 'express'

// public/style.css is the one stylesheet that blocks the first paint, so it is sent
// minified: no comments, no indentation, no spaces the grammar does not need (about a third
// smaller raw, a few hundred bytes less gzipped). The file in public/ stays readable.
//
// No dependency: the stylesheet is written by hand, formatted by oxfmt, and uses nothing
// exotic, so a small tokenizer is enough. It only ever removes whitespace and comments:
//   - strings ("…", '…') are copied untouched;
//   - a space is kept wherever the grammar needs one: between two words (`a b`, descendant
//     selectors, `1px solid`), before `:` (`a :hover` is not `a:hover`) and around `+` and
//     `-` (`calc(100% + 32px)`). Only the space around `{ } ; ,` and `>`, and after `:`,
//     goes, and the `;` before a `}`.

export function minifyCss(css: string): string {
  let out = ''
  let pendingSpace = false
  let i = 0
  // The characters whose neighbouring whitespace never matters.
  const bare = new Set(['{', '}', ';', ',', '>'])
  const last = () => out[out.length - 1]
  const write = (text: string) => {
    if (pendingSpace && out !== '' && !bare.has(last()) && last() !== ':' && !bare.has(text[0])) {
      out += ' '
    }
    pendingSpace = false
    out += text
  }
  while (i < css.length) {
    const char = css[i]
    if (char === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      i = end === -1 ? css.length : end + 2
      pendingSpace = true // a comment separates words like whitespace does
    } else if (/\s/.test(char)) {
      pendingSpace = true
      i++
    } else if (char === '"' || char === "'") {
      let j = i + 1
      while (j < css.length && css[j] !== char) {
        j += css[j] === '\\' ? 2 : 1
      }
      write(css.slice(i, j + 1))
      i = j + 1
    } else if (char === '}') {
      // The last declaration needs no `;`.
      if (last() === ';') out = out.slice(0, -1)
      pendingSpace = false
      out += '}'
      i++
    } else {
      // A run of ordinary characters up to the next whitespace, string, comment or one of
      // the characters handled above.
      let j = i
      while (j < css.length && !/[\s"'}]/.test(css[j]) && !(css[j] === '/' && css[j + 1] === '*')) {
        j++
      }
      const token = css.slice(i, Math.max(j, i + 1))
      write(token)
      i += token.length
    }
  }
  return out
}

const stylesheetPath = join(import.meta.dirname, '..', 'public', 'style.css')

let cached: { mtimeMs: number; css: string; etag: string } | undefined

// Re-minified when the file changes (npm run dev edits it without a restart).
function minifiedStylesheet() {
  const { mtimeMs } = statSync(stylesheetPath)
  if (cached?.mtimeMs !== mtimeMs) {
    const css = minifyCss(readFileSync(stylesheetPath, 'utf8'))
    const etag = `"${createHash('sha256').update(css).digest('base64url').slice(0, 27)}"`
    cached = { mtimeMs, css, etag }
  }
  return cached
}

// GET /static/style.css, before the static files, the minified stylesheet. Revalidated on
// every use like the other files in public/ (ETag, max-age 0): the URL has no version.
export function serveStylesheet(app: Express): void {
  app.get('/static/style.css', (_request: Request, response: Response, next: NextFunction) => {
    try {
      const { css, etag } = minifiedStylesheet()
      response.set({
        'Content-Type': 'text/css; charset=utf-8',
        'Cache-Control': 'public, max-age=0',
        ETag: etag,
      })
      // send() answers 304 itself when If-None-Match matches the ETag.
      response.send(css)
    } catch (error) {
      next(error)
    }
  })
}
