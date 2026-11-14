-- Up Migration

-- The "Use JavaScript" setting (/settings): false turns the site's optional JavaScript off
-- for this account, so its pages carry no <script>, import map or module preload at all.
-- On by default, so existing accounts keep the default. Like the theme it goes into the
-- access token at login and at each refresh (src/middleware/auth.ts), so pages know it
-- without reading this table. Visitors who aren't logged in use a cookie instead.
ALTER TABLE user_profiles ADD COLUMN javascript boolean NOT NULL DEFAULT true;

-- Down Migration

ALTER TABLE user_profiles DROP COLUMN javascript;
