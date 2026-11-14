import type { PageContext } from './context.ts'
import { html } from './html.ts'
import { Icon, type IconName } from './icons.ts'
import { UnreadBadge } from './notifications.ts'

// The main navigation's links (TopNav in src/pages/shared/layout.ts). Shared, so the
// browser can add, update or take away the Alerts link when the unread count changes
// without a page load (src/client/live.ts).

export type NavItem = {
  href: string
  label: string
  icon: IconName
  current: boolean
  badge?: number
}

// Every destination, on every page, always visible: no menus to open. Logged-in viewers
// get their profile and settings; everyone else the way in.
export function navItems({ viewer, isAdmin, path, unreadNotifications }: PageContext): NavItem[] {
  const item = (
    href: string,
    label: string,
    icon: IconName,
    current = path === href,
    badge?: number,
  ) => ({
    href,
    label,
    icon,
    current,
    badge,
  })
  if (!viewer) {
    return [
      item('/', 'Home', 'home'),
      item('/people', 'People', 'people'),
      item('/search', 'Search', 'search'),
      item('/login', 'Log in', 'login'),
      item('/signup', 'Sign up', 'personPlus'),
    ]
  }
  const profile = `/${viewer.username}/`
  return [
    item('/', 'Home', 'home'),
    item('/everyone', 'Everyone', 'globe'),
    item('/people', 'People', 'people'),
    item('/search', 'Search', 'search'),
    item('/near', 'Near', 'pin'),
    item(profile, 'Profile', 'person', path === profile || path === `/${viewer.username}/edit`),
    // Only while there is something to see, so the bar stays short on phones. The same
    // link is in Your corner, always.
    ...(unreadNotifications > 0
      ? [
          item(
            `/${viewer.username}/notifications/`,
            'Alerts',
            'bell',
            path.startsWith(`/${viewer.username}/notifications`),
            unreadNotifications,
          ),
        ]
      : []),
    item('/settings', 'Settings', 'sliders', path.startsWith('/settings')),
    ...(isAdmin ? [item('/admin', 'Admin', 'shield', path.startsWith('/admin'))] : []),
  ]
}

export function NavLink({ item: { href, label, icon, current, badge } }: { item: NavItem }) {
  return html`<a href=${href} aria-current=${current ? 'page' : undefined}
    ><${Icon} name=${icon} /><span>${label}</span
    >${badge !== undefined && html`<${UnreadBadge} unread=${badge} />`}</a
  >`
}
