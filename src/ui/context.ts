import { createContext } from 'preact'
import { useContext } from 'preact/hooks'
import type { AuthenticatedUser } from '../middleware/auth.ts'
import { defaultTheme, type ThemeId } from '../shared/themes.ts'
import { defaultTimeZone } from '../shared/time-zones.ts'

// Who is looking at a page. Null: logged out.
export type Viewer = AuthenticatedUser | null

// What every page's frame needs from the request, whatever the route: who is looking (for
// the navigation), which page they are on (to mark it in the navigation) and their theme.
// On the server it is filled per request (src/page-context.ts) and handed to the components
// by the Provider renderDocument puts at the root of every page (src/templates/layout.ts),
// so the components themselves never touch the request and can run in a browser too.
export type PageContext = {
  viewer: Viewer
  isAdmin: boolean // only looked up for logged-in viewers; shows the Admin link
  // Their unread notifications, at most unreadCap (src/routes/state.ts); 0 when logged out.
  unreadNotifications: number
  path: string
  theme: ThemeId
  timeZone: string // IANA name; timestamps are shown in it
  locale: string // how dates and times are written: the one picked, else from Accept-Language
  pickedLocale: string | null // the one picked on the edit page, if any
}

// Outside a request (or before the middleware ran, e.g. a malformed body): anonymous, the
// default theme and no page marked.
export const outsidePageContext: PageContext = {
  viewer: null,
  isAdmin: false,
  unreadNotifications: 0,
  path: '',
  theme: defaultTheme,
  timeZone: defaultTimeZone,
  locale: 'en-GB',
  pickedLocale: null,
}

export const PageContextValue = createContext<PageContext>(outsidePageContext)

// For components: the page context of the page being rendered.
export function usePageContext(): PageContext {
  return useContext(PageContextValue)
}
