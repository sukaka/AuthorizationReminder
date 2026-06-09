# SCA Dependency-Check Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 SCA 平台增加按 Java 证据自动触发的 OWASP Dependency-Check 深度扫描、共享离线漏洞库缓存、统一归一化、多引擎交叉确认和非阻断门禁策略。

**Architecture:** Dependency-Check 作为现有 scanner-worker 中的本地扫描器适配器运行，扫描任务只读共享缓存并使用 `--noupdate`，独立 Celery 周期任务负责缓存更新。所有扫描器结果进入现有 normalized/merged 数据层，Dependency-Check 单引擎发现晋升为待复核漏洞，只有稳定组件身份与其他引擎确认后才设置 `gate_eligible=true`。

**Tech Stack:** Python 3.12、FastAPI、SQLAlchemy、Celery、pytest、Vue 3、Element Plus、Docker Compose、OWASP Dependency-Check 12.1.9。

---

## 实施约束

1. 严格按 RED、GREEN、REFACTOR 顺序执行，每个行为先看到测试按预期失败。
2. 中间任务提交使用 `CODEX_VERSIONING_BYPASS=1 git commit ...`，避免每个 TDD 小提交升级版本或自动推送。
3. 所有功能完成并验证后，最后执行一次普通 `feat(sca): add dependency-check Java scanning` 提交，由仓库钩子将当前 `5.68.x` 升为 `5.69.0`、切换版本分支并推送。
4. 不修改或提交工作区现有无关未跟踪文件。
5. 不读取、输出或提交 `.env` 中的任何密钥；测试只使用虚构值。
6. Dependency-Check 扫描失败、超时、缓存未初始化或缓存锁等待超时都只能使该子任务降级，不能使主扫描失败。

## 文件结构

### 新建文件

- `sca-platform/backend/app/scanners/java_detector.py`：受限遍历 Java 证据并返回结构化触发原因。
- `sca-platform/backend/app/scanners/dependency_check_cache.py`：共享/独占文件锁、缓存状态和临时 property file。
- `sca-platform/backend/app/scanners/dependency_check_client.py`：构造并执行 Dependency-Check 扫描和更新命令。
- `sca-platform/backend/app/scanners/normalizers/dependency_check_normalizer.py`：解析 Dependency-Check JSON。
- `sca-platform/backend/app/scanners/identity.py`：组件稳定身份与漏洞交叉确认匹配。
- `sca-platform/backend/app/scanner_result_service.py`：归一化、持久化、合并和 Dependency-Check 漏洞晋升。
- `sca-platform/backend/dependency-check-suppression.xml`：第一版全局只读 suppression 文件。
- `sca-platform/backend/tests/fixtures/dependency-check-report.json`：小型稳定报告 fixture。
- `sca-platform/backend/tests/test_dependency_check_detector.py`：Java 自动触发测试。
- `sca-platform/backend/tests/test_dependency_check_normalizer.py`：报告归一化和身份测试。
- `sca-platform/backend/tests/test_dependency_check_pipeline.py`：编排、缓存和失败隔离测试。
- `sca-platform/backend/tests/test_dependency_check_gate.py`：晋升和门禁测试。
- `sca-platform/backend/tests/test_dependency_check_api.py`：状态、制品下载和接口测试。

### 修改文件

- `sca-platform/backend/app/scanners/base.py`：扩展归一化组件和漏洞证据字段。
- `sca-platform/backend/app/scanners/normalizers/__init__.py`：导出新 normalizer。
- `sca-platform/backend/app/scanners/merger/component_merger.py`：按 SHA1、GAV、PURL、生态名称版本合并。
- `sca-platform/backend/app/scanners/merger/vulnerability_merger.py`：计算确认状态和门禁资格。
- `sca-platform/backend/app/scanners/merger/confidence_engine.py`：Dependency-Check 单源置信度规则。
- `sca-platform/backend/app/models.py`：持久化身份、确认状态和门禁资格。
- `sca-platform/backend/app/database.py`：兼容迁移新增列。
- `sca-platform/backend/app/config.py`：Dependency-Check 配置。
- `sca-platform/backend/app/celery_app.py`：子任务、统一归一化、缓存更新、失败隔离。
- `sca-platform/backend/app/devops_service.py`：门禁显式过滤 `gate_eligible`。
- `sca-platform/backend/app/schemas.py`：缓存状态和原始制品响应。
- `sca-platform/backend/app/main.py`：缓存状态、手动更新、项目制品列表和安全下载接口。
- `sca-platform/backend/Dockerfile.scanner`：固定工具版本和 Java 运行时。
- `sca-platform/docker-compose.yml`：持久卷、suppression 挂载和配置传递。
- `sca-platform/.env.example`：非敏感配置示例。
- `sca-platform/frontend/src/composables/projectDataLoader.js`：加载 Dependency-Check 状态和制品。
- `sca-platform/frontend/src/App.vue`：状态、发现数、确认状态和报告下载。
- `sca-platform/frontend/src/styles.css`：新增状态卡片所需样式。
- `sca-platform/README.md`：初始化、更新、存储、suppression 和故障排查。
- `sca-platform/backend/tests/test_scanner_adapters.py`：命令和敏感参数脱敏回归。
- `sca-platform/backend/tests/test_remediation_devops_ops.py`：门禁回归。

## Task 1: Java 证据检测

**Files:**
- Create: `sca-platform/backend/app/scanners/java_detector.py`
- Create: `sca-platform/backend/tests/test_dependency_check_detector.py`

- [ ] **Step 1: 写 Java 标记文件触发的失败测试**

```python
from pathlib import Path

from app.scanners.java_detector import detect_java_project


def test_detects_supported_java_markers(tmp_path: Path):
    (tmp_path / "pom.xml").write_text("<project/>", encoding="utf-8")
    lib = tmp_path / "lib"
    lib.mkdir()
    (lib / "demo.jar").write_bytes(b"jar")

    result = detect_java_project(tmp_path)

    assert result.enabled is True
    assert result.reasons == ["jar", "maven"]
    assert result.matched_paths == ["lib/demo.jar", "pom.xml"]
```

- [ ] **Step 2: 运行测试并确认因模块不存在失败**

Run:

```bash
cd sca-platform/backend
pytest -q tests/test_dependency_check_detector.py::test_detects_supported_java_markers
```

Expected: `ModuleNotFoundError: No module named 'app.scanners.java_detector'`。

- [ ] **Step 3: 实现最小检测器**

```python
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

MARKERS = {
    ".jar": "jar",
    ".war": "war",
    ".ear": "ear",
}
BUILD_FILES = {
    "pom.xml": "maven",
    "build.gradle": "gradle",
    "build.gradle.kts": "gradle",
}


@dataclass(frozen=True)
class JavaDetectionResult:
    enabled: bool
    reasons: list[str]
    matched_paths: list[str]


def detect_java_project(root: Path, *, max_files: int = 20000, max_depth: int = 20, max_matches: int = 50) -> JavaDetectionResult:
    resolved_root = root.resolve()
    reasons: set[str] = set()
    matches: list[str] = []
    visited = 0
    for path in sorted(root.rglob("*")):
        if visited >= max_files or len(matches) >= max_matches:
            break
        visited += 1
        if path.is_symlink() or not path.is_file():
            continue
        relative = path.relative_to(root)
        if len(relative.parts) > max_depth:
            continue
        if resolved_root not in path.resolve().parents:
            continue
        reason = BUILD_FILES.get(path.name) or MARKERS.get(path.suffix.lower())
        if reason:
            reasons.add(reason)
            matches.append(relative.as_posix())
    return JavaDetectionResult(bool(matches), sorted(reasons), sorted(matches))
```

- [ ] **Step 4: 增加非 Java、符号链接、深度和数量限制测试**

```python
def test_non_java_project_is_skipped(tmp_path: Path):
    (tmp_path / "package.json").write_text("{}", encoding="utf-8")
    assert detect_java_project(tmp_path).enabled is False


def test_detector_ignores_symlinks_outside_root(tmp_path: Path):
    outside = tmp_path.parent / "outside.jar"
    outside.write_bytes(b"jar")
    (tmp_path / "linked.jar").symlink_to(outside)
    assert detect_java_project(tmp_path).matched_paths == []


def test_detector_limits_matches(tmp_path: Path):
    for index in range(5):
        (tmp_path / f"{index}.jar").write_bytes(b"jar")
    result = detect_java_project(tmp_path, max_matches=2)
    assert len(result.matched_paths) == 2
```

- [ ] **Step 5: 运行检测器测试**

Run:

```bash
cd sca-platform/backend
pytest -q tests/test_dependency_check_detector.py
```

Expected: `4 passed`。

- [ ] **Step 6: 提交检测器**

```bash
git add sca-platform/backend/app/scanners/java_detector.py sca-platform/backend/tests/test_dependency_check_detector.py
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(sca): detect Java projects for dependency-check"
```

## Task 2: 缓存锁和 Dependency-Check 命令适配器

**Files:**
- Create: `sca-platform/backend/app/scanners/dependency_check_cache.py`
- Create: `sca-platform/backend/app/scanners/dependency_check_client.py`
- Modify: `sca-platform/backend/app/scanners/base.py`
- Modify: `sca-platform/backend/app/config.py`
- Modify: `sca-platform/backend/tests/test_scanner_adapters.py`
- Create: `sca-platform/backend/tests/test_dependency_check_pipeline.py`

- [ ] **Step 1: 写扫描命令和 `--noupdate` 失败测试**

```python
from pathlib import Path

from app.config import Settings
from app.scanners.dependency_check_client import DependencyCheckAdapter


def test_dependency_check_scan_uses_shared_cache_and_no_update(monkeypatch, tmp_path: Path):
    captured = {}

    def fake_run(engine_name, command, output_path, stdout_path, stderr_path, timeout, command_log_path):
        captured["command"] = command
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text('{"dependencies":[]}', encoding="utf-8")
        html = output_path.with_suffix(".html")
        html.write_text("<html></html>", encoding="utf-8")
        from app.scanners.base import ScannerCommandResult
        return ScannerCommandResult(
            engine_name=engine_name,
            status="completed",
            command=command,
            raw_result_path=str(output_path),
            report_files=[str(output_path), str(html)],
        )

    monkeypatch.setattr("app.scanners.dependency_check_client.run_scanner_command", fake_run)
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "odc.mv.db").write_bytes(b"cache")
    suppression = tmp_path / "suppression.xml"
    suppression.write_text(
        '<suppressions xmlns="https://jeremylong.github.io/DependencyCheck/dependency-suppression.1.3.xsd"/>',
        encoding="utf-8",
    )
    settings = Settings(
        dependency_check_path="/opt/dependency-check/bin/dependency-check.sh",
        dependency_check_data_dir=str(data_dir),
        dependency_check_suppression_file=str(suppression),
    )

    DependencyCheckAdapter(settings).scan_source(tmp_path / "project", tmp_path / "out", "project-1")

    assert "--noupdate" in captured["command"]
    assert captured["command"][captured["command"].index("--data") + 1] == str(data_dir)
    assert captured["command"].count("--format") == 2
    assert "JSON" in captured["command"]
    assert "HTML" in captured["command"]
```

