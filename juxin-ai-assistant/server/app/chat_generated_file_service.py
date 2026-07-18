"""Render chat answers into the formats exposed by the chat attachment card."""

from __future__ import annotations

import re
import zipfile
from io import BytesIO
from xml.sax.saxutils import escape


def render_chat_document_bytes(*, title: str, answer: str, fmt: str) -> bytes:
    normalized = fmt.lower().lstrip(".")
    if normalized == "md":
        return (answer or "").encode("utf-8")
    if normalized == "docx":
        from .word_export import render_chat_answer_docx

        return render_chat_answer_docx(title=title or "聊天生成文档", output=answer or "", version="v1")
    if normalized == "xlsx":
        return _render_xlsx(title=title, answer=answer)
    if normalized == "pptx":
        return _render_pptx(title=title, answer=answer)
    raise ValueError(f"unsupported_chat_document_format:{fmt}")


def _render_xlsx(*, title: str, answer: str) -> bytes:
    from openpyxl import Workbook

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "成果"
    sheet.append(["标题", title or "聊天生成文档"])
    sheet.append([])
    heading = "正文"
    sheet.append(["章节/段落", "内容"])
    for raw in (answer or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        match = re.match(r"^#{1,6}\s+(.+)$", line)
        if match:
            heading = match.group(1).strip()
            sheet.append([heading, ""])
            continue
        bullet = re.sub(r"^[-*+]\s+", "", line)
        sheet.append([heading, bullet])
    sheet.column_dimensions["A"].width = 28
    sheet.column_dimensions["B"].width = 100
    buffer = BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def _render_pptx(*, title: str, answer: str) -> bytes:
    slides = _slides(title, answer)
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", _content_types(len(slides)))
        archive.writestr("_rels/.rels", _root_rels())
        archive.writestr("ppt/presentation.xml", _presentation(len(slides)))
        archive.writestr("ppt/_rels/presentation.xml.rels", _presentation_rels(len(slides)))
        archive.writestr("ppt/slideMasters/slideMaster1.xml", _slide_master())
        archive.writestr("ppt/slideMasters/_rels/slideMaster1.xml.rels", _master_rels())
        archive.writestr("ppt/slideLayouts/slideLayout1.xml", _slide_layout())
        archive.writestr("ppt/slideLayouts/_rels/slideLayout1.xml.rels", _layout_rels())
        archive.writestr("ppt/theme/theme1.xml", _theme())
        for index, slide in enumerate(slides, 1):
            archive.writestr(f"ppt/slides/slide{index}.xml", _slide(slide))
            archive.writestr(f"ppt/slides/_rels/slide{index}.xml.rels", _slide_rels())
    return buffer.getvalue()


def _slides(title: str, answer: str) -> list[tuple[str, list[str]]]:
    result: list[tuple[str, list[str]]] = []
    current_title = title or "成果"
    bullets: list[str] = []
    for raw in (answer or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        heading = re.match(r"^#{1,3}\s+(.+)$", line)
        if heading:
            if bullets or not result:
                result.append((current_title, bullets[:12]))
            current_title, bullets = heading.group(1).strip(), []
            continue
        if line.startswith("|"):
            continue
        bullets.append(re.sub(r"^[-*+]\s+", "", line)[:300])
    if bullets or not result:
        result.append((current_title, bullets[:12] or ["（空）"]))
    return result[:20]


def _content_types(count: int) -> str:
    slides = "".join(
        f'<Override PartName="/ppt/slides/slide{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
        for i in range(1, count + 1)
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
        '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>'
        '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>'
        '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
        + slides
        + "</Types>"
    )


def _root_rels() -> str:
    return '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>'


def _presentation(count: int) -> str:
    ids = "".join(f'<p:sldId id="{255 + i}" r:id="rId{i + 1}"/>' for i in range(count))
    return f'''<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdMaster"/></p:sldMasterIdLst><p:sldIdLst>{ids}</p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>'''


def _presentation_rels(count: int) -> str:
    rels = ['<Relationship Id="rIdMaster" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>']
    rels.extend(f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide{i}.xml"/>' for i in range(1, count + 1))
    return '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + "".join(rels) + "</Relationships>"


def _slide_master() -> str:
    return '<?xml version="1.0" encoding="UTF-8"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles/></p:sldMaster>'


def _slide_layout() -> str:
    return '<?xml version="1.0" encoding="UTF-8"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="obj"><p:cSld name="空白"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>'


def _master_rels() -> str:
    return '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>'


def _layout_rels() -> str:
    return '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>'


def _slide_rels() -> str:
    return '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>'


def _slide(slide: tuple[str, list[str]]) -> str:
    title, bullets = slide
    title_xml = escape(title)
    body = "".join(f'<a:p><a:pPr marL="342900" indent="-342900"><a:buChar char="•"/></a:pPr><a:r><a:rPr lang="zh-CN" sz="1800"/><a:t>{escape(item)}</a:t></a:r></a:p>' for item in bullets)
    return f'''<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="标题"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="274320"/><a:ext cx="8229600" cy="1143000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" sz="2800" b="1"/><a:t>{title_xml}</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="内容"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="1600200"/><a:ext cx="8229600" cy="4572000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>{body}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>'''


def _theme() -> str:
    return '<?xml version="1.0" encoding="UTF-8"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="聚信得仁"><a:themeElements><a:clrScheme name="默认"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:accent1><a:srgbClr val="1677FF"/></a:accent1></a:clrScheme><a:fontScheme name="默认"><a:majorFont/><a:minorFont/></a:fontScheme><a:fmtScheme name="默认"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme></a:themeElements></a:theme>'
