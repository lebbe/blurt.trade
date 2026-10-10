-- Up Migration

-- Single-use invite codes. user_id owns the code (the inviter, and the sharding key);
-- used_by_user_id is who signed up with it. Every new user gets a few at sign-up, and
-- `node db/mint-invites.ts` mints more in bulk. Codes are 12 characters from an alphabet
-- without look-alikes (no 0/O, 1/I/L). See addUser in src/routes/state.ts.
--
-- used_at is what marks a code as used, not used_by_user_id: if the invitee's account is
-- ever deleted, used_by_user_id goes NULL, and the code must not become usable again.
-- expires_at is NULL for codes that never expire.
CREATE TABLE invite_codes (
  code            text PRIMARY KEY CHECK (code ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{12}$'),
  user_id         bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  used_by_user_id bigint UNIQUE REFERENCES users (id) ON DELETE SET NULL, -- one inviter each
  created_at      timestamptz NOT NULL DEFAULT now(),
  used_at         timestamptz,
  expires_at      timestamptz,
  CHECK (used_by_user_id IS NULL OR used_at IS NOT NULL)
);

-- "Your invite codes" on the owner's profile.
CREATE INDEX invite_codes_user_id_idx ON invite_codes (user_id, created_at);

-- Existing users get the same three codes new users get. gen_random_uuid() is a strong
-- random source; its first 12 hex digits (48 random bits) are mapped onto 16 letters and
-- digits of the code alphabet.
INSERT INTO invite_codes (code, user_id)
SELECT translate(left(replace(gen_random_uuid()::text, '-', ''), 12),
                 '0123456789abcdef', '23456789ABCDEFGH'),
       users.id
FROM users CROSS JOIN generate_series(1, 3);

-- Down Migration

DROP TABLE invite_codes;
