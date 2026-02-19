package repository

import (
	"context"
	"database/sql"
	"time"
)

type OutboxRepository struct {
	db *sql.DB
}

type OutboxRecord struct {
	ID           uint64
	EventID      string
	AggregateUID string
	EventType    string
	Payload      []byte
	RetryCount   int
}

func NewOutboxRepository(db *sql.DB) *OutboxRepository {
	return &OutboxRepository{db: db}
}

func (r *OutboxRepository) FetchReady(ctx context.Context, limit int) ([]OutboxRecord, error) {
	const q = `
SELECT id, event_id, aggregate_uid, event_type, CAST(payload_json AS CHAR), retry_count
FROM outbox_event
WHERE status = 'pending'
   OR (status = 'failed' AND (next_retry_at IS NULL OR next_retry_at <= NOW()))
ORDER BY id ASC
LIMIT ?`

	rows, err := r.db.QueryContext(ctx, q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]OutboxRecord, 0, limit)
	for rows.Next() {
		var item OutboxRecord
		if err := rows.Scan(
			&item.ID,
			&item.EventID,
			&item.AggregateUID,
			&item.EventType,
			&item.Payload,
			&item.RetryCount,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (r *OutboxRepository) MarkPublished(ctx context.Context, id uint64) error {
	const q = `
UPDATE outbox_event
SET status = 'published', published_at = NOW(), updated_at = NOW()
WHERE id = ? AND status <> 'published'`

	_, err := r.db.ExecContext(ctx, q, id)
	return err
}

func (r *OutboxRepository) MarkFailed(ctx context.Context, id uint64, retryCount int, nextRetryAt time.Time) error {
	const q = `
UPDATE outbox_event
SET status = 'failed', retry_count = ?, next_retry_at = ?, updated_at = NOW()
WHERE id = ? AND status <> 'published'`

	_, err := r.db.ExecContext(ctx, q, retryCount, nextRetryAt.UTC(), id)
	return err
}
