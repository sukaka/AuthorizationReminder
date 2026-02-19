package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"cmdb/internal/events"
	"cmdb/internal/model"
	"cmdb/internal/repository"
	"github.com/oklog/ulid/v2"
)

type CIService struct {
	repo *repository.CIRepository
}

type Operator struct {
	Sub       string
	Name      string
	Roles     []string
	RequestID string
	TraceID   string
	Method    string
	Path      string
}

type CreateCIInput struct {
	CITypeKey  string
	Name       string
	UniqueKey  string
	Status     string
	Owner      string
	Source     string
	SourceRef  string
	ExtraAttrs map[string]any
}

type UpdateCIInput struct {
	CIUID   string
	Version uint32

	Name      *string
	Status    *string
	Owner     *string
	SourceRef *string

	HasExtraAttrs bool
	ExtraAttrs    map[string]any
}

type ListCIInput struct {
	CITypeKey string
	Status    string
	Owner     string
	Keyword   string
	Page      int
	PageSize  int
}

type DeleteCIInput struct {
	CIUID   string
	Version uint32
}

type UpsertRelationInput struct {
	FromCIUID    string
	ToCIUID      string
	RelationType string
	Attributes   map[string]any
}

type CIResult struct {
	CIUID     string    `json:"ci_uid"`
	CITypeKey string    `json:"ci_type_key,omitempty"`
	Name      string    `json:"name"`
	UniqueKey string    `json:"unique_key,omitempty"`
	Status    string    `json:"status"`
	Owner     string    `json:"owner,omitempty"`
	Source    string    `json:"source,omitempty"`
	SourceRef string    `json:"source_ref,omitempty"`
	Version   uint32    `json:"version"`
	CreatedAt time.Time `json:"created_at,omitempty"`
	UpdatedAt time.Time `json:"updated_at"`
}

