-- 0030: Engine v2.0 area statistics join the shakemap_products index.
-- `risk_areas` is areas.json: damage per governorate, district,
-- sub-district and city (OCHA COD-AB p-codes, GHS urban-centre ids).
alter table public.shakemap_products
  drop constraint if exists shakemap_products_product_type_check;
alter table public.shakemap_products
  add constraint shakemap_products_product_type_check check (
    product_type in (
      'contours', 'raster', 'metadata',
      'risk_contours', 'risk_districts', 'risk_summary', 'risk_grid', 'risk_areas',
      'report'
    )
  );
comment on column public.shakemap_products.product_type is
  'contours | raster | metadata (hazard) | risk_contours | risk_districts | risk_summary | risk_grid | risk_areas (risk) | report (PDF report per version)';
