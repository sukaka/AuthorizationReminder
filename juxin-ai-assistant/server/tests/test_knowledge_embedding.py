import respx
from httpx import Response

from app.config import Settings
from app.embedding_config import (
    FIXED_EMBEDDING_DIMENSIONS,
    FIXED_EMBEDDING_MODEL_ID,
)
from app.governance_models import SystemSetting
from app.knowledge_embedding import build_embedding_service


def test_build_embedding_service_uses_fixed_qwen_model_settings(generation_db) -> None:
    generation_db.add_all([
        SystemSetting(
            setting_key="embedding_provider",
            value_json={"value": "openai-compatible"},
            status="ACTIVE",
            created_by="admin",
            updated_by="admin",
        ),
        SystemSetting(
            setting_key="embedding_base_url",
            value_json={"value": "https://model.example/v1"},
            status="ACTIVE",
            created_by="admin",
            updated_by="admin",
        ),
        SystemSetting(
            setting_key="embedding_model_id",
            value_json={"value": "text-embedding-3-large"},
            status="ACTIVE",
            created_by="admin",
            updated_by="admin",
        ),
        SystemSetting(
            setting_key="embedding_dimensions",
            value_json={"value": 3},
            status="ACTIVE",
            created_by="admin",
            updated_by="admin",
        ),
    ])
    generation_db.commit()
    settings = Settings(
        auth_dev_bypass=True,
        ai_local_binding_secret="local-binding-secret-for-tests-000",
        embedding_model_api_key="embedding-secret",
    )

    with respx.mock(assert_all_called=True) as router:
        route = router.post("http://host.docker.internal:8091/v1/embeddings").mock(
            return_value=Response(200, json={"data": [{"embedding": [0.1, 0.2, 0.3]}]}),
        )
        service = build_embedding_service(generation_db, settings)
        vector = service.embed("零信任网关")

    assert route.calls[0].request.headers["authorization"] == "Bearer embedding-secret"
    assert route.calls[0].request.content
    assert route.calls[0].request.url.path == "/v1/embeddings"
    assert f'"model":"{FIXED_EMBEDDING_MODEL_ID}"' in route.calls[0].request.content.decode()
    assert f'"dimensions":{FIXED_EMBEDDING_DIMENSIONS}' in route.calls[0].request.content.decode()
    assert vector == [0.1, 0.2, 0.3]
    metadata = service.to_metadata(vector)
    assert metadata["provider"] == "openai-compatible"
    assert metadata["model_id"] == FIXED_EMBEDDING_MODEL_ID
    assert service.from_metadata({"embedding": metadata}) == vector


def test_fixed_local_embedding_service_does_not_require_api_key(generation_db) -> None:
    with respx.mock(assert_all_called=True) as router:
        route = router.post("http://host.docker.internal:8091/v1/embeddings").mock(
            return_value=Response(200, json={"data": [{"embedding": [0.1, 0.2, 0.3]}]}),
        )
        service = build_embedding_service(
            generation_db,
            Settings(
                auth_dev_bypass=True,
                ai_local_binding_secret="local-binding-secret-for-tests-000",
            ),
        )
        vector = service.embed("测试")

    assert "authorization" not in route.calls[0].request.headers
    metadata = service.to_metadata(vector)
    assert vector == [0.1, 0.2, 0.3]
    assert metadata["provider"] == "openai-compatible"
    assert metadata["model_id"] == FIXED_EMBEDDING_MODEL_ID


def test_openai_compatible_embedding_service_marks_failed_calls_as_local_fallback(generation_db) -> None:
    generation_db.add_all([
        SystemSetting(
            setting_key="embedding_provider",
            value_json={"value": "openai-compatible"},
            status="ACTIVE",
            created_by="admin",
            updated_by="admin",
        ),
        SystemSetting(
            setting_key="embedding_base_url",
            value_json={"value": "https://model.example/v1"},
            status="ACTIVE",
            created_by="admin",
            updated_by="admin",
        ),
        SystemSetting(
            setting_key="embedding_model_id",
            value_json={"value": "text-embedding-3-small"},
            status="ACTIVE",
            created_by="admin",
            updated_by="admin",
        ),
    ])
    generation_db.commit()
    settings = Settings(
        auth_dev_bypass=True,
        ai_local_binding_secret="local-binding-secret-for-tests-000",
        embedding_model_api_key="embedding-secret",
    )

    with respx.mock(assert_all_called=True) as router:
        router.post("http://host.docker.internal:8091/v1/embeddings").mock(return_value=Response(500))
        service = build_embedding_service(generation_db, settings)
        vector = service.embed("供应商暂时不可用")

    metadata = service.to_metadata(vector)
    assert metadata["provider"] == "local-hash"
    assert service.from_metadata({"embedding": metadata}) == vector
