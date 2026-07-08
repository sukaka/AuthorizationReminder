FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY server/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

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
