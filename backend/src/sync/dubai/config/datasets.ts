/**
 * Declarative dataset registry — the ONLY place you edit to add a synced dataset.
 * Slugs & fields CONFIRMED via probe (2026-06-08) against STG.
 * See docs/reports/2026-06-08-dubai-api-accessible-datasets.md
 *
 * Target tables already exist (dld_transactions / dld_rent_contracts / dld_valuations).
 * Normalization (bedrooms/ptype/size_band) is computed in views v_sales/v_rent — NOT here.
 * After sync, run area matching (area_id -> dubai_area_id) like the existing import does.
 *
 * ⚠️ STG returns synthetic values — sync into prod tables only with PROD creds.
 */
import { DatasetConfig } from '../core/types'

export const DATASETS: DatasetConfig[] = [
  {
    key: 'dld_transactions',
    entity: 'dld',
    dataset: 'dld_transactions-open-api',
    targetTable: 'dld_transactions',
    primaryKey: ['transaction_id'],
    incremental: { column: 'load_timestamp' },
    enabled: true,
    fieldMap: {
      transaction_id:   { from: 'transaction_id' },
      trans_group:      { from: 'trans_group_en' },
      procedure_name:   { from: 'procedure_name_en' },
      instance_date:    { from: 'instance_date', coerce: 'date' },
      property_type:    { from: 'property_type_en' },
      property_sub_type:{ from: 'property_sub_type_en' },
      property_usage:   { from: 'property_usage_en' },
      is_offplan:       { from: 'reg_type_en', coerce: 'offplan' },
      area_id:          { from: 'area_id', coerce: 'number' },
      area_name:        { from: 'area_name_en' },
      building_name:    { from: 'building_name_en' },
      project_name:     { from: 'project_name_en' },
      master_project:   { from: 'master_project_en' },
      nearest_landmark: { from: 'nearest_landmark_en' },
      nearest_metro:    { from: 'nearest_metro_en' },
      nearest_mall:     { from: 'nearest_mall_en' },
      rooms:            { from: 'rooms_en' },
      has_parking:      { from: 'has_parking', coerce: 'bool' },
      procedure_area:   { from: 'procedure_area', coerce: 'number' },
      actual_worth:     { from: 'actual_worth', coerce: 'number' },
      meter_sale_price: { from: 'meter_sale_price', coerce: 'number' },
      rent_value:       { from: 'rent_value', coerce: 'number' },
      meter_rent_price: { from: 'meter_rent_price', coerce: 'number' },
      load_timestamp:   { from: 'load_timestamp', coerce: 'datetime' },
    },
  },
  {
    key: 'dld_rent_contracts',
    entity: 'dld',
    dataset: 'dld_rent_contracts-open-api',
    targetTable: 'dld_rent_contracts',
    primaryKey: ['contract_id'],
    incremental: { column: 'load_timestamp' },
    enabled: true,
    fieldMap: {
      contract_id:       { from: 'contract_id' },
      registration_type: { from: 'contract_reg_type_en' },
      start_date:        { from: 'contract_start_date', coerce: 'date' },
      end_date:          { from: 'contract_end_date', coerce: 'date' },
      annual_amount:     { from: 'annual_amount', coerce: 'number' },
      property_type:     { from: 'ejari_property_type_en' },
      property_subtype:  { from: 'ejari_property_sub_type_en' },
      usage_type:        { from: 'property_usage_en' },
      property_area:     { from: 'actual_area', coerce: 'number' },
      area_id:           { from: 'area_id', coerce: 'number' },
      area_name:         { from: 'area_name_en' },
      area_name_ar:      { from: 'area_name_ar' },
      project_name:      { from: 'project_name_en' },
      tenant_type:       { from: 'tenant_type_en' },
      load_timestamp:    { from: 'load_timestamp', coerce: 'datetime' },
    },
  },
  {
    key: 'dld_valuations',
    entity: 'dld',
    dataset: 'dld_valuation-open-api',
    targetTable: 'dld_valuations',
    primaryKey: ['procedure_id'],
    incremental: { column: 'load_timestamp' },
    enabled: true,
    fieldMap: {
      procedure_id:         { from: 'procedure_id' },
      instance_date:        { from: 'instance_date', coerce: 'date' },
      property_type:        { from: 'property_type_en' },
      property_sub_type:    { from: 'property_sub_type_en' },
      area_id:              { from: 'area_id', coerce: 'number' },
      area_name:            { from: 'area_name_en' },
      actual_area:          { from: 'actual_area', coerce: 'number' },
      actual_worth:         { from: 'actual_worth', coerce: 'number' },
      property_total_value: { from: 'property_total_value', coerce: 'number' },
      load_timestamp:       { from: 'load_timestamp', coerce: 'datetime' },
    },
  },
]
