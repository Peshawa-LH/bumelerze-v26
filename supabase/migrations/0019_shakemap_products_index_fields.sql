-- 0019: shakemap_products becomes a real INDEX, not a would-be artifact
-- store. Owner architecture decision: Supabase holds the small, queryable
-- index row (event reference, version, engine provenance, review status,
-- a coarse bounding box, and a URL to the artifact) — the artifact FILES
-- (contours/raster/metadata JSON) live in a separate public data
-- repository, the Bumelerze Atlas, published outside this database
-- entirely (`shake_service/worker/uploader.py`'s `AtlasRepoPublisher`).
-- Additive-only per this repo's migration convention: a new numbered
-- file, never a hand-edit of 0006/0007.
--
-- No change was needed for the engine-provenance requirement this same
-- uploader wave also had to satisfy: `data_used` (0006) is already
-- producer-defined JSONB — the uploader writes the computed engine-version
-- block (service version, GSIM branches, GMICE models, conditioning
-- method) straight into that existing column, no DDL required. This
-- migration only adds the ONE genuinely new fact an index row needs that
-- no existing column can hold: a coarse spatial extent, so a map
-- viewport/layer-registry query can filter without opening every
-- artifact.

-- ---------------------------------------------------------------------------
-- 1. Coarse bounding box — plain double precision columns, matching this
--    repo's own established convention for coordinate data (0002's own
--    comment: "no GiST indexes or geography columns are introduced ...
--    plain lat/lon comparisons is enough at the region's scale") rather
--    than introducing a PostGIS geometry column for one indexing field.
--    Nullable: a product published before this bbox derivation existed, or
--    one whose info.json couldn't be read, honestly carries NULL rather
--    than a fabricated box (`uploader.py`'s `_bbox_from_info` docstring).
-- ---------------------------------------------------------------------------
alter table public.shakemap_products
  add column bbox_min_lat double precision,
  add column bbox_max_lat double precision,
  add column bbox_min_lon double precision,
  add column bbox_max_lon double precision,
  add constraint shakemap_products_bbox_lat_range check (
    bbox_min_lat is null or bbox_min_lat between -90 and 90
  ),
  add constraint shakemap_products_bbox_lat_order check (
    bbox_min_lat is null or bbox_max_lat is null or bbox_min_lat <= bbox_max_lat
  ),
  add constraint shakemap_products_bbox_lon_range check (
    bbox_min_lon is null or bbox_min_lon between -180 and 180
  ),
  add constraint shakemap_products_bbox_lon_order check (
    bbox_min_lon is null or bbox_max_lon is null or bbox_min_lon <= bbox_max_lon
  ),
  -- All four are set together (one derivation, `_bbox_from_info`) or none
  -- are — never a half-populated box.
  add constraint shakemap_products_bbox_all_or_none check (
    (bbox_min_lat is null and bbox_max_lat is null and bbox_min_lon is null and bbox_max_lon is null)
    or
    (bbox_min_lat is not null and bbox_max_lat is not null and bbox_min_lon is not null and bbox_max_lon is not null)
  );

comment on column public.shakemap_products.bbox_min_lat is
  'Coarse indexing-only bounding box (uploader.py''s _bbox_from_info: event epicenter +/- the forward-map grid''s half_extent_km, spherical-Earth approximation) — good enough for a map viewport/layer-registry filter, NOT a scientific product output. NULL when it could not be derived.';
comment on column public.shakemap_products.bbox_max_lat is 'See bbox_min_lat.';
comment on column public.shakemap_products.bbox_min_lon is 'See bbox_min_lat.';
comment on column public.shakemap_products.bbox_max_lon is 'See bbox_min_lat.';

-- ---------------------------------------------------------------------------
-- 2. storage_path's semantics, made explicit for bumelerze-produced rows
--    too (comment-only change — no column reshape). 0006 already allowed
--    this shape for USGS pass-through rows; this just documents that the
--    real SupabaseUploader now uses the SAME shape for its own rows.
-- ---------------------------------------------------------------------------
comment on column public.shakemap_products.storage_path is
  'Public URL (or, before the Bumelerze Atlas data repository has a real published base URL, a repo-relative path — see BUMELERZE_ATLAS_BASE_URL in shake-service/.env.example) to the artifact file. Never a Supabase Storage path, never inline bytes: artifacts live in a separate public data repository, this column only points at them (owner architecture decision, SupabaseUploader integration wave). USGS pass-through rows have always used this column for an external URL (0006''s original comment) — bumelerze-produced rows now use the identical shape.';

-- No RLS change needed: 0006's public-select policy already covers these
-- new columns (row-level, not column-level, security); writes still come
-- only from the shake-service via the service_role key.
