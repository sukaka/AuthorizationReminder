from types import SimpleNamespace

from app.knowledge_routes import _can_view_file


def test_admin_scope_never_uses_owner_bypass() -> None:
    file_record = SimpleNamespace(
        owner_user_id="user-1",
        usage_type="official_knowledge",
        review_status="official",
        permission_scope="admin",
    )

    assert _can_view_file(file_record, user_id="user-1", is_admin=False) is False
    assert _can_view_file(
        file_record,
        user_id="admin-1",
        is_admin=True,
        admin_access_granted=True,
    ) is True
