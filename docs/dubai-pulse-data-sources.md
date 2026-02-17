# Dubai Pulse Data Sources

> Reference for future data integration from https://www.dubaipulse.gov.ae/

## Currently Used

| Dataset | Source | Status | Notes |
|---------|--------|--------|-------|
| POI (Points of Interest) | OpenStreetMap | ✅ Implemented | Replaced Dubai Pulse POI data due to quality issues |
| Transactions | DLD | ✅ Implemented | `data/dubai-pulse/transactions.csv` |
| Rent Contracts | DLD | ✅ Implemented | `data/dubai-pulse/rent_contracts.csv` |

## Available for Future Integration

### DLD Registration (18 datasets)
https://www.dubaipulse.gov.ae/organisation/dld/service/dld-registration

| Dataset | Description | Potential Value |
|---------|-------------|-----------------|
| **Projects** | All projects registered in DLD | ⭐ Verify/supplement our project data |
| **Developers** | Registered developers info | ⭐ Official developer list |
| **Buildings** | Building details | Building metadata |
| **Freehold Units** | Freehold units registered | Unit-level data |
| **Brokers** | Broker information | Agent directory |
| **Real Estate Offices** | RE office listings | Business directory |
| **Escrow Agents** | Accredited escrow agents | Trust indicators |
| **Tenancy Contracts** | Ejari system contracts | Rental market data |
| **Land Registry** | Registered lands | Land ownership |

### DLD Valuations (4 datasets)
https://www.dubaipulse.gov.ae/organisation/dld/service/dld-valuations

| Dataset | Description | Potential Value |
|---------|-------------|-----------------|
| **Valuations** | Property valuation details | ⭐ Price benchmarks |
| **Valuator Licensing** | Registered valuators | Quality indicators |

### DLD Transactions (12 datasets)
https://www.dubaipulse.gov.ae/organisation/dld/service/dld-transactions

Already using transaction data. May have additional transaction types available.

### DLD Licenses (8 datasets)
https://www.dubaipulse.gov.ae/organisation/dld/service/dld-licenses

| Dataset | Description | Potential Value |
|---------|-------------|-----------------|
| **Real Estate Permits** | Property permits | Development pipeline |
| **Real Estate Licenses** | Company licenses | Verified businesses |

## Population Data

| Dataset | Years Available | Status |
|---------|-----------------|--------|
| Population by Community | 2018-2022 | Available but outdated |

URL: https://www.dubaipulse.gov.ae/data/dsc-statistics/dsc_population_by_community-open

Note: Data only goes to 2022 despite page showing "Updated Aug 2024".

## Not Useful

| Item | Reason |
|------|--------|
| DevZone | Cloud platform (PaaS/IaaS), not data |
| Dubai Pulse POI | Poor data quality (1500+ locations in the sea) |

## Download URLs

```bash
# Projects (need to verify)
# https://www.dubaipulse.gov.ae/data/dld-registration/dld_projects-open

# Developers
# https://www.dubaipulse.gov.ae/data/dld-registration/dld_developers-open

# Valuations
# https://www.dubaipulse.gov.ae/data/dld-valuations/dld_valuation-open
```

## Next Steps

1. [ ] Download and evaluate Projects dataset
2. [ ] Download and evaluate Developers dataset
3. [ ] Download and evaluate Valuations dataset
4. [ ] Check if valuation data has useful price metrics
5. [ ] Consider integrating official developer data

---
*Last updated: 2026-02-16*
