package service

import (
	"testing"

	"cmdb/internal/repository"
)

func TestParseDiscoveryRecordsPayload_Array(t *testing.T) {
	items, err := parseDiscoveryRecordsPayload([]byte(`[{"instance_id":"i-001","name":"node-1"}]`))
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(items))
	}
	if got := toTrimmedString(items[0]["instance_id"]); got != "i-001" {
		t.Fatalf("expected instance_id i-001, got %q", got)
	}
}

func TestParseDiscoveryRecordsPayload_ObjectItems(t *testing.T) {
	items, err := parseDiscoveryRecordsPayload([]byte(`{"items":[{"resource_id":"r-1"}]}`))
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(items))
	}
	if got := toTrimmedString(items[0]["resource_id"]); got != "r-1" {
		t.Fatalf("expected resource_id r-1, got %q", got)
	}
}

func TestParseDiscoveryRecordsPayload_Invalid(t *testing.T) {
	_, err := parseDiscoveryRecordsPayload([]byte(`{"items":"bad"}`))
	if err == nil {
		t.Fatalf("expected error for invalid payload")
	}
}

func TestNormalizeDiscoveryRecord_FillsRequiredAttrsAndStatus(t *testing.T) {
	task := repository.DiscoveryTaskRow{
		TaskUID:    "task-1",
		Name:       "host-scan",
		CITypeKey:  "host",
		Owner:      "ops",
		TaskMode:   "scan",
		SyncMode:   "upsert",
		SourceType: "http",
	}

	rules := []repository.ModelFieldRuleRow{
		{FieldKey: "ip", DataType: "string", Required: true},
	}

	record, err := normalizeDiscoveryRecord(task, "run-1", 0, map[string]any{
		"instance_id": "i-001",
		"state":       "stopped",
	}, rules)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if record.UniqueKey != "i-001" {
		t.Fatalf("unexpected unique key: %s", record.UniqueKey)
	}
	if record.Status != "inactive" {
		t.Fatalf("expected inactive status, got %s", record.Status)
	}
	if record.SourceRef != "i-001" {
		t.Fatalf("expected source ref i-001, got %s", record.SourceRef)
	}
	if got := toTrimmedString(record.ExtraAttrs["ip"]); got == "" {
		t.Fatalf("expected required field ip to be auto-filled")
	}
}
