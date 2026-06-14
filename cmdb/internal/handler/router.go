package handler

import (
	"database/sql"
	"encoding/json"
	"log"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"cmdb/internal/auth"
	"cmdb/internal/config"
	"cmdb/internal/middleware"
	"cmdb/internal/repository"
	"cmdb/internal/service"
	"github.com/gin-gonic/gin"
)

func NewRouter(cfg config.Config, sqlDB *sql.DB) *gin.Engine {
	r := gin.New()
	metrics := newObservabilityMetrics(cfg.AppName)
	_ = r.SetTrustedProxies(cfg.TrustedProxies)
	r.HandleMethodNotAllowed = true
	r.Use(
		gin.Logger(),
		gin.Recovery(),
		middleware.RequestID(),
		structuredAccessLog(metrics, cfg.AppName),
		middleware.SecurityHeaders(),
		middleware.BodySizeLimit(cfg.BodyMaxBytes),
		middleware.IPRateLimit(time.Duration(cfg.RateLimitWindowSec)*time.Second, cfg.RateLimitMax),
	)

	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "service": cfg.AppName})
	})
	r.GET("/api/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "service": cfg.AppName})
	})
	r.GET("/api/ready", func(c *gin.Context) {
		if err := sqlDB.Ping(); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "degraded", "service": cfg.AppName, "database": "error"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ok", "service": cfg.AppName, "database": "ok"})
	})
	r.GET("/api/version", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"service": cfg.AppName, "version": os.Getenv("APP_VERSION")})
	})
	r.GET("/api/build", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"service":   cfg.AppName,
			"version":   os.Getenv("APP_VERSION"),
			"commit":    firstNonEmpty(os.Getenv("BUILD_COMMIT"), os.Getenv("GIT_COMMIT")),
			"buildTime": firstNonEmpty(os.Getenv("BUILD_TIME"), os.Getenv("BUILT_AT")),
		})
	})
	r.GET("/api/metrics", func(c *gin.Context) {
		c.JSON(http.StatusOK, metrics.Snapshot())
	})
	r.NoRoute(func(c *gin.Context) {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
	})

	ciRepo := repository.NewCIRepository(sqlDB)
	ciSvc := service.NewCIService(ciRepo)
	ciHandler := NewCIHandler(ciSvc)
	relationSvc := service.NewRelationService(ciRepo)
	relationHandler := NewRelationHandler(relationSvc)
	changeSvc := service.NewChangeService(ciRepo)
	changeHandler := NewChangeHandler(changeSvc)
	modelSvc := service.NewModelService(ciRepo)
	modelHandler := NewModelHandler(modelSvc)
	discoverySvc := service.NewDiscoveryService(ciRepo, ciSvc)
	discoveryHandler := NewDiscoveryHandler(discoverySvc)
	auditSvc := service.NewAuditService(ciRepo)
	auditHandler := NewAuditHandler(auditSvc)
	dashboardSvc := service.NewDashboardService(ciRepo)
	dashboardHandler := NewDashboardHandler(dashboardSvc)
	reportSvc := service.NewReportService(ciRepo)
	reportHandler := NewReportHandler(reportSvc)

	api := r.Group("/api/v1")
	api.Use(auth.OIDCAuthMiddleware(cfg))
	{
		api.GET("/dashboard/overview", dashboardHandler.Overview)
		api.GET("/reports/analysis", reportHandler.Analysis)
		api.GET("/audit/logs", requireCMDBAuditReader(), auditHandler.ListLogs)
		api.GET("/audit/logs/export.csv", requireCMDBAuditReader(), auditHandler.ExportLogsCSV)
		api.GET("/relations", relationHandler.ListRelations)
		api.GET("/relations/topology", relationHandler.Topology)
		api.GET("/relations/path", relationHandler.FindPath)
		api.GET("/changes", changeHandler.ListChanges)
		api.GET("/changes/:change_uid", changeHandler.GetChange)
		api.POST("/changes", requireCMDBWriter(), changeHandler.CreateChange)
		api.POST("/changes/:change_uid/approve", requireCMDBWriter(), changeHandler.ApproveChange)
		api.POST("/changes/:change_uid/reject", requireCMDBWriter(), changeHandler.RejectChange)
		api.POST("/changes/:change_uid/execute", requireCMDBWriter(), changeHandler.ExecuteChange)
		api.POST("/changes/:change_uid/rollback", requireCMDBWriter(), changeHandler.RollbackChange)
		api.GET("/models", modelHandler.ListModels)
		api.POST("/models", requireCMDBWriter(), modelHandler.CreateModel)
		api.DELETE("/models/:model_uid", requireCMDBWriter(), modelHandler.DeleteModel)
		api.GET("/models/:model_uid/fields", modelHandler.ListModelFields)
		api.POST("/models/:model_uid/fields", requireCMDBWriter(), modelHandler.CreateModelField)
		api.DELETE("/models/fields/:field_uid", requireCMDBWriter(), modelHandler.DeleteModelField)
		api.GET("/discovery/tasks", discoveryHandler.ListTasks)
		api.POST("/discovery/tasks", requireCMDBWriter(), discoveryHandler.CreateTask)
		api.PATCH("/discovery/tasks/:task_uid", requireCMDBWriter(), discoveryHandler.UpdateTask)
		api.DELETE("/discovery/tasks/:task_uid", requireCMDBWriter(), discoveryHandler.DeleteTask)
		api.POST("/discovery/tasks/:task_uid/run", requireCMDBWriter(), discoveryHandler.RunTask)
		api.POST("/discovery/run-enabled", requireCMDBWriter(), discoveryHandler.RunEnabled)
		api.GET("/discovery/logs", discoveryHandler.ListLogs)
		api.GET("/ci", ciHandler.ListCI)
		api.GET("/ci/:ci_uid", ciHandler.GetByUID)
		api.POST("/ci", requireCMDBWriter(), ciHandler.CreateCI)
		api.PATCH("/ci/:ci_uid", requireCMDBWriter(), ciHandler.UpdateCI)
		api.DELETE("/ci/:ci_uid", requireCMDBWriter(), ciHandler.DeleteCI)
		api.POST("/ci/:ci_uid/relations", requireCMDBWriter(), ciHandler.UpsertRelation)
	}

	return r
}

