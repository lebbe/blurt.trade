-- Up Migration

-- Usernames are URL path segments (/:username/), so only letters, digits and underscore.
-- No dots means no collisions with files like favicon.ico or manifest.json.
-- Reserved names (login, api, ...) are enforced in the app, since that list follows the routes.
ALTER TABLE users ADD CONSTRAINT users_username_format CHECK (username ~ '^[A-Za-z0-9_]{1,40}$');

-- Unique regardless of case: "Lars" and "lars" are the same profile URL.
-- This index also serves the case-insensitive lookups.
CREATE UNIQUE INDEX users_username_lower_key ON users (lower(username));
ALTER TABLE users DROP CONSTRAINT users_username_key;

-- Down Migration

ALTER TABLE users ADD CONSTRAINT users_username_key UNIQUE (username);
DROP INDEX users_username_lower_key;
ALTER TABLE users DROP CONSTRAINT users_username_format;
