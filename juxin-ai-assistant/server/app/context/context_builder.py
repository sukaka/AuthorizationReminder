from dataclasses import dataclass

from app.knowledge_search import RetrievedKnowledgeChunk
from app.schemas import MessageOut

from .prompt_loader import PromptLoader


@dataclass(frozen=True)
class RecentChatMessage:
    role: str
    content: str


@dataclass(frozen=True)
class GatheredContext:
    mode: str
    current_user_message: str
    knowledge_chunks: list[RetrievedKnowledgeChunk]
    personal_reference_chunks: list[RetrievedKnowledgeChunk]
    recent_messages: list[RecentChatMessage]
    long_term_memories: list[str]
    related_experiences: list[str]
    related_templates: list[str]
    related_failure_cases: list[str]
    require_knowledge_evidence: bool


@dataclass(frozen=True)
class SelectedContext:
    mode: str
    current_user_message: str
    knowledge_chunks: list[RetrievedKnowledgeChunk]
    personal_reference_chunks: list[RetrievedKnowledgeChunk]
    recent_messages: list[RecentChatMessage]
    older_messages: list[RecentChatMessage]
    long_term_memories: list[str]
    related_experiences: list[str]
    related_templates: list[str]
    related_failure_cases: list[str]
    require_knowledge_evidence: bool


@dataclass(frozen=True)
class CompressedContext:
    mode: str
    current_user_message: str
    knowledge_chunks: list[RetrievedKnowledgeChunk]
    personal_reference_chunks: list[RetrievedKnowledgeChunk]
    recent_messages: list[RecentChatMessage]
    conversation_summary: str
    long_term_memories: list[str]
    related_experiences: list[str]
    related_templates: list[str]
    related_failure_cases: list[str]
    require_knowledge_evidence: bool


@dataclass(frozen=True)
class StructuredContext:
    system_prompt: str
    recent_messages: list[RecentChatMessage]
    current_user_message: str


