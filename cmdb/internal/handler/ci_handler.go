package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"cmdb/internal/service"
	"github.com/gin-gonic/gin"
)

type CIHandler struct {
	ciSvc *service.CIService
}

func NewCIHandler(ciSvc *service.CIService) *CIHandler {
	return &CIHandler{ciSvc: ciSvc}
}

type createCIRequest struct {
	CITypeKey  string         `json:"ci_type_key" binding:"required"`
	Name       string         `json:"name" binding:"required"`
	UniqueKey  string         `json:"unique_key" binding:"required"`
	Status     string         `json:"status"`
	Owner      string         `json:"owner"`
	Source     string         `json:"source"`
	SourceRef  string         `json:"source_ref"`
	ExtraAttrs map[string]any `json:"extra_attrs"`
}

type updateCIRequest struct {
	Version    uint32         `json:"version" binding:"required"`
	Name       *string        `json:"name"`
	Status     *string        `json:"status"`
	Owner      *string        `json:"owner"`
	SourceRef  *string        `json:"source_ref"`
	ExtraAttrs map[string]any `json:"extra_attrs"`
}

type upsertRelationRequest struct {
	ToCIUID      string         `json:"to_ci_uid" binding:"required"`
	RelationType string         `json:"relation_type" binding:"required"`
	Attributes   map[string]any `json:"attributes"`
}

type deleteCIRequest struct {
	Version uint32 `json:"version"`
}

func (h *CIHandler) ListCI(c *gin.Context) {
	page, err := strconv.Atoi(strings.TrimSpace(c.DefaultQuery("page", "1")))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid page"})
		return
	}
	pageSize, err := strconv.Atoi(strings.TrimSpace(c.DefaultQuery("page_size", "10")))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid page_size"})
		return
	}

	result, err := h.ciSvc.ListCI(c.Request.Context(), service.ListCIInput{
		CITypeKey: c.Query("ci_type_key"),
		Status:    c.Query("status"),
		Owner:     c.Query("owner"),
		Keyword:   c.Query("keyword"),
		Page:      page,
		PageSize:  pageSize,
	})
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *CIHandler) GetByUID(c *gin.Context) {
	item, err := h.ciSvc.GetByUID(c.Request.Context(), c.Param("ci_uid"))
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h *CIHandler) CreateCI(c *gin.Context) {
	var req createCIRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	result, err := h.ciSvc.CreateCI(c.Request.Context(), service.CreateCIInput{
		CITypeKey:  req.CITypeKey,
		Name:       req.Name,
		UniqueKey:  req.UniqueKey,
		Status:     req.Status,
		Owner:      req.Owner,
		Source:     req.Source,
		SourceRef:  req.SourceRef,
		ExtraAttrs: req.ExtraAttrs,
	}, actorFromRequest(c))
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusCreated, result)
}

func (h *CIHandler) UpdateCI(c *gin.Context) {
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
	var req updateCIRequest
	if err := json.Unmarshal(body, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	result, err := h.ciSvc.UpdateCI(c.Request.Context(), service.UpdateCIInput{
		CIUID:         c.Param("ci_uid"),
		Version:       req.Version,
		Name:          req.Name,
		Status:        req.Status,
		Owner:         req.Owner,
		SourceRef:     req.SourceRef,
		HasExtraAttrs: hasKey(raw, "extra_attrs"),
		ExtraAttrs:    req.ExtraAttrs,
	}, actorFromRequest(c))
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *CIHandler) DeleteCI(c *gin.Context) {
	var req deleteCIRequest

	versionText := strings.TrimSpace(c.Query("version"))
	if versionText != "" {
		parsed, err := strconv.ParseUint(versionText, 10, 32)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid version"})
			return
		}
		req.Version = uint32(parsed)
	} else {
		if err := c.ShouldBindJSON(&req); err != nil || req.Version == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
			return
		}
	}

	result, err := h.ciSvc.DeleteCI(c.Request.Context(), service.DeleteCIInput{
		CIUID:   c.Param("ci_uid"),
		Version: req.Version,
	}, actorFromRequest(c))
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *CIHandler) UpsertRelation(c *gin.Context) {
	var req upsertRelationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	result, err := h.ciSvc.UpsertRelation(c.Request.Context(), service.UpsertRelationInput{
		FromCIUID:    c.Param("ci_uid"),
		ToCIUID:      req.ToCIUID,
		RelationType: req.RelationType,
		Attributes:   req.Attributes,
	}, actorFromRequest(c))
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func actorFromRequest(c *gin.Context) service.Operator {
	requestID := strings.TrimSpace(c.GetHeader("X-Request-Id"))
	if requestID == "" {
		if v, ok := c.Get("request_id"); ok {
			if s, ok := v.(string); ok {
				requestID = s
			}
		}
	}

	roles := make([]string, 0, 4)
	if v, ok := c.Get("actor_roles"); ok {
		if roleList, ok := v.([]string); ok {
			for _, role := range roleList {
				role = strings.TrimSpace(role)
				if role != "" {
					roles = append(roles, role)
				}
			}
		}
	}
	if len(roles) == 0 {
		if v, ok := c.Get("actor_role"); ok {
			if role, ok := v.(string); ok {
				role = strings.TrimSpace(role)
				if role != "" {
					roles = append(roles, role)
				}
			}
		}
	}

	traceID := strings.TrimSpace(c.GetHeader("X-Trace-Id"))
	if traceID == "" {
		traceID = requestID
	}

	sub := ""
	if v, ok := c.Get("actor_sub"); ok {
		switch value := v.(type) {
		case uint64:
			sub = strconv.FormatUint(value, 10)
		case int:
			sub = strconv.Itoa(value)
		case string:
			sub = strings.TrimSpace(value)
		}
	}
	name := ""
	if v, ok := c.Get("actor_name"); ok {
		if value, ok := v.(string); ok {
			name = strings.TrimSpace(value)
		}
	}

	return service.Operator{
		Sub:       sub,
		Name:      name,
		Roles:     roles,
		RequestID: requestID,
		TraceID:   traceID,
		Method:    c.Request.Method,
		Path:      c.FullPath(),
		SourceIP:  strings.TrimSpace(c.ClientIP()),
	}
}

func writeServiceError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrInvalidInput):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, service.ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, service.ErrConflict):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
	}
}

func hasKey(m map[string]any, key string) bool {
	if m == nil {
		return false
	}
	_, ok := m[key]
	return ok
}