type observabilityMetrics struct {
	mu              sync.Mutex
	service         string
	startedAt       time.Time
	requestTotal    int64
	errorTotal      int64
	inFlight        int64
	durationMsTotal float64
	durationMsMax   float64
	statusCounts    map[int]int64
}

func newObservabilityMetrics(service string) *observabilityMetrics {
	return &observabilityMetrics{
		service:      service,
		startedAt:    time.Now().UTC(),
		statusCounts: make(map[int]int64),
	}
}

func (m *observabilityMetrics) Record(status int, durationMs float64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.requestTotal++
	if status >= http.StatusInternalServerError {
		m.errorTotal++
	}
	if m.inFlight > 0 {
		m.inFlight--
	}
	m.durationMsTotal += durationMs
	m.durationMsMax = math.Max(m.durationMsMax, durationMs)
	m.statusCounts[status]++
}

func (m *observabilityMetrics) AddInFlight() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.inFlight++
}

func (m *observabilityMetrics) Snapshot() gin.H {
	m.mu.Lock()
	defer m.mu.Unlock()
	avg := 0.0
	if m.requestTotal > 0 {
		avg = math.Round((m.durationMsTotal/float64(m.requestTotal))*100) / 100
	}
	statusCounts := make(map[string]int64, len(m.statusCounts))
	for status, count := range m.statusCounts {
		statusCounts[strconv.Itoa(status)] = count
	}
	return gin.H{
		"service":         m.service,
		"started_at":      m.startedAt.Format(time.RFC3339),
		"uptime_seconds":  int64(time.Since(m.startedAt).Seconds()),
		"request_total":   m.requestTotal,
		"error_total":     m.errorTotal,
		"in_flight":       m.inFlight,
		"duration_ms_avg": avg,
		"duration_ms_max": math.Round(m.durationMsMax*100) / 100,
		"status_counts":   statusCounts,
	}
}

func structuredAccessLog(metrics *observabilityMetrics, service string) gin.HandlerFunc {
	return func(c *gin.Context) {
		startedAt := time.Now()
		metrics.AddInFlight()
		c.Next()
		durationMs := float64(time.Since(startedAt).Microseconds()) / 1000
		status := c.Writer.Status()
		metrics.Record(status, durationMs)
		requestID := c.GetHeader("X-Request-Id")
		if value, exists := c.Get("request_id"); exists {
			if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
				requestID = text
			}
		}
		payload := map[string]any{
			"type":        "http_access",
			"service":     service,
			"request_id":  requestID,
			"method":      c.Request.Method,
			"path":        c.Request.URL.Path,
			"status":      status,
			"duration_ms": math.Round(durationMs*100) / 100,
			"remote_ip":   c.ClientIP(),
		}
		encoded, err := json.Marshal(payload)
		if err != nil {
			log.Printf("structured_access_log_error request_id=%s error=%v", requestID, err)
			return
		}
		log.Print(string(encoded))
	}
}

func requireCMDBAuditReader() gin.HandlerFunc {
	allowed := map[string]struct{}{
		"auditor": {},
	}
	return func(c *gin.Context) {
		role, _ := c.Get("actor_role")
		roleText, _ := role.(string)
		key := strings.ToLower(strings.TrimSpace(roleText))
		if _, ok := allowed[key]; ok {
			c.Next()
			return
		}
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "no audit access to cmdb"})
	}
}

func requireCMDBWriter() gin.HandlerFunc {
	allowed := map[string]struct{}{
		"admin":    {},
		"sysadmin": {},
	}
	return func(c *gin.Context) {
		role, _ := c.Get("actor_role")
		roleText, _ := role.(string)
		key := strings.ToLower(strings.TrimSpace(roleText))
		if _, ok := allowed[key]; ok {
			c.Next()
			return
		}
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "no write access to cmdb"})
	}
}
