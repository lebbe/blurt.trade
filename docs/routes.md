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
(`src/templates/index.ts`) or Markdown template (`src/templates/pages.md.ts`). Responses
carry `Vary: Accept`.

`fetch()` sends `Accept: */*` by default, which gets HTML. Send
`Accept: application/json` to get JSON, from GET and POST routes alike.

## Pages (GET)

`viewer` is the logged-in user (`{ id, username }`) or `null`, on every page.

| Path              | Auth  | JSON                                                                          | Errors                  |
| ----------------- | ----- | ----------------------------------------------------------------------------- | ----------------------- |
| `/`               | —     | `{ viewer, feed, hasFollowingFeed, followedBlurts, blurts, discovery, next }` | 400 bad cursor          |
| `/everyone`       | —     | the same, always the everyone feed                                            | 400 bad cursor          |
| `/:username/`     | —     | `{ viewer, profile, invitedBy, inviteCodes, follows, blurts, next }`          | 400, 404 no such user   |
| `/:username/:id`  | —     | `{ viewer, blurt, parent, reported, replies, next, related }`                 | 400, 404 no such blurt  |
| `/:username/edit` | owner | `{ viewer, profile, location }`                                               | 401, 403 not owner, 404 |
| `/near`           | yes   | `{ viewer, location, radius, radii, blurts, next }`                           | 400, 401                |
| `/login`          | —     | `{ viewer }`                                                                  |                         |
| `/createUser`     | —     | `{ viewer, signup, inviteCode }`                                              |                         |
| `/waitlist`       | —     | `{ viewer, signup, waiting, username, entry }`                                |                         |
| `/settings`       | yes   | `{ viewer, activeSessions }`                                                  | 401                     |
| `/admin/reports`  | admin | `{ viewer, reports }`                                                         | 401, 403 not an admin   |
| `/about`          | —     | `{ viewer, contact }`                                                         |                         |
| `/terms`          | —     | `{ viewer, contact }`                                                         |                         |
| `/privacy`        | —     | `{ viewer, contact }`                                                         |                         |

- `/` is the following feed (`feed: 'following'`: top-level blurts from accounts you
  follow) when you're logged in and follow more than 10 accounts. Otherwise it's the
  everyone feed (`feed: 'everyone'`), and if you follow anyone, `followedBlurts` holds
  the latest 5 top-level blurts from them, shown on top of the first page (empty
  otherwise). `hasFollowingFeed` says whether you get the following feed, and with it
  Following / Everyone tabs. `/everyone` is the everyone feed for everybody.
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
- `Blurt` is `{ id, username, text, createdAt, parentId, replyCount, avatar, deleted }`,
  with `createdAt` as an ISO 8601 string and `avatar` the blurter's (see Avatar below).
  `deleted` is `true` for a deleted blurt's placeholder in a thread, whose `username`,
  `text` and `avatar` are `null` (see Deleting and reporting). A `FeedItem` is a
  top-level blurt plus `replies`, its latest two replies.
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
  blurts arrive. A malformed cursor is a 400.
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
  is how many entries are still waiting. `/createUser?invite=<code>` fills in the form's
  invite code (`inviteCode`, or `null`), so a shared link is all an invitee needs.
- `activeSessions` is how many browsers and devices the viewer is logged in on.
- `location` is the viewer's own `{ lat, lon }` or `null` (see Location below). It is
  only on `/:username/edit` and `/near`, which only the owner sees, never on profiles.
- `/near?radius=<km>` is "blurts near you": top-level blurts (with their latest two
  replies) from other people whose location is within `radius` km of yours, newest
  first, paged like the feed (`/near?radius=<km>&before=<next>`). `radius` is one of
  `radii` (50, 100, 250, 500, 1000, 2500), 250 when left out, anything else a 400. The
  HTML picks it with a `<select>` in a GET form. Without a location, `blurts` is empty
  and the page links to the edit page.
- The page decides `canEdit` itself: `viewer?.id === profile.userId`.
- `/about`, `/terms` and `/privacy` are fixed text, linked from the footer of every HTML
  page. `/about` is the contact page: GitHub issues for anything public, and where not
  to post sensitive things (security holes, illegal content, personal data).
  `contact` is `{ email, issuesUrl, securityUrl }`, each `null` when not configured:
  `CONTACT_EMAIL`, and `CONTACT_REPO_URL` for the issues and private vulnerability
  report links (docs/deploy.md, Environment).
