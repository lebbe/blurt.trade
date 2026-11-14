# Delete account: ada

[Back to settings](</settings>)

- Your profile, avatar, location, follows (both ways), likes, reblurts, sessions, invite codes and reports are deleted.

- Your blurts, replies and quotes are deleted: their text is removed, and nothing shows they were yours. One that someone replied to stays as an empty placeholder, with no text and no author, so their replies still read.

- Your username is retired: nobody can sign up with it again, so nobody can pass for you.

- You're logged out everywhere. It can't be undone; nightly backups still hold the account for up to 30 days.

Send `POST /settings/delete` as a form or as JSON with your `password` to confirm.
