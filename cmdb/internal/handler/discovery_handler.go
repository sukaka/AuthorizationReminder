package handler

import (
	"net/http"
	"strconv"
	"strings"

	"cmdb/internal/service"
	"github.com/gin-gonic/gin"
)

type DiscoveryHandler struct {
	discoverySvc *service.DiscoveryService
}

type createDiscoveryTaskRequest struct {
	Name          string `json:"name" binding:"required"`
	CITypeKey     string `json:"ci_type_key" binding:"required"`
	TaskMode      string `json:"task_mode"`
	SourceType    string `json:"source_type"`
	EndpointURL   string `json:"endpoint_url"`
	SyncMode      string `json:"sync_mode"`
	RequestMethod string `json:"request_method"`
	Owner         string `json:"owner"`
	ScheduleText  string `json:"schedule_text"`
	BatchSize     int    `json:"batch_size"`
}

type patchDiscoveryTaskRequest struct {
	Enabled *bool `json:"enabled"`
}

func NewDiscoveryHandler(discoverySvc *service.DiscoveryService) *DiscoveryHandler {
	return &DiscoveryHandler{discoverySvc: discoverySvc}
}

func (h *DiscoveryHandler) ListTasks(c *gin.Context) {
	items, err := h.discoverySvc.ListTasks(c.Request.Context())
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *DiscoveryHandler) CreateTask(c *gin.Context) {
	var req createDiscoveryTaskRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	item, err := h.discoverySvc.CreateTask(c.Request.Context(), service.CreateDiscoveryTaskInput{
		Name:          req.Name,
		CITypeKey:     req.CITypeKey,
		TaskMode:      req.TaskMode,
		SourceType:    req.SourceType,
		EndpointURL:   req.EndpointURL,
		SyncMode:      req.SyncMode,
		RequestMethod: req.RequestMethod,
		Owner:         req.Owner,
		ScheduleText:  req.ScheduleText,
		BatchSize:     req.BatchSize,
	})
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusCreated, item)
}

func (h *DiscoveryHandler) UpdateTask(c *gin.Context) {
	var req patchDiscoveryTaskRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Enabled == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	item, err := h.discoverySvc.UpdateTaskEnabled(c.Request.Context(), c.Param("task_uid"), *req.Enabled)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h *DiscoveryHandler) DeleteTask(c *gin.Context) {
	if err := h.discoverySvc.DeleteTask(c.Request.Context(), c.Param("task_uid")); err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

func (h *DiscoveryHandler) RunTask(c *gin.Context) {
	result, err := h.discoverySvc.RunTask(c.Request.Context(), c.Param("task_uid"), actorFromRequest(c))
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *DiscoveryHandler) RunEnabled(c *gin.Context) {
	result, err := h.discoverySvc.RunEnabledTasks(c.Request.Context(), actorFromRequest(c))
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *DiscoveryHandler) ListLogs(c *gin.Context) {
	limitText := strings.TrimSpace(c.DefaultQuery("limit", "60"))
	limit, err := strconv.Atoi(limitText)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid limit"})
		return
	}

	items, err := h.discoverySvc.ListLogs(c.Request.Context(), limit)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}
