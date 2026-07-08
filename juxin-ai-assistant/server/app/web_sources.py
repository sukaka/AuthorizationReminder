from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import hashlib
from html.parser import HTMLParser
import html
import ipaddress
import re
import socket
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

import httpx
from fastapi import HTTPException


MAX_WEB_FETCH_BYTES = 5 * 1024 * 1024
WEB_FETCH_TIMEOUT_SECONDS = 8.0
MAX_EXTRACTED_TEXT_CHARS = 60_000

URL_PATTERN = re.compile(r"https?://[^\s<>'\"，。；;、）)】]+", re.IGNORECASE)
LATEST_PATTERNS = re.compile(
    r"(最新|当前|现在|联网|搜索一下|查官网|查最新|官网|官方文档|CVE-\d{4}-\d{4,}|CNVD|CNNVD|NVD|漏洞公告|版本发布|release notes?|API 文档|SDK|政策|法规|标准)",
    re.IGNORECASE,
)
INTERNAL_HOST_SUFFIXES = (
    ".local",
    ".internal",
    ".intranet",
    ".lan",
    ".corp",
)


@dataclass(frozen=True)
class WebFetchResult:
    url: str
    final_url: str
    status_code: int
    content_type: str
    content: bytes
    fetched_at: datetime


@dataclass(frozen=True)
class ExtractedWebContent:
    title: str
    site_name: str
    description: str
    text: str
    summary: str
    word_count: int
    published_at: str = ""


@dataclass(frozen=True)
class WebSearchResult:
    title: str
    url: str
    site_name: str
    snippet: str
    published_at: str = ""
    fetched_at: datetime | None = None


class SearchIntentDetector:
    def should_search(self, text: str) -> bool:
        stripped = text.strip()
        if not stripped:
            return False
        if UrlExtractor().extract_first(stripped):
            return False
        return bool(LATEST_PATTERNS.search(stripped))


class UrlExtractor:
    def extract_all(self, text: str) -> list[str]:
        urls: list[str] = []
        for match in URL_PATTERN.findall(text):
            normalized = match.rstrip("。；;，,")
            if normalized not in urls:
                urls.append(normalized)
        return urls

    def extract_first(self, text: str) -> str:
        urls = self.extract_all(text)
        return urls[0] if urls else ""


class WebSafetyValidator:
    def __init__(self, *, resolver: callable | None = None):
        self._resolver = resolver or socket.getaddrinfo

    def validate_url(self, url: str) -> str:
        parsed = urlparse(url.strip())
        if parsed.scheme.lower() not in {"http", "https"}:
            raise HTTPException(status_code=422, detail="仅允许采集 HTTP 或 HTTPS 网页")
        if not parsed.netloc or not parsed.hostname:
            raise HTTPException(status_code=422, detail="网页地址无效")
        host = parsed.hostname.strip().lower().rstrip(".")
        if host in {"localhost", "0.0.0.0"} or host.endswith(INTERNAL_HOST_SUFFIXES):
            raise HTTPException(status_code=422, detail="不允许采集本机或内网地址")
        self._validate_host_addresses(host)
        return parsed.geturl()

    def _validate_host_addresses(self, host: str) -> None:
        try:
            literal = ipaddress.ip_address(host)
        except ValueError:
            literal = None
        if literal is not None:
            self._ensure_public_address(literal)
            return

        try:
            addresses = self._resolver(host, None)
        except socket.gaierror as exc:
            raise HTTPException(status_code=422, detail="网页域名无法解析") from exc
        if not addresses:
            raise HTTPException(status_code=422, detail="网页域名无法解析")
        for address in addresses:
            ip_text = address[4][0]
            try:
                self._ensure_public_address(ipaddress.ip_address(ip_text))
            except ValueError as exc:
                raise HTTPException(status_code=422, detail="网页域名解析结果无效") from exc

    @staticmethod
    def _ensure_public_address(address: ipaddress._BaseAddress) -> None:
        if (
            address.is_private
            or address.is_loopback
            or address.is_link_local
            or address.is_reserved
            or address.is_multicast
            or address.is_unspecified
        ):
            raise HTTPException(status_code=422, detail="不允许采集本机或内网地址")


