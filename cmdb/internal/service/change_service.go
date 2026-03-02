package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"cmdb/internal/repository"
	"github.com/oklog/ulid/v2"
)

type ChangeService struct {
	repo *repository.CIRepository
}

type ListChangeInput struct {
	Status      string
	RiskLevel   string
	TargetCIUID string
	Keyword     string
	Page        int
	PageSize    int
}

type ListChangeResult struct {
	Items    []ChangeRequestResult `json:"items"`
	Total    int64                 `json:"total"`
	Page     int                   `json:"page"`
	PageSize int                   `json:"page_size"`
}

type ChangeRequestResult struct {
	ChangeUID       string                `json:"change_uid"`
	Title           string                `json:"title"`
	Description     string                `json:"description,omitempty"`
	TargetCIUID     string                `json:"target_ci_uid"`
	TargetCIName    string                `json:"target_ci_name"`
	RiskLevel       string                `json:"risk_level"`
	Status          string                `json:"status"`
	RequestedBySub  string                `json:"requested_by_sub"`
	RequestedByName string                `json:"requested_by_name,omitempty"`
	ApprovedBySub   string                `json:"approved_by_sub,omitempty"`
	ApprovedByName  string                `json:"approved_by_name,omitempty"`
	ExecutedBySub   string                `json:"executed_by_sub,omitempty"`
	ExecutedByName  string                `json:"executed_by_name,omitempty"`
	RollbackBySub   string                `json:"rollback_by_sub,omitempty"`
	RollbackByName  string                `json:"rollback_by_name,omitempty"`
	ApprovalComment string                `json:"approval_comment,omitempty"`
	ExecutionNote   string                `json:"execution_note,omitempty"`
	RollbackNote    string                `json:"rollback_note,omitempty"`
	PlannedStartAt  *time.Time            `json:"planned_start_at,omitempty"`
	PlannedEndAt    *time.Time            `json:"planned_end_at,omitempty"`
	Version         uint32                `json:"version"`
	CreatedAt       time.Time             `json:"created_at"`
	UpdatedAt       time.Time             `json:"updated_at"`
	Steps           []ChangeStepLogResult `json:"steps,omitempty"`
}

type ChangeStepLogResult struct {
	ID           uint64         `json:"id"`
	Action       string         `json:"action"`
	FromStatus   string         `json:"from_status,omitempty"`
	ToStatus     string         `json:"to_status"`
	OperatorSub  string         `json:"operator_sub"`
	OperatorName string         `json:"operator_name,omitempty"`
	CommentText  string         `json:"comment_text,omitempty"`
	Metadata     map[string]any `json:"metadata,omitempty"`
	CreatedAt    time.Time      `json:"created_at"`
}

type CreateChangeInput struct {
	Title          string
	Description    string
	TargetCIUID    string
	RiskLevel      string
	PlannedStartAt string
	PlannedEndAt   string
}

type ChangeActionInput struct {
	ChangeUID string
	Comment   string
}

func NewChangeService(repo *repository.CIRepository) *ChangeService {
	return &ChangeService{repo: repo}
}

func (s *ChangeService) ListChanges(ctx context.Context, in ListChangeInput) (*ListChangeResult, error) {
	if err := validateListChangeInput(&in); err != nil {
		return nil, err
	}
	rows, total, err := s.repo.ListChangeRequests(ctx, repository.ChangeListParams{
		Status:      in.Status,
		RiskLevel:   in.RiskLevel,
		TargetCIUID: in.TargetCIUID,
		Keyword:     in.Keyword,
		Page:        in.Page,
		PageSize:    in.PageSize,
	})
	if err != nil {
		return nil, err
	}

	items := make([]ChangeRequestResult, 0, len(rows))
	for _, row := range rows {
		items = append(items, toChangeRequestResult(row))
	}
	return &ListChangeResult{
		Items:    items,
		Total:    total,
		Page:     in.Page,
		PageSize: in.PageSize,
	}, nil
}

