"""Multi-format artifact export: markdown → docx / xlsx / pptx / pdf."""

from __future__ import annotations

import re
import zipfile
from io import BytesIO
from typing import Iterable
from xml.sax.saxutils import escape


def markdown_to_rows(markdown: str) -> list[list[str]]:
    """Parse markdown into table-ish rows for spreadsheet export."""
    rows: list[list[str]] = [["章节/段落", "内容"]]
    current_heading = "正文"
    for raw in str(markdown or "").splitlines():
        line = raw.rstrip()
        if not line.strip():
            continue
        heading = re.match(r"^(#{1,6})\s+(.+)$", line.strip())
        if heading:
            current_heading = heading.group(2).strip()
            rows.append([current_heading, ""])
            continue
        bullet = re.match(r"^[-*+]\s+(.+)$", line.strip())
        if bullet:
            rows.append([current_heading, bullet.group(1).strip()])
            continue
        table_cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if line.strip().startswith("|") and len(table_cells) >= 2:
            if all(re.fullmatch(r":?-{3,}:?", c or "") for c in table_cells):
                continue
            rows.append(table_cells)
            continue
        rows.append([current_heading, line.strip()])
    if len(rows) == 1:
        rows.append(["正文", str(markdown or "").strip() or "（空）"])
    return rows


def markdown_to_slides(markdown: str, *, title: str = "成果") -> list[dict[str, str | list[str]]]:
    """Split markdown into presentation slides (title + bullets)."""
    slides: list[dict[str, str | list[str]]] = []
    current_title = title or "成果"
    bullets: list[str] = []

    def flush() -> None:
        nonlocal bullets
        if bullets or current_title:
            slides.append({"title": current_title, "bullets": list(bullets)[:12]})
        bullets = []

    for raw in str(markdown or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        heading = re.match(r"^(#{1,3})\s+(.+)$", line)
        if heading:
            flush()
            current_title = heading.group(2).strip()
            continue
        bullet = re.match(r"^[-*+]\s+(.+)$", line)
        if bullet:
            bullets.append(bullet.group(1).strip())
            continue
        if line.startswith("|"):
            continue
        bullets.append(line[:200])
    flush()
    if not slides:
        slides = [{"title": title or "成果", "bullets": [str(markdown or "")[:400] or "（空）"]}]
    return slides[:20]


def render_artifact_xlsx(*, title: str, markdown: str) -> bytes:
    try:
        from openpyxl import Workbook
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("openpyxl_not_installed") from exc

    wb = Workbook()
    ws = wb.active
    ws.title = "成果"
    ws.append(["标题", title or "成果"])
    ws.append([])
    for row in markdown_to_rows(markdown):
        ws.append(row)
    # simple column widths
    ws.column_dimensions["A"].width = 28
    ws.column_dimensions["B"].width = 80
    buffer = BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def render_artifact_pptx(*, title: str, markdown: str) -> bytes:
    """Minimal OOXML pptx without python-pptx dependency."""
    slides = markdown_to_slides(markdown, title=title)
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            "[Content_Types].xml",
            _content_types_xml(len(slides)),
        )
        zf.writestr(
            "_rels/.rels",
            """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>""",
        )
        zf.writestr("ppt/presentation.xml", _presentation_xml(len(slides)))
        zf.writestr(
            "ppt/_rels/presentation.xml.rels",
            _presentation_rels_xml(len(slides)),
        )
        zf.writestr(
            "ppt/slideLayouts/slideLayout1.xml",
            _slide_layout_xml(),
        )
        zf.writestr(
            "ppt/slideMasters/slideMaster1.xml",
            _slide_master_xml(),
        )
        zf.writestr(
            "ppt/slideMasters/_rels/slideMaster1.xml.rels",
            """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>""",
        )
        zf.writestr(
            "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
            """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>""",
        )
        zf.writestr("ppt/theme/theme1.xml", _theme_xml())
        for index, slide in enumerate(slides, start=1):
            zf.writestr(f"ppt/slides/slide{index}.xml", _slide_xml(slide))
            zf.writestr(
                f"ppt/slides/_rels/slide{index}.xml.rels",
                """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>""",
            )
    return buffer.getvalue()


