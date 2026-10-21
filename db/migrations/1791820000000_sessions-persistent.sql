-- Up Migration

-- Whether the login asked to be kept ("Keep me logged in"). A session without it gets a
-- browser-session refresh cookie and a short idle limit (see src/middleware/auth.ts).
-- Rows that exist now were all persistent logins, so they stay that way.
ALTER TABLE sessions ADD COLUMN persistent boolean NOT NULL DEFAULT true;

-- Down Migration

ALTER TABLE sessions DROP COLUMN persistent;
