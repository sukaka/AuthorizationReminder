from datetime import UTC, datetime

import httpx
import pytest
from fastapi import HTTPException

from app.web_sources import (
    ContentExtractor,
    DuckDuckGoSearchProvider,
    SearchIntentDetector,
    UrlExtractor,
    WebContextBuilder,
    WebFetcher,
    WebFetchResult,
    WebSearchService,
    WebSearchResult,
    WebSafetyValidator,
)


def _public_validator() -> WebSafetyValidator:
    def resolver(_host: str, _port: object) -> list[tuple]:
        return [(None, None, None, "", ("93.184.216.34", 0))]

    return WebSafetyValidator(resolver=resolver)


def test_url_extractor_deduplicates_http_urls() -> None:
    text = "请采集 https://example.com/a 和 https://example.com/a，以及 http://example.org。"

    assert UrlExtractor().extract_all(text) == [
        "https://example.com/a",
        "http://example.org",
    ]


@pytest.mark.parametrize(
    "url",
    [
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://10.0.0.2",
        "http://192.168.1.8",
        "file:///etc/passwd",
    ],
)
def test_web_safety_validator_blocks_local_and_private_targets(url: str) -> None:
    with pytest.raises(HTTPException):
        WebSafetyValidator().validate_url(url)


def test_web_safety_validator_blocks_private_dns_resolution() -> None:
    def resolver(_host: str, _port: object) -> list[tuple]:
        return [(None, None, None, "", ("172.16.1.2", 0))]

    with pytest.raises(HTTPException):
        WebSafetyValidator(resolver=resolver).validate_url("https://internal.example")


def test_web_fetcher_validates_redirect_before_requesting_private_target(monkeypatch) -> None:
    requested_urls: list[str] = []

    class FakeClient:
        def __init__(self, **kwargs) -> None:
            assert kwargs["follow_redirects"] is False

        def __enter__(self):
            return self

        def __exit__(self, *_args) -> None:
            return None

        def get(self, url: str):
            requested_urls.append(url)
            return httpx.Response(
                302,
                headers={"location": "http://127.0.0.1:8000/private"},
                request=httpx.Request("GET", url),
            )

    def public_resolver(_host: str, _port: object) -> list[tuple]:
        return [(None, None, None, "", ("93.184.216.34", 0))]

    monkeypatch.setattr("app.web_sources.httpx.Client", FakeClient)
    fetcher = WebFetcher(validator=WebSafetyValidator(resolver=public_resolver))

    with pytest.raises(HTTPException, match="不允许采集本机或内网地址"):
        fetcher.fetch("https://example.com/start")

    assert requested_urls == ["https://example.com/start"]


def test_search_intent_detector_only_triggers_current_or_official_queries() -> None:
    detector = SearchIntentDetector()

    assert detector.should_search("帮我查一下最新 CVE-2026-12345 信息")
    assert detector.should_search("这个产品的官网 API 文档是什么")
    assert not detector.should_search("写一份安全运维服务方案")
    assert not detector.should_search("总结 https://example.com/article")


def test_content_extractor_extracts_html_title_summary_and_text() -> None:
    html = """
    <html>
      <head>
        <title>聚信产品公告</title>
        <meta name="description" content="这是公告摘要">
        <script>secret()</script>
      </head>
      <body>
        <h1>产品升级</h1>
        <p>支持知识库问答和网页采集。</p>
      </body>
    </html>
    """.encode("utf-8")
    result = WebFetchResult(
        url="https://example.com/news",
        final_url="https://example.com/news",
        status_code=200,
        content_type="text/html; charset=utf-8",
        content=html,
        fetched_at=datetime.now(UTC),
    )

    content = ContentExtractor().extract(result)

    assert content.title == "聚信产品公告"
    assert content.summary == "这是公告摘要"
    assert "支持知识库问答和网页采集" in content.text
    assert "secret" not in content.text


def test_web_context_builder_requires_source_based_answer() -> None:
    context = WebContextBuilder().build([
        WebSearchResult(
            title="OpenSSL Security Advisory",
            url="https://openssl.example/advisory",
            site_name="openssl.example",
            snippet="OpenSSL 发布安全公告。",
            fetched_at=datetime(2026, 7, 3, tzinfo=UTC),
        )
    ])

    assert "【联网搜索结果】" in context
    assert "OpenSSL Security Advisory" in context
    assert "https://openssl.example/advisory" in context
    assert "请只基于以上联网搜索结果回答" in context


def test_web_search_service_fetches_candidate_page_body(generation_db) -> None:
    class FakeProvider:
        name = "fake-search"

        def search(self, query: str, *, limit: int = 5) -> list[WebSearchResult]:
            assert query == "查官网参数"
            return [
                WebSearchResult(
                    title="搜索页摘要标题",
                    url="https://example.com/product",
                    site_name="example.com",
                    snippet="搜索页摘要",
                )
            ]

    class FakeFetcher:
        def fetch(self, url: str) -> WebFetchResult:
            assert url == "https://example.com/product"
            return WebFetchResult(
                url=url,
                final_url=url,
                status_code=200,
                content_type="text/html",
                content="""
                <html>
                  <head><title>官网产品参数</title></head>
                  <body><p>真实网页正文包含 CPU、内存、硬盘参数。</p></body>
                </html>
                """.encode("utf-8"),
                fetched_at=datetime(2026, 7, 3, tzinfo=UTC),
            )

    service = WebSearchService(
        provider=FakeProvider(),
        validator=_public_validator(),
        fetcher=FakeFetcher(),
    )

    results = service.search("查官网参数", limit=1, db=generation_db)

    assert len(results) == 1
    assert results[0].title == "官网产品参数"
    assert "真实网页正文包含 CPU" in results[0].snippet


def test_web_search_service_uses_cache(generation_db) -> None:
    class FakeProvider:
        name = "fake-search"

        def __init__(self) -> None:
            self.calls = 0

        def search(self, query: str, *, limit: int = 5) -> list[WebSearchResult]:
            self.calls += 1
            return [
                WebSearchResult(
                    title=f"结果 {self.calls}",
                    url="https://example.com/cache",
                    site_name="example.com",
                    snippet=f"摘要 {self.calls}",
                )
            ]

    class FakeFetcher:
        def fetch(self, url: str) -> WebFetchResult:
            return WebFetchResult(
                url=url,
                final_url=url,
                status_code=200,
                content_type="text/plain",
                content=b"cached body",
                fetched_at=datetime(2026, 7, 3, tzinfo=UTC),
            )

    provider = FakeProvider()
    service = WebSearchService(
        provider=provider,
        validator=_public_validator(),
        fetcher=FakeFetcher(),
    )

    first = service.search("查最新公告", limit=1, db=generation_db)
    second = service.search("查最新公告", limit=1, db=generation_db)

    assert provider.calls == 1
    assert first[0].title == second[0].title


def test_web_search_service_can_be_created_from_configured_provider() -> None:
    from app.web_sources import create_search_provider

    assert isinstance(create_search_provider("duckduckgo-html"), DuckDuckGoSearchProvider)
    assert isinstance(create_search_provider("unknown-provider"), DuckDuckGoSearchProvider)
