> ⚠️ **已过时 / SUPERSEDED（2026-06-22）。** 本报告是 **STG** 探测，值为假数据，且把
> `dsc`/`rta`/`projects`/`buildings`/`service_charges` 误判为 403/422。**PROD 实测已推翻这些结论**
> （dsc/rta 免授权可拉、那批 422 在 PROD 正常）。请以 **`2026-06-22-dubai-api-prod-datasets.md`** 为准。
> 本文仅保留作历史记录，勿据此判断可达性。

# Dubai data.dubai API — 可访问数据集探测报告（STG·已过时）

> 日期:2026-06-08 · 环境:**STG** · Application Id `PUBLIC-USR-UID-4057946`
> 探测方式:经 UAE 代理(`38.54.8.9:8888`)从本地实测;OAuth2 真凭证;共探 ~65 个端点 / 7 个实体。
> 相关:同步系统设计 `docs/dubai-data-api-sync-spec.md` · 代码 `backend/src/sync/dubai/`

---

## 0. 关键结论

1. **没有目录/枚举 API。** `/open`、`/open/{entity}`、`/secure/ddads/openapi/1.0.0/{catalog,datasets,entities}` 全部 404(`/open` 只返回 iPaaS 管理页 HTML)。→ **100% 完整清单只能从 data.dubai 门户的 `Data and Statistics → Entities` 获取。**
2. **`dld` 实体的 open 数据集对当前凭证默认开放**,无需门户单独申请。命名规律:`dld_<name>-open-api`。
3. **当前可正常拉取:11 个 DLD 数据集**(下表)。另有 **4 个存在但 STG 后端报错**(`Query execution failed.`,大概率 PROD 可用)。
4. 其它实体(`dsc`/`dm`/`rta`/`det`/`amaf`)存在但返回 **403**(需门户「Request API Access Key」授权)。
5. **STG 返回的是脱敏假数值**(列名真、值假)。真实数据需 PROD 凭证(contact-us 表单 + App Id 申请)。

状态码语义:`200`=可拉 · `403 ForbiddenError`=存在但无权 · `404 NotFound`=slug 不存在 · `422 QueryExecutionError`=存在但后端查询失败(STG 问题)。

---

## 1. ✅ 可正常拉取(11 个,均在 `dld`)

| # | dataset slug | 列数 | 内容 | AI 价值 |
|---|---|---|---|---|
| 1 | `dld_transactions-open-api` | 47 | 销售/交易:成交价、单价/㎡、租值 | ⭐⭐⭐ 房价核心 |
| 2 | `dld_rent_contracts-open-api` | 41 | Ejari 租约:年租、面积、租客 | ⭐⭐⭐ 租金收益率 |
| 3 | `dld_valuation-open-api` | 21 | 官方估价:成交价、物业总值 | ⭐⭐⭐ AVM 锚点 |
| 4 | `dld_units-open-api` | 47 | 单元注册:产权、楼层、车位 | ⭐⭐ 供给/库存 |
| 5 | `dld_developers-open-api` | 23 | 开发商 + 牌照 | ⭐ 背调 |
| 6 | `dld_offices-open-api` | 19 | 中介行 | ⭐ |
| 7 | `dld_brokers-open-api` | 14 | 经纪人 | ⭐ |
| 8 | `dld_real_estate_licenses-open-api` | 24 | 房产牌照 | |
| 9 | `dld_valuator_licensing-open-api` | 15 | 估价师牌照 | |
| 10 | `dld_real_estate_permits-open-api` | 21 | 广告/展会许可 | |
| 11 | `dld_map_requests-open-api` | 16 | 测绘/图纸申请 | |

调用方式:`GET {BASE_URL}/open/dld/<slug>?page=1&pageSize=1000`,`Authorization: Bearer <token>`。

---

## 2. ⚠️ 存在但 STG 后端报错(4 个,大概率 PROD 可用)

均返回 `422 {"error_type":"QueryExecutionError","message":"Query execution failed."}`,与查询参数无关(no-params / limit / page / pageSize 都试过)。slug 存在(非 404),判断为 STG 这几个大表未正确 ingest。

| slug | 内容 | AI 价值 |
|---|---|---|
| `dld_projects-open-api` | 项目(在建/交付) | ⭐⭐ 供给管线 |
| `dld_buildings-open-api` | 楼宇 | ⭐ |
| `dld_land_registry-open-api` | 土地登记 | ⭐ |
| `dld_oa_service_charges-open-api` | 业主协会物业费 | ⭐⭐ 净收益率 |

