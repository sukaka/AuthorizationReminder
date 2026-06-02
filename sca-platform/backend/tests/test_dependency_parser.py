from pathlib import Path


def test_dependency_parser_reads_common_manifests(tmp_path):
    (tmp_path / "package.json").write_text(
        '{"dependencies":{"vue":"^3.5.13"},"devDependencies":{"vite":"6.0.7"}}',
        encoding="utf-8",
    )
    (tmp_path / "requirements.txt").write_text("fastapi==0.115.6\nuvicorn>=0.32\n", encoding="utf-8")
    (tmp_path / "go.mod").write_text(
        "module demo\nrequire (\n  github.com/gin-gonic/gin v1.10.0\n)\n",
        encoding="utf-8",
    )
    (tmp_path / "pom.xml").write_text(
        """
        <project>
          <dependencies>
            <dependency>
              <groupId>org.springframework.boot</groupId>
              <artifactId>spring-boot-starter-web</artifactId>
              <version>3.3.0</version>
            </dependency>
          </dependencies>
        </project>
        """,
        encoding="utf-8",
    )
    (tmp_path / "Dockerfile").write_text("FROM python:3.12-slim\n", encoding="utf-8")

    from app.dependency_parser import parse_source_dependencies

    result = parse_source_dependencies(Path(tmp_path))
    names = {(item.ecosystem, item.name, item.version) for item in result.components}

    assert ("npm", "vue", "^3.5.13") in names
    assert ("npm", "vite", "6.0.7") in names
    assert ("pypi", "fastapi", "0.115.6") in names
    assert ("go", "github.com/gin-gonic/gin", "v1.10.0") in names
    assert ("maven", "org.springframework.boot:spring-boot-starter-web", "3.3.0") in names
    assert ("docker", "python", "3.12-slim") in names
    assert result.dependencies


def test_dependency_parser_standardizes_components_and_uses_lock_evidence(tmp_path):
    (tmp_path / "package.json").write_text(
        '{"dependencies":{"@vue/runtime-core":"^3.5.13"},"devDependencies":{"vite":"^6.0.0"}}',
        encoding="utf-8",
    )
    (tmp_path / "package-lock.json").write_text(
        """
        {
          "lockfileVersion": 3,
          "packages": {
            "node_modules/@vue/runtime-core": {
              "version": "3.5.14",
              "dev": false
            },
            "node_modules/vite": {
              "version": "6.0.7",
              "dev": true
            }
          }
        }
        """,
        encoding="utf-8",
    )
    (tmp_path / "requirements.txt").write_text("My_Package.Name==1.0.0\n", encoding="utf-8")
    (tmp_path / "pom.xml").write_text(
        """
        <project>
          <dependencies>
            <dependency>
              <groupId>org.springframework</groupId>
              <artifactId>spring-core</artifactId>
              <version>6.1.0</version>
            </dependency>
          </dependencies>
        </project>
        """,
        encoding="utf-8",
    )
    (tmp_path / "Dockerfile").write_text("FROM eclipse-temurin:21-jre\n", encoding="utf-8")

    from app.dependency_parser import parse_source_dependencies

    result = parse_source_dependencies(Path(tmp_path))
    by_name = {item.name: item for item in result.components}

    npm_component = by_name["@vue/runtime-core"]
    assert npm_component.version == "3.5.14"
    assert npm_component.package_manager == "npm"
    assert npm_component.normalized_name == "@vue/runtime-core"
    assert npm_component.purl == "pkg:npm/%40vue/runtime-core@3.5.14"
    assert npm_component.detected_by == "lock"
    assert npm_component.source_path == "package-lock.json"
    assert npm_component.version_conflict is True
    assert "package.json" in npm_component.conflict_reason
    assert npm_component.evidence_file == "package-lock.json"
    assert npm_component.evidence_line > 0
    assert npm_component.confidence_score >= 0.9

    pypi_component = by_name["My_Package.Name"]
    assert pypi_component.normalized_name == "my-package-name"
    assert pypi_component.purl == "pkg:pypi/my-package-name@1.0.0"

    maven_component = by_name["org.springframework:spring-core"]
    assert maven_component.group_id == "org.springframework"
    assert maven_component.artifact_id == "spring-core"
    assert maven_component.purl == "pkg:maven/org.springframework/spring-core@6.1.0"

    image_component = by_name["eclipse-temurin"]
    assert image_component.dependency_type == "base_image"
    assert image_component.evidence_text == "FROM eclipse-temurin:21-jre"


