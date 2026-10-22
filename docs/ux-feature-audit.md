# blurt.trade UX feature audit (current implementation)

## Scope reviewed

- Route handlers in `src/routes/*`
- Page templates in `src/templates/index.ts` and `src/templates/layout.ts`
- Route contract docs in `docs/routes.md`
- Server route wiring in `src/server.ts`

## Implemented features

### Core blurting and reading

- Home feed at `/` with paging.
- Everyone feed at `/everyone`.
- Composer for logged-in users (`POST /api/blurts`) and reply composer on thread pages.
- Blurt thread page at `/:username/:id` with parent context, replies, and related blurts.
- Keyset pagination links for older blurts and more replies.

### Discovery and relevance

- Discovery sections in feed: "You might like" (embedding similarity) and "Near you".
- Related blurts on thread page.
- Search page `/search` for usernames and blurts.
- Nearby blurts page `/near` with radius selection.

### Social graph and interaction

- Follow/unfollow from profile pages.
- Like/unlike on blurts (feed, profile, search, near, thread).
- Report flow for blurts (with optional reason).

### Identity, auth, and account lifecycle

- Sign-up (`/signup`), login (`/login`), logout, logout everywhere.
- Invite-code onboarding and waitlist states.
- Settings page (`/settings`) and delete-account confirmation (`/settings/delete`).
- Profile page (`/:username/`) and edit page (`/:username/edit`).
- Avatar customization and random avatar action.
- Optional coarse location setting/editing.

### Moderation and trust/safety

- Admin reports queue (`/admin/reports`) with dismiss and delete actions.
- Per-route rate limiting for spam/abuse-sensitive actions.
- Security/privacy/legal pages: `/about`, `/terms`, `/privacy`.

### Platform/ops surfaces

- Health endpoint `/healthz`.
- `robots.txt` and `sitemap.xml`.

## Current information architecture observations

- Search is globally visible on every page.
- Footer legal links are globally visible.
- Logged-in navigation is partially fragmented:
  - Main feed shows quick links to Near, Settings, Logout.
  - Other key destinations (profile, everyone feed, search context, thread-return paths) are page-dependent.
- Several actions are intentionally in `<details>` expanders (delete/report), which are discoverable but secondary.
- Core posting intent is already strong on home feed (composer sits near the top), but not framed as the unambiguous first interaction area.

## Potentially missing product features (not currently implemented)

These are common for a Twitter-like experience and appear absent in routes/templates:

- Notifications page and notification feed.
- Direct messages/inbox.
- Dedicated followers/following list pages (counts exist, list pages do not).
- Bookmarks/saves.
- Reblurt/repost/quote flow.
- Hashtags/topics and trending/explore destination.
- Media attachments in blurts (image/video upload).
- Mute/block controls.
- In-app onboarding/help walkthrough for first-time users.

## UX implications for the new skeletal framework

- Keep composer-first hierarchy on the logged-in home screen (primary focus above feed list).
- Use persistent, always-visible navigation to all key destinations (no hidden menus).
- Include explicit top-level access to: Home, Everyone, Search, Near, Profile, Settings, plus clearly marked placeholders for missing-but-expected areas (Notifications, Messages).
- Preserve clear action visibility for posting, replying, liking, following, and reporting.
