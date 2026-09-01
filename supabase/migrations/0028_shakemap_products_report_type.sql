-- 0028: the engine's downloadable PDF report joins the shakemap_products index.
alter table public.shakemap_products
  drop constraint if exists shakemap_products_product_type_check;
alter table public.shakemap_products
  add constraint shakemap_products_product_type_check check (
    product_type in (
      'contours', 'raster', 'metadata',
      'risk_contours', 'risk_districts', 'risk_summary', 'risk_grid',
      'report'
    )
  );
comment on column public.shakemap_products.product_type is
  'contours | raster | metadata (hazard) | risk_contours | risk_districts | risk_summary | risk_grid (risk) | report (PDF report per version)';