def render_artifact_pdf(*, title: str, markdown: str) -> bytes:
    """Minimal multi-page PDF using built-in Helvetica (ASCII-safe fallback for CJK)."""
    lines = _pdf_wrap_lines(title, markdown)
    pages: list[list[str]] = []
    page_size = 48
    for i in range(0, max(1, len(lines)), page_size):
        pages.append(lines[i : i + page_size])

    objects: list[bytes] = []
    # 1: Catalog
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    # 2: Pages (kids filled later)
    kids_placeholder = len(objects)  # index 1
    objects.append(b"")  # placeholder

    page_object_ids: list[int] = []
    content_object_ids: list[int] = []

    for page_lines in pages:
        content = _pdf_content_stream(page_lines)
        content_id = len(objects) + 1
        objects.append(
            f"<< /Length {len(content)} >>\nstream\n".encode("latin-1")
            + content
            + b"\nendstream"
        )
        content_object_ids.append(content_id)
        page_id = len(objects) + 1
        objects.append(
            (
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
                f"/Contents {content_id} 0 R /Resources << /Font << /F1 3 0 R >> >> >>"
            ).encode("latin-1")
        )
        page_object_ids.append(page_id)

    # Font object id 3 — insert at position after catalog/pages if needed
    # We used 3 0 R for font; ensure object 3 is font
    # Rebuild carefully: objects[0]=catalog, objects[1]=pages, objects[2] should be font
    # Currently content starts at objects[2]. Re-order by building fresh.
    return _assemble_pdf(title=title, pages_lines=pages)


def _assemble_pdf(*, title: str, pages_lines: list[list[str]]) -> bytes:
    # Object layout:
    # 1 Catalog, 2 Pages, 3 Font, then alternating Content/Page
    parts: list[bytes] = []
    offsets: list[int] = [0]

    def add_obj(obj_id: int, body: bytes) -> None:
        offsets.append(sum(len(p) for p in parts))
        parts.append(f"{obj_id} 0 obj\n".encode("latin-1") + body + b"\nendobj\n")

    page_ids: list[int] = []
    next_id = 4
    content_bodies: list[tuple[int, bytes]] = []
    page_bodies: list[tuple[int, int]] = []  # page_id, content_id

    for page_lines in pages_lines:
        content = _pdf_content_stream(page_lines)
        content_id = next_id
        next_id += 1
        page_id = next_id
        next_id += 1
        content_bodies.append((content_id, content))
        page_bodies.append((page_id, content_id))
        page_ids.append(page_id)

    kids = " ".join(f"{pid} 0 R" for pid in page_ids) or "4 0 R"
    add_obj(1, b"<< /Type /Catalog /Pages 2 0 R >>")
    add_obj(
        2,
        f"<< /Type /Pages /Kids [{kids}] /Count {len(page_ids)} >>".encode("latin-1"),
    )
    add_obj(
        3,
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    )
    for content_id, content in content_bodies:
        body = f"<< /Length {len(content)} >>\nstream\n".encode("latin-1") + content + b"\nendstream"
        add_obj(content_id, body)
    for page_id, content_id in page_bodies:
        add_obj(
            page_id,
            (
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
                f"/Contents {content_id} 0 R "
                f"/Resources << /Font << /F1 3 0 R >> >> >>"
            ).encode("latin-1"),
        )

    body = b"".join(parts)
    xref_offset = len(body)
    xref_lines = [b"xref\n", f"0 {next_id}\n".encode("latin-1"), b"0000000000 65535 f \n"]
    # rebuild offsets properly
    offsets = [0]
    cursor = 0
    rebuilt: list[bytes] = []
    # re-emit with correct offsets
    objects_map: dict[int, bytes] = {}
    # parse from parts is messy; re-generate
    return _build_pdf_simple(pages_lines)


