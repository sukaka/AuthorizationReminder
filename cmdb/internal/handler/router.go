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
	"go.mongodb.org/mongo-driver/mongo"
)

func NewRouter(cfg config.Config, sqlDB *sql.DB, mongoClient *mongo.Client) *gin.Engine {
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
	auditSvc := service.NewAuditService(ciRepo)
	auditHandler := NewAuditHandler(auditSvc)
	dashboardSvc := service.NewDashboardService(ciRepo)
	dashboardHandler := NewDashboardHandler(dashboardSvc)

	api := r.Group("/api/v1")
	api.Use(auth.OIDCAuthMiddleware(cfg))
	{
		api.GET("/dashboard/overview", dashboardHandler.Overview)
		api.GET("/audit/logs", requireCMDBAuditReader(), auditHandler.ListLogs)
		api.GET("/audit/logs/export.csv", requireCMDBAuditReader(), auditHandler.ExportLogsCSV)
		api.GET("/ci", ciHandler.ListCI)
		api.GET("/ci/:ci_uid", ciHandler.GetByUID)
		api.POST("/ci", requireCMDBWriter(), ciHandler.CreateCI)
		api.PATCH("/ci/:ci_uid", requireCMDBWriter(), ciHandler.UpdateCI)
		api.DELETE("/ci/:ci_uid", requireCMDBWriter(), ciHandler.DeleteCI)
		api.POST("/ci/:ci_uid/relations", requireCMDBWriter(), ciHandler.UpsertRelation)
	}

	_ = mongoClient // reserved for raw snapshot/reconcile handlers
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