func (s *ChangeService) GetChange(ctx context.Context, changeUID string) (*ChangeRequestResult, error) {
	changeUID = strings.TrimSpace(changeUID)
	if changeUID == "" {
		return nil, ErrInvalidInput
	}
	row, err := s.repo.GetChangeRequestByUID(ctx, changeUID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	stepRows, err := s.repo.ListChangeStepLogs(ctx, changeUID, 200)
	if err != nil {
		return nil, err
	}
	result := toChangeRequestResult(*row)
	result.Steps = toChangeStepLogResults(stepRows)
	return &result, nil
}

func (s *ChangeService) CreateChange(ctx context.Context, in CreateChangeInput, op Operator) (*ChangeRequestResult, error) {
	if err := validateCreateChangeInput(&in); err != nil {
		return nil, err
	}
	prepareOperator(&op)

	target, err := s.repo.GetByUID(ctx, in.TargetCIUID)
	if err != nil {
		return nil, err
	}
	if target == nil {
		return nil, fmt.Errorf("%w: target ci not found", ErrInvalidInput)
	}

	plannedStart, err := parseOptionalDateTime(in.PlannedStartAt)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid planned_start_at", ErrInvalidInput)
	}
	plannedEnd, err := parseOptionalDateTime(in.PlannedEndAt)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid planned_end_at", ErrInvalidInput)
	}
	if plannedStart != nil && plannedEnd != nil && plannedEnd.Before(*plannedStart) {
		return nil, fmt.Errorf("%w: planned_end_at before planned_start_at", ErrInvalidInput)
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

	row, err := s.repo.InsertChangeRequestTx(ctx, tx, repository.CreateChangeRequestParams{
		ChangeUID:       ulid.Make().String(),
		Title:           in.Title,
		Description:     in.Description,
		TargetCIID:      target.ID,
		RiskLevel:       in.RiskLevel,
		RequestedBySub:  op.Sub,
		RequestedByName: op.Name,
		PlannedStartAt:  plannedStart,
		PlannedEndAt:    plannedEnd,
	})
	if err != nil {
		if errors.Is(err, repository.ErrDuplicateKey) {
			return nil, fmt.Errorf("%w: duplicate change uid", ErrConflict)
		}
		return nil, err
	}

	stepMeta, _ := json.Marshal(map[string]any{
		"target_ci_uid": row.TargetCIUID,
		"risk_level":    row.RiskLevel,
	})
	if err := s.repo.InsertChangeStepLogTx(ctx, tx, repository.InsertChangeStepLogParams{
		ChangeID:     row.ID,
		ChangeUID:    row.ChangeUID,
		Action:       "create",
		FromStatus:   "",
		ToStatus:     row.Status,
		OperatorSub:  op.Sub,
		OperatorName: op.Name,
		CommentText:  in.Description,
		MetadataJSON: stepMeta,
	}); err != nil {
		return nil, err
	}

	if err := s.repo.InsertOperationAuditTx(ctx, tx, repository.AuditParams{
		RequestID:    op.RequestID,
		ActorSub:     op.Sub,
		ActorName:    op.Name,
		ActorRoles:   mustJSON(op.Roles),
		Action:       "change.create",
		ResourceType: "change_request",
		ResourceUID:  row.ChangeUID,
		HTTPMethod:   op.Method,
		HTTPPath:     op.Path,
		StatusCode:   201,
		Result:       "success",
		Metadata: auditMetadataWithSourceIP(op.SourceIP, map[string]any{
			"target_ci_uid": row.TargetCIUID,
			"risk_level":    row.RiskLevel,
		}),
	}); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	committed = true

	result := toChangeRequestResult(*row)
	result.Steps = []ChangeStepLogResult{
		{
			Action:       "create",
			ToStatus:     row.Status,
			OperatorSub:  op.Sub,
			OperatorName: op.Name,
			CommentText:  in.Description,
			Metadata: map[string]any{
				"target_ci_uid": row.TargetCIUID,
				"risk_level":    row.RiskLevel,
			},
			CreatedAt: row.CreatedAt,
		},
	}
	return &result, nil
}

func (s *ChangeService) ApproveChange(ctx context.Context, in ChangeActionInput, op Operator) (*ChangeRequestResult, error) {
	return s.transitionChange(ctx, in, op, "pending_approval", "approved", "approve", "change.approve")
}

func (s *ChangeService) RejectChange(ctx context.Context, in ChangeActionInput, op Operator) (*ChangeRequestResult, error) {
	return s.transitionChange(ctx, in, op, "pending_approval", "rejected", "reject", "change.reject")
}

func (s *ChangeService) ExecuteChange(ctx context.Context, in ChangeActionInput, op Operator) (*ChangeRequestResult, error) {
	return s.transitionChange(ctx, in, op, "approved", "completed", "execute", "change.execute")
}