class WebFetcher:
    def __init__(self, *, validator: WebSafetyValidator | None = None):
        self.validator = validator or WebSafetyValidator()

    def fetch(self, url: str) -> WebFetchResult:
        safe_url = self.validator.validate_url(url)
        try:
            with httpx.Client(
                follow_redirects=True,
                timeout=WEB_FETCH_TIMEOUT_SECONDS,
                headers={"User-Agent": "JuxinAI-Assistant-WebCapture/1.0"},
            ) as client:
                response = client.get(safe_url)
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail="网页暂时无法访问") from exc

        final_url = self.validator.validate_url(str(response.url))
        content_length = response.headers.get("content-length")
        if content_length and int(content_length) > MAX_WEB_FETCH_BYTES:
            raise HTTPException(status_code=413, detail="网页内容超过采集大小限制")
        if len(response.content) > MAX_WEB_FETCH_BYTES:
            raise HTTPException(status_code=413, detail="网页内容超过采集大小限制")
        if response.status_code >= 400:
            raise HTTPException(status_code=502, detail="网页返回异常状态")
        return WebFetchResult(
            url=safe_url,
            final_url=final_url,
            status_code=response.status_code,
            content_type=response.headers.get("content-type", ""),
            content=response.content,
            fetched_at=datetime.now(UTC),
        )


class SearchProvider:
    name = "duckduckgo-html"

    def search(self, query: str, *, limit: int = 5) -> list[WebSearchResult]:
        raise NotImplementedError


class DuckDuckGoSearchProvider(SearchProvider):
    def search(self, query: str, *, limit: int = 5) -> list[WebSearchResult]:
        try:
            response = httpx.get(
                "https://html.duckduckgo.com/html/",
                params={"q": query},
                headers={"User-Agent": "JuxinAI-Assistant-WebSearch/1.0"},
                timeout=WEB_FETCH_TIMEOUT_SECONDS,
                follow_redirects=True,
            )
            response.raise_for_status()
        except httpx.HTTPError:
            return []
        return self._parse_results(response.text)[:limit]

    def _parse_results(self, html_text: str) -> list[WebSearchResult]:
        results: list[WebSearchResult] = []
        for block in re.split(r"<div[^>]+class=\"result[^\"]*\"", html_text, flags=re.IGNORECASE)[1:]:
            link_match = re.search(
                r"<a[^>]+class=\"result__a\"[^>]+href=\"([^\"]+)\"[^>]*>(.*?)</a>",
                block,
                flags=re.IGNORECASE | re.DOTALL,
            )
            if not link_match:
                continue
            raw_url = html.unescape(link_match.group(1))
            parsed_redirect = urlparse(raw_url)
            if parsed_redirect.path == "/l/":
                raw_url = parse_qs(parsed_redirect.query).get("uddg", [raw_url])[0]
            url = unquote(raw_url)
            title = _strip_html(link_match.group(2))
            snippet_match = re.search(
                r"<a[^>]+class=\"result__snippet\"[^>]*>(.*?)</a>|<div[^>]+class=\"result__snippet\"[^>]*>(.*?)</div>",
                block,
                flags=re.IGNORECASE | re.DOTALL,
            )
            snippet = _strip_html((snippet_match.group(1) or snippet_match.group(2)) if snippet_match else "")
            site = urlparse(url).hostname or ""
            if title and url.startswith(("http://", "https://")):
                results.append(WebSearchResult(title=title, url=url, site_name=site, snippet=snippet))
        return results


def create_search_provider(name: str | None = None) -> SearchProvider:
    normalized = (name or "").strip().lower()
    providers: dict[str, type[SearchProvider]] = {
        "duckduckgo-html": DuckDuckGoSearchProvider,
        "duckduckgo": DuckDuckGoSearchProvider,
    }
    return providers.get(normalized, DuckDuckGoSearchProvider)()


def _strip_html(value: str) -> str:
    without_tags = re.sub(r"<[^>]+>", " ", value)
    return re.sub(r"\s+", " ", html.unescape(without_tags)).strip()


class SourceRanker:
    def rank(self, results: list[WebSearchResult]) -> list[WebSearchResult]:
        def score(result: WebSearchResult) -> tuple[int, int]:
            host = result.site_name.lower()
            official_bonus = 2 if any(part in host for part in (".gov", ".edu", "nvd.nist.gov", "cve.org")) else 0
            content_bonus = 1 if result.snippet else 0
            return (official_bonus + content_bonus, len(result.title))

        return sorted(results, key=score, reverse=True)


