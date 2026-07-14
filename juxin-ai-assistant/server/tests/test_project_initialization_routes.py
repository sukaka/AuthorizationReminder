from sqlalchemy import select


def _create_project(client, name: str = "项目初始化测试") -> dict:
    response = client.post(
        "/api/ai/projects",
        json={"name": name, "description": "初始化接口测试"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_project_initialization_can_confirm_scope_and_create_execution_rule(
    client_for_user,
    generation_db,
) -> None:
    owner = client_for_user("u-1")
    project_uuid = _create_project(owner)["project_uuid"]

    contract = owner.post(
        f"/api/ai/projects/{project_uuid}/contracts",
        json={
            "name": "安全服务合同",
            "contract_no": "HT-001",
            "customer_name": "客户一",
            "extracted_payload": {"service_period": "2026"},
        },
    )
    assert contract.status_code == 201, contract.text
    contract_uuid = contract.json()["contract_uuid"]
    assert contract.json()["extraction_status"] == "pending"

    confirmed_contract = owner.post(
        f"/api/ai/projects/{project_uuid}/contracts/{contract_uuid}/confirm",
        json={},
    )
    assert confirmed_contract.status_code == 200, confirmed_contract.text
    assert confirmed_contract.json()["status"] == "confirmed"

    scope = owner.post(
        f"/api/ai/projects/{project_uuid}/service-scopes",
        json={
            "name": "月度安全评估",
            "category": "安全服务",
            "frequency": "monthly",
            "deliverable": "评估报告",
            "acceptance_criteria": "完成客户确认",
            "contract_uuid": contract_uuid,
        },
    )
    assert scope.status_code == 201, scope.text
    scope_uuid = scope.json()["scope_uuid"]
    assert scope.json()["current_version"] == 1

    confirmed_scope = owner.post(
        f"/api/ai/projects/{project_uuid}/service-scopes/{scope_uuid}/confirm",
        json={"change_summary": "确认首版服务范围"},
    )
    assert confirmed_scope.status_code == 200, confirmed_scope.text
    assert confirmed_scope.json()["confirmation_status"] == "confirmed"

    system = owner.post(
        f"/api/ai/projects/{project_uuid}/systems",
        json={
            "name": "生产业务系统",
            "system_type": "web",
            "department": "研发部",
            "owner": "系统负责人",
            "criticality": "high",
        },
    )
    assert system.status_code == 201, system.text
    system_uuid = system.json()["system_uuid"]

    asset = owner.post(
        f"/api/ai/projects/{project_uuid}/assets",
        json={
            "name": "生产 Web 服务器",
            "asset_type": "server",
            "identifier": "web-01",
            "business_system_uuid": system_uuid,
            "in_scope": True,
        },
    )
    assert asset.status_code == 201, asset.text

    group = owner.post(
        f"/api/ai/projects/{project_uuid}/target-groups",
        json={"name": "生产服务器组", "group_type": "asset"},
    )
    assert group.status_code == 201, group.text
    group_uuid = group.json()["group_uuid"]

    target = owner.post(
        f"/api/ai/projects/{project_uuid}/service-targets",
        json={
            "scope_uuid": scope_uuid,
            "target_group_uuid": group_uuid,
            "target_type": "asset_group",
            "target_value": "生产服务器组",
        },
    )
    assert target.status_code == 201, target.text

    rule = owner.post(
        f"/api/ai/projects/{project_uuid}/execution-rules",
        json={
            "scope_uuid": scope_uuid,
            "target_group_uuid": group_uuid,
            "frequency": "monthly",
            "responsible_user_id": "u-1",
            "allow_ai_execution": True,
            "needs_approval": True,
        },
    )
    assert rule.status_code == 201, rule.text
    assert rule.json()["scope_uuid"] == scope_uuid

    initialization = owner.get(f"/api/ai/projects/{project_uuid}/initialization")
    assert initialization.status_code == 200, initialization.text
    body = initialization.json()
    assert body["counts"] == {
        "contracts": 1,
        "service_scopes": 1,
        "business_systems": 1,
        "assets": 1,
        "target_groups": 1,
        "service_targets": 1,
        "execution_rules": 1,
    }
    assert body["initialization_complete"] is True

    from app.governance_models import AuditLog

    actions = generation_db.scalars(
        select(AuditLog.action).where(AuditLog.entity_uuid == project_uuid)
    ).all()
    assert "project.initialization.contract.confirm" in actions
    assert "project.initialization.scope.confirm" in actions


def test_project_initialization_requires_project_manager_for_writes(client_for_user) -> None:
    owner = client_for_user("u-1")
    member = client_for_user("u-2")
    project_uuid = _create_project(owner, "权限初始化测试")["project_uuid"]

    add_member = owner.post(
        f"/api/ai/projects/{project_uuid}/members",
        json={"user_id": "u-2", "role": "member"},
    )
    assert add_member.status_code == 201, add_member.text

    forbidden = member.post(
        f"/api/ai/projects/{project_uuid}/systems",
        json={"name": "不应创建的系统"},
    )
    assert forbidden.status_code == 403
    assert member.get(f"/api/ai/projects/{project_uuid}/initialization").status_code == 200
