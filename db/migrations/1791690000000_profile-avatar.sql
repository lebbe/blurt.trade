-- Up Migration

-- The profile avatar (src/avatar.ts): a few choices as JSON, drawn as SVG by the app. Never
-- markup or an uploaded image. New profiles get a random one when they are created
-- (addUser); profiles from before this get a random one here, from the same palettes.
ALTER TABLE user_profiles ADD COLUMN avatar jsonb;

UPDATE user_profiles SET avatar = jsonb_build_object(
  'skin', (ARRAY['#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffe0bd', '#f5cfa0',
    '#d1a07a'])[1 + floor(random() * 8)::int],
  'hairType', (ARRAY['bald', 'tuft', 'flat', 'spiky', 'mohawk', 'afro'])[1 + floor(random() * 6)::int],
  'hairColor', (ARRAY['#090806', '#2c222b', '#3b3024', '#6a4e42', '#a7856a', '#dcd0ba', '#e6cea8',
    '#b55239', '#8d4a43'])[1 + floor(random() * 9)::int],
  'eyeType', (ARRAY['classic', 'dots', 'round', 'wide', 'sleepy', 'angry'])[1 + floor(random() * 6)::int],
  'eyeColor', (ARRAY['#ffffff', '#fdfdf5', '#f7f3e8'])[1 + floor(random() * 3)::int],
  'pupilColor', (ARRAY['#000000', '#1b1b1b', '#3d2314', '#2b4f81', '#3b6e3a'])[1 + floor(random() * 5)::int],
  'toothType', (ARRAY['two', 'buck', 'gap', 'full'])[1 + floor(random() * 4)::int],
  'toothColor', (ARRAY['#ffffff', '#fffbe8', '#f4ecd0', '#ece3c0'])[1 + floor(random() * 4)::int]
);

-- The app validates avatars before saving them and checks them again when drawing them;
-- this keeps anything else out of the table too. Colours are lower-case #rrggbb. IS TRUE,
-- because a missing key makes its test NULL, which a plain CHECK would let through.
ALTER TABLE user_profiles ALTER COLUMN avatar SET NOT NULL,
  ADD CONSTRAINT user_profiles_avatar_valid CHECK ((
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

-- Down Migration

ALTER TABLE user_profiles DROP COLUMN avatar;
