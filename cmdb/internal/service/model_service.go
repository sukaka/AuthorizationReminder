package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"cmdb/internal/repository"
	"github.com/oklog/ulid/v2"
)

type ModelService struct {
	repo *repository.CIRepository
}

type CreateModelInput struct {
	Name        string
	CITypeKey   string
	Icon        string
	Description string
}

type ModelTemplateResult struct {
	ModelUID      string    `json:"model_uid"`
	Name          string    `json:"name"`
	CITypeKey     string    `json:"ci_type_key"`
	CITypeName    string    `json:"ci_type_name"`
	Icon          string    `json:"icon"`
	Description   string    `json:"description"`
	InstanceCount int64     `json:"instance_count"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type CreateModelFieldInput struct {
	ModelUID        string
	FieldKey        string
	FieldLabel      string
	DataType        string
	Required        bool
	HasDefaultValue bool
	DefaultValue    any
}

type ModelFieldRuleResult struct {
	FieldUID     string    `json:"field_uid"`
	ModelUID     string    `json:"model_uid"`
	CITypeKey    string    `json:"ci_type_key"`
	CITypeName   string    `json:"ci_type_name"`
	FieldKey     string    `json:"field_key"`
	FieldLabel   string    `json:"field_label"`
	DataType     string    `json:"data_type"`
	Required     bool      `json:"required"`
	DefaultValue any       `json:"default_value,omitempty"`
	HasDefault   bool      `json:"has_default"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func NewModelService(repo *repository.CIRepository) *ModelService {
	return &ModelService{repo: repo}
}

func (s *ModelService) ListModels(ctx context.Context) ([]ModelTemplateResult, error) {
	rows, err := s.repo.ListModelTemplates(ctx)
	if err != nil {
		return nil, err
	}
	result := make([]ModelTemplateResult, 0, len(rows))
	for _, row := range rows {
		result = append(result, toModelTemplateResult(row))
	}
	return result, nil
}

func (s *ModelService) CreateModel(ctx context.Context, in CreateModelInput) (*ModelTemplateResult, error) {
	if err := validateCreateModelInput(&in); err != nil {
		return nil, err
	}

	typeID, err := s.repo.GetTypeIDByKey(ctx, in.CITypeKey)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return nil, fmt.Errorf("%w: unknown ci_type_key", ErrInvalidInput)
		}
		return nil, err
	}

	row, err := s.repo.InsertModelTemplate(ctx, repository.CreateModelTemplateParams{
		ModelUID:    ulid.Make().String(),
		Name:        in.Name,
		CITypeID:    typeID,
		Icon:        in.Icon,
		Description: in.Description,
	})
	if err != nil {
		if errors.Is(err, repository.ErrDuplicateKey) {
			return nil, fmt.Errorf("%w: model name already exists", ErrConflict)
		}
		return nil, err
	}

	result := toModelTemplateResult(*row)
	return &result, nil
}

func (s *ModelService) DeleteModel(ctx context.Context, modelUID string) error {
	modelUID = strings.TrimSpace(modelUID)
	if modelUID == "" {
		return ErrInvalidInput
	}

	err := s.repo.SoftDeleteModelTemplate(ctx, modelUID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return ErrNotFound
		}
		return err
	}
	return nil
}

func (s *ModelService) ListModelFields(ctx context.Context, modelUID string) ([]ModelFieldRuleResult, error) {
	modelUID = strings.TrimSpace(modelUID)
	if modelUID == "" {
		return nil, ErrInvalidInput
	}

	model, err := s.repo.GetModelTemplateByUID(ctx, modelUID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return nil, ErrNotFound
		}
		return nil, err
	}

	rows, err := s.repo.ListModelFieldRulesByTypeID(ctx, model.CITypeID)
	if err != nil {
		return nil, err
	}

	result := make([]ModelFieldRuleResult, 0, len(rows))
	for _, row := range rows {
		result = append(result, toModelFieldRuleResult(modelUID, row))
	}
	return result, nil
}

func (s *ModelService) CreateModelField(ctx context.Context, in CreateModelFieldInput) (*ModelFieldRuleResult, error) {
	if err := validateCreateModelFieldInput(&in); err != nil {
		return nil, err
	}

	model, err := s.repo.GetModelTemplateByUID(ctx, in.ModelUID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return nil, ErrNotFound
		}
		return nil, err
	}

	defaultValueRaw := ""
	if in.HasDefaultValue {
		if !isModelFieldValueType(in.DataType, in.DefaultValue) {
			return nil, fmt.Errorf("%w: default_value type mismatch", ErrInvalidInput)
		}
		data, err := json.Marshal(in.DefaultValue)
		if err != nil {
			return nil, fmt.Errorf("%w: invalid default_value", ErrInvalidInput)
		}
		defaultValueRaw = string(data)
	}

	row, err := s.repo.InsertModelFieldRule(ctx, repository.CreateModelFieldRuleParams{
		FieldUID:        ulid.Make().String(),
		CITypeID:        model.CITypeID,
		FieldKey:        in.FieldKey,
		FieldLabel:      in.FieldLabel,
		DataType:        in.DataType,
		Required:        in.Required,
		DefaultValueRaw: defaultValueRaw,
	})
	if err != nil {
		if errors.Is(err, repository.ErrDuplicateKey) {
			return nil, fmt.Errorf("%w: field_key already exists", ErrConflict)
		}
		return nil, err
	}

	result := toModelFieldRuleResult(model.ModelUID, *row)
	return &result, nil
}

