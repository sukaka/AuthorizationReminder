#!/usr/bin/env python3
"""Export redacted production retrieval rankings for the offline eval suite.

The command requires an explicit database URL and user id.  It never writes
answers, source text, file names, scores, or user identifiers to the output;
only case ids and ranked knowledge chunk ids are persisted.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import sys


SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

from app.config import get_settings
from app.crypto import ContentCipher
from app.retrieval_eval import DEFAULT_CASES_PATH, load_retrieval_eval_cases
from app.retrieval_eval_export import collect_production_rankings, write_rankings_json


def main() -> int:
    parser = argparse.ArgumentParser(description="导出脱敏的生产检索 chunk_id 排名")
    parser.add_argument("--database-url", required=True, help="显式数据库连接串")
    parser.add_argument("--sso-user-id", required=True, help="评测用户的 SSO id")
    parser.add_argument("--output", required=True, type=Path, help="排名 JSON 输出路径")
    parser.add_argument("--cases", type=Path, default=DEFAULT_CASES_PATH)
    parser.add_argument("--top-k", type=int, default=12)
    parser.add_argument("--knowledge-base-id", action="append", default=[])
    parser.add_argument("--category", action="append", default=[])
    parser.add_argument("--document-type", action="append", default=[])
    parser.add_argument(
        "--content-encryption-key-env",
        default="CONTENT_ENCRYPTION_KEY",
        help="内容加密密钥所在的环境变量名（不会打印其值）",
    )
    parser.add_argument(
        "--use-configured-indexes",
        action="store_true",
        help="使用配置的 Qdrant/Tantivy 索引；默认仅使用数据库内混合检索",
    )
    args = parser.parse_args()
    if args.top_k <= 0:
        parser.error("--top-k 必须是正整数")
    encoded_key = os.environ.get(args.content_encryption_key_env, "").strip()
    if not encoded_key:
        parser.error(
            f"缺少 {args.content_encryption_key_env}；请通过环境变量提供，不要写入命令行或文件"
        )

    cipher = ContentCipher(encoded_key)
    from app.database import create_engine_for_url, get_session_for_url

    vector_index = None
    keyword_index = None
    knowledge_cache = None
    if args.use_configured_indexes:
        settings = get_settings()
        from app.knowledge_cache import RedisKnowledgeCache
        from app.knowledge_keyword_index import TantivyKnowledgeIndex
        from app.knowledge_vector_index import QdrantKnowledgeIndex

        vector_index = QdrantKnowledgeIndex.from_settings(settings, dimensions=128)
        keyword_index = TantivyKnowledgeIndex.from_settings(settings)
        knowledge_cache = RedisKnowledgeCache.from_settings(settings)
    else:
        # Passing explicit disabled indexes prevents search_knowledge_chunks
        # from loading implicit Qdrant/Redis settings or making network calls.
        from app.knowledge_keyword_index import TantivyKnowledgeIndex
        from app.knowledge_vector_index import QdrantKnowledgeIndex

        vector_index = QdrantKnowledgeIndex(
            url="",
            collection="",
            dimensions=128,
            enabled=False,
        )
        keyword_index = TantivyKnowledgeIndex(path="", enabled=False)

    engine = create_engine_for_url(args.database_url)
    try:
        cases = load_retrieval_eval_cases(args.cases)
        with get_session_for_url(engine, args.database_url) as db:
            rankings = collect_production_rankings(
                cases,
                db=db,
                cipher=cipher,
                sso_user_id=args.sso_user_id,
                top_k=args.top_k,
                knowledge_base_ids=args.knowledge_base_id or None,
                categories=args.category or None,
                document_types=args.document_type or None,
                vector_index=vector_index,
                keyword_index=keyword_index,
                knowledge_cache=knowledge_cache,
            )
        write_rankings_json(args.output, rankings)
    finally:
        engine.dispose()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
