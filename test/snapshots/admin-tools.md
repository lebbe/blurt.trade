# Admin

[Back to blurt.trade](</>)

Sign-up: open (40 sign-ups so far, soft limit 50, hard limit 100).

Minted for grace:

- `AAAA-BBBB-CCCC`
- `DDDD-EEEE-FFFF`

- [Open reports](</admin/reports>)
- Delete a blurt: `POST /api/admin/blurts/delete` with `blurtId`
- Dismiss reports: `POST /api/admin/reports/dismiss` with `blurtId`
- Set the sign-up limits: `POST /api/admin/signup-limits` with `softLimit` (invite codes needed from here) and `hardLimit` (closed from here)
- Mint invite codes:`POST /api/admin/invites` with `username`, `count` (1–1000) and optionally `days`