func (s *ModelService) DeleteModelField(ctx context.Context, fieldUID string) error {
	fieldUID = strings.TrimSpace(fieldUID)
	if fieldUID == "" {
		return ErrInvalidInput
	}

	if err := s.repo.SoftDeleteModelFieldRule(ctx, fieldUID); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return ErrNotFound
		}
		return err
	}
	return nil
}

func validateCreateModelInput(in *CreateModelInput) error {
	in.Name = strings.TrimSpace(in.Name)
	in.CITypeKey = strings.TrimSpace(in.CITypeKey)
	in.Icon = strings.TrimSpace(in.Icon)
	in.Description = strings.TrimSpace(in.Description)

	if in.Name == "" || in.CITypeKey == "" {
		return ErrInvalidInput
	}
	if len(in.Name) > 128 || len(in.Description) > 255 || len(in.Icon) > 8 || len(in.CITypeKey) > 64 {
		return ErrInvalidInput
	}
	return nil
}

func validateCreateModelFieldInput(in *CreateModelFieldInput) error {
	in.ModelUID = strings.TrimSpace(in.ModelUID)
	in.FieldKey = strings.TrimSpace(in.FieldKey)
	in.FieldLabel = strings.TrimSpace(in.FieldLabel)
	in.DataType = strings.ToLower(strings.TrimSpace(in.DataType))

	if in.ModelUID == "" || in.FieldKey == "" || in.FieldLabel == "" {
		return ErrInvalidInput
	}
	if !allowedModelFieldDataType(in.DataType) {
		return ErrInvalidInput
	}
	if len(in.FieldKey) > 64 || len(in.FieldLabel) > 128 {
		return ErrInvalidInput
	}
	return nil
}

func allowedModelFieldDataType(value string) bool {
	switch value {
	case "string", "number", "boolean", "object", "array":
		return true
	default:
		return false
	}
}

func isModelFieldValueType(dataType string, value any) bool {
	switch dataType {
	case "string":
		_, ok := value.(string)
		return ok
	case "number":
		switch v := value.(type) {
		case float64:
			return !math.IsNaN(v) && !math.IsInf(v, 0)
		case float32:
			f := float64(v)
			return !math.IsNaN(f) && !math.IsInf(f, 0)
		case int, int8, int16, int32, int64:
			return true
		case uint, uint8, uint16, uint32, uint64:
			return true
		case json.Number:
			_, err := v.Float64()
			return err == nil
		default:
			return false
		}
	case "boolean":
		_, ok := value.(bool)
		return ok
	case "object":
		if value == nil {
			return false
		}
		switch value.(type) {
		case map[string]any:
			return true
		default:
			return false
		}
	case "array":
		if value == nil {
			return false
		}
		switch value.(type) {
		case []any:
			return true
		default:
			return false
		}
	default:
		return false
	}
}

func toModelTemplateResult(row repository.ModelTemplateRow) ModelTemplateResult {
	return ModelTemplateResult{
		ModelUID:      row.ModelUID,
		Name:          row.Name,
		CITypeKey:     row.CITypeKey,
		CITypeName:    row.CITypeName,
		Icon:          row.Icon,
		Description:   row.Description,
		InstanceCount: row.InstanceCount,
		CreatedAt:     row.CreatedAt,
		UpdatedAt:     row.UpdatedAt,
	}
}

func toModelFieldRuleResult(modelUID string, row repository.ModelFieldRuleRow) ModelFieldRuleResult {
	result := ModelFieldRuleResult{
		FieldUID:   row.FieldUID,
		ModelUID:   modelUID,
		CITypeKey:  row.CITypeKey,
		CITypeName: row.CITypeName,
		FieldKey:   row.FieldKey,
		FieldLabel: row.FieldLabel,
		DataType:   row.DataType,
		Required:   row.Required,
		CreatedAt:  row.CreatedAt,
		UpdatedAt:  row.UpdatedAt,
	}
	if strings.TrimSpace(row.DefaultValueRaw) == "" {
		return result
	}
	var parsed any
	if err := json.Unmarshal([]byte(row.DefaultValueRaw), &parsed); err == nil {
		result.HasDefault = true
		result.DefaultValue = parsed
	}
	return result
}
