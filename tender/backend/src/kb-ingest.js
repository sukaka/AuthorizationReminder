const normalizeText = (value) => String(value || '').trim();

const toFiniteNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const uniqueList = (values = []) => {
  const result = [];
  const seen = new Set();
  for (const item of Array.isArray(values) ? values : []) {
    const text = normalizeText(item);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
};

const normalizeTag = (value) => {
  const text = normalizeText(value);
  if (!text) return '';
  if (/^[\x00-\x7F]+$/.test(text)) {
    return text
      .toLowerCase()
      .replace(/[_\s/]+/g, '-')
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }
  return text;
};

const normalizeTagList = (values = []) => uniqueList(
  (Array.isArray(values) ? values : [])
    .map((item) => normalizeTag(item))
    .filter(Boolean)
);

const normalizeProjectType = (value) => {
  const text = normalizeText(value).toUpperCase();
  if (text === '服务' || text === '服务类') return 'SERVICE';
  if (text === '货物' || text === '产品' || text === '货物类' || text === '产品类') return 'PRODUCT';
  return text;
};

const normalizeResultStatus = (value) => {
  const text = normalizeText(value).toUpperCase();
  if (['WON', 'LOST', 'IN_PROGRESS', 'ABANDONED', 'UNKNOWN'].includes(text)) return text;
  return 'IN_PROGRESS';
};

const normalizeBidStatusTag = (value) => {
  const text = normalizeText(value).toLowerCase();
  if (!text) return '';
  return `status-${normalizeTag(text)}`;
};

const normalizeProjectField = (...values) => {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }
  return '';
};

const buildBaseTags = ({ bid = {}, projectType = '', industryType = '', extraTags = [] }) => normalizeTagList([
  'bid-project',
  normalizeBidStatusTag(bid.status),
  projectType ? `project-${projectType.toLowerCase()}` : '',
  industryType,
  ...(Array.isArray(extraTags) ? extraTags : []),
]);

const extractResponsePoints = (text) => {
  const source = normalizeText(text);
  if (!source) return [];
  const knownKeywords = [
    '响应时间',
    '服务机制',
    '本地化服务',
    '项目经理',
    '同类项目经验',
    '服务团队',
    '驻场服务',
    '售后服务方案',
    '原厂授权',
    '检测报告',
    '培训方案',
    '应急保障',
  ];
  const hits = knownKeywords.filter((item) => source.includes(item));
  if (hits.length) return uniqueList(hits);

  return uniqueList(
    source
      .replace(/^根据/u, '')
      .replace(/综合评分[。；;，,]?$/u, '')
      .split(/[、，,；;]/u)
      .map((item) => normalizeText(item).replace(/[。；;，,]+$/u, ''))
      .filter((item) => item.length >= 2)
      .slice(0, 4)
  );
};

const buildKbProjectRecord = ({ bid = {}, latestParseJob = {}, overrides = {}, user = {} }) => {
  const mergedFields = latestParseJob?.merged_fields && typeof latestParseJob.merged_fields === 'object'
    ? latestParseJob.merged_fields
    : {};
  const projectType = normalizeProjectType(overrides.project_type || mergedFields.project_type || '');
  const industryType = normalizeProjectField(overrides.industry_type, mergedFields.industry_type);
  const extraTags = Array.isArray(overrides.tags)
    ? overrides.tags
    : (typeof overrides.tags === 'string' ? overrides.tags.split(/[,\n]/u) : []);

  return {
    project_name: normalizeProjectField(overrides.project_name, mergedFields.project_name, bid.project_name, bid.title),
    project_no: normalizeProjectField(overrides.project_no, mergedFields.project_no, bid.bid_no),
    purchaser: normalizeProjectField(
      overrides.purchaser,
      mergedFields.purchaser,
      mergedFields.buyer_name,
      bid.customer_name
    ),
    industry_type: industryType || null,
    project_type: projectType || null,
    region: normalizeProjectField(overrides.region, mergedFields.region) || null,
    publish_date: normalizeProjectField(overrides.publish_date, mergedFields.publish_date) || null,
    bid_deadline: normalizeProjectField(overrides.bid_deadline, mergedFields.bid_deadline) || null,
    result_status: normalizeResultStatus(overrides.result_status || mergedFields.result_status || ''),
    bid_amount: toFiniteNumber(overrides.bid_amount ?? mergedFields.project_budget ?? mergedFields.bid_amount),
    source_bid_id: Number(bid.id || 0) || null,
    tags: buildBaseTags({
      bid,
      projectType,
      industryType,
      extraTags,
    }),
    remarks: normalizeProjectField(overrides.remarks, bid.summary) || null,
    created_by_id: Number(user.id || 0) || null,
    created_by_name: normalizeText(user.username) || null,
    updated_by_id: Number(user.id || 0) || null,
    updated_by_name: normalizeText(user.username) || null,
  };
};

