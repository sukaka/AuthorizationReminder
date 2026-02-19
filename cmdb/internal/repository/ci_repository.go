package repository

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"cmdb/internal/model"
	mysqlerr "github.com/go-sql-driver/mysql"
)

var (
	ErrNotFound         = errors.New("not found")
	ErrVersionConflict  = errors.New("version conflict")
	ErrDuplicateKey     = errors.New("duplicate key")
	ErrNoFieldsToUpdate = errors.New("no fields to update")
)

type CIRepository struct {
	db *sql.DB
}

type CreateCIParams struct {
	CIUID     string
	CITypeID  uint64
	Name      string
	UniqueKey string
	Status    string
	Owner     string
	Source    string
	SourceRef string
	ExtraJSON []byte
}

type UpdateCIParams struct {
	ID        uint64
	Version   uint32
	Name      *string
	Status    *string
	Owner     *string
	SourceRef *string

	HasExtraJSON bool
	ExtraJSON    []byte
}

type ListCIParams struct {
	CITypeKey string
	Status    string
	Owner     string
	Keyword   string
	Page      int
	PageSize  int
}

type CIListRow struct {
	CIUID      string
	CITypeKey  string
	CITypeName string
	Name       string
	UniqueKey  string
	Status     string
	Owner      string
	Source     string
	SourceRef  string
	Version    uint32
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

type UpsertRelationParams struct {
	FromCIID     uint64
	ToCIID       uint64
	RelationType string
	Attributes   []byte
}

type ChangeLogParams struct {
	CIID          uint64
	OpType        string
	ChangedFields []byte
	BeforeJSON    []byte
	AfterJSON     []byte
	OperatorSub   string
	OperatorName  string
	RequestID     string
}

type AuditParams struct {
	RequestID    string
	ActorSub     string
	ActorName    string
	ActorRoles   []byte
	Action       string
	ResourceType string
	ResourceUID  string
	HTTPMethod   string
	HTTPPath     string
	StatusCode   int
	Result       string
	ErrorMessage string
	Metadata     []byte
}

type OutboxInsertParams struct {
	EventID       string
	AggregateType string
	AggregateUID  string
	EventType     string
	Payload       []byte
	Headers       []byte
}

func NewCIRepository(db *sql.DB) *CIRepository {
	return &CIRepository{db: db}
}

func (r *CIRepository) BeginTx(ctx context.Context) (*sql.Tx, error) {
	return r.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
}

func (r *CIRepository) GetByUID(ctx context.Context, ciUID string) (*model.CI, error) {
	const q = `
SELECT id, ci_uid, ci_type_id, name, unique_key, status, COALESCE(owner, ''), source, COALESCE(source_ref, ''),
       CAST(extra_attrs_json AS CHAR), version, deleted, created_at, updated_at
FROM ci
WHERE ci_uid = ? AND deleted = 0
LIMIT 1`

	return scanCI(r.db.QueryRowContext(ctx, q, ciUID))
}

func (r *CIRepository) GetByUIDTx(ctx context.Context, tx *sql.Tx, ciUID string) (*model.CI, error) {
	const q = `
SELECT id, ci_uid, ci_type_id, name, unique_key, status, COALESCE(owner, ''), source, COALESCE(source_ref, ''),
       CAST(extra_attrs_json AS CHAR), version, deleted, created_at, updated_at
FROM ci
WHERE ci_uid = ? AND deleted = 0
LIMIT 1`

	return scanCI(tx.QueryRowContext(ctx, q, ciUID))
}

func (r *CIRepository) GetByIDTx(ctx context.Context, tx *sql.Tx, id uint64) (*model.CI, error) {
	const q = `
SELECT id, ci_uid, ci_type_id, name, unique_key, status, COALESCE(owner, ''), source, COALESCE(source_ref, ''),
       CAST(extra_attrs_json AS CHAR), version, deleted, created_at, updated_at
FROM ci
WHERE id = ? AND deleted = 0
LIMIT 1`

	return scanCI(tx.QueryRowContext(ctx, q, id))
}

func (r *CIRepository) GetTypeIDByKeyTx(ctx context.Context, tx *sql.Tx, typeKey string) (uint64, error) {
	const q = `SELECT id FROM ci_type WHERE type_key = ? AND deleted = 0 LIMIT 1`
	var id uint64
	err := tx.QueryRowContext(ctx, q, typeKey).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrNotFound
	}
	if err != nil {
		return 0, err
	}
	return id, nil
}

func (r *CIRepository) GetTypeKeyByID(ctx context.Context, ciTypeID uint64) (string, error) {
	const q = `SELECT type_key FROM ci_type WHERE id = ? AND deleted = 0 LIMIT 1`
	var typeKey string
	err := r.db.QueryRowContext(ctx, q, ciTypeID).Scan(&typeKey)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	return typeKey, nil
}