class ContextBuilder:
    def __init__(
        self,
        prompt_loader: PromptLoader | None = None,
        *,
        max_recent_messages: int = 8,
        max_evidence_chunks: int = 8,
    ) -> None:
        self.prompt_loader = prompt_loader or PromptLoader()
        self.max_recent_messages = max(0, int(max_recent_messages))
        self.max_evidence_chunks = max(1, int(max_evidence_chunks))

    def build_messages(
        self,
        *,
        mode: str,
        current_user_message: str,
        knowledge_chunks: list[RetrievedKnowledgeChunk],
        personal_reference_chunks: list[RetrievedKnowledgeChunk] | None = None,
        recent_messages: list[RecentChatMessage],
        long_term_memories: list[str] | None = None,
        related_experiences: list[str] | None = None,
        related_templates: list[str] | None = None,
        related_failure_cases: list[str] | None = None,
        require_knowledge_evidence: bool,
    ) -> list[MessageOut]:
        gathered = self.gather_context(
            mode=mode,
            current_user_message=current_user_message,
            knowledge_chunks=knowledge_chunks,
            personal_reference_chunks=personal_reference_chunks or [],
            recent_messages=recent_messages,
            long_term_memories=long_term_memories or [],
            related_experiences=related_experiences or [],
            related_templates=related_templates or [],
            related_failure_cases=related_failure_cases or [],
            require_knowledge_evidence=require_knowledge_evidence,
        )
        structured = self.structure_context(self.compress_context(self.select_context(gathered)))
        messages = [MessageOut(role="system", content=structured.system_prompt)]
        messages.extend(
            MessageOut(role=message.role, content=message.content)
            for message in structured.recent_messages
        )
        messages.append(MessageOut(role="user", content=structured.current_user_message))
        return messages

    def gather_context(
        self,
        *,
        mode: str,
        current_user_message: str,
        knowledge_chunks: list[RetrievedKnowledgeChunk],
        personal_reference_chunks: list[RetrievedKnowledgeChunk],
        recent_messages: list[RecentChatMessage],
        long_term_memories: list[str],
        related_experiences: list[str] | None = None,
        related_templates: list[str] | None = None,
        related_failure_cases: list[str] | None = None,
        require_knowledge_evidence: bool,
    ) -> GatheredContext:
        return GatheredContext(
            mode=mode,
            current_user_message=current_user_message,
            knowledge_chunks=knowledge_chunks,
            personal_reference_chunks=personal_reference_chunks,
            recent_messages=recent_messages,
            long_term_memories=long_term_memories,
            related_experiences=related_experiences or [],
            related_templates=related_templates or [],
            related_failure_cases=related_failure_cases or [],
            require_knowledge_evidence=require_knowledge_evidence,
        )

    def select_context(self, context: GatheredContext) -> SelectedContext:
        normalized_messages = [
            RecentChatMessage(role=message.role, content=message.content.strip())
            for message in context.recent_messages
            if message.role in {"user", "assistant"} and message.content.strip()
        ]
        if self.max_recent_messages:
            recent_messages = normalized_messages[-self.max_recent_messages:]
            older_messages = normalized_messages[:-self.max_recent_messages]
        else:
            recent_messages = []
            older_messages = normalized_messages
        return SelectedContext(
            mode=context.mode,
            current_user_message=context.current_user_message,
            knowledge_chunks=self._select_chunks(context.knowledge_chunks),
            personal_reference_chunks=self._select_chunks(context.personal_reference_chunks),
            recent_messages=recent_messages,
            older_messages=older_messages,
            long_term_memories=[
                memory.strip()
                for memory in context.long_term_memories
                if memory.strip()
            ][:8],
            related_experiences=[
                item.strip()
                for item in context.related_experiences
                if item.strip()
            ][:5],
            related_templates=[
                item.strip()
                for item in context.related_templates
                if item.strip()
            ][:5],
            related_failure_cases=[
                item.strip()
                for item in context.related_failure_cases
                if item.strip()
            ][:5],
            require_knowledge_evidence=context.require_knowledge_evidence,
        )

    def compress_context(self, context: SelectedContext) -> CompressedContext:
        return CompressedContext(
            mode=context.mode,
            current_user_message=context.current_user_message,
            knowledge_chunks=context.knowledge_chunks,
            personal_reference_chunks=context.personal_reference_chunks,
            recent_messages=context.recent_messages,
            conversation_summary=self._conversation_summary(context.older_messages),
            long_term_memories=context.long_term_memories,
            related_experiences=context.related_experiences,
            related_templates=context.related_templates,
            related_failure_cases=context.related_failure_cases,
            require_knowledge_evidence=context.require_knowledge_evidence,
        )

    def structure_context(self, context: CompressedContext) -> StructuredContext:
        system_prompt = "\n\n".join([
            self.prompt_loader.base_system_prompt(),
            "## company_profile\n\n" + self.prompt_loader.company_profile(),
            "## role_prompt\n\n" + self.prompt_loader.role_prompt(context.mode),
            "## context_structure\n\n"
            "Role / Task / Evidence / Context / Output。"
            "按角色约束、当前任务、资料证据、短期上下文、输出要求组织回答。",
            "## conversation_summary\n\n" + context.conversation_summary,
            "## long_term_memory\n\n" + self._long_term_memory_context(context.long_term_memories),
            "## official_knowledge_context\n\n"
            + self._official_knowledge_context(context.knowledge_chunks),
            "## personal_reference_context\n\n"
            + self._personal_reference_context(context.personal_reference_chunks),
            "## experience_library_context\n\n"
            + self._experience_library_context(context.related_experiences),
            "## template_library_context\n\n"
            + self._template_library_context(context.related_templates),
            "## failure_case_context\n\n"
            + self._failure_case_context(context.related_failure_cases),
            "## knowledge_policy\n\n" + self._knowledge_policy(
                knowledge_chunks=context.knowledge_chunks,
                personal_reference_chunks=context.personal_reference_chunks,
                require_knowledge_evidence=context.require_knowledge_evidence,
            ),
        ])
        return StructuredContext(
            system_prompt=system_prompt,
            recent_messages=context.recent_messages,
            current_user_message=context.current_user_message,
        )

    def _select_chunks(
        self,
        chunks: list[RetrievedKnowledgeChunk],
    ) -> list[RetrievedKnowledgeChunk]:
        selected: list[RetrievedKnowledgeChunk] = []
        seen: set[str] = set()
        for chunk in sorted(chunks, key=lambda item: item.score, reverse=True):
            identity = chunk.chunk_id or f"{chunk.file_uuid}:{chunk.chunk_index}"
            if identity in seen:
                continue
            seen.add(identity)
            selected.append(chunk)
            if len(selected) >= self.max_evidence_chunks:
                break
        return selected

    @staticmethod
    def _conversation_summary(older_messages: list[RecentChatMessage]) -> str:
        if not older_messages:
            return "暂无长期摘要；本次仅使用当前问题。聊天历史上下文与知识库上下文分开管理。"
        lines = [
            "以下为压缩后的较早对话，只用于保持任务连续性，不作为知识库证据。",
        ]
        for message in older_messages[-12:]:
            role = "用户" if message.role == "user" else "助手"
            content = " ".join(message.content.split())
            lines.append(f"- {role}: {content[:160]}")
        return "\n".join(lines)

    @staticmethod
    def _long_term_memory_context(long_term_memories: list[str]) -> str:
        policy = "长期记忆只用于输出偏好和默认选择，不能替代正式知识库依据。"
        normalized = [memory.strip() for memory in long_term_memories if memory.strip()]
        if not normalized:
            return policy + " 当前未提供相关长期记忆。"
        return policy + "\n" + "\n".join(
            f"- {memory[:500]}"
            for memory in normalized[:8]
        )

    @staticmethod
    def _experience_library_context(related_experiences: list[str]) -> str:
        if not related_experiences:
            return "暂无相关经验。"
        return "用户认可过的写法、结构和处理方式。可复用，但不得替代正式知识库证据。\n" + "\n".join(
            f"- {item[:600]}"
            for item in related_experiences[:5]
        )

    @staticmethod
    def _template_library_context(related_templates: list[str]) -> str:
        if not related_templates:
            return "暂无相关模板。"
        return "可复用的文档/提示词模板。优先用于结构和措辞，不得替代正式知识库事实依据。\n" + "\n".join(
            f"- {item[:800]}"
            for item in related_templates[:5]
        )

    @staticmethod
    def _failure_case_context(related_failure_cases: list[str]) -> str:
        if not related_failure_cases:
            return "暂无相关失败案例。"
        return "历史错误和防复发规则。回答前必须检查是否会重复犯错。\n" + "\n".join(
            f"- {item[:600]}"
            for item in related_failure_cases[:5]
        )

    @staticmethod
    def _source_location(chunk: RetrievedKnowledgeChunk) -> tuple[str, str]:
        section = chunk.section_path or chunk.section_title
        location = chunk.page_or_sheet
        if not location and chunk.page_number is not None:
            location = f"第 {chunk.page_number} 页"
        return section or "引用片段", location or "引用片段"

    @classmethod
    def _format_chunks(cls, chunks: list[RetrievedKnowledgeChunk]) -> str:
        if not chunks:
            return ""
        parts = []
        for index, chunk in enumerate(chunks, start=1):
            section, location = cls._source_location(chunk)
            parts.append(
                f"[{index}] 文件名：{chunk.file_name}\n"
                f"来源类型：{chunk.source_kind}\n"
                f"章节：{section}\n"
                f"位置：{location}\n"
                f"类型：{chunk.chunk_type or 'text'}\n"
                f"内容：{chunk.chunk_text}"
            )
        return "\n\n".join(parts)

    @classmethod
    def _official_knowledge_context(cls, chunks: list[RetrievedKnowledgeChunk]) -> str:
        if not chunks:
            return "当前未检索到正式知识库片段。"
        return (
            "以下内容来自管理员上传或审核通过的正式知识库，可作为正式回答依据。\n\n"
            + cls._format_chunks(chunks)
        )

    @classmethod
    def _personal_reference_context(cls, chunks: list[RetrievedKnowledgeChunk]) -> str:
        if not chunks:
            return "当前未检索到个人参考资料或当前会话附件。个人资料不能作为公司正式依据。"
        return (
            "以下内容仅来自当前用户的个人参考资料或当前会话附件。"
            "个人资料不能作为公司正式依据，生成内容末尾必须标注“参考资料：个人上传资料 / 当前会话附件”。\n\n"
            + cls._format_chunks(chunks)
        )

    @staticmethod
    def _knowledge_policy(
        *,
        knowledge_chunks: list[RetrievedKnowledgeChunk],
        personal_reference_chunks: list[RetrievedKnowledgeChunk],
        require_knowledge_evidence: bool,
    ) -> str:
        if knowledge_chunks:
            return (
                "本次已提供知识库片段。回答涉及资料内容时必须引用来源文件名、章节或页码；"
                "没有资料支持的产品功能、方案、参数、手册内容不得编造。"
            )
        if personal_reference_chunks:
            return (
                "本次只提供个人参考资料或当前会话附件。必须明确其不是公司正式知识依据；"
                "如果涉及聚信产品、方案、参数、手册等正式事实，仍需提示“当前正式知识库中未找到明确依据”。"
            )
        if require_knowledge_evidence:
            return "本次问题需要知识库依据，但未检索到片段；必须回答“当前知识库未找到明确依据”。"
        return (
            "本次未强制要求知识库依据。可以正常回答，但涉及聚信内部产品、方案、参数、手册、模板时，"
            "必须提示“当前知识库未找到明确依据”。"
        )
