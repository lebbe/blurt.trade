import { createHash } from 'node:crypto'
import { criticalCss, themes } from './shared/themes.ts'

// The themes and their critical CSS are in src/shared/themes.ts, which the browser can load
// too. Only the CSP hashes of that CSS, which need node:crypto, are made here.
export * from './shared/themes.ts'

// The Content-Security-Policy allows exactly these inline <style> blocks, by hash, and no
// other inline CSS (no 'unsafe-inline').
export const criticalCssHashes = themes
  .map(({ id }) => criticalCss(id))
  .map((css) => `'sha256-${createHash('sha256').update(css, 'utf8').digest('base64')}'`)