class WebContextBuilder:
    def build(self, results: list[WebSearchResult]) -> str:
        if not results:
            return (
                "【联网搜索结果】\n"
                "未找到可靠来源。\n\n"
                "【回答要求】\n"
                "请明确说明未找到可靠来源，不要使用模型记忆补充最新事实。"
            )
        sections: list[str] = ["【联网搜索结果】"]
        for index, result in enumerate(results, start=1):
            fetched_at = result.fetched_at or datetime.now(UTC)
            sections.append(
                "\n".join([
                    f"来源 {index}：",
                    f"标题：{result.title}",
                    f"站点：{result.site_name or '待确认'}",
                    f"链接：{result.url}",
                    f"发布时间：{result.published_at or '待确认'}",
                    f"抓取时间：{fetched_at.isoformat()}",
                    f"内容片段：{result.snippet or '暂无'}",
                ])
            )
        sections.append(
            "【回答要求】\n"
            "请只基于以上联网搜索结果回答。"
            "如果没有明确依据，请说明未找到可靠来源。"
            "回答末尾列出来源，至少包含标题和 URL。"
        )
        return "\n\n".join(sections)


class WebSearchService:
    def __init__(
        self,
        *,
        provider: SearchProvider | None = None,
        validator: WebSafetyValidator | None = None,
        fetcher: WebFetcher | None = None,
        extractor: ContentExtractor | None = None,
    ):
        self.provider = provider or create_search_provider()
        self.validator = validator or WebSafetyValidator()
        self.fetcher = fetcher or WebFetcher(validator=self.validator)
        self.extractor = extractor or ContentExtractor()
        self.ranker = SourceRanker()

    def search(
        self,
        query: str,
        *,
        limit: int = 5,
        db: Any | None = None,
        user_id: str = "",
        bypass_cache: bool = False,
    ) -> list[WebSearchResult]:
        cache = SearchCache()
        if db is not None and not bypass_cache:
            cached = cache.get(db, query=query, provider=self.provider.name, limit=limit)
            if cached:
                return cached

        raw_results = self.provider.search(query, limit=max(limit * 3, limit))
        safe_results: list[WebSearchResult] = []
        for result in raw_results:
            try:
                safe_url = self.validator.validate_url(result.url)
            except HTTPException:
                continue
            safe_results.append(self._fetch_candidate_body(result, safe_url))
        ranked = self.ranker.rank(safe_results)[:limit]
        if db is not None:
            cache.set(
                db,
                query=query,
                provider=self.provider.name,
                results=ranked,
                user_id=user_id,
            )
        return ranked

    def _fetch_candidate_body(self, result: WebSearchResult, safe_url: str) -> WebSearchResult:
        try:
            fetch_result = self.fetcher.fetch(safe_url)
            content = self.extractor.extract(fetch_result)
        except HTTPException:
            return WebSearchResult(
                title=result.title,
                url=safe_url,
                site_name=result.site_name or (urlparse(safe_url).hostname or ""),
                snippet=result.snippet,
                published_at=result.published_at,
                fetched_at=result.fetched_at or datetime.now(UTC),
            )
        return WebSearchResult(
            title=content.title or result.title,
            url=fetch_result.final_url or safe_url,
            site_name=content.site_name or result.site_name,
            snippet=_search_result_snippet(content.summary, content.text, fallback=result.snippet),
            published_at=content.published_at or result.published_at,
            fetched_at=fetch_result.fetched_at,
        )


def _search_result_snippet(summary: str, text: str, *, fallback: str) -> str:
    parts = [summary.strip(), text.strip()[:1200]]
    snippet = "\n".join(part for part in parts if part)
    return snippet[:1600] or fallback


