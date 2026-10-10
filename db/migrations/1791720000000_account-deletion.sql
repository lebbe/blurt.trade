-- Up Migration

-- Usernames of deleted accounts, in lower case, so nobody can sign up as (and pass for)
-- someone who left. Nothing else: no user id, no date. Account deletion (deleteAccount in
-- src/routes/state.ts) adds the name; sign-up and the waitlist refuse it. To free one by
-- hand: DELETE FROM retired_usernames WHERE username = lower('...');
CREATE TABLE retired_usernames (
  username text PRIMARY KEY CHECK (username ~ '^[a-z0-9_]{1,40}$')
);

-- Down Migration

DROP TABLE retired_usernames;
