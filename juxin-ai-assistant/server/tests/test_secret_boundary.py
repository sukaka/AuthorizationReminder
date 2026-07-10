def test_openapi_only_accepts_model_secret_in_profile_upsert(
    generation_client,
) -> None:
    schema = generation_client.get("/openapi.json").json()
    component_schemas = schema["components"]["schemas"]
    request_schema_names = {
        content_schema["$ref"].rsplit("/", 1)[-1]
        for path in schema["paths"].values()
        for operation in path.values()
        if isinstance(operation, dict) and "requestBody" in operation
        for media in operation["requestBody"]["content"].values()
        if (content_schema := media.get("schema", {})).get("$ref")
    }
    api_key_request_schemas = {
        name
        for name in request_schema_names
        if "api_key" in component_schemas[name].get("properties", {})
    }

    assert api_key_request_schemas == {"UserModelProfileUpsertIn"}
    assert "api_key" not in component_schemas["UserModelProfileOut"]["properties"]
    assert "has_api_key" in component_schemas["UserModelProfileOut"]["properties"]
    for name in request_schema_names:
        serialized = str(component_schemas[name]).lower()
        assert "authorization" not in serialized
        assert "model_base_url" not in serialized