type CIListItemResult struct {
	CIUID      string    `json:"ci_uid"`
	CITypeKey  string    `json:"ci_type_key"`
	CITypeName string    `json:"ci_type_name"`
	Name       string    `json:"name"`
	UniqueKey  string    `json:"unique_key"`
	Status     string    `json:"status"`
	Owner      string    `json:"owner,omitempty"`
	Source     string    `json:"source"`
	SourceRef  string    `json:"source_ref,omitempty"`
	Version    uint32    `json:"version"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type CIListResult struct {
	Items    []CIListItemResult `json:"items"`
	Total    int64              `json:"total"`
	Page     int                `json:"page"`
	PageSize int                `json:"page_size"`
}

type DeleteCIResult struct {
	CIUID   string `json:"ci_uid"`
	Version uint32 `json:"version"`
}

type RelationResult struct {
	FromCIUID    string    `json:"from_ci_uid"`
	ToCIUID      string    `json:"to_ci_uid"`
	RelationType string    `json:"relation_type"`
	Version      uint32    `json:"version"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func NewCIService(repo *repository.CIRepository) *CIService {
	return &CIService{repo: repo}
}

func (s *CIService) GetByUID(ctx context.Context, ciUID string) (*CIResult, error) {
	ciUID = strings.TrimSpace(ciUID)
	if ciUID == "" {
		return nil, ErrInvalidInput
	}

	item, err := s.repo.GetByUID(ctx, ciUID)
	if err != nil {
		return nil, err
	}
	if item == nil {
		return nil, ErrNotFound
	}
	result := toCIResult(item)
	typeKey, err := s.repo.GetTypeKeyByID(ctx, item.CITypeID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	result.CITypeKey = typeKey
	return result, nil
}

func (s *CIService) CreateCI(ctx context.Context, in CreateCIInput, op Operator) (*CIResult, error) {
	if err := validateCreateInput(&in); err != nil {
		return nil, err
	}
	prepareOperator(&op)

	extraJSON, err := marshalMap(in.ExtraAttrs)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid extra_attrs", ErrInvalidInput)
	}

	tx, err := s.repo.BeginTx(ctx)
	if err != nil {
		return nil, err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	typeID, err := s.repo.GetTypeIDByKeyTx(ctx, tx, in.CITypeKey)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return nil, fmt.Errorf("%w: unknown ci_type_key", ErrInvalidInput)
		}
		return nil, err
	}

	ciUID := ulid.Make().String()
	created, err := s.repo.InsertCITx(ctx, tx, repository.CreateCIParams{
		CIUID:     ciUID,
		CITypeID:  typeID,
		Name:      in.Name,
		UniqueKey: in.UniqueKey,
		Status:    in.Status,
		Owner:     in.Owner,
		Source:    in.Source,
		SourceRef: in.SourceRef,
		ExtraJSON: extraJSON,
	})
	if err != nil {
		if errors.Is(err, repository.ErrDuplicateKey) {
			return nil, fmt.Errorf("%w: duplicate ci unique_key", ErrConflict)
		}
		return nil, err
	}

	changedFields, _ := json.Marshal([]string{"ci_type_key", "name", "unique_key", "status", "owner", "source", "source_ref", "extra_attrs"})
	afterJSON, _ := json.Marshal(ciSnapshot(created))
	if err := s.repo.InsertChangeLogTx(ctx, tx, repository.ChangeLogParams{
		CIID:          created.ID,
		OpType:        "create",
		ChangedFields: changedFields,
		AfterJSON:     afterJSON,
		OperatorSub:   op.Sub,
		OperatorName:  op.Name,
		RequestID:     op.RequestID,
	}); err != nil {
		return nil, err
	}

	rolesJSON, _ := json.Marshal(op.Roles)
	auditMeta, _ := json.Marshal(map[string]any{
		"ci_type_key": in.CITypeKey,
		"source":      in.Source,
	})
	if err := s.repo.InsertOperationAuditTx(ctx, tx, repository.AuditParams{
		RequestID:    op.RequestID,
		ActorSub:     op.Sub,
		ActorName:    op.Name,
		ActorRoles:   rolesJSON,
		Action:       "ci.create",
		ResourceType: "ci",
		ResourceUID:  created.CIUID,
		HTTPMethod:   op.Method,
		HTTPPath:     op.Path,
		StatusCode:   201,
		Result:       "success",
		Metadata:     auditMeta,
	}); err != nil {
		return nil, err
	}

	payload, eventID, err := events.NewEnvelope(events.EventTypeCICreated, op.TraceID, map[string]any{
		"ci_uid":       created.CIUID,
		"version":      created.Version,
		"name":         created.Name,
		"status":       created.Status,
		"ci_type_key":  in.CITypeKey,
		"operator_sub": op.Sub,
	})
	if err != nil {
		return nil, err
	}
	if err := s.repo.InsertOutboxEventTx(ctx, tx, repository.OutboxInsertParams{
		EventID:       eventID,
		AggregateType: "ci",
		AggregateUID:  created.CIUID,
		EventType:     events.EventTypeCICreated,
		Payload:       payload,
	}); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	committed = true

	return toCIResult(created), nil
}

func (s *CIService) ListCI(ctx context.Context, in ListCIInput) (*CIListResult, error) {
	if err := validateListInput(&in); err != nil {
		return nil, err
	}

	rows, total, err := s.repo.ListCI(ctx, repository.ListCIParams{
		CITypeKey: in.CITypeKey,
		Status:    in.Status,
		Owner:     in.Owner,
		Keyword:   in.Keyword,
		Page:      in.Page,
		PageSize:  in.PageSize,
	})
	if err != nil {
		return nil, err
	}

	items := make([]CIListItemResult, 0, len(rows))
	for _, row := range rows {
		items = append(items, CIListItemResult{
			CIUID:      row.CIUID,
			CITypeKey:  row.CITypeKey,
			CITypeName: firstNonEmpty(row.CITypeName, row.CITypeKey),
			Name:       row.Name,
			UniqueKey:  row.UniqueKey,
			Status:     row.Status,
			Owner:      row.Owner,
			Source:     row.Source,
			SourceRef:  row.SourceRef,
			Version:    row.Version,
			CreatedAt:  row.CreatedAt,
			UpdatedAt:  row.UpdatedAt,
		})
	}

	return &CIListResult{
		Items:    items,
		Total:    total,
		Page:     in.Page,
		PageSize: in.PageSize,
	}, nil
}

