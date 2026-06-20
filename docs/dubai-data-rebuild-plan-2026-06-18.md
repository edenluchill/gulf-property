# 纯 data.dubai 数据源重建 — 计划与执行记录

> 2026-06-18 · 把 transactions + rent 从混源(旧 bulk CSV + 零星 API)重建为**单一 data.dubai API 源**,过去 5 年,零前端改动。

## 目标

- 现状:`dld_transactions`(155万)、`dld_rent_contracts`(1010万)是**混源**——大部分来自旧 Dubai Pulse bulk CSV,最近一年只重抓了一部分(tx 13个月里5个月超时失败,rent 只补了缺口月)。
- 目标:近 5 年(2021→2026)全部来自 data.dubai API,一致、可增量、前端无需改动。

## 架构(零前端改动)

```
┌─ 迪拜代理盒子 38.54.8.9 (LightNode, UAE IP) ─┐
│  • node20 + backend/src + scripts            │
│  • 直连 apis.data.dubai(44ms,不走代理)     │
│  • /opt/dubai-sync/.env(仅 DB_/DUBAI_)      │
│         │ 直连 API 拉数据                     │
│         ▼ 写入                               │
└─────────┼────────────────────────────────────┘
          ▼
   production DB (Hetzner gulf-property-db, 49.13.227.73)
   ├─ dld_transactions_new   ← 影子表(回填中,app 不读)
   ├─ dld_rent_contracts_new ← 影子表
   ├─ dld_transactions / dld_rent_contracts ← 现役(app 在读,不动)
   └─ sync_backfill_progress ← 逐月进度,可断点续
          │
          ▼ 回填完 + swap(原子改名)
   _new → 正式名,正式名 → _old。前端/指标函数一行不改,自动显示新数据。
```

**为什么在盒子上跑:** 盒子有 UAE IP,直连 API 仅 44ms;本地走代理慢(~3h/年)。盒子上实测 **~30s/月**(8.5k 行)。整个 5 年 tx+rent 估计几小时,不是几天。

## 关键文件

| 文件 | 作用 |
|------|------|
| `backend/scripts/dubai-backfill.ts` | 逐月回填到 _new 表(delete-window+insert,幂等,可续) |
| `backend/scripts/swap-shadow-tables.ts` | 回填完:桥接 rent + 原子改名 + 重算指标(带 90% 行数护栏) |
| 盒子 `/opt/dubai-sync/backfill-all.sh` | nohup 驱动:tx 2021-01..2026-06,再 rent,同范围 |
| 盒子 `/opt/dubai-sync/backfill.log` | 运行日志 |
| `sync_backfill_progress` 表 | (dataset, month, rows) 进度 |

## 桥接模型(swap 时要做对)

- **transactions**:指标函数 `JOIN dld_areas dla ON dla.area_id = dt.area_id`,**实时桥接**。_new 表只要有 `area_id`(API 直接给)即可,无需逐行处理。
- **rent**:指标函数读 `rc.dubai_area_id`(反范式列)。swap 前必须 `UPDATE dld_rent_contracts_new.dubai_area_id FROM dld_areas via area_id`。swap 脚本已包含。

## 执行步骤 / 状态

1. ✅ 建影子表 `dld_*_new`(`LIKE ... INCLUDING DEFAULTS INCLUDING INDEXES`)。
2. ✅ Provision 盒子:node20、拷源码、过滤 .env(去 CRLF、去 proxy、base=apis.data.dubai)、npm install。
3. ✅ 验证:盒子→DB 连通(防火墙本就 0.0.0.0/0 开着)、直连 API、1 月测试 8583 行/29s。
4. 🔄 **回填中**:`backfill-all.sh` nohup 运行,tx 先(66月,newest-first),再 rent。
5. ⏳ 回填完跑 `swap-shadow-tables.ts --confirm`:桥接 rent + 原子改名 + 重算 `dubai_area_rolling_metrics`。
6. ⏳ 验证 app → `DROP TABLE dld_transactions_old, dld_rent_contracts_old`。
7. ⏳ 每日增量 cron(盒子上,rolling window,直连无代理)。

