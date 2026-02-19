package events

import (
	"context"
	"log"
	"time"

	"cmdb/internal/config"
	"cmdb/internal/repository"
)

type OutboxRelay struct {
	repo           *repository.OutboxRepository
	publishers     map[string]*Publisher
	topicByEvent   map[string]string
	pollInterval   time.Duration
	batchSize      int
	publishTimeout time.Duration
}

func NewOutboxRelay(cfg config.Config, repo *repository.OutboxRepository) *OutboxRelay {
	topicByEvent := make(map[string]string, 5)
	for _, eventType := range []string{
		EventTypeCICreated,
		EventTypeCIUpdated,
		EventTypeCIRelationChanged,
		EventTypeCIDeleted,
		EventTypeCIReconciled,
	} {
		topic, ok := TopicForEvent(cfg, eventType)
		if !ok || topic == "" {
			continue
		}
		topicByEvent[eventType] = topic
	}

	publishers := make(map[string]*Publisher, 5)
	for _, topic := range topicByEvent {
		if _, exists := publishers[topic]; exists {
			continue
		}
		publishers[topic] = NewPublisher(cfg.KafkaBrokers, topic)
	}

	return &OutboxRelay{
		repo:           repo,
		publishers:     publishers,
		topicByEvent:   topicByEvent,
		pollInterval:   time.Duration(cfg.OutboxPollIntervalMS) * time.Millisecond,
		batchSize:      cfg.OutboxBatchSize,
		publishTimeout: time.Duration(cfg.OutboxPublishTimeoutMS) * time.Millisecond,
	}
}

func (r *OutboxRelay) Run(ctx context.Context) {
	if r.batchSize <= 0 {
		r.batchSize = 100
	}
	if r.pollInterval <= 0 {
		r.pollInterval = 2 * time.Second
	}
	if r.publishTimeout <= 0 {
		r.publishTimeout = 5 * time.Second
	}

	ticker := time.NewTicker(r.pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := r.dispatch(ctx); err != nil {
				log.Printf("outbox relay dispatch error: %v", err)
			}
		}
	}
}

func (r *OutboxRelay) Close() {
	for topic, publisher := range r.publishers {
		if err := publisher.Close(); err != nil {
			log.Printf("close publisher for topic %s failed: %v", topic, err)
		}
	}
}

func (r *OutboxRelay) dispatch(ctx context.Context) error {
	records, err := r.repo.FetchReady(ctx, r.batchSize)
	if err != nil {
		return err
	}

	for _, record := range records {
		topic, ok := r.topicByEvent[record.EventType]
		if !ok {
			nextRetry := repository.BackoffAt(time.Now().UTC(), record.RetryCount+1)
			_ = r.repo.MarkFailed(ctx, record.ID, record.RetryCount+1, nextRetry)
			continue
		}

		publisher, ok := r.publishers[topic]
		if !ok {
			nextRetry := repository.BackoffAt(time.Now().UTC(), record.RetryCount+1)
			_ = r.repo.MarkFailed(ctx, record.ID, record.RetryCount+1, nextRetry)
			continue
		}

		pubCtx, cancel := context.WithTimeout(ctx, r.publishTimeout)
		err := publisher.Publish(pubCtx, record.AggregateUID, record.Payload)
		cancel()
		if err != nil {
			nextRetry := repository.BackoffAt(time.Now().UTC(), record.RetryCount+1)
			if updateErr := r.repo.MarkFailed(ctx, record.ID, record.RetryCount+1, nextRetry); updateErr != nil {
				log.Printf("mark failed for outbox %d failed: %v", record.ID, updateErr)
			}
			continue
		}

		if err := r.repo.MarkPublished(ctx, record.ID); err != nil {
			log.Printf("mark published for outbox %d failed: %v", record.ID, err)
		}
	}
	return nil
}
