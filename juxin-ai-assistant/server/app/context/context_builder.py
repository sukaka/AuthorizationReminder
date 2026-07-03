from dataclasses import dataclass

from app.knowledge_search import RetrievedKnowledgeChunk
from app.schemas import MessageOut

from .prompt_loader import PromptLoader


@dataclass(frozen=True)
class RecentChatMessage:
    role: str
    content: str


class ContextBuilder:
    def __init__(self, prompt_loader: PromptLoader | None = None) -> None:
        self.prompt_loader = prompt_loader or PromptLoader()

    def build_messages(
        self,
        *,
        mode: str,
        current_user_message: str,
        knowledge_chunks: list[RetrievedKnowledgeChunk],
        personal_reference_chunks: list[RetrievedKnowledgeChunk] | None = None,
        recent_messages: list[RecentChatMessage],
        long_term_memories: list[str] | None = None,
        require_knowledge_evidence: bool,
    ) -> list[MessageOut]:
        personal_chunks = personal_reference_chunks or []
        memories = long_term_memories or []
        system_prompt = "\n\n".join([
            self.prompt_loader.base_system_prompt(),
            "## company_profile\n\n" + self.prompt_loader.company_profile(),
            "## role_prompt\n\n" + self.prompt_loader.role_prompt(mode),
            "## conversation_summary\n\n" + self._conversation_summary(recent_messages),
            "## long_term_memory\n\n" + self._long_term_memory_context(memories),
            "## official_knowledge_context\n\n" + self._official_knowledge_context(knowledge_chunks),
            "## personal_reference_context\n\n" + self._personal_reference_context(personal_chunks),
            "## knowledge_policy\n\n" + self._knowledge_policy(
                knowledge_chunks=knowledge_chunks,
                personal_reference_chunks=personal_chunks,
                require_knowledge_evidence=require_knowledge_evidence,
            ),
        ])
        messages = [MessageOut(role="system", content=system_prompt)]
        messages.extend(
            MessageOut(role=message.role, content=message.content)
            for message in recent_messages
            if message.role in {"user", "assistant"} and message.content.strip()
        )
        messages.append(MessageOut(role="user", content=current_user_message))
        return messages

    @staticmethod
    def _conversation_summary(recent_messages: list[RecentChatMessage]) -> str:
        if not recent_messages:
            return "暂无长期摘要；本次仅使用当前问题。聊天历史上下文与知识库上下文分开管理。"
        return "暂无长期摘要；以下 recent_messages 仅用于保持短期对话连续性。"

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
