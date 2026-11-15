# Routes

One path per resource. The `Accept` header picks the representation, not the URL:

| `Accept`                        | Response                                        |
| ------------------------------- | ----------------------------------------------- |
| `text/html`, `*/*`, none        | The HTML page                                   |
| `application/json`              | The data the page is rendered from, as is       |
| `text/markdown` or `text/plain` | The same data as Markdown (forms are described) |
| anything else                   | `406 Not Acceptable`                            |

Each GET route fetches its data once and hands it to `represent()` in
`src/negotiate.ts`, which sends it as JSON or renders it with the page's HTML template
or Markdown template. Responses carry `Vary: Accept`. The components the pages share and
that a browser could run too (see Shared components) are in `src/ui/`.

Each page has a folder in `src/pages/` (server only), e.g. `src/pages/feed/`:

| File           | What                                                                       |
| -------------- | -------------------------------------------------------------------------- |
| `data.ts`      | The type of the data (what JSON clients get) and its helpers (URLs, texts) |
| `feed.html.ts` | The HTML page: its components and `renderFeedPage()`                       |
| `feed.md.ts`   | The Markdown view: `feedMarkdown()`                                        |

The folders are `feed`, `blurt`, `profile`, `profile-edit` (its settings forms in
`forms.ts`), `notifications`, `search`, `near`, `people`, `settings` (with
`/settings/delete`), `info` (`/about`, `/terms`, `/privacy`), `admin` (`/admin`,
`/admin/reports`), `auth` (`/login`, `/signup`, `/waitlist`) and `error` (error pages).
What more than one page uses is in `src/pages/shared/`: the document and frame
(`layout.ts`), the `md` template (`markdown.ts`), small components (`components.ts`), the
blurt form (`composer.ts`) and the Markdown of blurts (`blurts.md.ts`). A component only
one page uses stays in that page's folder. JavaScript enhancers stay in `src/client/`
(only `src/ui`, `src/shared` and `src/client` are ever served to the browser), and the
page marks the elements they enhance with `data-enhance`.

HTML responses carry `Link: <url>; rel="alternate"; type="text/markdown"` for the same
URL. `/llms.txt` (llmstxt.org format, in `src/routes/crawl.ts`) describes this to
agents, next to `/robots.txt` and `/sitemap.xml`.

`fetch()` sends `Accept: */*` by default, which gets HTML. Send
`Accept: application/json` to get JSON, from GET and POST routes alike.

## Pages (GET)

`viewer` is the logged-in user (`{ id, username }`) or `null`, on every page.

| Path                        | Auth  | JSON                                                                                                                                         | Errors                  |
| --------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `/`                         | —     | `{ viewer, feed, hasFollowingFeed, followedBlurts, blurts, discovery, next }`                                                                | 400 bad cursor          |
| `/everyone`                 | —     | the same, always the everyone feed                                                                                                           | 400 bad cursor          |
| `/:username/`               | —     | `{ viewer, profile, invitedBy, inviteCodes, follows, blurts, next }`                                                                         | 400, 404 no such user   |
| `/:username/:id`            | —     | `{ viewer, blurt, parent, reported, replies, next, related }`                                                                                | 400, 404 no such blurt  |
| `/:username/edit`           | owner | `{ viewer, profile, location, notifications, push }` (`push` only when VAPID keys are set: `{ publicKey, thisDevice, devices }`)             | 401, 403 not owner, 404 |
| `/notifications/`           | —     | 303 → `/:username/notifications/` of the viewer (query kept), or `/login`                                                                    |                         |
| `/api/events`               | yes   | `text/event-stream`, see Live updates                                                                                                        | 401, 429 too many tabs  |
| `/sw.js`                    | —     | the service worker (`src/client/sw.ts`, types stripped), see Push notifications                                                              |                         |
| `/manifest.webmanifest`     | —     | the web app manifest                                                                                                                         |                         |
| `/:username/notifications/` | owner | `{ viewer, read, unread, notifications, next, push }` (`push` on the unread page only, when VAPID keys are set: `{ publicKey, thisDevice }`) | 400, 401, 403 not owner |
| `/near`                     | yes   | `{ viewer, location, radius, radii, blurts, next }`                                                                                          | 400, 401                |
| `/search`                   | —     | `{ viewer, query, users, blurts, next }`                                                                                                     | 400, 429                |
| `/people`                   | —     | `{ viewer, people, next }`                                                                                                                   | 400 bad cursor          |
| `/login`                    | —     | `{ viewer }`                                                                                                                                 |                         |
| `/signup`                   | —     | `{ viewer, signup, inviteCode }`                                                                                                             |                         |
| `/waitlist`                 | —     | `{ viewer, signup, waiting, username, entry }`                                                                                               |                         |
| `/settings`                 | yes   | `{ viewer, activeSessions }`                                                                                                                 | 401                     |
| `/settings/delete`          | yes   | `{ viewer }`                                                                                                                                 | 401                     |
| `/admin`                    | admin | `{ viewer, limits }`                                                                                                                         | 401, 403 not an admin   |
| `/admin/reports`            | admin | `{ viewer, reports }`                                                                                                                        | 401, 403 not an admin   |
| `/about`                    | —     | `{ viewer, contact }`                                                                                                                        |                         |
| `/terms`                    | —     | `{ viewer, contact }`                                                                                                                        |                         |
| `/privacy`                  | —     | `{ viewer, contact }`                                                                                                                        |                         |

- `/` is the following feed (`feed: 'following'`: top-level blurts from accounts you
  follow, and what they reblurted) when you're logged in and follow more than 10
  accounts. Otherwise it's the everyone feed (`feed: 'everyone'`), and if you follow
  anyone, `followedBlurts` holds the latest 5 from them (reblurts included), shown on
  top of the first page (empty otherwise). `hasFollowingFeed` says whether you get the
  following feed, and with it Following / Everyone tabs. `/everyone` is the everyone
  feed for everybody without followed-account highlights; it leaves plain reblurts out,
  since their originals are in it already (see Reblurts).
- `discovery` holds "discovery" sections mixed into the first page of either feed for
  logged-in viewers (empty otherwise, and on later pages): `{ kind, after, blurts }`,
  shown after the first `after` of `blurts`. One section after every 20 blurts (one at
  the end of a shorter page), up to 3 blurts each. `kind: 'similar'` ("You might like")
  is top-level blurts close in meaning to the average embedding of the viewer's latest
  20 blurts and replies. Discovery never shows the viewer's own blurts, blurts from
  accounts they follow, or blurts already on the page. New users, with nothing embedded
  yet, get no section. `kind: 'nearby'` ("Near you") is the latest top-level blurts from
  people whose location is within 250 km of the viewer's (none without a location). With
  both kinds, sections take turns (similar first), and a blurt both find shows once. The
  HTML renders them as plain sections between the blurts, so they work without JS.
- `follows` is `{ followerCount, followingCount, viewerFollows }`. `viewerFollows` is
  `false` for anonymous visitors and on your own profile.
- `Blurt` is `{ id, username, text, createdAt, parentId, parentUsername, replyCount,
  avatar, deleted, likeCount, viewerLikes, reblurtCount, viewerReblurted, reblurtedBy,
  quoted }`,
  with `createdAt` as an ISO 8601 string and `avatar` the blurter's (see Avatar below).
  `deleted` is `true` for a deleted blurt's placeholder in a thread, whose `username`,
  `text`, `avatar` and `quoted` are `null` (see Deleting and reporting). A `FeedItem` is
  a top-level blurt plus `replies`, its latest two replies. `likeCount` is how many
  people like it, `viewerLikes` whether you do (`false` for anonymous visitors), on every
  page that lists blurts (see Likes); `reblurtCount` and `viewerReblurted` the same for
  plain reblurts (see Reblurts). `parentUsername` is the author of the blurt it replies
  to (`null` for top-level blurts, and when that one was deleted); lists show "Replying
  to" with it. `reblurtedBy` is set when this item of a list is someone's plain reblurt
  of it. `quoted` is the blurt a quote-reblurt quotes, `{ id, username, text, createdAt,
  avatar, deleted }`, or `null`.
- `reported` on a blurt page says whether the viewer has reported the blurt (`false`
  for anonymous viewers).
- `reports` on `/admin/reports` is `[{ blurt, reports: [{ reporter, reason, createdAt }] }]`:
  blurts with open reports, the one reported first on top (up to 100), each with its
  open reports, oldest first. `reason` is `''` when none was given.
- Lists come in pages of 100. `next` is an opaque cursor for the page after this one, or
  `null` on the last page: `/?before=<next>` and `/:username/?before=<next>` for older
  blurts (newest first), `/:username/:id?after=<next>` for later replies (oldest first).
  The HTML has the same as an "Older blurts" / "More replies" link, so it works without
  JS. Cursors are keyset positions on `(created_at, id)`, so pages don't shift as new
  blurts arrive. A plain reblurt sits in a list at its own row's position (when it was
  reblurted), not the original's. A malformed cursor is a 400.
- `parent` is `null` for a top-level blurt. `related` is empty until the blurt's
  embedding has been computed.
- `profile` is `{ userId, username, homepage, x, instagram, tiktok, youtube, github,
  linkedin, bio, avatar }`. Empty fields are `''`.
- `invitedBy` is the username of whoever invited the profile's owner, or `null`.
  `inviteCodes` is only there for the owner (`null` for anyone else): their codes as
  `{ code, usedBy, usedAt, expiresAt, createdAt }`, unused first. `usedBy` is the
  invitee's username, `expiresAt` `null` for codes that never expire.
- `signup` is `'open'`, `'invite'` or `'waitlist'` (see Sign-up limits below).
  `/waitlist?username=<name>` looks that name up: `username` echoes it (or `null`), and
  `entry` is `{ username, status: 'waiting' | 'joined', createdAt }` or `null`. `waiting`
  is how many entries are still waiting. `/signup?invite=<code>` fills in the form's
  invite code (`inviteCode`, or `null`), so a shared link is all an invitee needs.
- `activeSessions` is how many browsers and devices the viewer is logged in on.
  `/settings` also links to `/settings/delete` (see Deleting an account).
- `location` is the viewer's own `{ lat, lon }` or `null` (see Location below). It is
  only on `/:username/edit` and `/near`, which only the owner sees, never on profiles.
- `/near?radius=<km>` is "blurts near you": top-level blurts (with their latest two
  replies) from other people whose location is within `radius` km of yours, newest
  first, paged like the feed (`/near?radius=<km>&before=<next>`). `radius` is one of
  `radii` (50, 100, 250, 500, 1000, 2500), 250 when left out, anything else a 400. The
  HTML picks it with a `<select>` in a GET form. Without a location, `blurts` is empty
  and the page links to the edit page.
- `/people` lists everyone with a live account, alphabetically (case-insensitive), 50 a
  page. `people` is `{ username, avatar, bio, joinedAt, blurtCount, followerCount,
  lastBlurtAt }`: `blurtCount` counts blurts, replies and quotes that still exist (not
  plain reblurts), `lastBlurtAt` is `null` for someone who never blurted. `next` is the
  cursor for `/people?after=<next>`, the last username of the page in lower case (keyset
  paging on `lower(username)`, never OFFSET); `null` on the last page.
