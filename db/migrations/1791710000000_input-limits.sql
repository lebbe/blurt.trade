-- Up Migration

-- Profile links are http(s) only (isWebUrl in src/limits.ts), so a profile can never link
-- to javascript: or data:. The length limits are in the initial schema already. A social
-- field is either a link or a handle, as the app validates it (src/routes/profiles.ts).
ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_homepage_web_url CHECK (homepage = '' OR homepage ~* '^https?://'),
  ADD CONSTRAINT user_profiles_x_valid
    CHECK (x = '' OR x ~* '^https?://' OR x ~ '^@?[A-Za-z0-9._-]{1,100}$'),
  ADD CONSTRAINT user_profiles_instagram_valid
    CHECK (instagram = '' OR instagram ~* '^https?://' OR instagram ~ '^@?[A-Za-z0-9._-]{1,100}$'),
  ADD CONSTRAINT user_profiles_tiktok_valid
    CHECK (tiktok = '' OR tiktok ~* '^https?://' OR tiktok ~ '^@?[A-Za-z0-9._-]{1,100}$'),
  ADD CONSTRAINT user_profiles_youtube_valid
    CHECK (youtube = '' OR youtube ~* '^https?://' OR youtube ~ '^@?[A-Za-z0-9._-]{1,100}$'),
  ADD CONSTRAINT user_profiles_github_valid
    CHECK (github = '' OR github ~* '^https?://' OR github ~ '^@?[A-Za-z0-9._-]{1,100}$'),
  ADD CONSTRAINT user_profiles_linkedin_valid
    CHECK (linkedin = '' OR linkedin ~* '^https?://' OR linkedin ~ '^@?[A-Za-z0-9._-]{1,100}$');

-- Down Migration

ALTER TABLE user_profiles
  DROP CONSTRAINT user_profiles_homepage_web_url,
  DROP CONSTRAINT user_profiles_x_valid,
  DROP CONSTRAINT user_profiles_instagram_valid,
  DROP CONSTRAINT user_profiles_tiktok_valid,
  DROP CONSTRAINT user_profiles_youtube_valid,
  DROP CONSTRAINT user_profiles_github_valid,
  DROP CONSTRAINT user_profiles_linkedin_valid;
