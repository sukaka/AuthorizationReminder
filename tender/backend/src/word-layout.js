const PizZip = require('pizzip');

const trimText = (value) => (value === undefined || value === null ? '' : String(value).trim());

const toLines = (value) => {
  if (Array.isArray(value)) return value.map((item) => trimText(item)).filter(Boolean);
  return String(value || '')
    .split(/\r?\n/)
    .map((item) => trimText(item))
    .filter(Boolean);
};

const escapeXml = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const CHINESE_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

const toChineseNumber = (value) => {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num <= 0) return '';
  if (num < 10) return CHINESE_DIGITS[num];
  if (num < 20) return `十${num % 10 === 0 ? '' : CHINESE_DIGITS[num % 10]}`;
  if (num < 100) {
    const tens = Math.floor(num / 10);
    const ones = num % 10;
    return `${CHINESE_DIGITS[tens]}十${ones === 0 ? '' : CHINESE_DIGITS[ones]}`;
  }
  return String(num);
};

const stripChapterPrefix = (value) => trimText(value)
  .replace(/^第[\d一二三四五六七八九十百千]+章\s*/u, '')
  .replace(/^附录[\d一二三四五六七八九十百千]*\s*/u, '')
  .replace(/^附件[\d一二三四五六七八九十百千]+\s*/u, '')
  .trim();

const classifyWordChapterSlot = (title) => {
  const text = trimText(title);
  if (!text) return 'BODY';
  if (/^封面$|封面页/u.test(text)) return 'COVER';
  if (/^目录$|自动目录|章节目录/u.test(text)) return 'TOC';
  if (/附录|附件资料|附件清单|附件索引|投标文件格式|资格审查资料|资格证明|资格文件/u.test(text)) return 'APPENDIX';
  return 'BODY';
};

const buildHeaderText = ({ projectName = '', projectTitle = '' } = {}) => {
  const source = trimText(projectName) || trimText(projectTitle) || '投标文件';
  return /投标文件/u.test(source) ? source : `${source}投标文件`;
};

const buildFooterText = ({ bidNo = '', generatedAt = '' } = {}) => {
  const parts = [];
  if (trimText(bidNo)) parts.push(`标书编号：${trimText(bidNo)}`);
  if (trimText(generatedAt)) parts.push(`生成时间：${trimText(generatedAt)}`);
  return parts.join(' | ') || '自动生成投标文件';
};

const buildWordLayoutPlan = ({
  chapters = [],
  bidNo = '',
  projectName = '',
  projectTitle = '',
  generatedAt = '',
} = {}) => {
  const chapterRows = (Array.isArray(chapters) ? chapters : [])
    .map((item, index) => {
      const rawTitle = trimText(item?.title) || `章节${index + 1}`;
      return {
        title: rawTitle,
        content: toLines(item?.content || ''),
        slot: classifyWordChapterSlot(rawTitle),
      };
    });

  const coverChapters = chapterRows.filter((item) => item.slot === 'COVER')
    .map((item) => ({
      ...item,
      title: stripChapterPrefix(item.title) || '封面',
    }));
  const tocChapter = chapterRows.find((item) => item.slot === 'TOC');
  const bodyChapters = chapterRows.filter((item) => item.slot === 'BODY')
    .map((item, index) => ({
      ...item,
      title: `第${toChineseNumber(index + 1)}章 ${stripChapterPrefix(item.title) || `章节${index + 1}`}`,
    }));
  const appendixChapters = chapterRows.filter((item) => item.slot === 'APPENDIX')
    .map((item, index) => ({
      ...item,
      title: `附录${toChineseNumber(index + 1)} ${stripChapterPrefix(item.title) || `附件${index + 1}`}`,
    }));

  const tocLines = [...bodyChapters, ...appendixChapters].map((item) => item.title);
  const appendixIndexLines = appendixChapters.map((item, index) => `${index + 1}. ${item.title}`);
  const normalizedChapters = [
    ...coverChapters,
    {
      title: tocChapter ? (stripChapterPrefix(tocChapter.title) || '目录') : '目录',
      content: tocLines.length ? tocLines : ['暂无自动目录，请人工补充。'],
      slot: 'TOC',
    },
    ...bodyChapters,
    ...appendixChapters,
  ];

  return {
    chapters: normalizedChapters,
    toc_lines: tocLines,
    toc_content: tocLines.join('\n'),
    page_break_titles: normalizedChapters.slice(1).map((item) => item.title),
    appendix_index_lines: appendixIndexLines,
    appendix_index_content: appendixIndexLines.join('\n'),
    chapter_outline: normalizedChapters
      .filter((item) => item.slot !== 'COVER')
      .map((item) => item.title)
      .join('\n'),
    header_text: buildHeaderText({ projectName, projectTitle }),
    footer_text: buildFooterText({ bidNo, generatedAt }),
  };
};

