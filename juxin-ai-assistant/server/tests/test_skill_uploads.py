from __future__ import annotations

import io
import json
import zipfile

import pytest


REQUIRED_FILES = {
    "SKILL.md": "# 测试 Skill\n",
    "prompts/system.md": "你是一个测试助手。\n",
    "prompts/task.md": "请完成输入任务。\n",
    "prompts/output.md": "输出结构化结果。\n",
    "schemas/input.schema.json": "{}",
    "schemas/output.schema.json": "{}",
    "examples/good.md": "正确示例\n",
    "examples/bad.md": "错误示例\n",
    "eval/checklist.md": "检查清单\n",
}


def skill_zip(skill_id: str = "uploaded-skill") -> bytes:
    manifest = {
        "id": skill_id,
        "name": "上传测试能力",
        "description": "用于验证上传、隔离和审核流程。",
        "category": "test",
        "version": "1.0.0",
        "status": "draft",
        "scope": "company",
        "owner": "package-owner",
        "allowed_tools": [],
        "input_types": ["text"],
        "output_types": ["markdown"],
        "permissions": {
            "allow_web": False,
            "allow_company_knowledge": False,
            "allow_personal_memory": False,
            "allow_write_company_kb": False,
        },
        "review": {"required_for_publish": True, "reviewer_role": "admin"},
        "tags": ["测试"],
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("skill.json", json.dumps(manifest, ensure_ascii=False))
        for name, content in REQUIRED_FILES.items():
            archive.writestr(name, content)
    return buffer.getvalue()


@pytest.fixture
def skill_storage(tmp_path):
    from app.config import get_settings
    from app.main import app

    settings = get_settings().model_copy(update={"skill_storage_dir": str(tmp_path / "skills")})
    app.dependency_overrides[get_settings] = lambda: settings
    try:
        yield settings
    finally:
        app.dependency_overrides.pop(get_settings, None)


def upload(client, package: bytes, filename: str = "skill.zip"):
    return client.post(
        "/api/skills/uploads",
        files={"file": (filename, package, "application/zip")},
    )


def test_personal_skill_upload_is_private_and_immediately_usable(
    client_for_user,
    skill_storage,
):
    owner = client_for_user("skill-owner")
    other_user = client_for_user("skill-other")

    response = upload(owner, skill_zip())
    assert response.status_code == 201
    assert response.json()["source"] == "uploaded"
    assert response.json()["scope"] == "personal"
    assert response.json()["status"] == "published"

    mine = owner.get("/api/skills/mine")
    assert mine.status_code == 200
    assert [item["id"] for item in mine.json()["items"]] == ["uploaded-skill"]
    assert "uploaded-skill" in {item["id"] for item in owner.get("/api/skills").json()["items"]}
    assert "uploaded-skill" not in {item["id"] for item in other_user.get("/api/skills").json()["items"]}

    disabled = owner.post("/api/skills/mine/uploaded-skill/disable")
    assert disabled.status_code == 200
    assert disabled.json()["status"] == "disabled"
    assert "uploaded-skill" not in {item["id"] for item in owner.get("/api/skills").json()["items"]}


def test_only_admin_can_upload_company_skill_and_publish_it(
    client_for_user,
    skill_storage,
):
    employee = client_for_user("skill-employee")
    denied = employee.post(
        "/api/admin/skills/uploads",
        files={"file": ("skill.zip", skill_zip("company-skill"), "application/zip")},
    )
    assert denied.status_code == 403

    admin = client_for_user("skill-admin", role="admin")
    pending = admin.post(
        "/api/admin/skills/uploads",
        files={"file": ("company.zip", skill_zip("company-skill"), "application/zip")},
    )
    assert pending.status_code == 201
    assert pending.json()["scope"] == "company"
    assert pending.json()["status"] == "pending_review"
    assert "company-skill" not in {item["id"] for item in employee.get("/api/skills").json()["items"]}

    published = admin.post("/api/admin/skills/company-skill/publish")
    assert published.status_code == 200
    assert published.json()["status"] == "published"
    assert "company-skill" in {item["id"] for item in employee.get("/api/skills").json()["items"]}


def test_skill_upload_rejects_invalid_zip_paths(client_for_user, skill_storage):
    client = client_for_user("skill-owner")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("../skill.json", "{}")
    response = upload(client, buffer.getvalue(), "unsafe.zip")
    assert response.status_code == 400
    assert response.json()["detail"] == "SKILL_ARCHIVE_PATH_INVALID"
