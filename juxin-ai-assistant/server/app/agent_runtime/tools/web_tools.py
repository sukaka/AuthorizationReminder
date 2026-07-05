from __future__ import annotations

from datetime import UTC, datetime
import hashlib

from fastapi import HTTPException

from app.agent_runtime import BaseTool, ToolContext, ToolResult
from app.models import WebCapture, WebSearchLog
from app.web_sources import (
    CategorySuggester,
    ContentExtractor,
    WebContextBuilder,
    WebFetcher,
    WebSearchResult,
    WebSearchService,
)


def _web_result_payload(result: WebSearchResult) -> dict[str, str]:
    fetched_at = result.fetched_at or datetime.now(UTC)
    return {
        "title": result.title,
        "url": result.url,
        "site_name": result.site_name,
        "snippet": result.snippet,
        "published_at": result.published_at,
        "fetched_at": fetched_at.isoformat(),
    }


class WebSearchTool(BaseTool):
    name = "web_search"
    description = "联网查找公开资料"
    version = "1"

    def run(self, tool_input: dict, context: ToolContext) -> ToolResult:
        query = str(tool_input.get("query") or "").strip()
        if not query:
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="WEB_SEARCH_QUERY_REQUIRED",
                error_message_safe="搜索内容不能为空",
            )
        limit = max(1, min(int(tool_input.get("limit") or 5), 10))
        try:
            results = WebSearchService().search(
                query,
                limit=limit,
                db=context.db,
                user_id=context.user_id,
                bypass_cache=bool(tool_input.get("bypass_cache") or False),
            )
        except HTTPException as exc:
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="WEB_SEARCH_FAILED",
                error_message_safe=str(exc.detail),
            )
        payload_results = [_web_result_payload(result) for result in results]
        return ToolResult(
            tool_name=self.name,
            payload={
                "query": query,
                "results": payload_results,
                "context": WebContextBuilder().build(results),
            },
            output_summary={"result_count": len(payload_results)},
            source_count=len(payload_results),
        )


class WebCaptureTool(BaseTool):
    name = "web_capture"
    description = "抓取网页内容并生成保存前预览"
    version = "1"

    def run(self, tool_input: dict, context: ToolContext) -> ToolResult:
        if context.db is None:
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="WEB_CAPTURE_DB_REQUIRED",
                error_message_safe="网页抓取需要数据库连接",
            )
        url = str(tool_input.get("url") or "").strip()
        if not url:
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="WEB_CAPTURE_URL_REQUIRED",
                error_message_safe="网页地址不能为空",
            )
        try:
            fetch_result = WebFetcher().fetch(url)
            extracted = ContentExtractor().extract(fetch_result)
        except HTTPException as exc:
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="WEB_CAPTURE_FAILED",
                error_message_safe=str(exc.detail),
            )

        suggester = CategorySuggester()
        suggestion_text = "\n".join([extracted.title, extracted.summary, extracted.text[:2000]])
        capture = WebCapture(
            user_id=context.user_id,
            conversation_id=str(tool_input.get("conversation_id") or context.conversation_id or "").strip(),
            url=fetch_result.url,
            final_url=fetch_result.final_url,
            site_name=extracted.site_name,
            title=extracted.title,
            summary=extracted.summary,
            extracted_text=extracted.text,
            content_hash=hashlib.sha256(extracted.text.encode("utf-8")).hexdigest(),
            published_at_text=extracted.published_at,
            fetched_at=fetch_result.fetched_at.replace(tzinfo=None),
            word_count=extracted.word_count,
            suggested_category=suggester.suggest_category(suggestion_text),
            suggested_document_type=suggester.suggest_document_type(suggestion_text),
            status="previewed",
            review_status="none",
        )
        context.db.add(capture)
        context.db.flush()
        return ToolResult(
            tool_name=self.name,
            payload={
                "capture_id": capture.uuid,
                "title": capture.title,
                "site_name": capture.site_name,
                "url": capture.url,
                "final_url": capture.final_url,
                "summary": capture.summary,
                "word_count": capture.word_count,
                "suggested_category": capture.suggested_category,
                "suggested_document_type": capture.suggested_document_type,
                "scope": "确认前仅本次预览，不会写入正式知识库",
            },
            output_summary={
                "capture_id": capture.uuid,
                "suggested_category": capture.suggested_category,
            },
            source_count=1,
        )