func (s *ChangeService) RollbackChange(ctx context.Context, in ChangeActionInput, op Operator) (*ChangeRequestResult, error) {
	return s.transitionChange(ctx, in, op, "completed", "rolled_back", "rollback", "change.rollback")
}

func (s *ChangeService) transitionChange(
	ctx context.Context,
	in ChangeActionInput,
	op Operator,
	expectStatus string,
	newStatus string,
	stepAction string,
	auditAction string,
) (*ChangeRequestResult, error) {
	in.ChangeUID = strings.TrimSpace(in.ChangeUID)
	in.Comment = strings.TrimSpace(in.Comment)
	if in.ChangeUID == "" {
		return nil, ErrInvalidInput
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

	existing, err := s.repo.GetChangeRequestByUIDTx(ctx, tx, in.ChangeUID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if existing.Status != expectStatus {
		return nil, fmt.Errorf("%w: current status is %s", ErrConflict, existing.Status)
	}

	updated, err := s.repo.UpdateChangeStatusTx(ctx, tx, repository.UpdateChangeStatusParams{
		ChangeUID:    in.ChangeUID,
		ExpectStatus: expectStatus,
		NewStatus:    newStatus,
		OperatorSub:  op.Sub,
		OperatorName: op.Name,
		CommentText:  in.Comment,
	})
	if err != nil {
		if errors.Is(err, repository.ErrVersionConflict) {
			return nil, fmt.Errorf("%w: status changed", ErrConflict)
		}
		return nil, err
	}

	stepMeta, _ := json.Marshal(map[string]any{
		"target_ci_uid": updated.TargetCIUID,
	})
	if err := s.repo.InsertChangeStepLogTx(ctx, tx, repository.InsertChangeStepLogParams{
		ChangeID:     updated.ID,
		ChangeUID:    updated.ChangeUID,
		Action:       stepAction,
		FromStatus:   existing.Status,
		ToStatus:     updated.Status,
		OperatorSub:  op.Sub,
		OperatorName: op.Name,
		CommentText:  in.Comment,
		MetadataJSON: stepMeta,
	}); err != nil {
		return nil, err
	}

	if newStatus == "completed" || newStatus == "rolled_back" {
		changedFields, _ := json.Marshal([]string{"change_request"})
		afterJSON, _ := json.Marshal(map[string]any{
			"change_uid": updated.ChangeUID,
			"status":     updated.Status,
			"comment":    in.Comment,
		})
		if err := s.repo.InsertChangeLogTx(ctx, tx, repository.ChangeLogParams{
			CIID:          updated.TargetCIID,
			OpType:        "reconcile",
			ChangedFields: changedFields,
			AfterJSON:     afterJSON,
			OperatorSub:   op.Sub,
			OperatorName:  op.Name,
			RequestID:     op.RequestID,
		}); err != nil {
			return nil, err
		}
	}

	if err := s.repo.InsertOperationAuditTx(ctx, tx, repository.AuditParams{
		RequestID:    op.RequestID,
		ActorSub:     op.Sub,
		ActorName:    op.Name,
		ActorRoles:   mustJSON(op.Roles),
		Action:       auditAction,
		ResourceType: "change_request",
		ResourceUID:  updated.ChangeUID,
		HTTPMethod:   op.Method,
		HTTPPath:     op.Path,
		StatusCode:   200,
		Result:       "success",
		Metadata: auditMetadataWithSourceIP(op.SourceIP, map[string]any{
			"from_status": existing.Status,
			"to_status":   updated.Status,
		}),
	}); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	committed = true

	stepRows, err := s.repo.ListChangeStepLogs(ctx, updated.ChangeUID, 200)
	if err != nil {
		return nil, err
	}
	result := toChangeRequestResult(*updated)
	result.Steps = toChangeStepLogResults(stepRows)
	return &result, nil
}

func validateListChangeInput(in *ListChangeInput) error {
	in.Status = strings.TrimSpace(in.Status)
	in.RiskLevel = strings.TrimSpace(in.RiskLevel)
	in.TargetCIUID = strings.TrimSpace(in.TargetCIUID)
	in.Keyword = strings.TrimSpace(in.Keyword)

	if in.Status != "" && !allowedChangeStatus(in.Status) {
		return ErrInvalidInput
	}
	if in.RiskLevel != "" && !allowedChangeRisk(in.RiskLevel) {
		return ErrInvalidInput
	}
	if in.Page < 1 {
		in.Page = 1
	}
	if in.PageSize <= 0 {
		in.PageSize = 20
	}
	if in.PageSize > 200 {
		in.PageSize = 200
	}
	return nil
}

func validateCreateChangeInput(in *CreateChangeInput) error {
	in.Title = strings.TrimSpace(in.Title)
	in.Description = strings.TrimSpace(in.Description)
	in.TargetCIUID = strings.TrimSpace(in.TargetCIUID)
	in.RiskLevel = strings.TrimSpace(in.RiskLevel)
	in.PlannedStartAt = strings.TrimSpace(in.PlannedStartAt)
	in.PlannedEndAt = strings.TrimSpace(in.PlannedEndAt)

	if in.Title == "" || in.TargetCIUID == "" {
		return ErrInvalidInput
	}
	if len(in.Title) > 160 || len(in.Description) > 1024 || len(in.TargetCIUID) > 64 {
		return ErrInvalidInput
	}
	if in.RiskLevel == "" {
		in.RiskLevel = "medium"
	}
	if !allowedChangeRisk(in.RiskLevel) {
		return ErrInvalidInput
	}
	return nil
}

func allowedChangeRisk(v string) bool {
	switch v {
	case "low", "medium", "high":
		return true
	default:
		return false
	}
}

func allowedChangeStatus(v string) bool {
	switch v {
	case "pending_approval", "approved", "rejected", "completed", "rolled_back", "cancelled":
		return true
	default:
		return false
	}
}

func parseOptionalDateTime(value string) (*time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}

	layouts := []string{
		time.RFC3339,
		"2006-01-02T15:04",
		"2006-01-02 15:04",
		"2006-01-02 15:04:05",
	}
	for _, layout := range layouts {
		var (
			t   time.Time
			err error
		)
		if strings.Contains(layout, "Z07") {
			t, err = time.Parse(layout, value)
		} else {
			t, err = time.ParseInLocation(layout, value, time.Local)
		}
		if err == nil {
			return &t, nil
		}
	}
	return nil, ErrInvalidInput
}

func toChangeRequestResult(row repository.ChangeRequestRow) ChangeRequestResult {
	return ChangeRequestResult{
		ChangeUID:       row.ChangeUID,
		Title:           row.Title,
		Description:     row.Description,
		TargetCIUID:     row.TargetCIUID,
		TargetCIName:    row.TargetCIName,
		RiskLevel:       row.RiskLevel,
		Status:          row.Status,
		RequestedBySub:  row.RequestedBySub,
		RequestedByName: row.RequestedByName,
		ApprovedBySub:   row.ApprovedBySub,
		ApprovedByName:  row.ApprovedByName,
		ExecutedBySub:   row.ExecutedBySub,
		ExecutedByName:  row.ExecutedByName,
		RollbackBySub:   row.RollbackBySub,
		RollbackByName:  row.RollbackByName,
		ApprovalComment: row.ApprovalComment,
		ExecutionNote:   row.ExecutionNote,
		RollbackNote:    row.RollbackNote,
		PlannedStartAt:  row.PlannedStartAt,
		PlannedEndAt:    row.PlannedEndAt,
		Version:         row.Version,
		CreatedAt:       row.CreatedAt,
		UpdatedAt:       row.UpdatedAt,
	}
}

func toChangeStepLogResults(rows []repository.ChangeStepLogRow) []ChangeStepLogResult {
	result := make([]ChangeStepLogResult, 0, len(rows))
	for _, row := range rows {
		item := ChangeStepLogResult{
			ID:           row.ID,
			Action:       row.Action,
			FromStatus:   row.FromStatus,
			ToStatus:     row.ToStatus,
			OperatorSub:  row.OperatorSub,
			OperatorName: row.OperatorName,
			CommentText:  row.CommentText,
			CreatedAt:    row.CreatedAt,
		}
		if strings.TrimSpace(row.MetadataRaw) != "" {
			meta := map[string]any{}
			if err := json.Unmarshal([]byte(row.MetadataRaw), &meta); err == nil && len(meta) > 0 {
				item.Metadata = meta
			}
		}
		result = append(result, item)
	}
	return result
}

func mustJSON(v any) []byte {
	data, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	return data
}
