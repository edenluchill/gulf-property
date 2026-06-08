# Data Dubai — Production API Access 申请(邮件/表单用)

> 提交入口:**Contact Us 表单** → https://data.dubai/en/contact-us
> 数据问题备用邮箱:data.portal@digitaldubai.ae(官方要求统一走表单)
> 注:填表/发邮件**不需要在 UAE**;只有调用 API 才需要 UAE IP。
> 用注册邮箱提交:**pinzos.founder@gmail.com**

---

## 给朋友的话(转发用)

帮我把下面这段英文填进 data.dubai 的 Contact Us 表单(https://data.dubai/en/contact-us),
用邮箱 `pinzos.founder@gmail.com`。在哪提交都行,不用在迪拜。谢谢!

---

## ✉️ Subject

Request for Production API Access — Application ID PUBLIC-USR-UID-4057946

---

## ✉️ Body

Dear Data Dubai Team,

We have completed testing and validation of the granted APIs on the non-production (test) system and would like to request **production access**.

**Applicant**
- Application ID: **PUBLIC-USR-UID-4057946**
- Registered email: **pinzos.founder@gmail.com**

Please issue **production credentials (client_id / client_secret)** and confirm the production base URL (https://apis.data.dubai) for the following Open Data datasets (entity / dataset), which we have successfully tested on the test system:

**DLD real-estate datasets — tested & validated**
1. dld / dld_transactions-open-api
2. dld / dld_rent_contracts-open-api
3. dld / dld_valuation-open-api
4. dld / dld_units-open-api
5. dld / dld_developers-open-api
6. dld / dld_offices-open-api
7. dld / dld_brokers-open-api
8. dld / dld_real_estate_licenses-open-api
9. dld / dld_valuator_licensing-open-api
10. dld / dld_real_estate_permits-open-api
11. dld / dld_map_requests-open-api

**Please also enable / verify in production** — on the test system these returned HTTP 422 "QueryExecutionError: Query execution failed." (the dataset slug exists, but the test data appears unavailable):
12. dld / dld_projects-open-api
13. dld / dld_buildings-open-api
14. dld / dld_land_registry-open-api
15. dld / dld_oa_service_charges-open-api

**Endpoints in use**
- Token:  POST /secure/ssis/dubaiai/gatewaytoken/1.0.0/getAccessToken
- Health: GET  /secure/ddads/healthcheck/1.0.0/health
- Data:   GET  /secure/ddads/openapi/1.0.0/{entity}/{dataset}

**Questions**
1. Will production use the same `x-DDA-SecurityApplicationIdentifier` header value, or will a new one be issued?
2. Do any of the above datasets require separate per-dataset approval in production, or are they all covered under this Application ID?
3. Please confirm the production base URL and any rate-limit / quota that differ from the test system.

Thank you.

Pinzos
Application ID: PUBLIC-USR-UID-4057946
Registered email: pinzos.founder@gmail.com

---

## 拿到生产凭证后我要做的(备忘)
1. `backend/.env`:`DUBAI_API_BASE_URL=https://apis.data.dubai` + 换上 PROD 的 client_id/secret(+ 可能的新 App Identifier)
2. 跑 `discover` 验证 token+health,再 `sync-all --incremental`
3. 重试 #12–15 那 4 个数据集(测试环境 422,生产应可用)