class WebResearchTool(BaseTool):
    name = "web_research"
    description = "联网调研公开资料并生成来源报告"
    version = "1"

    def run(self, tool_input: dict, context: ToolContext) -> ToolResult:
        topic = str(tool_input.get("topic") or tool_input.get("query") or "").strip()
        if not topic:
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="WEB_RESEARCH_TOPIC_REQUIRED",
                error_message_safe="调研主题不能为空",
            )
        limit_per_question = max(1, min(int(tool_input.get("limit_per_question") or 3), 5))
        questions = _research_questions(topic)
        search_service = WebSearchService()
        sections: list[str] = []
        sources: list[dict[str, str]] = []
        for index, question in enumerate(questions, start=1):
            try:
                results = search_service.search(
                    question,
                    limit=limit_per_question,
                    db=context.db,
                    user_id=context.user_id,
                    bypass_cache=bool(tool_input.get("bypass_cache") or False),
                )
            except HTTPException as exc:
                sections.append(f"{index}. {question}\n   - 搜索失败：{exc.detail}")
                continue
            payload_results = [_web_result_payload(result) for result in results]
            if context.db is not None:
                context.db.add(WebSearchLog(
                    user_id=context.user_id,
                    conversation_id=context.conversation_id,
                    query=question,
                    provider="agent-web-research",
                    status="ok" if payload_results else "no_results",
                    result_count=len(payload_results),
                    result_urls_json=[item["url"] for item in payload_results],
                    used_urls_json=[item["url"] for item in payload_results],
                ))
            sources.extend(payload_results)
            summary_lines = [
                f"   - {item['title']}：{item['snippet']}（{item['url']}）"
                for item in payload_results
            ] or ["   - 暂无公开搜索结果。"]
            sections.append(f"{index}. {question}\n" + "\n".join(summary_lines))
        report = (
            "# 联网调研报告\n\n"
            f"## 调研主题\n{topic}\n\n"
            "## 子问题与公开来源\n"
            + "\n\n".join(sections)
            + "\n\n## 使用说明\n联网资料仅作为公开来源参考，不会自动进入公司正式知识库；保存前需要用户确认。"
        )
        return ToolResult(
            tool_name=self.name,
            payload={
                "topic": topic,
                "questions": questions,
                "sources": sources,
                "report": report,
                "scope": "联网资料仅作为公开来源参考，需用户确认后才可保存。",
            },
            output_summary={
                "question_count": len(questions),
                "source_count": len(sources),
            },
            source_count=len(sources),
        )


