-- 0027: risk products join the shakemap_products index.
-- The engine's risk chain (gridded exposure, damage map, Monte Carlo)
-- publishes four more artifacts per version next to the hazard products:
--   risk_contours   cont_damage.json   isolines of expected damage grade
--   risk_districts  districts.json     per-province damage bands (P05/P50/P95)
--   risk_summary    risk_summary.json  national totals + settings
--   risk_grid       damage_grid.json   per-cell raster (opt-in, like raster)
-- Casualties are computed but withheld from every product (engine config
-- PUBLISH_CASUALTIES = false); these rows never carry them.
-- Additive-only: the check constraint is replaced with a wider list, no
-- existing row changes.

alter table public.shakemap_products
  drop constraint if exists shakemap_products_product_type_check;

alter table public.shakemap_products
  add constraint shakemap_products_product_type_check check (
    product_type in (
      'contours', 'raster', 'metadata',
      'risk_contours', 'risk_districts', 'risk_summary', 'risk_grid'
    )
  );

comment on column public.shakemap_products.product_type is
  'contours | raster | metadata (hazard) | risk_contours | risk_districts | risk_summary | risk_grid (risk, engine D46)';
