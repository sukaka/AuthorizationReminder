const PizZip = require('pizzip');

const SUPPORTED_PARSE_FILE_ROLES = new Set(['MAIN', 'CLARIFICATION', 'ATTACHMENT', 'SUPPLEMENT']);
const EXTRACTABLE_ARCHIVE_EXTS = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.zip']);
const SPREADSHEET_EXTS = new Set(['.xls', '.xlsx']);
const CLAUSE_TYPE_RULES = [
  { type: 'SCORING', patterns: [/评分/u, /评审/u, /分值/u, /打分/u, /综合评分/u] },
  { type: 'QUALIFICATION', patterns: [/资格/u, /资质/u, /证书/u, /业绩/u, /人员/u] },
  { type: 'TECHNICAL', patterns: [/技术/u, /参数/u, /规格/u, /性能/u, /配置/u] },
  { type: 'CONTRACT', patterns: [/合同/u, /付款/u, /验收/u, /违约/u, /结算/u] },
  { type: 'SCHEDULE', patterns: [/工期/u, /交付/u, /期限/u, /节点/u, /时限/u] },
  { type: 'COMMERCIAL', patterns: [/报价/u, /商务/u, /价格/u, /税率/u, /付款方式/u] },
];
const CLAUSE_SUBTYPE_RULES = [
  { subtype: 'MANUFACTURER_AUTHORIZATION', patterns: [/原厂授权/u, /制造商授权/u, /生产厂家授权/u] },
  { subtype: 'DISTRIBUTOR_AUTHORIZATION', patterns: [/代理授权/u, /代理商授权/u, /经销商授权/u, /渠道授权/u] },
  { subtype: 'DEMO_REQUIRED', patterns: [/现场演示/u, /演示/u, /\bdemo\b/ui] },
  { subtype: 'PROTOTYPE_REQUIRED', patterns: [/样机/u, /原型机/u, /试制样品/u] },
  { subtype: 'ORIGINAL_REQUIRED', patterns: [/原件/u, /原章/u, /原始件/u] },
  { subtype: 'COPY_REQUIRED', patterns: [/复印件/u, /扫描件/u, /影印件/u] },
];

const normalizeText = (value) => String(value || '').trim();

const normalizeExt = (value) => {
  const text = normalizeText(value).toLowerCase();
  if (!text) return '';
  return text.startsWith('.') ? text : `.${text}`;
};

const extFromName = (value) => {
  const text = normalizeText(value);
  if (!text) return '';
  const idx = text.lastIndexOf('.');
  return idx >= 0 ? normalizeExt(text.slice(idx)) : '';
};

const nonEmptyText = (value) => normalizeText(value);

const decodeXmlEntities = (value) => String(value || '')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, '\'')
  .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => {
    const code = Number.parseInt(hex, 16);
    return Number.isFinite(code) ? String.fromCodePoint(code) : '';
  })
  .replace(/&#([0-9]+);/g, (_m, num) => {
    const code = Number.parseInt(num, 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : '';
  });

