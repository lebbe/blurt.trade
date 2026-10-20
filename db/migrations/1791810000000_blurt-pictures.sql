-- Up Migration

-- A blurt's picture: never the uploaded image, only a rough drawing of it in the binary
-- format of src/picture.ts (encodeShapes). width and height are the drawing's, for
-- <img width height>. At most one per blurt.
CREATE TABLE blurt_pictures (
  blurt_id bigint PRIMARY KEY REFERENCES blurts (id) ON DELETE CASCADE,
  width    smallint NOT NULL CHECK (width BETWEEN 1 AND 640),
  height   smallint NOT NULL CHECK (height BETWEEN 1 AND 640),
  shapes   bytea NOT NULL CHECK (octet_length(shapes) BETWEEN 6 AND 65536)
);

-- Down Migration

DROP TABLE blurt_pictures;