→ **拿到 PROD 凭证后优先重试这 4 个。**

---

## 3. ❌ 拿不到

- **其它实体存在但 403(需门户授权)**:`dsc`(统计:人口/GDP)、`dm`(市政:建筑许可)、`rta`(交通:地铁/POI)、`det`(经济:贸易名)、`amaf`。→ 这些不是不存在,是未授权;在门户对应 dataset 点「Request API Access Key」。
- **404(猜测的 slug 不存在 / 名字不对)**:`dld_oqood`、`dld_mortgaged_properties`、`dld_parcels`、`dld_zones`、`dld_master_projects`、`dld_escrow_accounts`、`dld_sell_permits`、`dld_advertisement_permits`、`dld_accredited_valuators`、`dld_oa_companies`、`dld_owner_associations`、`dld_areas`、`dld_real_estate_data`、`dld_rent_index`、`rera_rent_index`、`dsc_population` 等。→ 这些数据**可能存在但真实 slug 未知**,只有门户能确认。
- `mrhe/mrhe_project-open-api`、`amaf/amaf_minor-openapi`(文档样例)→ 404 / 403。

---

## 4. 完整字段清单(11 个可拉集)

### 4.1 `dld_transactions-open-api` (47) — 销售/交易 ⭐⭐⭐
```
transaction_id, procedure_id, trans_group_id, trans_group_ar, trans_group_en,
procedure_name_ar, procedure_name_en, instance_date,
property_type_id, property_type_ar, property_type_en,
property_sub_type_id, property_sub_type_ar, property_sub_type_en,
property_usage_ar, property_usage_en, reg_type_id, reg_type_ar, reg_type_en,
area_id, area_name_ar, area_name_en, building_name_ar, building_name_en,
project_number, project_name_ar, project_name_en, master_project_en, master_project_ar,
nearest_landmark_ar, nearest_landmark_en, nearest_metro_ar, nearest_metro_en,
nearest_mall_ar, nearest_mall_en, rooms_ar, rooms_en, has_parking, procedure_area,
actual_worth, meter_sale_price, rent_value, meter_rent_price,
no_of_parties_role_1, no_of_parties_role_2, no_of_parties_role_3, load_timestamp
```
关键价格字段:`actual_worth`(成交价 AED)、`meter_sale_price`(单价/㎡)、`rent_value`、`meter_rent_price`、`procedure_area`(面积㎡)。增量锚点:`load_timestamp`。

### 4.2 `dld_rent_contracts-open-api` (41) — Ejari 租约 ⭐⭐⭐
```
contract_id, contract_reg_type_id, contract_reg_type_ar, contract_reg_type_en,
contract_start_date, contract_end_date, contract_amount, annual_amount,
no_of_prop, line_number, is_free_hold,
ejari_bus_property_type_id, ejari_bus_property_type_ar, ejari_bus_property_type_en,
ejari_property_type_id, ejari_property_type_en, ejari_property_type_ar,
ejari_property_sub_type_id, ejari_property_sub_type_en, ejari_property_sub_type_ar,
property_usage_en, property_usage_ar, project_number, project_name_ar, project_name_en,
master_project_ar, master_project_en, area_id, area_name_ar, area_name_en, actual_area,
nearest_landmark_ar, nearest_landmark_en, nearest_metro_ar, nearest_metro_en,
nearest_mall_ar, nearest_mall_en, tenant_type_id, tenant_type_ar, tenant_type_en, load_timestamp
```
关键:`annual_amount`(年租)、`contract_amount`、`actual_area`、`contract_start_date/end_date`、`is_free_hold`。

### 4.3 `dld_valuation-open-api` (21) — 官方估价 ⭐⭐⭐
```
procedure_id, procedure_name_ar, procedure_name_en, procedure_year, procedure_number,
instance_date, actual_worth, row_status_code, procedure_area,
property_type_id, property_type_ar, property_type_en,
property_sub_type_id, property_sub_type_ar, property_sub_type_en,
area_id, area_name_ar, area_name_en, actual_area, property_total_value, load_timestamp
```
关键:`actual_worth`、`property_total_value`、`procedure_area`/`actual_area`。