- `/privacy` lists what the database stores. A test compares every table and column
  with a fixed list, so a migration that changes them fails until the page (and the
  list) is updated.
- Data minimisation is a standing rule: no email addresses, no analytics, no
  third-party scripts, fonts or embeds, no cookies beyond the session and `recent_write`
  cookies (so no cookie banner), no IP addresses stored. There is no password reset: a
  lost password can't be recovered, and sign-up says so.

## Actions (POST)

A POST shares its path with its GET page, so a failed form re-renders at the same URL.
POSTs without a page of their own live under `/api/`. Bodies are form-encoded or JSON
(`Content-Type: application/json`).

| Path                         | Auth          | Body                                 | Form success                | JSON success                                   |
| ---------------------------- | ------------- | ------------------------------------ | --------------------------- | ---------------------------------------------- |
| `/createUser`                | —             | `username`, `password`, `inviteCode` | 303 → `/`                   | 201 `{ id, username }`, Location `/:username/` |
| `/waitlist`                  | —             | `username`                           | 303 → `/waitlist?username=` | 201 the `entry`, Location the same             |
| `/login`                     | —             | `username`, `password`               | 303 → `/`                   | 200 `{ id, username }`                         |
| `/:username/edit`            | owner         | profile fields (missing → cleared)   | 303 → profile               | 200 the updated `profile`                      |
| `/api/blurts`                | yes           | `text`, optional `parentId`          | 303 → feed/parent           | 201 the new `Blurt`, Location `/:username/:id` |
| `/api/blurts/:id/delete`     | author, admin | —                                    | 303 → back (see Deleting)   | 204                                            |
| `/api/report`                | yes           | `blurtId`, optional `reason`         | 303 → `/:username/:id`      | 204                                            |
| `/api/admin/reports/dismiss` | admin         | `blurtId`                            | 303 → `/admin/reports`      | 204                                            |
| `/api/follow`                | yes           | `username`                           | 303 → profile               | 200 their `follows`                            |
| `/api/unfollow`              | yes           | `username`                           | 303 → profile               | 200 their `follows`                            |
| `/api/location`              | yes           | see Location below                   | 303 → `/:username/edit`     | 200 `{ location }`                             |
| `/api/avatar`                | yes           | see Avatar below                     | 303 → `/:username/edit`     | 200 `{ avatar }`                               |
| `/api/logout`                | —             | —                                    | 303 → `/`                   | 204                                            |
| `/api/logout-everywhere`     | yes           | —                                    | 303 → `/login`              | 204                                            |

Following yourself is a 400 and an unknown `username` a 404. Following twice, or
unfollowing someone you don't follow, does nothing.

Login and sign-up also set the session cookies, for JSON callers too.

## Deleting and reporting

Plain forms, so all of it works without JS. Code in `src/routes/blurts.ts`,
`src/routes/admin.ts` and `deleteBlurts` in `src/routes/state.ts`.

- Your own blurts have a "Delete" `<details>` on them, which opens a "Delete" button:
  two clicks, no JS. `POST /api/blurts/:id/delete` deletes it. Anyone else's blurt is a
  403 (unless you're an admin), an unknown or already deleted one a 404. Forms go back
  to the page they came from (its `Referer`, same host only), unless that was the
  deleted blurt's own page: then to the thread it replied to, or `/`.
- A blurt nobody replied to is deleted for good. One with replies stays in its thread
  as a placeholder, "This blurt was deleted": its text, embedding and author are
  removed from the row (`NULL`, enforced by a `CHECK`), so the replies stay readable
  and nothing refers to the author any more. Placeholders never show in feeds, profiles,
  discovery or related blurts, can't be replied to, reported or deleted again, and live
  at `/deleted/:id` (their old `/:username/:id` link still works). When a placeholder's
  last reply is deleted, the placeholder goes too, up the thread.
- `deleteBlurts(ids, client?)` does all of it in one transaction, or inside the
  caller's: account deletion (025) passes all of a user's blurts. Deleting a blurt row
  that still has replies any other way fails (the `parent_id` foreign key no longer
  cascades), so other people's replies can't vanish with it.
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
    a click or numbers).
  - `lat` and `lon` (degrees, `-90..90` and `-180..180`): the fallback form with two
    number fields, or JSON `{ "lat": 59.91, "lon": 10.75 }`.
  - `clear` (any non-empty value, or JSON `{ "clear": true }`): the "Remove my
    location" button.
