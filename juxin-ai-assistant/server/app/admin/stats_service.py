from datetime import date, datetime, time, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import FeedbackRecord, GenerationRecord, Task
from .errors import GovernanceError
from .schemas import CountByName, DailyCount, StatsOut


def _date_bounds(
    date_from: date | None,
    date_to: date | None,
) -> tuple[datetime, datetime]:
    end_date = date_to or date.today()
    start_date = date_from or (end_date - timedelta(days=29))
    if start_date > end_date:
        raise GovernanceError(
            422,
            "STATS_RANGE_INVALID",
            "统计开始日期不能晚于结束日期",
        )
    if (end_date - start_date).days > 365:
        raise GovernanceError(
            422,
            "STATS_RANGE_TOO_LARGE",
            "统计范围不能超过 366 天",
        )
    return (
        datetime.combine(start_date, time.min),
        datetime.combine(end_date, time.max),
    )


def build_stats(
    db: Session,
    *,
    departments: list[str] | None,
    date_from: date | None,
    date_to: date | None,
) -> StatsOut:
    start_at, end_at = _date_bounds(date_from, date_to)
    filters = [
        GenerationRecord.created_at >= start_at,
        GenerationRecord.created_at <= end_at,
        GenerationRecord.status != "DELETED",
    ]
    if departments is not None:
        if not departments:
            raise GovernanceError(
                403,
                "DEPARTMENT_SCOPE_FORBIDDEN",
                "没有可查看的管理部门",
            )
        filters.append(GenerationRecord.department_snapshot.in_(departments))

    status_rows = db.execute(
        select(GenerationRecord.status, func.count(GenerationRecord.id))
        .where(*filters)
        .group_by(GenerationRecord.status)
    ).all()
    status_counts = {status: int(count) for status, count in status_rows}
    total = sum(status_counts.values())
    completed = status_counts.get("COMPLETED", 0)
    failed = status_counts.get("FAILED", 0)

    department_rows = db.execute(
        select(
            GenerationRecord.department_snapshot,
            func.count(GenerationRecord.id),
        )
        .where(*filters)
        .group_by(GenerationRecord.department_snapshot)
        .order_by(GenerationRecord.department_snapshot)
    ).all()
    by_department = {
        department: int(count)
        for department, count in department_rows
    }

    ranking_rows = db.execute(
        select(Task.name, func.count(GenerationRecord.id).label("count"))
        .join(GenerationRecord, GenerationRecord.task_id == Task.id)
        .where(*filters)
        .group_by(Task.id, Task.name)
        .order_by(func.count(GenerationRecord.id).desc(), Task.name)
        .limit(20)
    ).all()

    daily_rows = db.execute(
        select(
            func.date(GenerationRecord.created_at).label("day"),
            func.count(GenerationRecord.id),
        )
        .where(*filters)
        .group_by(func.date(GenerationRecord.created_at))
        .order_by(func.date(GenerationRecord.created_at))
    ).all()

    feedback_rows = db.execute(
        select(
            FeedbackRecord.feedback_type,
            func.count(FeedbackRecord.id),
        )
        .join(
            GenerationRecord,
            GenerationRecord.id == FeedbackRecord.generation_id,
        )
        .where(*filters)
        .group_by(FeedbackRecord.feedback_type)
        .order_by(FeedbackRecord.feedback_type)
    ).all()

    visible_departments = (
        sorted(departments)
        if departments is not None
        else sorted(by_department)
    )
    return StatsOut(
        departments=visible_departments,
        total=total,
        completed=completed,
        failed=failed,
        completion_rate=round(completed / total, 4) if total else 0.0,
        failure_rate=round(failed / total, 4) if total else 0.0,
        by_department=by_department,
        task_ranking=[
            CountByName(name=name, count=int(count))
            for name, count in ranking_rows
        ],
        daily_trend=[
            DailyCount(date=str(day), count=int(count))
            for day, count in daily_rows
        ],
        feedback_distribution={
            feedback_type: int(count)
            for feedback_type, count in feedback_rows
        },
    )