func (r *CIRepository) InsertCITx(ctx context.Context, tx *sql.Tx, p CreateCIParams) (*model.CI, error) {
	const q = `
INSERT INTO ci (ci_uid, ci_type_id, name, unique_key, status, owner, source, source_ref, extra_attrs_json)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`

	res, err := tx.ExecContext(ctx, q,
		p.CIUID,
		p.CITypeID,
		p.Name,
		p.UniqueKey,
		p.Status,
		nullableStr(p.Owner),
		p.Source,
		nullableStr(p.SourceRef),
		jsonArg(p.ExtraJSON),
	)
	if err != nil {
		if isDuplicateError(err) {
			return nil, ErrDuplicateKey
		}
		return nil, err
	}

	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}

	return r.GetByIDTx(ctx, tx, uint64(id))
}

func (r *CIRepository) UpdateCITx(ctx context.Context, tx *sql.Tx, p UpdateCIParams) (*model.CI, error) {
	setParts := make([]string, 0, 6)
	args := make([]any, 0, 10)

	if p.Name != nil {
		setParts = append(setParts, "name = ?")
		args = append(args, *p.Name)
	}
	if p.Status != nil {
		setParts = append(setParts, "status = ?")
		args = append(args, *p.Status)
	}
	if p.Owner != nil {
		setParts = append(setParts, "owner = ?")
		args = append(args, nullableStr(*p.Owner))
	}
	if p.SourceRef != nil {
		setParts = append(setParts, "source_ref = ?")
		args = append(args, nullableStr(*p.SourceRef))
	}
	if p.HasExtraJSON {
		setParts = append(setParts, "extra_attrs_json = ?")
		args = append(args, jsonArg(p.ExtraJSON))
	}

	if len(setParts) == 0 {
		return nil, ErrNoFieldsToUpdate
	}

	setParts = append(setParts, "version = version + 1")
	setClause := strings.Join(setParts, ", ")
	q := `UPDATE ci SET ` + setClause + ` WHERE id = ? AND version = ? AND deleted = 0`
	args = append(args, p.ID, p.Version)

	res, err := tx.ExecContext(ctx, q, args...)
	if err != nil {
		if isDuplicateError(err) {
			return nil, ErrDuplicateKey
		}
		return nil, err
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return nil, err
	}
	if affected == 0 {
		return nil, ErrVersionConflict
	}

	return r.GetByIDTx(ctx, tx, p.ID)
}

func (r *CIRepository) ListCI(ctx context.Context, p ListCIParams) ([]CIListRow, int64, error) {
	page := p.Page
	if page < 1 {
		page = 1
	}
	pageSize := p.PageSize
	if pageSize <= 0 {
		pageSize = 10
	}
	if pageSize > 100 {
		pageSize = 100
	}

	whereClause, args := buildCIListWhereClause(p)

	countQuery := `
SELECT COUNT(*)
FROM ci c
JOIN ci_type t ON t.id = c.ci_type_id
WHERE c.deleted = 0` + whereClause

	var total int64
	if err := r.db.QueryRowContext(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []CIListRow{}, 0, nil
	}

	dataQuery := `
SELECT
  c.ci_uid,
  t.type_key,
  t.type_name,
  c.name,
  c.unique_key,
  c.status,
  COALESCE(c.owner, ''),
  c.source,
  COALESCE(c.source_ref, ''),
  c.version,
  c.created_at,
  c.updated_at
FROM ci c
JOIN ci_type t ON t.id = c.ci_type_id
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

	result := make([]CIListRow, 0, pageSize)
	for rows.Next() {
		var item CIListRow
		if err := rows.Scan(
			&item.CIUID,
			&item.CITypeKey,
			&item.CITypeName,
			&item.Name,
			&item.UniqueKey,
			&item.Status,
			&item.Owner,
			&item.Source,
			&item.SourceRef,
			&item.Version,
			&item.CreatedAt,
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

func (r *CIRepository) SoftDeleteCITx(ctx context.Context, tx *sql.Tx, ciID uint64, version uint32) error {
	const q = `
UPDATE ci
SET deleted = 1, deleted_at = CURRENT_TIMESTAMP, version = version + 1
WHERE id = ? AND version = ? AND deleted = 0`

	res, err := tx.ExecContext(ctx, q, ciID, version)
	if err != nil {
		return err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrVersionConflict
	}
	return nil
}

func (r *CIRepository) UpsertRelationTx(ctx context.Context, tx *sql.Tx, p UpsertRelationParams) (*model.CIRelation, error) {
	const upsert = `
INSERT INTO ci_relation (from_ci_id, to_ci_id, relation_type, attributes_json, version, deleted)
VALUES (?, ?, ?, ?, 1, 0)
ON DUPLICATE KEY UPDATE
  attributes_json = VALUES(attributes_json),
  version = version + 1,
  deleted = 0,
  deleted_at = NULL`

	if _, err := tx.ExecContext(ctx, upsert,
		p.FromCIID,
		p.ToCIID,
		p.RelationType,
		jsonArg(p.Attributes),
	); err != nil {
		return nil, err
	}

	const q = `
SELECT id, from_ci_id, to_ci_id, relation_type, CAST(attributes_json AS CHAR),
       version, deleted, created_at, updated_at
FROM ci_relation
WHERE from_ci_id = ? AND to_ci_id = ? AND relation_type = ? AND deleted = 0
ORDER BY id DESC
LIMIT 1`

	var item model.CIRelation
	var deleted int
	if err := tx.QueryRowContext(ctx, q, p.FromCIID, p.ToCIID, p.RelationType).Scan(
		&item.ID,
		&item.FromCIID,
		&item.ToCIID,
		&item.RelationType,
		&item.Attributes,
		&item.Version,
		&deleted,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	item.Deleted = deleted == 1
	return &item, nil
}

func (r *CIRepository) InsertChangeLogTx(ctx context.Context, tx *sql.Tx, p ChangeLogParams) error {
	const q = `
INSERT INTO ci_change_log (ci_id, op_type, changed_fields, before_json, after_json, operator_sub, operator_name, request_id)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)`

	_, err := tx.ExecContext(ctx, q,
		p.CIID,
		p.OpType,
		jsonArg(p.ChangedFields),
		jsonArg(p.BeforeJSON),
		jsonArg(p.AfterJSON),
		p.OperatorSub,
		nullableStr(p.OperatorName),
		nullableStr(p.RequestID),
	)
	return err
}

func (r *CIRepository) InsertOperationAuditTx(ctx context.Context, tx *sql.Tx, p AuditParams) error {
	const q = `
