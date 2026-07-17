# DOCX media import implementation plan

## Scope

- Extract embedded `word/media/*` files through the DOCX relationship graph.
- Preserve image occurrences in the structured block order while deduplicating
  the package bytes passed to the media service.
- Persist each image through the existing encrypted, signature-scanned media
  asset service and bind import replay to an idempotency request hash.

## Verification

- Unit coverage checks relationship extraction, MIME/signature metadata and
  block order without exposing raw bytes in JSON.
- API coverage checks encrypted persistence, asset ownership, replay, and
  idempotency-key conflict behavior.
- Targeted pytest plus `git diff --check` are required before handoff.

## Non-goals

- No shared database, staging credentials, provider calls, or version bump is
  performed by this implementation.