- [ ] **Step 2: 运行测试并确认因适配器不存在失败**

Run:

```bash
cd sca-platform/backend
pytest -q tests/test_dependency_check_pipeline.py::test_dependency_check_scan_uses_shared_cache_and_no_update
```

Expected: import failure for `dependency_check_client`。

- [ ] **Step 3: 扩展配置和敏感参数脱敏**

在 `Settings` 中增加：

```python
dependency_check_enabled: bool = True
dependency_check_path: str = "/opt/dependency-check/bin/dependency-check.sh"
dependency_check_version: str = "12.1.9"
dependency_check_timeout: int = 1800
dependency_check_data_dir: str = "/data/dependency-check"
dependency_check_output_dir: str = "/data/scanner-results/dependency-check"
dependency_check_suppression_file: str = "/etc/dependency-check/suppression.xml"
dependency_check_lock_timeout: int = 120
dependency_check_update_interval_seconds: int = 24 * 60 * 60
dependency_check_cache_stale_seconds: int = 72 * 60 * 60
dependency_check_detection_max_files: int = 20000
dependency_check_detection_max_depth: int = 20
dependency_check_detection_max_matches: int = 50
dependency_check_max_report_bytes: int = 200 * 1024 * 1024
```

并在 `SENSITIVE_ARGUMENT_FLAGS` 增加：

```python
"--nvdapikey",
```

`run_scanner_command()` 使用 `time.monotonic()` 记录真实耗时，并在成功、非零退出、超时和 OS error 的每个 `ScannerCommandResult` 中设置：

```python
duration_seconds=max(0, round(time.monotonic() - started)),
```

`_record_scanner_result()` 把该值写入：

```python
duration_seconds=result.duration_seconds,
```

- [ ] **Step 4: 实现共享/独占锁和临时 property file**

```python
from __future__ import annotations

import fcntl
import os
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path


class DependencyCheckLockTimeout(RuntimeError):
    pass


@contextmanager
def dependency_check_lock(data_dir: Path, *, exclusive: bool, timeout: int):
    data_dir.mkdir(parents=True, exist_ok=True)
    lock_path = data_dir / ".cache.lock"
    with lock_path.open("a+") as handle:
        mode = fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH
        deadline = time.monotonic() + timeout
        while True:
            try:
                fcntl.flock(handle.fileno(), mode | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise DependencyCheckLockTimeout("Dependency-Check 缓存锁等待超时")
                time.sleep(0.1)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


@contextmanager
def nvd_property_file(api_key: str):
    if not api_key:
        yield ""
        return
    fd, name = tempfile.mkstemp(prefix="dependency-check-", suffix=".properties")
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(f"nvd.api.key={api_key}\n")
        yield name
    finally:
        Path(name).unlink(missing_ok=True)


def dependency_check_cache_initialized(data_dir: Path) -> bool:
    if not data_dir.exists():
        return False
    return any(
        path.is_file() and path.name not in {".cache.lock", "cache-state.json"}
        for path in data_dir.rglob("*")
    )


def validate_suppression_file(path: Path) -> None:
    import xml.etree.ElementTree as ET
    if not path.is_file():
        raise ValueError(f"Dependency-Check suppression 文件不存在: {path}")
    root = ET.parse(path).getroot()
    if not root.tag.endswith("suppressions"):
        raise ValueError("Dependency-Check suppression 根节点必须为 suppressions")
```

- [ ] **Step 5: 实现适配器扫描和更新命令**

```python
class DependencyCheckAdapter:
    def __init__(self, settings: Settings):
        self.settings = settings

    def scan_source(self, source_dir: Path, output_dir: Path, project_name: str) -> ScannerCommandResult:
        if not self.settings.dependency_check_enabled:
            return ScannerCommandResult("dependency-check", "skipped", [], error_message="Dependency-Check 未启用")
        data_dir = Path(self.settings.dependency_check_data_dir)
        if not dependency_check_cache_initialized(data_dir):
            return ScannerCommandResult(
                "dependency-check",
                "skipped",
                [],
                error_type="CACHE_NOT_INITIALIZED",
                error_message="Dependency-Check 漏洞库尚未初始化",
            )
        try:
            validate_suppression_file(Path(self.settings.dependency_check_suppression_file))
        except (OSError, ValueError) as exc:
            return ScannerCommandResult(
                "dependency-check",
                "failed",
                [],
                error_type="INVALID_SUPPRESSION",
                error_message=str(exc),
            )
        output_dir.mkdir(parents=True, exist_ok=True)
        json_path = output_dir / "dependency-check-report.json"
        html_path = output_dir / "dependency-check-report.html"
        command = [
            self.settings.dependency_check_path,
            "--project", project_name,
            "--scan", str(source_dir),
            "--format", "JSON",
            "--format", "HTML",
            "--out", str(output_dir),
            "--data", self.settings.dependency_check_data_dir,
            "--noupdate",
            "--suppression", self.settings.dependency_check_suppression_file,
        ]
        with dependency_check_lock(
            Path(self.settings.dependency_check_data_dir),
            exclusive=False,
            timeout=self.settings.dependency_check_lock_timeout,
        ):
            result = run_scanner_command(
                "dependency-check",
                command,
                json_path,
                output_dir / "dependency-check.stdout.log",
                output_dir / "dependency-check.stderr.log",
                self.settings.dependency_check_timeout,
                output_dir / "dependency-check.command.log",
            )
        result.report_files = [
            str(path) for path in (json_path, html_path) if path.exists()
        ]
        oversized = [
            path for path in (json_path, html_path)
            if path.exists() and path.stat().st_size > self.settings.dependency_check_max_report_bytes
        ]
        if oversized:
            for path in oversized:
                path.unlink(missing_ok=True)
            return ScannerCommandResult(
                "dependency-check",
                "failed",
                result.command,
                error_type="REPORT_TOO_LARGE",
                error_message="Dependency-Check 报告超过大小限制",
                stdout_log_path=result.stdout_log_path,
                stderr_log_path=result.stderr_log_path,
                duration_seconds=result.duration_seconds,
            )
        result.raw_result_path = str(json_path) if json_path.exists() else ""
        return result

    def update_data(self, output_dir: Path, nvd_api_key: str) -> ScannerCommandResult:
        output_dir.mkdir(parents=True, exist_ok=True)
        with dependency_check_lock(
            Path(self.settings.dependency_check_data_dir),
            exclusive=True,
            timeout=self.settings.dependency_check_lock_timeout,
        ), nvd_property_file(nvd_api_key) as property_file:
            command = [
                self.settings.dependency_check_path,
                "--updateonly",
                "--data", self.settings.dependency_check_data_dir,
            ]
            if property_file:
                command.extend(["--propertyfile", property_file])
            return run_scanner_command(
                "dependency-check-update",
                command,
                output_dir / "dependency-check-update.json",
                output_dir / "dependency-check-update.stdout.log",
                output_dir / "dependency-check-update.stderr.log",
                self.settings.dependency_check_timeout,
                output_dir / "dependency-check-update.command.log",
            )
```

- [ ] **Step 6: 增加锁超时和密钥不入命令日志测试**

```python
def test_nvd_property_file_is_private_and_removed(tmp_path: Path):
    from app.scanners.dependency_check_cache import nvd_property_file

    with nvd_property_file("test-only-key") as filename:
        path = Path(filename)
        assert path.read_text(encoding="utf-8") == "nvd.api.key=test-only-key\n"
        assert path.stat().st_mode & 0o777 == 0o600
    assert not path.exists()


def test_scan_skips_when_cache_is_not_initialized(tmp_path: Path):
    settings = Settings(
        dependency_check_data_dir=str(tmp_path / "empty-data"),
        dependency_check_suppression_file=str(tmp_path / "suppression.xml"),
    )
    result = DependencyCheckAdapter(settings).scan_source(tmp_path / "project", tmp_path / "out", "demo")
    assert result.status == "skipped"
    assert result.error_type == "CACHE_NOT_INITIALIZED"


def test_invalid_suppression_fails_only_dependency_check(tmp_path: Path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "odc.mv.db").write_bytes(b"cache")
    suppression = tmp_path / "suppression.xml"
    suppression.write_text("<invalid/>", encoding="utf-8")
    settings = Settings(
        dependency_check_data_dir=str(data_dir),
        dependency_check_suppression_file=str(suppression),
    )
    result = DependencyCheckAdapter(settings).scan_source(tmp_path / "project", tmp_path / "out", "demo")
    assert result.status == "failed"
    assert result.error_type == "INVALID_SUPPRESSION"


def test_dependency_check_update_command_contains_only_property_path(monkeypatch, tmp_path: Path):
    captured = {}
    monkeypatch.setattr(
        "app.scanners.dependency_check_client.run_scanner_command",
        lambda engine_name, command, *args: captured.setdefault(
            "result",
            (__import__("app.scanners.base", fromlist=["ScannerCommandResult"]).ScannerCommandResult)(
                engine_name, "completed", command
            ),
        ),
    )
    settings = Settings(dependency_check_data_dir=str(tmp_path / "data"))
    DependencyCheckAdapter(settings).update_data(tmp_path / "out", "test-only-key")
    assert "test-only-key" not in " ".join(captured["result"].command)
    assert "--propertyfile" in captured["result"].command
```

- [ ] **Step 7: 运行适配器测试**

Run:

```bash
cd sca-platform/backend
pytest -q tests/test_scanner_adapters.py tests/test_dependency_check_pipeline.py
```

Expected: all tests pass。

- [ ] **Step 8: 提交缓存和适配器**

```bash
git add sca-platform/backend/app/config.py sca-platform/backend/app/scanners/base.py sca-platform/backend/app/scanners/dependency_check_cache.py sca-platform/backend/app/scanners/dependency_check_client.py sca-platform/backend/tests/test_scanner_adapters.py sca-platform/backend/tests/test_dependency_check_pipeline.py
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(sca): add dependency-check scanner adapter"
```

## Task 3: Dependency-Check JSON 归一化和稳定身份

**Files:**
- Create: `sca-platform/backend/tests/fixtures/dependency-check-report.json`
- Create: `sca-platform/backend/app/scanners/identity.py`
- Create: `sca-platform/backend/app/scanners/normalizers/dependency_check_normalizer.py`
- Modify: `sca-platform/backend/app/scanners/normalizers/__init__.py`
- Modify: `sca-platform/backend/app/scanners/base.py`
- Create: `sca-platform/backend/tests/test_dependency_check_normalizer.py`

- [ ] **Step 1: 添加最小真实结构 fixture**

```json
{
  "reportSchema": "1.1",
  "dependencies": [
    {
      "fileName": "commons-text-1.9.jar",
      "filePath": "/work/lib/commons-text-1.9.jar",
      "sha1": "1111111111111111111111111111111111111111",
      "packages": [
        {
          "id": "pkg:maven/org.apache.commons/commons-text@1.9",
          "confidence": "HIGHEST"
        }
      ],
      "vulnerabilities": [
        {
          "source": "NVD",
          "name": "CVE-2022-42889",
          "severity": "CRITICAL",
          "cvssv3": {
            "baseScore": 9.8,
            "attackVector": "NETWORK"
          },
          "description": "Apache Commons Text interpolation issue",
          "references": [
            {
              "url": "https://nvd.nist.gov/vuln/detail/CVE-2022-42889"
            }
          ]
        }
      ]
    }
  ]
}
```

