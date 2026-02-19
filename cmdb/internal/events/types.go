package events

import "cmdb/internal/config"

const (
	EventTypeCICreated         = "cmdb.ci.created"
	EventTypeCIUpdated         = "cmdb.ci.updated"
	EventTypeCIRelationChanged = "cmdb.ci.relation.changed"
	EventTypeCIDeleted         = "cmdb.ci.deleted"
	EventTypeCIReconciled      = "cmdb.ci.reconciled"
)

func TopicForEvent(cfg config.Config, eventType string) (string, bool) {
	switch eventType {
	case EventTypeCICreated:
		return cfg.KafkaTopicCICreated, true
	case EventTypeCIUpdated:
		return cfg.KafkaTopicCIUpdated, true
	case EventTypeCIRelationChanged:
		return cfg.KafkaTopicCIRelationChanged, true
	case EventTypeCIDeleted:
		return cfg.KafkaTopicCIDeleted, true
	case EventTypeCIReconciled:
		return cfg.KafkaTopicCIReconciled, true
	default:
		return "", false
	}
}