const stripXmlTags = (value) => decodeXmlEntities(String(value || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

const normalizeParseFileRole = (value) => {
  const role = normalizeText(value).toUpperCase();
  return SUPPORTED_PARSE_FILE_ROLES.has(role) ? role : 'SUPPLEMENT';
};

const classifyParseArchiveEntries = (entries = []) => {
  const extractable = [];
  const skipped = [];

  for (const item of Array.isArray(entries) ? entries : []) {
    const entryName = normalizeText(item?.entryName || item?.name);
    const isDir = !!item?.dir || entryName.endsWith('/');
    if (!entryName) continue;
    if (isDir) {
      skipped.push({ ...item, entryName, reason: 'directory' });
      continue;
    }

    const ext = extFromName(entryName);
    if (EXTRACTABLE_ARCHIVE_EXTS.has(ext)) {
      extractable.push({ ...item, entryName, ext });
      continue;
    }

    skipped.push({ ...item, entryName, ext, reason: 'unsupported_ext' });
  }

  return { extractable, skipped };
};

const resolveSelectedSheetNames = (sheetManifest = [], selectedNames = []) => {
  const selectedSet = new Set(
    (Array.isArray(selectedNames) ? selectedNames : [])
      .map((item) => normalizeText(item))
      .filter(Boolean)
  );

  return (Array.isArray(sheetManifest) ? sheetManifest : [])
    .map((item) => normalizeText(item?.name || item))
    .filter((name) => name && selectedSet.has(name));
};

const rolePriority = (role) => {
  const normalizedRole = normalizeParseFileRole(role);
  if (normalizedRole === 'CLARIFICATION') return 3;
  if (normalizedRole === 'MAIN') return 2;
  if (normalizedRole === 'ATTACHMENT') return 1;
  return 0;
};

const safeLoadZip = (buffer) => {
  if (!buffer) return null;
  try {
    return new PizZip(buffer);
  } catch {
    return null;
  }
};

const normalizeArchiveEntryName = (value) => normalizeText(String(value || '').replace(/^\/+/, '').replace(/\\/g, '/'));

const joinArchiveEntryName = (...parts) => parts
  .map((item) => normalizeArchiveEntryName(item))
  .filter(Boolean)
  .join('/')
  .replace(/\/+/g, '/');

const parseWorksheetCellRef = (value) => {
  const match = String(value || '').match(/^([A-Z]+)(\d+)$/i);
  if (!match) return { colIndex: null, rowIndex: null };
  const letters = match[1].toUpperCase();
  let colIndex = 0;
  for (let i = 0; i < letters.length; i += 1) {
    colIndex = (colIndex * 26) + (letters.charCodeAt(i) - 64);
  }
  return {
    colIndex: colIndex > 0 ? colIndex - 1 : null,
    rowIndex: Number(match[2]) - 1,
  };
};

const normalizeRelationshipTarget = (value) => {
  const target = normalizeArchiveEntryName(value);
  if (!target) return '';
  if (target.startsWith('xl/')) return target;
  return joinArchiveEntryName('xl', target.replace(/^\/+/, ''));
};

const parseWorkbookRelationships = (xml) => {
  const map = new Map();
  const regex = /<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/?>/g;
  let match = regex.exec(String(xml || ''));
  while (match) {
    map.set(match[1], normalizeRelationshipTarget(match[2]));
    match = regex.exec(String(xml || ''));
  }
  return map;
};

const parseWorkbookSheetManifest = (workbookXml, relsXml) => {
  const manifest = [];
  const relMap = parseWorkbookRelationships(relsXml);
  const regex = /<sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"[^>]*\/?>/g;
  let match = regex.exec(String(workbookXml || ''));
  while (match) {
    const name = decodeXmlEntities(match[1] || '').trim();
    const relId = match[2];
    const target = relMap.get(relId) || '';
    if (name && target) manifest.push({ name, target });
    match = regex.exec(String(workbookXml || ''));
  }
  return manifest;
};

const parseSharedStrings = (xml) => {
  const values = [];
  const text = String(xml || '');
  const regex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let match = regex.exec(text);
  while (match) {
    const parts = [];
    const inner = match[1] || '';
    const tRegex = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
    let tMatch = tRegex.exec(inner);
    while (tMatch) {
      parts.push(decodeXmlEntities(tMatch[1] || ''));
      tMatch = tRegex.exec(inner);
    }
    values.push(parts.join('').trim());
    match = regex.exec(text);
  }
  return values;
};

const extractWorksheetCellValue = (cellXml, cellType, sharedStrings) => {
  const source = String(cellXml || '');
  if (cellType === 'inlineStr') {
    const match = source.match(/<is\b[^>]*>([\s\S]*?)<\/is>/);
    return stripXmlTags(match?.[1] || '');
  }

  const valueMatch = source.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/);
  const rawValue = decodeXmlEntities(valueMatch?.[1] || '').trim();
  if (!rawValue) return '';
  if (cellType === 's') {
    const idx = Number(rawValue);
    return Number.isFinite(idx) && idx >= 0 ? String(sharedStrings[idx] || '') : '';
  }
  if (cellType === 'b') return rawValue === '1' ? 'TRUE' : 'FALSE';
  return rawValue;
};

const normalizeWorksheetRows = (rows = []) => (Array.isArray(rows) ? rows : [])
  .map((row) => (Array.isArray(row) ? row : []).map((cell) => normalizeText(cell)))
  .filter((row) => row.some(Boolean));

const parseWorksheetRows = (xml, sharedStrings, options = {}) => {
  const maxRows = Math.max(1, Math.min(1200, Number(options.maxRows || 400)));
  const maxCols = Math.max(1, Math.min(80, Number(options.maxCols || 30)));
  const rows = [];
  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch = rowRegex.exec(String(xml || ''));
  while (rowMatch && rows.length < maxRows) {
    const cells = [];
    const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cellMatch = cellRegex.exec(rowMatch[1] || '');
    while (cellMatch) {
      const attrs = cellMatch[1] || '';
      const cellXml = cellMatch[2] || '';
      const refMatch = attrs.match(/\br="([^"]+)"/);
      const typeMatch = attrs.match(/\bt="([^"]+)"/);
      const value = extractWorksheetCellValue(cellXml, typeMatch?.[1] || '', sharedStrings);
      const { colIndex } = parseWorksheetCellRef(refMatch?.[1] || '');
      const targetIndex = Number.isFinite(colIndex) && colIndex >= 0 ? colIndex : cells.length;
      if (targetIndex < maxCols) {
        while (cells.length < targetIndex) cells.push('');
        cells[targetIndex] = value;
      }
      cellMatch = cellRegex.exec(rowMatch[1] || '');
    }
    while (cells.length > 0 && !normalizeText(cells[cells.length - 1])) cells.pop();
    if (cells.some((cell) => normalizeText(cell))) rows.push(cells);
    rowMatch = rowRegex.exec(String(xml || ''));
  }
  return normalizeWorksheetRows(rows);
};

