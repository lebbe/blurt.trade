-- Up Migration

-- The IANA time zone the user's timestamps are shown in (src/timezones.ts), picked on their
-- edit page, or NULL for the site's default (UTC), so changing the default needs no data
-- migration. Browsers send no time zone and the site runs without JS, so it can't be
-- guessed. Like the theme it goes into the access token. The names are checked by the app
-- against the runtime's list, which a CHECK here couldn't follow.
ALTER TABLE user_profiles ADD COLUMN timezone text;

UPDATE user_profiles SET timezone = 'Europe/Oslo'
WHERE user_id IN (SELECT id FROM users WHERE lower(username) = 'tante');

-- Down Migration

ALTER TABLE user_profiles DROP COLUMN timezone;