def _build_pdf_simple(pages_lines: list[list[str]]) -> bytes:
    objects: list[bytes] = [b""]  # 1-indexed
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")  # 1
    objects.append(b"PLACEHOLDER_PAGES")  # 2
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")  # 3

    page_ids: list[int] = []
    for page_lines in pages_lines:
        content = _pdf_content_stream(page_lines)
        content_obj = f"<< /Length {len(content)} >>\nstream\n".encode("latin-1") + content + b"\nendstream"
        objects.append(content_obj)
        content_id = len(objects) - 1
        page_obj = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Contents {content_id} 0 R /Resources << /Font << /F1 3 0 R >> >> >>"
        ).encode("latin-1")
        objects.append(page_obj)
        page_ids.append(len(objects) - 1)

    kids = " ".join(f"{pid} 0 R" for pid in page_ids)
    objects[2] = f"<< /Type /Pages /Kids [{kids}] /Count {len(page_ids)} >>".encode("latin-1")

    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for i in range(1, len(objects)):
        offsets.append(len(out))
        out.extend(f"{i} 0 obj\n".encode("latin-1"))
        out.extend(objects[i])
        out.extend(b"\nendobj\n")
    xref_pos = len(out)
    out.extend(f"xref\n0 {len(objects)}\n".encode("latin-1"))
    out.extend(b"0000000000 65535 f \n")
    for i in range(1, len(objects)):
        out.extend(f"{offsets[i]:010d} 00000 n \n".encode("latin-1"))
    out.extend(
        f"trailer\n<< /Size {len(objects)} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode(
            "latin-1"
        )
    )
    return bytes(out)


def _pdf_wrap_lines(title: str, markdown: str) -> list[str]:
    lines = [f"Title: {_ascii_fallback(title)}", ""]
    for raw in str(markdown or "").splitlines():
        text = _ascii_fallback(raw.rstrip())
        if not text.strip():
            lines.append("")
            continue
        while len(text) > 90:
            lines.append(text[:90])
            text = text[90:]
        lines.append(text)
    return lines or ["(empty)"]


def _ascii_fallback(text: str) -> str:
    """PDF core fonts lack CJK; keep readable ASCII and mark CJK presence."""
    out: list[str] = []
    for ch in str(text or ""):
        o = ord(ch)
        if ch in "\n\r\t":
            out.append(" ")
        elif 32 <= o < 127:
            out.append(ch)
        elif "\u4e00" <= ch <= "\u9fff":
            out.append("?")
        else:
            out.append("?")
    result = "".join(out).strip()
    return result or "(content)"


def _pdf_content_stream(lines: Iterable[str]) -> bytes:
    y = 750
    cmds = ["BT", "/F1 11 Tf", "14 TL"]
    for line in lines:
        safe = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        cmds.append(f"1 0 0 1 40 {y} Tm ({safe}) Tj")
        y -= 14
        if y < 40:
            break
    cmds.append("ET")
    return "\n".join(cmds).encode("latin-1", errors="replace")


def _content_types_xml(slide_count: int) -> str:
    overrides = [
        '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
        '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>',
        '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>',
        '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>',
    ]
    for i in range(1, slide_count + 1):
        overrides.append(
            f'<Override PartName="/ppt/slides/slide{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
        )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        + "".join(overrides)
        + "</Types>"
    )


