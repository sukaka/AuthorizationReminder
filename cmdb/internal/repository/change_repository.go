package repository

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

type ChangeListParams struct {
	Status      string
	RiskLevel   string
	TargetCIUID string
	Keyword     string
	Page        int
	PageSize    int
}

type ChangeRequestRow struct {
	ID              uint64
	ChangeUID       string
	Title           string
	Description     string
	TargetCIID      uint64
	TargetCIUID     string
	TargetCIName    string
	RiskLevel       string
	Status          string
	RequestedBySub  string
	RequestedByName string
	ApprovedBySub   string
	ApprovedByName  string
	ExecutedBySub   string
	ExecutedByName  string
	RollbackBySub   string
	RollbackByName  string
	ApprovalComment string
	ExecutionNote   string
	RollbackNote    string
	PlannedStartAt  *time.Time
	PlannedEndAt    *time.Time
	Version         uint32
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type CreateChangeRequestParams struct {
	ChangeUID       string
	Title           string
	Description     string
	TargetCIID      uint64
	RiskLevel       string
	RequestedBySub  string
	RequestedByName string
	PlannedStartAt  *time.Time
	PlannedEndAt    *time.Time
}

type UpdateChangeStatusParams struct {
	ChangeUID    string
	ExpectStatus string
	NewStatus    string
	OperatorSub  string
	OperatorName string
	CommentText  string
}

type ChangeStepLogRow struct {
	ID           uint64
	ChangeID     uint64
	ChangeUID    string
	Action       string
	FromStatus   string
	ToStatus     string
	OperatorSub  string
	OperatorName string
	CommentText  string
	MetadataRaw  string
	CreatedAt    time.Time
}

type InsertChangeStepLogParams struct {
	ChangeID     uint64
	ChangeUID    string
	Action       string
	FromStatus   string
	ToStatus     string
	OperatorSub  string
	OperatorName string
	CommentText  string
	MetadataJSON []byte
}

func (r *CIRepository) ListChangeRequests(ctx context.Context, p ChangeListParams) ([]ChangeRequestRow, int64, error) {
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

	whereClause, args := buildChangeWhereClause(p)

	countQuery := `
SELECT COUNT(*)
FROM cmdb_change_request c
JOIN ci target ON target.id = c.target_ci_id AND target.deleted = 0
WHERE c.deleted = 0` + whereClause

	var total int64
	if err := r.db.QueryRowContext(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []ChangeRequestRow{}, 0, nil
	}

	dataQuery := `
SELECT
  c.id,
  c.change_uid,
  c.title,
  COALESCE(c.description, ''),
  c.target_ci_id,
  target.ci_uid,
  target.name,
  c.risk_level,
  c.status,
  c.requested_by_sub,
  COALESCE(c.requested_by_name, ''),
  COALESCE(c.approved_by_sub, ''),
  COALESCE(c.approved_by_name, ''),
  COALESCE(c.executed_by_sub, ''),
  COALESCE(c.executed_by_name, ''),
  COALESCE(c.rollback_by_sub, ''),
  COALESCE(c.rollback_by_name, ''),
  COALESCE(c.approval_comment, ''),
  COALESCE(c.execution_note, ''),
  COALESCE(c.rollback_note, ''),
  c.planned_start_at,
  c.planned_end_at,
  c.version,
  c.created_at,
  c.updated_at
FROM cmdb_change_request c
JOIN ci target ON target.id = c.target_ci_id AND target.deleted = 0
WHERE c.deleted = 0` + whereClause + `
ORDER BY c.updated_at DESC, c.id DESC
LIMIT ? OFFSET ?`

	dataArgs := make([]any, 0, len(args)+2)
	dataArgs = append(dataArgs, args...)
	dataArgs = append(dataArgs, pageSize, (page-1)*pageSize)

	rows, err := r.db.QueryContext(ctx, dataQuery, dataArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	result := make([]ChangeRequestRow, 0, pageSize)
	for rows.Next() {
		item, err := scanChangeRow(rows)
		if err != nil {
			return nil, 0, err
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return result, total, nil
}

func (r *CIRepository) GetChangeRequestByUID(ctx context.Context, changeUID string) (*ChangeRequestRow, error) {
	const q = `
SELECT
  c.id,
  c.change_uid,
  c.title,
  COALESCE(c.description, ''),
  c.target_ci_id,
  target.ci_uid,
  target.name,
  c.risk_level,
  c.status,
  c.requested_by_sub,
  COALESCE(c.requested_by_name, ''),
  COALESCE(c.approved_by_sub, ''),
  COALESCE(c.approved_by_name, ''),
  COALESCE(c.executed_by_sub, ''),
  COALESCE(c.executed_by_name, ''),
  COALESCE(c.rollback_by_sub, ''),
  COALESCE(c.rollback_by_name, ''),
  COALESCE(c.approval_comment, ''),
  COALESCE(c.execution_note, ''),
  COALESCE(c.rollback_note, ''),
  c.planned_start_at,
  c.planned_end_at,
  c.version,
  c.created_at,
  c.updated_at
FROM cmdb_change_request c
JOIN ci target ON target.id = c.target_ci_id AND target.deleted = 0
WHERE c.deleted = 0 AND c.change_uid = ?
LIMIT 1`

	item, err := scanChangeRow(r.db.QueryRowContext(ctx, q, changeUID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *CIRepository) GetChangeRequestByUIDTx(ctx context.Context, tx *sql.Tx, changeUID string) (*ChangeRequestRow, error) {
	const q = `
SELECT
  c.id,
  c.change_uid,
  c.title,
  COALESCE(c.description, ''),
  c.target_ci_id,
  target.ci_uid,
  target.name,
  c.risk_level,
  c.status,
  c.requested_by_sub,
  COALESCE(c.requested_by_name, ''),
  COALESCE(c.approved_by_sub, ''),
  COALESCE(c.approved_by_name, ''),
  COALESCE(c.executed_by_sub, ''),
  COALESCE(c.executed_by_name, ''),
  COALESCE(c.rollback_by_sub, ''),
  COALESCE(c.rollback_by_name, ''),
  COALESCE(c.approval_comment, ''),
  COALESCE(c.execution_note, ''),
  COALESCE(c.rollback_note, ''),
  c.planned_start_at,
  c.planned_end_at,
  c.version,
  c.created_at,
  c.updated_at
FROM cmdb_change_request c
JOIN ci target ON target.id = c.target_ci_id AND target.deleted = 0
WHERE c.deleted = 0 AND c.change_uid = ?
LIMIT 1`

	item, err := scanChangeRow(tx.QueryRowContext(ctx, q, changeUID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *CIRepository) InsertChangeRequestTx(ctx context.Context, tx *sql.Tx, p CreateChangeRequestParams) (*ChangeRequestRow, error) {
	const q = `
INSERT INTO cmdb_change_request (
  change_uid, title, description, target_ci_id, risk_level, status,
  requested_by_sub, requested_by_name, planned_start_at, planned_end_at
) VALUES (?, ?, ?, ?, ?, 'pending_approval', ?, ?, ?, ?)`

	_, err := tx.ExecContext(ctx, q,
		p.ChangeUID,
		p.Title,
		nullableStr(p.Description),
		p.TargetCIID,
		p.RiskLevel,
		p.RequestedBySub,
		nullableStr(p.RequestedByName),
		timePtrArg(p.PlannedStartAt),
		timePtrArg(p.PlannedEndAt),
	)
	if err != nil {
		if isDuplicateError(err) {
			return nil, ErrDuplicateKey
		}
		return nil, err
	}
	return r.GetChangeRequestByUIDTx(ctx, tx, p.ChangeUID)
}

func (r *CIRepository) UpdateChangeStatusTx(ctx context.Context, tx *sql.Tx, p UpdateChangeStatusParams) (*ChangeRequestRow, error) {
	setParts := []string{"status = ?", "version = version + 1"}
	args := []any{p.NewStatus}

	switch p.NewStatus {
	case "approved", "rejected":
		setParts = append(setParts, "approved_by_sub = ?", "approved_by_name = ?", "approval_comment = ?")
		args = append(args, p.OperatorSub, nullableStr(p.OperatorName), nullableStr(p.CommentText))
	case "completed":
		setParts = append(setParts, "executed_by_sub = ?", "executed_by_name = ?", "execution_note = ?")
		args = append(args, p.OperatorSub, nullableStr(p.OperatorName), nullableStr(p.CommentText))
	case "rolled_back":
		setParts = append(setParts, "rollback_by_sub = ?", "rollback_by_name = ?", "rollback_note = ?")
		args = append(args, p.OperatorSub, nullableStr(p.OperatorName), nullableStr(p.CommentText))
	}

	query := `UPDATE cmdb_change_request SET ` + strings.Join(setParts, ", ") + ` WHERE change_uid = ? AND deleted = 0`
	args = append(args, p.ChangeUID)
	if p.ExpectStatus != "" {
		query += ` AND status = ?`
		args = append(args, p.ExpectStatus)
	}

	res, err := tx.ExecContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return nil, err
	}
	if affected == 0 {
		return nil, ErrVersionConflict
	}
	return r.GetChangeRequestByUIDTx(ctx, tx, p.ChangeUID)
}

func (r *CIRepository) ListChangeStepLogs(ctx context.Context, changeUID string, limit int) ([]ChangeStepLogRow, error) {
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}

	const q = `
SELECT
  id,
  change_id,
  change_uid,
  action,
  COALESCE(from_status, ''),
  to_status,
  operator_sub,
  COALESCE(operator_name, ''),
  COALESCE(comment_text, ''),
  COALESCE(CAST(metadata_json AS CHAR), ''),
  created_at
FROM cmdb_change_step_log
WHERE change_uid = ?
ORDER BY created_at DESC, id DESC
LIMIT ?`

	rows, err := r.db.QueryContext(ctx, q, changeUID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]ChangeStepLogRow, 0, limit)
	for rows.Next() {
		var item ChangeStepLogRow
		if err := rows.Scan(
			&item.ID,
			&item.ChangeID,
			&item.ChangeUID,
			&item.Action,
			&item.FromStatus,
			&item.ToStatus,
			&item.OperatorSub,
			&item.OperatorName,
			&item.CommentText,
			&item.MetadataRaw,
			&item.CreatedAt,
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

func (r *CIRepository) InsertChangeStepLogTx(ctx context.Context, tx *sql.Tx, p InsertChangeStepLogParams) error {
	const q = `
INSERT INTO cmdb_change_step_log (
  change_id, change_uid, action, from_status, to_status, operator_sub, operator_name, comment_text, metadata_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`

	_, err := tx.ExecContext(ctx, q,
		p.ChangeID,
		p.ChangeUID,
		p.Action,
		nullableStr(p.FromStatus),
		p.ToStatus,
		p.OperatorSub,
		nullableStr(p.OperatorName),
		nullableStr(p.CommentText),
		jsonArg(p.MetadataJSON),
	)
	return err
}

func buildChangeWhereClause(p ChangeListParams) (string, []any) {
	var where strings.Builder
	args := make([]any, 0, 8)

	if p.Status != "" {
		where.WriteString(" AND c.status = ?")
		args = append(args, p.Status)
	}
	if p.RiskLevel != "" {
		where.WriteString(" AND c.risk_level = ?")
		args = append(args, p.RiskLevel)
	}
	if p.TargetCIUID != "" {
		where.WriteString(" AND target.ci_uid = ?")
		args = append(args, p.TargetCIUID)
	}
	if p.Keyword != "" {
		like := "%" + p.Keyword + "%"
		where.WriteString(" AND (c.change_uid LIKE ? OR c.title LIKE ? OR COALESCE(c.description, '') LIKE ? OR target.name LIKE ? OR target.ci_uid LIKE ?)")
		args = append(args, like, like, like, like, like)
	}
	return where.String(), args
}

func scanChangeRow(scanner interface{ Scan(dest ...any) error }) (ChangeRequestRow, error) {
	var item ChangeRequestRow
	var plannedStart sql.NullTime
	var plannedEnd sql.NullTime
	err := scanner.Scan(
		&item.ID,
		&item.ChangeUID,
		&item.Title,
		&item.Description,
		&item.TargetCIID,
		&item.TargetCIUID,
		&item.TargetCIName,
		&item.RiskLevel,
		&item.Status,
		&item.RequestedBySub,
		&item.RequestedByName,
		&item.ApprovedBySub,
		&item.ApprovedByName,
		&item.ExecutedBySub,
		&item.ExecutedByName,
		&item.RollbackBySub,
		&item.RollbackByName,
		&item.ApprovalComment,
		&item.ExecutionNote,
		&item.RollbackNote,
		&plannedStart,
		&plannedEnd,
		&item.Version,
		&item.CreatedAt,
		&item.UpdatedAt,
	)
	if err != nil {
		return ChangeRequestRow{}, err
	}
	if plannedStart.Valid {
		t := plannedStart.Time
		item.PlannedStartAt = &t
	}
	if plannedEnd.Valid {
		t := plannedEnd.Time
		item.PlannedEndAt = &t
	}
	return item, nil
}

func timePtrArg(v *time.Time) any {
	if v == nil {
		return nil
	}
	return *v
}
