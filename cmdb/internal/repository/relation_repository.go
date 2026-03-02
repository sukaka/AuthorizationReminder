package repository

import (
	"context"
	"strings"
	"time"
)

type RelationListParams struct {
	RelationType string
	FromCIUID    string
	ToCIUID      string
	Keyword      string
	Page         int
	PageSize     int
}

type RelationEdgeRow struct {
	FromCIUID    string
	FromCIName   string
	FromTypeKey  string
	FromStatus   string
	FromOwner    string
	ToCIUID      string
	ToCIName     string
	ToTypeKey    string
	ToStatus     string
	ToOwner      string
	RelationType string
	Version      uint32
	UpdatedAt    time.Time
}

func (r *CIRepository) ListRelations(ctx context.Context, p RelationListParams) ([]RelationEdgeRow, int64, error) {
	page := p.Page
	if page < 1 {
		page = 1
	}
	pageSize := p.PageSize
	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > 200 {
		pageSize = 200
	}

	whereClause, args := buildRelationWhereClause(p)

	countQuery := `
SELECT COUNT(*)
FROM ci_relation r
JOIN ci f ON f.id = r.from_ci_id AND f.deleted = 0
JOIN ci t ON t.id = r.to_ci_id AND t.deleted = 0
WHERE r.deleted = 0` + whereClause

	var total int64
	if err := r.db.QueryRowContext(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []RelationEdgeRow{}, 0, nil
	}

	dataQuery := `
SELECT
  f.ci_uid,
  f.name,
  tf.type_key,
  f.status,
  COALESCE(f.owner, ''),
  t.ci_uid,
  t.name,
  tt.type_key,
  t.status,
  COALESCE(t.owner, ''),
  r.relation_type,
  r.version,
  r.updated_at
FROM ci_relation r
JOIN ci f ON f.id = r.from_ci_id AND f.deleted = 0
JOIN ci_type tf ON tf.id = f.ci_type_id
JOIN ci t ON t.id = r.to_ci_id AND t.deleted = 0
JOIN ci_type tt ON tt.id = t.ci_type_id
WHERE r.deleted = 0` + whereClause + `
ORDER BY r.updated_at DESC, r.id DESC
LIMIT ? OFFSET ?`

	dataArgs := make([]any, 0, len(args)+2)
	dataArgs = append(dataArgs, args...)
	dataArgs = append(dataArgs, pageSize, (page-1)*pageSize)

	rows, err := r.db.QueryContext(ctx, dataQuery, dataArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	result := make([]RelationEdgeRow, 0, pageSize)
	for rows.Next() {
		var item RelationEdgeRow
		if err := rows.Scan(
			&item.FromCIUID,
			&item.FromCIName,
			&item.FromTypeKey,
			&item.FromStatus,
			&item.FromOwner,
			&item.ToCIUID,
			&item.ToCIName,
			&item.ToTypeKey,
			&item.ToStatus,
			&item.ToOwner,
			&item.RelationType,
			&item.Version,
			&item.UpdatedAt,
		); err != nil {
			return nil, 0, err
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return result, total, nil
}

func (r *CIRepository) ListRelationEdgesForTopology(ctx context.Context, keyword string, focusCIUID string, limit int) ([]RelationEdgeRow, error) {
	if limit <= 0 {
		limit = 300
	}
	if limit > 3000 {
		limit = 3000
	}

	whereClause := make([]string, 0, 2)
	args := make([]any, 0, 4)

	keyword = strings.TrimSpace(keyword)
	if keyword != "" {
		like := "%" + keyword + "%"
		whereClause = append(whereClause, "(f.ci_uid LIKE ? OR f.name LIKE ? OR t.ci_uid LIKE ? OR t.name LIKE ?)")
		args = append(args, like, like, like, like)
	}
	focusCIUID = strings.TrimSpace(focusCIUID)
	if focusCIUID != "" {
		whereClause = append(whereClause, "(f.ci_uid = ? OR t.ci_uid = ?)")
		args = append(args, focusCIUID, focusCIUID)
	}

	query := `
SELECT
  f.ci_uid,
  f.name,
  tf.type_key,
  f.status,
  COALESCE(f.owner, ''),
  t.ci_uid,
  t.name,
  tt.type_key,
  t.status,
  COALESCE(t.owner, ''),
  r.relation_type,
  r.version,
  r.updated_at
FROM ci_relation r
JOIN ci f ON f.id = r.from_ci_id AND f.deleted = 0
JOIN ci_type tf ON tf.id = f.ci_type_id
JOIN ci t ON t.id = r.to_ci_id AND t.deleted = 0
JOIN ci_type tt ON tt.id = t.ci_type_id
WHERE r.deleted = 0`
	if len(whereClause) > 0 {
		query += " AND " + strings.Join(whereClause, " AND ")
	}
	query += " ORDER BY r.updated_at DESC, r.id DESC LIMIT ?"
	args = append(args, limit)

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]RelationEdgeRow, 0, limit)
	for rows.Next() {
		var item RelationEdgeRow
		if err := rows.Scan(
			&item.FromCIUID,
			&item.FromCIName,
			&item.FromTypeKey,
			&item.FromStatus,
			&item.FromOwner,
			&item.ToCIUID,
			&item.ToCIName,
			&item.ToTypeKey,
			&item.ToStatus,
			&item.ToOwner,
			&item.RelationType,
			&item.Version,
			&item.UpdatedAt,
		); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func buildRelationWhereClause(p RelationListParams) (string, []any) {
	var where strings.Builder
	args := make([]any, 0, 8)

	if p.RelationType != "" {
		where.WriteString(" AND r.relation_type = ?")
		args = append(args, p.RelationType)
	}
	if p.FromCIUID != "" {
		where.WriteString(" AND f.ci_uid = ?")
		args = append(args, p.FromCIUID)
	}
	if p.ToCIUID != "" {
		where.WriteString(" AND t.ci_uid = ?")
		args = append(args, p.ToCIUID)
	}
	if p.Keyword != "" {
		like := "%" + p.Keyword + "%"
		where.WriteString(" AND (f.ci_uid LIKE ? OR f.name LIKE ? OR t.ci_uid LIKE ? OR t.name LIKE ?)")
		args = append(args, like, like, like, like)
	}
	return where.String(), args
}