const buildKbScoreItemRows = ({ kbProjectId, clauses = [] }) => {
  return (Array.isArray(clauses) ? clauses : [])
    .filter((item) => Number(item?.scoring_flag || 0) > 0 || Number(item?.score_value || 0) > 0)
    .map((item) => {
      const score = Number(item?.score_value || 0);
      return {
        kb_project_id: Number(kbProjectId),
        item_name: normalizeProjectField(item?.clause_title, item?.clause_text).slice(0, 255),
        full_score: Number.isFinite(score) ? score : 0,
        scoring_rule: normalizeText(item?.clause_text) || null,
        recommended_response_points: extractResponsePoints(item?.clause_text),
        priority_level: score >= 5 ? 'HIGH' : (score > 0 ? 'MEDIUM' : 'LOW'),
        source_clause_id: Number(item?.id || 0) || null,
      };
    });
};

const pushChunk = (target, chunk) => {
  const text = normalizeText(chunk?.chunk_text);
  if (!text) return;
  target.push({
    kb_project_id: Number(chunk.kb_project_id || 0) || null,
    asset_type: normalizeText(chunk.asset_type).toUpperCase() || 'GENERIC_ASSET',
    source_table: normalizeText(chunk.source_table),
    source_id: Number(chunk.source_id || 0) || null,
    section_name: normalizeText(chunk.section_name) || null,
    sub_section_name: normalizeText(chunk.sub_section_name) || null,
    chunk_type: normalizeText(chunk.chunk_type).toUpperCase() || 'PROJECT_SUMMARY',
    chunk_text: text,
    tags: normalizeTagList(chunk.tags),
    quality_score: Number(Number(chunk.quality_score || 0).toFixed(2)),
    reusable_flag: Number(chunk.reusable_flag || 0) > 0 ? 1 : 0,
    title: normalizeText(chunk.title) || null,
  });
};

const buildProjectSummaryText = (project = {}) => uniqueList([
  normalizeText(project.project_name),
  normalizeText(project.purchaser),
  normalizeText(project.remarks),
]).join('；');

const buildChunkProjectTags = (project = {}) => normalizeTagList([
  ...(Array.isArray(project.tags) ? project.tags : []),
  project.project_type ? `project-${String(project.project_type).toLowerCase()}` : '',
  project.industry_type,
]);