const ensureXmlnsR = (documentXml) => {
  const source = String(documentXml || '');
  if (!source) return source;
  if (/xmlns:r=/u.test(source)) return source;
  return source.replace('<w:document ', '<w:document xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
};

const ensureRelationshipXml = (relsXml) => {
  const source = trimText(relsXml);
  if (source) return source;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
};

const ensureContentTypesXml = (value) => {
  const source = trimText(value);
  if (source) return source;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
};

const ensureRelationship = (relsXml, { id, type, target }) => {
  let source = ensureRelationshipXml(relsXml);
  if (source.includes(`Id="${id}"`) || source.includes(`Target="${target}"`)) return source;
  return source.replace(
    '</Relationships>',
    `  <Relationship Id="${id}" Type="${type}" Target="${target}"/>\n</Relationships>`
  );
};

const ensureContentTypeOverride = (contentTypesXml, { partName, contentType }) => {
  let source = ensureContentTypesXml(contentTypesXml);
  if (source.includes(`PartName="${partName}"`)) return source;
  return source.replace(
    '</Types>',
    `  <Override PartName="${partName}" ContentType="${contentType}"/>\n</Types>`
  );
};

const DOCX_NATIVE_TOC_MARKER = '__AUTO_TOC_FIELD__';
const DOCX_NATIVE_TOC_INSTRUCTION = 'TOC \\o "1-3" \\h \\z \\u';
const DOCX_PAGE_FIELD_INSTRUCTION = 'PAGE';

const buildDocxNativeTocFieldXml = () => `\
<w:p>\
<w:r><w:fldChar w:fldCharType="begin"/></w:r>\
<w:r><w:instrText xml:space="preserve">${escapeXml(DOCX_NATIVE_TOC_INSTRUCTION)}</w:instrText></w:r>\
<w:r><w:fldChar w:fldCharType="separate"/></w:r>\
<w:r><w:t>右键更新目录</w:t></w:r>\
<w:r><w:fldChar w:fldCharType="end"/></w:r>\
</w:p>`;

const buildDocxPageBreakXml = () => '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

const buildDocxPageFieldRunsXml = () => `\
<w:r><w:fldChar w:fldCharType="begin"/></w:r>\
<w:r><w:instrText xml:space="preserve"> ${DOCX_PAGE_FIELD_INSTRUCTION} </w:instrText></w:r>\
<w:r><w:fldChar w:fldCharType="separate"/></w:r>\
<w:r><w:t>1</w:t></w:r>\
<w:r><w:fldChar w:fldCharType="end"/></w:r>`;

const buildDocxParagraphXml = (text, options = {}) => {
  const raw = trimText(text);
  if (!raw) return '<w:p/>';
  const { headingLevel = 0 } = options;
  if (headingLevel === 1) {
    return `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(raw)}</w:t></w:r></w:p>`;
  }
  if (headingLevel === 2) {
    return `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(raw)}</w:t></w:r></w:p>`;
  }
  return `<w:p><w:r><w:t xml:space="preserve">${escapeXml(raw)}</w:t></w:r></w:p>`;
};

const buildSimpleHeaderFooterXml = (
  rootTag,
  text,
  { alignment = 'center', mirrorPageNumberOrder = false } = {}
) => {
  const normalizedText = trimText(text);
  const paragraphPropsXml = `<w:pPr><w:jc w:val="${escapeXml(alignment || 'center')}"/></w:pPr>`;
  const footerLeadingTextXml = normalizedText
    ? `<w:r><w:t xml:space="preserve">${escapeXml(normalizedText)}</w:t></w:r><w:r><w:t xml:space="preserve"> | 第 </w:t></w:r>`
    : '<w:r><w:t xml:space="preserve">第 </w:t></w:r>';
  const footerTrailingTextXml = normalizedText
    ? `<w:r><w:t xml:space="preserve"> 页 | ${escapeXml(normalizedText)}</w:t></w:r>`
    : '<w:r><w:t xml:space="preserve"> 页</w:t></w:r>';
  const bodyXml = rootTag === 'ftr'
    ? `<w:p>${paragraphPropsXml}${
      mirrorPageNumberOrder
        ? `${buildDocxPageFieldRunsXml()}${footerTrailingTextXml}`
        : `${footerLeadingTextXml}${buildDocxPageFieldRunsXml()}<w:r><w:t xml:space="preserve"> 页</w:t></w:r>`
    }</w:p>`
    : `<w:p>${paragraphPropsXml}<w:r><w:t xml:space="preserve">${escapeXml(normalizedText)}</w:t></w:r></w:p>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:${rootTag} xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  ${bodyXml}
</w:${rootTag}>`;
};

const ensureSettingsXml = (value) => {
  const source = trimText(value);
  if (source) return source;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:settings>`;
};

const ensureSettingsUpdateFieldsXml = (settingsXml) => {
  let source = ensureSettingsXml(settingsXml);
  if (source.includes('<w:updateFields')) return source;
  return source.replace(
    '</w:settings>',
    '<w:updateFields w:val="true"/></w:settings>'
  );
};

const ensureSettingsEvenAndOddHeadersXml = (settingsXml) => {
  let source = ensureSettingsXml(settingsXml);
  if (source.includes('<w:evenAndOddHeaders')) return source;
  return source.replace(
    '</w:settings>',
    '<w:evenAndOddHeaders/></w:settings>'
  );
};

const replaceParagraphContainingMarker = (documentXml, marker, replacementXml) => {
  const source = String(documentXml || '');
  if (!trimText(marker) || !source.includes(marker)) return source;
  const paragraphPattern = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  let replaced = false;
  return source.replace(paragraphPattern, (match) => {
    if (replaced || !match.includes(marker)) return match;
    replaced = true;
    return replacementXml;
  });
};

const decodeXmlText = (value) => String(value || '')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, '\'')
  .replace(/&amp;/g, '&');

const extractParagraphText = (paragraphXml) => {
  const matches = String(paragraphXml || '').match(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g) || [];
  if (!matches.length) return '';
  return trimText(matches
    .map((item) => item.replace(/^<w:t\b[^>]*>/, '').replace(/<\/w:t>$/u, ''))
    .map((item) => decodeXmlText(item))
    .join(''));
};

const isDocxTocFieldParagraph = (paragraphXml) => {
  const instrMatches = String(paragraphXml || '').match(/<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>/g) || [];
  if (!instrMatches.length) return false;
  return instrMatches.some((item) => {
    const raw = item.replace(/^<w:instrText\b[^>]*>/, '').replace(/<\/w:instrText>$/u, '');
    return decodeXmlText(raw).includes(DOCX_NATIVE_TOC_INSTRUCTION);
  });
};

const looksLikeDocxHeadingLine = (value) => {
  const text = trimText(value);
  if (!text) return false;
  return (
    text === '目录'
    || /^第[\d一二三四五六七八九十百千]+章\s*\S+/u.test(text)
    || /^附录[\d一二三四五六七八九十百千]*\s*\S+/u.test(text)
    || /^附件[\d一二三四五六七八九十百千]+\s*\S+/u.test(text)
    || /^[一二三四五六七八九十]+、\s*\S+/u.test(text)
    || /^[（(][一二三四五六七八九十\d]+[）)]\s*\S+/u.test(text)
    || /^\d{1,2}(?:[.．]\d{1,2}){0,2}(?:[、.)）]|\s)\s*\S+/u.test(text)
  );
};

const extractParagraphLogicalLines = (paragraphXml) => {
  const source = String(paragraphXml || '')
    .replace(/<w:t\b([^>]*)\/>/g, '<w:t$1></w:t>');
  if (!source.includes('<w:br')) return [];
  const tokens = source.match(/<w:t\b[^>]*>[\s\S]*?<\/w:t>|<w:br\b[^>]*\/>/g) || [];
  if (!tokens.some((item) => item.startsWith('<w:br'))) return [];
  const lines = [''];
  for (const token of tokens) {
    if (token.startsWith('<w:br')) {
      if (/w:type="page"/u.test(token)) continue;
      lines.push('');
      continue;
    }
    const text = token.replace(/^<w:t\b[^>]*>/, '').replace(/<\/w:t>$/u, '');
    lines[lines.length - 1] += decodeXmlText(text);
  }
  return lines;
};

const splitDocxLogicalParagraphXml = (
  paragraphXml,
  { normalizedSplitHints = new Set(), normalizedHeadingLines = new Set() } = {}
) => {
  const logicalLines = extractParagraphLogicalLines(paragraphXml);
  if (logicalLines.length <= 1) {
    return {
      changed: false,
      xml: paragraphXml,
    };
  }
  const normalizedLines = logicalLines.map((item) => trimText(item));
  const matchedKnownHeading = normalizedLines.some((item) => normalizedSplitHints.has(item));
  const matchedHeuristicHeading = normalizedLines.some((item) => looksLikeDocxHeadingLine(item));
  if (!matchedKnownHeading && !matchedHeuristicHeading) {
    return {
      changed: false,
      xml: paragraphXml,
    };
  }
  return {
    changed: true,
    xml: logicalLines.map((line) => {
      const normalizedLine = trimText(line);
      return buildDocxParagraphXml(line, {
        headingLevel: normalizedHeadingLines.has(normalizedLine) || looksLikeDocxHeadingLine(normalizedLine) ? 1 : 0,
      });
    }).join(''),
  };
};

const replaceDocxLogicalParagraphsInXml = (
  xml,
  { normalizedSplitHints = new Set(), normalizedHeadingLines = new Set() } = {}
) => {
  const source = String(xml || '');
  if (!source) {
    return {
      changed: false,
      xml: source,
    };
  }
  const paragraphRegex = /<w:p\b[^>]*>[\s\S]*?<\/w:p>|<w:p\/>/g;
  let changed = false;
  const nextXml = source.replace(paragraphRegex, (paragraphXml) => {
    const result = splitDocxLogicalParagraphXml(paragraphXml, {
      normalizedSplitHints,
      normalizedHeadingLines,
    });
    if (result.changed) changed = true;
    return result.xml;
  });
  return {
    changed,
    xml: nextXml,
  };
};

const tokenizeDocxTextboxContents = (xml) => {
  const source = String(xml || '');
  const textboxRegex = /<w:txbxContent>([\s\S]*?)<\/w:txbxContent>/g;
  const blocks = [];
  let index = 0;
  const nextXml = source.replace(textboxRegex, (match, innerXml) => {
    const token = `__DOCX_TXBX_CONTENT_${index}__`;
    blocks.push({
      token,
      innerXml: String(innerXml || ''),
    });
    index += 1;
    return token;
  });
  return {
    xml: nextXml,
    blocks,
  };
};

const restoreDocxTextboxContents = (
  xml,
  blocks = [],
  { normalizedSplitHints = new Set(), normalizedHeadingLines = new Set() } = {}
) => {
  let nextXml = String(xml || '');
  let changed = false;
  for (const block of Array.isArray(blocks) ? blocks : []) {
    const result = replaceDocxLogicalParagraphsInXml(block.innerXml, {
      normalizedSplitHints,
      normalizedHeadingLines,
    });
    if (result.changed) changed = true;
    nextXml = nextXml.split(block.token).join(`<w:txbxContent>${result.xml}</w:txbxContent>`);
  }
  return {
    changed,
    xml: nextXml,
  };
};

const ensureDocxLogicalParagraphsBuffer = (
  buffer,
  { splitHints = [], headingLines = [] } = {}
) => {
  const zip = new PizZip(buffer);
  const documentPath = 'word/document.xml';
  const documentXml = zip.file(documentPath)?.asText() || '';
  if (!trimText(documentXml)) return buffer;
  const normalizedSplitHints = new Set(
    (Array.isArray(splitHints) ? splitHints : [])
      .map((item) => trimText(item))
      .filter(Boolean)
  );
  const normalizedHeadingLines = new Set(
    (Array.isArray(headingLines) ? headingLines : [])
      .map((item) => trimText(item))
      .filter(Boolean)
  );

  const bodyOpenTag = '<w:body>';
  const bodyCloseTag = '</w:body>';
  const bodyStart = documentXml.indexOf(bodyOpenTag);
  const bodyEnd = documentXml.lastIndexOf(bodyCloseTag);
  if (bodyStart < 0 || bodyEnd <= bodyStart) return buffer;

  const bodyContentStart = bodyStart + bodyOpenTag.length;
  const bodyXml = documentXml.slice(bodyContentStart, bodyEnd);
  const sectPrRegex = /<w:sectPr[\s\S]*<\/w:sectPr>\s*$/;
  const sectMatch = bodyXml.match(sectPrRegex);
  const contentXml = sectMatch ? bodyXml.slice(0, bodyXml.length - sectMatch[0].length) : bodyXml;
  const sectPrXml = sectMatch ? sectMatch[0] : '';
  const tokenizedTextboxContent = tokenizeDocxTextboxContents(contentXml);
  const bodyResult = replaceDocxLogicalParagraphsInXml(tokenizedTextboxContent.xml, {
    normalizedSplitHints,
    normalizedHeadingLines,
  });
  const restoredTextboxContent = restoreDocxTextboxContents(bodyResult.xml, tokenizedTextboxContent.blocks, {
    normalizedSplitHints,
    normalizedHeadingLines,
  });
  if (!bodyResult.changed && !restoredTextboxContent.changed) return buffer;

  const nextBodyXml = `${restoredTextboxContent.xml}${sectPrXml}`;
  const nextDocumentXml = `${documentXml.slice(0, bodyContentStart)}${nextBodyXml}${documentXml.slice(bodyEnd)}`;
  zip.file(documentPath, nextDocumentXml);
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
};

const stripStaticTocParagraphs = (documentXml, tocLines = []) => {
  const source = String(documentXml || '');
  const normalizedTocLines = (Array.isArray(tocLines) ? tocLines : [])
    .map((item) => trimText(item))
    .filter(Boolean);
  if (!source || !normalizedTocLines.length) return source;

  const bodyOpenTag = '<w:body>';
  const bodyCloseTag = '</w:body>';
  const bodyStart = source.indexOf(bodyOpenTag);
  const bodyEnd = source.lastIndexOf(bodyCloseTag);
  if (bodyStart < 0 || bodyEnd <= bodyStart) return source;

  const bodyContentStart = bodyStart + bodyOpenTag.length;
  const bodyXml = source.slice(bodyContentStart, bodyEnd);
  const sectPrRegex = /<w:sectPr[\s\S]*<\/w:sectPr>\s*$/;
  const sectMatch = bodyXml.match(sectPrRegex);
  const contentXml = sectMatch ? bodyXml.slice(0, bodyXml.length - sectMatch[0].length) : bodyXml;
  const sectPrXml = sectMatch ? sectMatch[0] : '';
  const paragraphs = contentXml.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>|<w:p\/>/g) || [];
  if (!paragraphs.length) return source;

  const tocFieldIndex = paragraphs.findIndex((paragraph) => paragraph.includes('TOC \\o'));
  if (tocFieldIndex < 0) return source;

  const tocLineSet = new Set(normalizedTocLines);
  const nextParagraphs = [];
  let index = 0;
  let removedAnyTocLine = false;
  while (index < paragraphs.length) {
    if (index <= tocFieldIndex) {
      nextParagraphs.push(paragraphs[index]);
      index += 1;
      continue;
    }

    const text = extractParagraphText(paragraphs[index]);
    if (tocLineSet.has(text)) {
      removedAnyTocLine = true;
      index += 1;
      continue;
    }
    if (removedAnyTocLine && !text) {
      index += 1;
      continue;
    }
    nextParagraphs.push(...paragraphs.slice(index));
    break;
  }

  if (!removedAnyTocLine) return source;
  const nextBodyXml = `${nextParagraphs.join('')}${sectPrXml}`;
  return `${source.slice(0, bodyContentStart)}${nextBodyXml}${source.slice(bodyEnd)}`;
};

const ensureDocxPageBreakBeforeHeadingsBuffer = (buffer, { headings = [] } = {}) => {
  const zip = new PizZip(buffer);
  const documentPath = 'word/document.xml';
  const documentXml = zip.file(documentPath)?.asText() || '';
  const normalizedHeadings = new Set(
    (Array.isArray(headings) ? headings : [])
      .map((item) => trimText(item))
      .filter(Boolean)
  );
  if (!trimText(documentXml) || !normalizedHeadings.size) return buffer;

  const bodyOpenTag = '<w:body>';
  const bodyCloseTag = '</w:body>';
  const bodyStart = documentXml.indexOf(bodyOpenTag);
  const bodyEnd = documentXml.lastIndexOf(bodyCloseTag);
  if (bodyStart < 0 || bodyEnd <= bodyStart) return buffer;

  const bodyContentStart = bodyStart + bodyOpenTag.length;
  const bodyXml = documentXml.slice(bodyContentStart, bodyEnd);
  const sectPrRegex = /<w:sectPr[\s\S]*<\/w:sectPr>\s*$/;
  const sectMatch = bodyXml.match(sectPrRegex);
  const contentXml = sectMatch ? bodyXml.slice(0, bodyXml.length - sectMatch[0].length) : bodyXml;
  const sectPrXml = sectMatch ? sectMatch[0] : '';
  const paragraphs = contentXml.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>|<w:p\/>/g) || [];
  if (!paragraphs.length) return buffer;

  const nextParagraphs = [];
  let changed = false;
  for (const paragraph of paragraphs) {
    const text = extractParagraphText(paragraph);
    const isTocBoundary = normalizedHeadings.has('目录') && isDocxTocFieldParagraph(paragraph);
    if (normalizedHeadings.has(text) || isTocBoundary) {
      const previousParagraph = nextParagraphs[nextParagraphs.length - 1] || '';
      if (!previousParagraph.includes('w:br w:type="page"')) {
        nextParagraphs.push(buildDocxPageBreakXml());
        changed = true;
      }
    }
    nextParagraphs.push(paragraph);
  }
  if (!changed) return buffer;

  const nextBodyXml = `${nextParagraphs.join('')}${sectPrXml}`;
  const nextDocumentXml = `${documentXml.slice(0, bodyContentStart)}${nextBodyXml}${documentXml.slice(bodyEnd)}`;
  zip.file(documentPath, nextDocumentXml);
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
};

const countMatches = (value, pattern) => {
  const matches = String(value || '').match(pattern);
  return Array.isArray(matches) ? matches.length : 0;
};

const isPageBreakParagraph = (paragraphXml) => (
  String(paragraphXml || '').includes('w:br w:type="page"')
  && !extractParagraphText(paragraphXml)
);

const removeSectPrOptions = (sectPrXml) => String(sectPrXml || '')
  .replace(/<w:titlePg\/>/g, '')
  .replace(/<w:pgNumType\b[^>]*\/>/g, '')
  .replace(/<w:type\b[^>]*\/>/g, '');

const ensureSectPrChild = (sectPrXml, childXml, marker) => {
  const source = String(sectPrXml || '');
  if (!source || !trimText(childXml)) return source;
  if (marker && source.includes(marker)) return source;
  return source.replace('</w:sectPr>', `${childXml}</w:sectPr>`);
};

const ensureSectPrPageNumberStart = (sectPrXml, startPageNumber = 1, format = '') => {
  const source = String(sectPrXml || '');
  if (!trimText(source)) return source;
  const withoutOld = source.replace(/<w:pgNumType\b[^>]*\/>/g, '');
  const fmtAttr = trimText(format) ? ` w:fmt="${trimText(format)}"` : '';
  return ensureSectPrChild(
    withoutOld,
    `<w:pgNumType w:start="${Number(startPageNumber || 1) || 1}"${fmtAttr}/>`,
    '<w:pgNumType '
  );
};

const ensureSectPrTitlePg = (sectPrXml) => ensureSectPrChild(String(sectPrXml || ''), '<w:titlePg/>', '<w:titlePg/>');

const ensureSectPrNextPageType = (sectPrXml) => ensureSectPrChild(String(sectPrXml || ''), '<w:type w:val="nextPage"/>', '<w:type ');

const attachSectPrToParagraph = (paragraphXml, sectPrXml) => {
  const source = String(paragraphXml || '');
  if (!trimText(source) || !trimText(sectPrXml) || source.includes('<w:sectPr')) return source;
  if (source === '<w:p/>') return `<w:p><w:pPr>${sectPrXml}</w:pPr></w:p>`;
  if (source.includes('<w:pPr>')) return source.replace('</w:pPr>', `${sectPrXml}</w:pPr>`);
  const openTagEnd = source.indexOf('>');
  if (openTagEnd < 0) return source;
  return `${source.slice(0, openTagEnd + 1)}<w:pPr>${sectPrXml}</w:pPr>${source.slice(openTagEnd + 1)}`;
};

const ensureDocxSectionPageNumberBuffer = (
  buffer,
  {
    coverHeading = '封面',
    restartHeading = '目录',
    bodyStartHeading = '',
    startPageNumber = 1,
    frontMatterPageNumberFormat = 'lowerRoman',
  } = {}
) => {
  const zip = new PizZip(buffer);
  const documentPath = 'word/document.xml';
  const documentXml = zip.file(documentPath)?.asText() || '';
  if (!trimText(documentXml)) return buffer;
  const normalizedStartPageNumber = Number(startPageNumber || 1) || 1;
  const normalizedBodyStartHeading = trimText(bodyStartHeading);
  const normalizedFrontMatterFormat = trimText(frontMatterPageNumberFormat);
  if (
    countMatches(documentXml, /<w:sectPr/g) >= (normalizedBodyStartHeading ? 3 : 2)
    && documentXml.includes('<w:titlePg/>')
    && documentXml.includes(`<w:pgNumType w:start="${normalizedStartPageNumber}"/>`)
    && (!normalizedBodyStartHeading || documentXml.includes(`<w:pgNumType w:start="${normalizedStartPageNumber}" w:fmt="${normalizedFrontMatterFormat}"/>`))
  ) {
    return buffer;
  }

  const bodyOpenTag = '<w:body>';
  const bodyCloseTag = '</w:body>';
  const bodyStart = documentXml.indexOf(bodyOpenTag);
  const bodyEnd = documentXml.lastIndexOf(bodyCloseTag);
  if (bodyStart < 0 || bodyEnd <= bodyStart) return buffer;

  const bodyContentStart = bodyStart + bodyOpenTag.length;
  const bodyXml = documentXml.slice(bodyContentStart, bodyEnd);
  const sectPrRegex = /<w:sectPr[\s\S]*<\/w:sectPr>\s*$/;
  const sectMatch = bodyXml.match(sectPrRegex);
  const contentXml = sectMatch ? bodyXml.slice(0, bodyXml.length - sectMatch[0].length) : bodyXml;
  const sectPrXml = sectMatch ? sectMatch[0] : '';
  if (!trimText(sectPrXml)) return buffer;

  const paragraphs = contentXml.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>|<w:p\/>/g) || [];
  if (!paragraphs.length) return buffer;

  const normalizedCoverHeading = trimText(coverHeading);
  const normalizedRestartHeading = trimText(restartHeading);
  const hasCover = paragraphs.some((paragraph) => extractParagraphText(paragraph) === normalizedCoverHeading);
  let nextParagraphs = [...paragraphs];
  let changed = false;

  if (hasCover) {
    let restartIndex = nextParagraphs.findIndex((paragraph) => extractParagraphText(paragraph) === normalizedRestartHeading);
    if (restartIndex < 0 && normalizedRestartHeading === '目录') {
      restartIndex = nextParagraphs.findIndex((paragraph) => isDocxTocFieldParagraph(paragraph));
    }
    if (restartIndex > 0) {
      if (isPageBreakParagraph(nextParagraphs[restartIndex - 1])) {
        nextParagraphs.splice(restartIndex - 1, 1);
        restartIndex -= 1;
        changed = true;
      }
      const boundaryIndex = restartIndex - 1;
      if (boundaryIndex >= 0 && !nextParagraphs[boundaryIndex].includes('<w:sectPr')) {
        const coverSectPrXml = ensureSectPrTitlePg(ensureSectPrNextPageType(removeSectPrOptions(sectPrXml)));
        const nextParagraph = attachSectPrToParagraph(nextParagraphs[boundaryIndex], coverSectPrXml);
        if (nextParagraph !== nextParagraphs[boundaryIndex]) {
          nextParagraphs[boundaryIndex] = nextParagraph;
          changed = true;
        }
      }
    }
  }

  if (normalizedBodyStartHeading) {
    let bodyStartIndex = nextParagraphs.findIndex((paragraph) => extractParagraphText(paragraph) === normalizedBodyStartHeading);
    if (bodyStartIndex > 0) {
      if (isPageBreakParagraph(nextParagraphs[bodyStartIndex - 1])) {
        nextParagraphs.splice(bodyStartIndex - 1, 1);
        bodyStartIndex -= 1;
        changed = true;
      }
      const boundaryIndex = bodyStartIndex - 1;
      if (boundaryIndex >= 0 && !nextParagraphs[boundaryIndex].includes('<w:sectPr')) {
        const tocSectPrXml = ensureSectPrPageNumberStart(
          ensureSectPrNextPageType(removeSectPrOptions(sectPrXml)),
          normalizedStartPageNumber,
          normalizedFrontMatterFormat
        );
        const nextParagraph = attachSectPrToParagraph(nextParagraphs[boundaryIndex], tocSectPrXml);
        if (nextParagraph !== nextParagraphs[boundaryIndex]) {
          nextParagraphs[boundaryIndex] = nextParagraph;
          changed = true;
        }
      }
    }
  }

  let nextFinalSectPrXml = ensureSectPrPageNumberStart(removeSectPrOptions(sectPrXml), normalizedStartPageNumber);
  if (nextFinalSectPrXml !== sectPrXml) changed = true;

  const nextBodyXml = `${nextParagraphs.join('')}${nextFinalSectPrXml}`;
  const nextDocumentXml = `${documentXml.slice(0, bodyContentStart)}${nextBodyXml}${documentXml.slice(bodyEnd)}`;
  if (!changed && countMatches(documentXml, /<w:sectPr/g) === countMatches(nextDocumentXml, /<w:sectPr/g)) {
    return buffer;
  }
  zip.file(documentPath, nextDocumentXml);
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
};

const insertNativeTocAfterHeading = (documentXml, headingText = '目录') => {
  const source = String(documentXml || '');
  if (!trimText(source)) return source;
  const normalizedHeading = escapeXml(trimText(headingText) || '目录');
  const headingPattern = new RegExp(
    `<w:p\\b[^>]*>[\\s\\S]*?<w:t[^>]*>\\s*${normalizedHeading}\\s*<\\/w:t>[\\s\\S]*?<\\/w:p>`,
    'u'
  );
  if (!headingPattern.test(source)) return source;
  return source.replace(headingPattern, (match) => `${match}${buildDocxNativeTocFieldXml()}`);
};

const getRelationshipAttribute = (tag, attributeName) => {
  const match = String(tag || '').match(new RegExp(`${attributeName}="([^"]+)"`, 'u'));
  return trimText(match?.[1]);
};

