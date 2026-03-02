package handler

import (
	"net/http"
	"strconv"
	"strings"

	"cmdb/internal/service"
	"github.com/gin-gonic/gin"
)

type ChangeHandler struct {
	changeSvc *service.ChangeService
}

type createChangeRequest struct {
	Title          string `json:"title" binding:"required"`
	Description    string `json:"description"`
	TargetCIUID    string `json:"target_ci_uid" binding:"required"`
	RiskLevel      string `json:"risk_level"`
	PlannedStartAt string `json:"planned_start_at"`
	PlannedEndAt   string `json:"planned_end_at"`
}

type changeActionRequest struct {
	Comment string `json:"comment"`
}

func NewChangeHandler(changeSvc *service.ChangeService) *ChangeHandler {
	return &ChangeHandler{changeSvc: changeSvc}
}

func (h *ChangeHandler) ListChanges(c *gin.Context) {
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

	result, err := h.changeSvc.ListChanges(c.Request.Context(), service.ListChangeInput{
		Status:      c.Query("status"),
		RiskLevel:   c.Query("risk_level"),
		TargetCIUID: c.Query("target_ci_uid"),
		Keyword:     c.Query("keyword"),
		Page:        page,
		PageSize:    pageSize,
	})
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *ChangeHandler) GetChange(c *gin.Context) {
	result, err := h.changeSvc.GetChange(c.Request.Context(), c.Param("change_uid"))
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *ChangeHandler) CreateChange(c *gin.Context) {
	var req createChangeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	result, err := h.changeSvc.CreateChange(c.Request.Context(), service.CreateChangeInput{
		Title:          req.Title,
		Description:    req.Description,
		TargetCIUID:    req.TargetCIUID,
		RiskLevel:      req.RiskLevel,
		PlannedStartAt: req.PlannedStartAt,
		PlannedEndAt:   req.PlannedEndAt,
	}, actorFromRequest(c))
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusCreated, result)
}

func (h *ChangeHandler) ApproveChange(c *gin.Context) {
	req, ok := bindChangeActionRequest(c)
	if !ok {
		return
	}
	result, err := h.changeSvc.ApproveChange(c.Request.Context(), service.ChangeActionInput{
		ChangeUID: c.Param("change_uid"),
		Comment:   req.Comment,
	}, actorFromRequest(c))
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *ChangeHandler) RejectChange(c *gin.Context) {
	req, ok := bindChangeActionRequest(c)
	if !ok {
		return
	}
	result, err := h.changeSvc.RejectChange(c.Request.Context(), service.ChangeActionInput{
		ChangeUID: c.Param("change_uid"),
		Comment:   req.Comment,
	}, actorFromRequest(c))
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *ChangeHandler) ExecuteChange(c *gin.Context) {
	req, ok := bindChangeActionRequest(c)
	if !ok {
		return
	}
	result, err := h.changeSvc.ExecuteChange(c.Request.Context(), service.ChangeActionInput{
		ChangeUID: c.Param("change_uid"),
		Comment:   req.Comment,
	}, actorFromRequest(c))
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *ChangeHandler) RollbackChange(c *gin.Context) {
	req, ok := bindChangeActionRequest(c)
	if !ok {
		return
	}
	result, err := h.changeSvc.RollbackChange(c.Request.Context(), service.ChangeActionInput{
		ChangeUID: c.Param("change_uid"),
		Comment:   req.Comment,
	}, actorFromRequest(c))
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func bindChangeActionRequest(c *gin.Context) (changeActionRequest, bool) {
	var req changeActionRequest
	if c.Request.ContentLength <= 0 {
		return req, true
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return changeActionRequest{}, false
	}
	return req, true
}
