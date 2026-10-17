-- Up Migration

-- The background colour of the user's share cards (src/card-colors.ts), or NULL for the
-- default. A new colour needs its id added to the CHECK.
ALTER TABLE user_profiles ADD COLUMN card_color text
  CONSTRAINT user_profiles_card_color_valid CHECK (
    card_color IN ('navy', 'forest', 'plum', 'clay', 'teal')
  );

-- Down Migration

ALTER TABLE user_profiles DROP COLUMN card_color;
