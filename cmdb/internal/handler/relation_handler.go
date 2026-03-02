package handler

import (
	"net/http"
	"strconv"
	"strings"

	"cmdb/internal/service"
	"github.com/gin-gonic/gin"
)

type RelationHandler struct {
	relationSvc *service.RelationService
}

func NewRelationHandler(relationSvc *service.RelationService) *RelationHandler {
	return &RelationHandler{relationSvc: relationSvc}
}

func (h *RelationHandler) ListRelations(c *gin.Context) {
	page, err := strconv.Atoi(strings.TrimSpace(c.DefaultQuery("page", "1")))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid page"})
		return
	}
	pageSize, err := strconv.Atoi(strings.TrimSpace(c.DefaultQuery("page_size", "20")))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid page_size"})
		return
	}

	result, err := h.relationSvc.ListRelations(c.Request.Context(), service.ListRelationInput{
		RelationType: c.Query("relation_type"),
		FromCIUID:    c.Query("from_ci_uid"),
		ToCIUID:      c.Query("to_ci_uid"),
		Keyword:      c.Query("keyword"),
		Page:         page,
		PageSize:     pageSize,
	})
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *RelationHandler) Topology(c *gin.Context) {
	limit, err := strconv.Atoi(strings.TrimSpace(c.DefaultQuery("limit", "300")))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid limit"})
		return
	}

	result, err := h.relationSvc.Topology(
		c.Request.Context(),
		c.Query("keyword"),
		c.Query("focus_ci_uid"),
		limit,
	)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *RelationHandler) FindPath(c *gin.Context) {
	maxDepth, err := strconv.Atoi(strings.TrimSpace(c.DefaultQuery("max_depth", "6")))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid max_depth"})
		return
	}
	result, err := h.relationSvc.FindPath(
		c.Request.Context(),
		c.Query("from_ci_uid"),
		c.Query("to_ci_uid"),
		maxDepth,
	)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