const buildKbAssetChunks = ({ kbProjectId, project = {}, clauses = [], sections = [], tables = [], attachments = [] }) => {
  const chunks = [];
  const projectTags = buildChunkProjectTags(project);

  pushChunk(chunks, {
    kb_project_id: kbProjectId,
    asset_type: 'PROJECT',
    source_table: 'kb_projects',
    source_id: Number(project.id || kbProjectId),
    chunk_type: 'PROJECT_SUMMARY',
    chunk_text: buildProjectSummaryText(project),
    tags: projectTags,
    quality_score: 0.86,
    reusable_flag: 1,
    title: project.project_name,
  });

  for (const clause of Array.isArray(clauses) ? clauses : []) {
    const clauseTags = normalizeTagList([
      ...projectTags,
      normalizeText(clause?.clause_type) ? `clause-${String(clause.clause_type).toLowerCase()}` : '',
      Number(clause?.scoring_flag || 0) > 0 ? 'clause-scoring' : '',
      Number(clause?.mandatory_flag || 0) > 0 ? 'clause-mandatory' : '',
    ]);
    pushChunk(chunks, {
      kb_project_id: kbProjectId,
      asset_type: 'TENDER_CLAUSE',
      source_table: 'kb_tender_clauses',
      source_id: Number(clause?.id || 0),
      section_name: normalizeText(clause?.clause_title) || '条款',
      chunk_type: 'CLAUSE_TEXT',
      chunk_text: normalizeText(clause?.clause_text),
      tags: clauseTags,
      quality_score: Number(clause?.scoring_flag || 0) > 0 || Number(clause?.mandatory_flag || 0) > 0 ? 0.92 : 0.84,
      reusable_flag: 1,
      title: clause?.clause_title,
    });
  }

  for (const section of Array.isArray(sections) ? sections : []) {
    pushChunk(chunks, {
      kb_project_id: kbProjectId,
      asset_type: 'SECTION_ASSET',
      source_table: 'kb_section_assets',
      source_id: Number(section?.id || 0),
      section_name: normalizeText(section?.section_title) || '正文',
      chunk_type: 'SECTION_PARAGRAPH',
      chunk_text: normalizeText(section?.paragraph_text || section?.content),
      tags: [...projectTags, normalizeText(section?.section_title) ? `section-${normalizeTag(section.section_title)}` : 'section-paragraph'],
      quality_score: 0.9,
      reusable_flag: 1,
      title: section?.section_title,
    });
  }

  for (const table of Array.isArray(tables) ? tables : []) {
    pushChunk(chunks, {
      kb_project_id: kbProjectId,
      asset_type: 'PARSE_TABLE',
      source_table: 'tender_bid_parse_tables',
      source_id: Number(table?.id || 0),
      section_name: normalizeText(table?.table_name) || '表格',
      chunk_type: 'TABLE_SUMMARY',
      chunk_text: normalizeText(table?.summary_text) || normalizeText((Array.isArray(table?.header) ? table.header : []).join(' | ')),
      tags: [...projectTags, 'table-summary'],
      quality_score: 0.82,
      reusable_flag: 1,
      title: table?.table_name,
    });
    (Array.isArray(table?.rows) ? table.rows : []).forEach((row, index) => {
      const line = (Array.isArray(row) ? row : []).map((item) => normalizeText(item)).filter(Boolean).join(' | ');
      pushChunk(chunks, {
        kb_project_id: kbProjectId,
        asset_type: 'PARSE_TABLE',
        source_table: 'tender_bid_parse_tables',
        source_id: Number(table?.id || 0),
        section_name: normalizeText(table?.table_name) || '表格',
        sub_section_name: `row-${index + 1}`,
        chunk_type: 'TABLE_ROW',
        chunk_text: line,
        tags: [...projectTags, 'table-row'],
        quality_score: 0.74,
        reusable_flag: 1,
        title: table?.table_name,
      });
    });
  }

  for (const attachment of Array.isArray(attachments) ? attachments : []) {
    const assetType = normalizeText(attachment?.asset_type).toUpperCase() || 'OTHER';
    pushChunk(chunks, {
      kb_project_id: kbProjectId,
      asset_type: assetType,
      source_table: 'tender_assets',
      source_id: Number(attachment?.id || 0),
      section_name: normalizeText(attachment?.original_file_name) || '附件',
      chunk_type: 'ATTACHMENT_OCR',
      chunk_text: normalizeText(attachment?.ocr_text),
      tags: [...projectTags, `attachment-${String(assetType).toLowerCase()}`, 'ocr-evidence'],
      quality_score: 0.8,
      reusable_flag: 1,
      title: attachment?.original_file_name,
    });
  }

  return chunks;
};

module.exports = {
  buildKbProjectRecord,
  buildKbScoreItemRows,
  buildKbAssetChunks,
  normalizeTagList,
  normalizeProjectType,
  normalizeResultStatus,
};