class SearchCache:
    def get(
        self,
        db: Any,
        *,
        query: str,
        provider: str,
        limit: int,
    ) -> list[WebSearchResult]:
        from .models import SearchCache as SearchCacheRecord
        from sqlalchemy import select

        key = self.cache_key(query, provider)
        now = datetime.now(UTC).replace(tzinfo=None)
        record = db.scalar(
            select(SearchCacheRecord).where(
                SearchCacheRecord.cache_key == key,
                (SearchCacheRecord.expires_at.is_(None)) | (SearchCacheRecord.expires_at > now),
            )
        )
        if record is None:
            return []
        payload = record.payload_json or {}
        return [
            _web_result_from_payload(item)
            for item in payload.get("results", [])[:limit]
            if isinstance(item, dict)
        ]

    def set(
        self,
        db: Any,
        *,
        query: str,
        provider: str,
        results: list[WebSearchResult],
        user_id: str = "",
    ) -> None:
        from .models import SearchCache as SearchCacheRecord
        from sqlalchemy import select

        key = self.cache_key(query, provider)
        record = db.scalar(select(SearchCacheRecord).where(SearchCacheRecord.cache_key == key))
        payload = {
            "normalized_query": self.normalize_query(query),
            "source_count": len(results),
            "user_id": user_id,
            "results": [_web_result_to_payload(result) for result in results],
        }
        expires_at = (datetime.now(UTC) + self.ttl(query)).replace(tzinfo=None)
        if record is None:
            db.add(SearchCacheRecord(
                cache_key=key,
                provider=provider,
                query=query,
                payload_json=payload,
                expires_at=expires_at,
            ))
            db.flush()
            return
        record.query = query
        record.payload_json = payload
        record.expires_at = expires_at
        db.flush()

    def cache_key(self, query: str, provider: str) -> str:
        value = f"{provider}:{self.normalize_query(query)}"
        return hashlib.sha256(value.encode("utf-8")).hexdigest()

    @staticmethod
    def normalize_query(query: str) -> str:
        return re.sub(r"\s+", " ", query.strip().lower())

    @staticmethod
    def ttl(query: str) -> timedelta:
        lowered = query.lower()
        if any(keyword in lowered for keyword in ("cve", "cnvd", "cnnvd", "nvd", "漏洞", "公告", "新闻")):
            return timedelta(hours=6)
        if any(keyword in lowered for keyword in ("政策", "法规", "标准", "官方文档", "api 文档", "sdk", "官网")):
            return timedelta(days=7)
        return timedelta(days=30)


def _web_result_to_payload(result: WebSearchResult) -> dict[str, Any]:
    return {
        "title": result.title,
        "url": result.url,
        "site_name": result.site_name,
        "snippet": result.snippet,
        "published_at": result.published_at,
        "fetched_at": result.fetched_at.isoformat() if result.fetched_at else "",
    }


def _web_result_from_payload(payload: dict[str, Any]) -> WebSearchResult:
    fetched_at_text = str(payload.get("fetched_at") or "")
    fetched_at = None
    if fetched_at_text:
        try:
            fetched_at = datetime.fromisoformat(fetched_at_text)
        except ValueError:
            fetched_at = None
    return WebSearchResult(
        title=str(payload.get("title") or ""),
        url=str(payload.get("url") or ""),
        site_name=str(payload.get("site_name") or ""),
        snippet=str(payload.get("snippet") or ""),
        published_at=str(payload.get("published_at") or ""),
        fetched_at=fetched_at,
    )


class _ContentHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.title_parts: list[str] = []
        self.text_parts: list[str] = []
        self.description = ""
        self.site_name = ""
        self.published_at = ""
        self._tag_stack: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        normalized = tag.lower()
        if normalized in {"script", "style", "noscript", "svg", "canvas"}:
            self._skip_depth += 1
        self._tag_stack.append(normalized)
        attr_map = {key.lower(): value or "" for key, value in attrs}
        name = attr_map.get("name", "").lower()
        prop = attr_map.get("property", "").lower()
        content = attr_map.get("content", "").strip()
        if content and (name == "description" or prop == "og:description"):
            self.description = self.description or content
        if content and prop == "og:site_name":
            self.site_name = self.site_name or content
        if content and (prop in {"article:published_time", "og:updated_time"} or name in {"date", "pubdate"}):
            self.published_at = self.published_at or content

    def handle_endtag(self, tag: str) -> None:
        normalized = tag.lower()
        if normalized in {"script", "style", "noscript", "svg", "canvas"} and self._skip_depth > 0:
            self._skip_depth -= 1
        if self._tag_stack:
            self._tag_stack.pop()

    def handle_data(self, data: str) -> None:
        text = re.sub(r"\s+", " ", data).strip()
        if not text or self._skip_depth:
            return
        if self._tag_stack and self._tag_stack[-1] == "title":
            self.title_parts.append(text)
            return
        self.text_parts.append(text)