- [ ] **Step 2: 写组件和漏洞字段归一化失败测试**

```python
from pathlib import Path

from app.scanners.normalizers.dependency_check_normalizer import normalize_dependency_check


def test_normalizes_dependency_check_component_and_vulnerability():
    fixture = Path(__file__).parent / "fixtures" / "dependency-check-report.json"

    components, vulnerabilities = normalize_dependency_check(fixture)

    assert components[0].source_engine == "dependency-check"
    assert components[0].purl == "pkg:maven/org.apache.commons/commons-text@1.9"
    assert components[0].sha1 == "1111111111111111111111111111111111111111"
    assert components[0].gav == "org.apache.commons:commons-text:1.9"
    assert vulnerabilities[0].cve_id == "CVE-2022-42889"
    assert vulnerabilities[0].affected_purl == components[0].purl
    assert vulnerabilities[0].affected_sha1 == components[0].sha1
    assert vulnerabilities[0].match_confidence >= 0.9
```

- [ ] **Step 3: 运行测试并确认字段或模块缺失**

Run:

```bash
cd sca-platform/backend
pytest -q tests/test_dependency_check_normalizer.py
```

Expected: import failure or dataclass field error。

- [ ] **Step 4: 扩展归一化数据结构**

在 `NormalizedComponentData` 增加：

```python
sha1: str = ""
gav: str = ""
```

在 `NormalizedVulnerabilityData` 增加：

```python
affected_purl: str = ""
affected_cpe: str = ""
affected_sha1: str = ""
affected_gav: str = ""
suppressed: bool = False
```

- [ ] **Step 5: 实现 PURL、GAV 和身份辅助函数**

```python
from urllib.parse import unquote


def gav_from_purl(purl: str) -> str:
    prefix = "pkg:maven/"
    if not purl.startswith(prefix):
        return ""
    path_version = purl[len(prefix):].split("?", 1)[0].split("#", 1)[0]
    path, separator, version = path_version.rpartition("@")
    parts = [unquote(item) for item in path.split("/") if item]
    if not separator or len(parts) < 2:
        return ""
    return f"{'.'.join(parts[:-1])}:{parts[-1]}:{unquote(version)}"


def stable_component_keys(*, sha1: str = "", gav: str = "", purl: str = "", ecosystem: str = "", name: str = "", version: str = "") -> list[str]:
    keys = []
    if sha1:
        keys.append(f"sha1:{sha1.lower()}")
    if gav:
        keys.append(f"gav:{gav.lower()}")
    if purl:
        keys.append(f"purl:{purl.lower()}")
    if ecosystem and name and version:
        keys.append(f"package:{ecosystem.lower()}:{name.lower()}@{version}")
    return keys
```

- [ ] **Step 6: 实现 normalizer**

```python
def normalize_dependency_check(path: Path) -> tuple[list[NormalizedComponentData], list[NormalizedVulnerabilityData]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    components = []
    vulnerabilities = []
    for dependency in data.get("dependencies", []) if isinstance(data, dict) else []:
        packages = dependency.get("packages") or []
        purl = next((str(item.get("id") or "") for item in packages if str(item.get("id") or "").startswith("pkg:")), "")
        gav = gav_from_purl(purl)
        name, version = _name_version_from_purl_or_filename(purl, str(dependency.get("fileName") or ""))
        sha1 = str(dependency.get("sha1") or "")
        cpes = [str(item) for item in dependency.get("vulnerabilityIds", []) if str(item).startswith("cpe:")]
        component = NormalizedComponentData(
            source_engine="dependency-check",
            package_name=name,
            normalized_name=name.lower(),
            ecosystem="maven" if purl.startswith("pkg:maven/") else "java",
            package_manager="maven" if purl.startswith("pkg:maven/") else "",
            version=version,
            version_normalized=version,
            purl=purl,
            cpe=cpes[0] if cpes else "",
            sha1=sha1,
            gav=gav,
            source_file=str(dependency.get("filePath") or ""),
            evidence_file=str(dependency.get("filePath") or ""),
            evidence_text=json.dumps(dependency.get("evidenceCollected") or {}, ensure_ascii=False),
            confidence_score=0.94 if sha1 or gav or purl else 0.45,
        )
        components.append(component)
        for vulnerability in dependency.get("vulnerabilities", []) or []:
            vuln_id = str(vulnerability.get("name") or "")
            cvss = vulnerability.get("cvssv3") if isinstance(vulnerability.get("cvssv3"), dict) else {}
            references = [
                str(item.get("url") or "")
                for item in vulnerability.get("references", []) or []
                if isinstance(item, dict) and item.get("url")
            ]
            vulnerabilities.append(
                NormalizedVulnerabilityData(
                    source_engine="dependency-check",
                    vulnerability_id=vuln_id,
                    cve_id=vuln_id if vuln_id.startswith("CVE-") else "",
                    title=vuln_id,
                    description=str(vulnerability.get("description") or ""),
                    severity=str(vulnerability.get("severity") or "unknown").lower(),
                    cvss_score=float(cvss.get("baseScore") or 0),
                    affected_package=name,
                    current_version=version,
                    references=references,
                    match_confidence=0.92 if sha1 or gav or purl else 0.38,
                    affected_purl=purl,
                    affected_cpe=component.cpe,
                    affected_sha1=sha1,
                    affected_gav=gav,
                    suppressed=bool(vulnerability.get("suppressed")),
                    raw_source=json.dumps(vulnerability, ensure_ascii=False),
                )
            )
    return components, vulnerabilities
```

辅助函数使用以下实现，优先解析 Maven PURL，无法解析时只返回去掉制品后缀的文件名，避免猜测版本：

```python
def _name_version_from_purl_or_filename(purl: str, filename: str) -> tuple[str, str]:
    if purl.startswith("pkg:maven/"):
        path_version = purl[len("pkg:maven/"):].split("?", 1)[0].split("#", 1)[0]
        path, separator, version = path_version.rpartition("@")
        parts = [unquote(item) for item in path.split("/") if item]
        if separator and parts:
            return parts[-1], unquote(version)
    lower = filename.lower()
    for suffix in (".jar", ".war", ".ear"):
        if lower.endswith(suffix):
            return filename[:-len(suffix)], ""
    return filename, ""
```

- [ ] **Step 7: 增加 CPE-only 低置信度和 suppression 测试**

```python
def test_cpe_only_match_is_low_confidence_and_suppression_is_preserved(tmp_path: Path):
    report = tmp_path / "report.json"
    report.write_text(
        json.dumps({
            "dependencies": [{
                "fileName": "legacy.jar",
                "vulnerabilityIds": ["cpe:2.3:a:vendor:legacy:1.0:*:*:*:*:*:*:*"],
                "vulnerabilities": [{"name": "CVE-2020-0001", "severity": "HIGH", "suppressed": True}],
            }]
        }),
        encoding="utf-8",
    )
    _components, vulnerabilities = normalize_dependency_check(report)
    assert vulnerabilities[0].match_confidence < 0.5
    assert vulnerabilities[0].suppressed is True
```

- [ ] **Step 8: 运行归一化测试并提交**

Run:

```bash
cd sca-platform/backend
pytest -q tests/test_dependency_check_normalizer.py
```

Expected: all tests pass。

Commit:

```bash
git add sca-platform/backend/app/scanners/base.py sca-platform/backend/app/scanners/identity.py sca-platform/backend/app/scanners/normalizers sca-platform/backend/tests/fixtures/dependency-check-report.json sca-platform/backend/tests/test_dependency_check_normalizer.py
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(sca): normalize dependency-check findings"
```

## Task 4: 多引擎合并、确认状态和持久化模型

**Files:**
- Modify: `sca-platform/backend/app/scanners/merger/component_merger.py`
- Modify: `sca-platform/backend/app/scanners/merger/vulnerability_merger.py`
- Modify: `sca-platform/backend/app/scanners/merger/confidence_engine.py`
- Modify: `sca-platform/backend/app/models.py`
- Modify: `sca-platform/backend/app/database.py`
- Create: `sca-platform/backend/tests/test_dependency_check_gate.py`

- [ ] **Step 1: 写单源与交叉确认失败测试**

```python
from app.scanners.base import NormalizedVulnerabilityData
from app.scanners.merger.vulnerability_merger import merge_vulnerabilities


def dependency_check_row():
    return NormalizedVulnerabilityData(
        source_engine="dependency-check",
        vulnerability_id="CVE-2022-42889",
        cve_id="CVE-2022-42889",
        affected_package="commons-text",
        current_version="1.9",
        affected_purl="pkg:maven/org.apache.commons/commons-text@1.9",
        match_confidence=0.92,
    )


def test_dependency_check_only_is_not_gate_eligible():
    merged = merge_vulnerabilities([dependency_check_row()])[0]
    assert merged["confirmation_status"] == "single_source"
    assert merged["gate_eligible"] is False
    assert merged["need_manual_review"] is True


def test_dependency_check_plus_trivy_is_cross_confirmed():
    trivy = NormalizedVulnerabilityData(
        source_engine="trivy",
        vulnerability_id="CVE-2022-42889",
        cve_id="CVE-2022-42889",
        affected_package="commons-text",
        current_version="1.9",
        affected_purl="pkg:maven/org.apache.commons/commons-text@1.9",
    )
    merged = merge_vulnerabilities([dependency_check_row(), trivy])[0]
    assert merged["confirmation_status"] == "cross_confirmed"
    assert merged["confirmation_engines"] == ["dependency-check", "trivy"]
    assert merged["gate_eligible"] is True
```

- [ ] **Step 2: 运行并确认现有 merger 缺少确认字段**

Run:

```bash
cd sca-platform/backend
pytest -q tests/test_dependency_check_gate.py
```

Expected: `KeyError: 'confirmation_status'`。

- [ ] **Step 3: 改为稳定身份分组**

组件分组键按 `sha1 -> gav -> purl -> ecosystem/name/version -> cpe候选` 选择。漏洞分组键必须包含漏洞 ID 和稳定组件键：

```python
def vulnerability_group_key(item: NormalizedVulnerabilityData) -> tuple[str, str]:
    vuln_id = (item.cve_id or item.ghsa_id or item.osv_id or item.vulnerability_id).upper()
    keys = stable_component_keys(
        sha1=item.affected_sha1,
        gav=item.affected_gav,
        purl=item.affected_purl,
        name=item.affected_package,
        version=item.current_version,
        ecosystem="maven" if item.affected_gav else "",
    )
    stable_key = keys[0] if keys else f"cpe-candidate:{item.affected_cpe.lower()}:{item.affected_package.lower()}@{item.current_version}"
    return stable_key, vuln_id
```

- [ ] **Step 4: 实现确认规则**