- `/search?q=<words>` searches usernames and blurt text. Every HTML page has the search
  box, a plain GET form (`role="search"`), above its own header, so it works without JS.
  `users` is `[{ username, avatar }]`: usernames containing `q` (a leading `@` is
  dropped), ignoring case, those starting with it first (shortest first, so an exact
  match leads), then the rest, up to 20, on the first page only. `blurts` is blurts and
  replies (and quotes) whose own text matches, newest first, paged like the feed
  (`/search?q=<words>&before=<next>`). The text search is Postgres full-text search with
  the `simple` configuration (lower case, no stemming, no stop words, so Norwegian and
  English work alike, but `cats` doesn't find `cat`) and `websearch_to_tsquery`: every
  word must match, `"quoted phrases"`, `or` and `-word` work, punctuation alone matches
  nothing. A GIN index on `to_tsvector('simple', text)` serves it. Deleted blurts and
  plain reblurts have no text, so they never match. A missing, empty or malformed `q` (`?q[]=`, `?q=a&q=b`) is an empty search
  (`query: ''`, a friendly page); one over 200 characters is a 400. `query` is echoed
  escaped and is never logged (request lines leave out the query string).
- The page decides `canEdit` itself: `viewer?.id === profile.userId`.
- `/about`, `/terms` and `/privacy` are fixed text, linked from the footer of every HTML
  page. `/about` is the contact page: GitHub issues for anything public, and where not
  to post sensitive things (security holes, illegal content, personal data).
  `contact` is `{ email, issuesUrl, securityUrl }`, each `null` when not configured:
  `CONTACT_EMAIL`, and `CONTACT_REPO_URL` for the issues and private vulnerability
  report links (docs/deploy.md, Environment).
- The front page's (`/`, `/everyone`) "About this site" panel also has a "Submit
  suggestions" link to the GitHub issues, when `CONTACT_REPO_URL` is set.
- `/privacy` lists what the database stores. A test compares every table and column
  with a fixed list, so a migration that changes them fails until the page (and the
  list) is updated.
- Data minimisation is a standing rule: no email addresses, no analytics, no
  third-party scripts, fonts or embeds, no cookies beyond the session and `recent_write`
  cookies (so no cookie banner), no IP addresses stored. There is no password reset: a
  lost password can't be recovered, and sign-up and the login page say so. This was
  decided over email reset and recovery codes (ticket 024): don't add a reset route.

## Actions (POST)

A POST shares its path with its GET page, so a failed form re-renders at the same URL.
POSTs without a page of their own live under `/api/`. Bodies are form-encoded or JSON
(`Content-Type: application/json`).

| Path                             | Auth          | Body                                                                                      | Form success                                                    | JSON success                                                                                                     |
| -------------------------------- | ------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `/signup`                        | —             | `username`, `password`, `inviteCode`, `remember`                                          | 303 → `/`                                                       | 201 `{ id, username }`, Location `/:username/`                                                                   |
| `/waitlist`                      | —             | `username`                                                                                | 303 → `/waitlist?username=`                                     | 201 the `entry`, Location the same                                                                               |
| `/login`                         | —             | `username`, `password`, `remember`                                                        | 303 → `/`                                                       | 200 `{ id, username }`                                                                                           |
| `/:username/edit`                | owner         | profile fields (missing → cleared)                                                        | 303 → profile                                                   | 200 the updated `profile`                                                                                        |
| `/api/blurts`                    | yes           | `text`, `parentId` or `reblurtOfId`, optional `picture` (file)                            | 303 → feed/parent/quote                                         | 201 the new blurt as a `FeedItem` (`replies: []`, the viewer's flags), Location `/:username/:id`                 |
| `/api/blurts/:id/delete`         | author, admin | —                                                                                         | 303 → back (see Deleting)                                       | 204                                                                                                              |
| `/api/report`                    | yes           | `blurtId`, optional `reason`                                                              | 303 → `/:username/:id`                                          | 204                                                                                                              |
| `/api/admin/reports/dismiss`     | admin         | `blurtId`                                                                                 | 303 → `/admin/reports`                                          | 204                                                                                                              |
| `/api/admin/blurts/delete`       | admin         | `blurtId`                                                                                 | 303 → `/admin`                                                  | 204                                                                                                              |
| `/api/admin/invites`             | admin         | `username`, `count`, optional `days`                                                      | 201 `/admin` with the codes                                     | 201 `{ username, codes }`                                                                                        |
| `/api/admin/signup-limits`       | admin         | `softLimit`, `hardLimit`                                                                  | 303 → `/admin`                                                  | 200 `{ count, softLimit, hardLimit, state }`                                                                     |
| `/api/follow`                    | yes           | `username`                                                                                | 303 → profile                                                   | 200 their `follows`                                                                                              |
| `/api/unfollow`                  | yes           | `username`                                                                                | 303 → profile                                                   | 200 their `follows`                                                                                              |
| `/api/like`                      | yes           | `blurtId`                                                                                 | 303 → back (see Likes)                                          | 200 `{ blurtId, likeCount, viewerLikes }`                                                                        |
| `/api/unlike`                    | yes           | `blurtId`                                                                                 | 303 → back (see Likes)                                          | 200 `{ blurtId, likeCount, viewerLikes }`                                                                        |
| `/api/reblurt`                   | yes           | `blurtId`                                                                                 | 303 → back (see Reblurts)                                       | 200 `{ blurtId, reblurtCount, viewerReblurted }`                                                                 |
| `/api/unreblurt`                 | yes           | `blurtId`                                                                                 | 303 → back (see Reblurts)                                       | 200 `{ blurtId, reblurtCount, viewerReblurted }`                                                                 |
| `/api/notifications/settings`    | yes           | `replies`, `reblurts`, `followedBlurts` (left out → off)                                  | 303 → `/:username/edit#notifications`                           | 200 the settings                                                                                                 |
| `/api/notifications/read`        | yes           | optional `id`                                                                             | 303 → `/:username/notifications/`                               | 200 `{ unread }`                                                                                                 |
| `/api/push/subscriptions`        | yes           | a `PushSubscription` as JSON (`endpoint`, `keys.p256dh`, `keys.auth`), or those as fields | 303 → `/:username/edit#notifications`                           | 201 `{ subscribed: true }`                                                                                       |
| `/api/push/subscriptions/delete` | yes           | optional `endpoint` (left out: all of the user's devices)                                 | 303 → `/:username/edit#notifications`                           | 200 `{ subscribed: false }`                                                                                      |
| `/api/location`                  | yes           | see Location below                                                                        | 303 → `/:username/edit`                                         | 200 `{ location, timeZone }` (the zone it set, or `null`)                                                        |
| `/api/avatar`                    | yes           | see Avatar below                                                                          | 303 → `/:username/edit`                                         | 200 `{ avatar }`                                                                                                 |
| `/api/profile-picture`           | yes           | multipart `picture` (+ optional `cut`), or `remove` (see Profile picture)                 | 303 → `/:username/edit#picture`                                 | 200 `{ avatar }`                                                                                                 |
| `/api/profile-picture/cut`       | yes           | `cut.x` + `cut.y`, or `cut` (see Profile picture)                                         | 303 → `/:username/edit#picture`                                 | 200 `{ avatar }`                                                                                                 |
| `/api/theme`                     | yes           | `theme` (see Themes below)                                                                | 303 → `/:username/edit`                                         | 200 `{ theme }`                                                                                                  |
| `/api/timezone`                  | yes           | `timezone` (IANA name) and/or `locale` (empty: the browser's)                             | 303 → `/:username/edit#timezone`                                | 200 `{ timezone?, locale?, display: { timeZone, locale } }`: what was sent, and how pages show times from now on |
| `/api/javascript`                | —             | `javascript`: `on` or `off` (JSON: also `true`/`false`)                                   | 303 → `/settings#javascript` (logged in) or `/about#javascript` | 200 `{ javascript }`                                                                                             |
| `/api/logout`                    | —             | —                                                                                         | 303 → `/`                                                       | 204                                                                                                              |
| `/api/logout-everywhere`         | yes           | —                                                                                         | 303 → `/login`                                                  | 204                                                                                                              |
| `/settings/delete`               | yes           | `password`                                                                                | 303 → `/`                                                       | 204                                                                                                              |

Following yourself is a 400 and an unknown `username` a 404. Following twice, or
unfollowing someone you don't follow, does nothing.

Login and sign-up also set the session cookies, for JSON callers too.

### Pictures

`POST /api/blurts` also takes `multipart/form-data` (the form does), with an optional
`picture` file: JPEG, PNG, WebP or GIF, at most 15 MB (413 `Picture is too large`). The
server redraws it as a rough drawing (`src/picture.ts`) and stores only that, never the
upload. A file that is no image, or a drawing over 64 KB, is a 400 on the field `picture`.
Pictures are drawn in two worker threads, with at most 8 uploads waiting; when all are busy
the answer is a 503 (`Retry-After: 5`) and nothing is saved. A picture that takes over 4 s
is refused like an unreadable one (400 on `picture`). The blurt is saved only once its
picture is.
The text is still required. A blurt with a picture has an `<img>` in HTML and
`![Picture](/pictures/{id}.svg)` in Markdown; quotes don't show it. Deleting the blurt
deletes the picture.

The drawing itself is shared code (`src/shared/picture/`: `draw.ts` turns RGBA pixels into
shapes, `shapes.ts` is the stored format, `svg.ts` draws it). Only decoding and scaling,
with sharp, is the server's own (`decodeUpload` in `src/picture.ts`). The browser runs the
same code for its previews (see "Pictures drawn in the browser" below); the server still
draws every upload itself.

In JSON (any GET), a blurt without a picture has `picture: null`, and one with a picture
`picture: { width, height, url, data }`: `url` is `/pictures/{id}.svg`, and `data` is the
stored drawing itself, as base64 (the binary format of `encodeShapes` in `src/picture.ts`,
at most 64 KB before base64). `?pictures=` changes that, on any JSON GET (an unknown value
is the default):

| `?pictures=`     | `picture`                                                         |
| ---------------- | ----------------------------------------------------------------- |
| `data` (default) | `{ width, height, url, data }`, `data` the drawing as base64      |
| `svg`            | `{ width, height, url, svg }`, `svg` the markup of `url`          |
| `none`           | `{ width, height, url }`, for clients that fetch `url` themselves |

The share card of a blurt with a picture (its `og:image` and `twitter:image`) is drawn on the
picture: the drawing fills the 1200 × 630 card, cropped to fit, under a dark veil, with the
avatar and the text on top. It is a JPEG, `/og/{id}-{hash}.jpg` (`og:image:type`
`image/jpeg`); every other card stays a PNG, `/og/{id}-{hash}.png`. The wrong extension
redirects (302) like a stale hash.

| Path                | Auth | Response                                                | Errors                                  |
| ------------------- | ---- | ------------------------------------------------------- | --------------------------------------- |
| `/pictures/:id.svg` | —    | `image/svg+xml`, `Cache-Control: public, max-age=86400` | 404 no picture, or the blurt is deleted |

## Likes

Every blurt shows its like count, and to logged-in viewers a Like (or Unlike) button: a
plain form with `blurtId`, so it works without JS, on the feeds, profiles, `/near` and
blurt pages. Code: `setLike` in `src/routes/state/reactions.ts` and `markViewerFlags` in `src/routes/state/blurts.ts`, the routes
in `src/routes/blurts.ts`.

- `POST /api/like` and `POST /api/unlike`, the same shape as follow and unfollow.
  Liking twice, or unliking a blurt you don't like, does nothing. Your own blurts can be
  liked. An unknown, deleted or placeholder blurt is a 404. A plain reblurt's id likes
  its original. Forms go back to the page they came from (its `Referer`, same host only)
  at `#blurt-<id>`, the blurt's `<article>`; without one, to the blurt's page. JSON
  callers get `{ blurtId, likeCount, viewerLikes }`.
- The count is in `blurt_stats`, a narrow table of counters (`like_count`,
  `reblurt_count`; no row means zero), so lists never count likes, and a like never
  rewrites the blurt row (with its 1.5 KB embedding). `setLike` takes key-share locks
  on the user and the blurt (so it can't race a deletion), inserts or deletes the
  `likes` row, and changes the count by one only if that did something, in one
  transaction. Concurrent likes of one blurt queue only briefly on its tiny
  `blurt_stats` row, and none is lost. `viewerLikes` is one query per page for all the
  blurts on it (`markViewerFlags`), from the replica like the lists.
- Who liked what is private: only counts are shown. Deleting a blurt deletes its likes
  and counters; deleting an account takes its likes off every count, then deletes them.
- Rate limited per account, one budget for both (`LIKE`).

## Reblurts

A reblurt is a row in `blurts` that points at another blurt (`reblurt_of_id`, plus
`reblurt_of_user_id`, the original's author, so a sharded lookup of the original goes to
one shard). So feeds, profiles and their cursors stay single-table queries, and reblurts
reach followers' feeds with no extra work. Code: `setReblurt`, `addBlurt` and the shown
blurt query (`shownFrom`) in `src/routes/state/blurts.ts`, the routes in `src/routes/blurts.ts`.

| Row           | `reblurt_of_id` | `text` | Shown as                                       |
| ------------- | --------------- | ------ | ---------------------------------------------- |
| Blurt / reply | `NULL`          | set    | its own text                                   |
| Plain reblurt | set             | `NULL` | the original, with "Reblurted by X" above it   |
| Quote-reblurt | set             | set    | its own text, with the original embedded below |

"Plain reblurt" is `reblurt_of_id IS NOT NULL AND text IS NULL AND deleted_at IS NULL`
(a deleted quote also has `reblurt_of_id` and no text). The app writes it once, as
`plainReblurt()`; the partial indexes repeat it.

- **Plain reblurts.** `POST /api/reblurt` and `POST /api/unreblurt` with `blurtId`, the
  same shape as like and unlike: a Reblurt / Undo reblurt button with the count, on
  every blurt in feeds, profiles, `/near` and blurt pages, no JS needed. JSON callers get
  `{ blurtId, reblurtCount, viewerReblurted }`. One plain reblurt per user and original (a
  unique partial index), so reblurting twice does nothing. Your own blurt is a 400
  (quote it instead); an unknown or deleted one a 404. Reblurting a plain reblurt stores
  its original: a plain reblurt always points at content, so reads resolve in one step.
  Un-reblurting deletes the row, like unliking: a plain reblurt has no content and
  nothing hangs off it. It is the one kind of `blurts` row that is ever removed.
- A plain reblurt has no page, text or embedding, isn't searched, and can't be liked,
  replied to or reported itself: its id in those actions acts on the original, and the
  buttons on it are the original's.
- **Quotes.** The quote form is on the blurt's page (`#quote`); every blurt has a Quote
  link to it. It is the compose form with a hidden `reblurtOfId`: `POST /api/blurts` with
  `text` and `reblurtOfId` makes a blurt of its own, with the original shown under it
  (`quoted`). The usual input limits and the `BLURT` rate limit apply. Forms go to the new
  quote's page. A quote is ordinary content: it is liked, replied to, reported, searched
  and embedded. You can quote your own blurts, and the same blurt many times. A quote of
  a quote points at that quote, and only one level is shown. Quoting a plain reblurt
  quotes its original. `parentId` and `reblurtOfId` together are a 400.
- Replies can be reblurted and quoted; lists show "Replying to X" on them.
- `reblurtCount` counts plain reblurts (not quotes), from `blurt_stats.reblurt_count`,
  kept like the like count. `viewerReblurted` comes from the same per-page query as
  `viewerLikes`, answered by the unique index.
- **Feeds.** Plain reblurts by accounts you follow are in the following feed and in
  `followedBlurts`, shown as the original with `reblurtedBy`. When several people you
  follow reblurt the same blurt (or reblurt one by someone you follow), it shows once, at
  its newest row: a row is left out when a newer row of the same blurt is in the feed.
  That holds across pages too. The reblurter's profile lists their plain reblurts and
  quotes with their blurts. The everyone feed, `/near` and discovery list only content.
- Rate limited per account, one budget for both (`REBLURT`).

### The shown blurt query

What a row shows is decided in one place, `shownFrom` / `shownWhere` / `selectShown` in
`src/routes/state/blurts.ts`, and every list, thread, search and single-blurt query uses it. It
follows a plain reblurt to its original, hides stale references, hides deleted authors,
and joins the counters. Each query writing its own join is how a `deleted_at IS NULL`
gets forgotten. `r` is the row in the list (filtered and ordered on), `b` the blurt it
shows.

- A plain reblurt whose original is deleted, or whose reblurter's account is deleted, is
  never shown, even before cleanup has removed it.
- Deleted blurts show as placeholders only in threads and on their own page; every
  list leaves them out.
- The author of a deleted blurt, or of anything by a deleted account, is never joined:
  `username`, `avatar` are `null`. Rows keep `user_id`; the reads never use it then.

## Deleting and reporting

Plain forms, so all of it works without JS. Code in `src/routes/blurts.ts`,
`src/routes/admin.ts` and `deleteBlurts` in `src/routes/state/blurts.ts`.

- Your own blurts have a "Delete" `<details>` on them, which opens a "Delete" button:
  two clicks, no JS (with JavaScript, a `<dialog>` asks instead; see JavaScript in the
  browser). `POST /api/blurts/:id/delete` deletes it. Anyone else's blurt is a
  403 (unless you're an admin), an unknown or already deleted one a 404. Forms go back
  to the page they came from (its `Referer`, same host only), unless that was the
  deleted blurt's own page: then to the thread it replied to, or `/`.
- **A content row (blurt, reply, quote) is never removed.** Deleting sets `deleted_at`
  and removes its text and embedding (`NULL`, enforced by a `CHECK`). It keeps `user_id`
  (the future sharding key, which must never change), `parent_id` and `reblurt_of_id`.
  "A deleted blurt says nothing about who wrote it" is enforced when reading (see The
  shown blurt query), not in the data. Its page is a placeholder, "This blurt was
  deleted", at `/deleted/:id` (its old `/:username/:id` link still works), and replies
  stay readable under it. Placeholders never show in feeds, profiles, discovery or
  related blurts, and can't be replied to, liked, reblurted, quoted, reported or deleted
  again. Quotes of a deleted blurt show "Content is deleted" for the embedded part.
- `deleteBlurts(ids, client?)` does all of it in one transaction, or inside the
  caller's: account deletion (025) passes all of a user's blurts. It deletes the blurts'
  likes, reports and counters, and the plain reblurts of them (`deleteStaleReblurts`).
  It is safe to run twice.
- **Plain reblurts of a deleted blurt** are removed in the same transaction for now, by
  `deleteStaleReblurts({ of })`. It is written to become a batched background job once
  the data is sharded: without `of` it sweeps any table-wide, `limit` rows at a time,
  and is idempotent. Reads hide those reblurts anyway, so a late or crashed cleanup never
  shows a dead reblurt.
- **The software handles relations, not the database.** No `ON DELETE CASCADE` from or
  into `blurts`: the foreign keys (`user_id`, `parent_id`, `reblurt_of_id`,
  `blurt_stats.blurt_id`) stay as assertions while there is one database, and are
  dropped the day it is sharded (they can't cross shards).
- Every blurt by someone else has a "Report" `<details>` with an optional reason (up to
  500 characters) for logged-in viewers. `POST /api/report` with `blurtId` and `reason`:
  one report per user and blurt, so reporting again does nothing (also after a dismissal).
  Your own blurt is a 400, an unknown one a 404. The blurt page then says "You reported
  this blurt".
- Admins (`users.is_admin`) get `/admin/reports`: blurts with open reports, with the
  reasons and who reported them, and two buttons each. "Delete blurt" is the same
  `POST /api/blurts/:id/delete` (admins may delete any blurt); "Dismiss" is
  `POST /api/admin/reports/dismiss` with `blurtId`, which closes every open report on it
  and leaves the blurt up. Anyone else gets a 403 there. There is no UI for making an
  admin; in psql:

  ```sql
  UPDATE users SET is_admin = true WHERE lower(username) = lower('lars');
  ```

  The flag is read from the database on each admin request, so taking it away works at once.

## Deleting an account

`/settings` links to `/settings/delete`, a confirmation page that says what happens and
asks for the password again (there is no other proof it's the owner: no email, no reset).
`POST /settings/delete` with the right `password` deletes the account; a wrong or
missing one is a 400 on `password` and deletes nothing. It is rate limited per account
(`DELETE_ACCOUNT`), since it runs Argon2 like login. Code: `deleteAccount` in
`src/routes/state/accounts.ts`, the route in `src/routes/users.ts`.

- One transaction. The user's content goes through `deleteBlurts`: the rows stay,
  emptied, and nothing shows them as the user's; one that others replied to reads as a
  placeholder, and their replies stay. The likes they gave and their plain reblurts are
  taken off each blurt's counts and deleted. Then the profile (avatar, location),
  sessions, follows both ways, notifications to and from the user, the user's own invite codes (so "Invited by" disappears
  from their invitees' profiles) and the reports they made are deleted, by the app, not
  by a cascade. The code they signed up with stays used (`used_at`) with
  `used_by_user_id` set `NULL`. Their waitlist entry is deleted.
- **The `users` row stays as a stub**: `deleted_at` set, `username` and `password_hash`
  removed (`NULL`, enforced by a `CHECK`), `is_admin` off. So `blurts.user_id` stays
  valid on the account's rows, and nothing cascades from `users`. Logging in, posting,
  liking, following and reporting all require a live (`deleted_at IS NULL`) user.
- **The username is retired, not freed**: it goes into `retired_usernames` (lower case,
  nothing else), and sign-up and the waitlist treat it as taken, in any letter case.
  Freeing it would let someone sign up as the old account and pass for it, with
  replies and links still pointing at that name. Free one by hand if ever needed:
  `DELETE FROM retired_usernames WHERE username = lower('...');`
- `signup_counter` doesn't go down: it counts sign-ups, not accounts, so deleting
  accounts can't be used to reopen sign-up past its limits.
- Both cookies are cleared, and the account's sessions are gone, so its refresh tokens
  fail everywhere. Its access tokens (checked by signature alone) are also refused by
  this app instance until they run out (5 minutes), from an in-memory list of the
  deleted session ids. With several instances, another one could still show the user
  as logged in for up to 5 minutes, but there is nothing left to read or change: every
  write checks that the user exists and isn't deleted.
- A test checks every table afterwards, by every foreign key to `users` (live rows
  only: the stub and the emptied blurts keep the id on purpose) and by the username
  anywhere in a row, and that the old cookies are rejected.
- Known edge: a sign-up with the same name committing in the very instant the deletion
  commits could slip past the retired check; deletion is rare and that window tiny.

## Notifications

A notification is a row in `notifications` (`user_id` the recipient, `kind`,
`actor_user_id`, `blurt_id`, `created_at`, `read_at`). No JavaScript needed: the page is
a list and the count is a number that refreshes with the page.

- **Kinds.** `reply` (someone replied to your blurt), `reblurt` (someone plain-reblurted
  it), `quote` (someone quoted it) and `followed_blurt` (someone you follow posted a
  top-level blurt). A quote is a reblurt with a comment, so it is switched on and off
  with reblurts, but it is its own row type with its own wording ("quoted your blurt").
  A quote of a blurt by someone who follows the quoter gets the `quote` row only, not a
  `followed_blurt` one as well. Replies are not `followed_blurt`s.
- **Never your own actions**: no row where recipient and actor are the same (a `CHECK`).
  Reblurting your own blurt is refused anyway; replying to or quoting yourself makes
  nothing.
- **Settings**, on the profile edit page (`/:username/edit#notifications`): one checkbox
  per kind, saved with `POST /api/notifications/settings`. Stored as
  `user_profiles.notify_replies` (default on), `notify_reblurts` (on) and
  `notify_followed_blurts` (off: it gets noisy). A field left out of the POST is off, as
  in the profile form. They're private: the edit page's JSON has them as `notifications`,
  the public profile doesn't.
- **Created at write time**, only if the recipient has the kind on: in the same
  statement as the blurt (`addBlurt`: replies, quotes, followers) or the same transaction
  as the reblurt (`setReblurt`), so reading never computes anything. Switching a kind on
  adds nothing for what already happened. Posting fans out to followers with one
  `INSERT ... SELECT`; for accounts with very many followers that is the place to
  move to a background job.
- **Cleanup.** Un-reblurting removes its notification. Deleting a blurt (`deleteBlurts`)
  removes the notifications that point at it, and deleting an account the ones to and
  from it, so nothing dangles. Read notifications older than 90 days are pruned hourly
  (`pruneNotifications`); unread ones stay.
- **Alerts** in the top navigation (between Profile and Settings, with the count as a pill in the theme's `--warn` colour) shows only
  while the count is above 0, so phones get a short bar; Your corner always has the
  Notifications link.
- **The count** in "Your corner" (`Notifications (32)`) is unread notifications, counted
  on every page for logged-in viewers from the partial index
  `notifications_unread_idx`, stopping at 100 and shown as `99+`. It lives in the page
  context (`unreadNotifications`), not the access token, which wouldn't follow a number
  that changes this often.
- **Visiting a blurt reads its notifications.** `GET /:username/:id` marks the viewer's
  unread notifications about that blurt as read: ones linking to it (the reply, quote or
  followed blurt itself, or their own reblurted blurt) and ones linking to a reply or quote
  of it (visiting the blurt you wrote that got replied to). It only runs when the page
  context already says the viewer has unread notifications, so most visits do nothing
  extra, and a visit matching nothing writes nothing. Each notification is marked once, so
  writes follow notifications, not page views. The count in the page's frame is the new
  one. The buttons stay for the rest.
- **The page** `/:username/notifications/` is the owner's only (403 for anyone else,
  401 logged out). It lists unread ones, newest first, with `?read=1` the ones already
  read, paged with `before` like the feeds. Each links to the blurt and the actor. "Mark
  all as read" and a per-notification "Mark as read" are plain forms posting to
  `POST /api/notifications/read` (with `id` for one; another user's id is a 404). JSON
  callers get `{ unread }` back.

### Live updates

With JavaScript, every page of a logged-in viewer opens one `EventSource` on
`GET /api/events` (`src/client/live.ts`, server side `src/events.ts`). Without JavaScript
nothing asks for it and everything is as above: the count refreshes with the page.

- **Events.** `unread` `{ "unread": 3 }` at the start and whenever the count changes (a
  new notification, one read in another tab, an un-reblurt). `blurts`
  `[{ id, everyone, following }]` for blurts others posted: `id` is what a feed shows (the
  original, for a plain reblurt), `everyone` whether it tops the everyone feed (top-level
  blurts and quotes), `following` whether it tops this viewer's following feed (posted or
  plain-reblurted by someone they follow). Never the viewer's own. A comment line every
  25 s keeps proxies from timing out. `retry: 3000`.
- **In the page.** `unread` updates the Alerts link in the navigation (added before
  Settings, updated, or taken away, rendered with the shared `NavLink`, `src/ui/nav.ts`),
  the Notifications link in Your corner, the page context and, in an installed app, the
  app badge. `blurts` goes to the feed's list (`data-enhance="new-blurts"`, first page
  only): a button "3 new blurts" under its heading. Nothing moves until it is clicked;
  then the feed's first page is fetched as JSON and the newer blurts are rendered on top
  with the shared card (as endless scrolling does), focus on the first. If none of the
  page's blurts is on the first page any more, the page is loaded instead.
- **Lifetime.** A stream ends when the access token it was opened with runs out (at most
  5 minutes; a little earlier, at random, so tabs don't reconnect together, never later),
  and the browser reconnects, refreshing its tokens on the way, so a logged-out or
  revoked session stops getting updates as soon as its pages would. The page closes it on
  `pagehide` and opens it again on `pageshow` (an open connection keeps a page out of the
  back/forward cache). A refused stream (401, 429) makes `EventSource` give up; the page
  tries again after a minute, then less and less often (at most every 10 minutes).
- **Limits.** At most 5 streams per user per instance (the 6th gets 429), and the `events`
  rate limit on opening them. Each costs a socket, no database connection.
- **Between instances.** Triggers on `notifications` (insert, delete, `read_at` changed)
  and `blurts` (top-level insert) `NOTIFY blurt_events` with a tiny JSON payload of ids
  (db/README.md). NOTIFY is delivered at commit to every listener, so whichever instance
  wrote, every instance hears it. Each instance LISTENs on one connection of its own,
  straight to PostgreSQL (`LISTEN_DATABASE_URL`, docs/deploy.md): PgBouncer in transaction
  mode can't hold a LISTEN. It opens with the first stream, reconnects with backoff if it
  drops (and then sends every stream its count again), and closes with `closeDb()`. Counts
  are recounted from the primary, at most once per user per 100 ms; blurts go out in one
  batch a second.
- **Proxies.** The response is `Cache-Control: no-store, no-transform` and
  `X-Accel-Buffering: no`; the Caddyfile leaves `/api/events` out of `encode`, and the
  nginx config has its own `location` without buffering or gzip.
- **Shutdown.** `closeEventStreams()` ends every stream before `server.close()`, which
  would otherwise wait for them.

### Push notifications

"Notify me on this device" under Notifications on the edit page (`src/client/push.ts`,
markup in `src/ui/push.ts`), and offered at the top of the unread notifications with a
"Not now" (remembered on the device in `localStorage`); the offer only shows where it can
help: not when the device is on already, the browser blocks notifications or can't show
them (iPhones and iPads off the Home Screen are told how),
only when the server has VAPID keys and the page has JavaScript (the button is `hidden`
until the script shows it). The browser's permission is asked for only on the click.

- **Turning it on** registers the service worker `/sw.js` (scope `/`), subscribes with the
  server's public VAPID key, and posts the subscription to `POST /api/push/subscriptions`.
  It is saved in `push_subscriptions` for the user **and the login**: logging out there
  stops the pushes at once (revoked sessions are skipped) and deletes the row with the
  session at the hourly cleanup; account deletion deletes them. Endpoints must be at a
  browser maker's push service (FCM, Mozilla, Apple, WNS: `isPushEndpoint` in
  `src/push.ts`), so the server can't be made to POST anywhere else. On iPhone and iPad
  Safari only offers push from the Home Screen; the button's place says so there.
- **Turning it off** unsubscribes, tells the server and unregisters the worker. A plain
  form, which works without JavaScript, stops pushes on all of the user's devices.
- **Sending** (`src/push.ts`): when `addBlurt` or `setReblurt` saves notifications, the
  route hands the notified users to `pushNotifications`, which POSTs an empty message to
  each device's push service in the background (`TTL` a day, `Topic: notifications` so a
  device that was offline gets one, `Authorization: vapid t=<ES256 JWT>, k=<public key>`,
  signed with `jose`, one token per push service reused for 12 hours). No payload, so no
  encryption, and nothing about the notification passes the push service. 404 and 410
  delete the subscription; other failures are logged.
- **Grouping.** A device is pushed to at most once a minute (`pushed_at`, claimed
  atomically, so across instances too). Notifications within the minute push once when it
  is up, and only if something is still unread.
- **The worker** (`src/client/sw.ts`, a classic script without imports) has no `fetch`
  handler: it caches nothing and never stands between the browser and the site. On a push
  it fetches `/notifications/` as JSON with the browser's cookies and shows one
  notification (`tag: notifications`, replacing the last): the newest one's words for a
  single unread, "3 new notifications" for more. A click opens the blurt (or the
  notifications page). `setAppBadge` shows the count. `skipWaiting` and `clients.claim`
  make a deployed change take over at once; `/sw.js` is `Cache-Control: no-cache` and
  registered with `updateViaCache: 'none'`.
- **The manifest** (`/manifest.webmanifest`, `display: standalone`) and the icons in
  `public/icons/` (made by `node scripts/make-icons.ts` from the favicon) are linked from
  every page, for Add to Home Screen.

## Location

Opt-in and coarse, for "blurts near you" and nearby discovery. Code in
`src/routes/location.ts` and `src/geo.ts`.

- Only the centre of a 1° by 1° grid cell (about 111 km across) is stored, on the
  profile (`user_profiles.location`, a PostGIS `geography(Point)`), never on blurts.
  Everything the server gets is snapped to it first, whatever its precision, and a
  `CHECK` in the database refuses anything else. The raw click is never stored.
- Only its owner sees it: in `/:username/edit` and `/near`. Profiles never show it.
- `POST /api/location` takes one of:
  - `location.x` and `location.y`: a click on the map on the edit page, an
    `<input type="image" name="location">` showing `/static/world-map.svg`
    (equirectangular, 720 × 360 px, 2 px per degree). The browser sends the pixel as a
    plain form POST, so it works without JS. Pixels outside the map are a 400. `0,0` is
    what a keyboard sends for an image input, so it counts as no click (a 400 asking for
    a click).
  - `lat` and `lon` (degrees, `-90..90` and `-180..180`): JSON only, for API
    clients: `{ "lat": 59.91, "lon": 10.75 }`.
  - `clear` (any non-empty value, or JSON `{ "clear": true }`): the "Remove my
    location" button.
- Where `lat` and `lon` are used, outside tests. No page of the site sends them: the edit
  page only sends the map click (`location.x`/`location.y`) and `clear`.
  - `src/pages/profile-edit/profile-edit.md.ts` and `src/pages/near/near.md.ts`: the
    Markdown version of `/:username/edit` (Location section) and of `/near` (when no location is set) tell API clients to
    `POST /api/location` with `lat` and `lon`. This is how an agent sets a location, since
    a map pixel is no use to it.
  - `http/home.http`: the "Set your location from fetch()" example request.
  - `tickets/013b-geo-picker-enhancement.md`: planned to post `{ lat, lon }`. The map's
    script (`src/client/map.ts`) posts the same `location.x`/`location.y` as a click
    without JavaScript instead, so the server's rules stay in one place.
- Errors are 400 with `field` `location`, `lat` or `lon`. Forms get the edit page again
  with the error.
- The edit page shows what is stored, as text and as a marker on the map. The "Remove my
  location" form is always in the page, `hidden` while nothing is stored.
- JSON callers get `{ location, timeZone }`: `timeZone` is the zone the click set (the
  place's), `null` when none was set (removing the location leaves the zone).
- With JavaScript (`src/client/map.ts`, `data-enhance="map"`), a click on the map is the
  same POST (`location.x`/`location.y`, from the click's offset scaled to the image's own
  720 × 360) sent with `fetch()`: the marker moves (or appears), the "Your location" line
  is drawn again (`LocationStatus` in `src/ui/location.ts`, shared with the server), the
  time zone select shows the new zone and the page's times are rewritten in it. Removing
  works the same way. The map takes the keyboard: the arrow keys move a hollow marker one
  grid cell (Shift: ten), Enter or Space saves it there (the help text is the image's
  `aria-describedby`). On `/near` (`return=near`) a saved click loads `/near` again, since
  its blurts depend on the location. One request at a time; of the clicks made meanwhile
  only the newest is sent.
- Radius queries use `ST_DWithin` on the profile points, with a GiST index.

## Avatar

Every profile has a cartoon face instead of a profile picture, in the style of Terrance
and Phillip: the whole top of the head flaps up and down when it talks. Code in
`src/shared/avatar.ts` (the data, palettes and random avatars), `src/avatar.ts` (validation, and `randomAvatar` with `node:crypto`) and `src/ui/avatar.ts` (the SVG).

- `avatar` is `{ headWidth, skin, hairType, hairColor, eyeType, eyeColor, pupilColor,
  toothType, toothColor }`, stored as JSON in `user_profiles.avatar`. Colours are lower-case
  `#rrggbb` (any colour). `headWidth` is `thin`, `slim`, `regular`, `broad` or `huge`
  (the head is stretched sideways, the eyes just move apart); `hairType` is `bald`, `tuft`, `flat`, `spiky`, `mohawk` or
  `afro`; `eyeType` `classic`, `dots`, `round`, `wide`, `sleepy` or `angry`; `toothType`
  `none`, `two`, `buck`, `gap` or `full`.
- Sign-up gives every new profile a random avatar, with colours from fixed palettes so it
  looks normal-ish (`avatarPalettes`). Profiles from before avatars got one in the
  migration, and the head width came later (`regular` for the avatars that existed then).
- The edit page has an avatar form: `<input type="color">` for the colours, `<select>` for
  the types, a live preview, and two submit buttons. "Save avatar" sends every field;
  "Random" (`name="random"`) makes the server pick a new random avatar and save it, so it
  works without JS. With JavaScript the preview (and every other drawing of the viewer's
  avatar on the page) follows the fields as they change, before anything is saved, and
  "Random" is picked in the browser from the same palettes (`randomAvatarWith`) and saved
  like a hand-made change (see JavaScript in the browser). `POST /api/avatar` takes all nine fields, or `random` (any non-empty
  value, or JSON `{ "random": true }`). A missing or invalid field is a 400 on that field;
  forms get the edit page again with the error.
- Nobody uploads SVG. The server draws it from these fields only, as inline SVG with no
  scripts, links or external references. Every value is validated on the way in (zod),
  the database `CHECK`s the same rules, and the template checks them again when drawing
  (anything unexpected gets a default).
- Blurts show the blurter's avatar, on the left of odd blurts and the right of even ones
  (`.blurt:nth-of-type(even)`). A blurt is two boxes: `.blurt-main` (avatar, nick, date,
  text, and the picture edge to edge) and `.blurt-footer` (actions and replies). It talks (CSS animation, no JS) while the pointer is over
  the avatar or its blurt (an uneven chatter of big and small flaps, the jaw bobbing along),
  and holds still with `prefers-reduced-motion`. The profile page
  shows it large.

## Profile picture

Instead of the cartoon avatar, anyone can upload a picture of their own. It goes through
the same drawing as a blurt's picture (`src/picture.ts`), only cropped to the middle
square first (640 × 640), and only the drawing is kept (`user_profiles.picture`). While
there is one it is shown wherever the avatar is; removing it brings the cartoon back.

- `POST /api/profile-picture` (multipart): the image in `picture` (JPEG, PNG or WebP), or
  `remove` (any non-empty value). A file that is no picture, or no file, is a 400 on
  `picture`; forms get the edit page again with the error. Too many pictures being drawn
  at once is a 503, like a blurt's. An optional `cut` (5–95) sets where the mouth opens in
  the same update (a 400 on `cut` otherwise, and nothing is saved); without it the cut
  stays as it was. There are no crop fields: the server always crops the middle square,
  and with JavaScript the browser sends the square the person chose (see below).
- It talks like the cartoon, with no JS: two empty `<img>`s stacked, the part above the cut
  (`avatar-top`) and the part below (`avatar-jaw`), each an SVG of just that band. Their
  `width`/`height` attributes give each its share of the square, so there is no inline
  style (the CSP allows none). The same keyframes flap the top up around the back of the
  head and bob the jaw, showing a dark mouth behind them. The top band reaches 8 px (of 640)
  below the cut and the jaw is pulled up as much (`margin-top: -1.25%`), so no seam shows.
- The cut is `user_profiles.picture_cut`, in percent from the top (5–95, 65 by default).
  The edit page shows the whole picture with the cut as a dashed line, as
  `<input type="image" name="cut">` 240 × 240: a click sends `cut.x` and `cut.y` (no JS,
  like the location map), and the height becomes the percentage (pulled in to 5–95). A
  keyboard activation (0,0) is an error. API clients send `cut` (a whole number, 5–95).
- With JavaScript (`src/client/mouth.ts`, `data-enhance="mouth"`) the click is sent with
  `fetch()`: the picture's `src` (which holds the cut) shows the new line, the talking
  preview is drawn again with `AvatarView` from the `{ avatar }` answer, and "now N% from
  the top" follows (`cutHint` in `src/ui/avatar.ts`). From the keyboard, the up and down
  arrows move the line 1% (Shift 5%), shown at once, and Enter or Space saves it (as
  `cut`).
- With JavaScript, uploading is previewed first (`src/client/picture-upload.ts`,
  `data-enhance="picture-upload"` on the upload form). Once a file is picked, before
  anything is sent: the picture on a canvas with a square frame (drag it to move it, its
  corner to resize it, mouse or touch; the arrow keys move it, Shift in bigger steps, + and
  − resize it; a Size slider), the drawing of that square made in the browser with the
  mouth's line (a click on it, or the up and down arrows), and the talking avatar it makes
  (`AvatarView` with `parts`, blob: URLs of the drawing's halves). Upload is one request:
  the square scaled to 640 × 640 as a PNG in `picture`, and `cut`. **Decision:** the
  browser crops (canvas), rather than sending `crop.x/crop.y/crop.size` for the server to
  apply, because that needs no new server logic: the server's middle-square crop of a
  square is the whole of it. The answer `{ avatar }` re-renders the panel
  (`ProfilePictureForm`, now in `src/ui/profile-picture.ts`) and the viewer's other
  avatars, and hides or brings back the cartoon's form (`AvatarForm`, in
  `src/ui/avatar-form.ts` for this) and its "On this page" link, as a reload would show
  them; Remove also goes without a page load. A file the browser can't decode gets no
  editor, and the form is sent as it is.
- In JSON the avatar gets `photo: { user, version, cut }` while there is a picture.
- The edit page then hides the cartoon's settings (they would change nothing that shows):
  the picture's panel, with the click for the cut, takes their place, and `#avatar` links
  land on it. `POST /api/avatar` still works, for when the picture is removed.
- Share cards show the picture instead of the cartoon, as the still of its biggest flap
  (like the cartoon's `openMouth`). Its user, version and cut are in the card's hash, so a
  new picture or cut is a new card.

| Path                                                | Auth | Response                                                                                                            | Errors                                                                   |
| --------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `/profile-pictures/{user}-{version}-{cut}-top.svg`  | —    | the band above the cut, `width`/`height` set; `image/svg+xml`, `Cache-Control: public, max-age=31536000, immutable` | 404 no picture, an old version, a cut outside 5–95, or a deleted account |
| `/profile-pictures/{user}-{version}-{cut}-jaw.svg`  | —    | the band below the cut, likewise                                                                                    | likewise                                                                 |
| `/profile-pictures/{user}-{version}-{cut}-edit.svg` | —    | the whole picture with the cut drawn on it, likewise                                                                | likewise                                                                 |

The version goes up with every upload and the cut is in the URL, so each URL always gives
the same SVG.

## Themes

Five colour themes, picked on the profile edit page (`#theme`), listed in `src/shared/themes.ts`.
The default, Cobalt Quietude (`defaultTheme`), is `public/style.css` itself: the variables
at the top, its grid background and uppercase navigation. Each other theme is a small
stylesheet in `public/themes/` that overrides those (and adds touches of its own, like
fonts), linked after `style.css`. Changing the default means swapping which theme lives
in `style.css`. Each choice in the
picker shows a strip of its colours (`.swatch-<theme>` classes), so no JS is needed to
preview.

- The pick is saved on the account, in `user_profiles.theme` (`NULL` until the user picks
  one: they get `defaultTheme`, whatever it is at the time; a `CHECK` lists the ids, so a
  new theme needs a migration too). `POST /api/theme` with
  `theme` (one of the ids in `src/shared/themes.ts`; anything else is a 400) saves it.
- Pages get it from the access token, not the database: login and every token refresh
  read the theme in the same query they already make, and put it in the access token
  next to the username (see Sessions). `POST /api/theme` reissues this browser's access
  token, so the next page already has the new theme; other devices get it at their next
  refresh, within 5 minutes. Logged-out visitors get the default.
- Every request runs in a page context (`src/page-context.ts`, set in `src/server.ts`
  after `authenticate`) with the viewer, the path and the theme, so the frame of every
  page (`Page` in `src/pages/shared/layout.ts`: header, navigation, footer) and the
  stylesheet links need nothing from the route. `renderDocument` hands it to the
  components through a Preact context (`src/ui/context.ts`, read with `usePageContext()`);
  only the Markdown views read `pageContext()` directly.
- Every page has `<meta name="theme-color">` with the theme's background (`themeColor`),
  so phones colour their address bar to match; a shared blurt keeps its own.
- With JavaScript the theme form saves itself (autosave, see JavaScript in the browser)
  and `src/client/theme.ts` switches the page as soon as a theme is picked, before the
  save has answered, without loading it again: it links the new theme's stylesheet after
  `style.css` and removes the old one once the new one has loaded (no flash of the
  default; a newer pick drops a link still loading), and updates `theme-color` and the
  page context JSON. If the save fails, the saved theme comes back. The edit page fetches
  the other themes' stylesheets ahead (`<link rel="stylesheet" media="not all"
  data-warm>`: downloaded, never applied, allowed by `style-src 'self'`; not
  `rel=prefetch`, which the CSP governs by `default-src 'none'` in browsers that follow the
  spec, though Chromium lets it through), so the switch is instant. The critical
  `<style>` stays the old theme's (its text is allowed by hash, and only the first paint
  needs it): nothing of it shows, since the stylesheets set everything it does, the
  root's background and colour too (`:root { background: var(--bg); color: var(--text) }`
  in `style.css`). Checked by comparing screenshots of a switched page with a fresh load
  of the same theme: identical apart from the status line.

## Sign-up limits

One row in `signup_counter` holds the number of sign-ups so far and two limits. The
sign-up page (`signup` in its data) is in one of three states:

| State      | When                            | `/signup` shows                     | `POST /signup`     |
| ---------- | ------------------------------- | ----------------------------------- | ------------------ |
| `open`     | count below `soft_limit`        | the sign-up form                    | creates the user   |
| `invite`   | `soft_limit` up to `hard_limit` | "invite-only", the form with a code | needs a valid code |
| `waitlist` | count at `hard_limit`           | "full", and the waitlist form       | 403                |

Sign-up claims a slot with one `UPDATE ... WHERE current_count < limit RETURNING` in the
same transaction as creating the user, so concurrent sign-ups never pass the limit. A
taken username rolls the transaction back, releasing the slot. The 403 carries
`{ errors: [{ message }] }` for JSON, or the page in its current state for forms.

Admins change the limits on `/admin` (`POST /api/admin/signup-limits`, soft <= hard); the
state follows at once. Invite codes only show (profile, privacy and deletion texts) while
the state is `invite`.

## Invite codes

Every new user gets 3 invite codes, listed under "Your invite codes" on their own
profile, each with a `/signup?invite=<code>` link to share. A code is single-use and
lets one person sign up while sign-up is invite-only. It doesn't get past the hard limit
(403, the waitlist). Open sign-up takes a code too, optionally, so "Invited by" still
shows on the invitee's profile.

Codes are 12 characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (no look-alikes), about
59 random bits. Case, spaces and dashes in what people type are ignored. Sign-up redeems
the code with `UPDATE invite_codes ... WHERE code = $1 AND used_at IS NULL` in the same
transaction that claims the slot and creates the user, so two sign-ups with one code at
the same moment can't both get it. A code that doesn't exist, is used or has expired is
a 400 on `inviteCode`, and rolls back the slot and the username.

User codes never expire. Admins mint codes in bulk, for launches and press, owned by an
existing account (they show on its profile), optionally expiring:

```bash
node db/mint-invites.ts <username> <count> [days until they expire]
```

`POST /waitlist` only works in the `waitlist` state (403 otherwise). It takes a username
and nothing else, so no personal data is stored and nobody is contacted: people check
back at `/waitlist?username=<name>`, which says when sign-up has opened again. Joining
twice does nothing; a username that already has a profile, or belonged to a deleted
account, is a 400. Signing up with a
waitlisted username marks its entry `joined`. A waitlisted username isn't reserved.

## Sessions

Two `HttpOnly`, `SameSite=Lax` cookies, both on `Path=/` (`__Host-` prefixed and
`Secure` in production). The code and the reasoning are in `src/middleware/auth.ts`.

| Cookie          | Lifetime                              | Checked by                                                                                             |
| --------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `access_token`  | 5 min                                 | its signature only, no database; carries the username, theme, time zone, language and "Use JavaScript" |
| `refresh_token` | 400 days, or until the browser closes | one row in `sessions`, then rotated to the next generation                                             |

- When the access token is missing or expired, any request (page load, form POST,
  `fetch()`) with a valid refresh token gets a new pair, transparently. Each refresh
  restarts the 400 days, so a session lasts as long as it's used.
- "Keep me logged in" (`remember=1`, or `true` in JSON; off by default, on sign-up and
  login alike) chooses between that and a session-only login: the refresh token is set
  without `Max-Age`, so the browser drops it on close, and the server ends the session
  after 24 hours unused (`temporarySessionIdleSeconds`). The choice is stored on the
  session (`sessions.persistent`) and kept through refreshes. Sessions from before the
  option existed are persistent.
- A refresh token used again more than 60 seconds after it was rotated means a stolen
  copy: the session is revoked for everyone holding it. Within those 60 seconds it is a
  second tab or parallel request racing the first, or a client that never got the
  response that rotated it. It gets a new access token and a refresh token for the
  current generation, without rotating again.
- Logging out revokes the session. `/api/logout-everywhere` revokes all of the user's
  sessions. Other devices notice at their next refresh, within 5 minutes.
- Production refuses to start without a `JWT_SECRET` of at least 32 characters.

Every POST (any method but `GET`, `HEAD` or `OPTIONS`) also sets `recent_write` (`HttpOnly`,
`SameSite=Lax`, 10 seconds). It holds no data: while it is there, the browser's pages are
read from the primary database instead of the read replica, so the page a form redirects
to always shows the change it just made. See db/README.md, Read replica.

Turning JavaScript off sets `javascript=off` (`HttpOnly`, `SameSite=Lax`, 400 days); turning
it on again clears it. See JavaScript in the browser.

## Rate limits

POSTs that cost CPU or can be spammed are limited by token buckets in
`src/middleware/rate-limit.ts`. A bucket holds a burst and refills at a steady rate; an
empty one answers `429` with `Retry-After` (seconds until the next token), as in the
error table below.

| Limit (env var suffix) | Routes                                                                 | Per                  | Default |
| ---------------------- | ---------------------------------------------------------------------- | -------------------- | ------- |
| `LOGIN_IP`             | `/login`, every attempt                                                | IP                   | 10/10m  |
| `LOGIN_USERNAME`       | `/login`, failed attempts only                                         | username (any case)  | 5/5m    |
| `CREATE_USER_IP`       | `/signup` (and invites)                                                | IP                   | 5/1h    |
| `WAITLIST_IP`          | `/waitlist`                                                            | IP                   | 10/1h   |
| `BLURT`                | `/api/blurts` (replies, quotes)                                        | account              | 20/10m  |
| `REBLURT`              | `/api/reblurt`, `/api/unreblurt`                                       | account (one budget) | 60/10m  |
| `FOLLOW`               | `/api/follow`, `/api/unfollow`                                         | account (one budget) | 60/10m  |
| `LIKE`                 | `/api/like`, `/api/unlike`                                             | account (one budget) | 120/10m |
| `PROFILE_EDIT`         | `/:username/edit`                                                      | account              | 120/10m |
| `LOCATION`             | `/api/location`                                                        | account              | 60/10m  |
| `AVATAR`               | `/api/avatar`, `/api/profile-picture/cut`                              | account (one budget) | 60/10m  |
| `PROFILE_PICTURE`      | `/api/profile-picture`                                                 | account              | 20/10m  |
| `THEME`                | `/api/theme`                                                           | account              | 60/10m  |
| `JAVASCRIPT`           | `/api/javascript`                                                      | IP                   | 60/10m  |
| `NOTIFICATIONS`        | `/api/notifications/settings`, `/api/notifications/read`               | account (one budget) | 60/10m  |
| `PUSH`                 | `/api/push/subscriptions`, `/api/push/subscriptions/delete`            | account (one budget) | 30/10m  |
| `EVENTS`               | opening `/api/events` (each tab, every page load and every ~5 minutes) | account              | 600/10m |
| `REPORT`               | `/api/report`                                                          | account              | 20/1h   |
| `DELETE_BLURT`         | `/api/blurts/:id/delete`                                               | account              | 60/10m  |
| `DELETE_ACCOUNT`       | `/settings/delete` (POST)                                              | account              | 5/10m   |
| `SEARCH`               | `/search` (GET)                                                        | IP                   | 60/1m   |
| `BOTS`                 | `/settings/bots` (POST), sharing a bot and taking owners off           | account              | 30/10m  |
| `TOKENS`               | minting and revoking a bot's API tokens                                | account              | 30/10m  |
| `HIDE_BOTS`            | `/api/hide-bots`                                                       | account              | 60/10m  |

- `10/10m` is a burst of 10, refilling 10 per 10 minutes (one a minute). Override any of
  them with `RATE_LIMIT_<NAME>`, e.g. `RATE_LIMIT_BLURT=40/10m` (periods in `s`, `m`, `h`).
  `RATE_LIMIT_SCALE` multiplies every limit: `100` for a load test (029), `0` turns them
  all off. The tests run at 1000 and switch to the real limits for the rate-limit tests.
- The per-username login limit counts failures only, so guessing one account's password
  from many IPs is slow, while its owner logging in doesn't use it up. Someone hammering
  it can make the owner wait for the next token: a minute at most.
- IPv6 clients are limited per /64. The IP is `request.ip`, which depends on
  `TRUST_PROXY` (Express's `trust proxy`): unset when clients connect directly, `1`
  behind one reverse proxy, or the proxy's addresses (`loopback`, `10.0.0.0/8`). Trusting
  more than the real proxies lets clients pick their IP with `X-Forwarded-For`, and so
  dodge the IP limits.
- Counters live in the process's memory, not the database: no round trip per request.
  A restart forgets them, so everyone starts with a full bucket, which is harmless for
  slowing down guessing and spam. With several app instances each would count on its
  own; move them to a small `UNLOGGED` table then. Refilled buckets are dropped every
  minute, so memory follows the number of recently active clients.
- The edit page saves as you go with JavaScript (autosave: after a typing pause of
  800 ms and on leaving a field, never when nothing changed, one request at a time), so
  `PROFILE_EDIT` and `LOCATION` allow more than a form posted by hand needs. A 429 is
  shown in the form's status line ("Too many requests. Please wait …"), and its button
  comes back to save by hand later.
- New routes add a name to `defaults` and use
  `rateLimit('name', accountKey)` after `requireAuth`, or `rateLimit('name')` per IP.

## Errors

| Case                    | Form / HTML                         | JSON                                |
| ----------------------- | ----------------------------------- | ----------------------------------- |
| Validation (400)        | The form page again, with the error | `{ errors: [{ field?, message }] }` |
| Bad query parameter     | Plain-text message (400)            | `{ error: message, field }`         |
| 401, 403, 404, bad JSON | Plain-text message                  | `{ error: message }`                |
| 413 (body too large)    | Plain-text message                  | `{ error: message }`                |
| 429 (rate limit)        | Plain-text message, `Retry-After`   | `{ error: message }`, `Retry-After` |

`field` names the input the error is about (`username`, `text`, `homepage`, ...). It is
left out when the error is about the whole form, e.g. a wrong username or password. For a
GET it is the query parameter (`before`, `after`, `radius`, `username`, `invite`, `q`).

## Input limits

Everything a client sends is bounded, in `src/shared/limits.ts` (the numbers, and the
web address check) and `src/limits.ts` (the zod schemas). Input over a limit is rejected
with a 400 naming the field (see Errors), never silently truncated. Text is trimmed
first, then counted in characters (code points, like Postgres' `char_length()`: an emoji
is one), not bytes. The forms carry the same limits as `maxlength`.

| Input                                      | Limit                                           |
| ------------------------------------------ | ----------------------------------------------- |
| Blurt `text`                               | 1–280 characters                                |
| `bio`                                      | 4000 characters                                 |
| `homepage`                                 | 200 characters, `http(s)://` only               |
| `x`, `instagram`, `tiktok`, `youtube`, ... | 200 characters, a handle or an `http(s)://` URL |
| Report `reason`                            | 500 characters                                  |
| `username`                                 | 1–40 letters, digits and `_`                    |
| `password`                                 | 8–200 characters (bounds Argon2's work)         |
| `?before=` / `?after=` cursors             | 100 characters, and must decode                 |
| `?radius=` on `/near`                      | one of the listed radii                         |
| `?q=` on `/search`                         | 200 characters                                  |
| `?invite=` on `/signup`                    | 40 characters                                   |
| `?username=` on `/waitlist`                | 40 characters                                   |
| Request body (form or JSON)                | 64 KB, else 413                                 |
| Blurt `picture` upload                     | 15 MB, else 413 (nginx: 16 MB)                  |

- The body limit fits the largest real body, a full bio of 4-byte characters
  percent-encoded (about 48 KB), with room to spare.
- The database repeats the text limits, and the `http(s)` rule for profile links, as
  CHECK constraints. Templates still only link `http(s)://` URLs (`isWebUrl`).
- Browsers count `maxlength` in UTF-16 units, so a textarea stops at 140 emoji while the
  server would take 280. The server is the limit that counts.

## Security headers

`src/middleware/security-headers.ts` runs first, so every response carries these:
pages, errors, JSON, Markdown and static files. A test checks a page and the error
responses.

| Header                                            | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy`                         | `default-src 'none'; connect-src 'self'; style-src 'self' 'sha256-…' (one per theme); img-src 'self'; manifest-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`, plus `; script-src 'self' 'sha256-…'` (the import map), `; worker-src 'self'` and `blob:` in `img-src` when the page has JavaScript. Client modules (`/static/js/…`) carry `default-src 'none'; script-src 'self'`, the policy of a worker started from one; `/sw.js` carries `default-src 'none'; connect-src 'self'` |
| `Strict-Transport-Security`                       | `max-age=63072000; includeSubDomains` (production only)                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `X-Content-Type-Options`                          | `nosniff`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `Referrer-Policy`                                 | `no-referrer`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `Permissions-Policy`                              | camera, microphone, geolocation, payment, ... all `()`                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `X-Frame-Options`                                 | `DENY` (for browsers without `frame-ancestors`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `Cross-Origin-Opener-Policy` / `-Resource-Policy` | `same-origin`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

`X-Powered-By` is off.

- **Two policies, picked per response.** Every response starts with the policy above
  without `script-src`, so `default-src 'none'` blocks every script. Once the page
  context is known (the middleware after `authenticate` in `src/server.ts`) and
  JavaScript is on for this visitor, `allowScripts()` swaps in the same policy plus
  `script-src 'self' 'sha256-<import map>'`: our own modules (`/static/js/…`,
  `/static/vendor/…`) and the one inline script, the import map, by the hash of its exact
  text, computed at startup. Never `'unsafe-inline'` or `'unsafe-eval'`, no other
  origin. Pages for visitors who turned JavaScript off, static files and anything
  answered before the page context (a malformed body) keep the policy without
  `script-src`, and such pages carry no script. The page context JSON is a
  `<script type="application/json">` data block, which never runs and needs nothing.
  Inline `<script>` code and `on...=` attributes stay blocked. Fonts and anything
  third-party still need the policy changed first. `manifest-src 'self'` (in both
  policies) is for the web app manifest. `worker-src 'self'` is there for the dedicated
  worker that draws pictures (`src/client/picture-worker.ts`) and the service worker
  (`/sw.js`, which runs under its own `default-src 'none'; connect-src 'self'`); a dedicated worker runs under the CSP its
  script was served with (per spec; Chromium lets it inherit the page's), so client
  modules are served with `default-src 'none'; script-src 'self'`: the worker can import
  our modules and nothing else. See JavaScript in the browser.
- **No inline CSS.** All styles are in one stylesheet file, `public/style.css`, served
  at `/static/style.css`, plus the chosen theme's overrides from `public/themes/` (see
  Themes); icons are inline SVG (`src/ui/icons.ts`), not an icon font. Both are
  cached with ETag/conditional requests (`If-None-Match` /
  `304 Not Modified`) via the static file handler in `src/server.ts`. Pages link it and never use `style="..."`: a per-element value goes in an SVG
  attribute (the map marker is a `<circle cx cy>`) or a class. A test checks every page.
- **One inline `<style>`, allowed by hash.** Each page inlines its theme's above-the-fold
  CSS (`criticalCss` in `src/shared/themes.ts`, at most 15 lines: the colours, the page frame and
  the sizes of the inline SVGs), so a slow connection shows a dark, laid-out page instead
  of a white flash while the stylesheets load. The CSP allows exactly those blocks by
  their SHA-256 hashes, computed at startup, never `'unsafe-inline'`. Change the CSS
  there and the hashes follow; any other inline style is still blocked. A test checks the
  line limit, the hashes, and that the colours match the theme stylesheets.
- Public files under `/static` are served by one `express.static` handler in
  `src/server.ts`, with ETag and conditional GET support. The exception is the Preact
  bundle under `/static/vendor/` (see Preact in the browser), which is versioned and
  cached as immutable.
- Avatars are inline `<svg>` markup, which the CSP doesn't restrict; their CSS animation
  is in the stylesheet. The world map is an image from `/static`, so `img-src 'self'`.
  With JavaScript also `blob:`, for the previews of a picture drawn before it is uploaded
  (the composer's and the profile picture's, `URL.createObjectURL` of the drawing's SVG):
  only a script on the page can make such a URL.
- User text is escaped by the templates (Preact for HTML, `md` for Markdown); a test
  posts markup and a `javascript:` link and checks both views.
- Session cookies are `HttpOnly`, `SameSite=Lax`, `Path=/`, and in production `Secure`
  with the `__Host-` prefix (no `Domain`). A test starts the app in production mode to
  check them and HSTS.
- **Same-origin writes.** `src/middleware/same-origin.ts`, right after the headers:
  a POST (anything but GET, HEAD, OPTIONS) whose `Origin` header is there and is neither
  `PUBLIC_URL`'s origin nor the origin it was sent to (its protocol and `Host`) is a 403
  (`Requests from other sites are not accepted`), before any body is read. `Origin: null`
  is refused too. No `Origin` passes: old browsers, curl and API clients, which a page on
  another site can't make a browser send. On top of `SameSite=Lax`, this covers the
  anonymous `javascript` cookie, sibling subdomains (same site, other origin) and opaque
  origins. Behind a proxy, set `PUBLIC_URL` (or `TRUST_PROXY` so the protocol is right).

## Smoother navigation without JavaScript

Three browser features make moving between pages feel quicker, with no script on the
page. Browsers without them ignore them and navigate as before.

- **View Transitions.** `public/style.css` has `@view-transition { navigation: auto; }`,
  so Chromium cross-fades from one page to the next. Only under
  `prefers-reduced-motion: no-preference`.
- **Speculation Rules.** Every HTML page (`represent()` and the error pages) sends
  `Speculation-Rules: "/static/speculation-rules.json"`. The file
  (`public/speculation-rules.json`, served as `application/speculationrules+json`) asks
  for a **prefetch** of a same-origin link when the pointer rests on it (eagerness
  `moderate`; on touch screens, at the tap or by Chromium's own viewport heuristics),
  except `/api/*`, `/logout`, `/search`, `/near`, `/admin` and non-page files. No prerender: these pages are light, and prerendering also
  loads their stylesheets and images. The CSP needs no change: rules fetched from the
  header are not governed by any CSP directive (only inline rules would need
  `script-src`), see `src/middleware/security-headers.ts`. The answer to every
  state-changing request sent with `fetch()` (asking for JSON; refused or not) carries
  `Clear-Site-Data: "prefetchCache", "prerenderCache"`: a write sent with `fetch()` keeps
  the page, and without it the page's earlier prefetches (a profile fetched on hover
  before a blurt was posted in place) would still be shown. Only those two are cleared,
  never cookies or storage. A form POST without JavaScript doesn't get it: its answer
  replaces the page and the prefetches with it (and Chromium was seen keeping the old
  page's live-update connection open when a navigation's answer carried it).
- **bfcache.** Pages send no `Cache-Control`, so Back and Forward can restore them from
  the back/forward cache. Only responses that set or clear the session cookies (log in,
  log out, a token refresh) are `no-store`, so that no shared cache keeps someone's
  tokens; that stays. Health checks, the OG debug pages and the 500 page are `no-store`
  too.

A prefetch arrives with `Sec-Purpose: prefetch` and may never be shown, so a GET that
changes something refuses it with `503` (`Cache-Control: no-store`, logged as info, not
counted as a server error). The browser drops the prefetch and the click loads the page
normally. That is the case for:

- a blurt page while the viewer has unread notifications, since visiting it reads the
  ones about that blurt;
- any request whose access token has run out, since answering it rotates the refresh
  token, and a prefetch cut off on the way would lose the new one.

Code: `src/speculation.ts`. A link that should never be prefetched goes in the rules
file's exclude list.

## Bots

A bot is an account of its own, made and run by people (tickets/031-bots.md). Code in
`src/routes/bots.ts` (managing them), `src/routes/api-v1.ts` (the bot API) and
`src/routes/state/bots.ts`; the tables in `db/migrations/*_bots.sql`.

- **No password.** `users.is_bot`, and `password_hash` is null (a CHECK holds it), so nobody
  logs in as a bot. Its owners (`bot_owners`) run it from their own accounts.
- **Managing.** `/settings/bots` lists the viewer's bots and makes new ones (`POST` with
  `username`, at most 10 per person; no sign-up slot or invite). `/settings/bots/:username`
  (owners only, 404 for anyone else) sets its avatar (`POST /api/bots/:username/avatar`, as
  `/api/avatar`) and bio (`POST /api/bots/:username/bio` with `bio`), mints tokens (`POST /api/bots/:username/tokens` with `name`, at most 5;
  the token is in that response only), revokes them (`.../tokens/:id/revoke`), shares the
  bot (`.../owners` with `username`), takes an owner off or leaves (`.../owners/remove`; the
  last owner can't) and deletes it (`.../delete`, like deleting an account). Handing a bot
  over is sharing it, then leaving. Admins make someone its only owner
  (`POST /api/admin/bots/owner` with `bot` and `owner`). Deleting an account deletes the
  bots nobody else owns.
- **Tokens.** `blurt_` + 32 random bytes; only their sha256 is stored (`api_tokens`).
  `authenticate` reads `Authorization: Bearer` on `/api/v1/` only, and cookies everywhere
  else, so a token never works on a page or form route and a browser's cookies never work
  on the bot API.
- **The bot API.** `/api/v1/` answers JSON only (any `Accept`), and 401 with
  `WWW-Authenticate: Bearer` without a live token. Each route is an alias: it rewrites the
  method, path and body to the site's own route and lets that handle it, so the JSON, the
  validation and the rate limits are the site's. The list is `src/pages/info/bot-api.ts`,
  shown on `/about#bots`.
- **Looks.** A bot's avatar gets `robot: true` (`avatarColumn`) and is drawn as a robot from
  the same nine fields (`src/ui/avatar.ts`), never as a profile picture; its name gets a
  "Bot" label, and its profile says who runs it (`botOwners` in the profile JSON).
- **Hide bots.** `POST /api/hide-bots` with `hideBots` (`on`/`off`). On, bots the user doesn't
  follow are left out of the everyone feed, replies, related blurts, discovery, `/near`
  and search, and make them no notifications (when they're created). Following wins: a
  followed bot shows everywhere. Not filtered yet: the live "new blurts" count.

## Rules for new routes

- Every top-level path segment is a reserved username (`reservedUsernames` in
  `src/routes/users.ts`), since profiles live at `/:username/`. A test enforces it.
- A POST either has a GET page at the same path or lives under `/api/`. A test
  enforces it.
- GET routes go through `represent()` with an HTML and a Markdown view. POST routes
  finish with `sendFormSuccess()`, `sendFormErrors()` or `sendError()`.
- JSON never contains `passwordHash`, `password` or `embedding`. The types keep them
  out, and `toJson()` drops those keys anyway.
- Usernames are letters, digits and `_` only, and case-insensitive.
- A POST that costs CPU or can be spammed gets a `rateLimit()` (see Rate limits).
- No inline `<style>` (beyond the hashed above-the-fold CSS), `style="..."` or scripts
  (beyond the hashed import map): the CSP blocks them (see Security headers).
- Every page must work without JavaScript. Scripts only enhance what already works (see
  JavaScript in the browser), and a test runs the same flows with it off and on.
- POSTs from other origins are refused (see Security headers, same-origin writes); a new
  route needs nothing for that.

## Shared components

The components that more than one page uses, and that a browser could run as they are,
live in `src/ui/`: the blurt card (`blurt-card.ts`: likes, reblurts, timestamps, quoted
blurts, delete and report forms), avatars, icons, blurt text with its links, discovery
sections, notification items, the unread badge, a row of `/people` (`people.ts`), the
follow form (`follow.ts`), the paged lists and how each item is shown (`lists.ts`) and
the URL helpers (`urls.ts`). Pages
stay in `src/pages/`. Everything is written with htm (`html` from `src/ui/html.ts`,
`htm.bind(h)`), so it needs no build step.

`src/ui/` and `src/shared/` (the data those components need: limits, time zones and
timestamps, themes, avatar parts) must not import anything that only runs on the server:
no `node:*`, `zod`, `tz-lookup`, `express`, `pg`, `src/config.ts`, `src/page-context.ts`,
`src/routes/` or `src/pages/`, except `import type`, which is erased. What they need from
the request comes in through the page context (`usePageContext()`) or the data; what needs the
server is worked out before rendering (the share card URL, for example, is made by the
blurt page in `src/pages/blurt/blurt.html.ts`). oxlint's `no-restricted-imports`
(`.oxlintrc.json`) and `test/isomorphic.test.ts` (which walks the import graph) enforce it.

### Preact in the browser

The browser gets Preact from `preact-hook-signal-htm-bundle` (a runtime dependency): one
self-contained ES module with Preact, `preact/hooks`, `@preact/signals` and `html` (htm
bound to its `h`). We serve it ourselves, never from a CDN (the CSP is `'self'` and the
privacy page promises no third parties), at a URL that carries the installed version:

| Path                                        | Served from                                                        | Headers                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `/static/vendor/preact-bundle@<version>.js` | `node_modules/preact-hook-signal-htm-bundle/dist/preact-bundle.js` | `text/javascript; charset=utf-8`, `Cache-Control: public, max-age=31536000, immutable` |

`<version>` is read from the package's `package.json` at startup (`preactBundleUrl` in
`src/vendor.ts`), so upgrading the package changes the URL and the year-long cache never
serves an old file. Any other version, or none, is a 404.

- **One Preact.** The bundle compiles in its own copy of Preact, so in the browser it is
  Preact. Every specifier the shared modules use (`preact`, `preact/hooks`, `htm`,
  `@preact/signals`, and `src/ui/html.ts`) has to resolve to this one file through the
  import map; a second copy of Preact on the page breaks hooks and context.
- **Same major.** The server renders with `node_modules/preact` and the browser hydrates
  with the bundle's, so their majors must match. `test/vendor.test.ts` compares the
  versions the bundle was built with (its `devDependencies`) against our `package.json`
  and `node_modules`, for Preact, htm and signals. Upgrade both together.
- Pages with JavaScript on preload it and point every specifier at it with the import
  map (see JavaScript in the browser).

## JavaScript in the browser

Every page works without JavaScript; scripts only make something that already works a
little smoother (progressive enhancement), and they are optional. The plan behind it is
`docs/js-enhancement.md`.

### Delivering TypeScript

Client code is the TypeScript Node runs, with its types stripped by Node's own
`stripTypeScriptTypes()` (`node:module`, mode `strip`, which blanks types out so lines
and columns stay put and no source map is needed). `src/client-modules.ts` reads the
three client folders once at startup and serves them:

| Folder       | What                                                      |
| ------------ | --------------------------------------------------------- |
| `src/ui`     | components shared with the server (see Shared components) |
| `src/shared` | the data they need                                        |
| `src/client` | browser-only code: `main.ts`, the enhancers, helpers      |

| Path                                    | Headers                                                                                        |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `/static/js/<build>/<folder>/<file>.ts` | `text/javascript; charset=utf-8`, `Cache-Control: public, max-age=31536000, immutable`, `ETag` |

- `<build>` is a hash of every client file's path and contents, computed at startup, so
  any change gives every module a new URL. Relative imports (`./text.ts`) resolve under
  the same prefix by themselves: nothing is rewritten, since browsers go by the
  `Content-Type`, not the extension. An old build is a 404 (a page loaded before a deploy
  then just lacks that enhancer). `npm run dev` restarts on any change under `src/`
  (`--watch-path`), which recomputes it.
- Only those three folders. A request gets a module by its exact path from the set read
  at startup, never from the file system, behind a strict pattern (lower-case names,
  `.ts`, no `..`, no encoded characters). Server code (`src/config.ts`, `src/routes/`,
  `src/pages/`, …) can't be fetched; `test/client-modules.test.ts` tries traversal, encoded slashes and
  the real paths of server files.
- `src/client` follows the same import rules as `src/ui` and `src/shared` (lint and
  `test/isomorphic.test.ts`), and may use the DOM.
- Only erasable TypeScript (no `enum`, `namespace`, parameter properties), as for the
  server. `import type` disappears; `import { type X }` leaves `import {}`, which is fine.
- Node prints an `ExperimentalWarning` for `stripTypeScriptTypes` once at startup.

### The page

With JavaScript on, `src/pages/shared/layout.ts` puts this in every page's `<head>`:

1. `<script type="importmap">` pointing `preact`, `preact/hooks`, `htm`,
   `@preact/signals` and the versioned URL of `src/ui/html.ts` at the Preact bundle (one
   Preact, see Preact in the browser). Its exact text is in the CSP by hash.
2. `<link rel="modulepreload">` for the bundle, `main.ts` and every module `main.ts`
   imports statically (`modulePreloads()` follows the imports at startup), so they load
   in parallel.
3. `<script type="module" src="/static/js/<build>/client/main.ts">`.
4. `<script type="application/json" id="page-context">` with the page context (viewer,
   path, theme, time zone, locale, unread count, `javascript`, and `origin`, the
   `PUBLIC_URL` that Share makes addresses absolute with), `<` escaped as `<`.
   `readPageContext()` in `src/client/page-context.ts` reads it, and
   `PageContextProvider` wraps what an island renders so shared components can call
   `usePageContext()` as they do on the server.

With JavaScript off, none of it is sent.

### Enhancers

`main.ts` sets `<html data-js="on">` once it runs (CSS that hides a fallback keys on
that, never on `@media (scripting: enabled)` alone), then hands every element with
`data-enhance="<name> …"` to its enhancer:

- An enhancer is a module in `src/client/` exporting
  `enhance(element, context)` (`Enhancer` in `src/client/enhance.ts`; `context.page` is
  the page context). Register it in `main.ts` as `name: () => import('./name.ts')`, a
  literal relative path. It's loaded only on pages that use it.
- Each one runs on its own: a module that fails to load or an `enhance()` that throws is
  logged to the console and the element keeps working as rendered. So an enhancer takes
  nothing away (`preventDefault`, hidden buttons) until it is ready to replace it.
  Elements that worked get `data-enhanced="<name>"`.
- `enhanceAll(root, …)` can run again on new content (the next page of a feed); no
  element is enhanced twice. Enhancers get it as `context.enhance(root)`, for what they
  put into the page.

`src/client/requests.ts` sends forms and follows links with `fetch()` and
`Accept: application/json`, the same request the browser would make:

| Outcome    | When                                                            | The caller                                                                                                                                            |
| ---------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `success`  | 2xx with JSON (`data`), or 204 (`data: null`)                   | shows the result in place                                                                                                                             |
| `errors`   | 4xx (not 401) with `{ errors }` or `{ error, field }`           | shows the messages                                                                                                                                    |
| `fallback` | network error, 5xx, 401, a redirect, an answer that is not JSON | nothing: the helper has started the real submission (`form.submit()`, which skips the handler; the submitter's name and value go along) or navigation |
| `failed`   | as `fallback`, with `{ fallback: false }`: nothing was started  | decides (an autosave keeps its button)                                                                                                                |

`submitForm(form, { submitter })` honours the submitter's `formaction`/`formmethod`, and
sends url-encoded bodies unless the form is `multipart/form-data` (the server parses
multipart only where a file is uploaded). `followLink(link)` does the same for a GET.

### The enhancers there are

| Name             | On                                                                                                                                   | Module                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| `autosave`       | the edit page's settings forms: profile and links (with the share card colour), avatar, time zone and language, theme, notifications | `src/client/autosave.ts`       |
| `blurt-actions`  | every blurt card, for logged-in viewers                                                                                              | `src/client/blurt-actions.ts`  |
| `composer`       | the blurt form (feed, `/near`, thread, quote)                                                                                        | `src/client/composer.ts`       |
| `follow`         | Follow / Unfollow on a profile                                                                                                       | `src/client/follow.ts`         |
| `map`            | the location map (edit page, `/near`)                                                                                                | `src/client/map.ts`            |
| `more`           | the next-page link of every paged list                                                                                               | `src/client/more.ts`           |
| `mouth`          | the profile picture's cut                                                                                                            | `src/client/mouth.ts`          |
| `new-blurts`     | the feed's list, first page, logged in                                                                                               | `src/client/new-blurts.ts`     |
| `push`           | "Notify me on this device" on the edit page                                                                                          | `src/client/push.ts`           |
| `picture-upload` | the profile picture's upload form                                                                                                    | `src/client/picture-upload.ts` |
| `share`          | Share on every blurt card and on profiles                                                                                            | `src/client/share.ts`          |

Autosave (`<form data-enhance="autosave">`) sends the whole form as its button would
(fields tied to it with the `form` attribute too) with `submitForm`: a select, radio,
checkbox or colour when it changes, a text field 800 ms after typing stops and when it is
left. One request per form at a time; a change made meanwhile is sent when it returns,
as the form is then, so the last state wins. Nothing is sent when nothing changed; a
beacon sends what is unsaved when the page is left. The save buttons (submit buttons
without a `name`) get `data-autosaved` and are hidden by CSS under `[data-js=on]`, with a
status line in their place (`role=status`: "Saving…", "Saved"); they come back
(`data-retry`) when a save fails. `{ errors }` are shown at their fields
(`aria-describedby`, `aria-invalid`), others in the status line; 401, 5xx and network
errors say so there. Pressing a button (or Enter) is still a real submission if
`fetch()` fails. Other named buttons save with that button. After a save the times are
rewritten (`src/client/times.ts`, with the shared `formatTimestamp`, so they read as the
server writes them). The page context JSON is kept up to date (`updatePageContext`).

Two forms show their change before it is saved (`LiveForm` in autosave.ts: `show` on
every `input` and `change`, `saved`, `revert`, `submit`). The theme is switched at once
(`src/client/theme.ts`, see Themes). The avatar is drawn again from the fields with the
shared `AvatarSvg`, at most once a frame, while a colour is dragged or a select stepped
through (`src/client/avatar-live.ts`), everywhere the viewer's avatar is on the page:
the edit page's previews and their own blurt cards, found by the author link
(`showOwnAvatars` in `src/client/avatar-preview.ts`; the new SVG keeps its classes, so it
talks on hover). "Random" picks in the browser and saves the fields as they then are.
When a save fails and no newer change is waiting, the fields and the page go back to what
was saved last, and the status line says why. The JavaScript setting on `/settings` stays an
ordinary form: turning scripts off or on needs a page load anyway.

What is not updated in place: the share card link under the colours, and its "Write a bio
to get a profile card" note, stay as the page was loaded (an old card link redirects to
the current card).

### Posting, scrolling and the card's buttons

The pages people read blurts on, without a page load. Everything is rendered in the
browser with the same components as on the server (`BlurtCard`, `Likes`, `Reblurts`,
`ReportForm`, `PersonItem`, `NotificationItem`, `FollowForm`, through `ListItem` in
`src/ui/lists.ts` and `src/client/render.ts`), from the same JSON a page has, so the
markup is the server's (`test/e2e/feed.test.ts` renders every list both ways and compares).
What the cards need beyond their data comes from the page context, as on the server: the
viewer (their buttons), the time zone and locale (the times). The viewer's flags
(`viewerLikes`, `viewerReblurted`) are already in every list's JSON. What only a blurt's
own page shows (its share card link, "You reported this blurt") is never rendered in the
browser. JSON dates arrive as strings; `withDates` (`src/client/json.ts`) turns every
`…At` field back into a `Date`. One live region (`src/client/announce.ts`) says what
happened.

- **Posting** (`composer`). The form is sent as it is (multipart, with the picture). The
  answer of `POST /api/blurts` is a `FeedItem`, the same shape as the feed's items, and
  the new card goes into the element marked `data-new-blurts`: the top of the feed and of
  `/near` (`start`), the end of a thread's replies (`end`). The text box empties, the
  focus moves to the card, and the live region says "Your blurt is posted." While the
  request is out the form says "Posting…", or "Drawing your picture…" with a picture
  (the server draws it before it answers). `{ errors }` show at the top of the form, as
  the server's re-rendered page does. A quote still goes to its new page. The hint under
  the text box counts down (code points, as the server counts) and warns about line
  breaks, Ctrl/Cmd+Enter sends, and a picture picked shows as the drawing it will become
  (made in the browser, see below) with a button to take it away. The picture is sent
  scaled down to 640 px as a PNG when that is smaller than the file (it nearly always is
  for a camera photo); otherwise the file as it is.
- **Pictures drawn in the browser** (`src/client/picture-preview.ts`, which starts
  `src/client/picture-worker.ts` as a module Web Worker, so the page doesn't freeze). The
  worker decodes the file with `createImageBitmap` (EXIF orientation applied), scales it
  on an `OffscreenCanvas` on white to the size the server draws at, and runs the shared
  drawing code on its `getImageData()` pixels. Canvas scaling is not sharp's, so a preview
  of the original file is close to the server's drawing but not always identical; that is
  why it says "Preview" and the server still draws every upload. When the scaled PNG is
  what is uploaded (nearly always), the server decodes exactly the pixels the preview was
  drawn from, and its drawing is the preview (tested). Nothing leaves the device before
  the form is sent (said on the privacy page). The worker imports only relative paths
  (the import map does not apply inside workers in every browser) and nothing of Preact.
  Timing (Chromium, this machine): a 4000 × 3000 JPEG takes about 300 ms in all
  (decode ~45, scale ~15, draw ~150–200 ms); the same drawing in Node takes ~170–300 ms.
- **Endless lists** (`more`, on `NextPageLink` with `list` set: `/`, `/everyone`,
  `/:username/`, `/near`, `/search`, `/people`, notifications, and "More replies" on a
  thread). When the link comes within 800 px of the screen, its URL is fetched as JSON
  (`?pictures=none`: the cards only link to the picture), the items are rendered above
  it (into `ul.people`, or before replies posted from the page), and the link points at
  the page after. After three pages it stops, so the footer can be reached; a click on
  the link loads the next page in place (and the focus moves to its first item) and lets
  scrolling load three more. The list is `aria-busy` meanwhile, and the live region says
  "100 older blurts loaded". The address bar follows the page being read
  (`history.replaceState` with its cursor), so a reload, or Back without the
  back/forward cache, starts at that page. A failed load stops scrolling; the link is an
  ordinary link again.
- **Card buttons** (`blurt-actions`, on each card for logged-in viewers). Like and
  Reblurt change at once on every card of that blurt on the page, then again from the
  server's answer. Until it is in, the changed buttons are `aria-disabled` and a click on
  them does nothing, so an Unlike can't overtake the Like it undoes; a refusal (a 429, say) puts them back
  and is announced, and an unreachable server puts them back and submits the form for
  real. Delete opens a `<dialog>` ("Delete this blurt for good?", Cancel by default)
  instead of its `<details>`; deleted, every card of the blurt leaves the page (a reply
  in a thread too, though the next load shows its placeholder when it has replies), and
  on the blurt's own page it is the ordinary submission. Report sends its reason and the
  form becomes "You reported this blurt.", or shows the error.
- **Follow** (`follow`): the button changes at once (`aria-disabled`, doing nothing until
  the answer is in, like Like), then the form and the profile's follower count are
  rendered from `{ followerCount, followingCount, viewerFollows }`.
- **Share** (`share`, for everyone, logged in or not). Without JavaScript Share is a link:
  to the blurt's page in lists, to its share card image on the blurt's own page, and to
  the profile's card image on a profile. With it, every Share shares the page itself
  (`data-share-url`, made absolute with `origin` from the page context) with a short title
  (`data-share-title`: the blurt's text cut to 70 characters, or "name on blurt.trade").
  On a touch-first device (`(pointer: coarse)`) with `navigator.share`, the browser's own
  share sheet opens; cancelling it does nothing, any other failure opens the popup.
  Elsewhere (desktop Safari and Chrome on Windows have `navigator.share` too) a modal
  `<dialog>` (`ShareDialog`, `src/ui/share.ts`) lists plain links to each service's share
  page (`shareTargets()` in `src/shared/share.ts`: LinkedIn, Facebook, X, email, Reddit,
  Bluesky, Threads, Mastodon through mastodonshare.com, WhatsApp, Telegram, and Pinterest
  for blurts with a picture, with the share card image as `media` on the blurt's page),
  each opening in a new tab with `rel="noopener noreferrer"` (email in the same one, to
  leave no empty tab). Nothing is loaded from those services: no scripts, frames or
  widgets, and the CSP is unchanged. Copy link uses `navigator.clipboard.writeText` and
  says "Copied!" in a `role=status` line; without a clipboard it selects the link in its
  field to copy by hand. Escape, Close or a click outside closes it, and the focus goes
  back to Share. A modifier-click or middle click is left to the browser. Cards put in
  the page later (posted, or the next page of a list) get it through `context.enhance`.

### Turning it off

"Use JavaScript" is on by default. Off, the server sends no `<script>`, import map or
module preload at all (not code that switches itself off), and the response's CSP has no
`script-src`, so the page is what a browser without JavaScript gets.

- Logged in: `user_profiles.javascript` (default `true`), on `/settings#javascript`,
  carried in the access token like the theme (a token without the claim means on).
- Not logged in: the `javascript=off` cookie, on `/about#javascript`.
- `POST /api/javascript` with `javascript=on|off` sets this browser's cookie and, logged
  in, the account (reissuing the access token). While logged in the account counts.
- Every page's footer links to the setting ("Turn JavaScript off" / "on").
- Code: `src/javascript.ts`, `src/routes/javascript.ts`.

### Tests in a browser

`npm run e2e` (part of `npm run qa`, about a minute) runs `test/e2e/*.test.ts`: the app
on a random port with the test database, driven by Chromium through Playwright (a dev
dependency pinned to the version whose browser is installed; after changing it, run
`npx playwright install chromium`). `bothModes()` in `test/e2e/helpers.ts` runs each flow
with the browser's JavaScript off and on and fails on any page error, console error or
failed request. They cover sign-up, blurting and liking, every page of the frame,
turning JavaScript off and on (anonymous and logged in), importing every client module
in the page, rendering a shared component with the page context on the bundle's Preact,
enhancer failures, the `requests.ts` contract, and the edit page (`settings.test.ts`):
autosave of a select, a checkbox, a text field and the avatar, field errors, the theme
switch, the avatar and theme shown before the save answers (the request held with
`page.route`), Random, going back after a failed save, the map and the picture by click (both modes, checking that no page load
happened with JavaScript, by a mark on `window`) and by keyboard, and the feed pages
(`feed.test.ts`): posting into the feed and into a thread, with a picture, errors, the
counter and Ctrl+Enter, endless scrolling (three pages, the click, the address bar,
reload and Back), "More replies", like and reblurt (optimistic, and refused), follow,
delete with its dialog, report, and every list rendered in the browser compared with the
server's HTML for the same URL, and Share (`share.test.ts`): the links without
JavaScript, the popup's links and how it closes, Copy link with and without a clipboard,
a phone (touch emulated, `navigator.share` stubbed) sharing, cancelling and failing, a
computer with `navigator.share`, Pinterest with the card image, cards added later, a
profile, and a narrow screen, and pictures drawn in the browser (`picture.test.ts`):
the same RGBA pixels give byte-identical shapes in Node and in the browser's worker,
the worker's URL, type and CSP, timings (printed as a test diagnostic), the profile
picture cropped by keyboard, mouse, slider and touch (a finger, through CDP touch
events), the mouth set by click and keys, the talking preview, nothing sent before
Upload, one request with the PNG square and `cut`, the stored drawing equal to the
preview, Remove, and the same without JavaScript; and the composer's preview, Remove,
the scaled PNG sent, the server's drawing equal to the preview, and without JavaScript
the file sent as it was; and live updates (`live.test.ts`): the Alerts link and Your
corner following replies, reblurts and reading elsewhere without a page load, the "N new
blurts" banner (nothing inserted before the click, own blurts not counted, order and
focus after it), no stream without JavaScript, the stream closed on leaving and opened on
Back, and push: the permission asked only on click, the real service worker registered,
the subscription saved, an empty push to a fake push service, the worker showing one
notification (pushes handed to it through CDP's `ServiceWorker.deliverPushMessage`, since
headless Chromium has no push service; `pushManager.subscribe` is stubbed to a fake
endpoint; this test runs full Chromium, `channel: 'chromium'`, as the headless shell
denies notifications), and turning it off. Contexts use reduced motion, which
turns the view transitions off: their snapshot takes clicks for a moment.

## Markdown templates

`src/pages/shared/markdown.ts` is a tagged template for Markdown, like htm for HTML:

```ts
md`
  # ${profile.username}

  - Bio: ${profile.bio}
  ${viewer && link('Edit profile', `/${profile.username}/edit`)}
`
```

Interpolated strings are escaped, so user text can't add formatting or links. Values
built with `md`, `raw`, `link`, `code` or `join` go in as they are. Templates are
dedented, `null`/`undefined`/booleans render nothing (a line left empty is dropped),
arrays become one block per item, and a multi-line value stays inside its blockquote or
list item. See the comment at the top of the file for details.

## Health check

`GET /healthz` answers `200` with `ok` when the app can run a query on the database (and
on the read replica, if one is configured), and `503` with `database unavailable` or
`read replica unavailable` otherwise. Plain text only, `Cache-Control: no-store`, no
auth, no cookies read. It is for the external uptime check and `deploy/deploy.sh`;
successful checks are not logged (docs/deploy.md, Logs and monitoring).

## Errors and request ids

Every response carries an `X-Request-Id` header, the id of its line in the log. An
unexpected error is answered with a `500` that says only that something went wrong and
names the request id (JSON callers: `{ error, requestId }`); the stack goes to the log.