func (s *CIService) UpdateCI(ctx context.Context, in UpdateCIInput, op Operator) (*CIResult, error) {
	if err := validateUpdateInput(&in); err != nil {
		return nil, err
	}
	prepareOperator(&op)

	tx, err := s.repo.BeginTx(ctx)
	if err != nil {
		return nil, err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	existing, err := s.repo.GetByUIDTx(ctx, tx, in.CIUID)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, ErrNotFound
	}

	var extraJSON []byte
	if in.HasExtraAttrs {
		extraJSON, err = marshalMap(in.ExtraAttrs)
		if err != nil {
			return nil, fmt.Errorf("%w: invalid extra_attrs", ErrInvalidInput)
		}
	}

	updated, err := s.repo.UpdateCITx(ctx, tx, repository.UpdateCIParams{
		ID:           existing.ID,
		Version:      in.Version,
		Name:         in.Name,
		Status:       in.Status,
		Owner:        in.Owner,
		SourceRef:    in.SourceRef,
		HasExtraJSON: in.HasExtraAttrs,
		ExtraJSON:    extraJSON,
	})
	if err != nil {
		switch {
		case errors.Is(err, repository.ErrVersionConflict):
			return nil, fmt.Errorf("%w: stale version", ErrConflict)
		case errors.Is(err, repository.ErrDuplicateKey):
			return nil, fmt.Errorf("%w: duplicate key", ErrConflict)
		case errors.Is(err, repository.ErrNoFieldsToUpdate):
			return nil, ErrInvalidInput
		default:
			return nil, err
		}
	}

	changed := collectChangedFields(in)
	changedFieldsJSON, _ := json.Marshal(changed)
	beforeJSON, _ := json.Marshal(ciSnapshot(existing))
	afterJSON, _ := json.Marshal(ciSnapshot(updated))
	if err := s.repo.InsertChangeLogTx(ctx, tx, repository.ChangeLogParams{
		CIID:          existing.ID,
		OpType:        "update",
		ChangedFields: changedFieldsJSON,
		BeforeJSON:    beforeJSON,
		AfterJSON:     afterJSON,
		OperatorSub:   op.Sub,
		OperatorName:  op.Name,
		RequestID:     op.RequestID,
	}); err != nil {
		return nil, err
	}

	rolesJSON, _ := json.Marshal(op.Roles)
	if err := s.repo.InsertOperationAuditTx(ctx, tx, repository.AuditParams{
		RequestID:    op.RequestID,
		ActorSub:     op.Sub,
		ActorName:    op.Name,
		ActorRoles:   rolesJSON,
		Action:       "ci.update",
		ResourceType: "ci",
		ResourceUID:  updated.CIUID,
		HTTPMethod:   op.Method,
		HTTPPath:     op.Path,
		StatusCode:   200,
		Result:       "success",
	}); err != nil {
		return nil, err
	}

	payload, eventID, err := events.NewEnvelope(events.EventTypeCIUpdated, op.TraceID, map[string]any{
		"ci_uid":         updated.CIUID,
		"version":        updated.Version,
		"changed_fields": changed,
		"operator_sub":   op.Sub,
	})
	if err != nil {
		return nil, err
	}
	if err := s.repo.InsertOutboxEventTx(ctx, tx, repository.OutboxInsertParams{
		EventID:       eventID,
		AggregateType: "ci",
		AggregateUID:  updated.CIUID,
		EventType:     events.EventTypeCIUpdated,
		Payload:       payload,
	}); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	committed = true

	return toCIResult(updated), nil
}

