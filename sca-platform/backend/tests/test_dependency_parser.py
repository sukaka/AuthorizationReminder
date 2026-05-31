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
