from dataclasses import dataclass

from .mode_router import ModeRouter


@dataclass(frozen=True)
class KnowledgeModeFilters:
    categories: tuple[str, ...] = ()
    document_types: tuple[str, ...] = ()


MODE_KNOWLEDGE_FILTERS: dict[str, KnowledgeModeFilters] = {
    "business": KnowledgeModeFilters(
        categories=("商务投标",),
        document_types=("服务方案", "投标文件", "报告模板"),
    ),
    "presales": KnowledgeModeFilters(
        categories=("产品资料", "售前资料"),
        document_types=("产品白皮书", "产品彩页", "技术方案"),
    ),
    "delivery": KnowledgeModeFilters(
        categories=("产品交付",),
        document_types=("安装部署手册", "管理员手册", "操作手册"),
    ),
    "security_ops": KnowledgeModeFilters(
        categories=("安全运维",),
        document_types=("巡检报告", "漏洞扫描报告", "整改模板"),
    ),
    "risk_assessment": KnowledgeModeFilters(
        categories=("风险评估", "等保合规"),
        document_types=("报告模板", "风险评估报告"),
    ),
    "incident_response": KnowledgeModeFilters(
        categories=("应急响应",),
        document_types=("应急预案", "检测过程", "处置流程", "应急响应报告"),
    ),
    "software_test": KnowledgeModeFilters(
        categories=("软件测试",),
        document_types=("测试报告", "测试用例"),
    ),
    "pentest": KnowledgeModeFilters(
        categories=("渗透测试",),
        document_types=("测试报告", "漏洞验证资料"),
    ),
}


def default_knowledge_filters_for_mode(mode: str) -> KnowledgeModeFilters:
    return MODE_KNOWLEDGE_FILTERS.get(ModeRouter.normalize(mode), KnowledgeModeFilters())


def merge_mode_knowledge_filters(
    *,
    mode: str,
    categories: list[str] | None = None,
    document_types: list[str] | None = None,
) -> tuple[list[str] | None, list[str] | None]:
    defaults = default_knowledge_filters_for_mode(mode)
    normalized_categories = [item.strip() for item in (categories or []) if item.strip()]
    normalized_document_types = [item.strip() for item in (document_types or []) if item.strip()]
    return (
        normalized_categories or list(defaults.categories) or None,
        normalized_document_types or list(defaults.document_types) or None,
    )
