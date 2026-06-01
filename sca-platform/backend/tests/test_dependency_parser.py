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