const sheetRowsToText = (rows = []) => normalizeWorksheetRows(rows)
  .map((row) => row.join(' | '))
  .filter(Boolean)
  .join('\n');

const extractArchiveDocumentsFromBuffer = async (buffer, options = {}) => {
  const files = [];
  const skipped = [];
  const maxDepth = Math.max(1, Math.min(8, Number(options.maxDepth || 5)));

  const visitZipBuffer = (zipBuffer, prefix = '', depth = 0) => {
    const zip = safeLoadZip(zipBuffer);
    if (!zip) {
      skipped.push({
        entryName: normalizeArchiveEntryName(prefix) || normalizeText(options.sourceName) || 'archive.zip',
        reason: 'invalid_zip',
        depth,
      });
      return;
    }

    const entries = Object.values(zip.files)
      .map((item) => ({
        entryName: item?.name || '',
        dir: !!item?.dir,
      }))
      .sort((a, b) => String(a.entryName).localeCompare(String(b.entryName), 'zh-Hans-CN'));
    const classified = classifyParseArchiveEntries(entries);
    for (const item of classified.skipped) {
      skipped.push({
        ...item,
        entryName: joinArchiveEntryName(prefix, item.entryName),
        depth,
      });
    }

    for (const item of classified.extractable) {
      const entryName = joinArchiveEntryName(prefix, item.entryName);
      const zipFile = zip.file(item.entryName);
      if (!zipFile) {
        skipped.push({
          entryName,
          ext: item.ext,
          reason: 'missing_entry',
          depth,
        });
        continue;
      }

      const entryBuffer = zipFile.asNodeBuffer();
      if (item.ext === '.zip') {
        if (depth + 1 >= maxDepth) {
          skipped.push({
            entryName,
            ext: item.ext,
            reason: 'max_depth',
            depth: depth + 1,
          });
          continue;
        }
        visitZipBuffer(entryBuffer, entryName, depth + 1);
        continue;
      }

      files.push({
        entryName,
        ext: item.ext,
        depth,
        buffer: entryBuffer,
        fileName: pathBasename(entryName),
      });
    }
  };

  visitZipBuffer(buffer, '', 0);
  files.sort((a, b) => Number(a.depth || 0) - Number(b.depth || 0)
    || String(a.entryName).localeCompare(String(b.entryName), 'zh-Hans-CN'));
  return { files, skipped };
};

const pathBasename = (value) => {
  const entryName = normalizeArchiveEntryName(value);
  if (!entryName) return '';
  const parts = entryName.split('/');
  return parts[parts.length - 1] || '';
};

const extractSpreadsheetWorkbookFromBuffer = async (buffer, options = {}) => {
  const zip = safeLoadZip(buffer);
  if (!zip) {
    return {
      sheet_manifest: [],
      selected_sheet_names: [],
      sheets: [],
      text: '',
    };
  }

  const workbookXml = zip.file('xl/workbook.xml')?.asText() || '';
  const relsXml = zip.file('xl/_rels/workbook.xml.rels')?.asText() || '';
  const sharedXml = zip.file('xl/sharedStrings.xml')?.asText() || '';
  const sheetManifest = parseWorkbookSheetManifest(workbookXml, relsXml);
  const selectedSheetNames = resolveSelectedSheetNames(
    sheetManifest,
    Array.isArray(options.selectedSheetNames) && options.selectedSheetNames.length
      ? options.selectedSheetNames
      : sheetManifest.map((item) => item.name)
  );
  const selectedSet = new Set(selectedSheetNames);
  const sharedStrings = parseSharedStrings(sharedXml);
  const sheets = [];

  for (const item of sheetManifest) {
    if (!selectedSet.has(item.name)) continue;
    const sheetXml = zip.file(item.target)?.asText() || '';
    const rows = parseWorksheetRows(sheetXml, sharedStrings, options);
    const columnCount = rows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
    sheets.push({
      name: item.name,
      target: item.target,
      rows,
      row_count: rows.length,
      column_count: columnCount,
      text: sheetRowsToText(rows),
    });
  }

  return {
    source_name: normalizeText(options.sourceName),
    sheet_manifest: sheetManifest.map((item) => ({ name: item.name })),
    selected_sheet_names: selectedSheetNames,
    sheets,
    text: sheets.map((item) => item.text).filter(Boolean).join('\n'),
  };
};

