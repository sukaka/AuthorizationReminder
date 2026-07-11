class FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}

    def get(self, key: str):
        return self.values.get(key)

    def setex(self, key: str, _ttl: int, value: str) -> None:
        self.values[key] = value

    def incr(self, key: str) -> int:
        value = int(self.values.get(key, "0")) + 1
        self.values[key] = str(value)
        return value


def _cache():
    from app.knowledge_cache import RedisKnowledgeCache

    return RedisKnowledgeCache(
        url="redis://unused",
        prefix="test:knowledge",
        enabled=True,
        embedding_ttl_seconds=60,
        vector_ttl_seconds=60,
        client=FakeRedis(),
    )


def test_query_embedding_cache_is_scoped_by_model_and_dimensions() -> None:
    cache = _cache()

    cache.set_query_embedding("  SHOW   CMI ", [0.1, 0.2], model_id="qwen", dimensions=2)

    assert cache.get_query_embedding("show cmi", model_id="qwen", dimensions=2) == [0.1, 0.2]
    assert cache.get_query_embedding("show cmi", model_id="other", dimensions=2) is None
    assert cache.get_query_embedding("show cmi", model_id="qwen", dimensions=3) is None


def test_vector_hit_cache_changes_key_after_knowledge_version_bump() -> None:
    from app.knowledge_vector_index import VectorSearchHit

    cache = _cache()
    hits = (VectorSearchHit("chunk-a", 0.91),)
    cache.set_vector_hits("命令行", scope="company", limit=36, hits=hits)

    assert cache.get_vector_hits("命令行", scope="company", limit=36).hits == hits
    cache.bump_knowledge_version()
    assert cache.get_vector_hits("命令行", scope="company", limit=36).found is False


def test_cache_failure_degrades_to_miss() -> None:
    class BrokenRedis:
        def get(self, _key):
            raise ConnectionError

    from app.knowledge_cache import RedisKnowledgeCache

    cache = RedisKnowledgeCache(
        url="redis://unused",
        prefix="test",
        enabled=True,
        embedding_ttl_seconds=60,
        vector_ttl_seconds=60,
        client=BrokenRedis(),
    )

    assert cache.get_query_embedding("问题", model_id="qwen", dimensions=2) is None
    assert cache.get_vector_hits("问题", scope="company", limit=12).found is False
