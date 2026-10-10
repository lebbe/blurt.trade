# Routes

One path per resource. The `Accept` header picks the representation, not the URL:

| `Accept`                        | Response                                          |
| ------------------------------- | ------------------------------------------------- |
| `text/html`, `*/*`, none        | The HTML page                                     |
| `application/json`              | The data the page is rendered from, as is         |
| `text/markdown` or `text/plain` | The same data as Markdown (forms are described)   |
| anything else                   | `406 Not Acceptable`                              |

Each GET route fetches its data once and hands it to `represent()` in
`src/negotiate.ts`, which sends it as JSON or renders it with the page's HTML template
(`src/templates/index.ts`) or Markdown template (`src/templates/pages.md.ts`). Responses
carry `Vary: Accept`.

`fetch()` sends `Accept: */*` by default, which gets HTML. Send
`Accept: application/json` to get JSON, from GET and POST routes alike.

## Pages (GET)

`viewer` is the logged-in user (`{ id, username }`) or `null`, on every page.

| Path              | Auth  | JSON                                                | Errors                  |
| ----------------- | ----- | --------------------------------------------------- | ----------------------- |
| `/`               | —     | `{ viewer, blurts: FeedItem[], next }`              | 400 bad cursor          |
| `/:username/`     | —     | `{ viewer, profile, blurts: Blurt[], next }`        | 400, 404 no such user   |
| `/:username/:id`  | —     | `{ viewer, blurt, parent, replies, next, related }` | 400, 404 no such blurt  |
| `/:username/edit` | owner | `{ viewer, profile }`                               | 401, 403 not owner, 404 |
| `/login`          | —     | `{ viewer }`                                        |                         |
| `/createUser`     | —     | `{ viewer }`                                        |                         |

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
- The page decides `canEdit` itself: `viewer?.id === profile.userId`.

## Actions (POST)

A POST shares its path with its GET page, so a failed form re-renders at the same URL.
POSTs without a page of their own live under `/api/`. Bodies are form-encoded or JSON
(`Content-Type: application/json`).

| Path              | Auth  | Body                                | Form success     | JSON success                                    |
| ----------------- | ----- | ----------------------------------- | ---------------- | ----------------------------------------------- |
| `/createUser`     | —     | `username`, `password`              | 303 → `/`        | 201 `{ id, username }`, Location `/:username/`  |
| `/login`          | —     | `username`, `password`              | 303 → `/`        | 200 `{ id, username }`                          |
| `/:username/edit` | owner | profile fields (missing → cleared)  | 303 → profile    | 200 the updated `profile`                       |
| `/api/blurts`     | yes   | `text`, optional `parentId`         | 303 → feed/parent| 201 the new `Blurt`, Location `/:username/:id`  |
| `/api/logout`     | —     | —                                   | 303 → `/`        | 204                                             |

Login and sign-up also set the `access_token` cookie, for JSON callers too.

## Errors

| Case                    | Form / HTML                         | JSON                                           |
| ----------------------- | ----------------------------------- | ---------------------------------------------- |
| Validation (400)        | The form page again, with the error | `{ errors: [{ field?, message }] }`            |
| 401, 403, 404, bad JSON | Plain-text message                  | `{ error: message }`                           |

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