const ensureRelationshipWithResolvedId = (relsXml, { id, type, target }) => {
  const source = ensureRelationshipXml(relsXml);
  const relationshipTags = source.match(/<Relationship\b[^>]*\/>/g) || [];
  for (const tag of relationshipTags) {
    if (getRelationshipAttribute(tag, 'Target') !== trimText(target)) continue;
    return {
      relsXml: source,
      relId: getRelationshipAttribute(tag, 'Id'),
    };
  }
  return {
    relsXml: ensureRelationship(source, { id, type, target }),
    relId: trimText(id),
  };
};

const ensureDocxSettingsBuffer = (
  buffer,
  {
    updateFields = false,
    evenAndOddHeaders = false,
  } = {}
) => {
  const zip = new PizZip(buffer);
  const documentXml = zip.file('word/document.xml')?.asText() || '';
  if (!trimText(documentXml)) return buffer;

  const settingsPath = 'word/settings.xml';
  const relsPath = 'word/_rels/document.xml.rels';
  const contentTypesPath = '[Content_Types].xml';
  const settingsRelId = 'rIdAutoSettings1';
  const settingsXml = zip.file(settingsPath)?.asText() || '';
  const relsXml = zip.file(relsPath)?.asText() || '';
  const contentTypesXml = zip.file(contentTypesPath)?.asText() || '';

  let nextSettingsXml = ensureSettingsXml(settingsXml);
  if (updateFields) nextSettingsXml = ensureSettingsUpdateFieldsXml(nextSettingsXml);
  if (evenAndOddHeaders) nextSettingsXml = ensureSettingsEvenAndOddHeadersXml(nextSettingsXml);
  const nextRelsXml = ensureRelationship(relsXml, {
    id: settingsRelId,
    type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings',
    target: 'settings.xml',
  });
  const nextContentTypesXml = ensureContentTypeOverride(contentTypesXml, {
    partName: '/word/settings.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml',
  });

  if (!trimText(settingsXml) || nextSettingsXml !== settingsXml) zip.file(settingsPath, nextSettingsXml);
  if (!trimText(relsXml) || nextRelsXml !== relsXml) zip.file(relsPath, nextRelsXml);
  if (!trimText(contentTypesXml) || nextContentTypesXml !== contentTypesXml) {
    zip.file(contentTypesPath, nextContentTypesXml);
  }

  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
};

