import os
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
from io import BytesIO

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.crypto import ContentCipher, EncryptedPayload


def _cipher() -> ContentCipher:
    return ContentCipher(os.environ["CONTENT_ENCRYPTION_KEY"])


def _xlsx_bytes(rows: list[list[str]]) -> bytes:
    def cell_ref(row_index: int, column_index: int) -> str:
        return f"{chr(ord('A') + column_index)}{row_index}"

    sheet_rows = []
    for row_index, row in enumerate(rows, start=1):
        cells = "".join(
            f'<c r="{cell_ref(row_index, column_index)}" t="inlineStr"><is><t>{value}</t></is></c>'
            for column_index, value in enumerate(row)
        )
        sheet_rows.append(f'<row r="{row_index}">{cells}</row>')

    buffer = BytesIO()
    with ZipFile(buffer, "w", ZIP_DEFLATED) as archive:
        archive.writestr(
            "[Content_Types].xml",
            """<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>""",
        )
        archive.writestr(
            "_rels/.rels",
            """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>""",
        )
        archive.writestr(
            "xl/workbook.xml",
            """<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>""",
        )
        archive.writestr(
            "xl/_rels/workbook.xml.rels",
            """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>""",
        )
        archive.writestr(
            "xl/worksheets/sheet1.xml",
            f"""<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>{''.join(sheet_rows)}</sheetData>
</worksheet>""",
        )
    return buffer.getvalue()


def _simple_pdf_bytes(text: str) -> bytes:
    escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    return f"""%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R >> endobj
4 0 obj << /Length 64 >> stream
BT /F1 12 Tf 72 100 Td ({escaped}) Tj ET
endstream endobj
trailer << /Root 1 0 R >>
%%EOF
""".encode("utf-8")


def test_chunk_text_preserves_order_and_section_titles() -> None:
    from app.knowledge_files import chunk_text

    text = "\n".join([
        "一、项目背景",
        "甲" * 80,
        "",
        "二、交付要求",
        "乙" * 80,
    ])

    chunks = chunk_text(
        text,
        target_chars=50,
        max_chars=70,
        overlap_chars=8,
    )

    assert len(chunks) >= 3
    assert [chunk.chunk_index for chunk in chunks] == list(range(len(chunks)))
    assert chunks[0].section_title == "一、项目背景"
    assert chunks[-1].section_title == "二、交付要求"
    assert all(1 <= len(chunk.text) <= 70 for chunk in chunks)


def test_create_knowledge_file_extracts_csv_table_rows(generation_db) -> None:
    from app.knowledge_files import create_knowledge_file_from_bytes

    file_record, chunks = create_knowledge_file_from_bytes(
        generation_db,
        sso_user_id="user-1",
        file_name="客户清单.csv",
        content="客户名称,产品\n聚信得仁,Web动态安全管理平台\n".encode("utf-8"),
        content_type="text/csv",
        cipher=_cipher(),
        key_version="v1",
    )

    assert file_record.file_name == "客户清单.csv"
    assert chunks
    payload = _cipher().decrypt_json(
        EncryptedPayload(
            ciphertext=chunks[0].chunk_text_ciphertext,
            nonce=chunks[0].chunk_text_nonce,
        ),
        chunks[0].chunk_id.encode(),
    )
    assert "客户名称 | 产品" in payload["text"]
    assert "聚信得仁 | Web动态安全管理平台" in payload["text"]


def test_create_knowledge_file_extracts_xlsx_table_rows(generation_db) -> None:
    from app.knowledge_files import create_knowledge_file_from_bytes

    file_record, chunks = create_knowledge_file_from_bytes(
        generation_db,
        sso_user_id="user-1",
        file_name="产品资料.xlsx",
        content=_xlsx_bytes([
            ["资料名称", "业务场景"],
            ["白皮书", "正式知识库"],
        ]),
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        cipher=_cipher(),
        key_version="v1",
    )

    assert file_record.file_name == "产品资料.xlsx"
    assert chunks
    payload = _cipher().decrypt_json(
        EncryptedPayload(
            ciphertext=chunks[0].chunk_text_ciphertext,
            nonce=chunks[0].chunk_text_nonce,
        ),
        chunks[0].chunk_id.encode(),
    )
    assert "资料名称 | 业务场景" in payload["text"]
    assert "白皮书 | 正式知识库" in payload["text"]


def test_create_knowledge_file_extracts_pdf_text(generation_db) -> None:
    from app.knowledge_files import create_knowledge_file_from_bytes

    file_record, chunks = create_knowledge_file_from_bytes(
        generation_db,
        sso_user_id="user-1",
        file_name="产品白皮书.pdf",
        content=_simple_pdf_bytes("Juxin official PDF whitepaper"),
        content_type="application/pdf",
        cipher=_cipher(),
        key_version="v1",
    )

    assert file_record.file_name == "产品白皮书.pdf"
    assert chunks
    payload = _cipher().decrypt_json(
        EncryptedPayload(
            ciphertext=chunks[0].chunk_text_ciphertext,
            nonce=chunks[0].chunk_text_nonce,
        ),
        chunks[0].chunk_id.encode(),
    )
    assert "Juxin official PDF whitepaper" in payload["text"]


