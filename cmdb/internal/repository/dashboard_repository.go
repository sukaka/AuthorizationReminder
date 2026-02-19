package repository

import (
	"context"
	"database/sql"
	"time"
)

type DashboardTotalsRow struct {
	AssetTotal   int64
	MonthlyNew   int64
	PendingCount int64
	AnomalyCount int64
}

type DashboardTypeDistributionRow struct {
	TypeKey  string
	TypeName string
	Total    int64
}

type DashboardTrendRow struct {
	Day   string
	Total int64
}

type DashboardOwnerDistributionRow struct {
	Owner string
	Total int64
}

type DashboardRecentChangeRow struct {
	CIUID        string
	CIName       string
	OpType       string
	OperatorName string
	CreatedAt    time.Time
}

func (r *CIRepository) GetDashboardTotals(ctx context.Context) (DashboardTotalsRow, error) {
	const q = `
SELECT
  (SELECT COUNT(*) FROM ci WHERE deleted = 0) AS asset_total,
  (SELECT COUNT(*) FROM ci WHERE deleted = 0 AND created_at >= DATE_FORMAT(CURRENT_DATE(), '%Y-%m-01')) AS monthly_new,
  (SELECT COUNT(*) FROM outbox_event WHERE status IN ('pending', 'failed')) AS pending_count,
  (SELECT COUNT(*) FROM ci WHERE deleted = 0 AND status <> 'active') AS anomaly_count`

	var row DashboardTotalsRow
	if err := r.db.QueryRowContext(ctx, q).Scan(
		&row.AssetTotal,
		&row.MonthlyNew,
		&row.PendingCount,
		&row.AnomalyCount,
	); err != nil {
		return DashboardTotalsRow{}, err
	}
	return row, nil
}

func (r *CIRepository) GetDashboardTypeDistribution(ctx context.Context, limit int) ([]DashboardTypeDistributionRow, error) {
	if limit <= 0 {
		limit = 8
	}

	const q = `
SELECT t.type_key, t.type_name, COUNT(*) AS total
FROM ci c
JOIN ci_type t ON t.id = c.ci_type_id
WHERE c.deleted = 0
GROUP BY t.id, t.type_key, t.type_name
ORDER BY total DESC
LIMIT ?`

	rows, err := r.db.QueryContext(ctx, q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]DashboardTypeDistributionRow, 0, limit)
	for rows.Next() {
		var item DashboardTypeDistributionRow
		if err := rows.Scan(&item.TypeKey, &item.TypeName, &item.Total); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func (r *CIRepository) GetDashboardGrowthTrend(ctx context.Context, days int) ([]DashboardTrendRow, error) {
	if days <= 0 {
		days = 7
	}
	if days > 90 {
		days = 90
	}

	const q = `
SELECT DATE_FORMAT(DATE(created_at), '%Y-%m-%d') AS day, COUNT(*) AS total
FROM ci
WHERE deleted = 0
  AND created_at >= DATE_SUB(CURRENT_DATE(), INTERVAL ? DAY)
GROUP BY DATE(created_at)
ORDER BY DATE(created_at)`

	rows, err := r.db.QueryContext(ctx, q, days-1)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]DashboardTrendRow, 0, days)
	for rows.Next() {
		var item DashboardTrendRow
		if err := rows.Scan(&item.Day, &item.Total); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func (r *CIRepository) GetDashboardOwnerDistribution(ctx context.Context, limit int) ([]DashboardOwnerDistributionRow, error) {
	if limit <= 0 {
		limit = 8
	}

	const q = `
SELECT COALESCE(NULLIF(TRIM(owner), ''), '未分配') AS owner_name, COUNT(*) AS total
FROM ci
WHERE deleted = 0
GROUP BY owner_name
ORDER BY total DESC
LIMIT ?`

	rows, err := r.db.QueryContext(ctx, q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]DashboardOwnerDistributionRow, 0, limit)
	for rows.Next() {
		var item DashboardOwnerDistributionRow
		if err := rows.Scan(&item.Owner, &item.Total); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func (r *CIRepository) GetDashboardRecentChanges(ctx context.Context, limit int) ([]DashboardRecentChangeRow, error) {
	if limit <= 0 {
		limit = 10
	}

	const q = `
SELECT
  COALESCE(c.ci_uid, '') AS ci_uid,
  COALESCE(c.name, '') AS ci_name,
  l.op_type,
  COALESCE(l.operator_name, l.operator_sub, '') AS operator_name,
  l.created_at
FROM ci_change_log l
LEFT JOIN ci c ON c.id = l.ci_id
ORDER BY l.created_at DESC
LIMIT ?`

	rows, err := r.db.QueryContext(ctx, q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]DashboardRecentChangeRow, 0, limit)
	for rows.Next() {
		var item DashboardRecentChangeRow
		var ciUID sql.NullString
		var ciName sql.NullString
		var opName sql.NullString
		if err := rows.Scan(&ciUID, &ciName, &item.OpType, &opName, &item.CreatedAt); err != nil {
			return nil, err
		}
		item.CIUID = ciUID.String
		item.CIName = ciName.String
		item.OperatorName = opName.String
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}
