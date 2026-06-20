def test_all_openapi_request_schemas_exclude_model_secrets(
    generation_client,
) -> None:
    schema = generation_client.get("/openapi.json").json()
    serialized = str(schema).lower()

    assert "api_key" not in serialized
    assert "authorization" not in serialized
    assert "model_base_url" not in serialized
