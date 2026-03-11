package handler

import (
	"database/sql"
	"net/http"
	"strings"
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
	_ = r.SetTrustedProxies(cfg.TrustedProxies)
	r.HandleMethodNotAllowed = true
	r.Use(
		gin.Logger(),
		gin.Recovery(),
		middleware.RequestID(),
		middleware.SecurityHeaders(),
		middleware.BodySizeLimit(cfg.BodyMaxBytes),
		middleware.IPRateLimit(time.Duration(cfg.RateLimitWindowSec)*time.Second, cfg.RateLimitMax),
	)

	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "service": cfg.AppName})
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