func (s *CIService) DeleteCI(ctx context.Context, in DeleteCIInput, op Operator) (*DeleteCIResult, error) {
	if err := validateDeleteInput(&in); err != nil {
		return nil, err
	}
	prepareOperator(&op)

	tx, err := s.repo.BeginTx(ctx)
	if err != nil {
		return nil, err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	existing, err := s.repo.GetByUIDTx(ctx, tx, in.CIUID)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, ErrNotFound
	}

	if err := s.repo.SoftDeleteCITx(ctx, tx, existing.ID, in.Version); err != nil {
		if errors.Is(err, repository.ErrVersionConflict) {
			return nil, fmt.Errorf("%w: stale version", ErrConflict)
		}
		return nil, err
	}

	changedFields, _ := json.Marshal([]string{"deleted", "deleted_at"})
	beforeJSON, _ := json.Marshal(ciSnapshot(existing))
	afterJSON, _ := json.Marshal(map[string]any{
		"ci_uid":  existing.CIUID,
		"deleted": true,
		"version": existing.Version + 1,
	})
	if err := s.repo.InsertChangeLogTx(ctx, tx, repository.ChangeLogParams{
		CIID:          existing.ID,
		OpType:        "delete",
		ChangedFields: changedFields,
		BeforeJSON:    beforeJSON,
		AfterJSON:     afterJSON,
		OperatorSub:   op.Sub,
		OperatorName:  op.Name,
		RequestID:     op.RequestID,
	}); err != nil {
		return nil, err
	}

	rolesJSON, _ := json.Marshal(op.Roles)
	if err := s.repo.InsertOperationAuditTx(ctx, tx, repository.AuditParams{
		RequestID:    op.RequestID,
		ActorSub:     op.Sub,
		ActorName:    op.Name,
		ActorRoles:   rolesJSON,
		Action:       "ci.delete",
		ResourceType: "ci",
		ResourceUID:  existing.CIUID,
		HTTPMethod:   op.Method,
		HTTPPath:     op.Path,
		StatusCode:   200,
		Result:       "success",
	}); err != nil {
		return nil, err
	}

	payload, eventID, err := events.NewEnvelope(events.EventTypeCIDeleted, op.TraceID, map[string]any{
		"ci_uid":       existing.CIUID,
		"version":      existing.Version + 1,
		"operator_sub": op.Sub,
	})
	if err != nil {
		return nil, err
	}
	if err := s.repo.InsertOutboxEventTx(ctx, tx, repository.OutboxInsertParams{
		EventID:       eventID,
		AggregateType: "ci",
		AggregateUID:  existing.CIUID,
		EventType:     events.EventTypeCIDeleted,
		Payload:       payload,
	}); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	committed = true

	return &DeleteCIResult{
		CIUID:   existing.CIUID,
		Version: existing.Version + 1,
	}, nil
}

