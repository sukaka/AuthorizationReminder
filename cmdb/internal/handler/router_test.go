package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"cmdb/internal/config"
)

func TestNewRouterHealthzWithoutLegacyDatastore(t *testing.T) {
	t.Parallel()

	r := NewRouter(config.Config{
		AppName:            "cmdb",
		BodyMaxBytes:       1024,
		RateLimitWindowSec: 60,
		RateLimitMax:       10,
	}, nil)

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()

	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, rec.Code)
	}
}
