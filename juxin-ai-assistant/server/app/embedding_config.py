from typing import Final


FIXED_EMBEDDING_PROVIDER: Final[str] = "openai-compatible"
FIXED_EMBEDDING_BASE_URL: Final[str] = "http://host.docker.internal:8091"
FIXED_EMBEDDING_MODEL_ID: Final[str] = "qwen3-Embedding-4B"
FIXED_EMBEDDING_DIMENSIONS: Final[int] = 2560

FIXED_EMBEDDING_SETTINGS: Final[dict[str, str | int]] = {
    "embedding_provider": FIXED_EMBEDDING_PROVIDER,
    "embedding_base_url": FIXED_EMBEDDING_BASE_URL,
    "embedding_model_id": FIXED_EMBEDDING_MODEL_ID,
    "embedding_dimensions": FIXED_EMBEDDING_DIMENSIONS,
}