const ensureDocxSettingsUpdateFieldsBuffer = (buffer) => ensureDocxSettingsBuffer(buffer, {
  updateFields: true,
});

const ensureDocxNativeTocBuffer = (
  buffer,
  { marker = DOCX_NATIVE_TOC_MARKER, headingText = '目录', tocLines = [] } = {}
) => {
  const zip = new PizZip(buffer);
  const documentPath = 'word/document.xml';
  const documentXml = zip.file(documentPath)?.asText() || '';
  if (!trimText(documentXml)) return buffer;
  if (documentXml.includes(DOCX_NATIVE_TOC_INSTRUCTION)) {
    const strippedDocumentXml = stripStaticTocParagraphs(documentXml, tocLines);
    if (strippedDocumentXml !== documentXml) zip.file(documentPath, strippedDocumentXml);
    return ensureDocxSettingsUpdateFieldsBuffer(
      zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' })
    );
  }

  const fieldXml = buildDocxNativeTocFieldXml();
  let nextDocumentXml = replaceParagraphContainingMarker(documentXml, marker, fieldXml);
  if (nextDocumentXml === documentXml) {
    nextDocumentXml = insertNativeTocAfterHeading(documentXml, headingText);
  }
  nextDocumentXml = stripStaticTocParagraphs(nextDocumentXml, tocLines);
  if (nextDocumentXml !== documentXml) zip.file(documentPath, nextDocumentXml);

  return ensureDocxSettingsUpdateFieldsBuffer(
    zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' })
  );
};