const extractProjectFieldsFromText = (value) => {
  const text = String(value || '');
  if (!normalizeText(text)) return {};

  const fieldDefs = [
    { key: 'project_name', patterns: [/(?:项目名称|采购项目名称|招标项目名称)[:：]\s*([^\n\r；;。]{4,120})/u] },
    { key: 'project_no', patterns: [/(?:项目编号|采购编号|招标编号)[:：]\s*([A-Za-z0-9_\-\/]{3,80})/u] },
    { key: 'buyer_name', patterns: [/(?:采购人|招标人|业主单位)[:：]\s*([^\n\r；;。]{2,80})/u] },
    { key: 'project_budget', patterns: [/(?:预算金额|最高限价|招标控制价)[:：]\s*([^\n\r；;。]{2,80})/u] },
    { key: 'bid_deadline', patterns: [/(?:投标截止时间|递交投标文件截止时间|响应文件提交截止时间|开标时间)[:：]?\s*([0-9]{4}[^\n\r；;。]{4,32})/u] },
    { key: 'contact_name', patterns: [/(?:联系人|项目联系人|采购联系人)[:：]\s*([^\n\r；;。]{2,40})/u] },
  ];

  const result = {};
  for (const def of fieldDefs) {
    for (const pattern of def.patterns) {
      const match = text.match(pattern);
      const fieldValue = normalizeText(match?.[1] || '');
      if (fieldValue) {
        result[def.key] = fieldValue;
        break;
      }
    }
  }
  return result;
};

const classifyClauseType = (value) => {
  const text = normalizeText(value);
  if (!text) return 'GENERAL';
  for (const rule of CLAUSE_TYPE_RULES) {
    if (rule.patterns.some((item) => item.test(text))) return rule.type;
  }
  return 'GENERAL';
};

const classifyClauseSubtype = (value) => {
  const text = normalizeText(value);
  if (!text) return 'GENERAL';
  for (const rule of CLAUSE_SUBTYPE_RULES) {
    if (rule.patterns.some((item) => item.test(text))) return rule.subtype;
  }
  return 'GENERAL';
};

const inferClauseResponseMode = (clauseType, text) => {
  const clauseSubtype = classifyClauseSubtype(text);
  if (['ORIGINAL_REQUIRED', 'COPY_REQUIRED', 'MANUFACTURER_AUTHORIZATION', 'DISTRIBUTOR_AUTHORIZATION'].includes(clauseSubtype)) {
    return 'EVIDENCE';
  }
  if (['DEMO_REQUIRED', 'PROTOTYPE_REQUIRED'].includes(clauseSubtype)) {
    return 'MANUAL';
  }
  if (clauseType === 'SCORING' || /证明|案例|资质|证书/u.test(text)) return 'EVIDENCE';
  if (clauseType === 'TECHNICAL' || /参数|规格|偏离/u.test(text)) return 'MATRIX';
  if (clauseType === 'CONTRACT' || clauseType === 'COMMERCIAL') return 'STATEMENT';
  return 'TEXT';
};

const extractClauseScoreValue = (value) => {
  const match = String(value || '').match(/(\d+(?:\.\d+)?)\s*分/u);
  if (!match) return null;
  const score = Number(match[1]);
  return Number.isFinite(score) ? score : null;
};

const buildTableClauseText = (table) => {
  const header = Array.isArray(table?.header) ? table.header : [];
  const rows = Array.isArray(table?.rows) ? table.rows : [];
  return rows.map((row) => {
    const cells = Array.isArray(row) ? row : [];
    if (!header.length) return cells.join(' | ');
    return cells
      .map((cell, idx) => {
        const label = normalizeText(header[idx]);
        const value = normalizeText(cell);
        if (!label && !value) return '';
        return label ? `${label}:${value}` : value;
      })
      .filter(Boolean)
      .join(' ');
  });
};

