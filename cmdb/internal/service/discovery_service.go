package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"cmdb/internal/repository"
	"github.com/oklog/ulid/v2"
)

type DiscoveryService struct {
	repo  *repository.CIRepository
	ciSvc *CIService
}

type CreateDiscoveryTaskInput struct {
	Name          string
	CITypeKey     string
	TaskMode      string
	SourceType    string
	EndpointURL   string
	SyncMode      string
	RequestMethod string
	Owner         string
	ScheduleText  string
	BatchSize     int
}

type DiscoveryTaskResult struct {
	TaskUID       string     `json:"task_uid"`
	Name          string     `json:"name"`
	CITypeKey     string     `json:"ci_type_key"`
	CITypeName    string     `json:"ci_type_name"`
	TaskMode      string     `json:"task_mode"`
	SourceType    string     `json:"source_type"`
	EndpointURL   string     `json:"endpoint_url,omitempty"`
	SyncMode      string     `json:"sync_mode"`
	RequestMethod string     `json:"request_method"`
	Owner         string     `json:"owner"`
	ScheduleText  string     `json:"schedule_text"`
	BatchSize     int        `json:"batch_size"`
	Enabled       bool       `json:"enabled"`
	LastRunAt     *time.Time `json:"last_run_at,omitempty"`
	LastStatus    string     `json:"last_status,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

type DiscoveryRunLogResult struct {
	RunUID       string    `json:"run_uid"`
	TaskUID      string    `json:"task_uid"`
	TaskName     string    `json:"task_name"`
	CITypeKey    string    `json:"ci_type_key"`
	CITypeName   string    `json:"ci_type_name"`
	Status       string    `json:"status"`
	SuccessCount int       `json:"success_count"`
	CreatedCount int       `json:"created_count"`
	UpdatedCount int       `json:"updated_count"`
	FailedCount  int       `json:"failed_count"`
	ErrorMessage string    `json:"error_message,omitempty"`
	StartedAt    time.Time `json:"started_at"`
	FinishedAt   time.Time `json:"finished_at"`
	CreatedAt    time.Time `json:"created_at"`
}

type RunDiscoveryResult struct {
	TaskUID      string    `json:"task_uid"`
	TaskName     string    `json:"task_name"`
	Status       string    `json:"status"`
	SuccessCount int       `json:"success_count"`
	CreatedCount int       `json:"created_count"`
	UpdatedCount int       `json:"updated_count"`
	FailedCount  int       `json:"failed_count"`
	StartedAt    time.Time `json:"started_at"`
	FinishedAt   time.Time `json:"finished_at"`
}

type RunEnabledDiscoverySummary struct {
	TotalTasks   int                  `json:"total_tasks"`
	SuccessCount int                  `json:"success_count"`
	CreatedCount int                  `json:"created_count"`
	UpdatedCount int                  `json:"updated_count"`
	FailedCount  int                  `json:"failed_count"`
	Results      []RunDiscoveryResult `json:"results"`
}

type discoveryRecord struct {
	UniqueKey  string
	Name       string
	Status     string
	Owner      string
	SourceRef  string
	ExtraAttrs map[string]any
}

func NewDiscoveryService(repo *repository.CIRepository, ciSvc *CIService) *DiscoveryService {
	return &DiscoveryService{
		repo:  repo,
		ciSvc: ciSvc,
	}
}

func (s *DiscoveryService) ListTasks(ctx context.Context) ([]DiscoveryTaskResult, error) {
	rows, err := s.repo.ListDiscoveryTasks(ctx)
	if err != nil {
		return nil, err
	}
	result := make([]DiscoveryTaskResult, 0, len(rows))
	for _, row := range rows {
		result = append(result, toDiscoveryTaskResult(row))
	}
	return result, nil
}

func (s *DiscoveryService) CreateTask(ctx context.Context, in CreateDiscoveryTaskInput) (*DiscoveryTaskResult, error) {
	if err := validateCreateDiscoveryTaskInput(&in); err != nil {
		return nil, err
	}

	typeID, err := s.repo.GetTypeIDByKey(ctx, in.CITypeKey)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return nil, fmt.Errorf("%w: unknown ci_type_key", ErrInvalidInput)
		}
		return nil, err
	}

	row, err := s.repo.InsertDiscoveryTask(ctx, repository.CreateDiscoveryTaskParams{
		TaskUID:       ulid.Make().String(),
		Name:          in.Name,
		CITypeID:      typeID,
		TaskMode:      in.TaskMode,
		SourceType:    in.SourceType,
		EndpointURL:   in.EndpointURL,
		SyncMode:      in.SyncMode,
		RequestMethod: in.RequestMethod,
		Owner:         in.Owner,
		ScheduleText:  in.ScheduleText,
		BatchSize:     in.BatchSize,
		Enabled:       true,
	})
	if err != nil {
		if errors.Is(err, repository.ErrDuplicateKey) {
			return nil, fmt.Errorf("%w: discovery task name already exists", ErrConflict)
		}
		return nil, err
	}

	result := toDiscoveryTaskResult(*row)
	return &result, nil
}

func (s *DiscoveryService) UpdateTaskEnabled(ctx context.Context, taskUID string, enabled bool) (*DiscoveryTaskResult, error) {
	taskUID = strings.TrimSpace(taskUID)
	if taskUID == "" {
		return nil, ErrInvalidInput
	}

	row, err := s.repo.UpdateDiscoveryTaskEnabled(ctx, taskUID, enabled)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return nil, ErrNotFound
		}
		return nil, err
	}

	result := toDiscoveryTaskResult(*row)
	return &result, nil
}

func (s *DiscoveryService) DeleteTask(ctx context.Context, taskUID string) error {
	taskUID = strings.TrimSpace(taskUID)
	if taskUID == "" {
		return ErrInvalidInput
	}
	err := s.repo.SoftDeleteDiscoveryTask(ctx, taskUID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return ErrNotFound
		}
		return err
	}
	return nil
}

func (s *DiscoveryService) ListLogs(ctx context.Context, limit int) ([]DiscoveryRunLogResult, error) {
	rows, err := s.repo.ListDiscoveryRunLogs(ctx, limit)
	if err != nil {
		return nil, err
	}
	result := make([]DiscoveryRunLogResult, 0, len(rows))
	for _, row := range rows {
		result = append(result, toDiscoveryRunLogResult(row))
	}
	return result, nil
}

func (s *DiscoveryService) RunTask(ctx context.Context, taskUID string, op Operator) (*RunDiscoveryResult, error) {
	taskUID = strings.TrimSpace(taskUID)
	if taskUID == "" {
		return nil, ErrInvalidInput
	}

	task, err := s.repo.GetDiscoveryTaskByUID(ctx, taskUID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return nil, ErrNotFound
		}
		return nil, err
	}

	result, err := s.runTaskRow(ctx, *task, op)
	if err != nil {
		return nil, err
	}
	return &result, nil
}

func (s *DiscoveryService) RunEnabledTasks(ctx context.Context, op Operator) (*RunEnabledDiscoverySummary, error) {
	tasks, err := s.repo.ListEnabledDiscoveryTasks(ctx)
	if err != nil {
		return nil, err
	}
	if len(tasks) == 0 {
		return &RunEnabledDiscoverySummary{
			TotalTasks: 0,
			Results:    []RunDiscoveryResult{},
		}, nil
	}

	summary := &RunEnabledDiscoverySummary{
		TotalTasks: len(tasks),
		Results:    make([]RunDiscoveryResult, 0, len(tasks)),
	}
	for _, task := range tasks {
		result, err := s.runTaskRow(ctx, task, op)
		if err != nil {
			return nil, err
		}
		summary.SuccessCount += result.SuccessCount
		summary.CreatedCount += result.CreatedCount
		summary.UpdatedCount += result.UpdatedCount
		summary.FailedCount += result.FailedCount
		summary.Results = append(summary.Results, result)
	}
	return summary, nil
}

func (s *DiscoveryService) runTaskRow(ctx context.Context, task repository.DiscoveryTaskRow, op Operator) (RunDiscoveryResult, error) {
	prepareOperator(&op)

	startedAt := time.Now()
	runUID := ulid.Make().String()

	rules, err := s.repo.ListModelFieldRulesByTypeID(ctx, task.CITypeID)
	if err != nil {
		return RunDiscoveryResult{}, err
	}

	recordItems, sourceErr := s.loadTaskRecords(ctx, task, runUID)

	successCount := 0
	createdCount := 0
	updatedCount := 0
	failedCount := 0
	errorMessages := make([]string, 0, 8)
	if sourceErr != nil {
		failedCount = 1
		errorMessages = append(errorMessages, sourceErr.Error())
	}

	for i, item := range recordItems {
		record, err := normalizeDiscoveryRecord(task, runUID, i, item, rules)
		if err != nil {
			failedCount++
			if len(errorMessages) < 5 {
				errorMessages = append(errorMessages, err.Error())
			}
			continue
		}

		created, err := s.persistDiscoveryRecord(ctx, task, record, op)
		if err != nil {
			failedCount++
			if len(errorMessages) < 5 {
				errorMessages = append(errorMessages, err.Error())
			}
			continue
		}

		successCount++
		if created {
			createdCount++
		} else {
			updatedCount++
		}
	}

	status := "success"
	if failedCount > 0 && successCount > 0 {
		status = "partial"
	}
	if failedCount > 0 && successCount == 0 {
		status = "failed"
	}

	finishedAt := time.Now()
	_ = s.repo.UpdateDiscoveryTaskRunResult(ctx, repository.UpdateDiscoveryTaskRunResultParams{
		TaskUID:    task.TaskUID,
		LastRunAt:  finishedAt,
		LastStatus: status,
	})

	joinedError := strings.Join(errorMessages, "; ")
	if len(joinedError) > 255 {
		joinedError = joinedError[:255]
	}
	if err := s.repo.InsertDiscoveryRunLog(ctx, repository.InsertDiscoveryRunLogParams{
		RunUID:       runUID,
		TaskID:       task.ID,
		TaskUID:      task.TaskUID,
		TaskName:     task.Name,
		CITypeID:     task.CITypeID,
		Status:       status,
		SuccessCount: successCount,
		CreatedCount: createdCount,
		UpdatedCount: updatedCount,
		FailedCount:  failedCount,
		ErrorMessage: joinedError,
		StartedAt:    startedAt,
		FinishedAt:   finishedAt,
	}); err != nil {
		return RunDiscoveryResult{}, err
	}

	return RunDiscoveryResult{
		TaskUID:      task.TaskUID,
		TaskName:     task.Name,
		Status:       status,
		SuccessCount: successCount,
		CreatedCount: createdCount,
		UpdatedCount: updatedCount,
		FailedCount:  failedCount,
		StartedAt:    startedAt,
		FinishedAt:   finishedAt,
	}, nil
}

func (s *DiscoveryService) persistDiscoveryRecord(ctx context.Context, task repository.DiscoveryTaskRow, record discoveryRecord, op Operator) (bool, error) {
	source := discoverySourceByMode(task.TaskMode)
	if task.SyncMode == "create_only" {
		_, err := s.ciSvc.CreateCI(ctx, CreateCIInput{
			CITypeKey:  task.CITypeKey,
			Name:       record.Name,
			UniqueKey:  record.UniqueKey,
			Status:     record.Status,
			Owner:      record.Owner,
			Source:     source,
			SourceRef:  record.SourceRef,
			ExtraAttrs: record.ExtraAttrs,
		}, op)
		if err != nil {
			return false, err
		}
		return true, nil
	}

	existing, err := s.repo.GetByTypeAndUniqueKey(ctx, task.CITypeID, record.UniqueKey)
	if err != nil && !errors.Is(err, repository.ErrNotFound) {
		return false, err
	}
	if errors.Is(err, repository.ErrNotFound) || existing == nil {
		_, createErr := s.ciSvc.CreateCI(ctx, CreateCIInput{
			CITypeKey:  task.CITypeKey,
			Name:       record.Name,
			UniqueKey:  record.UniqueKey,
			Status:     record.Status,
			Owner:      record.Owner,
			Source:     source,
			SourceRef:  record.SourceRef,
			ExtraAttrs: record.ExtraAttrs,
		}, op)
		if createErr != nil {
			return false, createErr
		}
		return true, nil
	}

	name := record.Name
	status := record.Status
	owner := record.Owner
	sourceRef := record.SourceRef
	_, updateErr := s.ciSvc.UpdateCI(ctx, UpdateCIInput{
		CIUID:         existing.CIUID,
		Version:       existing.Version,
		Name:          &name,
		Status:        &status,
		Owner:         &owner,
		SourceRef:     &sourceRef,
		HasExtraAttrs: true,
		ExtraAttrs:    record.ExtraAttrs,
	}, op)
	if updateErr == nil {
		return false, nil
	}
	if !errors.Is(updateErr, ErrConflict) {
		return false, updateErr
	}

	latest, latestErr := s.repo.GetByTypeAndUniqueKey(ctx, task.CITypeID, record.UniqueKey)
	if latestErr != nil {
		return false, latestErr
	}
	if latest == nil {
		return false, updateErr
	}
	_, retryErr := s.ciSvc.UpdateCI(ctx, UpdateCIInput{
		CIUID:         latest.CIUID,
		Version:       latest.Version,
		Name:          &name,
		Status:        &status,
		Owner:         &owner,
		SourceRef:     &sourceRef,
		HasExtraAttrs: true,
		ExtraAttrs:    record.ExtraAttrs,
	}, op)
	if retryErr != nil {
		return false, retryErr
	}
	return false, nil
}

func (s *DiscoveryService) loadTaskRecords(ctx context.Context, task repository.DiscoveryTaskRow, runUID string) ([]map[string]any, error) {
	if task.SourceType == "http" {
		return s.loadHTTPDiscoveryRecords(ctx, task)
	}
	return s.loadMockDiscoveryRecords(task, runUID), nil
}

func (s *DiscoveryService) loadMockDiscoveryRecords(task repository.DiscoveryTaskRow, runUID string) []map[string]any {
	batchSize := task.BatchSize
	if batchSize < 1 {
		batchSize = 1
	}
	if batchSize > 50 {
		batchSize = 50
	}

	items := make([]map[string]any, 0, batchSize)
	for i := 0; i < batchSize; i++ {
		index := i + 1
		item := map[string]any{
			"id":            fmt.Sprintf("%s-%02d", runUID, index),
			"unique_key":    fmt.Sprintf("discover-%s-%02d", task.TaskUID, index),
			"name":          fmt.Sprintf("%s-发现资产-%d", task.Name, index),
			"status":        "active",
			"owner":         firstNonEmptyText(task.Owner, "CMDB平台"),
			"source_ref":    fmt.Sprintf("%s:%s", task.TaskUID, runUID),
			"discovered_at": time.Now().Format(time.RFC3339),
		}
		items = append(items, item)
	}
	return items
}

func (s *DiscoveryService) loadHTTPDiscoveryRecords(ctx context.Context, task repository.DiscoveryTaskRow) ([]map[string]any, error) {
	if strings.TrimSpace(task.EndpointURL) == "" {
		return nil, fmt.Errorf("endpoint_url is required for http source")
	}

	method := strings.ToUpper(strings.TrimSpace(task.RequestMethod))
	if method == "" {
		method = "GET"
	}

	var reqBody io.Reader
	if method == http.MethodPost {
		payload, _ := json.Marshal(map[string]any{
			"task_uid":    task.TaskUID,
			"task_name":   task.Name,
			"ci_type_key": task.CITypeKey,
			"batch_size":  task.BatchSize,
		})
		reqBody = bytes.NewReader(payload)
	}

	req, err := http.NewRequestWithContext(ctx, method, task.EndpointURL, reqBody)
	if err != nil {
		return nil, err
	}
	if method == http.MethodPost {
		req.Header.Set("Content-Type", "application/json")
	}

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4*1024*1024))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		text := strings.TrimSpace(string(body))
		if len(text) > 160 {
			text = text[:160]
		}
		return nil, fmt.Errorf("http source response %d: %s", resp.StatusCode, text)
	}

	return parseDiscoveryRecordsPayload(body)
}

func validateCreateDiscoveryTaskInput(in *CreateDiscoveryTaskInput) error {
	in.Name = strings.TrimSpace(in.Name)
	in.CITypeKey = strings.TrimSpace(in.CITypeKey)
	in.TaskMode = strings.ToLower(strings.TrimSpace(in.TaskMode))
	in.SourceType = strings.ToLower(strings.TrimSpace(in.SourceType))
	in.EndpointURL = strings.TrimSpace(in.EndpointURL)
	in.SyncMode = strings.ToLower(strings.TrimSpace(in.SyncMode))
	in.RequestMethod = strings.ToUpper(strings.TrimSpace(in.RequestMethod))
	in.Owner = strings.TrimSpace(in.Owner)
	in.ScheduleText = strings.TrimSpace(in.ScheduleText)

	if in.Name == "" || in.CITypeKey == "" {
		return ErrInvalidInput
	}
	if in.TaskMode == "" {
		in.TaskMode = "scan"
	}
	if in.TaskMode != "scan" && in.TaskMode != "cloud" {
		return ErrInvalidInput
	}

	if in.SourceType == "" {
		if in.EndpointURL != "" {
			in.SourceType = "http"
		} else {
			in.SourceType = "mock"
		}
	}
	if in.SourceType != "mock" && in.SourceType != "http" {
		return ErrInvalidInput
	}
	if in.SourceType == "http" {
		if in.EndpointURL == "" {
			return ErrInvalidInput
		}
		u, err := url.Parse(in.EndpointURL)
		if err != nil || u == nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return ErrInvalidInput
		}
	} else {
		in.EndpointURL = ""
	}

	if in.SyncMode == "" {
		in.SyncMode = "upsert"
	}
	if in.SyncMode != "create_only" && in.SyncMode != "upsert" {
		return ErrInvalidInput
	}

	if in.RequestMethod == "" {
		in.RequestMethod = http.MethodGet
	}
	if in.RequestMethod != http.MethodGet && in.RequestMethod != http.MethodPost {
		return ErrInvalidInput
	}

	if in.ScheduleText == "" {
		in.ScheduleText = "每天 02:00"
	}
	if in.BatchSize < 1 {
		in.BatchSize = 1
	}
	if in.BatchSize > 50 {
		in.BatchSize = 50
	}
	if len(in.Name) > 128 || len(in.CITypeKey) > 64 || len(in.Owner) > 128 || len(in.ScheduleText) > 64 || len(in.EndpointURL) > 255 {
		return ErrInvalidInput
	}
	return nil
}

func toDiscoveryTaskResult(row repository.DiscoveryTaskRow) DiscoveryTaskResult {
	return DiscoveryTaskResult{
		TaskUID:       row.TaskUID,
		Name:          row.Name,
		CITypeKey:     row.CITypeKey,
		CITypeName:    row.CITypeName,
		TaskMode:      row.TaskMode,
		SourceType:    row.SourceType,
		EndpointURL:   row.EndpointURL,
		SyncMode:      row.SyncMode,
		RequestMethod: row.RequestMethod,
		Owner:         row.Owner,
		ScheduleText:  row.ScheduleText,
		BatchSize:     row.BatchSize,
		Enabled:       row.Enabled,
		LastRunAt:     row.LastRunAt,
		LastStatus:    row.LastStatus,
		CreatedAt:     row.CreatedAt,
		UpdatedAt:     row.UpdatedAt,
	}
}

func toDiscoveryRunLogResult(row repository.DiscoveryRunLogRow) DiscoveryRunLogResult {
	return DiscoveryRunLogResult{
		RunUID:       row.RunUID,
		TaskUID:      row.TaskUID,
		TaskName:     row.TaskName,
		CITypeKey:    row.CITypeKey,
		CITypeName:   row.CITypeName,
		Status:       row.Status,
		SuccessCount: row.SuccessCount,
		CreatedCount: row.CreatedCount,
		UpdatedCount: row.UpdatedCount,
		FailedCount:  row.FailedCount,
		ErrorMessage: row.ErrorMessage,
		StartedAt:    row.StartedAt,
		FinishedAt:   row.FinishedAt,
		CreatedAt:    row.CreatedAt,
	}
}

func parseDiscoveryRecordsPayload(body []byte) ([]map[string]any, error) {
	text := strings.TrimSpace(string(body))
	if text == "" {
		return []map[string]any{}, nil
	}

	var raw any
	if err := json.Unmarshal([]byte(text), &raw); err != nil {
		return nil, err
	}

	if list, ok := raw.([]any); ok {
		return toRecordMaps(list)
	}
	obj, ok := raw.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("unsupported payload structure")
	}

	for _, key := range []string{"items", "records", "data"} {
		if value, exists := obj[key]; exists {
			if list, ok := value.([]any); ok {
				return toRecordMaps(list)
			}
			return nil, fmt.Errorf("%s should be array", key)
		}
	}

	// 单对象也允许作为一条发现记录
	return []map[string]any{obj}, nil
}

func toRecordMaps(items []any) ([]map[string]any, error) {
	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		obj, ok := item.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("record should be object")
		}
		result = append(result, obj)
	}
	return result, nil
}

func normalizeDiscoveryRecord(task repository.DiscoveryTaskRow, runUID string, index int, item map[string]any, rules []repository.ModelFieldRuleRow) (discoveryRecord, error) {
	if item == nil {
		return discoveryRecord{}, fmt.Errorf("empty record")
	}

	uniqueKey := firstNonEmptyText(
		toTrimmedString(item["unique_key"]),
		toTrimmedString(item["resource_id"]),
		toTrimmedString(item["instance_id"]),
		toTrimmedString(item["id"]),
		toTrimmedString(item["arn"]),
		toTrimmedString(item["uid"]),
	)
	if uniqueKey == "" {
		uniqueKey = fmt.Sprintf("%s-%s-%d", task.TaskUID, runUID, index+1)
	}

	rawStatus := firstNonEmptyText(
		toTrimmedString(item["status"]),
		toTrimmedString(item["state"]),
		toTrimmedString(item["lifecycle_state"]),
	)
	status := normalizeDiscoveryStatus(rawStatus)

	name := firstNonEmptyText(
		toTrimmedString(item["name"]),
		toTrimmedString(item["display_name"]),
		toTrimmedString(item["resource_name"]),
		toTrimmedString(item["hostname"]),
		toTrimmedString(item["instance_name"]),
		uniqueKey,
	)
	owner := firstNonEmptyText(
		toTrimmedString(item["owner"]),
		toTrimmedString(item["team"]),
		toTrimmedString(item["account"]),
		task.Owner,
		"CMDB平台",
	)
	sourceRef := firstNonEmptyText(
		toTrimmedString(item["source_ref"]),
		toTrimmedString(item["resource_id"]),
		toTrimmedString(item["instance_id"]),
		toTrimmedString(item["id"]),
		toTrimmedString(item["arn"]),
		uniqueKey,
	)

	extraAttrs := make(map[string]any, len(item)+8)
	for key, value := range item {
		extraAttrs[key] = value
	}
	extraAttrs["discovery_task_uid"] = task.TaskUID
	extraAttrs["discovery_task_name"] = task.Name
	extraAttrs["discovery_run_uid"] = runUID
	extraAttrs["discovery_task_mode"] = task.TaskMode
	extraAttrs["discovery_source_type"] = task.SourceType
	extraAttrs["discovery_synced_at"] = time.Now().Format(time.RFC3339)
	if rawStatus != "" {
		extraAttrs["discovery_raw_status"] = rawStatus
	}

	fillRequiredAttrsFromRules(extraAttrs, rules)

	return discoveryRecord{
		UniqueKey:  uniqueKey,
		Name:       name,
		Status:     status,
		Owner:      owner,
		SourceRef:  sourceRef,
		ExtraAttrs: extraAttrs,
	}, nil
}

func fillRequiredAttrsFromRules(extraAttrs map[string]any, rules []repository.ModelFieldRuleRow) {
	for _, rule := range rules {
		if !rule.Required {
			continue
		}
		if value, ok := extraAttrs[rule.FieldKey]; ok && value != nil {
			continue
		}
		extraAttrs[rule.FieldKey] = discoveryDefaultByDataType(rule.DataType, rule.FieldKey)
	}
}

func discoveryDefaultByDataType(dataType string, fieldKey string) any {
	switch dataType {
	case "number":
		return float64(0)
	case "boolean":
		return false
	case "object":
		return map[string]any{}
	case "array":
		return []any{}
	default:
		key := strings.TrimSpace(fieldKey)
		if key == "" {
			key = "value"
		}
		return "auto-" + key
	}
}

func toTrimmedString(value any) string {
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v)
	case json.Number:
		return strings.TrimSpace(v.String())
	case float64, float32, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64, bool:
		return strings.TrimSpace(fmt.Sprintf("%v", v))
	default:
		return ""
	}
}

func normalizeDiscoveryStatus(raw string) string {
	value := strings.ToLower(strings.TrimSpace(raw))
	switch value {
	case "", "active", "running", "up", "ok", "healthy", "available":
		return "active"
	case "inactive", "stopped", "down", "disabled", "offline", "failed":
		return "inactive"
	case "retired", "deleted", "terminated", "archived":
		return "retired"
	default:
		return "active"
	}
}

func discoverySourceByMode(taskMode string) string {
	if strings.EqualFold(strings.TrimSpace(taskMode), "cloud") {
		return "cloud"
	}
	return "discovery"
}

func firstNonEmptyText(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
