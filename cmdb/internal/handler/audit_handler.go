package handler

import (
	"bytes"
	"encoding/csv"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"cmdb/internal/service"
	"github.com/gin-gonic/gin"
)

type AuditHandler struct {
	auditSvc *service.AuditService
}

func NewAuditHandler(auditSvc *service.AuditService) *AuditHandler {
	return &AuditHandler{auditSvc: auditSvc}
}

func (h *AuditHandler) ListLogs(c *gin.Context) {
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

	result, err := h.auditSvc.ListAuditLogs(c.Request.Context(), service.AuditListInput{
		ActorSub:     c.Query("actor_sub"),
		ActorName:    c.Query("actor"),
		Action:       c.Query("action"),
		ResourceType: c.Query("resource_type"),
		ResourceUID:  c.Query("resource_uid"),
		HTTPMethod:   c.Query("http_method"),
		Result:       c.Query("result"),
		SourceIP:     c.Query("source_ip"),
		Keyword:      c.Query("keyword"),
		DateFrom:     c.Query("date_from"),
		DateTo:       c.Query("date_to"),
		Page:         page,
		PageSize:     pageSize,
	})
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *AuditHandler) ExportLogsCSV(c *gin.Context) {
	limit, err := strconv.Atoi(strings.TrimSpace(c.DefaultQuery("limit", "5000")))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid limit"})
		return
	}

	rows, err := h.auditSvc.ListAuditLogsForExport(c.Request.Context(), service.AuditListInput{
		ActorSub:     c.Query("actor_sub"),
		ActorName:    c.Query("actor"),
		Action:       c.Query("action"),
		ResourceType: c.Query("resource_type"),
		ResourceUID:  c.Query("resource_uid"),
		HTTPMethod:   c.Query("http_method"),
		Result:       c.Query("result"),
		SourceIP:     c.Query("source_ip"),
		Keyword:      c.Query("keyword"),
		DateFrom:     c.Query("date_from"),
		DateTo:       c.Query("date_to"),
	}, limit)
	if err != nil {
		writeServiceError(c, err)
		return
	}

	buf := &bytes.Buffer{}
	buf.WriteString("\xEF\xBB\xBF")
	writer := csv.NewWriter(buf)
	header := []string{"审计ID", "时间", "操作人", "角色ID", "动作", "资源类型", "资源标识", "请求方法", "请求路径", "状态码", "结果", "来源IP", "请求ID", "错误信息"}
	if err := writer.Write(header); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "csv write failed"})
		return
	}
	for _, row := range rows {
		record := []string{
			strconv.FormatUint(row.ID, 10),
			formatAuditTime(row.CreatedAt),
			firstNonEmpty(row.ActorName, row.ActorSub, "-"),
			row.ActorSub,
			row.Action,
			row.ResourceType,
			row.ResourceUID,
			row.HTTPMethod,
			row.HTTPPath,
			strconv.Itoa(row.StatusCode),
			row.Result,
			firstNonEmpty(row.SourceIP, "-"),
			row.RequestID,
			firstNonEmpty(row.ErrorMessage, "-"),
		}
		if err := writer.Write(record); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "csv write failed"})
			return
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "csv write failed"})
		return
	}

	filename := fmt.Sprintf("cmdb-audit-%s.csv", time.Now().Format("20060102-150405"))
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	c.String(http.StatusOK, buf.String())
}

func formatAuditTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.Format("2006-01-02 15:04:05")
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