def test_create_knowledge_file_persists_encrypted_chunks(
    generation_db,
) -> None:
    from app.knowledge_files import create_knowledge_file_from_bytes
    from app.models import KnowledgeChunk, KnowledgeFile

    file_record, chunks = create_knowledge_file_from_bytes(
        generation_db,
        sso_user_id="user-1",
        file_name="../公司白皮书.txt",
        content=("一、公司介绍\n" + "聚信得仁专注企业安全服务。" * 20).encode("utf-8"),
        content_type="text/plain",
        cipher=_cipher(),
        key_version="v1",
        visibility="PRIVATE",
        target_chars=80,
        max_chars=100,
        overlap_chars=10,
    )
    generation_db.commit()

    assert file_record.uuid
    assert file_record.file_name == "公司白皮书.txt"
    assert file_record.sso_user_id == "user-1"
    assert file_record.visibility == "PRIVATE"
    assert file_record.status == "READY"
    assert len(chunks) >= 2

    stored_file = generation_db.scalar(
        select(KnowledgeFile).where(KnowledgeFile.uuid == file_record.uuid)
    )
    assert stored_file is not None

    stored_chunks = list(
        generation_db.scalars(
            select(KnowledgeChunk)
            .where(KnowledgeChunk.file_id == stored_file.id)
            .order_by(KnowledgeChunk.chunk_index.asc())
        )
    )
    assert [chunk.chunk_index for chunk in stored_chunks] == list(range(len(stored_chunks)))
    assert all(chunk.chunk_id for chunk in stored_chunks)
    assert all(chunk.file_name == "公司白皮书.txt" for chunk in stored_chunks)
    assert stored_chunks[0].section_title == "一、公司介绍"
    assert "聚信得仁".encode("utf-8") not in stored_chunks[0].chunk_text_ciphertext

    decrypted = _cipher().decrypt_json(
        EncryptedPayload(
            ciphertext=stored_chunks[0].chunk_text_ciphertext,
            nonce=stored_chunks[0].chunk_text_nonce,
        ),
        stored_chunks[0].chunk_id.encode(),
    )
    assert "聚信得仁" in decrypted["text"]


def test_create_knowledge_file_persists_original_file_safely(
    generation_db,
    tmp_path,
) -> None:
    from app.knowledge_files import create_knowledge_file_from_bytes

    original_content = b"\xe4\xb8\x80\xe3\x80\x81\xe5\x8e\x9f\xe5\xa7\x8b\xe6\x96\x87\xe4\xbb\xb6\n\xe8\x81\x9a\xe4\xbf\xa1\xe5\xbe\x97\xe4\xbb\x81"

    file_record, _chunks = create_knowledge_file_from_bytes(
        generation_db,
        sso_user_id="user-1",
        file_name="../../客户资料.txt",
        content=original_content,
        content_type="text/plain",
        cipher=_cipher(),
        key_version="v1",
        usage_type="personal_reference",
        storage_root=str(tmp_path),
    )
    generation_db.commit()

    stored_path = Path(file_record.file_path)
    assert stored_path.is_file()
    assert stored_path.read_bytes() == original_content
    assert stored_path.is_relative_to(tmp_path.resolve())
    assert file_record.file_name == "客户资料.txt"
    assert file_record.original_file_name == "客户资料.txt"
    assert file_record.stored_file_name.endswith(".txt")
    assert file_record.stored_file_name != "客户资料.txt"
    assert ".." not in file_record.stored_file_name


def test_create_knowledge_file_rejects_unsupported_type(
    generation_db,
) -> None:
    from app.knowledge_files import create_knowledge_file_from_bytes

    with pytest.raises(HTTPException) as exc_info:
        create_knowledge_file_from_bytes(
            generation_db,
            sso_user_id="user-1",
            file_name="script.exe",
            content=b"not allowed",
            content_type="application/octet-stream",
            cipher=_cipher(),
            key_version="v1",
        )

    assert exc_info.value.status_code == 415
    assert "当前仅支持" in str(exc_info.value.detail)