```python
engines = sorted({item.source_engine for item in group if item.source_engine})
has_dependency_check = "dependency-check" in engines
stable_identity = any(
    item.affected_sha1 or item.affected_gav or item.affected_purl
    for item in group
)
suppressed = all(item.suppressed for item in group)
cross_confirmed = has_dependency_check and len(engines) >= 2 and stable_identity
confirmation_status = "rejected" if suppressed else "cross_confirmed" if cross_confirmed else "single_source"
gate_eligible = False if suppressed or (has_dependency_check and not cross_confirmed) else True
review_reason = (
    "Dependency-Check 单引擎发现，等待其他引擎确认"
    if has_dependency_check and not cross_confirmed and not suppressed
    else "已由 suppression 排除"
    if suppressed
    else ""
)
```

合并结果写入：

```python
"confirmation_status": confirmation_status,
"confirmation_engines": engines,
"gate_eligible": gate_eligible,
"review_reason": review_reason,
```

- [ ] **Step 5: 扩展 SQLAlchemy 模型**

`NormalizedComponent` 增加：

```python
sha1: Mapped[str] = mapped_column(String(64), nullable=False, default="")
gav: Mapped[str] = mapped_column(String(512), nullable=False, default="")
```

`MergedComponent` 同样增加：

```python
sha1: Mapped[str] = mapped_column(String(64), nullable=False, default="")
gav: Mapped[str] = mapped_column(String(512), nullable=False, default="")
```

`NormalizedVulnerability` 增加：

```python
affected_purl: Mapped[str] = mapped_column(String(512), nullable=False, default="")
affected_cpe: Mapped[str] = mapped_column(String(512), nullable=False, default="")
affected_sha1: Mapped[str] = mapped_column(String(64), nullable=False, default="")
affected_gav: Mapped[str] = mapped_column(String(512), nullable=False, default="")
suppressed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
```

`MergedVulnerability` 和 `VulnerabilityRecord` 增加：

```python
confirmation_status: Mapped[str] = mapped_column(String(32), nullable=False, default="single_source")
confirmation_engines: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
gate_eligible: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
review_reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
```

- [ ] **Step 6: 增加兼容迁移**

在 `run_compat_migrations()` 中为 `normalized_components`、`merged_components`、`normalized_vulnerabilities`、`merged_vulnerabilities` 和 `vulnerabilities` 分别增加上述列。PostgreSQL/SQLite 都使用已有 `ALTER TABLE ... ADD COLUMN` 模式，布尔默认值使用 `FALSE/TRUE`。

- [ ] **Step 7: 增加 CVE 相同但组件不同不得确认测试**

```python
def test_same_cve_on_different_components_does_not_cross_confirm():
    dependency_check = dependency_check_row()
    trivy = NormalizedVulnerabilityData(
        source_engine="trivy",
        vulnerability_id="CVE-2022-42889",
        cve_id="CVE-2022-42889",
        affected_package="other-lib",
        current_version="1.9",
        affected_purl="pkg:maven/example/other-lib@1.9",
    )
    merged = merge_vulnerabilities([dependency_check, trivy])
    assert len(merged) == 2
    assert all(item["confirmation_status"] == "single_source" for item in merged)


def test_suppressed_dependency_check_finding_is_rejected():
    row = dependency_check_row()
    row.suppressed = True
    merged = merge_vulnerabilities([row])[0]
    assert merged["confirmation_status"] == "rejected"
    assert merged["gate_eligible"] is False
```

- [ ] **Step 8: 运行测试和数据库回归**

Run:

```bash
cd sca-platform/backend
pytest -q tests/test_dependency_check_gate.py tests/test_projects.py
```

Expected: all tests pass。

- [ ] **Step 9: 提交合并和模型**

```bash
git add sca-platform/backend/app/scanners/merger sca-platform/backend/app/models.py sca-platform/backend/app/database.py sca-platform/backend/tests/test_dependency_check_gate.py
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(sca): model dependency-check confirmation state"
```

## Task 5: 统一扫描结果持久化和漏洞晋升

**Files:**
- Create: `sca-platform/backend/app/scanner_result_service.py`
- Modify: `sca-platform/backend/app/celery_app.py`
- Modify: `sca-platform/backend/app/scanners/dependency_track_client.py`
- Modify: `sca-platform/backend/tests/test_dependency_check_pipeline.py`
- Modify: `sca-platform/backend/tests/test_dependency_check_gate.py`

- [ ] **Step 1: 写扫描结果持久化失败测试**

```python
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.database import Base


def _session_factory(tmp_path: Path):
    engine = create_engine(f"sqlite:///{tmp_path / 'dependency-check.db'}")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)


def test_persist_scanner_results_creates_normalized_and_merged_rows(tmp_path):
    from app.scanner_result_service import persist_scan_results

    report = Path(__file__).parent / "fixtures" / "dependency-check-report.json"
    Session = _session_factory(tmp_path)
    with Session() as db:
        project = models.Project(name="java-demo")
        upload = models.UploadFileRecord(project=project, upload_id="u1", original_filename="demo.zip")
        task = models.ScanTask(project=project, upload_file=upload, status="running")
        db.add_all([project, upload, task])
        db.commit()
        persist_scan_results(db, task, {"dependency-check": report})
        db.commit()

        assert db.query(models.NormalizedComponent).filter_by(scan_id=task.id, source_engine="dependency-check").count() == 1
        assert db.query(models.NormalizedVulnerability).filter_by(scan_id=task.id, source_engine="dependency-check").count() == 1
        merged = db.query(models.MergedVulnerability).filter_by(scan_id=task.id).one()
        assert merged.gate_eligible is False
```

- [ ] **Step 2: 运行并确认 service 不存在**

Run:

```bash
cd sca-platform/backend
pytest -q tests/test_dependency_check_pipeline.py::test_persist_scanner_results_creates_normalized_and_merged_rows
```

Expected: import failure for `scanner_result_service`。

- [ ] **Step 3: 实现统一 normalizer 注册和持久化**

```python
NORMALIZERS = {
    "opensca": normalize_opensca,
    "syft": lambda path: (normalize_syft_cyclonedx(path), []),
    "trivy": normalize_trivy,
    "dependency-check": normalize_dependency_check,
}


def persist_scan_results(db: Session, scan_task: ScanTask, report_paths: dict[str, Path]) -> dict[str, int]:
    db.execute(delete(NormalizedComponent).where(NormalizedComponent.scan_id == scan_task.id))
    db.execute(delete(NormalizedVulnerability).where(NormalizedVulnerability.scan_id == scan_task.id))
    db.execute(delete(MergedComponent).where(MergedComponent.scan_id == scan_task.id))
    db.execute(delete(MergedVulnerability).where(MergedVulnerability.scan_id == scan_task.id))
    components = []
    vulnerabilities = []
    for engine, path in report_paths.items():
        if not path.exists():
            continue
        if engine == "dependency-track-components":
            payload = json.loads(path.read_text(encoding="utf-8"))
            engine_components = normalize_dependency_track_components(payload if isinstance(payload, list) else [])
            engine_vulnerabilities = []
        elif engine == "dependency-track-findings":
            payload = json.loads(path.read_text(encoding="utf-8"))
            engine_components = []
            engine_vulnerabilities = normalize_dependency_track_findings(payload if isinstance(payload, list) else [])
        elif engine in NORMALIZERS:
            engine_components, engine_vulnerabilities = NORMALIZERS[engine](path)
        else:
            continue
        components.extend(engine_components)
        vulnerabilities.extend(engine_vulnerabilities)
    for item in components:
        db.add(NormalizedComponent(project_id=scan_task.project_id, scan_id=scan_task.id, **asdict(item)))
    for item in vulnerabilities:
        payload = asdict(item)
        payload["fixed_versions"] = json.dumps(payload.pop("fixed_versions"), ensure_ascii=False)
        payload["references_json"] = json.dumps(payload.pop("references"), ensure_ascii=False)
        db.add(NormalizedVulnerability(project_id=scan_task.project_id, scan_id=scan_task.id, **payload))
    db.flush()
    _persist_merged_rows(db, scan_task, components, vulnerabilities)
    return {"components": len(components), "vulnerabilities": len(vulnerabilities)}
```

`_persist_merged_rows()` 使用现有 merger，并显式映射数据库字段：

```python
def _persist_merged_rows(
    db: Session,
    scan_task: ScanTask,
    components: list[NormalizedComponentData],
    vulnerabilities: list[NormalizedVulnerabilityData],
) -> None:
    component_rows = merge_components(components)
    for item in component_rows:
        db.add(MergedComponent(
            project_id=scan_task.project_id,
            scan_id=scan_task.id,
            package_name=str(item["package_name"]),
            normalized_name=str(item["normalized_name"]),
            ecosystem=str(item["ecosystem"]),
            package_manager=str(item["package_manager"]),
            version=str(item["version"]),
            purl=str(item["purl"]),
            cpe=str(item["cpe"]),
            sha1=str(item["sha1"]),
            gav=str(item["gav"]),
            license=str(item["license"]),
            detected_by_engines=json.dumps(item["detected_by_engines"], ensure_ascii=False),
            engine_count=int(item["engine_count"]),
            evidence_list_json=json.dumps(item["evidence_list"], ensure_ascii=False),
            merged_confidence_score=float(item["merged_confidence_score"]),
            confidence_level=str(item["confidence_level"]),
        ))
    for item in merge_vulnerabilities(vulnerabilities):
        db.add(MergedVulnerability(
            project_id=scan_task.project_id,
            scan_id=scan_task.id,
            vulnerability_id=str(item["vulnerability_id"]),
            cve_id=str(item["cve_id"]),
            ghsa_id=str(item["ghsa_id"]),
            osv_id=str(item["osv_id"]),
            title=str(item["title"]),
            description=str(item["description"]),
            severity=str(item["severity"]),
            cvss_score=float(item["cvss_score"]),
            affected_version_range=str(item["affected_version_range"]),
            current_version=str(item["current_version"]),
            fixed_versions_json=json.dumps(item["fixed_versions"], ensure_ascii=False),
            detected_by_engines=json.dumps(item["detected_by_engines"], ensure_ascii=False),
            engine_count=int(item["engine_count"]),
            vulnerability_sources_json=json.dumps(item["vulnerability_sources"], ensure_ascii=False),
            multi_engine_confidence_score=float(item["multi_engine_confidence_score"]),
            confidence_level=str(item["confidence_level"]),
            confidence_reason=str(item["confidence_reason"]),
            engine_agreement=str(item["engine_agreement"]),
            disagreement_summary=str(item["disagreement_summary"]),
            need_manual_review=bool(item["need_manual_review"]),
            manual_review_reason=str(item["manual_review_reason"]),
            confirmation_status=str(item["confirmation_status"]),
            confirmation_engines=json.dumps(item["confirmation_engines"], ensure_ascii=False),
            gate_eligible=bool(item["gate_eligible"]),
            review_reason=str(item["review_reason"]),
        ))
```

- [ ] **Step 4: 让 Dependency-Track 保存组件和 findings JSON**

