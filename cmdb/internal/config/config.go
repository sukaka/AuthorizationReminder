package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	AppName string
	AppEnv  string

	HTTPAddr        string
	ReadTimeoutSec  int
	WriteTimeoutSec int

	MySQLDSN     string
	MySQLMaxOpen int
	MySQLMaxIdle int

	KafkaBrokers                []string
	KafkaTopicCICreated         string
	KafkaTopicCIUpdated         string
	KafkaTopicCIRelationChanged string
	KafkaTopicCIDeleted         string
	KafkaTopicCIReconciled      string

	OutboxEnabled          bool
	OutboxPollIntervalMS   int
	OutboxBatchSize        int
	OutboxPublishTimeoutMS int

	OIDCIssuer   string
	OIDCAudience string
	OIDCJWKSURL  string

	AuthServiceURL string
	AuthSystemKey  string
	AuthTimeoutMS  int
	AuthCookieName string

	BodyMaxBytes       int64
	RateLimitWindowSec int
	RateLimitMax       int
	TrustedProxies     []string
}

func Load() (Config, error) {
	_ = godotenv.Load()

	cfg := Config{
		AppName: readStr("APP_NAME", "cmdb"),
		AppEnv:  readStr("APP_ENV", "dev"),

		HTTPAddr:        readStr("HTTP_ADDR", ":8088"),
		ReadTimeoutSec:  readInt("READ_TIMEOUT_SEC", 10),
		WriteTimeoutSec: readInt("WRITE_TIMEOUT_SEC", 15),

		MySQLDSN:     os.Getenv("MYSQL_DSN"),
		MySQLMaxOpen: readInt("MYSQL_MAX_OPEN_CONNS", 30),
		MySQLMaxIdle: readInt("MYSQL_MAX_IDLE_CONNS", 10),

		KafkaBrokers:                splitCSV(readStr("KAFKA_BROKERS", "127.0.0.1:9092")),
		KafkaTopicCICreated:         readStr("KAFKA_TOPIC_CI_CREATED", "cmdb.ci.created"),
		KafkaTopicCIUpdated:         readStr("KAFKA_TOPIC_CI_UPDATED", "cmdb.ci.updated"),
		KafkaTopicCIRelationChanged: readStr("KAFKA_TOPIC_CI_RELATION_CHANGED", "cmdb.ci.relation.changed"),
		KafkaTopicCIDeleted:         readStr("KAFKA_TOPIC_CI_DELETED", "cmdb.ci.deleted"),
		KafkaTopicCIReconciled:      readStr("KAFKA_TOPIC_CI_RECONCILED", "cmdb.ci.reconciled"),

		OutboxEnabled:          readBool("OUTBOX_ENABLED", true),
		OutboxPollIntervalMS:   readInt("OUTBOX_POLL_INTERVAL_MS", 2000),
		OutboxBatchSize:        readInt("OUTBOX_BATCH_SIZE", 100),
		OutboxPublishTimeoutMS: readInt("OUTBOX_PUBLISH_TIMEOUT_MS", 5000),

		OIDCIssuer:   os.Getenv("OIDC_ISSUER"),
		OIDCAudience: os.Getenv("OIDC_AUDIENCE"),
		OIDCJWKSURL:  os.Getenv("OIDC_JWKS_URL"),

		AuthServiceURL: readStr("AUTH_SERVICE_URL", "http://127.0.0.1:5180"),
		AuthSystemKey:  readStr("AUTH_SYSTEM_KEY", "cmdb"),
		AuthTimeoutMS:  readInt("AUTH_TIMEOUT_MS", 5000),
		AuthCookieName: readStr("AUTH_COOKIE_NAME", "juxin_auth_token"),

		BodyMaxBytes:       readInt64("BODY_MAX_BYTES", 2*1024*1024),
		RateLimitWindowSec: readInt("RATE_LIMIT_WINDOW_SEC", 60),
		RateLimitMax:       readInt("RATE_LIMIT_MAX", 300),
		TrustedProxies:     splitCSVNoDefault(os.Getenv("TRUSTED_PROXIES")),
	}

	if cfg.MySQLDSN == "" {
		return Config{}, fmt.Errorf("MYSQL_DSN is required")
	}
	return cfg, nil
}

func readStr(key, def string) string {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	return v
}

func readInt(key string, def int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

func readBool(key string, def bool) bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv(key)))
	if v == "" {
		return def
	}
	switch v {
	case "1", "true", "yes", "y", "on":
		return true
	case "0", "false", "no", "n", "off":
		return false
	default:
		return def
	}
}

func readInt64(key string, def int64) int64 {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return def
	}
	return n
}

func splitCSV(v string) []string {
	items := strings.Split(v, ",")
	out := make([]string, 0, len(items))
	for _, item := range items {
		s := strings.TrimSpace(item)
		if s != "" {
			out = append(out, s)
		}
	}
	if len(out) == 0 {
		return []string{"127.0.0.1:9092"}
	}
	return out
}

func splitCSVNoDefault(v string) []string {
	items := strings.Split(v, ",")
	out := make([]string, 0, len(items))
	for _, item := range items {
		s := strings.TrimSpace(item)
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}
