from app.intent_router import route_intent


def test_route_intent_returns_ranked_task_candidates():
    tasks = [
        {
            "uuid": "1",
            "code": "work-summary",
            "name": "工作总结",
            "description": "整理周期工作成果",
            "assistant_name": "内部同事",
            "field_keywords": ["总结周期", "工作内容"],
        },
        {
            "uuid": "2",
            "code": "visit-notes",
            "name": "客户拜访纪要",
            "description": "整理客户拜访记录",
            "assistant_name": "客户经营",
            "field_keywords": ["客户名称", "拜访时间"],
        },
    ]

    result = route_intent("帮我整理这周工作总结", tasks)

    assert result[0]["uuid"] == "1"
    assert result[0]["score"] > result[1]["score"]
    assert "任务名称匹配：工作总结" in result[0]["reasons"]
