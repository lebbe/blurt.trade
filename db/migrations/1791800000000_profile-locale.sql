-- Up Migration

-- The language (locale, "nb-NO") dates and times are written in, from the list in
-- src/timezones.ts, or NULL to follow the browser's Accept-Language. Goes into the access
-- token with the time zone.
ALTER TABLE user_profiles ADD COLUMN locale text;

-- Down Migration

ALTER TABLE user_profiles DROP COLUMN locale;