### 4.4 `dld_units-open-api` (47) — 单元注册 ⭐⭐
```
property_id, area_id, zone_id, area_name_ar, area_name_en, land_number, land_sub_number,
building_number, unit_number, unit_balcony_area, unit_parking_number,
parking_allocation_type, parking_allocation_type_ar, parking_allocation_type_en,
common_area, actual_common_area, floor, rooms, rooms_ar, rooms_en, actual_area,
property_type_id, property_type_ar, property_type_en,
property_sub_type_id, property_sub_type_ar, property_sub_type_en,
parent_property_id, grandparent_property_id, creation_date, munc_zip_code, munc_number,
parcel_id, is_free_hold, is_lease_hold, is_registered, pre_registration_number,
master_project_id, master_project_en, master_project_ar,
project_id, project_name_ar, project_name_en, land_type_id, land_type_ar, land_type_en, load_timestamp
```

### 4.5 `dld_developers-open-api` (23)
```
participant_id, developer_id, developer_number, developer_name_ar, developer_name_en,
registration_date, license_source_id, license_source_ar, license_source_en,
license_type_id, license_type_ar, license_type_en, license_number,
license_issue_date, license_expiry_date, chamber_of_commerce_no,
legal_status, legal_status_ar, legal_status_en, webpage, phone, fax, load_timestamp
```

### 4.6 `dld_offices-open-api` (19)
```
participant_id, real_estate_id, real_estate_number, license_source_id, license_source_ar,
license_source_en, license_number, license_issue_date, license_expiry_date, is_branch,
main_office_id, webpage, phone, fax, activity_type_id, ded_activity_code,
activity_type_ar, activity_type_en, load_timestamp
```

### 4.7 `dld_brokers-open-api` (14)
```
participant_id, real_estate_broker_id, broker_number, broker_name_ar, broker_name_en,
gender, license_start_date, license_end_date, webpage, phone, fax,
real_estate_id, real_estate_number, load_timestamp
```

### 4.8 `dld_real_estate_licenses-open-api` (24)
```
participant_id, authority_id, license_number, chamber_commerce_number, commerce_registry_number,
trade_name_arabic, trade_name_english, issue_date, expiry_date, cancel_date,
status_id, status_arabic, status_english, legal_type_id, legal_type_arabic, legal_type_english,
parcel_id, rent_contract_no, print_rmker_arabic,
activity_type_id, ded_activity_code, activity_name_ar, activity_name_en, load_timestamp
```

### 4.9 `dld_valuator_licensing-open-api` (15)
```
valuation_company_number, valuation_company_name_ar, valuation_company_name_en,
valuator_number, valuator_name_ar, valuator_name_en,
valuator_nationality_id, valuator_nationality_ar, valuator_nationality_en,
gender_id, gender_ar, gender_en, license_start_date, license_end_date, load_timestamp
```

### 4.10 `dld_real_estate_permits-open-api` (21)
```
permits_id, permit_number, start_date, end_date, location,
exhibition_name_ar, exhibition_name_en, parent_parmits_id,
permit_status_id, permit_status_ar, permit_status_en,
parent_service_id, main_service_ar, main_service_en, service_id, service_ar, service_en,
license_number, participant_name_ar, paricipant_name_en, load_timestamp
```

### 4.11 `dld_map_requests-open-api` (16)
```
request_id, request_date, application_id, application_ar, sub_service_application_en,
request_source_id, request_source_ar, request_source_en,
procedure_id, procedure_name_ar, procedure_name_en,
property_type_id, property_type_ar, property_type_en, no_of_siteplans, load_timestamp
```

---

## 5. 下一步

1. **接入 4 个核心集**(transactions / rent_contracts / valuation / units)到 `config/datasets.ts`(真 slug + 上面真字段),跑 `src/db/dubai-sync-schema.sql`,`sync --dry-run` 验证整条链。
2. **门户申请**:登录 data.dubai,对需要的 dataset 点「Request API Access Key」——优先 `dsc`(人口)、`dm`(建筑许可)、以及 PROD 里重试那 4 个 422。
3. **PROD 凭证**:contact-us 表单 + App Id `PUBLIC-USR-UID-4057946` 申请,换 `DUBAI_API_BASE_URL=https://apis.data.dubai` 拿真实数值。
4. **任何门户上看到的新 slug,发我,我即时实测可达性。**

> 探测脚本(可复跑):`backend/src/sync/dubai/probe/{probe-access,probe-422,probe-catalog}.ts`