在 `_run_scanner_children()` 的 Dependency-Track 成功分支调用：

```python
components = dtrack.fetch_components(project_uuid)
findings = dtrack.fetch_findings(project_uuid) if dtrack_settings.dependency_track_fetch_findings else []
dtrack_dir = Path(settings.dependency_check_output_dir).parent / "dependency-track" / str(task.id)
dtrack_components_path = write_json(dtrack_dir / "dependency-track-components.json", components)
dtrack_findings_path = write_json(dtrack_dir / "dependency-track-findings.json", findings)
_record_artifact(db, task, "dependency-track", "raw_json", str(dtrack_components_path))
_record_artifact(db, task, "dependency-track", "raw_json", str(dtrack_findings_path))
```

统一持久化 service 接受 Dependency-Track 两份数据，并分别调用现有 component/finding normalizer。

- [ ] **Step 5: 实现 Dependency-Check 漏洞晋升**

```python
def promote_dependency_check_findings(db: Session, project_id: int, scan_id: int) -> int:
    rows = db.query(MergedVulnerability).filter_by(project_id=project_id, scan_id=scan_id).all()
    components = db.query(Component).filter_by(project_id=project_id).all()
    created = 0
    for row in rows:
        engines = set(json.loads(row.detected_by_engines or "[]"))
        if "dependency-check" not in engines:
            continue
        component = match_project_component(components, row)
        if not component:
            continue
        existing = db.query(VulnerabilityRecord).filter_by(
            project_id=project_id,
            component_id=component.id,
            cve_id=row.cve_id,
        ).first()
        if existing:
            row_engines = set(json.loads(row.detected_by_engines or "[]"))
            if existing.source != "dependency-check":
                row_engines.add(existing.source)
                existing.confirmation_status = "cross_confirmed"
                existing.confirmation_engines = json.dumps(sorted(row_engines), ensure_ascii=False)
                existing.review_reason = ""
            else:
                existing.confirmation_status = row.confirmation_status
                existing.confirmation_engines = row.detected_by_engines
                existing.gate_eligible = row.gate_eligible
                existing.review_reason = row.review_reason
            continue
        db.add(VulnerabilityRecord(
            project_id=project_id,
            component_id=component.id,
            source="dependency-check",
            advisory_id=row.vulnerability_id,
            cve_id=row.cve_id,
            package_name=component.package_name,
            package_version=component.package_version,
            ecosystem=component.ecosystem,
            cvss_score=row.cvss_score,
            severity=row.severity,
            confidence_score=row.multi_engine_confidence_score / 100,
            match_status="affected" if row.gate_eligible else "unknown",
            matched_by="multi_engine" if row.gate_eligible else "dependency_check_only",
            match_reason=row.confidence_reason,
            needs_human_review=not row.gate_eligible or row.need_manual_review,
            false_positive_possibility="medium" if row.gate_eligible else "high",
            risk_priority=row.risk_priority if row.gate_eligible else "Review",
            description=row.description,
            fixed_version=_first_json_value(row.fixed_versions_json),
            detail_url=_first_dependency_check_reference(row.vulnerability_sources_json),
            confirmation_status=row.confirmation_status,
            confirmation_engines=row.detected_by_engines,
            gate_eligible=row.gate_eligible,
            review_reason=row.review_reason,
        ))
        created += 1
    return created
```

同文件定义所有调用到的辅助函数：

```python
def _json_list(value: str) -> list[object]:
    try:
        parsed = json.loads(value or "[]")
    except ValueError:
        return []
    return parsed if isinstance(parsed, list) else []


def _first_json_value(value: str) -> str:
    return next((str(item) for item in _json_list(value) if item), "")


def _first_dependency_check_reference(value: str) -> str:
    for source in _json_list(value):
        if not isinstance(source, dict) or source.get("source_engine") != "dependency-check":
            continue
        references = source.get("references")
        if isinstance(references, list):
            return next((str(item) for item in references if item), "")
    return ""


def _source_identity(row: MergedVulnerability) -> set[str]:
    keys: set[str] = set()
    for source in _json_list(row.vulnerability_sources_json):
        if not isinstance(source, dict):
            continue
        keys.update(stable_component_keys(
            sha1=str(source.get("affected_sha1") or ""),
            gav=str(source.get("affected_gav") or ""),
            purl=str(source.get("affected_purl") or ""),
            ecosystem="maven" if source.get("affected_gav") else "",
            name=str(source.get("affected_package") or ""),
            version=str(source.get("current_version") or ""),
        ))
    return keys


def match_project_component(components: list[Component], row: MergedVulnerability) -> Component | None:
    source_keys = _source_identity(row)
    for component in components:
        gav = (
            f"{component.group_id}:{component.artifact_id}:{component.version_normalized or component.package_version}"
            if component.group_id and component.artifact_id
            else ""
        )
        component_keys = set(stable_component_keys(
            sha1=component.sha1,
            gav=gav,
            purl=component.purl,
            ecosystem=component.ecosystem,
            name=component.normalized_name or component.package_name,
            version=component.version_normalized or component.package_version,
        ))
        if source_keys & component_keys:
            return component
    return None


def latest_completed_project_scan(db: Session, project_id: int) -> ScanTask | None:
    return (
        db.query(ScanTask)
        .filter(
            ScanTask.project_id == project_id,
            ScanTask.parent_task_id.is_(None),
            ScanTask.status.in_(["success", "completed", "partial_completed"]),
        )
        .order_by(ScanTask.created_at.desc(), ScanTask.id.desc())
        .first()
    )
```

当已有 OSV/NVD/GHSA 记录与交叉确认结果相同，保持原记录的风险数据，只补充确认字段；不能把原本可阻断记录错误降级。

- [ ] **Step 6: 写已有外部漏洞不被降级的测试**

```python
def test_external_vulnerability_remains_gate_eligible_when_dependency_check_confirms(tmp_path):
    from app.scanner_result_service import promote_dependency_check_findings

    Session = _session_factory(tmp_path)
    with Session() as db:
        project = models.Project(name="promotion-project")
        upload = models.UploadFileRecord(project=project, upload_id="promotion-u1", original_filename="source.zip")
        scan = models.ScanTask(project=project, upload_file=upload, status="success")
        component = models.Component(
            project=project,
            package_name="commons-text",
            package_version="1.9",
            normalized_name="commons-text",
            version_normalized="1.9",
            ecosystem="maven",
            purl="pkg:maven/org.apache.commons/commons-text@1.9",
        )
        db.add_all([project, upload, scan, component])
        db.flush()
        external = models.VulnerabilityRecord(
            project_id=project.id,
            component_id=component.id,
            source="osv",
            advisory_id="CVE-2022-42889",
            cve_id="CVE-2022-42889",
            package_name="commons-text",
            package_version="1.9",
            ecosystem="maven",
            severity="critical",
            match_status="affected",
            needs_human_review=False,
            gate_eligible=True,
        )
        merged = models.MergedVulnerability(
            project_id=project.id,
            scan_id=scan.id,
            vulnerability_id="CVE-2022-42889",
            cve_id="CVE-2022-42889",
            detected_by_engines='["dependency-check"]',
            vulnerability_sources_json=json.dumps([{
                "source_engine": "dependency-check",
                "affected_purl": component.purl,
                "affected_package": component.package_name,
                "current_version": component.package_version,
            }]),
            confirmation_status="single_source",
            gate_eligible=False,
        )
        db.add_all([external, merged])
        db.commit()
        promote_dependency_check_findings(db, project.id, scan.id)
        db.commit()
        db.refresh(external)
        assert external.gate_eligible is True
        assert external.confirmation_status == "cross_confirmed"
        assert set(json.loads(external.confirmation_engines)) == {"dependency-check", "osv"}
```

- [ ] **Step 7: 接入扫描和漏洞查询流程**

在 `_run_scanner_children()` 中初始化并返回各引擎报告路径，不再只返回 `None`：

```python
report_paths: dict[str, Path] = {}
dtrack_components_path: Path | None = None
dtrack_findings_path: Path | None = None
if opensca_result.raw_result_path:
    report_paths["opensca"] = Path(opensca_result.raw_result_path)
if syft_result.raw_result_path:
    report_paths["syft"] = Path(syft_result.raw_result_path)
if trivy_result.raw_result_path:
    report_paths["trivy"] = Path(trivy_result.raw_result_path)
if dependency_check_result.raw_result_path:
    report_paths["dependency-check"] = Path(dependency_check_result.raw_result_path)
if dtrack_components_path:
    report_paths["dependency-track-components"] = dtrack_components_path
if dtrack_findings_path:
    report_paths["dependency-track-findings"] = dtrack_findings_path
return report_paths
```

在源码组件落库后：

```python
counts = persist_scan_results(db, task, scanner_report_paths)
promoted = promote_dependency_check_findings(db, task.project_id, task.id)
_mark_child(
    db,
    task.id,
    "merge_vulnerabilities_task",
    "completed",
    f"漏洞合并完成：归一化 {counts['vulnerabilities']}，晋升 {promoted}",
    100,
)
```

在 `query_project_vulnerabilities_task()` 完成外部漏洞查询后再次调用：

```python
latest_scan = latest_completed_project_scan(db, task.project_id)
if latest_scan:
    total_findings += promote_dependency_check_findings(db, task.project_id, latest_scan.id)
```

- [ ] **Step 8: 运行持久化和流水线测试**

Run:

```bash
cd sca-platform/backend
pytest -q tests/test_dependency_check_pipeline.py tests/test_dependency_check_gate.py tests/test_vulnerabilities.py
```

Expected: all tests pass。

- [ ] **Step 9: 提交统一持久化链路**

```bash
git add sca-platform/backend/app/scanner_result_service.py sca-platform/backend/app/celery_app.py sca-platform/backend/app/scanners/dependency_track_client.py sca-platform/backend/tests/test_dependency_check_pipeline.py sca-platform/backend/tests/test_dependency_check_gate.py
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(sca): persist and promote multi-engine findings"
```

## Task 6: Celery 自动触发、缓存更新和状态持久化

**Files:**
- Modify: `sca-platform/backend/app/celery_app.py`
- Modify: `sca-platform/backend/app/scanners/dependency_check_client.py`
- Modify: `sca-platform/backend/tests/test_dependency_check_pipeline.py`

- [ ] **Step 1: 写 Java 自动运行和非 Java 跳过测试**

