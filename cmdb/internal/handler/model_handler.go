package handler

import (
	"encoding/json"
	"net/http"

	"cmdb/internal/service"
	"github.com/gin-gonic/gin"
)

type ModelHandler struct {
	modelSvc *service.ModelService
}

type createModelRequest struct {
	Name        string `json:"name" binding:"required"`
	CITypeKey   string `json:"ci_type_key" binding:"required"`
	Icon        string `json:"icon"`
	Description string `json:"description"`
}

type createModelFieldRequest struct {
	FieldKey     string `json:"field_key" binding:"required"`
	FieldLabel   string `json:"field_label" binding:"required"`
	DataType     string `json:"data_type" binding:"required"`
	Required     bool   `json:"required"`
	DefaultValue any    `json:"default_value"`
}

func NewModelHandler(modelSvc *service.ModelService) *ModelHandler {
	return &ModelHandler{modelSvc: modelSvc}
}

func (h *ModelHandler) ListModels(c *gin.Context) {
	items, err := h.modelSvc.ListModels(c.Request.Context())
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *ModelHandler) CreateModel(c *gin.Context) {
	var req createModelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	item, err := h.modelSvc.CreateModel(c.Request.Context(), service.CreateModelInput{
		Name:        req.Name,
		CITypeKey:   req.CITypeKey,
		Icon:        req.Icon,
		Description: req.Description,
	})
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusCreated, item)
}

func (h *ModelHandler) DeleteModel(c *gin.Context) {
	if err := h.modelSvc.DeleteModel(c.Request.Context(), c.Param("model_uid")); err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

func (h *ModelHandler) ListModelFields(c *gin.Context) {
	items, err := h.modelSvc.ListModelFields(c.Request.Context(), c.Param("model_uid"))
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *ModelHandler) CreateModelField(c *gin.Context) {
	var raw map[string]any
	if err := c.ShouldBindJSON(&raw); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	body, err := json.Marshal(raw)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	var req createModelFieldRequest
	if err := json.Unmarshal(body, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	item, err := h.modelSvc.CreateModelField(c.Request.Context(), service.CreateModelFieldInput{
		ModelUID:        c.Param("model_uid"),
		FieldKey:        req.FieldKey,
		FieldLabel:      req.FieldLabel,
		DataType:        req.DataType,
		Required:        req.Required,
		HasDefaultValue: hasKey(raw, "default_value"),
		DefaultValue:    req.DefaultValue,
	})
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusCreated, item)
}

func (h *ModelHandler) DeleteModelField(c *gin.Context) {
	if err := h.modelSvc.DeleteModelField(c.Request.Context(), c.Param("field_uid")); err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}
