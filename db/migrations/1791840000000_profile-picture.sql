-- Up Migration

-- The profile picture: an uploaded photo, cropped square and redrawn like a blurt's picture
-- (src/picture.ts, encodeShapes). Never the upload itself. When there is one it replaces the
-- cartoon avatar everywhere, as two images cut apart where the mouth is: picture_cut, in
-- percent from the top. picture_version goes up with every upload, so the picture's URLs
-- (/profile-pictures/...) change and can be cached for ever.
ALTER TABLE user_profiles
  ADD COLUMN picture bytea CHECK (octet_length(picture) BETWEEN 6 AND 65536),
  ADD COLUMN picture_version integer NOT NULL DEFAULT 0 CHECK (picture_version >= 0),
  ADD COLUMN picture_cut smallint NOT NULL DEFAULT 65 CHECK (picture_cut BETWEEN 5 AND 95);

-- Down Migration

ALTER TABLE user_profiles
  DROP COLUMN picture,
  DROP COLUMN picture_version,
  DROP COLUMN picture_cut;