const normalizeClauseCandidate = (value) => normalizeText(String(value || '')
  .replace(/^[\d一二三四五六七八九十()（）\-_.、\s]+/u, '')
  .replace(/\s+/g, ' '));

const buildParseClauses = ({ text = '', tables = [], fileRole = 'SUPPLEMENT', maxClauses = 180 }) => {
  const candidates = [];
  const sentenceList = String(text || '')
    .replace(/[。；;]/g, '\n')
    .split(/\n+/)
    .map((item) => normalizeClauseCandidate(item))
    .filter((item) => item.length >= 8);
  candidates.push(...sentenceList);
  for (const table of Array.isArray(tables) ? tables : []) {
    candidates.push(...buildTableClauseText(table).map((item) => normalizeClauseCandidate(item)).filter((item) => item.length >= 4));
  }

  const dedup = new Set();
  const clauses = [];
  for (const candidate of candidates) {
    const key = candidate.toLowerCase();
    if (!candidate || dedup.has(key)) continue;
    dedup.add(key);
    const clauseType = classifyClauseType(candidate);
    const clauseSubtype = classifyClauseSubtype(candidate);
    const scoringFlag = clauseType === 'SCORING' || /分值|得分|满分/u.test(candidate);
    clauses.push({
      clause_text: candidate,
      clause_title: candidate.slice(0, 48),
      clause_type: clauseType,
      clause_subtype: clauseSubtype,
      mandatory_flag: /必须|应当|须|不得|严禁|required/u.test(candidate) ? 1 : 0,
      scoring_flag: scoringFlag ? 1 : 0,
      score_value: scoringFlag ? extractClauseScoreValue(candidate) : null,
      response_mode: inferClauseResponseMode(clauseType, candidate),
      source_role: normalizeParseFileRole(fileRole),
    });
    if (clauses.length >= maxClauses) break;
  }
  return clauses;
};

const buildSpreadsheetTables = (workbook = {}) => {
  return (Array.isArray(workbook.sheets) ? workbook.sheets : []).map((sheet, index) => {
    const rows = normalizeWorksheetRows(sheet?.rows);
    const header = rows[0] || [];
    const bodyRows = rows.length > 1 ? rows.slice(1) : rows;
    return {
      table_index: index + 1,
      table_name: normalizeText(sheet?.name) || `Sheet${index + 1}`,
      source_sheet_name: normalizeText(sheet?.name) || `Sheet${index + 1}`,
      row_count: rows.length,
      column_count: rows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0),
      header,
      rows: bodyRows,
      summary: sheetRowsToText(rows.slice(0, 3)).slice(0, 480),
    };
  });
};

const mergeParsedProjectFields = (sources = []) => {
  const values = {};
  const meta = {};

  for (const source of Array.isArray(sources) ? sources : []) {
    const fileRole = normalizeParseFileRole(source?.file_role);
    const priority = rolePriority(fileRole);
    const fields = source?.fields && typeof source.fields === 'object' && !Array.isArray(source.fields)
      ? source.fields
      : {};

    for (const [key, rawValue] of Object.entries(fields)) {
      const value = nonEmptyText(rawValue);
      if (!value) continue;
      const current = meta[key];
      if (!current || priority >= current.priority) {
        values[key] = value;
        meta[key] = { role: fileRole, priority };
      }
    }
  }

  const resultSources = {};
  for (const [key, info] of Object.entries(meta)) {
    resultSources[key] = info.role;
  }

  return {
    values,
    sources: resultSources,
  };
};

const parseWorkspaceConstants = {
  SUPPORTED_PARSE_FILE_ROLES: Array.from(SUPPORTED_PARSE_FILE_ROLES),
  EXTRACTABLE_ARCHIVE_EXTS: Array.from(EXTRACTABLE_ARCHIVE_EXTS),
};

module.exports = {
  normalizeParseFileRole,
  classifyParseArchiveEntries,
  resolveSelectedSheetNames,
  mergeParsedProjectFields,
  extractArchiveDocumentsFromBuffer,
  extractSpreadsheetWorkbookFromBuffer,
  extractProjectFieldsFromText,
  classifyClauseType,
  classifyClauseSubtype,
  buildParseClauses,
  buildSpreadsheetTables,
  parseWorkspaceConstants,
};