## 监控

```bash
# 进度(逐月)
cd backend && npx ts-node scripts/db-query.ts \
  "SELECT dataset, COUNT(*) months, SUM(rows) rows, MIN(month) oldest, MAX(month) newest FROM sync_backfill_progress GROUP BY dataset"
# 盒子日志
ssh -i ~/.ssh/dubai_proxy root@38.54.8.9 'tail -f /opt/dubai-sync/backfill.log'
# 影子表行数
cd backend && npx ts-node scripts/db-query.ts \
  "SELECT (SELECT COUNT(*) FROM dld_transactions_new) tx_new, (SELECT COUNT(*) FROM dld_rent_contracts_new) rent_new"
```

## 安全收紧(2026-06-19 已做)

✅ **5432 已从全网收紧到 4 个 IP**(双层):
- Hetzner `gulf-property-db-firewall` 5432 source_ips → `46.224.149.244`(API)/`159.69.107.109`(Worker)/`38.54.8.9`(盒子)/`66.183.49.56`(本地)。
- DB 服务器 `pg_hba.conf` 删掉 `0.0.0.0/0`,加上同 4 个 `/32 scram-sha-256`,`systemctl reload postgresql`。备份在 `pg_hba.conf.bak`。
- 验证:本地✓、盒子✓ 仍能连;世界其他地方已封。
- ⚠️ **本地 IP 是家宽,会变**。变了之后本地 db 脚本会连不上,需更新两处的 `66.183.49.56`:hcloud 防火墙 + DB 服务器 pg_hba。(见下方一行命令)

### ⏳ 还差:DB 密码轮换(用户自己做,最后一步)

密码 `aB246$29`(8位、弱、明文进了 git `deploy-database.ps1`,且现已落到盒子 .env)。轮换 runbook:

```bash
# 1. DB 服务器上改密码
ssh -i ~/.ssh/gulf-property_db_ed25519 root@49.13.227.73 \
  "sudo -u postgres psql -c \"ALTER USER gulf_admin WITH PASSWORD '<新强密码>';\""

# 2. 更新所有连 DB 的 .env 的 DB_PASSWORD(4 处):
#    - 本地 backend/.env
#    - API 服务器 46.224.149.244(/opt 下 docker env 或 .env)→ 重启 pinzos-api
#    - Worker 服务器 159.69.107.109(/opt/pinzos-worker)→ docker compose up -d
#    - 盒子 38.54.8.9:/opt/dubai-sync/.env

# 3. 从 git 历史清掉旧密码(rotate 后旧的已失效,但仍清理):
#    改 deploy-database.ps1 不再硬编码;用 git filter-repo / BFG 擦历史。
```

### 本地 IP 变了之后,更新放行(一行)

```bash
# 把 NEWIP 换成新的本地公网 IP(curl https://api.ipify.org)
NEWIP=x.x.x.x
# pg_hba:
ssh -i ~/.ssh/gulf-property_db_ed25519 root@49.13.227.73 "sed -i 's#66.183.49.56#'$NEWIP'#' /etc/postgresql/16/main/pg_hba.conf && systemctl reload postgresql"
# Hetzner 防火墙:在 gulf-property context 下 hcloud firewall replace-rules,5432 的 66.183.49.56/32 换成 $NEWIP/32
```

## 每日增量(2026-06-19 已上)

- 盒子 systemd timer `dubai-daily.timer`(每日 02:00)→ `daily-cron.sh` → `dubai-daily.ts`:滚动窗口(上月初..今天)刷新**现役表** + 重桥接 rent + 重算指标。日志 `/opt/dubai-sync/daily.log`,或 `journalctl -u dubai-daily`。
- 手动跑:`ssh box 'cd /opt/dubai-sync && bash daily-cron.sh'`。

## 善后(swap 之后)

- 盒子上的 .env 含 DB 密码。回填+增量稳定后,要么保留(已接受风险),要么改用收紧的专用只写账号。
- 旧表 `dld_*_old` 验证 1-2 天后 DROP,省空间。