```python
from app import models
from app.celery_app import _run_dependency_check_child
from app.scanners.base import ScannerCommandResult


def _seed_scan(Session):
    with Session() as db:
        project = models.Project(name="java-pipeline")
        upload = models.UploadFileRecord(project=project, upload_id="pipeline-u1", original_filename="source.zip")
        parent = models.ScanTask(project=project, upload_file=upload, status="running")
        child = models.ScanTask(
            project=project,
            upload_file=upload,
            parent_task_id=None,
            task_type="dependency_check_scan_task",
            engine_name="dependency-check",
            status="pending",
        )
        db.add_all([project, upload, parent])
        db.flush()
        child.parent_task_id = parent.id
        db.add(child)
        db.commit()
        return parent.id, child.id


def test_java_project_runs_dependency_check(monkeypatch, tmp_path):
    calls = []
    Session = _session_factory(tmp_path)
    parent_id, child_id = _seed_scan(Session)
    source = tmp_path / "java-source"
    source.mkdir()
    (source / "pom.xml").write_text("<project/>", encoding="utf-8")
    monkeypatch.setattr("app.scanners.dependency_check_client.dependency_check_cache_initialized", lambda _path: True)
    monkeypatch.setattr("app.scanners.dependency_check_client.validate_suppression_file", lambda _path: None)
    monkeypatch.setattr(
        "app.celery_app.DependencyCheckAdapter.scan_source",
        lambda _self, source_dir, output, project_name: calls.append(source_dir)
        or ScannerCommandResult("dependency-check", "completed", [], raw_result_path=str(output / "dependency-check-report.json")),
    )
    with Session() as db:
        parent = db.get(models.ScanTask, parent_id)
        _run_dependency_check_child(db, parent, source)
        db.commit()
    assert len(calls) == 1
    with Session() as db:
        assert db.get(models.ScanTask, child_id).status == "completed"


def test_non_java_project_marks_dependency_check_skipped(monkeypatch, tmp_path):
    Session = _session_factory(tmp_path)
    parent_id, child_id = _seed_scan(Session)
    source = tmp_path / "node-source"
    source.mkdir()
    (source / "package.json").write_text("{}", encoding="utf-8")
    with Session() as db:
        parent = db.get(models.ScanTask, parent_id)
        _run_dependency_check_child(db, parent, source)
        db.commit()
    with Session() as db:
        child = db.get(models.ScanTask, child_id)
        assert child.status == "skipped"
        assert "未发现 Java" in child.summary


def test_dependency_check_failure_is_recorded_without_raising(monkeypatch, tmp_path):
    Session = _session_factory(tmp_path)
    parent_id, child_id = _seed_scan(Session)
    source = tmp_path / "failed-java-source"
    source.mkdir()
    (source / "build.gradle").write_text("plugins {}", encoding="utf-8")
    monkeypatch.setattr("app.scanners.dependency_check_client.dependency_check_cache_initialized", lambda _path: True)
    monkeypatch.setattr("app.scanners.dependency_check_client.validate_suppression_file", lambda _path: None)
    monkeypatch.setattr(
        "app.celery_app.DependencyCheckAdapter.scan_source",
        lambda *_args, **_kwargs: ScannerCommandResult(
            "dependency-check", "failed", [], error_message="simulated failure"
        ),
    )
    with Session() as db:
        parent = db.get(models.ScanTask, parent_id)
        result = _run_dependency_check_child(db, parent, source)
        db.commit()
        assert parent.status == "running"
        assert result.status == "failed"
    with Session() as db:
        child = db.get(models.ScanTask, child_id)
        assert child.status == "failed"
        assert "simulated failure" in child.error_message
```

- [ ] **Step 2: 将子任务加入项目步骤**

在 Trivy 后增加：

```python
("dependency_check_scan_task", "dependency-check", settings.dependency_check_timeout),
```

把执行逻辑提取为 `_run_dependency_check_child()`，由 `_run_scanner_children()` 在 Trivy 后调用：

```python
def _run_dependency_check_child(db, task: ScanTask, extract_dir: Path) -> ScannerCommandResult:
    detection = detect_java_project(
        extract_dir,
        max_files=settings.dependency_check_detection_max_files,
        max_depth=settings.dependency_check_detection_max_depth,
        max_matches=settings.dependency_check_detection_max_matches,
    )
    if not detection.enabled:
        result = ScannerCommandResult(
            "dependency-check",
            "skipped",
            [],
            error_message="未发现 Java 构建文件或 JAR/WAR/EAR",
        )
        _record_scanner_result(db, task, "dependency_check_scan_task", result)
        return result
    reason = f"自动触发：{', '.join(detection.reasons)}；样例：{', '.join(detection.matched_paths[:5])}"
    _mark_child(db, task.id, "dependency_check_scan_task", "running", reason, 20)
    try:
        result = DependencyCheckAdapter(settings).scan_source(
            extract_dir,
            Path(settings.dependency_check_output_dir) / str(task.id),
            task.project.name if task.project else f"project-{task.project_id}",
        )
    except DependencyCheckLockTimeout as exc:
        result = ScannerCommandResult(
            "dependency-check",
            "skipped",
            [],
            error_type="CACHE_LOCK_TIMEOUT",
            error_message=str(exc),
            warnings=[str(exc)],
        )
    _record_scanner_result(db, task, "dependency_check_scan_task", result)
    return result
```

在 `_run_scanner_children()` 中保存返回值，供统一归一化收集报告路径：

```python
dependency_check_result = _run_dependency_check_child(db, task, extract_dir)
db.add(ScanLog(
    scan_task_id=task.id,
    level="info" if dependency_check_result.status in {"completed", "skipped"} else "warning",
    message=f"Dependency-Check: {dependency_check_result.status} {dependency_check_result.error_message}".strip(),
))
db.commit()
```

- [ ] **Step 3: 写缓存更新状态失败测试**

```python
def test_cache_update_records_last_success(tmp_path):
    from datetime import datetime, timezone
    from app.celery_app import _record_dependency_check_cache_result

    Session = _session_factory(tmp_path)
    result = ScannerCommandResult("dependency-check-update", "completed", [])
    with Session() as db:
        _record_dependency_check_cache_result(
            db,
            result,
            started=datetime(2026, 6, 9, tzinfo=timezone.utc),
            version="12.1.9",
        )
        db.commit()
        values = {row.key: row.value for row in db.query(models.SystemSetting).all()}
        assert values["dependency_check_cache_status"] == "completed"
        assert values["dependency_check_cache_last_success_at"]
        assert values["dependency_check_cache_version"] == "12.1.9"


def test_failed_cache_update_preserves_previous_success_time(tmp_path):
    from datetime import datetime, timezone
    from app.celery_app import _record_dependency_check_cache_result

    Session = _session_factory(tmp_path)
    with Session() as db:
        db.add(models.SystemSetting(
            key="dependency_check_cache_last_success_at",
            value="2026-06-08T00:00:00+00:00",
            updated_by="system",
        ))
        db.commit()
        _record_dependency_check_cache_result(
            db,
            ScannerCommandResult(
                "dependency-check-update",
                "failed",
                [],
                error_message="network unavailable",
            ),
            started=datetime(2026, 6, 9, tzinfo=timezone.utc),
            version="12.1.9",
        )
        db.commit()
        values = {row.key: row.value for row in db.query(models.SystemSetting).all()}
        assert values["dependency_check_cache_status"] == "failed"
        assert values["dependency_check_cache_last_success_at"] == "2026-06-08T00:00:00+00:00"
```

- [ ] **Step 4: 实现周期更新任务**

增加路由和 beat：

```python
"sca.update_dependency_check_data": {"queue": "scanner"},
```

```python
"sca-dependency-check-data-update": {
    "task": "sca.update_dependency_check_data",
    "schedule": settings.dependency_check_update_interval_seconds,
},
```

任务：

```python
def _set_system_setting(db, key: str, value: object, updated_by: str) -> None:
    row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
    if row is None:
        row = SystemSetting(key=key)
        db.add(row)
    row.value = str(value or "")
    row.updated_by = updated_by


def _record_dependency_check_cache_result(
    db,
    result: ScannerCommandResult,
    *,
    started: datetime,
    version: str,
) -> None:
    _set_system_setting(db, "dependency_check_cache_status", result.status, "system")
    _set_system_setting(db, "dependency_check_cache_last_started_at", started.isoformat(), "system")
    _set_system_setting(db, "dependency_check_cache_version", version, "system")
    _set_system_setting(db, "dependency_check_cache_message", result.error_message or result.message, "system")
    if result.status == "completed":
        _set_system_setting(db, "dependency_check_cache_last_success_at", datetime.now(timezone.utc).isoformat(), "system")


@celery_app.task(name="sca.update_dependency_check_data")
def update_dependency_check_data() -> dict[str, str]:
    init_db()
    started = datetime.now(timezone.utc)
    output_dir = Path(settings.dependency_check_output_dir) / "data-update" / started.strftime("%Y%m%dT%H%M%SZ")
    with SessionLocal() as db:
        _set_system_setting(db, "dependency_check_cache_status", "running", "system")
        _set_system_setting(db, "dependency_check_cache_last_started_at", started.isoformat(), "system")
        db.commit()
        result = DependencyCheckAdapter(settings).update_data(output_dir, settings.nvd_api_key)
        _record_dependency_check_cache_result(
            db,
            result,
            started=started,
            version=settings.dependency_check_version,
        )
        db.commit()
        return {"status": result.status, "message": result.error_message or result.message}
```

- [ ] **Step 5: 运行编排测试**

Run:

```bash
cd sca-platform/backend
pytest -q tests/test_dependency_check_pipeline.py
```

Expected: all tests pass。

- [ ] **Step 6: 提交编排和更新任务**

```bash
git add sca-platform/backend/app/celery_app.py sca-platform/backend/app/scanners/dependency_check_client.py sca-platform/backend/tests/test_dependency_check_pipeline.py
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(sca): orchestrate dependency-check scans and updates"
```

## Task 7: 门禁过滤、状态 API 和原始制品下载

**Files:**
- Modify: `sca-platform/backend/app/devops_service.py`
- Modify: `sca-platform/backend/app/schemas.py`
- Modify: `sca-platform/backend/app/main.py`
- Modify: `sca-platform/backend/tests/test_remediation_devops_ops.py`
- Create: `sca-platform/backend/tests/test_dependency_check_api.py`

- [ ] **Step 1: 写门禁只消费 eligible 漏洞的失败测试**

```python
def test_devops_gate_ignores_dependency_check_only_finding(monkeypatch, tmp_path):
    client, _main, models, database = build_client(monkeypatch, tmp_path)
    with client as test_client:
        project_id, vulnerability_id = seed_vulnerability(database, models, severity="critical")
        with database.SessionLocal() as db:
            finding = db.get(models.VulnerabilityRecord, vulnerability_id)
            finding.source = "dependency-check"
            finding.gate_eligible = False
            finding.confirmation_status = "single_source"
            finding.needs_human_review = True
            db.commit()
        response = test_client.post(
            "/api/sca/devops/webhooks/gitlab",
            json={"project_id": project_id, "pipeline_id": "gl-dc", "ref": "main", "commit_sha": "abc"},
        )
    assert response.json()["decision"] == "passed"
```

- [ ] **Step 2: 运行并确认当前门禁仍阻断**

Run:

```bash
cd sca-platform/backend
pytest -q tests/test_remediation_devops_ops.py::test_devops_gate_ignores_dependency_check_only_finding
```

Expected: decision is `blocked`。

- [ ] **Step 3: 修改门禁查询**

```python
select(VulnerabilityRecord).where(
    VulnerabilityRecord.project_id == project.id,
    VulnerabilityRecord.match_status == "affected",
    VulnerabilityRecord.needs_human_review.is_(False),
    VulnerabilityRecord.gate_eligible.is_(True),
)
```

