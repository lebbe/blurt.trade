import { createHash } from 'node:crypto'

// The colour themes a browser can pick on the profile edit page. The first is the default
// and lives in public/style.css itself; each of the others is a small stylesheet in
// public/themes/ that overrides its colours (and a few touches), linked after style.css.
// The pick is saved on the account (user_profiles.theme) and travels in the access token
// (src/middleware/auth.ts), so pages know it without JS, an extra cookie or a query.
//
// `colors` are the few each theme needs before its stylesheet arrives (see criticalCss);
// they must match the theme's --bg, --text, --accent-strong, --panel and --line.
export const themes = [
  {
    id: 'cobalt-quietude',
    label: 'Cobalt Quietude',
    colors: { bg: '#0a1323', text: '#e8f0ff', link: '#aac9ff', panel: '#132038', line: '#6d9adf' },
  },
  {
    id: 'midnight-clay',
    label: 'Midnight Clay',
    colors: { bg: '#121416', text: '#ece7df', link: '#ffd3ae', panel: '#1b2025', line: '#d08c5e' },
  },
  {
    id: 'forest-alloy',
    label: 'Forest Alloy',
    colors: { bg: '#121a17', text: '#ebe6dc', link: '#e4c98d', panel: '#1c2823', line: '#b99a63' },
  },
  {
    id: 'plum-steel',
    label: 'Plum Steel',
    colors: { bg: '#17121f', text: '#efe9f7', link: '#e0c9ff', panel: '#211a2d', line: '#b69ad7' },
  },
  {
    id: 'tarnished-teal',
    label: 'Tarnished Teal',
    colors: { bg: '#191615', text: '#f0e8df', link: '#b9e1da', panel: '#28211f', line: '#7fa6a0' },
  },
] as const

export type ThemeId = (typeof themes)[number]['id']

// For everyone who hasn't picked one (user_profiles.theme is NULL) and everyone logged out.
export const defaultTheme: ThemeId = 'cobalt-quietude'

export function isTheme(value: unknown): value is ThemeId {
  return themes.some((theme) => theme.id === value)
}

// The stylesheet a theme adds on top of style.css, or null for the default.
export function themeStylesheetUrl(theme: ThemeId): string | null {
  return theme === defaultTheme ? null : `/static/themes/${theme}.css`
}

// Above-the-fold CSS, inlined in every page's <head> (at most 15 lines): the theme's
// colours, the page frame and the sizes of the inline SVGs, so a slow connection shows a
// dark, laid-out page while the stylesheets load instead of a white flash with giant
// avatars. Everything else is in the stylesheets, which win where they say otherwise.
export const criticalCssMaxLines = 15

function buildCriticalCss(theme: ThemeId): string {
  const { bg, text, link, panel, line } = themes.find(({ id }) => id === theme)!.colors
  return [
    `:root{color-scheme:dark;background:${bg};color:${text}}`,
    'body{margin:0;font:16px/1.45 Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}',
    `a{color:${link}}`,
    '.shell{max-width:1180px;margin:0 auto;padding:20px}',
    `.site-head,.panel{background:${panel};border:3px solid ${line};padding:14px;margin-bottom:18px}`,
    '.layout{display:grid;grid-template-columns:minmax(0,2fr) minmax(260px,1fr);gap:18px;align-items:start}',
    '.layout.single{grid-template-columns:minmax(0,1fr);max-width:820px}',
    '@media (max-width:920px){.layout{grid-template-columns:minmax(0,1fr)}}',
    '.icon{width:1.05em;height:1.05em}',
    '.avatar{width:3rem;height:3rem}.blurt>.avatar{width:72px;height:72px}.avatar-large{width:84px;height:84px}',
  ].join('\n')
}

const criticalCssByTheme = new Map(themes.map(({ id }) => [id, buildCriticalCss(id)]))

export function criticalCss(theme: ThemeId): string {
  return criticalCssByTheme.get(theme)!
}

// The Content-Security-Policy allows exactly these inline <style> blocks, by hash, and no
// other inline CSS (no 'unsafe-inline').
export const criticalCssHashes = [...criticalCssByTheme.values()].map(
  (css) => `'sha256-${createHash('sha256').update(css, 'utf8').digest('base64')}'`,
)
