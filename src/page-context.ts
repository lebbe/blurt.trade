import { AsyncLocalStorage } from 'node:async_hooks'
import type { AuthenticatedUser } from './middleware/auth.ts'
import { defaultTheme, type ThemeId } from './themes.ts'
import { defaultTimeZone } from './timezones.ts'

// What every page's frame needs from the request, whatever the route: who is looking (for
// the navigation), which page they are on (to mark it in the navigation) and their theme.
// Set once per request by the pageContext middleware (src/server.ts), so routes and error
// handlers can render pages without passing it along.
export type PageContext = {
  viewer: AuthenticatedUser | null
  isAdmin: boolean // only looked up for logged-in viewers; shows the Admin link
  path: string
  theme: ThemeId
  timeZone: string // IANA name; timestamps are shown in it
  locale: string // how dates and times are written: the one picked, else from Accept-Language
  pickedLocale: string | null // the one picked on the edit page, if any
}

const storage = new AsyncLocalStorage<PageContext>()

const outside: PageContext = {
  viewer: null,
  isAdmin: false,
  path: '',
  theme: defaultTheme,
  timeZone: defaultTimeZone,
  locale: 'en-GB',
  pickedLocale: null,
}

export function runWithPageContext<T>(context: PageContext, callback: () => T): T {
  return storage.run(context, callback)
}

// Outside a request (or before the middleware ran, e.g. a malformed body): anonymous, the
// default theme and no page marked.
export function pageContext(): PageContext {
  return storage.getStore() ?? outside
}