- [ ] **Step 4: 定义缓存和制品响应 schema**

```python
class DependencyCheckStatusOut(BaseModel):
    enabled: bool
    version: str
    status: str
    last_started_at: str = ""
    last_success_at: str = ""
    message: str = ""
    stale: bool
    data_dir: str
    total_scans: int = 0
    failed_scans: int = 0
    skipped_scans: int = 0
    p50_duration_seconds: int = 0
    p95_duration_seconds: int = 0


class RawScanArtifactOut(BaseModel):
    id: int
    project_id: int
    scan_id: int
    engine_name: str
    artifact_type: str
    file_name: str
    file_size: int
    sha256: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
```

同时在现有 `VulnerabilityOut` 增加前端需要的字段：

```python
confirmation_status: str = "single_source"
confirmation_engines: str = "[]"
gate_eligible: bool = True
review_reason: str = ""
```

- [ ] **Step 5: 写 API 失败测试**

```python
import importlib
from hashlib import sha256
from pathlib import Path

from fastapi.testclient import TestClient


def build_dependency_check_client(monkeypatch, tmp_path):
    db_path = tmp_path / "dependency-check-api.db"
    output_root = tmp_path / "scanner-results" / "dependency-check"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("AUTH_DEV_BYPASS", "true")
    monkeypatch.setenv("DEPENDENCY_CHECK_VERSION", "12.1.9")
    monkeypatch.setenv("DEPENDENCY_CHECK_OUTPUT_DIR", str(output_root))
    from app import config
    config.get_settings.cache_clear()
    import app.database as database
    import app.models as models
    import app.celery_app as celery_app
    import app.main as main
    importlib.reload(database)
    importlib.reload(models)
    importlib.reload(celery_app)
    importlib.reload(main)
    database.init_db()
    return TestClient(main.app), models, database, output_root


def seed_artifact(database, models, artifact_path: Path):
    with database.SessionLocal() as db:
        project = models.Project(name="artifact-project")
        upload = models.UploadFileRecord(project=project, upload_id="artifact-u1", original_filename="source.zip")
        scan = models.ScanTask(project=project, upload_file=upload, status="success")
        db.add_all([project, upload, scan])
        db.flush()
        artifact = models.RawScanArtifact(
            project_id=project.id,
            scan_id=scan.id,
            engine_name="dependency-check",
            artifact_type="raw_json",
            file_path=str(artifact_path),
            file_name=artifact_path.name,
            file_size=artifact_path.stat().st_size,
            sha256=sha256(artifact_path.read_bytes()).hexdigest(),
        )
        db.add(artifact)
        db.commit()
        return project.id, artifact.id


def test_dependency_check_status_and_artifact_download(monkeypatch, tmp_path):
    client, models, database, output_root = build_dependency_check_client(monkeypatch, tmp_path)
    artifact_path = output_root / "1" / "dependency-check-report.json"
    artifact_path.parent.mkdir(parents=True)
    artifact_path.write_text('{"dependencies":[]}', encoding="utf-8")
    project_id, artifact_id = seed_artifact(database, models, artifact_path)

    with client as test_client:
        status = test_client.get("/api/sca/dependency-check/status")
        artifacts = test_client.get(f"/api/sca/projects/{project_id}/scan-artifacts")
        download = test_client.get(f"/api/sca/raw-artifacts/{artifact_id}/download")

    assert status.status_code == 200
    assert status.json()["version"] == "12.1.9"
    assert status.json()["total_scans"] == 0
    assert artifacts.json()[0]["engine_name"] == "dependency-check"
    assert download.content == b'{"dependencies":[]}'
    assert "attachment" in download.headers["content-disposition"]
```

- [ ] **Step 6: 实现状态、手动更新和安全下载接口**

接口：

```text
GET  /api/sca/dependency-check/status
POST /api/sca/dependency-check/cache/update
GET  /api/sca/projects/{project_id}/scan-artifacts
GET  /api/sca/raw-artifacts/{artifact_id}/download
```

下载实现必须：

```python
artifact = db.get(RawScanArtifact, artifact_id)
if not artifact:
    raise HTTPException(status_code=404, detail="扫描制品不存在")
path = Path(artifact.file_path).resolve()
allowed_root = Path(settings.dependency_check_output_dir).resolve().parent
if allowed_root != path and allowed_root not in path.parents:
    raise HTTPException(status_code=403, detail="扫描制品路径不安全")
if not path.is_file():
    raise HTTPException(status_code=404, detail="扫描制品文件不存在")
return FileResponse(
    path,
    filename=artifact.file_name,
    media_type="application/octet-stream",
    content_disposition_type="attachment",
)
```

缓存过期计算使用 `last_success_at` 与 `dependency_check_cache_stale_seconds`，解析失败或无成功时间均返回 `stale=true`。

扫描统计从 `ScannerTaskResult.engine_name == "dependency-check"` 的记录实时聚合。百分位函数使用排序后的最近 500 条非负耗时：

```python
def _percentile(values: list[int], ratio: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * ratio)))
    return ordered[index]


rows = list(
    db.scalars(
        select(ScannerTaskResult)
        .where(ScannerTaskResult.engine_name == "dependency-check")
        .order_by(ScannerTaskResult.finished_at.desc(), ScannerTaskResult.id.desc())
        .limit(500)
    )
)
durations = [row.duration_seconds for row in rows if row.duration_seconds >= 0]
metrics = {
    "total_scans": len(rows),
    "failed_scans": sum(row.status in {"failed", "timeout"} for row in rows),
    "skipped_scans": sum(row.status == "skipped" for row in rows),
    "p50_duration_seconds": _percentile(durations, 0.50),
    "p95_duration_seconds": _percentile(durations, 0.95),
}
```

- [ ] **Step 7: 运行 API 和门禁测试**

Run:

```bash
cd sca-platform/backend
pytest -q tests/test_dependency_check_api.py tests/test_remediation_devops_ops.py
```

Expected: all tests pass。

- [ ] **Step 8: 提交 API 和门禁**

```bash
git add sca-platform/backend/app/devops_service.py sca-platform/backend/app/schemas.py sca-platform/backend/app/main.py sca-platform/backend/tests/test_dependency_check_api.py sca-platform/backend/tests/test_remediation_devops_ops.py
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(sca): expose dependency-check status and gate policy"
```

## Task 8: Scanner 镜像、持久卷和 suppression

**Files:**
- Modify: `sca-platform/backend/Dockerfile.scanner`
- Create: `sca-platform/backend/dependency-check-suppression.xml`
- Modify: `sca-platform/docker-compose.yml`
- Modify: `sca-platform/.env.example`
- Modify: `sca-platform/backend/tests/test_dependency_check_pipeline.py`

- [ ] **Step 1: 写配置和 suppression 静态测试**

```python
from pathlib import Path
import xml.etree.ElementTree as ET


def test_dependency_check_suppression_is_valid_xml():
    path = Path(__file__).parents[1] / "dependency-check-suppression.xml"
    root = ET.parse(path).getroot()
    assert root.tag.endswith("suppressions")


def test_compose_mounts_dependency_check_data():
    compose = (Path(__file__).parents[2] / "docker-compose.yml").read_text(encoding="utf-8")
    assert "sca-dependency-check-data:/data/dependency-check" in compose
    assert "./backend/dependency-check-suppression.xml:/etc/dependency-check/suppression.xml:ro" in compose
```

- [ ] **Step 2: 添加最小 suppression 文件**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<suppressions xmlns="https://jeremylong.github.io/DependencyCheck/dependency-suppression.1.3.xsd">
</suppressions>
```

- [ ] **Step 3: 修改 scanner 镜像**

```dockerfile
FROM anchore/syft:v1.45.1 AS syft
FROM aquasec/trivy:0.71.0 AS trivy
FROM opensca/opensca-cli@sha256:4de6af4bc2a2c33586ce471c62b85db66815f17a9dff51eb2c9423025c86829d AS opensca
FROM owasp/dependency-check:12.1.9 AS dependency_check

FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates git default-jre-headless \
    && rm -rf /var/lib/apt/lists/*

COPY --from=dependency_check /usr/share/dependency-check /opt/dependency-check
COPY dependency-check-suppression.xml /etc/dependency-check/suppression.xml
```

现有 Syft、Trivy、OpenSCA 和 Python 安装段保持不变。目录创建补充：

```dockerfile
mkdir -p /data/dependency-check /data/scanner-results/dependency-check \
&& chown -R appuser:appuser /data/dependency-check /data/scanner-results/dependency-check \
&& chmod +x /opt/dependency-check/bin/dependency-check.sh
```

- [ ] **Step 4: 修改 Compose**

`x-sca-environment` 增加所有 Dependency-Check 非敏感配置；`NVD_API_KEY` 复用已有环境变量，不重复定义密钥。

`scanner-worker`、`sca-api`、`sca-worker` 和 `sca-beat` 挂载：

```yaml
- sca-dependency-check-data:/data/dependency-check
- ./backend/dependency-check-suppression.xml:/etc/dependency-check/suppression.xml:ro
```

卷列表增加：

```yaml
sca-dependency-check-data:
```

- [ ] **Step 5: 更新 `.env.example`**

```dotenv
DEPENDENCY_CHECK_ENABLED=true
DEPENDENCY_CHECK_PATH=/opt/dependency-check/bin/dependency-check.sh
DEPENDENCY_CHECK_VERSION=12.1.9
DEPENDENCY_CHECK_TIMEOUT=1800
DEPENDENCY_CHECK_DATA_DIR=/data/dependency-check
DEPENDENCY_CHECK_OUTPUT_DIR=/data/scanner-results/dependency-check
DEPENDENCY_CHECK_SUPPRESSION_FILE=/etc/dependency-check/suppression.xml
DEPENDENCY_CHECK_LOCK_TIMEOUT=120
DEPENDENCY_CHECK_UPDATE_INTERVAL_SECONDS=86400
DEPENDENCY_CHECK_CACHE_STALE_SECONDS=259200
DEPENDENCY_CHECK_MAX_REPORT_BYTES=209715200
```

- [ ] **Step 6: 运行静态测试和 Compose 校验**

Run:

```bash
cd sca-platform/backend
pytest -q tests/test_dependency_check_pipeline.py
cd ..
docker compose config >/tmp/sca-compose-rendered.yml
```

Expected: pytest passes and `docker compose config` exits 0。

- [ ] **Step 7: 构建并检查镜像**

Run:

```bash
cd sca-platform
docker compose build scanner-worker
docker compose run --rm --no-deps scanner-worker /opt/dependency-check/bin/dependency-check.sh --version
docker compose run --rm --no-deps scanner-worker id -u
```

Expected:

```text
Dependency-Check Core version 12.1.9
```

第二条输出不是 `0`。

- [ ] **Step 8: 提交容器配置**

```bash
git add sca-platform/backend/Dockerfile.scanner sca-platform/backend/dependency-check-suppression.xml sca-platform/docker-compose.yml sca-platform/.env.example sca-platform/backend/tests/test_dependency_check_pipeline.py
CODEX_VERSIONING_BYPASS=1 git commit -m "build(sca): package dependency-check scanner"
```

## Task 9: 前端状态、确认标签和报告下载

**Files:**
- Modify: `sca-platform/frontend/src/composables/projectDataLoader.js`
- Modify: `sca-platform/frontend/src/App.vue`
- Modify: `sca-platform/frontend/src/styles.css`

- [ ] **Step 1: 扩展项目详情请求**

在 `loadProjectDetailRequests()` 尾部增加：

```javascript
requestJson('/api/sca/dependency-check/status'),
requestJson(`/api/sca/projects/${projectId}/scan-artifacts`),
```

并在 `App.vue` 解构结果中增加 `dependencyCheckResult`、`scanArtifactsResult`。

- [ ] **Step 2: 增加响应状态**

```javascript
const dependencyCheckStatus = reactive({
  enabled: true,
  version: '',
  status: 'unknown',
  last_started_at: '',
  last_success_at: '',
  message: '',
  stale: true,
  data_dir: '',
  total_scans: 0,
  failed_scans: 0,
  skipped_scans: 0,
  p50_duration_seconds: 0,
  p95_duration_seconds: 0,
})
const scanArtifacts = ref([])

const dependencyCheckArtifacts = computed(() => (
  scanArtifacts.value.filter((item) => item.engine_name === 'dependency-check')
))
const dependencyCheckTask = computed(() => (
  scanTasks.value.find((item) => item.task_type === 'dependency_check_scan_task') || null
))
const dependencyCheckIndependentCount = computed(() => (
  vulnerabilities.value.filter((item) => (
    item.source === 'dependency-check' && item.confirmation_status === 'single_source'
  )).length
))
const dependencyCheckConfirmedCount = computed(() => (
  vulnerabilities.value.filter((item) => (
    (item.confirmation_engines || '').includes('dependency-check')
    && item.confirmation_status === 'cross_confirmed'
  )).length
))
```

- [ ] **Step 3: 在扫描完整度区域增加状态卡片**

```vue
<section class="dependency-check-summary">
  <div>
    <span>Dependency-Check</span>
    <strong>{{ dependencyCheckTask?.status || '未运行' }}</strong>
  </div>
  <div>
    <span>工具版本</span>
    <strong>{{ dependencyCheckStatus.version || '-' }}</strong>
  </div>
  <div>
    <span>漏洞库更新</span>
    <strong :class="{ 'status-warning': dependencyCheckStatus.stale }">
      {{ dependencyCheckStatus.last_success_at || '未初始化' }}
    </strong>
  </div>
  <div>
    <span>独立发现</span>
    <strong>{{ dependencyCheckIndependentCount }}</strong>
  </div>
  <div>
    <span>交叉确认</span>
    <strong>{{ dependencyCheckConfirmedCount }}</strong>
  </div>
  <div>
    <span>P95 耗时</span>
    <strong>{{ dependencyCheckStatus.p95_duration_seconds || 0 }}s</strong>
  </div>
  <div>
    <span>失败/跳过</span>
    <strong>{{ dependencyCheckStatus.failed_scans || 0 }}/{{ dependencyCheckStatus.skipped_scans || 0 }}</strong>
  </div>
</section>
<el-alert
  v-if="dependencyCheckTask?.summary"
  :title="dependencyCheckTask.summary"
  :type="dependencyCheckTask.status === 'failed' ? 'warning' : 'info'"
  :closable="false"
  show-icon
/>
```

- [ ] **Step 4: 在漏洞表增加确认状态**

```vue
<el-table-column label="确认状态" width="170">
  <template #default="{ row }">
    <el-tag
      :type="row.confirmation_status === 'cross_confirmed' ? 'success' : 'warning'"
      effect="plain"
    >
      {{ row.confirmation_status === 'cross_confirmed' ? '多引擎确认' : '待人工复核' }}
    </el-tag>
    <small v-if="!row.gate_eligible" class="muted">不参与门禁</small>
  </template>
</el-table-column>
```

- [ ] **Step 5: 增加原始报告下载**

```vue
<div class="dependency-check-artifacts">
  <el-button
    v-for="artifact in dependencyCheckArtifacts"
    :key="artifact.id"
    text
    type="primary"
    @click="downloadScanArtifact(artifact)"
  >
    {{ artifact.file_name }}
  </el-button>
</div>
```

```javascript
const downloadScanArtifact = (artifact) => {
  window.open(apiUrl(`/api/sca/raw-artifacts/${artifact.id}/download`), '_blank')
}
```

- [ ] **Step 6: 增加样式并构建**

```css
.dependency-check-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
  margin: 14px 0;
}

.dependency-check-summary > div {
  padding: 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  background: var(--el-fill-color-blank);
}

.dependency-check-summary span,
.dependency-check-summary strong {
  display: block;
}

.status-warning {
  color: var(--el-color-warning);
}
```

Run:

```bash
cd sca-platform/frontend
npm run build
```

Expected: Vite build succeeds with no compile errors。

- [ ] **Step 7: 浏览器验证**

启动本地 SCA 后使用 Browser 打开 `http://localhost:18089`，确认：

1. 非 Java 项目显示“未发现 Java”。
2. Java 项目显示触发原因和工具版本。
3. 缓存未初始化/过期有警告色。
4. 单源结果显示“待人工复核”和“不参与门禁”。
5. JSON/HTML 报告点击后以附件下载。

- [ ] **Step 8: 提交前端**

```bash
git add sca-platform/frontend/src/composables/projectDataLoader.js sca-platform/frontend/src/App.vue sca-platform/frontend/src/styles.css
CODEX_VERSIONING_BYPASS=1 git commit -m "feat(sca): show dependency-check scan evidence"
```

## Task 10: 文档、全量验证和功能版本发布

**Files:**
- Modify: `sca-platform/README.md`
- Modify: `sca-platform/backend/app/config.py`
- Modify: `sca-platform/docker-compose.yml`
- Modify: version files updated automatically by repository hook

- [ ] **Step 1: 更新运维文档**

README 必须包含以下可执行命令：

```bash
# 首次初始化漏洞库
docker compose exec scanner-worker \
  celery -A app.celery_app.celery_app call sca.update_dependency_check_data

# 查看缓存任务日志
docker compose logs -f scanner-worker

# 验证工具版本
docker compose exec scanner-worker \
  /opt/dependency-check/bin/dependency-check.sh --version

# 查看持久卷占用
docker system df -v
docker volume inspect sca-platform_sca-dependency-check-data
```

文档同时说明：

- 项目扫描固定 `--noupdate`。
- 首次初始化完成前 Java 扫描降级跳过。
- 全局 suppression 文件位置和变更流程。
- Dependency-Check 单源结果不阻断，交叉确认才参与门禁。
- 推荐为漏洞库预留至少 5 GB 可增长空间，并通过实际灰度数据调整。
- NVD API Key 只通过环境变量提供，禁止写入仓库。

- [ ] **Step 2: 运行后端定向测试**

Run:

```bash
cd sca-platform/backend
pytest -q \
  tests/test_dependency_check_detector.py \
  tests/test_dependency_check_normalizer.py \
  tests/test_dependency_check_pipeline.py \
  tests/test_dependency_check_gate.py \
  tests/test_dependency_check_api.py \
  tests/test_scanner_adapters.py \
  tests/test_remediation_devops_ops.py
```

Expected: all selected tests pass。

- [ ] **Step 3: 运行后端全量测试**

Run:

```bash
cd sca-platform/backend
pytest -q
```

Expected: all tests pass, no unexpected warnings or errors。

- [ ] **Step 4: 运行前端和 Compose 验证**

Run:

```bash
cd sca-platform/frontend
npm run build
cd ..
docker compose config >/tmp/sca-compose-rendered.yml
docker compose build scanner-worker
```

Expected: all commands exit 0。

- [ ] **Step 5: 运行镜像安全和工具验证**

Run:

```bash
cd sca-platform
docker compose run --rm --no-deps scanner-worker /opt/dependency-check/bin/dependency-check.sh --version
docker compose run --rm --no-deps scanner-worker sh -lc 'test "$(id -u)" != "0"'
docker compose run --rm --no-deps scanner-worker sh -lc 'test -r /etc/dependency-check/suppression.xml'
```

Expected: Dependency-Check reports `12.1.9`; all commands exit 0。

- [ ] **Step 6: 校验版本显示源**

功能提交将从当前 `5.68.x` 升到 `5.69.0`。在最终提交前，把未由版本钩子自动覆盖的运行时默认值显式改为 `5.69.0`：

```python
app_version: str = "5.69.0"
```

```yaml
APP_VERSION: ${SCA_APP_VERSION:-5.69.0}
```

然后运行：

```bash
rg -n '5\.68\.[0-9]+|5\.69\.0' \
  package.json \
  sca-platform/backend/app/config.py \
  sca-platform/docker-compose.yml \
  sca-platform/frontend/package.json
```

Expected: SCA 运行时默认版本和前端包版本最终均为 `5.69.0`。

- [ ] **Step 7: 检查差异和无关文件**

Run:

```bash
git diff --check
git status --short
git diff --stat codex/5.68.1...HEAD
```

Expected: no whitespace errors；未跟踪的历史文件仍未加入索引。

- [ ] **Step 8: 创建最终功能提交并触发自动版本/推送**

先暂存本任务尚未提交的 README 和运行时版本默认值：

```bash
git add sca-platform/README.md sca-platform/backend/app/config.py sca-platform/docker-compose.yml
git commit -m "feat(sca): add dependency-check Java scanning"
```

Expected hook output includes:

```text
[versioning] 5.68.x -> 5.69.0 (minor)
[versioning] moved codex/5.68.x -> codex/5.69.0
[versioning] pushed origin/codex/5.69.0
```

- [ ] **Step 9: 最终远端核验**

Run:

```bash
git status --short --branch
git log -1 --pretty=fuller --decorate
git ls-remote --heads origin codex/5.69.0
git rev-parse HEAD
git rev-parse origin/codex/5.69.0
```

Expected:

- 当前分支为 `codex/5.69.0`。
- HEAD 提交标题带 `[v5.69.0]`。
- 本地 HEAD、远端跟踪分支和 `ls-remote` 哈希一致。
- 只剩任务开始前已有的无关未跟踪文件。

## 灰度验收清单

- [ ] 选取 10 至 20 个 Java 项目，覆盖 Maven、Gradle、JAR、WAR 和多模块。
- [ ] 记录首次缓存初始化耗时和持久卷实际占用。
- [ ] 记录 P50/P95 Dependency-Check 扫描耗时。
- [ ] 核对每个项目独立发现数、交叉确认数和人工误报结论。
- [ ] 把确认的误报写入 `dependency-check-suppression.xml` 并经代码评审发布。
- [ ] 验证缓存更新失败时旧缓存仍可扫描。
- [ ] 验证缓存锁等待超时时主扫描仍成功。
- [ ] 验证 Dependency-Check-only critical 漏洞不阻断 DevSecOps。
- [ ] 验证 Dependency-Check 与其他引擎稳定确认的 critical/high 漏洞按现有策略阻断。
