package repository

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

type ModelTemplateRow struct {
	ID            uint64
	ModelUID      string
	Name          string
	CITypeID      uint64
	CITypeKey     string
	CITypeName    string
	Icon          string
	Description   string
	InstanceCount int64
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

type CreateModelTemplateParams struct {
	ModelUID    string
	Name        string
	CITypeID    uint64
	Icon        string
	Description string
}

type ModelFieldRuleRow struct {
	ID              uint64
	FieldUID        string
	CITypeID        uint64
	CITypeKey       string
	CITypeName      string
	FieldKey        string
	FieldLabel      string
	DataType        string
	Required        bool
	DefaultValueRaw string
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type CreateModelFieldRuleParams struct {
	FieldUID        string
	CITypeID        uint64
	FieldKey        string
	FieldLabel      string
	DataType        string
	Required        bool
	DefaultValueRaw string
}

type DiscoveryTaskRow struct {
	ID            uint64
	TaskUID       string
	Name          string
	CITypeID      uint64
	CITypeKey     string
	CITypeName    string
	TaskMode      string
	SourceType    string
	EndpointURL   string
	SyncMode      string
	RequestMethod string
	Owner         string
	ScheduleText  string
	BatchSize     int
	Enabled       bool
	LastRunAt     *time.Time
	LastStatus    string
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

type CreateDiscoveryTaskParams struct {
	TaskUID       string
	Name          string
	CITypeID      uint64
	TaskMode      string
	SourceType    string
	EndpointURL   string
	SyncMode      string
	RequestMethod string
	Owner         string
	ScheduleText  string
	BatchSize     int
	Enabled       bool
}

type UpdateDiscoveryTaskRunResultParams struct {
	TaskUID    string
	LastRunAt  time.Time
	LastStatus string
}

type DiscoveryRunLogRow struct {
	ID           uint64
	RunUID       string
	TaskID       uint64
	TaskUID      string
	TaskName     string
	CITypeID     uint64
	CITypeKey    string
	CITypeName   string
	Status       string
	SuccessCount int
	CreatedCount int
	UpdatedCount int
	FailedCount  int
	ErrorMessage string
	StartedAt    time.Time
	FinishedAt   time.Time
	CreatedAt    time.Time
}

type InsertDiscoveryRunLogParams struct {
	RunUID       string
	TaskID       uint64
	TaskUID      string
	TaskName     string
	CITypeID     uint64
	Status       string
	SuccessCount int
	CreatedCount int
	UpdatedCount int
	FailedCount  int
	ErrorMessage string
	StartedAt    time.Time
	FinishedAt   time.Time
}

func (r *CIRepository) GetTypeIDByKey(ctx context.Context, typeKey string) (uint64, error) {
	const q = `SELECT id FROM ci_type WHERE type_key = ? AND deleted = 0 LIMIT 1`
	var id uint64
	err := r.db.QueryRowContext(ctx, q, typeKey).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrNotFound
	}
	if err != nil {
		return 0, err
	}
	return id, nil
}

func (r *CIRepository) ListModelTemplates(ctx context.Context) ([]ModelTemplateRow, error) {
	const q = `
SELECT
  m.id,
  m.model_uid,
  m.name,
  m.ci_type_id,
  t.type_key,
  t.type_name,
  COALESCE(m.icon, ''),
  COALESCE(m.description, ''),
  COALESCE(stat.total, 0) AS instance_count,
  m.created_at,
  m.updated_at
FROM cmdb_model_template m
JOIN ci_type t ON t.id = m.ci_type_id
LEFT JOIN (
  SELECT ci_type_id, COUNT(*) AS total
  FROM ci
  WHERE deleted = 0
  GROUP BY ci_type_id
) stat ON stat.ci_type_id = m.ci_type_id
WHERE m.deleted = 0
ORDER BY m.updated_at DESC, m.id DESC`

	rows, err := r.db.QueryContext(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]ModelTemplateRow, 0, 16)
	for rows.Next() {
		var item ModelTemplateRow
		if err := rows.Scan(
			&item.ID,
			&item.ModelUID,
			&item.Name,
			&item.CITypeID,
			&item.CITypeKey,
			&item.CITypeName,
			&item.Icon,
			&item.Description,
			&item.InstanceCount,
			&item.CreatedAt,
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

func (r *CIRepository) GetModelTemplateByUID(ctx context.Context, modelUID string) (*ModelTemplateRow, error) {
	const q = `
SELECT
  m.id,
  m.model_uid,
  m.name,
  m.ci_type_id,
  t.type_key,
  t.type_name,
  COALESCE(m.icon, ''),
  COALESCE(m.description, ''),
  COALESCE(stat.total, 0) AS instance_count,
  m.created_at,
  m.updated_at
FROM cmdb_model_template m
JOIN ci_type t ON t.id = m.ci_type_id
LEFT JOIN (
  SELECT ci_type_id, COUNT(*) AS total
  FROM ci
  WHERE deleted = 0
  GROUP BY ci_type_id
) stat ON stat.ci_type_id = m.ci_type_id
WHERE m.model_uid = ? AND m.deleted = 0
LIMIT 1`

	var item ModelTemplateRow
	err := r.db.QueryRowContext(ctx, q, modelUID).Scan(
		&item.ID,
		&item.ModelUID,
		&item.Name,
		&item.CITypeID,
		&item.CITypeKey,
		&item.CITypeName,
		&item.Icon,
		&item.Description,
		&item.InstanceCount,
		&item.CreatedAt,
		&item.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *CIRepository) InsertModelTemplate(ctx context.Context, p CreateModelTemplateParams) (*ModelTemplateRow, error) {
	const q = `
INSERT INTO cmdb_model_template (model_uid, name, ci_type_id, icon, description)
VALUES (?, ?, ?, ?, ?)`

	_, err := r.db.ExecContext(ctx, q,
		p.ModelUID,
		p.Name,
		p.CITypeID,
		nullableStr(p.Icon),
		nullableStr(p.Description),
	)
	if err != nil {
		if isDuplicateError(err) {
			return nil, ErrDuplicateKey
		}
		return nil, err
	}
	return r.GetModelTemplateByUID(ctx, p.ModelUID)
}

func (r *CIRepository) SoftDeleteModelTemplate(ctx context.Context, modelUID string) error {
	const q = `
UPDATE cmdb_model_template
SET deleted = 1, deleted_at = CURRENT_TIMESTAMP
WHERE model_uid = ? AND deleted = 0`

	res, err := r.db.ExecContext(ctx, q, modelUID)
	if err != nil {
		return err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *CIRepository) ListModelFieldRulesByTypeID(ctx context.Context, ciTypeID uint64) ([]ModelFieldRuleRow, error) {
	const q = `
SELECT
  f.id,
  f.field_uid,
  f.ci_type_id,
  t.type_key,
  t.type_name,
  f.field_key,
  f.field_label,
  f.data_type,
  f.required_flag,
  COALESCE(CAST(f.default_value_json AS CHAR), ''),
  f.created_at,
  f.updated_at
FROM cmdb_model_field_rule f
JOIN ci_type t ON t.id = f.ci_type_id
WHERE f.deleted = 0 AND f.ci_type_id = ?
ORDER BY f.updated_at DESC, f.id DESC`

	rows, err := r.db.QueryContext(ctx, q, ciTypeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]ModelFieldRuleRow, 0, 16)
	for rows.Next() {
		var item ModelFieldRuleRow
		var required int
		if err := rows.Scan(
			&item.ID,
			&item.FieldUID,
			&item.CITypeID,
			&item.CITypeKey,
			&item.CITypeName,
			&item.FieldKey,
			&item.FieldLabel,
			&item.DataType,
			&required,
			&item.DefaultValueRaw,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, err
		}
		item.Required = required == 1
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func (r *CIRepository) ListModelFieldRulesByTypeKey(ctx context.Context, ciTypeKey string) ([]ModelFieldRuleRow, error) {
	typeID, err := r.GetTypeIDByKey(ctx, ciTypeKey)
	if err != nil {
		return nil, err
	}
	return r.ListModelFieldRulesByTypeID(ctx, typeID)
}

func (r *CIRepository) GetModelFieldRuleByUID(ctx context.Context, fieldUID string) (*ModelFieldRuleRow, error) {
	const q = `
SELECT
  f.id,
  f.field_uid,
  f.ci_type_id,
  t.type_key,
  t.type_name,
  f.field_key,
  f.field_label,
  f.data_type,
  f.required_flag,
  COALESCE(CAST(f.default_value_json AS CHAR), ''),
  f.created_at,
  f.updated_at
FROM cmdb_model_field_rule f
JOIN ci_type t ON t.id = f.ci_type_id
WHERE f.deleted = 0 AND f.field_uid = ?
LIMIT 1`

	var item ModelFieldRuleRow
	var required int
	err := r.db.QueryRowContext(ctx, q, fieldUID).Scan(
		&item.ID,
		&item.FieldUID,
		&item.CITypeID,
		&item.CITypeKey,
		&item.CITypeName,
		&item.FieldKey,
		&item.FieldLabel,
		&item.DataType,
		&required,
		&item.DefaultValueRaw,
		&item.CreatedAt,
		&item.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	item.Required = required == 1
	return &item, nil
}

func (r *CIRepository) InsertModelFieldRule(ctx context.Context, p CreateModelFieldRuleParams) (*ModelFieldRuleRow, error) {
	const q = `
INSERT INTO cmdb_model_field_rule (
  field_uid, ci_type_id, field_key, field_label, data_type, required_flag, default_value_json
) VALUES (?, ?, ?, ?, ?, ?, ?)`

	_, err := r.db.ExecContext(ctx, q,
		p.FieldUID,
		p.CITypeID,
		p.FieldKey,
		p.FieldLabel,
		p.DataType,
		boolToInt(p.Required),
		jsonArg([]byte(p.DefaultValueRaw)),
	)
	if err != nil {
		if isDuplicateError(err) {
			return nil, ErrDuplicateKey
		}
		return nil, err
	}
	return r.GetModelFieldRuleByUID(ctx, p.FieldUID)
}

func (r *CIRepository) SoftDeleteModelFieldRule(ctx context.Context, fieldUID string) error {
	const q = `
UPDATE cmdb_model_field_rule
SET deleted = 1, deleted_at = CURRENT_TIMESTAMP
WHERE field_uid = ? AND deleted = 0`

	res, err := r.db.ExecContext(ctx, q, fieldUID)
	if err != nil {
		return err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *CIRepository) ListDiscoveryTasks(ctx context.Context) ([]DiscoveryTaskRow, error) {
	const q = `
SELECT
  d.id,
  d.task_uid,
  d.name,
  d.ci_type_id,
  t.type_key,
  t.type_name,
  d.task_mode,
  d.source_type,
  COALESCE(d.endpoint_url, ''),
  d.sync_mode,
  d.request_method,
  COALESCE(d.owner, ''),
  d.schedule_text,
  d.batch_size,
  d.enabled,
  d.last_run_at,
  COALESCE(d.last_status, ''),
  d.created_at,
  d.updated_at
FROM discovery_task d
JOIN ci_type t ON t.id = d.ci_type_id
WHERE d.deleted = 0
ORDER BY d.updated_at DESC, d.id DESC`

	rows, err := r.db.QueryContext(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]DiscoveryTaskRow, 0, 16)
	for rows.Next() {
		item, err := scanDiscoveryTask(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, *item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func (r *CIRepository) ListEnabledDiscoveryTasks(ctx context.Context) ([]DiscoveryTaskRow, error) {
	const q = `
SELECT
  d.id,
  d.task_uid,
  d.name,
  d.ci_type_id,
  t.type_key,
  t.type_name,
  d.task_mode,
  d.source_type,
  COALESCE(d.endpoint_url, ''),
  d.sync_mode,
  d.request_method,
  COALESCE(d.owner, ''),
  d.schedule_text,
  d.batch_size,
  d.enabled,
  d.last_run_at,
  COALESCE(d.last_status, ''),
  d.created_at,
  d.updated_at
FROM discovery_task d
JOIN ci_type t ON t.id = d.ci_type_id
WHERE d.deleted = 0 AND d.enabled = 1
ORDER BY d.updated_at DESC, d.id DESC`

	rows, err := r.db.QueryContext(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]DiscoveryTaskRow, 0, 16)
	for rows.Next() {
		item, err := scanDiscoveryTask(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, *item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func (r *CIRepository) GetDiscoveryTaskByUID(ctx context.Context, taskUID string) (*DiscoveryTaskRow, error) {
	const q = `
SELECT
  d.id,
  d.task_uid,
  d.name,
  d.ci_type_id,
  t.type_key,
  t.type_name,
  d.task_mode,
  d.source_type,
  COALESCE(d.endpoint_url, ''),
  d.sync_mode,
  d.request_method,
  COALESCE(d.owner, ''),
  d.schedule_text,
  d.batch_size,
  d.enabled,
  d.last_run_at,
  COALESCE(d.last_status, ''),
  d.created_at,
  d.updated_at
FROM discovery_task d
JOIN ci_type t ON t.id = d.ci_type_id
WHERE d.task_uid = ? AND d.deleted = 0
LIMIT 1`

	row := r.db.QueryRowContext(ctx, q, taskUID)
	item, err := scanDiscoveryTask(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return item, nil
}

func (r *CIRepository) InsertDiscoveryTask(ctx context.Context, p CreateDiscoveryTaskParams) (*DiscoveryTaskRow, error) {
	const q = `
INSERT INTO discovery_task (
  task_uid, name, ci_type_id, task_mode, source_type, endpoint_url, sync_mode, request_method,
  owner, schedule_text, batch_size, enabled
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

	_, err := r.db.ExecContext(ctx, q,
		p.TaskUID,
		p.Name,
		p.CITypeID,
		p.TaskMode,
		p.SourceType,
		nullableStr(p.EndpointURL),
		p.SyncMode,
		p.RequestMethod,
		nullableStr(p.Owner),
		p.ScheduleText,
		p.BatchSize,
		boolToInt(p.Enabled),
	)
	if err != nil {
		if isDuplicateError(err) {
			return nil, ErrDuplicateKey
		}
		return nil, err
	}
	return r.GetDiscoveryTaskByUID(ctx, p.TaskUID)
}

func (r *CIRepository) UpdateDiscoveryTaskEnabled(ctx context.Context, taskUID string, enabled bool) (*DiscoveryTaskRow, error) {
	const q = `
UPDATE discovery_task
SET enabled = ?
WHERE task_uid = ? AND deleted = 0`

	res, err := r.db.ExecContext(ctx, q, boolToInt(enabled), taskUID)
	if err != nil {
		return nil, err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return nil, err
	}
	if affected == 0 {
		return nil, ErrNotFound
	}
	return r.GetDiscoveryTaskByUID(ctx, taskUID)
}

func (r *CIRepository) UpdateDiscoveryTaskRunResult(ctx context.Context, p UpdateDiscoveryTaskRunResultParams) error {
	const q = `
UPDATE discovery_task
SET last_run_at = ?, last_status = ?
WHERE task_uid = ? AND deleted = 0`

	res, err := r.db.ExecContext(ctx, q, p.LastRunAt, p.LastStatus, p.TaskUID)
	if err != nil {
		return err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *CIRepository) SoftDeleteDiscoveryTask(ctx context.Context, taskUID string) error {
	const q = `
UPDATE discovery_task
SET deleted = 1, deleted_at = CURRENT_TIMESTAMP
WHERE task_uid = ? AND deleted = 0`

	res, err := r.db.ExecContext(ctx, q, taskUID)
	if err != nil {
		return err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *CIRepository) InsertDiscoveryRunLog(ctx context.Context, p InsertDiscoveryRunLogParams) error {
	const q = `
INSERT INTO discovery_run_log (
  run_uid, task_id, task_uid, task_name, ci_type_id, status, success_count, created_count, updated_count,
  failed_count, error_message, started_at, finished_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

	_, err := r.db.ExecContext(ctx, q,
		p.RunUID,
		p.TaskID,
		p.TaskUID,
		p.TaskName,
		p.CITypeID,
		p.Status,
		p.SuccessCount,
		p.CreatedCount,
		p.UpdatedCount,
		p.FailedCount,
		nullableStr(p.ErrorMessage),
		p.StartedAt,
		p.FinishedAt,
	)
	if err != nil {
		if isDuplicateError(err) {
			return ErrDuplicateKey
		}
		return err
	}
	return nil
}

func (r *CIRepository) ListDiscoveryRunLogs(ctx context.Context, limit int) ([]DiscoveryRunLogRow, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}

	const q = `
SELECT
  l.id,
  l.run_uid,
  l.task_id,
  l.task_uid,
  l.task_name,
  l.ci_type_id,
  t.type_key,
  t.type_name,
  l.status,
  l.success_count,
  l.created_count,
  l.updated_count,
  l.failed_count,
  COALESCE(l.error_message, ''),
  l.started_at,
  l.finished_at,
  l.created_at
FROM discovery_run_log l
JOIN ci_type t ON t.id = l.ci_type_id
ORDER BY l.created_at DESC, l.id DESC
LIMIT ?`

	rows, err := r.db.QueryContext(ctx, q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]DiscoveryRunLogRow, 0, limit)
	for rows.Next() {
		var item DiscoveryRunLogRow
		if err := rows.Scan(
			&item.ID,
			&item.RunUID,
			&item.TaskID,
			&item.TaskUID,
			&item.TaskName,
			&item.CITypeID,
			&item.CITypeKey,
			&item.CITypeName,
			&item.Status,
			&item.SuccessCount,
			&item.CreatedCount,
			&item.UpdatedCount,
			&item.FailedCount,
			&item.ErrorMessage,
			&item.StartedAt,
			&item.FinishedAt,
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

func scanDiscoveryTask(scanner interface{ Scan(dest ...any) error }) (*DiscoveryTaskRow, error) {
	var item DiscoveryTaskRow
	var enabled int
	var lastRun sql.NullTime
	if err := scanner.Scan(
		&item.ID,
		&item.TaskUID,
		&item.Name,
		&item.CITypeID,
		&item.CITypeKey,
		&item.CITypeName,
		&item.TaskMode,
		&item.SourceType,
		&item.EndpointURL,
		&item.SyncMode,
		&item.RequestMethod,
		&item.Owner,
		&item.ScheduleText,
		&item.BatchSize,
		&enabled,
		&lastRun,
		&item.LastStatus,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		return nil, err
	}
	item.Enabled = enabled == 1
	if lastRun.Valid {
		value := lastRun.Time
		item.LastRunAt = &value
	}
	return &item, nil
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
