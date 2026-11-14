# Edit profile: ada

[Back to profile](</ada/>)

Send `POST /ada/edit` as a form or as JSON. Fields left out are
cleared. Current values:

- `homepage` (Homepage): [https://ada.example/](<https://ada.example/>)
- `x` (X): ada\_x
- `instagram` (Instagram): _Not set_
- `tiktok` (TikTok): ada\_tok
- `youtube` (YouTube): _Not set_
- `github` (GitHub): ada-gh
- `linkedin` (LinkedIn): _Not set_
- `bio` (Bio): Counts things.
  Writes them down. https://ada.example/notes

## Avatar

Yours: regular head, skin #f1c27d, tuft #2c222b hair, classic #ffffff eyes with #000000 pupils, two front teeth (#ffffff).

Send `POST /api/avatar` with all of `headWidth`, `skin`, `hairType`, `hairColor`, `eyeType`, `eyeColor`, `pupilColor`, `toothType`, `toothColor`
to change it, or with `random` for a random one. Colours are `#rrggbb`. The
head is one of `thin`, `slim`, `regular`, `broad`, `huge` wide. Hair is one of `bald`, `tuft`, `flat`, `spiky`, `mohawk`, `afro`; eyes one of `classic`, `dots`, `round`, `wide`, `sleepy`, `angry`;
teeth one of `none`, `two`, `buck`, `gap`, `full`.

## Profile picture

You haven't uploaded one: the cartoon is shown.

Send `POST /api/profile-picture` as `multipart/form-data` with the image
(JPEG, PNG or WebP) in `picture` to upload one, or with `remove` to remove
it. It is cropped square and redrawn as a rough drawing; only the drawing is kept. Send
`POST /api/profile-picture/cut` with `cut`, from 5 to 95, for where it
opens its mouth, in percent from the top.

## Location

Your location: 59\.5° N, 10.5° E (the middle of a 1° by 1° square, about 111 km across).

Send `POST /api/location` with `lat` and `lon` to set it (only
a 1° by 1° square, about 111 km across is stored), or with `clear` to remove it. Nobody else can see
it. Then see [blurts near you](</near>).

## Notifications

Now: replies off, reblurts and quotes on,
blurts from people you follow on. See
[your notifications](</ada/notifications/>).

Send `POST /api/notifications/settings` with `replies`, `reblurts`
and `followedBlurts` (`1`, `on` or `true` for on, JSON
`true`). Kinds left out are switched off. A quote counts as a reblurt here.

## Theme

Yours: `plum-steel`.

Send `POST /api/theme` with `theme`, one of `cobalt-quietude`, `midnight-clay`, `forest-alloy`, `plum-steel`, `tarnished-teal`,
to pick the colours of the HTML pages, on every device you're logged in on.

## Time zone

Yours: `Europe/Oslo` (UTC until you pick one), written the way
`nb-NO` does (your browser's language until you pick one).

Send `POST /api/timezone` with `timezone`, an IANA name like
`Europe/Oslo`, and/or `locale`, like `nb-NO` or `en-US`
(empty for your browser's language), to set how the HTML pages show times.
