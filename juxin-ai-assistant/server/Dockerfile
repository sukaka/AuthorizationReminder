ARG PYTHON_BASE_IMAGE=python:3.12-slim
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
    && apt-get install -y --no-install-recommends curl nodejs npm chromium \
    && rm -rf /var/lib/apt/lists/*

COPY server/requirements.txt ./
RUN pip install --no-cache-dir --timeout 120 --retries 10 -r requirements.txt

COPY server/app ./app
COPY server/company_profile ./company_profile
COPY server/prompts ./prompts
COPY server/alembic.ini ./alembic.ini
COPY server/alembic ./alembic
COPY server/catalog ./catalog
COPY server/scripts ./scripts
COPY agent-harness ./agent-harness

RUN adduser --disabled-password --gecos "" appuser \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 5193
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5193", "--workers", "2"]
