package handler

import (
	"net/http"
	"strconv"
	"strings"

	"cmdb/internal/service"
	"github.com/gin-gonic/gin"
)

type ReportHandler struct {
	reportSvc *service.ReportService
}

func NewReportHandler(reportSvc *service.ReportService) *ReportHandler {
	return &ReportHandler{reportSvc: reportSvc}
}

func (h *ReportHandler) Analysis(c *gin.Context) {
	daysText := strings.TrimSpace(c.DefaultQuery("days", "30"))
	days, err := strconv.Atoi(daysText)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid days"})
		return
	}

	result, err := h.reportSvc.Analysis(c.Request.Context(), days)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