- Errors are 400 with `field` `location`, `lat` or `lon`. Forms get the edit page again
  with the error.
- The edit page shows what is stored, as text and as a marker on the map.
- Radius queries use `ST_DWithin` on the profile points, with a GiST index.

## Avatar

Every profile has a cartoon face instead of a profile picture, in the style of Terrance
and Phillip: the whole top of the head flaps up and down when it talks. Code in
`src/avatar.ts` (the data, palettes, validation) and `src/templates/avatar.ts` (the SVG).

- `avatar` is `{ skin, hairType, hairColor, eyeType, eyeColor, pupilColor, toothType,
  toothColor }`, stored as JSON in `user_profiles.avatar`. Colours are lower-case
  `#rrggbb` (any colour). `hairType` is `bald`, `tuft`, `flat`, `spiky`, `mohawk` or
  `afro`; `eyeType` `classic`, `dots`, `round`, `wide`, `sleepy` or `angry`; `toothType`
  `none`, `two`, `buck`, `gap` or `full`.
- Sign-up gives every new profile a random avatar, with colours from fixed palettes so it
  looks normal-ish (`avatarPalettes`). Profiles from before avatars got one in the
  migration.
- The edit page has an avatar form: `<input type="color">` for the colours, `<select>` for
  the types, a live preview, and two submit buttons. "Save avatar" sends every field;
  "Random" (`name="random"`) makes the server pick a new random avatar and save it, so it
  works without JS. `POST /api/avatar` takes all eight fields, or `random` (any non-empty
  value, or JSON `{ "random": true }`). A missing or invalid field is a 400 on that field;
  forms get the edit page again with the error.
- Nobody uploads SVG. The server draws it from these fields only, as inline SVG with no
  scripts, links or external references. Every value is validated on the way in (zod),
  the database `CHECK`s the same rules, and the template checks them again when drawing
  (anything unexpected gets a default).
- Blurts show the blurter's avatar, on the left of odd blurts and the right of even ones
  (`.blurt:nth-of-type(even)`). It talks (CSS animation, no JS) while the pointer is over
  the avatar or its blurt, and holds still with `prefers-reduced-motion`. The profile page
  shows it large.

## Sign-up limits

One row in `signup_counter` holds the number of sign-ups so far and two limits. The
sign-up page (`signup` in its data) is in one of three states:

| State      | When                            | `/createUser` shows                 | `POST /createUser` |
| ---------- | ------------------------------- | ----------------------------------- | ------------------ |
| `open`     | count below `soft_limit`        | the sign-up form                    | creates the user   |
| `invite`   | `soft_limit` up to `hard_limit` | "invite-only", the form with a code | needs a valid code |
| `waitlist` | count at `hard_limit`           | "full", and the waitlist form       | 403                |

Sign-up claims a slot with one `UPDATE ... WHERE current_count < limit RETURNING` in the
same transaction as creating the user, so concurrent sign-ups never pass the limit. A
taken username rolls the transaction back, releasing the slot. The 403 carries
`{ errors: [{ message }] }` for JSON, or the page in its current state for forms.

## Invite codes

Every new user gets 3 invite codes, listed under "Your invite codes" on their own
profile, each with a `/createUser?invite=<code>` link to share. A code is single-use and
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
twice does nothing; a username that already has a profile is a 400. Signing up with a
waitlisted username marks its entry `joined`. A waitlisted username isn't reserved.

## Sessions

Two `HttpOnly`, `SameSite=Lax` cookies, both on `Path=/` (`__Host-` prefixed and
`Secure` in production). The code and the reasoning are in `src/middleware/auth.ts`.

| Cookie          | Lifetime | Checked by                                                 |
| --------------- | -------- | ---------------------------------------------------------- |
| `access_token`  | 5 min    | its signature only, no database                            |
| `refresh_token` | 400 days | one row in `sessions`, then rotated to the next generation |

- When the access token is missing or expired, any request (page load, form POST,
  `fetch()`) with a valid refresh token gets a new pair, transparently. Each refresh
  restarts the 400 days, so a session lasts as long as it's used.
- A refresh token used again more than 20 seconds after it was rotated means a stolen
  copy: the session is revoked for everyone holding it. Within those 20 seconds it is a
  second tab racing the first, and gets a new access token only.
- Logging out revokes the session. `/api/logout-everywhere` revokes all of the user's
  sessions. Other devices notice at their next refresh, within 5 minutes.