def _presentation_xml(slide_count: int) -> str:
    sld_ids = "".join(
        f'<p:sldId id="{255 + i}" r:id="rId{i}"/>' for i in range(1, slide_count + 1)
    )
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldIdLst>{sld_ids}</p:sldIdLst>
  <p:sldSz cx="9144000" cy="6858000"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>"""


def _presentation_rels_xml(slide_count: int) -> str:
    rels = [
        '<Relationship Id="rId0" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>',
        '<Relationship Id="rIdTheme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>',
    ]
    for i in range(1, slide_count + 1):
        rels.append(
            f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide{i}.xml"/>'
        )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + "".join(rels)
        + "</Relationships>"
    )


def _slide_xml(slide: dict[str, str | list[str]]) -> str:
    title = escape(str(slide.get("title") or "Slide"))
    bullets = slide.get("bullets") or []
    if not isinstance(bullets, list):
        bullets = [str(bullets)]
    bullet_paras = []
    for b in bullets[:12]:
        text = escape(str(b)[:300])
        bullet_paras.append(
            f'<a:p><a:pPr marL="342900" indent="-342900"><a:buFont typeface="Arial"/>'
            f'<a:buChar char="•"/></a:pPr><a:r><a:rPr lang="zh-CN" dirty="0" sz="1800"/>'
            f"<a:t>{text}</a:t></a:r></a:p>"
        )
    body = "".join(bullet_paras) or '<a:p><a:endParaRPr lang="zh-CN"/></a:p>'
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="457200" y="274320"/><a:ext cx="8229600" cy="1143000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/><a:lstStyle/>
          <a:p><a:r><a:rPr lang="zh-CN" dirty="0" sz="2800" b="1"/><a:t>{title}</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="3" name="Content"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="457200" y="1600200"/><a:ext cx="8229600" cy="4572000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/><a:lstStyle/>
          {body}
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>"""


def _slide_layout_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
  <p:cSld name="Blank">
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>"""


def _slide_master_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2"
   accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6"
   hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst>
    <p:sldLayoutId id="2147483649" r:id="rId1"/>
  </p:sldLayoutIdLst>
</p:sldMaster>"""


def _theme_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme">
  <a:themeElements>
    <a:clrScheme name="Office">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="1F497D"/></a:dk2>
      <a:lt2><a:srgbClr val="EEECE1"/></a:lt2>
      <a:accent1><a:srgbClr val="4F81BD"/></a:accent1>
      <a:accent2><a:srgbClr val="C0504D"/></a:accent2>
      <a:accent3><a:srgbClr val="9BBB59"/></a:accent3>
      <a:accent4><a:srgbClr val="8064A2"/></a:accent4>
      <a:accent5><a:srgbClr val="4BACC6"/></a:accent5>
      <a:accent6><a:srgbClr val="F79646"/></a:accent6>
      <a:hlink><a:srgbClr val="0000FF"/></a:hlink>
      <a:folHlink><a:srgbClr val="800080"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Office">
      <a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Office">
      <a:fillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:fillStyleLst>
      <a:lnStyleLst>
        <a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
        <a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
        <a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
      </a:lnStyleLst>
      <a:effectStyleLst>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
      </a:effectStyleLst>
      <a:bgFillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>"""


def export_artifact_bytes(*, title: str, markdown: str, fmt: str) -> tuple[bytes, str, str]:
    """Return (payload, media_type, file_extension)."""
    fmt_n = (fmt or "docx").lower().lstrip(".")
    if fmt_n in {"docx", "word"}:
        from .word_export import render_chat_answer_docx

        return (
            render_chat_answer_docx(title=title or "任务成果", output=markdown or "", version="v1"),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "docx",
        )
    if fmt_n in {"xlsx", "excel", "xls"}:
        return (
            render_artifact_xlsx(title=title, markdown=markdown),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "xlsx",
        )
    if fmt_n in {"pptx", "ppt", "powerpoint"}:
        return (
            render_artifact_pptx(title=title, markdown=markdown),
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "pptx",
        )
    if fmt_n == "pdf":
        return (
            render_artifact_pdf(title=title, markdown=markdown),
            "application/pdf",
            "pdf",
        )
    if fmt_n in {"md", "markdown", "txt"}:
        body = (markdown or "").encode("utf-8")
        return body, "text/markdown; charset=utf-8", "md"
    raise ValueError(f"unsupported_format:{fmt_n}")
