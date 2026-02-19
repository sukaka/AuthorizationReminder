package middleware

import (
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type ipRateBucket struct {
	Count   int
	ResetAt time.Time
}

func SecurityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Frame-Options", "DENY")
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		c.Header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
		c.Next()
	}
}

func BodySizeLimit(maxBytes int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		if maxBytes <= 0 {
			c.Next()
			return
		}
		if c.Request.ContentLength > maxBytes {
			c.AbortWithStatusJSON(http.StatusRequestEntityTooLarge, gin.H{"error": "request body too large"})
			return
		}
		if c.Request.Body != nil {
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBytes)
		}
		c.Next()
	}
}

func IPRateLimit(window time.Duration, max int) gin.HandlerFunc {
	if window <= 0 {
		window = time.Minute
	}
	if max <= 0 {
		max = 300
	}

	var (
		mu      sync.Mutex
		buckets = make(map[string]ipRateBucket)
	)

	return func(c *gin.Context) {
		if c.Request.Method == http.MethodOptions || c.FullPath() == "/healthz" {
			c.Next()
			return
		}

		ip := c.ClientIP()
		if ip == "" {
			ip = "unknown"
		}

		now := time.Now()
		mu.Lock()
		for key, bucket := range buckets {
			if now.After(bucket.ResetAt) {
				delete(buckets, key)
			}
		}
		bucket, exists := buckets[ip]
		if !exists || now.After(bucket.ResetAt) {
			bucket = ipRateBucket{
				Count:   0,
				ResetAt: now.Add(window),
			}
		}
		bucket.Count++
		buckets[ip] = bucket
		overLimit := bucket.Count > max
		resetAt := bucket.ResetAt
		mu.Unlock()

		if overLimit {
			retryAfter := int(time.Until(resetAt).Seconds())
			if retryAfter < 1 {
				retryAfter = 1
			}
			c.Header("Retry-After", strconv.Itoa(retryAfter))
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"error": "too many requests"})
			return
		}

		c.Next()
	}
}
