-- Up Migration

-- Login credentials only. user_id is the sharding key used by every other table.
CREATE TABLE users (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username      text NOT NULL UNIQUE CHECK (char_length(username) BETWEEN 1 AND 40),
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- One row per user. Empty string means "not set", matching the app's UserProfile type.
CREATE TABLE user_profiles (
  user_id    bigint PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  homepage   text NOT NULL DEFAULT '' CHECK (char_length(homepage) <= 200),
  x          text NOT NULL DEFAULT '' CHECK (char_length(x) <= 200),
  instagram  text NOT NULL DEFAULT '' CHECK (char_length(instagram) <= 200),
  tiktok     text NOT NULL DEFAULT '' CHECK (char_length(tiktok) <= 200),
  youtube    text NOT NULL DEFAULT '' CHECK (char_length(youtube) <= 200),
  github     text NOT NULL DEFAULT '' CHECK (char_length(github) <= 200),
  linkedin   text NOT NULL DEFAULT '' CHECK (char_length(linkedin) <= 200),
  bio        text NOT NULL DEFAULT '' CHECK (char_length(bio) <= 4000),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE blurts (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  text       text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 280),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Cursor pagination: global feed, and per-author (profile page / following feed).
CREATE INDEX blurts_created_at_idx ON blurts (created_at DESC, id DESC);
CREATE INDEX blurts_user_id_created_at_idx ON blurts (user_id, created_at DESC, id DESC);

-- Down Migration

DROP TABLE blurts;
DROP TABLE user_profiles;
DROP TABLE users;
