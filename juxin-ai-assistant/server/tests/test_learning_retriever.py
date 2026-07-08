from app.learning_retriever import LearningRetriever
from app.models import ExperienceLibrary, FailureCaseLibrary, TemplateLibrary, UserMemory


def test_learning_retriever_prioritizes_user_memory_and_related_libraries(generation_db) -> None:
    generation_db.add_all([
        UserMemory(
            sso_user_id="user-learning",
            memory_type="correction",
            title="投标输出规则",
            content="投标回答必须先列评分点，再列响应表。",
            priority="high",
            tags_json=["投标"],
        ),
        UserMemory(
            sso_user_id="other-user",
            memory_type="correction",
            title="其他人规则",
            content="不应被当前用户读取。",
            priority="high",
            tags_json=["投标"],
        ),
        ExperienceLibrary(
            user_id="user-learning",
            task_type="bid_material",
            title="投标响应经验",
            question="如何写投标响应",
            answer="评分点、响应情况、证明材料三列表。",
            summary="投标材料先对齐评分点，再写响应。",
            tags_json=["投标"],
        ),
        FailureCaseLibrary(
            user_id="user-learning",
            task_type="bid_material",
            wrong_answer="直接写大段方案。",
            correction="先抽评分点，再逐项响应。",
            prevention_rule="投标类输出必须包含评分点对照。",
            tags_json=["投标"],
        ),
        TemplateLibrary(
            user_id="user-learning",
            template_name="个人投标模板",
            task_type="bid_material",
            template_content="一、评分点\n二、响应内容\n三、证明材料",
            scope="personal",
            review_status="draft",
            status="active",
        ),
        TemplateLibrary(
            user_id="admin",
            template_name="公司正式投标模板",
            task_type="bid_material",
            template_content="公司模板：评分点、响应、偏离说明。",
            scope="company",
            review_status="official",
            status="active",
        ),
        TemplateLibrary(
            user_id="admin",
            template_name="公司草稿模板",
            task_type="bid_material",
            template_content="草稿不能进入回答上下文。",
            scope="company",
            review_status="draft",
            status="active",
        ),
        TemplateLibrary(
            user_id="other-user",
            template_name="其他用户个人模板",
            task_type="bid_material",
            template_content="其他用户个人模板不能进入当前用户上下文。",
            scope="personal",
            review_status="draft",
            status="active",
        ),
    ])
    generation_db.commit()

    context = LearningRetriever().collect(
        generation_db,
        sso_user_id="user-learning",
        question="帮我写投标响应说明",
        task_type="bid_material",
        mode="business",
    )

    assert "投标回答必须先列评分点" in "\n".join(context.long_term_memories)
    assert "不应被当前用户读取" not in "\n".join(context.long_term_memories)
    assert "投标材料先对齐评分点" in "\n".join(context.related_experiences)
    assert "投标类输出必须包含评分点对照" in "\n".join(context.related_failure_cases)
    templates = "\n".join(context.related_templates)
    assert "个人投标模板" in templates
    assert "公司正式投标模板" in templates
    assert "公司草稿模板" not in templates
    assert "其他用户个人模板" not in templates