const ensureSectReference = (documentXml, tagName, relId, refType = 'default') => {
  const source = ensureXmlnsR(documentXml);
  return source.replace(/<w:sectPr\b[^>]*>([\s\S]*?)<\/w:sectPr>/g, (match, inner) => {
    const normalizedRefType = trimText(refType) || 'default';
    if (inner.includes(`<w:${tagName}Reference w:type="${normalizedRefType}"`)) return match;
    return match.replace(
      '</w:sectPr>',
      `<w:${tagName}Reference w:type="${normalizedRefType}" r:id="${trimText(relId)}"/></w:sectPr>`
    );
  });
};

const replaceHeaderFooterTokens = (content, { headerText, footerText }) => String(content || '')
  .split('{{HEADER_CONTENT}}').join(escapeXml(headerText || ''))
  .split('{{FOOTER_CONTENT}}').join(escapeXml(footerText || ''));

const ensureDocxHeaderFooterBuffer = (buffer, { headerText = '', footerText = '' } = {}) => {
  const zip = new PizZip(buffer);
  const documentXml = zip.file('word/document.xml')?.asText() || '';
  if (!trimText(documentXml)) return buffer;

  const headerEntries = zip.file(/word\/header\d*\.xml/) || [];
  const footerEntries = zip.file(/word\/footer\d*\.xml/) || [];
  const headerName = headerEntries[0]?.name || 'word/header1.xml';
  const headerEvenName = headerEntries[1]?.name || 'word/header2.xml';
  const footerName = footerEntries[0]?.name || 'word/footer1.xml';
  const footerEvenName = footerEntries[1]?.name || 'word/footer2.xml';
  const headerRelId = 'rIdAutoHeader1';
  const headerEvenRelId = 'rIdAutoHeaderEven1';
  const footerRelId = 'rIdAutoFooter1';
  const footerEvenRelId = 'rIdAutoFooterEven1';
  const normalizedHeaderText = trimText(headerText) || '投标文件';
  const normalizedFooterText = trimText(footerText) || '自动生成投标文件';

  if (!headerEntries.length) {
    zip.file(headerName, buildSimpleHeaderFooterXml('hdr', normalizedHeaderText, { alignment: 'right' }));
  } else {
    for (const entry of headerEntries) {
      const content = zip.file(entry.name)?.asText();
      if (!content) continue;
      zip.file(entry.name, replaceHeaderFooterTokens(content, { headerText, footerText }));
    }
  }
  if (headerEntries.length < 2) {
    zip.file(headerEvenName, buildSimpleHeaderFooterXml('hdr', normalizedHeaderText, { alignment: 'left' }));
  }

  if (!footerEntries.length) {
    zip.file(footerName, buildSimpleHeaderFooterXml('ftr', normalizedFooterText, { alignment: 'right' }));
  } else {
    for (const entry of footerEntries) {
      const content = zip.file(entry.name)?.asText();
      if (!content) continue;
      zip.file(entry.name, replaceHeaderFooterTokens(content, { headerText, footerText }));
    }
  }
  if (footerEntries.length < 2) {
    zip.file(
      footerEvenName,
      buildSimpleHeaderFooterXml('ftr', normalizedFooterText, {
        alignment: 'left',
        mirrorPageNumberOrder: true,
      })
    );
  }

  const relsPath = 'word/_rels/document.xml.rels';
  const relsXml = zip.file(relsPath)?.asText() || '';
  let nextRelsXml = relsXml;
  const defaultHeaderRel = ensureRelationshipWithResolvedId(nextRelsXml, {
    id: headerRelId,
    type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header',
    target: headerName.replace(/^word\//u, ''),
  });
  nextRelsXml = defaultHeaderRel.relsXml;
  const evenHeaderRel = ensureRelationshipWithResolvedId(nextRelsXml, {
    id: headerEvenRelId,
    type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header',
    target: headerEvenName.replace(/^word\//u, ''),
  });
  nextRelsXml = evenHeaderRel.relsXml;
  const defaultFooterRel = ensureRelationshipWithResolvedId(nextRelsXml, {
    id: footerRelId,
    type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer',
    target: footerName.replace(/^word\//u, ''),
  });
  nextRelsXml = defaultFooterRel.relsXml;
  const evenFooterRel = ensureRelationshipWithResolvedId(nextRelsXml, {
    id: footerEvenRelId,
    type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer',
    target: footerEvenName.replace(/^word\//u, ''),
  });
  nextRelsXml = evenFooterRel.relsXml;
  if (!trimText(relsXml) || nextRelsXml !== relsXml) zip.file(relsPath, nextRelsXml);

  const contentTypesXml = zip.file('[Content_Types].xml')?.asText() || '';
  let nextContentTypes = contentTypesXml;
  nextContentTypes = ensureContentTypeOverride(nextContentTypes, {
    partName: `/${headerName}`,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
  });
  nextContentTypes = ensureContentTypeOverride(nextContentTypes, {
    partName: `/${headerEvenName}`,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
  });
  nextContentTypes = ensureContentTypeOverride(nextContentTypes, {
    partName: `/${footerName}`,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml',
  });
  nextContentTypes = ensureContentTypeOverride(nextContentTypes, {
    partName: `/${footerEvenName}`,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml',
  });
  if (!trimText(contentTypesXml) || nextContentTypes !== contentTypesXml) zip.file('[Content_Types].xml', nextContentTypes);

  let nextDocumentXml = documentXml;
  nextDocumentXml = ensureSectReference(nextDocumentXml, 'header', defaultHeaderRel.relId, 'default');
  nextDocumentXml = ensureSectReference(nextDocumentXml, 'header', evenHeaderRel.relId, 'even');
  nextDocumentXml = ensureSectReference(nextDocumentXml, 'footer', defaultFooterRel.relId, 'default');
  nextDocumentXml = ensureSectReference(nextDocumentXml, 'footer', evenFooterRel.relId, 'even');
  if (nextDocumentXml !== documentXml) zip.file('word/document.xml', nextDocumentXml);

  return ensureDocxSettingsBuffer(
    zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }),
    { evenAndOddHeaders: true }
  );
};

module.exports = {
  buildWordLayoutPlan,
  ensureDocxHeaderFooterBuffer,
  ensureDocxLogicalParagraphsBuffer,
  ensureDocxNativeTocBuffer,
  ensureDocxPageBreakBeforeHeadingsBuffer,
  ensureDocxSectionPageNumberBuffer,
  ensureDocxSettingsUpdateFieldsBuffer,
  DOCX_NATIVE_TOC_MARKER,
  DOCX_NATIVE_TOC_INSTRUCTION,
  classifyWordChapterSlot,
  toChineseNumber,
};
