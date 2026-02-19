package auth

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"cmdb/internal/config"
	"github.com/gin-gonic/gin"
)

type introspectResponse struct {
	User struct {
		ID       uint64 `json:"id"`
		Username string `json:"username"`
		Role     string `json:"role"`
	} `json:"user"`
	Apps []string `json:"apps"`
}

func OIDCAuthMiddleware(cfg config.Config) gin.HandlerFunc {
	authBaseURL := strings.TrimRight(strings.TrimSpace(cfg.AuthServiceURL), "/")
	systemKey := strings.TrimSpace(cfg.AuthSystemKey)
	if systemKey == "" {
		systemKey = "cmdb"
	}
	cookieName := strings.TrimSpace(cfg.AuthCookieName)
	if cookieName == "" {
		cookieName = "juxin_auth_token"
	}
	timeout := time.Duration(cfg.AuthTimeoutMS) * time.Millisecond
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	client := &http.Client{Timeout: timeout}

	return func(c *gin.Context) {
		authHeader := strings.TrimSpace(c.GetHeader("Authorization"))
		token := ""
		if strings.HasPrefix(strings.ToLower(authHeader), "bearer ") {
			token = strings.TrimSpace(authHeader[7:])
		}
		if token == "" {
			if cookieValue, err := c.Cookie(cookieName); err == nil {
				token = strings.TrimSpace(cookieValue)
			}
		}
		if token == "" || len(token) > 4096 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid bearer token"})
			return
		}

		if authBaseURL == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "auth service unavailable"})
			return
		}

		req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, authBaseURL+"/api/auth/introspect", nil)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid auth request"})
			return
		}
		req.Header.Set("Authorization", "Bearer "+token)

		resp, err := client.Do(req)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "login expired"})
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "login expired"})
			return
		}

		var payload introspectResponse
		if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&payload); err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid auth response"})
			return
		}
		if !contains(payload.Apps, systemKey) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "no access to cmdb"})
			return
		}

		c.Set("actor_sub", payload.User.ID)
		c.Set("actor_name", payload.User.Username)
		c.Set("actor_role", payload.User.Role)
		if role := strings.TrimSpace(payload.User.Role); role != "" {
			c.Set("actor_roles", []string{role})
		}
		c.Next()
	}
}

func contains(list []string, value string) bool {
	for _, item := range list {
		if strings.TrimSpace(item) == value {
			return true
		}
	}
	return false
}
