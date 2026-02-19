package events

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

type Envelope struct {
	EventID      string         `json:"event_id"`
	EventType    string         `json:"event_type"`
	EventVersion string         `json:"event_version"`
	OccurredAt   time.Time      `json:"occurred_at"`
	Producer     string         `json:"producer"`
	TraceID      string         `json:"trace_id,omitempty"`
	Data         map[string]any `json:"data"`
}

func NewEnvelope(eventType, traceID string, data map[string]any) ([]byte, string, error) {
	eventID := uuid.NewString()
	env := Envelope{
		EventID:      eventID,
		EventType:    eventType,
		EventVersion: "1.0",
		OccurredAt:   time.Now().UTC(),
		Producer:     "cmdb-service",
		TraceID:      traceID,
		Data:         data,
	}
	payload, err := json.Marshal(env)
	if err != nil {
		return nil, "", err
	}
	return payload, eventID, nil
}
