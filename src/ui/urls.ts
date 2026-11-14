import type { Blurt } from '../routes/state.ts'

// Where things live. Plain links and form actions, so everything works without JS.

// A deleted placeholder has no author, so it lives at /deleted/:id ('deleted' is a
// reserved username). Its page also answers under the old author's name.
export function blurtUrl(blurt: Pick<Blurt, 'id' | 'username'>): string {
  return `/${blurt.username ?? 'deleted'}/${blurt.id}`
}

// The blurt a reply replies to. Its author is null when that blurt was deleted.
export function parentUrl(blurt: Blurt): string | null {
  return blurt.parentId === null
    ? null
    : blurtUrl({ id: blurt.parentId, username: blurt.parentUsername })
}

// Where the quote form for a blurt is: on its page.
export function quoteUrl(blurt: Blurt): string {
  return `${blurtUrl(blurt)}#quote`
}

export function deleteBlurtPath(blurt: Blurt): string {
  return `/api/blurts/${blurt.id}/delete`
}

// The id of a blurt's <article>, so a like form's redirect lands back at the blurt.
export function blurtAnchor(blurt: Blurt): string {
  return `blurt-${blurt.id}`
}

// Where the next page of each list lives. Plain links, so paging works without JS.
export function olderBlurtsUrl(path: string, next: string): string {
  return `${path}?before=${next}`
}

export function moreRepliesUrl(blurt: Blurt, next: string): string {
  return `${blurtUrl(blurt)}?after=${next}`
}

export function notificationsPath(username: string, { read = false, before = '' } = {}): string {
  const query = [read && 'read=1', before && `before=${before}`].filter(Boolean).join('&')
  return `/${username}/notifications/${query ? `?${query}` : ''}`
}

export function nearPageUrl(radius: number, next?: string): string {
  return `/near?radius=${radius}${next ? `&before=${next}` : ''}`
}

export function searchUrl(query: string, next?: string): string {
  return `/search?q=${encodeURIComponent(query)}${next ? `&before=${next}` : ''}`
}

export function peoplePageUrl(next?: string): string {
  return next ? `/people?after=${next}` : '/people'
}

// Where "Use JavaScript" is offered (src/javascript.ts): in Settings for logged-in users,
// on the About page for everyone.
export function javascriptSettingPath(loggedIn: boolean): string {
  return loggedIn ? '/settings#javascript' : '/about#javascript'
}
