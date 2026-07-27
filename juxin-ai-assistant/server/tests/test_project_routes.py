import asyncio

import httpx
from starlette.requests import Request
from sqlalchemy import select


def _create_project(client, name: str = "项目一") -> dict:
    response = client.post(
        "/api/ai/projects",
        json={"name": name, "description": "项目说明"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_project_creation_creates_owner_and_isolates_projects(
    client_for_user,
    generation_db,
) -> None:
    from app.project_workspace_models import Project, ProjectMember

    owner = client_for_user("u-1")
    outsider = client_for_user("u-2")

    project = _create_project(owner)

    assert project["name"] == "项目一"
    assert project["owner_user_id"] == "u-1"
    assert owner.get(f"/api/ai/projects/{project['project_uuid']}").json()["members"] == [
        {
            **owner.get(f"/api/ai/projects/{project['project_uuid']}").json()["members"][0],
            "username": "user-u-1",
        }
    ]
    assert [item["project_uuid"] for item in owner.get("/api/ai/projects").json()] == [
        project["project_uuid"]
    ]
    assert outsider.get("/api/ai/projects").json() == []
    assert outsider.get(f"/api/ai/projects/{project['project_uuid']}").status_code == 404

    project_row = generation_db.scalar(
        select(Project).where(Project.uuid == project["project_uuid"])
    )
    assert project_row is not None
    member = generation_db.scalar(
        select(ProjectMember).where(ProjectMember.project_id == project_row.id)
    )
    assert member is not None
    assert member.user_id == "u-1"
    assert member.role == "project_lead"


def test_project_membership_grants_access_but_regular_members_cannot_manage_members(
    client_for_user,
) -> None:
    owner = client_for_user("u-1")
    member = client_for_user("u-2")
    outsider = client_for_user("u-3")
    project = _create_project(owner)
    project_uuid = project["project_uuid"]

    add_member = owner.post(
        f"/api/ai/projects/{project_uuid}/members",
        json={"user_id": "u-2", "role": "member"},
    )
    assert add_member.status_code == 201, add_member.text
    assert add_member.json()["role"] == "member"
    assert add_member.json()["username"] == ""

    assert member.get(f"/api/ai/projects/{project_uuid}").status_code == 200
    assert outsider.get(f"/api/ai/projects/{project_uuid}/members").status_code == 404

    forbidden = member.post(
        f"/api/ai/projects/{project_uuid}/members",
        json={"user_id": "u-3", "role": "reviewer"},
    )
    assert forbidden.status_code == 403

    add_reviewer = owner.post(
        f"/api/ai/projects/{project_uuid}/members",
        json={"user_id": "u-3", "role": "reviewer"},
    )
    assert add_reviewer.status_code == 201, add_reviewer.text


def test_project_member_role_and_duplicate_are_validated(client_for_user) -> None:
    owner = client_for_user("u-1")
    project_uuid = _create_project(owner)["project_uuid"]

    invalid_role = owner.post(
        f"/api/ai/projects/{project_uuid}/members",
        json={"user_id": "u-2", "role": "owner"},
    )
    assert invalid_role.status_code == 422

    first = owner.post(
        f"/api/ai/projects/{project_uuid}/members",
        json={"user_id": "u-2", "role": "read_only"},
    )
    assert first.status_code == 201
    duplicate = owner.post(
        f"/api/ai/projects/{project_uuid}/members",
        json={"user_id": "u-2", "role": "read_only"},
    )
    assert duplicate.status_code == 409


def test_project_managers_can_update_and_remove_members_without_touching_owner(
    client_for_user,
) -> None:
    owner = client_for_user("u-1")
    project_uuid = _create_project(owner)["project_uuid"]
    added = owner.post(
        f"/api/ai/projects/{project_uuid}/members",
        json={"user_id": "u-2", "role": "member"},
    )
    assert added.status_code == 201

    updated = owner.patch(
        f"/api/ai/projects/{project_uuid}/members/{added.json()['member_uuid']}",
        json={"role": "reviewer"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["role"] == "reviewer"

    removed = owner.delete(
        f"/api/ai/projects/{project_uuid}/members/{added.json()['member_uuid']}"
    )
    assert removed.status_code == 204, removed.text
    assert owner.get(f"/api/ai/projects/{project_uuid}/members").json() == [
        {
            **owner.get(f"/api/ai/projects/{project_uuid}/members").json()[0],
            "role": "project_lead",
        }
    ]

    owner_member_uuid = owner.get(
        f"/api/ai/projects/{project_uuid}/members"
    ).json()[0]["member_uuid"]
    cannot_demote_owner = owner.patch(
        f"/api/ai/projects/{project_uuid}/members/{owner_member_uuid}",
        json={"role": "read_only"},
    )
    assert cannot_demote_owner.status_code == 409


def test_project_manager_lists_only_available_member_candidates(
    client_for_user,
    monkeypatch,
) -> None:
    from app.project_routes import ProjectMemberCandidateOut

    async def fake_directory(*_args, **_kwargs):
        return [
            ProjectMemberCandidateOut(
                user_id="u-1",
                username="项目负责人",
                role="employee",
                department_code="sales",
            ),
            ProjectMemberCandidateOut(
                user_id="u-2",
                username="现有成员",
                role="employee",
                department_code="delivery",
            ),
            ProjectMemberCandidateOut(
                user_id="u-3",
                username="候选成员",
                role="employee",
                department_code="security",
            ),
        ]

    monkeypatch.setattr(
        "app.project_routes._fetch_system_user_directory",
        fake_directory,
    )
    owner = client_for_user("u-1")
    regular_member = client_for_user("u-2")
    project_uuid = _create_project(owner)["project_uuid"]
    assert owner.post(
        f"/api/ai/projects/{project_uuid}/members",
        json={"user_id": "u-2", "role": "member"},
    ).status_code == 201

    response = owner.get(f"/api/ai/projects/{project_uuid}/member-candidates")

    assert response.status_code == 200, response.text
    assert response.json() == [
        {
            "user_id": "u-3",
            "username": "候选成员",
            "role": "employee",
            "department_code": "security",
        }
    ]
    assert (
        regular_member.get(
            f"/api/ai/projects/{project_uuid}/member-candidates"
        ).status_code
        == 403
    )


def test_system_user_directory_forwards_login_and_normalizes_response(
    respx_mock,
) -> None:
    from app.config import Settings
    from app.project_routes import _fetch_system_user_directory

    route = respx_mock.get(
        "http://auth.test:5180/api/auth/system-users",
        params={"system": "ai-assistant"},
    ).mock(
        return_value=httpx.Response(
            200,
            json=[
                {
                    "id": 23,
                    "username": "李雷",
                    "role": "employee",
                    "department_code": "delivery",
                },
                {"id": "", "username": "无效记录"},
            ],
        )
    )
    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "headers": [(b"authorization", b"Bearer test-login-token")],
        }
    )
    settings = Settings(
        auth_dev_bypass=False,
        auth_service_url="http://auth.test:5180",
    )

    candidates = asyncio.run(_fetch_system_user_directory(request, settings))

    assert route.called
    sent_request = route.calls.last.request
    assert sent_request.headers["authorization"] == "Bearer test-login-token"
    assert [candidate.model_dump() for candidate in candidates] == [
        {
            "user_id": "23",
            "username": "李雷",
            "role": "employee",
            "department_code": "delivery",
        }
    ]
