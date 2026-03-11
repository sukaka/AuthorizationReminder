import { describe, expect, it } from 'vitest';
import PizZip from 'pizzip';

import wordLayout from '../src/word-layout.js';

const {
  buildWordLayoutPlan,
  ensureDocxHeaderFooterBuffer,
  ensureDocxLogicalParagraphsBuffer,
  ensureDocxNativeTocBuffer,
  ensureDocxPageBreakBeforeHeadingsBuffer,
  ensureDocxSectionPageNumberBuffer,
} = wordLayout;

const buildMinimalDocxBuffer = (
  bodyXml = '<w:p><w:r><w:t>测试正文</w:t></w:r></w:p>'
) => {
  const zip = new PizZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );
  zip.folder('_rels').file(
    '.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  zip.folder('word').file(
    'document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${bodyXml}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`
  );
  zip.folder('word').folder('_rels').file(
    'document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
  );
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
};

describe('word layout helpers', () => {
  it('reorders chapters and builds toc, numbering, appendix index, and header/footer text', () => {
    const layout = buildWordLayoutPlan({
      bidNo: 'BID-20260309-0001',
      projectName: '政务云平台项目',
      projectTitle: '政务云平台项目投标文件',
      generatedAt: '2026-03-09 02:10:00',
      chapters: [
        { title: '附件资料', content: ['附件 A'] },
        { title: '封面', content: ['投标文件'] },
        { title: '技术方案', content: ['技术内容'] },
        { title: '商务响应', content: ['商务内容'] },
      ],
    });

    expect(layout.chapters.map((item) => item.title)).toEqual([
      '封面',
      '目录',
      '第一章 技术方案',
      '第二章 商务响应',
      '附录一 附件资料',
    ]);
    expect(layout.toc_lines).toEqual([
      '第一章 技术方案',
      '第二章 商务响应',
      '附录一 附件资料',
    ]);
    expect(layout.appendix_index_lines).toEqual([
      '1. 附录一 附件资料',
    ]);
    expect(layout.page_break_titles).toEqual([
      '目录',
      '第一章 技术方案',
      '第二章 商务响应',
      '附录一 附件资料',
    ]);
    expect(layout.header_text).toContain('政务云平台项目');
    expect(layout.footer_text).toContain('BID-20260309-0001');
    expect(layout.footer_text).toContain('2026-03-09 02:10:00');
  });

  it('injects default header and footer parts into docx buffers when missing', () => {
    const buffer = ensureDocxHeaderFooterBuffer(buildMinimalDocxBuffer(), {
      headerText: '政务云平台项目投标文件',
      footerText: '标书编号：BID-20260309-0001',
    });

    const zip = new PizZip(buffer);
    const documentXml = zip.file('word/document.xml')?.asText() || '';
    const relsXml = zip.file('word/_rels/document.xml.rels')?.asText() || '';
    const headerXml = zip.file('word/header1.xml')?.asText() || '';
    const footerXml = zip.file('word/footer1.xml')?.asText() || '';
    const contentTypesXml = zip.file('[Content_Types].xml')?.asText() || '';

    expect(documentXml).toContain('w:headerReference');
    expect(documentXml).toContain('w:footerReference');
    expect(relsXml).toContain('header1.xml');
    expect(relsXml).toContain('footer1.xml');
    expect(headerXml).toContain('政务云平台项目投标文件');
    expect(footerXml).toContain('标书编号：BID-20260309-0001');
    expect(footerXml).toContain('PAGE');
    expect(contentTypesXml).toContain('/word/header1.xml');
    expect(contentTypesXml).toContain('/word/footer1.xml');
  });

  it('injects mirrored odd/even header/footer parts and enables even-and-odd headers', () => {
    const buffer = ensureDocxHeaderFooterBuffer(buildMinimalDocxBuffer(), {
      headerText: '政务云平台项目投标文件',
      footerText: '标书编号：BID-20260309-0001',
    });

    const zip = new PizZip(buffer);
    const documentXml = zip.file('word/document.xml')?.asText() || '';
    const relsXml = zip.file('word/_rels/document.xml.rels')?.asText() || '';
    const settingsXml = zip.file('word/settings.xml')?.asText() || '';
    const headerOddXml = zip.file('word/header1.xml')?.asText() || '';
    const headerEvenXml = zip.file('word/header2.xml')?.asText() || '';
    const footerOddXml = zip.file('word/footer1.xml')?.asText() || '';
    const footerEvenXml = zip.file('word/footer2.xml')?.asText() || '';

    expect(settingsXml).toContain('w:evenAndOddHeaders');
    expect(documentXml).toContain('<w:headerReference w:type="default"');
    expect(documentXml).toContain('<w:headerReference w:type="even"');
    expect(documentXml).toContain('<w:footerReference w:type="default"');
    expect(documentXml).toContain('<w:footerReference w:type="even"');
    expect(relsXml).toContain('header2.xml');
    expect(relsXml).toContain('footer2.xml');
    expect(headerEvenXml).toContain('政务云平台项目投标文件');
    expect(headerOddXml).not.toEqual(headerEvenXml);
    expect(footerOddXml).toContain('PAGE');
    expect(footerEvenXml).toContain('PAGE');
    expect(footerOddXml).not.toEqual(footerEvenXml);
  });

  it('injects native toc field and updateFields settings into docx buffers', () => {
    const marker = '__AUTO_TOC_FIELD__';
    const buffer = ensureDocxNativeTocBuffer(
      buildMinimalDocxBuffer(
        [
          '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>目录</w:t></w:r></w:p>',
          `<w:p><w:r><w:t>${marker}</w:t></w:r></w:p>`,
          '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>第一章 技术方案</w:t></w:r></w:p>',
        ].join('')
      ),
      { marker }
    );

    const zip = new PizZip(buffer);
    const documentXml = zip.file('word/document.xml')?.asText() || '';
    const settingsXml = zip.file('word/settings.xml')?.asText() || '';
    const relsXml = zip.file('word/_rels/document.xml.rels')?.asText() || '';
    const contentTypesXml = zip.file('[Content_Types].xml')?.asText() || '';

    expect(documentXml).toContain('TOC \\o &quot;1-3&quot; \\h \\z \\u');
    expect(documentXml).not.toContain(marker);
    expect(settingsXml).toContain('w:updateFields');
    expect(relsXml).toContain('settings.xml');
    expect(contentTypesXml).toContain('/word/settings.xml');
  });

  it('does not duplicate native toc field or update settings on repeated injection', () => {
    const marker = '__AUTO_TOC_FIELD__';
    const once = ensureDocxNativeTocBuffer(
      buildMinimalDocxBuffer(`<w:p><w:r><w:t>${marker}</w:t></w:r></w:p>`),
      { marker }
    );
    const twice = ensureDocxNativeTocBuffer(once, { marker });
    const zip = new PizZip(twice);
    const documentXml = zip.file('word/document.xml')?.asText() || '';
    const settingsXml = zip.file('word/settings.xml')?.asText() || '';

    expect(documentXml.match(/TOC \\o &quot;1-3&quot; \\h \\z \\u/g)).toHaveLength(1);
    expect(settingsXml.match(/w:updateFields/g)).toHaveLength(1);
  });

  it('replaces static toc paragraphs after toc heading when toc lines are provided', () => {
    const buffer = ensureDocxNativeTocBuffer(
      buildMinimalDocxBuffer(
        [
          '<w:p><w:r><w:t>目录</w:t></w:r></w:p>',
          '<w:p><w:r><w:t>条目一</w:t></w:r></w:p>',
          '<w:p><w:r><w:t>条目二</w:t></w:r></w:p>',
          '<w:p><w:r><w:t>正文开始</w:t></w:r></w:p>',
        ].join('')
      ),
      { tocLines: ['条目一', '条目二'] }
    );
    const zip = new PizZip(buffer);
    const documentXml = zip.file('word/document.xml')?.asText() || '';

    expect(documentXml).toContain('TOC \\o &quot;1-3&quot; \\h \\z \\u');
    expect(documentXml).not.toContain('<w:t>条目一</w:t>');
    expect(documentXml).not.toContain('<w:t>条目二</w:t>');
    expect(documentXml).toContain('<w:t>正文开始</w:t>');
  });

  it('injects page breaks before specified chapter headings', () => {
    const buffer = ensureDocxPageBreakBeforeHeadingsBuffer(
      buildMinimalDocxBuffer(
        [
          '<w:p><w:r><w:t>封面</w:t></w:r></w:p>',
          '<w:p><w:r><w:t>目录</w:t></w:r></w:p>',
          '<w:p><w:r><w:t>第一章 技术方案</w:t></w:r></w:p>',
          '<w:p><w:r><w:t>第二章 商务响应</w:t></w:r></w:p>',
        ].join('')
      ),
      { headings: ['目录', '第一章 技术方案', '第二章 商务响应'] }
    );
    const zip = new PizZip(buffer);
    const documentXml = zip.file('word/document.xml')?.asText() || '';

    expect(documentXml.match(/w:br w:type="page"/g)).toHaveLength(3);
    expect(documentXml).toContain('<w:t>封面</w:t></w:r></w:p><w:p><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:r><w:t>目录</w:t>');
    expect(documentXml).toContain('<w:t>目录</w:t></w:r></w:p><w:p><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:r><w:t>第一章 技术方案</w:t>');
  });

  it('does not duplicate page breaks on repeated pagination injection', () => {
    const once = ensureDocxPageBreakBeforeHeadingsBuffer(
      buildMinimalDocxBuffer(
        [
          '<w:p><w:r><w:t>封面</w:t></w:r></w:p>',
          '<w:p><w:r><w:t>目录</w:t></w:r></w:p>',
        ].join('')
      ),
      { headings: ['目录'] }
    );
    const twice = ensureDocxPageBreakBeforeHeadingsBuffer(once, { headings: ['目录'] });
    const zip = new PizZip(twice);
    const documentXml = zip.file('word/document.xml')?.asText() || '';

    expect(documentXml.match(/w:br w:type="page"/g)).toHaveLength(1);
  });

  it('splits body-placeholder linebreak paragraphs into logical paragraphs and promotes chapter headings', () => {
    const buffer = ensureDocxLogicalParagraphsBuffer(buildMinimalDocxBuffer(
      [
        '<w:p><w:r><w:t xml:space="preserve">第一章 技术方案</w:t></w:r><w:r><w:br/></w:r><w:r><w:t xml:space="preserve">技术内容</w:t></w:r><w:r><w:br/></w:r><w:r><w:t/></w:r><w:r><w:br/></w:r><w:r><w:t xml:space="preserve">第二章 商务响应</w:t></w:r><w:r><w:br/></w:r><w:r><w:t xml:space="preserve">商务内容</w:t></w:r></w:p>',
      ].join('')
    ), {
      splitHints: ['第一章 技术方案', '第二章 商务响应'],
      headingLines: ['第一章 技术方案', '第二章 商务响应'],
    });
    const zip = new PizZip(buffer);
    const documentXml = zip.file('word/document.xml')?.asText() || '';

    expect(documentXml.match(/<w:pStyle w:val="Heading1"\/>/g)).toHaveLength(2);
    expect(documentXml).toContain('<w:t xml:space="preserve">技术内容</w:t></w:r></w:p><w:p/>');
    expect(documentXml).toContain('<w:t xml:space="preserve">商务内容</w:t>');
    expect(documentXml).not.toContain('<w:t xml:space="preserve">第一章 技术方案</w:t></w:r><w:r><w:br/>');
  });

  it('splits body-placeholder paragraphs when logical lines look like chapter headings even if split hints miss them', () => {
    const buffer = ensureDocxLogicalParagraphsBuffer(buildMinimalDocxBuffer(
      [
        '<w:p><w:r><w:t xml:space="preserve">第十章 服务承诺</w:t></w:r><w:r><w:br/></w:r><w:r><w:t xml:space="preserve">承诺内容</w:t></w:r><w:r><w:br/></w:r><w:r><w:t/></w:r><w:r><w:br/></w:r><w:r><w:t xml:space="preserve">附录一 资质证明</w:t></w:r><w:r><w:br/></w:r><w:r><w:t xml:space="preserve">附件内容</w:t></w:r></w:p>',
      ].join('')
    ), {
      splitHints: ['第一章 技术方案'],
      headingLines: ['第一章 技术方案'],
    });
    const zip = new PizZip(buffer);
    const documentXml = zip.file('word/document.xml')?.asText() || '';

    expect(documentXml.match(/<w:pStyle w:val="Heading1"\/>/g)).toHaveLength(2);
    expect(documentXml).toContain('<w:t xml:space="preserve">第十章 服务承诺</w:t>');
    expect(documentXml).toContain('<w:t xml:space="preserve">附录一 资质证明</w:t>');
    expect(documentXml).not.toContain('<w:t xml:space="preserve">第十章 服务承诺</w:t></w:r><w:r><w:br/>');
  });

  it('preserves table wrappers when splitting logical paragraphs inside table cells', () => {
    const buffer = ensureDocxLogicalParagraphsBuffer(buildMinimalDocxBuffer(
      [
        '<w:tbl><w:tr><w:tc><w:p><w:r><w:t xml:space="preserve">第一章 技术方案</w:t></w:r><w:r><w:br/></w:r><w:r><w:t xml:space="preserve">技术内容</w:t></w:r><w:r><w:br/></w:r><w:r><w:t xml:space="preserve">第二章 商务响应</w:t></w:r><w:r><w:br/></w:r><w:r><w:t xml:space="preserve">商务内容</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
      ].join('')
    ), {
      splitHints: ['第一章 技术方案', '第二章 商务响应'],
      headingLines: ['第一章 技术方案', '第二章 商务响应'],
    });
    const zip = new PizZip(buffer);
    const documentXml = zip.file('word/document.xml')?.asText() || '';

    expect(documentXml).toContain('<w:tbl>');
    expect(documentXml).toContain('<w:tc>');
    expect(documentXml).toContain('</w:tc></w:tr></w:tbl>');
    expect(documentXml.match(/<w:pStyle w:val="Heading1"\/>/g)).toHaveLength(2);
    expect(documentXml).not.toContain('</w:tbl><w:p><w:pPr><w:pStyle w:val="Heading1"/>');
  });

  it('preserves textbox wrappers when splitting logical paragraphs inside w:txbxContent', () => {
    const buffer = ensureDocxLogicalParagraphsBuffer(buildMinimalDocxBuffer(
      [
        '<w:p><w:r><w:t>封面说明</w:t></w:r></w:p>',
        '<w:p><w:r><w:drawing/><w:txbxContent><w:p><w:r><w:t xml:space="preserve">第一章 技术方案</w:t></w:r><w:r><w:br/></w:r><w:r><w:t xml:space="preserve">技术内容</w:t></w:r><w:r><w:br/></w:r><w:r><w:t xml:space="preserve">第二章 商务响应</w:t></w:r><w:r><w:br/></w:r><w:r><w:t xml:space="preserve">商务内容</w:t></w:r></w:p></w:txbxContent></w:r></w:p>',
      ].join('')
    ), {
      splitHints: ['第一章 技术方案', '第二章 商务响应'],
      headingLines: ['第一章 技术方案', '第二章 商务响应'],
    });
    const zip = new PizZip(buffer);
    const documentXml = zip.file('word/document.xml')?.asText() || '';

    expect(documentXml).toContain('<w:txbxContent>');
    expect(documentXml).toContain('</w:txbxContent>');
    expect(documentXml.match(/<w:pStyle w:val="Heading1"\/>/g)).toHaveLength(2);
    expect(documentXml).toContain('<w:t xml:space="preserve">技术内容</w:t>');
    expect(documentXml).not.toContain('<w:txbxContent><w:p><w:r><w:t xml:space="preserve">第一章 技术方案</w:t></w:r><w:r><w:br/>');
  });

  it('splits body-placeholder paragraphs for common nonstandard heading styles', () => {
    const buffer = ensureDocxLogicalParagraphsBuffer(buildMinimalDocxBuffer(
      [
        '<w:p><w:r><w:t xml:space="preserve">一、项目概况</w:t></w:r><w:r><w:br/></w:r><w:r><w:t xml:space="preserve">概况内容</w:t></w:r><w:r><w:br/></w:r><w:r><w:t xml:space="preserve">（一）服务方案</w:t></w:r><w:r><w:br/></w:r><w:r><w:t xml:space="preserve">方案内容</w:t></w:r><w:r><w:br/></w:r><w:r><w:t xml:space="preserve">1.1 实施计划</w:t></w:r><w:r><w:br/></w:r><w:r><w:t xml:space="preserve">计划内容</w:t></w:r></w:p>',
      ].join('')
    ), {
      splitHints: ['第一章 技术方案'],
      headingLines: ['第一章 技术方案'],
    });
    const zip = new PizZip(buffer);
    const documentXml = zip.file('word/document.xml')?.asText() || '';

    expect(documentXml.match(/<w:pStyle w:val="Heading1"\/>/g)).toHaveLength(3);
    expect(documentXml).toContain('<w:t xml:space="preserve">一、项目概况</w:t>');
    expect(documentXml).toContain('<w:t xml:space="preserve">（一）服务方案</w:t>');
    expect(documentXml).toContain('<w:t xml:space="preserve">1.1 实施计划</w:t>');
    expect(documentXml).not.toContain('<w:t xml:space="preserve">一、项目概况</w:t></w:r><w:r><w:br/>');
  });

  it('treats native toc field as toc boundary for pagination and section numbering', () => {
    const withFooter = ensureDocxHeaderFooterBuffer(buildMinimalDocxBuffer(
      [
        '<w:p><w:r><w:t>封面</w:t></w:r></w:p>',
        '<w:p><w:r><w:t>投标文件</w:t></w:r></w:p>',
        '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve">TOC \\o &quot;1-3&quot; \\h \\z \\u</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>右键更新目录</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
        '<w:p><w:r><w:t>第一章 技术方案</w:t></w:r></w:p>',
      ].join('')
    ), {
      headerText: '项目投标文件',
      footerText: '标书编号：BID-20260309-0001',
    });
    const withBreaks = ensureDocxPageBreakBeforeHeadingsBuffer(withFooter, {
      headings: ['目录', '第一章 技术方案'],
    });
    const buffer = ensureDocxSectionPageNumberBuffer(withBreaks, {
      coverHeading: '封面',
      restartHeading: '目录',
      bodyStartHeading: '第一章 技术方案',
      startPageNumber: 1,
    });
    const zip = new PizZip(buffer);
    const documentXml = zip.file('word/document.xml')?.asText() || '';

    expect(documentXml).toContain('<w:t>投标文件</w:t></w:r></w:p><w:p><w:pPr><w:sectPr');
    expect(documentXml).toContain('TOC \\o &quot;1-3&quot; \\h \\z \\u');
    expect(documentXml.match(/<w:sectPr/g)).toHaveLength(3);
    expect(documentXml).toContain('<w:titlePg/>');
    expect(documentXml).toContain('<w:pgNumType w:start="1" w:fmt="lowerRoman"/>');
  });

  it('adds section page numbering so cover hides number and toc/body restart from page 1', () => {
    const withFooter = ensureDocxHeaderFooterBuffer(buildMinimalDocxBuffer(
      [
        '<w:p><w:r><w:t>封面</w:t></w:r></w:p>',
        '<w:p><w:r><w:t>封面说明</w:t></w:r></w:p>',
        '<w:p><w:r><w:t>目录</w:t></w:r></w:p>',
        '<w:p><w:r><w:t>目录说明</w:t></w:r></w:p>',
        '<w:p><w:r><w:t>第一章 技术方案</w:t></w:r></w:p>',
      ].join('')
    ), {
      headerText: '项目投标文件',
      footerText: '标书编号：BID-20260309-0001',
    });
    const withBreaks = ensureDocxPageBreakBeforeHeadingsBuffer(withFooter, {
      headings: ['目录', '第一章 技术方案'],
    });
    const buffer = ensureDocxSectionPageNumberBuffer(withBreaks, {
      coverHeading: '封面',
      restartHeading: '目录',
      bodyStartHeading: '第一章 技术方案',
      startPageNumber: 1,
    });
    const zip = new PizZip(buffer);
    const documentXml = zip.file('word/document.xml')?.asText() || '';
    const footerXml = zip.file('word/footer1.xml')?.asText() || '';

    expect(footerXml).toContain('PAGE');
    expect(documentXml.match(/<w:sectPr/g)).toHaveLength(3);
    expect(documentXml).toContain('<w:titlePg/>');
    expect(documentXml).toContain('<w:pgNumType w:start="1" w:fmt="lowerRoman"/>');
    expect(documentXml).toContain('<w:pgNumType w:start="1"/>');
    expect(documentXml).not.toContain('<w:t>封面说明</w:t></w:r></w:p><w:p><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:r><w:t>目录</w:t>');
    expect(documentXml).not.toContain('<w:t>目录说明</w:t></w:r></w:p><w:p><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:r><w:t>第一章 技术方案</w:t>');
  });

  it('does not duplicate section page numbering rules on repeated injection', () => {
    const withFooter = ensureDocxHeaderFooterBuffer(buildMinimalDocxBuffer(
      [
        '<w:p><w:r><w:t>封面</w:t></w:r></w:p>',
        '<w:p><w:r><w:t>封面说明</w:t></w:r></w:p>',
        '<w:p><w:r><w:t>目录</w:t></w:r></w:p>',
        '<w:p><w:r><w:t>目录说明</w:t></w:r></w:p>',
        '<w:p><w:r><w:t>第一章 技术方案</w:t></w:r></w:p>',
      ].join('')
    ), {
      headerText: '项目投标文件',
      footerText: '标书编号：BID-20260309-0001',
    });
    const withBreaks = ensureDocxPageBreakBeforeHeadingsBuffer(withFooter, {
      headings: ['目录', '第一章 技术方案'],
    });
    const once = ensureDocxSectionPageNumberBuffer(withBreaks, {
      coverHeading: '封面',
      restartHeading: '目录',
      bodyStartHeading: '第一章 技术方案',
      startPageNumber: 1,
    });
    const twice = ensureDocxSectionPageNumberBuffer(once, {
      coverHeading: '封面',
      restartHeading: '目录',
      bodyStartHeading: '第一章 技术方案',
      startPageNumber: 1,
    });
    const zip = new PizZip(twice);
    const documentXml = zip.file('word/document.xml')?.asText() || '';

    expect(documentXml.match(/<w:sectPr/g)).toHaveLength(3);
    expect(documentXml.match(/<w:titlePg\/>/g)).toHaveLength(1);
    expect(documentXml.match(/<w:pgNumType w:start="1" w:fmt="lowerRoman"\/>/g)).toHaveLength(1);
    expect(documentXml.match(/<w:pgNumType w:start="1"\/>/g)).toHaveLength(1);
  });
});