func (s *CIService) UpsertRelation(ctx context.Context, in UpsertRelationInput, op Operator) (*RelationResult, error) {
	if err := validateRelationInput(&in); err != nil {
		return nil, err
	}
	prepareOperator(&op)

	attrsJSON, err := marshalMap(in.Attributes)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid relation attributes", ErrInvalidInput)
	}

	tx, err := s.repo.BeginTx(ctx)
	if err != nil {
		return nil, err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	fromCI, err := s.repo.GetByUIDTx(ctx, tx, in.FromCIUID)
	if err != nil {
		return nil, err
	}
	if fromCI == nil {
		return nil, fmt.Errorf("%w: from ci not found", ErrNotFound)
	}
	toCI, err := s.repo.GetByUIDTx(ctx, tx, in.ToCIUID)
	if err != nil {
		return nil, err
	}
	if toCI == nil {
		return nil, fmt.Errorf("%w: to ci not found", ErrNotFound)
	}

	relation, err := s.repo.UpsertRelationTx(ctx, tx, repository.UpsertRelationParams{
		FromCIID:     fromCI.ID,
		ToCIID:       toCI.ID,
		RelationType: in.RelationType,
		Attributes:   attrsJSON,
	})
	if err != nil {
		return nil, err
	}

	changedFields, _ := json.Marshal([]string{"relation_type", "to_ci_uid", "attributes"})
	afterJSON, _ := json.Marshal(map[string]any{
		"from_ci_uid":   fromCI.CIUID,
		"to_ci_uid":     toCI.CIUID,
		"relation_type": relation.RelationType,
		"version":       relation.Version,
	})
	if err := s.repo.InsertChangeLogTx(ctx, tx, repository.ChangeLogParams{
		CIID:          fromCI.ID,
		OpType:        "relation_update",
		ChangedFields: changedFields,
		AfterJSON:     afterJSON,
		OperatorSub:   op.Sub,
		OperatorName:  op.Name,
		RequestID:     op.RequestID,
	}); err != nil {
		return nil, err
	}

	rolesJSON, _ := json.Marshal(op.Roles)
	if err := s.repo.InsertOperationAuditTx(ctx, tx, repository.AuditParams{
		RequestID:    op.RequestID,
		ActorSub:     op.Sub,
		ActorName:    op.Name,
		ActorRoles:   rolesJSON,
		Action:       "ci.relation.upsert",
		ResourceType: "ci_relation",
		ResourceUID:  fromCI.CIUID + "->" + toCI.CIUID,
		HTTPMethod:   op.Method,
		HTTPPath:     op.Path,
		StatusCode:   200,
		Result:       "success",
	}); err != nil {
		return nil, err
	}

	payload, eventID, err := events.NewEnvelope(events.EventTypeCIRelationChanged, op.TraceID, map[string]any{
		"from_ci_uid":   fromCI.CIUID,
		"to_ci_uid":     toCI.CIUID,
		"relation_type": relation.RelationType,
		"version":       relation.Version,
		"operator_sub":  op.Sub,
	})
	if err != nil {
		return nil, err
	}
	if err := s.repo.InsertOutboxEventTx(ctx, tx, repository.OutboxInsertParams{
		EventID:       eventID,
		AggregateType: "ci_relation",
		AggregateUID:  fromCI.CIUID,
		EventType:     events.EventTypeCIRelationChanged,
		Payload:       payload,
	}); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	committed = true

	return &RelationResult{
		FromCIUID:    fromCI.CIUID,
		ToCIUID:      toCI.CIUID,
		RelationType: relation.RelationType,
		Version:      relation.Version,
		UpdatedAt:    relation.UpdatedAt,
	}, nil
}

func validateCreateInput(in *CreateCIInput) error {
	in.CITypeKey = strings.TrimSpace(in.CITypeKey)
	in.Name = strings.TrimSpace(in.Name)
	in.UniqueKey = strings.TrimSpace(in.UniqueKey)
	in.Status = strings.TrimSpace(in.Status)
	in.Owner = strings.TrimSpace(in.Owner)
	in.Source = strings.TrimSpace(in.Source)
	in.SourceRef = strings.TrimSpace(in.SourceRef)

	if in.CITypeKey == "" || in.Name == "" || in.UniqueKey == "" {
		return ErrInvalidInput
	}
	if in.Status == "" {
		in.Status = "active"
	}
	if in.Source == "" {
		in.Source = "manual"
	}
	if !allowedStatus(in.Status) || !allowedSource(in.Source) {
		return ErrInvalidInput
	}
	return nil
}

func validateUpdateInput(in *UpdateCIInput) error {
	in.CIUID = strings.TrimSpace(in.CIUID)
	if in.CIUID == "" || in.Version == 0 {
		return ErrInvalidInput
	}
	if in.Status != nil {
		status := strings.TrimSpace(*in.Status)
		if !allowedStatus(status) {
			return ErrInvalidInput
		}
		in.Status = &status
	}
	if in.Name != nil {
		name := strings.TrimSpace(*in.Name)
		if name == "" {
			return ErrInvalidInput
		}
		in.Name = &name
	}
	if in.Owner != nil {
		owner := strings.TrimSpace(*in.Owner)
		in.Owner = &owner
	}
	if in.SourceRef != nil {
		sourceRef := strings.TrimSpace(*in.SourceRef)
		in.SourceRef = &sourceRef
	}
	if in.Name == nil && in.Status == nil && in.Owner == nil && in.SourceRef == nil && !in.HasExtraAttrs {
		return ErrInvalidInput
	}
	return nil
}

