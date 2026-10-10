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

| Path              | Auth  | JSON                                                               | Errors                  |
| ----------------- | ----- | ------------------------------------------------------------------ | ----------------------- |
| `/`               | —     | `{ viewer, feed, hasFollowingFeed, followedBlurts, blurts, next }` | 400 bad cursor          |
| `/everyone`       | —     | the same, always the everyone feed                                 | 400 bad cursor          |
| `/:username/`     | —     | `{ viewer, profile, follows, blurts: Blurt[], next }`              | 400, 404 no such user   |
| `/:username/:id`  | —     | `{ viewer, blurt, parent, replies, next, related }`                | 400, 404 no such blurt  |
| `/:username/edit` | owner | `{ viewer, profile }`                                              | 401, 403 not owner, 404 |
| `/login`          | —     | `{ viewer }`                                                       |                         |
| `/createUser`     | —     | `{ viewer, signup }`                                               |                         |
| `/waitlist`       | —     | `{ viewer, signup, waiting, username, entry }`                     |                         |
| `/settings`       | yes   | `{ viewer, activeSessions }`                                       | 401                     |

- `/` is the following feed (`feed: 'following'`: top-level blurts from accounts you
  follow) when you're logged in and follow more than 10 accounts. Otherwise it's the
  everyone feed (`feed: 'everyone'`), and if you follow anyone, `followedBlurts` holds
  the latest 5 top-level blurts from them, shown on top of the first page (empty
  otherwise). `hasFollowingFeed` says whether you get the following feed, and with it
  Following / Everyone tabs. `/everyone` is the everyone feed for everybody.
- `follows` is `{ followerCount, followingCount, viewerFollows }`. `viewerFollows` is
  `false` for anonymous visitors and on your own profile.
- `Blurt` is `{ id, username, text, createdAt, parentId, replyCount }`, with
  `createdAt` as an ISO 8601 string. A `FeedItem` is a top-level blurt plus `replies`, its
  latest two replies.
- Lists come in pages of 100. `next` is an opaque cursor for the page after this one, or
  `null` on the last page: `/?before=<next>` and `/:username/?before=<next>` for older
  blurts (newest first), `/:username/:id?after=<next>` for later replies (oldest first).
  The HTML has the same as an "Older blurts" / "More replies" link, so it works without
  JS. Cursors are keyset positions on `(created_at, id)`, so pages don't shift as new
  blurts arrive. A malformed cursor is a 400.
- `parent` is `null` for a top-level blurt. `related` is empty until the blurt's
  embedding has been computed.
- `profile` is `{ userId, username, homepage, x, instagram, tiktok, youtube, github,
  linkedin, bio }`. Empty fields are `''`.
- `signup` is `'open'`, `'invite'` or `'waitlist'` (see Sign-up limits below).
  `/waitlist?username=<name>` looks that name up: `username` echoes it (or `null`), and
  `entry` is `{ username, status: 'waiting' | 'joined', createdAt }` or `null`. `waiting`
  is how many entries are still waiting.
- `activeSessions` is how many browsers and devices the viewer is logged in on.
- The page decides `canEdit` itself: `viewer?.id === profile.userId`.

## Actions (POST)

A POST shares its path with its GET page, so a failed form re-renders at the same URL.
POSTs without a page of their own live under `/api/`. Bodies are form-encoded or JSON
(`Content-Type: application/json`).

| Path                     | Auth  | Body                               | Form success                | JSON success                                   |
| ------------------------ | ----- | ---------------------------------- | --------------------------- | ---------------------------------------------- |
| `/createUser`            | —     | `username`, `password`             | 303 → `/`                   | 201 `{ id, username }`, Location `/:username/` |
| `/waitlist`              | —     | `username`                         | 303 → `/waitlist?username=` | 201 the `entry`, Location the same             |
| `/login`                 | —     | `username`, `password`             | 303 → `/`                   | 200 `{ id, username }`                         |
| `/:username/edit`        | owner | profile fields (missing → cleared) | 303 → profile               | 200 the updated `profile`                      |
| `/api/blurts`            | yes   | `text`, optional `parentId`        | 303 → feed/parent           | 201 the new `Blurt`, Location `/:username/:id` |
| `/api/follow`            | yes   | `username`                         | 303 → profile               | 200 their `follows`                            |
| `/api/unfollow`          | yes   | `username`                         | 303 → profile               | 200 their `follows`                            |
| `/api/logout`            | —     | —                                  | 303 → `/`                   | 204                                            |
| `/api/logout-everywhere` | yes   | —                                  | 303 → `/login`              | 204                                            |

Following yourself is a 400 and an unknown `username` a 404. Following twice, or
unfollowing someone you don't follow, does nothing.

Login and sign-up also set the session cookies, for JSON callers too.

## Sign-up limits

One row in `signup_counter` holds the number of sign-ups so far and two limits. The
sign-up page (`signup` in its data) is in one of three states:

| State      | When                            | `/createUser` shows                 | `POST /createUser` |
| ---------- | ------------------------------- | ----------------------------------- | ------------------ |
| `open`     | count below `soft_limit`        | the sign-up form                    | creates the user   |
| `invite`   | `soft_limit` up to `hard_limit` | "invite-only", no form (codes: 011) | 403                |
| `waitlist` | count at `hard_limit`           | "full", and the waitlist form       | 403                |

Sign-up claims a slot with one `UPDATE ... WHERE current_count < limit RETURNING` in the
same transaction as creating the user, so concurrent sign-ups never pass the limit. A
taken username rolls the transaction back, releasing the slot. The 403 carries
`{ errors: [{ message }] }` for JSON, or the page in its current state for forms.

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

## Errors

| Case                    | Form / HTML                         | JSON                                |
| ----------------------- | ----------------------------------- | ----------------------------------- |
| Validation (400)        | The form page again, with the error | `{ errors: [{ field?, message }] }` |
| 401, 403, 404, bad JSON | Plain-text message                  | `{ error: message }`                |

`field` names the input the error is about (`username`, `text`, `homepage`, ...). It is
left out when the error is about the whole form, e.g. a wrong username or password.

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
