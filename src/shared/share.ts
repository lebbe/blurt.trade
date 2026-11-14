// Where a blurt or a profile can be shared to: plain links to each service's own share
// page, filled in with the page's address and a title. The Share popup lists them
// (src/ui/share.ts, opened by src/client/share.ts). Nothing here loads anything from those
// services; a link only takes the visitor there once they click it.

// The longest title a share gets (user text is cut with preview(), src/ui/text.ts). The
// same as the share previews' og:title (src/pages/shared/layout.ts).
export const shareTitleMax = 70

export type ShareTargetId =
  | 'linkedin'
  | 'facebook'
  | 'x'
  | 'email'
  | 'reddit'
  | 'bluesky'
  | 'threads'
  | 'mastodon'
  | 'whatsapp'
  | 'telegram'
  | 'pinterest'

export type ShareTarget = { id: ShareTargetId; name: string; href: string }

// `url`: the absolute, canonical address of what is shared. `title`: a short text to go
// with it (may be empty). `hasPicture`: Pinterest pins pictures, so it is only offered for
// blurts with one; `media` is the absolute address of the picture to pin, if known (the
// blurt's share card), otherwise Pinterest picks one from the page's og:image.
export function shareTargets({
  url,
  title,
  hasPicture,
  media,
}: {
  url: string
  title: string
  hasPicture: boolean
  media?: string
}): ShareTarget[] {
  const u = encodeURIComponent(url)
  const t = encodeURIComponent(title)
  // For services that take a single text: the title, a space, the address.
  const both = title === '' ? u : `${t}%20${u}`
  const targets: ShareTarget[] = [
    {
      id: 'linkedin',
      name: 'LinkedIn',
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}`,
    },
    { id: 'facebook', name: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { id: 'x', name: 'X (Twitter)', href: `https://twitter.com/intent/tweet?url=${u}&text=${t}` },
    { id: 'email', name: 'Email', href: `mailto:?subject=${t}&body=${u}` },
    { id: 'reddit', name: 'Reddit', href: `https://www.reddit.com/submit?url=${u}&title=${t}` },
    { id: 'bluesky', name: 'Bluesky', href: `https://bsky.app/intent/compose?text=${both}` },
    { id: 'threads', name: 'Threads', href: `https://www.threads.net/intent/post?text=${both}` },
    // People are on different Mastodon servers; this third-party page asks which one.
    { id: 'mastodon', name: 'Mastodon', href: `https://mastodonshare.com/?text=${t}&url=${u}` },
    { id: 'whatsapp', name: 'WhatsApp', href: `https://api.whatsapp.com/send?text=${both}` },
    { id: 'telegram', name: 'Telegram', href: `https://t.me/share/url?url=${u}&text=${t}` },
  ]
  if (hasPicture) {
    const pin = `https://pinterest.com/pin/create/button/?url=${u}&description=${t}`
    targets.push({
      id: 'pinterest',
      name: 'Pinterest',
      href: media ? `${pin}&media=${encodeURIComponent(media)}` : pin,
    })
  }
  return targets
}
