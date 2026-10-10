-- Up Migration

-- The postgis extension itself is created by a superuser (see db/setup-wsl.sh);
-- this is a no-op when it already exists, and fails loudly when it doesn't.
CREATE EXTENSION IF NOT EXISTS postgis;

-- Where the user is, coarsely: opt-in, on the profile only (never on blurts), and always
-- the centre of a 1° x 1° grid cell (about 110 km across). The app snaps every point it
-- gets to a cell centre (gridDegrees in src/routes/location.ts); the CHECK makes sure
-- nothing more precise is ever stored. NULL means no location.
ALTER TABLE user_profiles ADD COLUMN location geography(Point, 4326)
  CONSTRAINT user_profiles_location_grid CHECK (
    location IS NULL OR (
      ST_X(location::geometry) - floor(ST_X(location::geometry)) = 0.5
      AND ST_Y(location::geometry) - floor(ST_Y(location::geometry)) = 0.5
    )
  );

-- Radius queries (ST_DWithin): "blurts near you" and nearby discovery.
CREATE INDEX user_profiles_location_idx ON user_profiles USING gist (location);

-- Down Migration

DROP INDEX user_profiles_location_idx;
ALTER TABLE user_profiles DROP COLUMN location;
