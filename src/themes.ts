// The colour themes a browser can pick on the profile edit page. The first is the default
// and lives in public/style.css itself; each of the others is a small stylesheet in
// public/themes/ that overrides its colours (and a few touches), linked after style.css.
// The pick is kept in the `theme` cookie, so it needs no JS and no account.
export const themes = [
  { id: 'midnight-clay', label: 'Midnight Clay' },
  { id: 'cobalt-quietude', label: 'Cobalt Quietude' },
  { id: 'forest-alloy', label: 'Forest Alloy' },
  { id: 'plum-steel', label: 'Plum Steel' },
  { id: 'tarnished-teal', label: 'Tarnished Teal' },
] as const

export type ThemeId = (typeof themes)[number]['id']

export const defaultTheme: ThemeId = 'midnight-clay'

export const themeCookie = 'theme'

export function isTheme(value: unknown): value is ThemeId {
  return themes.some((theme) => theme.id === value)
}

// The stylesheet a theme adds on top of style.css, or null for the default.
export function themeStylesheetUrl(theme: ThemeId): string | null {
  return theme === defaultTheme ? null : `/static/themes/${theme}.css`
}
