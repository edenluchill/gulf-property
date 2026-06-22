-- Post-swap fixup — run INSIDE the swap transaction, right after the RENAME.
-- Rebinds the analytics views to the (new) live tables and fixes sequence
-- ownership, so the shadow-swap never again leaves views pointing at *_old.
-- No BEGIN/COMMIT here: the caller (swap-shadow-tables.ts) owns the transaction.
-- Keep the view bodies in sync with their canonical definitions.

-- Sequence that the live dld_transactions.id default uses must be OWNED BY the
-- live table, else DROP-ing the *_old table is blocked / would orphan it.
ALTER SEQUENCE IF EXISTS dld_transactions_id_seq OWNED BY dld_transactions.id;

CREATE OR REPLACE VIEW v_sales AS
 SELECT t.transaction_id,
    t.instance_date AS txn_date,
    t.area_id,
    dla.dubai_area_id,
    t.area_name,
        CASE t.property_type
            WHEN 'Unit'::text THEN 'apartment'::text
            WHEN 'Villa'::text THEN 'villa'::text
            WHEN 'Land'::text THEN 'land'::text
            WHEN 'Building'::text THEN 'building'::text
            ELSE lower(t.property_type::text)
        END AS ptype,
        CASE
            WHEN t.rooms::text = 'Studio'::text THEN 0
            WHEN t.rooms::text ~ '^[0-9]+ B/R$'::text THEN split_part(t.rooms::text, ' '::text, 1)::integer
            ELSE NULL::integer
        END AS bedrooms,
    t.procedure_area AS size_sqm,
        CASE
            WHEN t.procedure_area IS NULL THEN NULL::text
            WHEN t.procedure_area < 50::numeric THEN 'XS'::text
            WHEN t.procedure_area < 100::numeric THEN 'S'::text
            WHEN t.procedure_area < 200::numeric THEN 'M'::text
            WHEN t.procedure_area < 400::numeric THEN 'L'::text
            ELSE 'XL'::text
        END AS size_band,
    COALESCE(t.is_offplan, false) AS is_offplan,
    t.has_parking,
    t.property_usage,
    t.project_name,
    t.actual_worth AS price_aed,
    t.meter_sale_price AS price_sqm
   FROM dld_transactions t
     LEFT JOIN dld_areas dla ON dla.area_id = t.area_id
  WHERE t.trans_group::text = 'Sales'::text AND t.meter_sale_price > 0::numeric AND t.instance_date <= CURRENT_DATE AND t.instance_date >= '2000-01-01'::date;

CREATE OR REPLACE VIEW v_rent AS
 SELECT r.contract_id,
    COALESCE(r.dubai_area_id, dla.dubai_area_id) AS dubai_area_id,
    r.area_id,
    r.area_name,
        CASE
            WHEN r.property_type::text = ANY (ARRAY['Flat'::character varying, 'Studio '::character varying, 'Studio'::character varying, 'Hotel apartments'::character varying]::text[]) THEN 'apartment'::text
            WHEN r.property_type::text = ANY (ARRAY['Villa'::character varying, 'Complex Villas'::character varying]::text[]) THEN 'villa'::text
            ELSE lower(r.property_type::text)
        END AS ptype,
    r.property_area AS size_sqm,
        CASE
            WHEN r.property_area IS NULL THEN NULL::text
            WHEN r.property_area < 50::numeric THEN 'XS'::text
            WHEN r.property_area < 100::numeric THEN 'S'::text
            WHEN r.property_area < 200::numeric THEN 'M'::text
            WHEN r.property_area < 400::numeric THEN 'L'::text
            ELSE 'XL'::text
        END AS size_band,
    r.annual_amount AS annual_rent,
    r.annual_amount / NULLIF(r.property_area, 0::numeric) AS rent_sqm,
    r.start_date
   FROM dld_rent_contracts r
     LEFT JOIN dld_areas dla ON dla.area_id = r.area_id
  WHERE (r.property_type::text = ANY (ARRAY['Flat'::character varying, 'Studio '::character varying, 'Studio'::character varying, 'Hotel apartments'::character varying, 'Villa'::character varying, 'Complex Villas'::character varying]::text[])) AND r.property_area >= 20::numeric AND r.annual_amount > 0::numeric AND r.annual_amount <= 500000::numeric AND (r.annual_amount / NULLIF(r.property_area, 0::numeric)) <= 3000::numeric AND r.start_date <= CURRENT_DATE AND r.start_date >= '2000-01-01'::date;

CREATE OR REPLACE VIEW dubai_area_metrics AS
 WITH recent_sales AS (
         SELECT dla.dubai_area_id,
            dt.meter_sale_price,
            dt.actual_worth,
            dt.procedure_area,
            dt.instance_date
           FROM dld_transactions dt
             JOIN dld_areas dla ON dla.area_id = dt.area_id
          WHERE dt.trans_group::text = 'Sales'::text AND dt.meter_sale_price > 0::numeric AND dt.instance_date > (now() - '1 year'::interval) AND dla.dubai_area_id IS NOT NULL
        ), previous_sales AS (
         SELECT dla.dubai_area_id,
            avg(dt.meter_sale_price) AS avg_price
           FROM dld_transactions dt
             JOIN dld_areas dla ON dla.area_id = dt.area_id
          WHERE dt.trans_group::text = 'Sales'::text AND dt.meter_sale_price > 0::numeric AND dt.instance_date >= (now() - '2 years'::interval) AND dt.instance_date <= (now() - '1 year'::interval) AND dla.dubai_area_id IS NOT NULL
          GROUP BY dla.dubai_area_id
        ), current_metrics AS (
         SELECT recent_sales.dubai_area_id,
            avg(recent_sales.meter_sale_price) AS avg_price_sqm,
            sum(recent_sales.actual_worth) AS total_volume,
            count(*) AS transaction_count,
            avg(recent_sales.procedure_area) AS avg_size
           FROM recent_sales
          GROUP BY recent_sales.dubai_area_id
        )
 SELECT da.id AS dubai_area_id,
    da.name,
    da.name_ar,
    round(cm.avg_price_sqm, 0) AS avg_price_sqm,
    round(cm.total_volume, 0) AS sales_volume,
    cm.transaction_count,
    round(cm.avg_size, 0) AS avg_size_sqm,
        CASE
            WHEN ps.avg_price > 0::numeric THEN round((cm.avg_price_sqm - ps.avg_price) / ps.avg_price * 100::numeric, 1)
            ELSE NULL::numeric
        END AS capital_growth_pct
   FROM dubai_areas da
     LEFT JOIN current_metrics cm ON cm.dubai_area_id = da.id
     LEFT JOIN previous_sales ps ON ps.dubai_area_id = da.id
  WHERE cm.transaction_count > 0;
