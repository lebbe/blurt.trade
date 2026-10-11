-- Up Migration

-- The colour theme the user picked on their edit page (src/themes.ts), or NULL for the
-- site's default (defaultTheme there), so changing the default needs no data migration.
-- It goes into the access token at login and at each refresh, so pages know it without
-- reading this table. A new theme needs its id added to the CHECK.
ALTER TABLE user_profiles ADD COLUMN theme text
  CONSTRAINT user_profiles_theme_valid CHECK (
    theme IN ('midnight-clay', 'cobalt-quietude', 'forest-alloy', 'plum-steel', 'tarnished-teal')
  );

-- Down Migration

ALTER TABLE user_profiles DROP COLUMN theme;
