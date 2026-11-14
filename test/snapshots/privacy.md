# Privacy

[Back to blurt.trade](</>)

blurt.trade collects as little as it can. No email address, no real name, no phone number. No analytics, no ads, no tracking, and nothing loaded from other sites.

With JavaScript on, Share also offers plain links to other services, such as Bluesky or LinkedIn. Nothing is shared, and nothing is sent to any of them, until you click one: that link takes you to the service you picked, where its own privacy terms apply.

## Who is responsible

Lars-Erik Bruce is responsible for the site and its data (the controller under the GDPR). To reach him: email [owner@blurt.example](<mailto:owner@blurt.example>).

blurt.trade runs on a server owned and operated by a private individual in Norway, who hosts it on Lars-Erik's behalf and has access to it only to keep it running.

## What is stored

For each account:

- Your username, a hash of your password (Argon2id: the password itself is never stored), and when you signed up.
- The profile fields you fill in: bio, homepage and social links, your avatar's settings, the colour theme, time zone and share card colour you picked, and whether you turned JavaScript off.
- Only if you set it: a coarse location, a 1° by 1° square, about 111 km across. Only you see it, but it puts your blurts in "Near you" for people nearby.
- Your blurts and replies, with when you posted them, and for each one an embedding: numbers describing what it's about, for related blurts and "You might like". It's computed on our own server; your text isn't sent anywhere.
- If you attach one, a blurt's picture: only a rough drawing of it, made on our own server. The photo you upload is never stored.
- If you upload one, your profile picture: likewise only a rough drawing, and where you clicked for its mouth. It's public, like the avatar. With JavaScript on, both kinds of picture are first drawn as a preview in your browser: the picture doesn't leave your device until you post the blurt or upload it, and what is sent then is scaled down (a profile picture also cropped as you chose).
- Who you follow.
- Your notifications: a row per reply, reblurt, quote or (if you switched it on) new blurt from someone you follow, with who did it, which blurt and when, and whether you've read it. Read ones are deleted after 90 days. Which kinds you want is stored with your profile. Only you see them.
- Only if you turn on notifications on a device (on your edit page): that browser's push address, an address at the push service of whoever made the browser (Google, Mozilla, Apple or Microsoft), with the keys that come with it, tied to that login. It goes when you turn them off there, log out there, or delete your account.
- Blurts you like, and when. Only the number of likes on a blurt is public: nobody else sees who liked it.
- Blurts you reblurt, and when. Reblurts are public: they show on your profile and in your followers' feeds. A quote is a blurt of your own, with the quoted blurt under it.
- Your invite codes, and who signed up with them. Who invited you shows on your profile.
- Blurts you report, with your reason and when.
- Your sessions: one record per login, with when it started and was last used. No IP address and no browser details.

The waitlist stores only the username you'd like, whether you've signed up since, and when you joined it.

For deleted accounts, only the username is kept, in lower case and with nothing else, so it can't be taken again.

Public: your username, profile, avatar, blurts, reblurts, follower, like and reblurt counts, and who invited you. Everything else is private, though admins see who reported what.

## What is not stored

- No email address. So we can't contact you, and there's **no password reset**: a lost password can't be recovered, and neither can the account.
- No IP addresses in the database or in the app's logs. Rate limiting counts requests per IP address in memory only, until the limit has refilled (an hour at most), and never writes them down. The web server's access log keeps addresses shortened (the last part dropped) for at most 14 days, to spot abuse.
- The app's logs hold what was asked for and how it went (method, path, status, time), never what you posted, your password or your cookies.

## Cookies

Up to four, all strictly necessary for things you ask the site to do, none for tracking or analytics, so there's no cookie banner. Visitors who aren't logged in get none, unless they turn JavaScript off. All four are HttpOnly, Secure and SameSite=Lax, and only sent to blurt.trade.

The site works fully without JavaScript. Its JavaScript is optional ([you can turn it off](</about#javascript>)), comes only from blurt.trade, and stores nothing in your browser: no local storage, no other cookies. While a page is open, it keeps a connection to blurt.trade for the unread count and new blurts.

Only if you turn on notifications on a device does the browser keep something of ours: a service worker, a small script it runs to show the notifications. It caches nothing, and it's removed when you turn notifications off there. The push that wakes it passes through your browser maker's push service, but carries nothing: no text, no names, not even what kind of notification it is. It only tells your browser to ask blurt.trade what's new, which it then fetches straight from us.

| Cookie | What it's for | Lasts |
| --- | --- | --- |
| `__Host-access_token` | Shows you're logged in, with your colour theme, time zone, language and whether JavaScript is on | 5 minutes |
| `__Host-refresh_token` | Keeps you logged in and renews the one above | Until you close the browser, or, if you ticked *Keep me logged in*, 400 days without a visit. Gone when you log out. |
| `recent_write` | After you post or change something, makes sure you see your own change straight away | 10 seconds |
| `javascript` | Only once you turn JavaScript off: remembers that in this browser. Logged in, it's saved on your account too, and the account's setting counts | 400 days, or until you turn JavaScript back on |

## Why we may use your data

- Your account, posts, follows, likes and the rest, to provide the service you signed up for (contract, GDPR Art. 6(1)(b)).
- The optional coarse location, because you chose to set it (consent, Art. 6(1)(a)). Clear it to withdraw.
- Rate limiting and the web server's access log, to protect the site from abuse (legitimate interests, Art. 6(1)(f)).

## Backups

There are no backups. If the server's disk fails, the data is gone, and deleting your account removes it everywhere.

## Deleting your account

[Settings](</settings>) has "Delete my account", which asks for your password. It deletes at once, in one go, everything above that belongs to the account: your profile, avatar and location, the text of your blurts and their embeddings, your reblurts, who you follow and who follows you, your likes (and the likes on your blurts), your notifications, your invite codes, your reports, your sessions and your waitlist entry. You're logged out everywhere.

What stays: an empty record of the account, with no username, password or profile, and an empty row for each of your blurts, with no text, which shows nowhere and names nobody. A blurt someone replied to shows as an empty placeholder, with no text and no author, so the thread still reads. The invite code you signed up with stays marked as used, with nothing linking it to you. Your username goes on the list of retired names, with nothing else, so nobody can sign up as you later. The count of sign-ups so far doesn't go down.

## Your rights

You can ask what is stored about you, and have it corrected, deleted or handed to you in a form you can reuse (data portability), and you can object to how it is used: email [owner@blurt.example](<mailto:owner@blurt.example>). You can also complain to the Norwegian Data Protection Authority, [Datatilsynet](<https://www.datatilsynet.no>).
