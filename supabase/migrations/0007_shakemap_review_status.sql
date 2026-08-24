-- Bumelerze schema — D21 scientist-review status on shakemap_products
-- (`docs/decisions.md` D21 "Own shakemaps everywhere; USGS demoted to
-- data + validation; Bumelerze Atlas": "every product carries review_status
-- (automatic | reviewed); the app displays it (provenance-as-UI). Peshawa
-- flips the flag via a simple review channel (script/dashboard first, admin
-- UI later)."). Additive-only — this migration has never been applied
-- against a live database (PROJECT.md "Blocked on Peshawa": no Supabase
-- project exists yet), so the clean pattern is still a new numbered file,
-- never a hand-edit of 0006_shakemap_products.sql.

alter table public.shakemap_products
  add column review_status text not null default 'automatic'
    check (review_status in ('automatic', 'reviewed')),
  add column reviewed_by text,
  add column reviewed_at timestamptz;

comment on column public.shakemap_products.review_status is
  'D21 provenance-as-UI: "automatic" (default, machine-generated, every product until reviewed) or "reviewed" (a human — v1 review channel: scripts/review_product.py, run by Peshawa — has checked it). The app displays this on every ShakeMap section.';

comment on column public.shakemap_products.reviewed_by is
  'D21: who reviewed this product version (free text, v1 — Peshawa''s name/identifier). NULL while review_status = ''automatic''.';

comment on column public.shakemap_products.reviewed_at is
  'D21: when this product version was reviewed. NULL while review_status = ''automatic''.';

-- A reviewed row must carry who/when; an automatic row must not fabricate
-- either (D21: "provenance-as-UI" — never a half-populated review record).
alter table public.shakemap_products
  add constraint shakemap_products_review_fields_consistent check (
    (review_status = 'reviewed' and reviewed_by is not null and reviewed_at is not null)
    or
    (review_status = 'automatic' and reviewed_by is null and reviewed_at is null)
  );

-- No RLS change needed: 0006's public-select policy already covers these
-- new columns (row-level, not column-level, security); writes still come
-- only from the shake-service via the service_role key.
