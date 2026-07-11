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


def _xlsx_bytes(rows: list[list[str]], *, sheet_name: str = "Sheet1") -> bytes:
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
            f"""<?xml version="1.0" encoding="UTF-8"?>
	<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
	          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
	  <sheets><sheet name="{sheet_name}" sheetId="1" r:id="rId1"/></sheets>
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


def _pptx_bytes(slides: list[tuple[str, str]], notes: list[str] | None = None) -> bytes:
    buffer = BytesIO()
    notes = notes or []
    with ZipFile(buffer, "w", ZIP_DEFLATED) as archive:
        archive.writestr(
            "[Content_Types].xml",
            """<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
</Types>""",
        )
        for index, (title, body) in enumerate(slides, start=1):
            archive.writestr(
                f"ppt/slides/slide{index}.xml",
                f"""<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:txBody><a:p><a:r><a:t>{title}</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:txBody><a:p><a:r><a:t>{body}</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sld>""",
            )
        for index, note in enumerate(notes, start=1):
            archive.writestr(
                f"ppt/notesSlides/notesSlide{index}.xml",
                f"""<?xml version="1.0" encoding="UTF-8"?>
<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
         xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>{note}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:notes>""",
            )
    return buffer.getvalue()



def _pdf_bytes(text: str) -> bytes:
    safe_text = (
        text.replace('\\', '\\\\')
        .replace('(', '\\(')
        .replace(')', '\\)')
    )
    objects: list[bytes] = [
        b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
        b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
        b"3 0 obj << /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >> endobj\n",
        b"4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
    ]
    stream = f"BT /F1 18 Tf 72 720 Td ({safe_text}) Tj ET".encode("utf-8")
    objects.append(
        b"5 0 obj << /Length "
        + str(len(stream)).encode("ascii")
        + b" >> stream\n"
        + stream
        + b"\nendstream endobj\n"
    )
    output = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for obj in objects:
        offsets.append(len(output))
        output.extend(obj)
    xref_offset = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    output.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    output.extend(
        f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n".encode("ascii")
    )
    return bytes(output)

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


def test_create_knowledge_file_rejects_csv_with_first_version_message(generation_db) -> None:
    from app.knowledge_files import create_knowledge_file_from_bytes

    with pytest.raises(HTTPException) as exc_info:
        create_knowledge_file_from_bytes(
            generation_db,
            sso_user_id="user-1",
            file_name="客户清单.csv",
            content="客户名称,产品\n聚信得仁,Web动态安全管理平台\n".encode("utf-8"),
            content_type="text/csv",
            cipher=_cipher(),
            key_version="v1",
        )

    assert exc_info.value.status_code == 415
    assert exc_info.value.detail == "当前版本暂不支持该文件类型，请上传 pdf、docx、xlsx、pptx、txt、md、png、jpg、jpeg 或 webp 文件。"


def test_create_knowledge_file_extracts_xlsx_table_rows(generation_db) -> None:
    from app.knowledge_files import create_knowledge_file_from_bytes

    file_record, chunks = create_knowledge_file_from_bytes(
        generation_db,
        sso_user_id="user-1",
        file_name="产品资料.xlsx",
        content=_xlsx_bytes([
            ["资料名称", "业务场景"],
            ["白皮书", "正式知识库"],
        ], sheet_name="产品参数"),
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        cipher=_cipher(),
        key_version="v1",
    )

    assert file_record.file_name == "产品资料.xlsx"
    assert chunks
    assert chunks[0].section_title == "产品参数"
    assert chunks[0].metadata_json["page_or_sheet"] == "产品参数"
    assert chunks[0].metadata_json["chunk_type"] == "sheet_rows"
    assert chunks[0].metadata_json["headers"] == ["资料名称", "业务场景"]
    assert chunks[0].metadata_json["sheet_name"] == "产品参数"
    payload = _cipher().decrypt_json(
        EncryptedPayload(
            ciphertext=chunks[0].chunk_text_ciphertext,
            nonce=chunks[0].chunk_text_nonce,
        ),
        chunks[0].chunk_id.encode(),
    )
    assert "资料名称 | 业务场景" in payload["text"]
    assert "资料名称=白皮书" in payload["text"]
    assert "业务场景=正式知识库" in payload["text"]


def test_create_knowledge_file_generates_real_embedding_metadata(generation_db) -> None:
    from app.knowledge_files import create_knowledge_file_from_bytes

    _file_record, chunks = create_knowledge_file_from_bytes(
        generation_db,
        sso_user_id="user-1",
        file_name="安全服务资料.txt",
        content="一、安全服务\n聚信安全服务包含应急响应和风险评估。".encode("utf-8"),
        content_type="text/plain",
        cipher=_cipher(),
        key_version="v1",
    )

    assert chunks
    embedding = chunks[0].metadata_json["embedding"]
    assert embedding["provider"] == "local-hash"
    assert embedding["version"] == "v1"
    assert embedding["dimensions"] >= 64
    assert isinstance(embedding["vector"], list)
    assert len(embedding["vector"]) == embedding["dimensions"]
    assert any(abs(value) > 0 for value in embedding["vector"])
    assert chunks[0].embedding_id.startswith("local-hash-v1:")
    assert not chunks[0].embedding_id.startswith("local-sparse:")


def test_create_knowledge_file_extracts_pptx_slides_and_notes(generation_db) -> None:
    from app.knowledge_files import create_knowledge_file_from_bytes

    file_record, chunks = create_knowledge_file_from_bytes(
        generation_db,
        sso_user_id="user-1",
        file_name="产品介绍.pptx",
        content=_pptx_bytes(
            [("WEB动态安全管理平台", "支持 SQL 注入识别、Webshell 动态检测")],
            notes=["备注：用于售前介绍"],
        ),
        content_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        cipher=_cipher(),
        key_version="v1",
    )

    assert file_record.file_name == "产品介绍.pptx"
    assert chunks
    assert chunks[0].section_title == "WEB动态安全管理平台"
    assert chunks[0].metadata_json["page_or_sheet"] == "幻灯片 1"
    assert chunks[0].metadata_json["chunk_type"] == "slide"
    assert chunks[0].metadata_json["slide_index"] == 1
    payload = _cipher().decrypt_json(
        EncryptedPayload(
            ciphertext=chunks[0].chunk_text_ciphertext,
            nonce=chunks[0].chunk_text_nonce,
        ),
        chunks[0].chunk_id.encode(),
    )
    assert "SQL 注入识别" in payload["text"]
    assert "备注：用于售前介绍" in payload["text"]


def test_create_knowledge_file_extracts_pdf_pages(generation_db) -> None:
    from app.knowledge_files import create_knowledge_file_from_bytes

    file_record, chunks = create_knowledge_file_from_bytes(
        generation_db,
        sso_user_id="user-1",
        file_name="product-whitepaper.pdf",
        content=_pdf_bytes("WDSP web application security platform"),
        content_type="application/pdf",
        cipher=_cipher(),
        key_version="v1",
    )

    assert file_record.file_name == "product-whitepaper.pdf"
    assert chunks
    assert chunks[0].page_number == 1
    assert chunks[0].section_title == "第 1 页"
    assert chunks[0].metadata_json["page_or_sheet"] == "第 1 页"
    assert chunks[0].metadata_json["chunk_type"] == "pdf_page"
    payload = _cipher().decrypt_json(
        EncryptedPayload(
            ciphertext=chunks[0].chunk_text_ciphertext,
            nonce=chunks[0].chunk_text_nonce,
        ),
        chunks[0].chunk_id.encode(),
    )
    assert "WDSP web application security platform" in payload["text"]


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


def test_create_knowledge_file_limits_long_section_titles(
    generation_db,
) -> None:
    from app.knowledge_files import create_knowledge_file_from_bytes
    from app.models import KnowledgeChunk, KnowledgeFile

    long_title = "一、" + "投标人参加本项目招标活动前三年内无重大违法违规行为" * 12
    file_record, _chunks = create_knowledge_file_from_bytes(
        generation_db,
        sso_user_id="user-1",
        file_name="超长标题资料.md",
        content=f"{long_title}\n正文内容用于生成知识片段。".encode("utf-8"),
        content_type="text/markdown",
        cipher=_cipher(),
        key_version="v1",
    )
    generation_db.commit()

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
    assert stored_chunks
    assert all(len(chunk.section_title) <= 255 for chunk in stored_chunks)
    assert stored_chunks[0].section_title.startswith("一、投标人参加本项目")


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
    assert str(exc_info.value.detail) == "当前版本暂不支持该文件类型，请上传 pdf、docx、xlsx、pptx、txt、md、png、jpg、jpeg 或 webp 文件。"


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


def test_upload_personal_file_auto_summarizes_and_suggests_metadata(
    client_for_user,
    generation_db,
) -> None:
    from app.models import KnowledgeFile

    owner = client_for_user("user-1")

    response = owner.post(
        "/api/knowledge/files/upload",
        data={"usage_type": "personal_reference"},
        files={
            "file": (
                "客户会议纪要.md",
                "一、会议纪要\n客户确认培训安排、验收材料和下一步计划。".encode("utf-8"),
                "text/markdown",
            )
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["summary"].startswith("一、会议纪要")
    assert body["category"] == "会议纪要"
    assert body["document_type"] == "会议纪要"
    assert "会议纪要" in body["tags"]
    assert "个人资料" in body["tags"]
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