class DeepWebResearchTool(BaseTool):
    name = "deep_web_research"
    description = "深度联网调研公开资料，按多维问题聚合、去重、生成风险和落地建议"
    version = "1"

    def run(self, tool_input: dict, context: ToolContext) -> ToolResult:
        topic = str(tool_input.get("topic") or tool_input.get("query") or "").strip()
        if not topic:
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="DEEP_WEB_RESEARCH_TOPIC_REQUIRED",
                error_message_safe="调研主题不能为空",
            )
        limit_per_question = max(1, min(int(tool_input.get("limit_per_question") or 3), 5))
        questions = _deep_research_questions(topic)
        stages: list[dict[str, str]] = [
            {
                "role": "Planner",
                "status": "done",
                "summary": f"已拆解 {len(questions)} 个调研维度。",
            }
        ]
        search_service = WebSearchService()
        sections: list[str] = []
        unique_sources: dict[str, dict[str, str]] = {}
        failed_questions: list[str] = []
        for index, question in enumerate(questions, start=1):
            try:
                results = search_service.search(
                    question,
                    limit=limit_per_question,
                    db=context.db,
                    user_id=context.user_id,
                    bypass_cache=bool(tool_input.get("bypass_cache") or False),
                )
            except HTTPException as exc:
                failed_questions.append(f"{question}：{exc.detail}")
                if context.db is not None:
                    context.db.add(WebSearchLog(
                        user_id=context.user_id,
                        conversation_id=context.conversation_id,
                        query=question,
                        provider="agent-deep-web-research",
                        status="error",
                        result_count=0,
                        result_urls_json=[],
                        used_urls_json=[],
                        error_message=str(exc.detail),
                    ))
                sections.append(f"{index}. {question}\n   - 搜索失败：{exc.detail}")
                continue
            payload_results = [_web_result_payload(result) for result in results]
            if context.db is not None:
                context.db.add(WebSearchLog(
                    user_id=context.user_id,
                    conversation_id=context.conversation_id,
                    query=question,
                    provider="agent-deep-web-research",
                    status="ok" if payload_results else "no_results",
                    result_count=len(payload_results),
                    result_urls_json=[item["url"] for item in payload_results],
                    used_urls_json=[item["url"] for item in payload_results],
                ))
            for item in payload_results:
                unique_sources.setdefault(item["url"], item)
            lines = [
                f"   - {item['title']}：{item['snippet']}（{item['url']}）"
                for item in payload_results
            ] or ["   - 暂无公开搜索结果。"]
            sections.append(f"{index}. {question}\n" + "\n".join(lines))

        sources = list(unique_sources.values())
        search_status = "partial" if failed_questions else "done"
        stages.extend([
            {
                "role": "Searcher",
                "status": search_status,
                "summary": (
                    f"完成 {len(questions) - len(failed_questions)}/{len(questions)} 个维度搜索，"
                    f"去重后 {len(sources)} 个公开来源。"
                    + (f" 失败：{'; '.join(failed_questions[:2])}" if failed_questions else "")
                ),
            },
            {
                "role": "Summarizer",
                "status": "done",
                "summary": "已按调研维度整理公开来源摘要。",
            },
            {
                "role": "Reporter",
                "status": "done",
                "summary": "已生成聚信落地建议、风险与待确认事项。",
            },
        ])
        report = (
            "# 深度联网调研报告\n\n"
            f"## 调研主题\n{topic}\n\n"
            "## 调研维度\n"
            + "\n\n".join(sections)
            + "\n\n## 来源汇总\n"
            + "\n".join([f"- {item['title']}：{item['url']}" for item in sources] or ["- 暂无可用公开来源"])
            + "\n\n## 聚信落地建议\n"
            "1. 将公开资料作为方案背景和竞品参考，不直接作为正式承诺。\n"
            "2. 涉及产品能力、报价、交付周期、验收结论时，必须回到公司正式知识库和人工复核。\n"
            "3. 可结合售前、交付、安全运维场景整理为内部方案草稿。\n\n"
            "## 风险与待确认\n"
            "1. 公开资料可能过期或不完整，需确认发布时间和来源可信度。\n"
            "2. 不得把联网资料自动写入公司正式知识库。\n"
            "3. 对外材料需人工复核。"
        )
        return ToolResult(
            tool_name=self.name,
            status="partial" if failed_questions else "success",
            payload={
                "topic": topic,
                "questions": questions,
                "sources": sources,
                "stages": stages,
                "report": report,
                "scope": "深度联网资料仅作为公开来源参考，保存或入库前必须人工确认。",
            },
            output_summary={
                "question_count": len(questions),
                "unique_source_count": len(sources),
                "stage_count": len(stages),
                "failed_question_count": len(failed_questions),
            },
            source_count=len(sources),
        )


def _research_questions(topic: str) -> list[str]:
    normalized = " ".join(topic.split())
    base_questions = [
        f"{normalized} 背景和现状",
        f"{normalized} 关键要求",
        f"{normalized} 典型方案",
        f"{normalized} 风险和注意事项",
        f"{normalized} 采购或落地建议",
    ]
    return base_questions[:5]


def _deep_research_questions(topic: str) -> list[str]:
    normalized = " ".join(topic.split())
    return [
        f"{normalized} 背景 现状 趋势",
        f"{normalized} 政策 标准 合规要求",
        f"{normalized} 产品能力 技术架构",
        f"{normalized} 典型方案 交付路径",
        f"{normalized} 采购 招投标 评分要点",
        f"{normalized} 风险 问题 注意事项",
        f"{normalized} 竞品 对比 替代方案",
    ]