def test_upload_knowledge_file_api_creates_chunks_and_lists_only_owner(
    client_for_user,
) -> None:
    owner = client_for_user("user-1")
    other = client_for_user("user-2")

    response = owner.post(
        "/api/ai/knowledge/files",
        data={"visibility": "PRIVATE"},
        files={
            "file": (
                "whitepaper.txt",
                ("一、公司介绍\n" + "聚信得仁专注企业安全服务。" * 20).encode("utf-8"),
                "text/plain",
            )
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["file_uuid"]
    assert body["file_name"] == "whitepaper.txt"
    assert body["status"] == "READY"
    assert body["chunk_count"] >= 1
    assert body["created_at"]

    owner_list = owner.get("/api/ai/knowledge/files")
    assert owner_list.status_code == 200
    assert owner_list.json()["total"] == 1
    assert owner_list.json()["items"][0]["file_uuid"] == body["file_uuid"]

    other_list = other.get("/api/ai/knowledge/files")
    assert other_list.status_code == 200
    assert other_list.json()["total"] == 0


def test_employee_upload_defaults_to_private_personal_reference(
    client_for_user,
    generation_db,
) -> None:
    from app.models import KnowledgeFile

    owner = client_for_user("user-1")

    response = owner.post(
        "/api/ai/knowledge/files",
        files={
            "file": (
                "meeting.md",
                "会议记录\n\n请整理纪要".encode("utf-8"),
                "text/markdown",
            )
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["usage_type"] == "personal_reference"
    assert body["source_type"] == "user_upload"
    assert body["review_status"] == "draft"
    assert body["rag_enabled"] is False
    assert body["reference_enabled"] is True
    assert body["rag_scope"] == "personal"
    assert body["permission_scope"] == "private"

    stored_file = generation_db.scalar(
        select(KnowledgeFile).where(KnowledgeFile.uuid == body["file_uuid"])
    )
    assert stored_file is not None
    assert stored_file.owner_user_id == "user-1"
    assert stored_file.uploaded_by == "user-1"


def test_employee_cannot_upload_directly_as_official_rag_document(
    client_for_user,
    generation_db,
) -> None:
    from app.models import KnowledgeFile

    employee = client_for_user("user-1")

    response = employee.post(
        "/api/ai/knowledge/files",
        data={
            "visibility": "PUBLIC",
            "usage_type": "official_knowledge",
            "review_status": "official",
            "rag_enabled": "true",
            "rag_scope": "company",
            "permission_scope": "company",
        },
        files={
            "file": (
                "official.txt",
                "正式知识库绕过测试".encode("utf-8"),
                "text/plain",
            )
        },
    )

    assert response.status_code == 403
    assert generation_db.scalar(select(KnowledgeFile)) is None


def test_admin_can_upload_official_rag_document(
    client_for_user,
    generation_db,
) -> None:
    from app.models import KnowledgeFile

    admin = client_for_user("admin-1", role="admin")

    response = admin.post(
        "/api/ai/knowledge/files",
        data={
            "usage_type": "official_knowledge",
            "rag_enabled": "true",
            "rag_scope": "company",
            "permission_scope": "company",
            "category": "产品资料",
            "document_type": "产品白皮书",
            "tags": "Web动态安全管理平台,等保三级",
        },
        files={
            "file": (
                "product-whitepaper.txt",
                ("一、产品资料\n" + "聚信得仁产品正式资料。" * 20).encode("utf-8"),
                "text/plain",
            )
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["usage_type"] == "official_knowledge"
    assert body["source_type"] == "admin_upload"
    assert body["review_status"] == "official"
    assert body["rag_enabled"] is True
    assert body["reference_enabled"] is True
    assert body["rag_scope"] == "company"
    assert body["permission_scope"] == "company"
    assert body["visibility"] == "PUBLIC"
    assert body["category"] == "产品资料"
    assert body["document_type"] == "产品白皮书"
    assert body["tags"] == ["Web动态安全管理平台", "等保三级"]

    stored_file = generation_db.scalar(
        select(KnowledgeFile).where(KnowledgeFile.uuid == body["file_uuid"])
    )
    assert stored_file is not None
    assert stored_file.owner_user_id == "admin-1"
    assert stored_file.uploaded_by == "admin-1"


def test_delete_knowledge_file_api_disables_owner_file(
    client_for_user,
    generation_db,
) -> None:
    from app.models import KnowledgeChunk, KnowledgeFile

    owner = client_for_user("user-1")
    created = owner.post(
        "/api/ai/knowledge/files",
        files={
            "file": (
                "delete-me.txt",
                "删除测试内容".encode("utf-8"),
                "text/plain",
            )
        },
    ).json()

    response = owner.delete(f"/api/ai/knowledge/files/{created['file_uuid']}")

    assert response.status_code == 204
    file_record = generation_db.scalar(
        select(KnowledgeFile).where(KnowledgeFile.uuid == created["file_uuid"])
    )
    assert file_record is not None
    assert file_record.status == "DELETED"
    chunk_statuses = list(
        generation_db.scalars(
            select(KnowledgeChunk.status).where(KnowledgeChunk.file_id == file_record.id)
        )
    )
    assert chunk_statuses
    assert set(chunk_statuses) == {"DELETED"}
