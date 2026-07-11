import httpx
import respx


@respx.mock
def test_qdrant_search_returns_ranked_chunk_ids() -> None:
    from app.knowledge_vector_index import QdrantKnowledgeIndex

    route = respx.post(
        "http://qdrant:6333/collections/knowledge/points/search"
    ).mock(return_value=httpx.Response(200, json={
        "result": [
            {"id": "chunk-a", "score": 0.91},
            {"id": "chunk-b", "score": 0.73},
        ]
    }))
    index = QdrantKnowledgeIndex(
        url="http://qdrant:6333",
        collection="knowledge",
        dimensions=3,
    )

    result = index.search(
        [0.1, 0.2, 0.3],
        limit=12,
        knowledge_base_ids=[7],
        categories=["管理员手册"],
        document_types=["docx"],
        score_threshold=0.6,
    )

    assert result.available is True
    assert [(hit.chunk_id, hit.score) for hit in result.hits] == [
        ("chunk-a", 0.91),
        ("chunk-b", 0.73),
    ]
    request_body = route.calls.last.request.content.decode()
    assert '"limit":12' in request_body
    assert '"knowledge_base_id"' in request_body
    assert '"管理员手册"' in request_body


@respx.mock
def test_qdrant_failure_is_reported_as_unavailable() -> None:
    from app.knowledge_vector_index import QdrantKnowledgeIndex

    respx.post(
        "http://qdrant:6333/collections/knowledge/points/search"
    ).mock(side_effect=httpx.ConnectError("offline"))
    index = QdrantKnowledgeIndex(
        url="http://qdrant:6333",
        collection="knowledge",
        dimensions=3,
    )

    result = index.search([0.1, 0.2, 0.3], limit=12)

    assert result.available is False
    assert result.hits == ()


def test_qdrant_rejects_query_vector_with_wrong_dimensions() -> None:
    from app.knowledge_vector_index import QdrantKnowledgeIndex

    index = QdrantKnowledgeIndex(
        url="http://qdrant:6333",
        collection="knowledge",
        dimensions=2560,
    )

    result = index.search([0.1] * 128, limit=12)

    assert result.available is False
    assert result.error == "VECTOR_INDEX_DISABLED_OR_DIMENSION_MISMATCH"