- Production refuses to start without a `JWT_SECRET` of at least 32 characters.

Every POST (any method but `GET`, `HEAD` or `OPTIONS`) also sets `recent_write` (`HttpOnly`,
`SameSite=Lax`, 10 seconds). It holds no data: while it is there, the browser's pages are
read from the primary database instead of the read replica, so the page a form redirects
to always shows the change it just made. See db/README.md, Read replica.

## Rate limits

POSTs that cost CPU or can be spammed are limited by token buckets in
`src/middleware/rate-limit.ts`. A bucket holds a burst and refills at a steady rate; an
empty one answers `429` with `Retry-After` (seconds until the next token), as in the
error table below.

| Limit (env var suffix) | Routes                         | Per                  | Default |
| ---------------------- | ------------------------------ | -------------------- | ------- |
| `LOGIN_IP`             | `/login`, every attempt        | IP                   | 10/10m  |
| `LOGIN_USERNAME`       | `/login`, failed attempts only | username (any case)  | 5/5m    |
| `CREATE_USER_IP`       | `/createUser` (and invites)    | IP                   | 5/1h    |
| `WAITLIST_IP`          | `/waitlist`                    | IP                   | 10/1h   |
| `BLURT`                | `/api/blurts` (and replies)    | account              | 20/10m  |
| `FOLLOW`               | `/api/follow`, `/api/unfollow` | account (one budget) | 60/10m  |
| `PROFILE_EDIT`         | `/:username/edit`              | account              | 30/10m  |
| `LOCATION`             | `/api/location`                | account              | 30/10m  |
| `AVATAR`               | `/api/avatar`                  | account              | 60/10m  |
| `REPORT`               | `/api/report`                  | account              | 20/1h   |
| `DELETE_BLURT`         | `/api/blurts/:id/delete`       | account              | 60/10m  |

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
GET it is the query parameter (`before`, `after`, `radius`, `username`, `invite`).

## Input limits

Everything a client sends is bounded, in `src/limits.ts`. Input over a limit is rejected
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
| `?invite=` on `/createUser`                | 40 characters                                   |
| `?username=` on `/waitlist`                | 40 characters                                   |
| Request body (form or JSON)                | 64 KB, else 413                                 |

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

| Header                                  | Value                                                    |
| --------------------------------------- | -------------------------------------------------------- |
| `Content-Security-Policy`               | `default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'` |
| `Strict-Transport-Security`             | `max-age=63072000; includeSubDomains` (production only)  |
| `X-Content-Type-Options`                | `nosniff`                                                |
| `Referrer-Policy`                       | `same-origin`                                            |
| `Permissions-Policy`                    | camera, microphone, geolocation, payment, ... all `()`   |
| `X-Frame-Options`                       | `DENY` (for browsers without `frame-ancestors`)          |
| `Cross-Origin-Opener-Policy` / `-Resource-Policy` | `same-origin`                                  |

`X-Powered-By` is off.

- **There is no `script-src`, so no JavaScript runs at all.** Adding any script (the
  planned Preact client, an inline `<script>`, an `on...=` attribute) means changing the
  CSP first: serve the files from `/static` and add `script-src 'self'`, never
  `'unsafe-inline'`. The same goes for fonts, `fetch()` (`connect-src`), web app
  manifests (`manifest-src`), service workers (`worker-src`) and anything third-party.
- **No inline CSS.** All styles are in one stylesheet, `src/templates/styles.ts`, served
  at `/static/style.css?v=<hash of its content>` (cached for a year, immutable). Pages
  link it and never use `<style>` or `style="..."`: a per-element value goes in an SVG
  attribute (the map marker is a `<circle cx cy>`) or a class. A test checks every page.
- Avatars are inline `<svg>` markup, which the CSP doesn't restrict; their CSS animation
  is in the stylesheet. The world map is an image from `/static`, so `img-src 'self'`.
- User text is escaped by the templates (Preact for HTML, `md` for Markdown); a test
  posts markup and a `javascript:` link and checks both views.
- Session cookies are `HttpOnly`, `SameSite=Lax`, `Path=/`, and in production `Secure`
  with the `__Host-` prefix (no `Domain`). A test starts the app in production mode to
  check them and HSTS.

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
- No inline `<style>`, `style="..."` or scripts: the CSP blocks them (see Security
  headers).

## Markdown templates

`src/templates/markdown.ts` is a tagged template for Markdown, like htm for HTML:

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
