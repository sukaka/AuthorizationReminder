package repository

import "context"

type ReportTotalsRow struct {
	AssetTotal     int64
	ActiveTotal    int64
	DiscoveryTotal int64
	CloudTotal     int64
	RelationTotal  int64
}

type ReportDailyCountRow struct {
	Day   string
	Total int64
}

func (r *CIRepository) GetReportTotals(ctx context.Context) (ReportTotalsRow, error) {
	const q = `
SELECT
  (SELECT COUNT(*) FROM ci WHERE deleted = 0) AS asset_total,
  (SELECT COUNT(*) FROM ci WHERE deleted = 0 AND status = 'active') AS active_total,
  (SELECT COUNT(*) FROM ci WHERE deleted = 0 AND source = 'discovery') AS discovery_total,
  (SELECT COUNT(*) FROM ci WHERE deleted = 0 AND source = 'cloud') AS cloud_total,
  (SELECT COUNT(*) FROM ci_relation WHERE deleted = 0) AS relation_total`

	var row ReportTotalsRow
	if err := r.db.QueryRowContext(ctx, q).Scan(
		&row.AssetTotal,
		&row.ActiveTotal,
		&row.DiscoveryTotal,
		&row.CloudTotal,
		&row.RelationTotal,
	); err != nil {
		return ReportTotalsRow{}, err
	}
	return row, nil
}

func (r *CIRepository) GetReportAssetDailyNew(ctx context.Context, days int) ([]ReportDailyCountRow, error) {
	if days <= 0 {
		days = 30
	}
	if days > 180 {
		days = 180
	}

	const q = `
SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day, COUNT(*) AS total
FROM ci
WHERE deleted = 0
  AND created_at >= DATE_SUB(CURRENT_DATE(), INTERVAL ? DAY)
GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d')
ORDER BY DATE_FORMAT(created_at, '%Y-%m-%d')`

	rows, err := r.db.QueryContext(ctx, q, days-1)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]ReportDailyCountRow, 0, days)
	for rows.Next() {
		var item ReportDailyCountRow
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

func (r *CIRepository) GetReportChangeDailyCount(ctx context.Context, days int) ([]ReportDailyCountRow, error) {
	if days <= 0 {
		days = 30
	}
	if days > 180 {
		days = 180
	}

	const q = `
SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day, COUNT(*) AS total
FROM cmdb_change_request
WHERE deleted = 0
  AND created_at >= DATE_SUB(CURRENT_DATE(), INTERVAL ? DAY)
GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d')
ORDER BY DATE_FORMAT(created_at, '%Y-%m-%d')`

	rows, err := r.db.QueryContext(ctx, q, days-1)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]ReportDailyCountRow, 0, days)
	for rows.Next() {
		var item ReportDailyCountRow
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

func (r *CIRepository) GetReportRelationDailyNew(ctx context.Context, days int) ([]ReportDailyCountRow, error) {
	if days <= 0 {
		days = 30
	}
	if days > 180 {
		days = 180
	}

	const q = `
SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day, COUNT(*) AS total
FROM ci_relation
WHERE deleted = 0
  AND created_at >= DATE_SUB(CURRENT_DATE(), INTERVAL ? DAY)
GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d')
ORDER BY DATE_FORMAT(created_at, '%Y-%m-%d')`

	rows, err := r.db.QueryContext(ctx, q, days-1)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]ReportDailyCountRow, 0, days)
	for rows.Next() {
		var item ReportDailyCountRow
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
