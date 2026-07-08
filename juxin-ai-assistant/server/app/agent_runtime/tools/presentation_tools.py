from __future__ import annotations

from dataclasses import dataclass
from html import escape
from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

from ..tool_base import BaseTool, ToolContext, ToolResult


@dataclass(frozen=True)
class SlideSpec:
    title: str
    bullets: list[str]


def _normalize_slides(tool_input: dict) -> list[SlideSpec]:
    raw_slides = tool_input.get("slides") or []
    slides: list[SlideSpec] = []
    for raw in raw_slides[:30]:
        if not isinstance(raw, dict):
            continue
        title = str(raw.get("title") or "未命名页面").strip()[:80]
        bullets = [
            str(item).strip()[:160]
            for item in (raw.get("bullets") or [])
            if str(item).strip()
        ][:8]
        slides.append(SlideSpec(title=title or "未命名页面", bullets=bullets))
    if slides:
        return slides
    title = str(tool_input.get("title") or "聚信得仁演示文稿").strip()[:80]
    outline = str(tool_input.get("outline") or "").strip()
    bullets = [line.strip("-• 　") for line in outline.splitlines() if line.strip()]
    return [SlideSpec(title=title or "聚信得仁演示文稿", bullets=bullets[:8])]


def _slide_xml(slide: SlideSpec) -> str:
    bullet_xml = "\n".join(
        f"""
        <a:p>
          <a:pPr marL="457200" indent="-228600"/>
          <a:r><a:t>{escape(bullet)}</a:t></a:r>
        </a:p>"""
        for bullet in slide.bullets
    )
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="Title"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="685800" y="457200"/><a:ext cx="7772400" cy="914400"/></a:xfrm>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/><a:lstStyle/>
          <a:p>
            <a:pPr algn="l"/>
            <a:r><a:rPr lang="zh-CN" sz="3600" b="1"/><a:t>{escape(slide.title)}</a:t></a:r>
          </a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="3" name="Content"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="914400" y="1600200"/><a:ext cx="7315200" cy="4267200"/></a:xfrm>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/><a:lstStyle/>
          {bullet_xml or '<a:p><a:r><a:t>待补充</a:t></a:r></a:p>'}
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>"""


def _presentation_xml(slide_count: int) -> str:
    slide_ids = "\n".join(
        f'<p:sldId id="{255 + index}" r:id="rId{index}"/>'
        for index in range(1, slide_count + 1)
    )
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldSz cx="9144000" cy="5143500" type="screen16x9"/>
  <p:notesSz cx="6858000" cy="9144000"/>
  <p:sldIdLst>{slide_ids}</p:sldIdLst>
</p:presentation>"""


def _presentation_rels(slide_count: int) -> str:
    rels = "\n".join(
        f'<Relationship Id="rId{index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide{index}.xml"/>'
        for index in range(1, slide_count + 1)
    )
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  {rels}
</Relationships>"""


def _content_types(slide_count: int) -> str:
    overrides = "\n".join(
        f'<Override PartName="/ppt/slides/slide{index}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
        for index in range(1, slide_count + 1)
    )
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  {overrides}
</Types>"""


def render_pptx(slides: list[SlideSpec], *, title: str) -> bytes:
    buffer = BytesIO()
    with ZipFile(buffer, "w", ZIP_DEFLATED) as archive:
        archive.writestr(
            "_rels/.rels",
            """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>""",
        )
        archive.writestr("[Content_Types].xml", _content_types(len(slides)))
        archive.writestr("ppt/presentation.xml", _presentation_xml(len(slides)))
        archive.writestr("ppt/_rels/presentation.xml.rels", _presentation_rels(len(slides)))
        archive.writestr(
            "docProps/core.xml",
            f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
                   xmlns:dc="http://purl.org/dc/elements/1.1/"
                   xmlns:dcterms="http://purl.org/dc/terms/"
                   xmlns:dcmitype="http://purl.org/dc/dcmitype/"
                   xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>{escape(title)}</dc:title>
  <dc:creator>聚信 AI 助手</dc:creator>
</cp:coreProperties>""",
        )
        archive.writestr(
            "docProps/app.xml",
            f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
            xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>聚信 AI 助手</Application>
  <Slides>{len(slides)}</Slides>
</Properties>""",
        )
        for index, slide in enumerate(slides, start=1):
            archive.writestr(f"ppt/slides/slide{index}.xml", _slide_xml(slide))
    return buffer.getvalue()


class PptxExportTool(BaseTool):
    name = "pptx_export"
    description = "Generate a PowerPoint presentation from structured slide outline"
    version = "1"

    def run(self, tool_input: dict, context: ToolContext) -> ToolResult:
        file_manager = context.resources.get("file_manager")
        if file_manager is None:
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="TOOL_EXPORT_STORAGE_MISSING",
                error_message_safe="工具缺少导出文件管理组件",
            )
        title = str(tool_input.get("title") or "聚信得仁演示文稿").strip()[:80] or "聚信得仁演示文稿"
        slides = _normalize_slides(tool_input)
        document = render_pptx(slides, title=title)
        saved = file_manager.save_pptx(
            file_name=f"{title}.pptx",
            content=document,
        )
        payload = {
            "file_id": saved.file_id,
            "file_name": saved.file_name,
            "file_path": saved.file_path,
            "slide_count": len(slides),
        }
        return ToolResult(
            tool_name=self.name,
            payload=payload,
            output_summary={
                "file_name": saved.file_name,
                "slide_count": len(slides),
            },
            source_count=len(slides),
        )