INSERT INTO operation_audit (
  request_id, actor_sub, actor_name, actor_roles, action, resource_type, resource_uid,
  http_method, http_path, status_code, result, error_message, metadata_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

	_, err := tx.ExecContext(ctx, q,
		p.RequestID,
		p.ActorSub,
		nullableStr(p.ActorName),
		jsonArg(p.ActorRoles),
		p.Action,
		p.ResourceType,
		nullableStr(p.ResourceUID),
		nullableStr(p.HTTPMethod),
		nullableStr(p.HTTPPath),
		p.StatusCode,
		p.Result,
		nullableStr(p.ErrorMessage),
		jsonArg(p.Metadata),
	)
	return err
}

func (r *CIRepository) InsertOutboxEventTx(ctx context.Context, tx *sql.Tx, p OutboxInsertParams) error {
	const q = `
INSERT INTO outbox_event (event_id, aggregate_type, aggregate_uid, event_type, payload_json, headers_json)
VALUES (?, ?, ?, ?, ?, ?)`

	_, err := tx.ExecContext(ctx, q,
		p.EventID,
		p.AggregateType,
		p.AggregateUID,
		p.EventType,
		jsonArg(p.Payload),
		jsonArg(p.Headers),
	)
	if err != nil {
		if isDuplicateError(err) {
			return ErrDuplicateKey
		}
		return err
	}
	return nil
}

func scanCI(scanner interface{ Scan(dest ...any) error }) (*model.CI, error) {
	var item model.CI
	var deleted int
	if err := scanner.Scan(
		&item.ID,
		&item.CIUID,
		&item.CITypeID,
		&item.Name,
		&item.UniqueKey,
		&item.Status,
		&item.Owner,
		&item.Source,
		&item.SourceRef,
		&item.ExtraAttrs,
		&item.Version,
		&deleted,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	item.Deleted = deleted == 1
	return &item, nil
}

func isDuplicateError(err error) bool {
	var me *mysqlerr.MySQLError
	if errors.As(err, &me) {
		return me.Number == 1062
	}
	return false
}

func nullableStr(v string) any {
	if strings.TrimSpace(v) == "" {
		return nil
	}
	return v
}

func jsonArg(data []byte) any {
	if len(data) == 0 {
		return nil
	}
	return string(data)
}

func BackoffAt(now time.Time, retryCount int) time.Time {
	if retryCount < 1 {
		retryCount = 1
	}
	if retryCount > 8 {
		retryCount = 8
	}
	delay := time.Duration(1<<retryCount) * time.Second
	if delay > 5*time.Minute {
		delay = 5 * time.Minute
	}
	return now.Add(delay)
}

func buildCIListWhereClause(p ListCIParams) (string, []any) {
	var where strings.Builder
	args := make([]any, 0, 6)

	if p.CITypeKey != "" {
		where.WriteString(" AND t.type_key = ?")
		args = append(args, p.CITypeKey)
	}
	if p.Status != "" {
		where.WriteString(" AND c.status = ?")
		args = append(args, p.Status)
	}
	if p.Owner != "" {
		where.WriteString(" AND c.owner = ?")
		args = append(args, p.Owner)
	}
	if p.Keyword != "" {
		where.WriteString(" AND (c.name LIKE ? OR c.unique_key LIKE ? OR c.ci_uid LIKE ?)")
		like := "%" + p.Keyword + "%"
		args = append(args, like, like, like)
	}

	return where.String(), args
}
