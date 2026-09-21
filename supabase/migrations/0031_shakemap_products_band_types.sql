-- 0031: filled band geometry joins the shakemap_products index.
--
-- `contours`/`risk_contours` are LINE products (cont_mi.json,
-- cont_damage.json), faithful to the USGS cont_mi.json shape: a contour
-- that leaves the grid through its boundary is an OPEN path. A renderer
-- cannot close such a path correctly on its own, because the correct
-- closure is a walk along the grid boundary, not a chord between the
-- path's two ends. Closing it with a chord is what broke the far field of
-- every published map until 2026-09-21.
--
-- `contour_bands` (bands_mi.json) and `risk_contour_bands`
-- (bands_damage.json) are the FILL products the app paints: closed
-- `value >= level` polygons, holes included, boundary walked. Both are
-- generated alongside their line counterparts, which stay published for
-- stroking contour lines and for consumers that want isolines.
alter table public.shakemap_products
  drop constraint if exists shakemap_products_product_type_check;
alter table public.shakemap_products
  add constraint shakemap_products_product_type_check check (
    product_type in (
      'contours', 'contour_bands', 'raster', 'metadata',
      'risk_contours', 'risk_contour_bands', 'risk_districts', 'risk_summary',
      'risk_grid', 'risk_areas',
      'report'
    )
  );
comment on column public.shakemap_products.product_type is
  'contours (lines) | contour_bands (fills) | raster | metadata (hazard) | risk_contours (lines) | risk_contour_bands (fills) | risk_districts | risk_summary | risk_grid | risk_areas (risk) | report (PDF report per version)';
