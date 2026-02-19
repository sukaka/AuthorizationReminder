# MongoDB Collection Design (Flexible/Raw Layer)

MongoDB is not the source of truth. It stores high-variance and raw records.

## Collections
1. `ci_raw_inventory`
- Purpose: raw discovery payloads from cloud APIs/agents.
- Key fields: `source`, `source_account`, `resource_type`, `external_id`, `payload`, `observed_at`.
- Indexes:
  - `{ source: 1, external_id: 1 }` unique
  - `{ observed_at: -1 }`
  - `{ resource_type: 1, observed_at: -1 }`

2. `ci_snapshot`
- Purpose: historical snapshots used for drift detection.
- Key fields: `ci_uid`, `snapshot_at`, `normalized`, `raw_refs`.
- Indexes:
  - `{ ci_uid: 1, snapshot_at: -1 }`

3. `ci_reconcile_result`
- Purpose: reconciliation output and conflict analysis.
- Key fields: `job_id`, `ci_uid`, `conflicts`, `winner_source`, `resolved`, `created_at`.
- Indexes:
  - `{ job_id: 1, ci_uid: 1 }` unique
  - `{ created_at: -1 }`

## Source Priority
`discovery > cloud > import > manual`

## Data Rule
After reconcile, final CI state must be written into MySQL `ci` table and change history tables.
