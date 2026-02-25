package service

import (
	"context"
	"strings"
	"time"

	"cmdb/internal/repository"
)

type AuditService struct {
	repo *repository.CIRepository
}

type AuditListInput struct {
	ActorSub     string
	ActorName    string
	Action       string
	ResourceType string
	ResourceUID  string
	HTTPMethod   string
	Result       string
	SourceIP     string
	Keyword      string
	DateFrom     string
	DateTo       string
	Page         int
	PageSize     int
}

type AuditLogItemResult struct {
	ID           uint64    `json:"id"`
	RequestID    string    `json:"request_id"`
	ActorSub     string    `json:"actor_sub"`
	ActorName    string    `json:"actor_name"`
	Action       string    `json:"action"`
	ResourceType string    `json:"resource_type"`
	ResourceUID  string    `json:"resource_uid"`
	HTTPMethod   string    `json:"http_method"`
	HTTPPath     string    `json:"http_path"`
	StatusCode   int       `json:"status_code"`
	Result       string    `json:"result"`
	ErrorMessage string    `json:"error_message"`
	SourceIP     string    `json:"source_ip"`
	CreatedAt    time.Time `json:"created_at"`
}

type AuditListResult struct {
	Items    []AuditLogItemResult `json:"items"`
	Total    int64                `json:"total"`
	Page     int                  `json:"page"`
	PageSize int                  `json:"page_size"`
}

func NewAuditService(repo *repository.CIRepository) *AuditService {
	return &AuditService{repo: repo}
}

func (s *AuditService) ListAuditLogs(ctx context.Context, in AuditListInput) (*AuditListResult, error) {
	params, err := normalizeAuditQuery(in)
	if err != nil {
		return nil, err
	}

	rows, total, err := s.repo.ListOperationAudit(ctx, params)
	if err != nil {
		return nil, err
	}

	items := make([]AuditLogItemResult, 0, len(rows))
	for _, row := range rows {
		items = append(items, mapAuditRowToResult(row))
	}

	return &AuditListResult{
		Items:    items,
		Total:    total,
		Page:     params.Page,
		PageSize: params.PageSize,
	}, nil
}

func (s *AuditService) ListAuditLogsForExport(ctx context.Context, in AuditListInput, limit int) ([]AuditLogItemResult, error) {
	params, err := normalizeAuditQuery(in)
	if err != nil {
		return nil, err
	}
	rows, err := s.repo.ListOperationAuditForExport(ctx, params, limit)
	if err != nil {
		return nil, err
	}

	items := make([]AuditLogItemResult, 0, len(rows))
	for _, row := range rows {
		items = append(items, mapAuditRowToResult(row))
	}
	return items, nil
}

func mapAuditRowToResult(row repository.AuditLogRow) AuditLogItemResult {
	return AuditLogItemResult{
		ID:           row.ID,
		RequestID:    row.RequestID,
		ActorSub:     row.ActorSub,
		ActorName:    row.ActorName,
		Action:       row.Action,
		ResourceType: row.ResourceType,
		ResourceUID:  row.ResourceUID,
		HTTPMethod:   row.HTTPMethod,
		HTTPPath:     row.HTTPPath,
		StatusCode:   row.StatusCode,
		Result:       row.Result,
		ErrorMessage: row.ErrorMessage,
		SourceIP:     row.SourceIP,
		CreatedAt:    row.CreatedAt,
	}
}

func normalizeAuditQuery(in AuditListInput) (repository.AuditListParams, error) {
	out := repository.AuditListParams{
		ActorSub:     strings.TrimSpace(in.ActorSub),
		ActorName:    strings.TrimSpace(in.ActorName),
		Action:       strings.TrimSpace(in.Action),
		ResourceType: strings.TrimSpace(in.ResourceType),
		ResourceUID:  strings.TrimSpace(in.ResourceUID),
		HTTPMethod:   strings.ToUpper(strings.TrimSpace(in.HTTPMethod)),
		Result:       strings.ToLower(strings.TrimSpace(in.Result)),
		SourceIP:     strings.TrimSpace(in.SourceIP),
		Keyword:      strings.TrimSpace(in.Keyword),
		Page:         in.Page,
		PageSize:     in.PageSize,
	}

	if out.Page < 1 {
		out.Page = 1
	}
	if out.PageSize <= 0 {
		out.PageSize = 20
	}
	if out.PageSize > 200 {
		out.PageSize = 200
	}
	if out.Result != "" && out.Result != "success" && out.Result != "failed" {
		return repository.AuditListParams{}, ErrInvalidInput
	}

	fromAt, err := parseAuditDateStart(strings.TrimSpace(in.DateFrom))
	if err != nil {
		return repository.AuditListParams{}, ErrInvalidInput
	}
	toAt, err := parseAuditDateEnd(strings.TrimSpace(in.DateTo))
	if err != nil {
		return repository.AuditListParams{}, ErrInvalidInput
	}
	if fromAt != nil {
		out.DateFrom = fromAt
	}
	if toAt != nil {
		out.DateTo = toAt
	}
	if out.DateFrom != nil && out.DateTo != nil && !out.DateFrom.Before(*out.DateTo) {
		return repository.AuditListParams{}, ErrInvalidInput
	}

	return out, nil
}

func parseAuditDateStart(text string) (*time.Time, error) {
	if text == "" {
		return nil, nil
	}
	if len(text) == 10 {
		parsed, err := time.ParseInLocation("2006-01-02", text, time.Local)
		if err != nil {
			return nil, err
		}
		return &parsed, nil
	}
	parsed, err := time.Parse(time.RFC3339, text)
	if err != nil {
		return nil, err
	}
	return &parsed, nil
}

func parseAuditDateEnd(text string) (*time.Time, error) {
	if text == "" {
		return nil, nil
	}
	if len(text) == 10 {
		parsed, err := time.ParseInLocation("2006-01-02", text, time.Local)
		if err != nil {
			return nil, err
		}
		next := parsed.AddDate(0, 0, 1)
		return &next, nil
	}
	parsed, err := time.Parse(time.RFC3339, text)
	if err != nil {
		return nil, err
	}
	return &parsed, nil
}
