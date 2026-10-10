-- Up Migration

-- Exactly one row. current_count is how many sign-ups have happened. Below soft_limit,
-- anyone can sign up; from soft_limit up to hard_limit, only with an invite code; at
-- hard_limit, sign-up closes and people can join the waitlist. Raise the limits with a
-- plain UPDATE, no deploy needed. Sign-up claims a slot with one atomic
-- UPDATE ... WHERE current_count < limit, in the same transaction as creating the user
-- (see addUser in src/routes/state.ts).
CREATE TABLE signup_counter (
  id            boolean PRIMARY KEY DEFAULT true CHECK (id), -- only one row can exist
  current_count integer NOT NULL CHECK (current_count >= 0),
  soft_limit    integer NOT NULL CHECK (soft_limit >= 0),
  hard_limit    integer NOT NULL CHECK (hard_limit >= soft_limit)
);

INSERT INTO signup_counter (current_count, soft_limit, hard_limit)
SELECT count(*), 1000, 10000 FROM users;

-- People who wanted in after sign-up closed. Only the username they'd like, nothing
-- personal: no email, so we never contact them. They come back to /waitlist to check.
-- 'joined' once they've signed up with that username.
CREATE TABLE waitlist (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username   text NOT NULL CHECK (username ~ '^[A-Za-z0-9_]{1,40}$'),
  status     text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'joined')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One entry per username, in any letter case. Also serves the lookups.
CREATE UNIQUE INDEX waitlist_username_lower_key ON waitlist (lower(username));

-- Down Migration

DROP TABLE waitlist;
DROP TABLE signup_counter;
