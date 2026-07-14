from sqlalchemy import select


def _create_project(client, name: str) -> dict:
    response = client.post(
        "/api/ai/projects",
        json={"name": name, "description": "项目任务测试"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_project_tasks_and_deliverables_are_isolated_and_track_activity(
    client_for_user,
    generation_db,
) -> None:
    owner = client_for_user("u-1")
    member = client_for_user("u-2")
    outsider = client_for_user("u-3")
    project_a = _create_project(owner, "项目 A")
    project_b = _create_project(owner, "项目 B")
    project_a_uuid = project_a["project_uuid"]
    project_b_uuid = project_b["project_uuid"]

    added = owner.post(
        f"/api/ai/projects/{project_a_uuid}/members",
        json={"user_id": "u-2", "role": "member"},
    )
    assert added.status_code == 201, added.text

    task = member.post(
        f"/api/ai/projects/{project_a_uuid}/tasks",
        json={
            "title": "完成范围核对",
            "description": "核对已确认的项目范围",
            "priority": "high",
            "assignee_user_id": "u-2",
        },
    )
    assert task.status_code == 201, task.text
    task_uuid = task.json()["task_uuid"]
    assert task.json()["status"] == "todo"

    assert outsider.get(f"/api/ai/projects/{project_a_uuid}/tasks").status_code == 404
    assert owner.get(f"/api/ai/projects/{project_b_uuid}/tasks").json() == []

    status = member.post(
        f"/api/ai/projects/{project_a_uuid}/tasks/{task_uuid}/status",
        json={"status": "in_progress"},
    )
    assert status.status_code == 200, status.text
    assert status.json()["status"] == "in_progress"

    deliverable = member.post(
        f"/api/ai/projects/{project_a_uuid}/deliverables",
        json={
            "task_uuid": task_uuid,
            "title": "范围核对记录",
            "deliverable_type": "report",
            "content_summary": "已完成范围核对，等待负责人审核",
        },
    )
    assert deliverable.status_code == 201, deliverable.text
    assert deliverable.json()["task_uuid"] == task_uuid
    deliverable_uuid = deliverable.json()["deliverable_uuid"]
    submitted = member.post(
        f"/api/ai/projects/{project_a_uuid}/deliverables/{deliverable_uuid}/status",
        json={"status": "in_review"},
    )
    assert submitted.status_code == 200, submitted.text

    approved = owner.post(
        f"/api/ai/projects/{project_a_uuid}/deliverables/{deliverable_uuid}/status",
        json={"status": "approved"},
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["approved_by"] == "u-1"

    issue = member.post(
        f"/api/ai/projects/{project_a_uuid}/issues",
        json={
            "title": "客户确认待补充",
            "description": "需要补充确认记录",
            "severity": "medium",
            "assignee_user_id": "u-1",
        },
    )
    assert issue.status_code == 201, issue.text
    issue_uuid = issue.json()["issue_uuid"]
    closed = owner.post(
        f"/api/ai/projects/{project_a_uuid}/issues/{issue_uuid}/status",
        json={"status": "closed", "resolution": "已补充确认记录"},
    )
    assert closed.status_code == 200, closed.text

    activities = owner.get(f"/api/ai/projects/{project_a_uuid}/activities")
    assert activities.status_code == 200, activities.text
    actions = {item["action"] for item in activities.json()}
    assert {
        "project.task.create",
        "project.task.status",
        "project.deliverable.create",
        "project.deliverable.status",
        "project.issue.create",
        "project.issue.status",
    }.issubset(actions)

    from app.project_task_models import ProjectDeliverable, ProjectTask

    assert generation_db.scalar(
        select(ProjectTask).where(ProjectTask.uuid == task_uuid)
    ) is not None
    assert generation_db.scalar(
        select(ProjectDeliverable).where(ProjectDeliverable.uuid == deliverable_uuid)
    ) is not None


def test_project_deliverable_approval_and_issue_closure_require_manager(client_for_user) -> None:
    owner = client_for_user("u-1")
    member = client_for_user("u-2")
    project_uuid = _create_project(owner, "权限项目")["project_uuid"]
    added = owner.post(
        f"/api/ai/projects/{project_uuid}/members",
        json={"user_id": "u-2", "role": "member"},
    )
    assert added.status_code == 201, added.text

    task = member.post(
        f"/api/ai/projects/{project_uuid}/tasks",
        json={"title": "成员任务"},
    )
    assert task.status_code == 201, task.text
    deliverable = member.post(
        f"/api/ai/projects/{project_uuid}/deliverables",
        json={"task_uuid": task.json()["task_uuid"], "title": "成员成果"},
    )
    assert deliverable.status_code == 201, deliverable.text
    deliverable_uuid = deliverable.json()["deliverable_uuid"]
    member_approval = member.post(
        f"/api/ai/projects/{project_uuid}/deliverables/{deliverable_uuid}/status",
        json={"status": "approved"},
    )
    assert member_approval.status_code == 403

    issue = member.post(
        f"/api/ai/projects/{project_uuid}/issues",
        json={"title": "成员问题"},
    )
    assert issue.status_code == 201, issue.text
    member_close = member.post(
        f"/api/ai/projects/{project_uuid}/issues/{issue.json()['issue_uuid']}/status",
        json={"status": "closed"},
    )
    assert member_close.status_code == 403
