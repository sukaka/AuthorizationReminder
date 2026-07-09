import respx
from httpx import Response

from app.config import Settings
from app.governance_models import SystemSetting
from app.knowledge_embedding import build_embedding_service


def test_build_embedding_service_uses_admin_vector_model_settings(generation_db) -> None:
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
        route = router.post("https://model.example/v1/embeddings").mock(
            return_value=Response(200, json={"data": [{"embedding": [0.1, 0.2, 0.3]}]}),
        )
        service = build_embedding_service(generation_db, settings)
        vector = service.embed("零信任网关")

    assert route.calls[0].request.headers["authorization"] == "Bearer embedding-secret"
    assert route.calls[0].request.content
    assert vector == [0.1, 0.2, 0.3]
    metadata = service.to_metadata(vector)
    assert metadata["provider"] == "openai-compatible"
    assert metadata["model_id"] == "text-embedding-3-large"
    assert service.from_metadata({"embedding": metadata}) == vector


def test_build_embedding_service_falls_back_to_local_without_api_key(generation_db) -> None:
    generation_db.add(SystemSetting(
        setting_key="embedding_provider",
        value_json={"value": "openai-compatible"},
        status="ACTIVE",
        created_by="admin",
        updated_by="admin",
    ))
    generation_db.commit()

    service = build_embedding_service(
        generation_db,
        Settings(
            auth_dev_bypass=True,
            ai_local_binding_secret="local-binding-secret-for-tests-000",
        ),
    )

    metadata = service.to_metadata(service.embed("测试"))
    assert metadata["provider"] == "local-hash"


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
        router.post("https://model.example/v1/embeddings").mock(return_value=Response(500))
        service = build_embedding_service(generation_db, settings)
        vector = service.embed("供应商暂时不可用")

    metadata = service.to_metadata(vector)
    assert metadata["provider"] == "local-hash"
    assert service.from_metadata({"embedding": metadata}) == vector
