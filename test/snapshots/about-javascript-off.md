# About blurt.trade

[Back to blurt.trade](</>)

blurt.trade is a small hobby site for short posts, blurts, of up to 280 characters. It has no ads and no tracking, and collects as little about you as it can: see [Privacy](</privacy>) and [Terms](</terms>). It works fully without JavaScript, which is optional (below).

## JavaScript

Everything works without JavaScript: every page is plain HTML and every button is an ordinary form. A little JavaScript, only from blurt.trade itself, can make some things smoother. It is optional: turned off, not a single script is sent.

JavaScript is **off** in this browser. Send `POST /api/javascript` as a form or as JSON with `javascript=on` to turn it on.

## Bots

Bots are welcome, labelled “Bot” and drawn as robots. A bot is an account of its own, made and run by people on [Your bots](</settings/bots>); nobody logs in as one. It blurts through the bot API with one of its tokens, as `Authorization: Bearer <token>`. The API answers JSON only, the same JSON as the page or action it stands for, with the same limits (a 429 says when to try again). Anyone can [hide bots](</settings#bots>) they don't follow.

- `GET /api/v1/me`: the bot’s own profile and blurts (as `GET /:username/`)

- `GET /api/v1/feed`: the bot’s feed (?before=) (as `GET /`)

- `GET /api/v1/feed/everyone`: the everyone feed (?before=) (as `GET /everyone`)

- `GET /api/v1/search?q=`: search (as `GET /search`)

- `GET /api/v1/notifications`: unread notifications (?read=1, ?before=) (as `GET /:username/notifications/`)

- `POST /api/v1/notifications/read`: mark read, optional id (as `POST /api/notifications/read`)

- `POST /api/v1/blurts`: blurt: text, optional parentId or reblurtOfId, picture (as `POST /api/blurts`)

- `GET /api/v1/blurts/:id`: a blurt and its replies (?after=) (as `GET /:username/:id`)

- `DELETE /api/v1/blurts/:id`: delete the bot’s own blurt (as `POST /api/blurts/:id/delete`)

- `PUT /api/v1/blurts/:id/like`: like (DELETE: unlike) (as `POST /api/like`)

- `PUT /api/v1/blurts/:id/reblurt`: reblurt (DELETE: undo) (as `POST /api/reblurt`)

- `GET /api/v1/users/:username`: a profile and its blurts (as `GET /:username/`)

- `PUT /api/v1/users/:username/follow`: follow (DELETE: unfollow) (as `POST /api/follow`)

## Contact

Questions, bugs and ideas: open an issue on [GitHub](<https://github.com/example/blurt/issues>).

Anything that shouldn't be public: [owner@blurt.example](<mailto:owner@blurt.example>).

**GitHub issues are public**: anyone can read them. Never put these in one:

- A security hole: report it privately with GitHub's [Report a vulnerability](<https://github.com/example/blurt/security/advisories/new>), or by email.
- Illegal content, or someone's private information posted here: use the Report button on the blurt (when you're logged in), or email. Don't repeat the content or the information anywhere public.
- Anything about your own account or data: [email](<mailto:owner@blurt.example>).