func validateListInput(in *ListCIInput) error {
	in.CITypeKey = strings.TrimSpace(in.CITypeKey)
	in.Status = strings.TrimSpace(in.Status)
	in.Owner = strings.TrimSpace(in.Owner)
	in.Keyword = strings.TrimSpace(in.Keyword)
	if in.Status != "" && !allowedStatus(in.Status) {
		return ErrInvalidInput
	}
	if in.Page < 1 {
		in.Page = 1
	}
	if in.PageSize <= 0 {
		in.PageSize = 10
	}
	if in.PageSize > 100 {
		in.PageSize = 100
	}
	return nil
}

func validateDeleteInput(in *DeleteCIInput) error {
	in.CIUID = strings.TrimSpace(in.CIUID)
	if in.CIUID == "" || in.Version == 0 {
		return ErrInvalidInput
	}
	return nil
}

func validateRelationInput(in *UpsertRelationInput) error {
	in.FromCIUID = strings.TrimSpace(in.FromCIUID)
	in.ToCIUID = strings.TrimSpace(in.ToCIUID)
	in.RelationType = strings.TrimSpace(in.RelationType)
	if in.FromCIUID == "" || in.ToCIUID == "" || in.RelationType == "" {
		return ErrInvalidInput
	}
	if in.FromCIUID == in.ToCIUID {
		return ErrInvalidInput
	}
	if !allowedRelationType(in.RelationType) {
		return ErrInvalidInput
	}
	return nil
}

func allowedStatus(v string) bool {
	switch v {
	case "active", "inactive", "retired":
		return true
	default:
		return false
	}
}

func allowedSource(v string) bool {
	switch v {
	case "manual", "discovery", "cloud", "import":
		return true
	default:
		return false
	}
}

func allowedRelationType(v string) bool {
	switch v {
	case "depends_on", "runs_on", "connects_to", "owned_by":
		return true
	default:
		return false
	}
}

func collectChangedFields(in UpdateCIInput) []string {
	changed := make([]string, 0, 5)
	if in.Name != nil {
		changed = append(changed, "name")
	}
	if in.Status != nil {
		changed = append(changed, "status")
	}
	if in.Owner != nil {
		changed = append(changed, "owner")
	}
	if in.SourceRef != nil {
		changed = append(changed, "source_ref")
	}
	if in.HasExtraAttrs {
		changed = append(changed, "extra_attrs")
	}
	return changed
}

func toCIResult(item *model.CI) *CIResult {
	return &CIResult{
		CIUID:     item.CIUID,
		UniqueKey: item.UniqueKey,
		Name:      item.Name,
		Status:    item.Status,
		Owner:     item.Owner,
		Source:    item.Source,
		SourceRef: item.SourceRef,
		Version:   item.Version,
		CreatedAt: item.CreatedAt,
		UpdatedAt: item.UpdatedAt,
	}
}

func ciSnapshot(ci *model.CI) map[string]any {
	snapshot := map[string]any{
		"ci_uid":     ci.CIUID,
		"name":       ci.Name,
		"unique_key": ci.UniqueKey,
		"status":     ci.Status,
		"owner":      ci.Owner,
		"source":     ci.Source,
		"source_ref": ci.SourceRef,
		"version":    ci.Version,
	}
	if len(ci.ExtraAttrs) > 0 {
		snapshot["extra_attrs"] = json.RawMessage(ci.ExtraAttrs)
	}
	return snapshot
}

func prepareOperator(op *Operator) {
	op.Sub = strings.TrimSpace(op.Sub)
	op.Name = strings.TrimSpace(op.Name)
	op.RequestID = strings.TrimSpace(op.RequestID)
	op.TraceID = strings.TrimSpace(op.TraceID)
	op.Method = strings.TrimSpace(op.Method)
	op.Path = strings.TrimSpace(op.Path)
	if op.Sub == "" {
		op.Sub = "unknown"
	}
	if op.RequestID == "" {
		op.RequestID = ulid.Make().String()
	}
	if op.TraceID == "" {
		op.TraceID = op.RequestID
	}
}

func marshalMap(v map[string]any) ([]byte, error) {
	if v == nil {
		return nil, nil
	}
	return json.Marshal(v)
}
