-- Up Migration

-- The avatar's head width (src/avatar.ts). Avatars from before it keep the head they had:
-- `regular`. The CHECK is the one from 1791690000000_profile-avatar.sql, plus headWidth.
UPDATE user_profiles SET avatar = avatar || '{"headWidth": "regular"}';

ALTER TABLE user_profiles DROP CONSTRAINT user_profiles_avatar_valid,
  ADD CONSTRAINT user_profiles_avatar_valid CHECK ((
    jsonb_typeof(avatar) = 'object'
    AND (avatar->>'headWidth') IN ('thin', 'slim', 'regular', 'broad', 'huge')
    AND (avatar->>'skin') ~ '^#[0-9a-f]{6}$'
    AND (avatar->>'hairType') IN ('bald', 'tuft', 'flat', 'spiky', 'mohawk', 'afro')
    AND (avatar->>'hairColor') ~ '^#[0-9a-f]{6}$'
    AND (avatar->>'eyeType') IN ('classic', 'dots', 'round', 'wide', 'sleepy', 'angry')
    AND (avatar->>'eyeColor') ~ '^#[0-9a-f]{6}$'
    AND (avatar->>'pupilColor') ~ '^#[0-9a-f]{6}$'
    AND (avatar->>'toothType') IN ('none', 'two', 'buck', 'gap', 'full')
    AND (avatar->>'toothColor') ~ '^#[0-9a-f]{6}$'
  ) IS TRUE);

-- Down Migration

ALTER TABLE user_profiles DROP CONSTRAINT user_profiles_avatar_valid;

UPDATE user_profiles SET avatar = avatar - 'headWidth';

ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_avatar_valid CHECK ((
    jsonb_typeof(avatar) = 'object'
    AND (avatar->>'skin') ~ '^#[0-9a-f]{6}$'
    AND (avatar->>'hairType') IN ('bald', 'tuft', 'flat', 'spiky', 'mohawk', 'afro')
    AND (avatar->>'hairColor') ~ '^#[0-9a-f]{6}$'
    AND (avatar->>'eyeType') IN ('classic', 'dots', 'round', 'wide', 'sleepy', 'angry')
    AND (avatar->>'eyeColor') ~ '^#[0-9a-f]{6}$'
    AND (avatar->>'pupilColor') ~ '^#[0-9a-f]{6}$'
    AND (avatar->>'toothType') IN ('none', 'two', 'buck', 'gap', 'full')
    AND (avatar->>'toothColor') ~ '^#[0-9a-f]{6}$'
  ) IS TRUE);
