# Share images (og:image)

What the share cards (`src/og.ts`, served from `/og/…`) are made to fit. Checked October
2026 against the platforms' own documentation.

## Size and format

| Platform           | Recommended                                          | Limits                                                          |
| ------------------ | ---------------------------------------------------- | --------------------------------------------------------------- |
| Open Graph (spec)  | —                                                    | Any image URL; `og:image:type`, `:width`, `:height` and `:alt` are optional hints |
| Facebook / Meta    | 1200 × 630 (1.91 : 1); at least 600 × 315 for a large preview | At most 8 MB; JPEG, PNG, GIF, WebP. Absolute URL. Giving `og:image:width`/`:height` lets the first share render before the image is fetched |
| LinkedIn           | 1200 × 627 (1.91 : 1)                                | At most 5 MB; JPEG, PNG, GIF                                    |
| X (`summary_large_image`) | 2 : 1, e.g. 1200 × 600; at least 300 × 157    | At most 5 MB; JPEG, PNG, WebP, GIF (first frame). SVG is not supported. Cropped to the centre where the ratio differs |
| Bluesky, Mastodon, Slack, Discord, iMessage | 1.91 : 1 or 2 : 1 look right | Scaled down; a few MB is safe. Mastodon re-encodes and caps it  |

So: **1200 × 630, JPEG or PNG, well under 5 MB, an absolute URL, with width, height, type and
alt given.** The cards follow that. Keep what matters away from the outer ~5 % at the top
and bottom, which X's 2 : 1 crop cuts off.

## Which format

- A card that is flat colour, a face and text (every card without a picture) is a **PNG**:
  sharp edges, and about 50–150 KB.
- A card drawn on a blurt's picture is a **JPEG** (quality 85): the drawing makes it
  busier, and a JPEG of it stays small (well under 1 MB). SVG is never used for share
  images: X, Facebook and most others don't accept it.

## Caching

The file name holds a hash of everything on the card (`ogHash`), so a card never changes
behind its URL and is served with `Cache-Control: public, max-age=31536000, immutable`.
Share sites cache images on their side too, by URL; a changed card gets a new URL, so a
re-share picks it up (Facebook's Sharing Debugger can force it for an old one).
