ARG PYTHON_BASE_IMAGE=ccr.ccs.tencentyun.com/library/python:3.12-slim
FROM ${PYTHON_BASE_IMAGE}

ARG DEBIAN_APT_MIRROR=http://mirrors.aliyun.com/debian
ARG DEBIAN_SECURITY_MIRROR=http://mirrors.aliyun.com/debian-security

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN set -eux; \
    . /etc/os-release; \
    debian_codename="${VERSION_CODENAME:-bookworm}"; \
    if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
      printf '%s\n' \
        'Types: deb' \
        "URIs: ${DEBIAN_APT_MIRROR}" \
        "Suites: ${debian_codename} ${debian_codename}-updates" \
        'Components: main' \
        'Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg' \
        '' \
        'Types: deb' \
        "URIs: ${DEBIAN_SECURITY_MIRROR}" \
        "Suites: ${debian_codename}-security" \
        'Components: main' \
        'Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg' \
        > /etc/apt/sources.list.d/debian.sources; \
    else \
      printf 'deb %s %s main\ndeb %s %s-updates main\ndeb %s %s-security main\n' \
        "${DEBIAN_APT_MIRROR}" "${debian_codename}" \
        "${DEBIAN_APT_MIRROR}" "${debian_codename}" \
        "${DEBIAN_SECURITY_MIRROR}" "${debian_codename}" \
        > /etc/apt/sources.list; \
    fi; \
    apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
RUN adduser --disabled-password --gecos "" appuser \
    && mkdir -p /data/sca/uploads /data/sca/reports /data/sca/sbom /data/sca/backups /data/scanner-results /data/trivy-cache \
    && chown -R appuser:appuser /data/sca /data/scanner-results /data/trivy-cache
USER appuser

EXPOSE 5191
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5191", "--workers", "4"]