def test_dependency_parser_classifies_unlocked_and_range_versions(tmp_path):
    (tmp_path / "requirements.txt").write_text(
        "requests==2.32.3\nflask\nuvicorn>=0.32\n",
        encoding="utf-8",
    )
    (tmp_path / "package.json").write_text(
        '{"dependencies":{"lodash":"^4.17.0","react":"~18.2.0","left-pad":"latest"}}',
        encoding="utf-8",
    )
    (tmp_path / "go.mod").write_text(
        "module demo\nrequire github.com/gin-gonic/gin v1.9.1\n",
        encoding="utf-8",
    )

    from app.dependency_parser import parse_source_dependencies

    result = parse_source_dependencies(Path(tmp_path))
    by_name = {item.name: item for item in result.components}

    assert by_name["requests"].version == "2.32.3"
    assert by_name["requests"].version_lock_status == "已锁定版本"
    assert by_name["requests"].version_risk_type == ""
    assert by_name["flask"].version == "unknown"
    assert by_name["flask"].version_risk_type == "版本缺失风险"
    assert by_name["flask"].need_manual_version_confirm is True
    assert by_name["uvicorn"].version_lock_status == "版本范围风险"
    assert by_name["lodash"].version_lock_status == "版本范围风险"
    assert by_name["react"].version_lock_status == "版本范围风险"
    assert by_name["left-pad"].version_lock_status == "动态版本风险"
    assert by_name["github.com/gin-gonic/gin"].version_lock_status == "已锁定版本"


def test_dependency_parser_uses_node_lock_actual_version_but_keeps_range_risk(tmp_path):
    (tmp_path / "package.json").write_text(
        '{"dependencies":{"lodash":"^4.17.0"}}',
        encoding="utf-8",
    )
    (tmp_path / "package-lock.json").write_text(
        '{"packages":{"node_modules/lodash":{"version":"4.17.21"}}}',
        encoding="utf-8",
    )

    from app.dependency_parser import parse_source_dependencies

    result = parse_source_dependencies(Path(tmp_path))
    item = result.components[0]

    assert item.name == "lodash"
    assert item.version == "4.17.21"
    assert item.resolved_version == "4.17.21"
    assert item.declared_version == "^4.17.0"
    assert item.version_lock_status == "基于实际版本匹配"
    assert item.version_risk_type == "版本范围风险"
    assert item.detected_by == "lock"


def test_dependency_parser_fallback_detects_jar_metadata_when_no_manifest(tmp_path):
    import zipfile

    jar_path = tmp_path / "log4j-core-2.14.1.jar"
    with zipfile.ZipFile(jar_path, "w") as jar:
        jar.writestr(
            "META-INF/maven/org.apache.logging.log4j/log4j-core/pom.properties",
            "groupId=org.apache.logging.log4j\nartifactId=log4j-core\nversion=2.14.1\n",
        )

    from app.dependency_parser import parse_source_dependencies

    result = parse_source_dependencies(Path(tmp_path))
    item = result.components[0]

    assert result.has_standard_manifest is False
    assert result.fallback_enabled is True
    assert result.scan_mode == "binary_scan"
    assert item.name == "org.apache.logging.log4j:log4j-core"
    assert item.purl == "pkg:maven/org.apache.logging.log4j/log4j-core@2.14.1"
    assert item.detection_method == "jar_pom_properties"
    assert item.confidence_level == "High"
    assert item.sha256


def test_dependency_parser_fallback_detects_python_import_unknown_version(tmp_path):
    (tmp_path / "main.py").write_text("import PIL\nfrom yaml import safe_load\n", encoding="utf-8")

    from app.dependency_parser import parse_source_dependencies

    result = parse_source_dependencies(Path(tmp_path))
    by_name = {item.name: item for item in result.components}

    assert result.fallback_enabled is True
    assert result.scan_mode == "source_heuristic_scan"
    assert by_name["Pillow"].version == "unknown"
    assert by_name["Pillow"].need_manual_version_confirm is True
    assert by_name["Pillow"].confidence_level == "Review"
    assert by_name["PyYAML"].evidence_text == "from yaml import safe_load"


def test_dependency_parser_reads_gradle_go_and_language_lock_files(tmp_path):
    (tmp_path / "build.gradle").write_text(
        "dependencies {\n  implementation 'com.example:demo:1.+'\n}\n",
        encoding="utf-8",
    )
    (tmp_path / "go.sum").write_text(
        "github.com/pkg/errors v0.9.1 h1:abc\n"
        "github.com/pkg/errors v0.9.1/go.mod h1:def\n",
        encoding="utf-8",
    )
    (tmp_path / "composer.lock").write_text(
        '{"packages":[{"name":"monolog/monolog","version":"2.9.1"}]}',
        encoding="utf-8",
    )
    (tmp_path / "Cargo.lock").write_text(
        '[[package]]\nname = "serde"\nversion = "1.0.217"\n\n',
        encoding="utf-8",
    )
    (tmp_path / "Gemfile.lock").write_text(
        "GEM\n  specs:\n    rack (3.0.8)\n",
        encoding="utf-8",
    )

    from app.dependency_parser import parse_source_dependencies

    result = parse_source_dependencies(Path(tmp_path))
    by_name = {item.name: item for item in result.components}

    assert by_name["com.example:demo"].version_lock_status == "版本范围风险"
    assert by_name["github.com/pkg/errors"].version == "v0.9.1"
    assert by_name["github.com/pkg/errors"].detected_by == "lock"
    assert by_name["monolog/monolog"].ecosystem == "composer"
    assert by_name["serde"].ecosystem == "cargo"
    assert by_name["rack"].ecosystem == "gem"
