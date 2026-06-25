from __future__ import annotations

from typing import Any


def route_intent(
    query: str,
    tasks: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    normalized_query = query.casefold().strip()
    if not normalized_query:
        return []

    candidates: list[dict[str, Any]] = []
    for task in tasks:
        score = 0
        reasons: list[str] = []
        name = str(task.get("name") or "")
        assistant_name = str(task.get("assistant_name") or "")
        description = str(task.get("description") or "")
        field_keywords = [
            str(item)
            for item in task.get("field_keywords") or []
            if str(item).strip()
        ]

        if name and name.casefold() in normalized_query:
            score += 5
            reasons.append(f"任务名称匹配：{name}")
        if assistant_name and assistant_name.casefold() in normalized_query:
            score += 3
            reasons.append(f"助手匹配：{assistant_name}")
        description_keywords = description.split()
        if description and len(description_keywords) == 1:
            description_keywords = [
                description[index:index + 2]
                for index in range(max(0, len(description) - 1))
            ]
        for keyword in description_keywords:
            if len(keyword) >= 2 and keyword.casefold() in normalized_query:
                score += 2
                reasons.append(f"描述匹配：{keyword}")
                break
        for keyword in field_keywords:
            if keyword.casefold() in normalized_query:
                score += 1
                reasons.append(f"字段匹配：{keyword}")

        if score <= 0:
            continue
        candidates.append({
            "uuid": str(task.get("uuid") or ""),
            "code": str(task.get("code") or ""),
            "name": name,
            "assistant_name": assistant_name,
            "score": score,
            "reasons": reasons,
        })

    candidates.sort(key=lambda item: (item["score"], item["uuid"]), reverse=True)
    return candidates[:3]