class ContentExtractor:
    def extract(self, fetch_result: WebFetchResult) -> ExtractedWebContent:
        content_type = fetch_result.content_type.lower()
        if "text/html" in content_type or b"<html" in fetch_result.content[:1024].lower():
            return self._extract_html(fetch_result)
        return self._extract_plain_text(fetch_result)

    def _decode(self, content: bytes) -> str:
        for encoding in ("utf-8-sig", "utf-8", "gb18030"):
            try:
                return content.decode(encoding)
            except UnicodeDecodeError:
                continue
        return content.decode("utf-8", errors="ignore")

    def _extract_html(self, fetch_result: WebFetchResult) -> ExtractedWebContent:
        parser = _ContentHTMLParser()
        parser.feed(self._decode(fetch_result.content))
        text = self._normalize_text("\n".join(parser.text_parts))
        title = self._normalize_line(" ".join(parser.title_parts)) or self._fallback_title(fetch_result.final_url)
        site_name = parser.site_name or (urlparse(fetch_result.final_url).hostname or "")
        return self._build_content(
            title=title,
            site_name=site_name,
            description=parser.description,
            text=text,
            published_at=parser.published_at,
        )

    def _extract_plain_text(self, fetch_result: WebFetchResult) -> ExtractedWebContent:
        text = self._normalize_text(self._decode(fetch_result.content))
        title = self._fallback_title(fetch_result.final_url)
        return self._build_content(
            title=title,
            site_name=urlparse(fetch_result.final_url).hostname or "",
            description="",
            text=text,
            published_at="",
        )

    def _build_content(
        self,
        *,
        title: str,
        site_name: str,
        description: str,
        text: str,
        published_at: str,
    ) -> ExtractedWebContent:
        if not text:
            raise HTTPException(status_code=422, detail="网页未提取到可用正文")
        text = text[:MAX_EXTRACTED_TEXT_CHARS]
        summary = self._summarize(description, text)
        return ExtractedWebContent(
            title=title[:255],
            site_name=site_name[:128],
            description=description[:500],
            text=text,
            summary=summary,
            word_count=len(re.findall(r"[\w\u4e00-\u9fff]+", text)),
            published_at=published_at[:64],
        )

    @staticmethod
    def _normalize_line(value: str) -> str:
        return re.sub(r"\s+", " ", value).strip()

    @classmethod
    def _normalize_text(cls, value: str) -> str:
        lines = [cls._normalize_line(line) for line in value.splitlines()]
        return "\n".join(line for line in lines if line)

    @staticmethod
    def _fallback_title(url: str) -> str:
        parsed = urlparse(url)
        tail = parsed.path.strip("/").rsplit("/", 1)[-1]
        return tail or parsed.hostname or "网页资料"

    @staticmethod
    def _summarize(description: str, text: str) -> str:
        if description.strip():
            return description.strip()[:300]
        sentences = re.split(r"(?<=[。！？.!?])\s*", text.strip())
        summary = "".join(sentences[:3]).strip()
        return summary[:300] or text[:300]


class CategorySuggester:
    def suggest_category(self, text: str) -> str:
        lowered = text.lower()
        if any(keyword in lowered for keyword in ("投标", "标书", "报价", "响应文件")):
            return "销售商务"
        if any(keyword in lowered for keyword in ("漏洞", "cve", "应急", "加固", "安全运维")):
            return "安全运维"
        if any(keyword in lowered for keyword in ("白皮书", "产品", "功能", "版本")):
            return "产品资料"
        if any(keyword in lowered for keyword in ("交付", "部署", "验收", "培训")):
            return "项目交付"
        return "个人素材"

    def suggest_document_type(self, text: str) -> str:
        lowered = text.lower()
        if "白皮书" in lowered:
            return "产品白皮书"
        if any(keyword in lowered for keyword in ("解决方案", "方案")):
            return "解决方案"
        if any(keyword in lowered for keyword in ("投标", "标书")):
            return "投标模板"
        if any(keyword in lowered for keyword in ("会议", "纪要")):
            return "会议记录"
        return "其他"


def build_web_capture_markdown(
    *,
    url: str,
    final_url: str,
    content: ExtractedWebContent,
) -> str:
    return "\n\n".join(
        part
        for part in [
            f"# {content.title}",
            f"- 来源网址：{final_url or url}",
            f"- 网站：{content.site_name or '待确认'}",
            f"- 发布时间：{content.published_at or '待确认'}",
            f"- 摘要：{content.summary or '暂无'}",
            "## 正文",
            content.text,
        ]
        if part
    )
