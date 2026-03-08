const trimText = (value) => (value === undefined || value === null ? '' : String(value).trim());

const firstNonEmpty = (...values) => {
  for (const value of values) {
    const text = trimText(value);
    if (text) return text;
  }
  return '';
};

const toArray = (value) => {
  if (Array.isArray(value)) return value.filter((item) => item !== undefined && item !== null);
  const text = trimText(value);
  return text ? [text] : [];
};

const toJson = (value) => JSON.stringify(value ?? null);

const parseJsonObject = (value) => {
  if (!value || typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const buildCode = (prefix, type, index) => `${prefix}-${type}-${String(index).padStart(4, '0')}`;
const buildClauseId = (index) => `C-${String(index).padStart(6, '0')}`;

const normalizeRiskLevel = (value, fallback = 'MEDIUM') => {
  const text = trimText(value).toUpperCase();
  if (['HIGH', 'MEDIUM', 'LOW'].includes(text)) return text;
  if (text === '高' || text === '高风险') return 'HIGH';
  if (text === '中' || text === '中风险') return 'MEDIUM';
  if (text === '低' || text === '低风险') return 'LOW';
  return fallback;
};

const normalizeBoolean = (value, fallback = false) => {
  if (value === true || value === false) return value;
  const text = trimText(value).toLowerCase();
  if (['1', 'true', 'yes', 'y', '是'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', '否'].includes(text)) return false;
  return fallback;
};

const normalizeRequirementType = (value) => {
  const text = trimText(value).toUpperCase();
  if (!text) return 'BUSINESS';
  if (['QUALIFICATION', 'INVALID_BID', 'BUSINESS', 'TECH_PARAM', 'SCORING', 'FORMAT', 'ATTACHMENT'].includes(text)) return text;
  return 'BUSINESS';
};

const inferClauseType = ({ requirementType, title = '', source = {} }) => {
  const sourceType = trimText(source?.clause_type).toUpperCase();
  if (sourceType) return sourceType;

  const titleText = trimText(title);
  if (requirementType === 'SCORING') return 'SCORING_ITEM';
  if (requirementType === 'INVALID_BID') return 'INVALID_BID_CLAUSE';
  if (requirementType === 'TECH_PARAM') return 'TECH_PARAMETER';
  if (requirementType === 'FORMAT') return 'FORMAT_REQUIREMENT';
  if (requirementType === 'ATTACHMENT') return 'ATTACHMENT_REQUIREMENT';
  if (requirementType === 'QUALIFICATION') return 'QUALIFICATION_REQUIREMENT';
  if (/付款/.test(titleText)) return 'PAYMENT_TERM';
  if (/违约/.test(titleText)) return 'LIABILITY_TERM';
  return 'BUSINESS_TERM';
};

const inferResponseMode = ({ requirementType }) => {
  if (requirementType === 'SCORING') return 'AI_DRAFT';
  if (requirementType === 'TECH_PARAM') return 'PARAM_COMPARE';
  if (requirementType === 'BUSINESS') return 'EXACT_QUOTE';
  if (requirementType === 'FORMAT' || requirementType === 'INVALID_BID') return 'TEMPLATE_FILL';
  if (requirementType === 'QUALIFICATION' || requirementType === 'ATTACHMENT') return 'EVIDENCE_BINDING';
  return 'MANUAL_ONLY';
};

const inferRoute = ({ requirementType, responseMode }) => {
  const mode = trimText(responseMode).toUpperCase();
  if (mode === 'AI_DRAFT') return { target_module: 'SCORE_OPTIMIZER', route_key: 'SCORING_DRAFT' };
  if (mode === 'PARAM_COMPARE') return { target_module: 'DEVIATION_GENERATOR', route_key: 'PARAM_COMPARE' };
  if (mode === 'EVIDENCE_BINDING') return { target_module: 'EVIDENCE_MATCHER', route_key: `${requirementType}_EVIDENCE` };
  if (mode === 'TEMPLATE_FILL') return { target_module: 'WORD_ASSEMBLER', route_key: `${requirementType}_TEMPLATE` };
  if (mode === 'EXACT_QUOTE') return { target_module: 'SECTION_GENERATOR', route_key: `${requirementType}_QUOTE` };
  return { target_module: 'RISK_CHECKER', route_key: `${requirementType}_MANUAL` };
};

const extractSourceLocation = (source = {}) => {
  const sourceRef = source?.source_location && typeof source.source_location === 'object'
    ? source.source_location
    : (source?.source_reference && typeof source.source_reference === 'object'
      ? source.source_reference
      : {});
  return {
    page_no: firstNonEmpty(sourceRef.page_no, sourceRef.page_number),
    line_no: firstNonEmpty(sourceRef.line_no, sourceRef.line_number),
    table_no: firstNonEmpty(sourceRef.table_no, sourceRef.table_index),
    paragraph_no: firstNonEmpty(sourceRef.paragraph_no, sourceRef.paragraph_index),
  };
};

const buildClauseContractFromRequirementRow = (row, index) => {
  const source = row && typeof row === 'object' ? (
    row.source_json && typeof row.source_json === 'string'
      ? parseJsonObject(row.source_json)
      : (row.source_json && typeof row.source_json === 'object' ? row.source_json : row)
  ) : {};
  const existing = source?.clause_contract_v2 && typeof source.clause_contract_v2 === 'object'
    ? source.clause_contract_v2
    : source;

  const requirementType = normalizeRequirementType(firstNonEmpty(existing.requirement_type, row?.requirement_type));
  const responseMode = trimText(existing.response_mode).toUpperCase() || inferResponseMode({ requirementType });
  const route = existing.route && typeof existing.route === 'object'
    ? {
      target_module: trimText(existing.route.target_module),
      route_key: trimText(existing.route.route_key),
    }
    : inferRoute({ requirementType, responseMode });

  const clauseId = firstNonEmpty(existing.clause_id, row?.requirement_code, buildClauseId(index));
  const clauseType = inferClauseType({
    requirementType,
    title: firstNonEmpty(existing.title, row?.title),
    source: existing,
  });

  const chapterTitle = firstNonEmpty(existing.chapter_title, row?.section_title, existing?.source_reference?.chapter);
  const chapterKey = firstNonEmpty(existing.chapter_key, row?.section_key);
  const sourceText = firstNonEmpty(
    existing.source_text,
    existing.clause_content,
    row?.requirement_text,
    row?.title
  );

  const mandatoryFallback = new Set(['QUALIFICATION', 'INVALID_BID', 'FORMAT', 'ATTACHMENT']).has(requirementType);
  const scoringRelatedFallback = requirementType === 'SCORING';
  const needAttachmentFallback = new Set(['QUALIFICATION', 'ATTACHMENT']).has(requirementType);
  const needExactQuoteFallback = new Set(['BUSINESS', 'INVALID_BID', 'FORMAT']).has(requirementType);
  const needParamCompareFallback = requirementType === 'TECH_PARAM';

  return {
    clause_id: clauseId,
    requirement_code: firstNonEmpty(row?.requirement_code, existing.requirement_code, clauseId),
    job_id: Number(firstNonEmpty(existing.job_id, row?.job_id)) || 0,
    bid_category: firstNonEmpty(existing.bid_category, row?.bid_category),
    chapter_key: chapterKey,
    chapter_title: chapterTitle,
    source_location: extractSourceLocation(existing),
    source_text: sourceText,
    normalized_text: firstNonEmpty(existing.normalized_text, sourceText),
    clause_type: clauseType,
    requirement_type: requirementType,
    mandatory: normalizeBoolean(existing.mandatory, normalizeBoolean(existing.is_mandatory, mandatoryFallback)),
    scoring_related: normalizeBoolean(existing.scoring_related, scoringRelatedFallback),
    full_score: Number(firstNonEmpty(existing.full_score, row?.full_score)) || 0,
    response_mode: responseMode,
    need_attachment: normalizeBoolean(existing.need_attachment, needAttachmentFallback),
    need_exact_quote: normalizeBoolean(existing.need_exact_quote, needExactQuoteFallback),
    need_parameter_compare: normalizeBoolean(existing.need_parameter_compare, needParamCompareFallback),
    risk_level: normalizeRiskLevel(firstNonEmpty(existing.risk_level, row?.risk_level), requirementType === 'INVALID_BID' ? 'HIGH' : 'MEDIUM'),
    response_strategy: firstNonEmpty(existing.response_strategy, row?.suggestion_text),
    route: {
      target_module: firstNonEmpty(route.target_module, inferRoute({ requirementType, responseMode }).target_module),
      route_key: firstNonEmpty(route.route_key, inferRoute({ requirementType, responseMode }).route_key),
    },
    audit: {
      extract_model: firstNonEmpty(existing?.audit?.extract_model, existing.extract_model),
      extract_confidence: Number(firstNonEmpty(existing?.audit?.extract_confidence, existing.extract_confidence)) || 0,
      manual_confirmed: normalizeBoolean(existing?.audit?.manual_confirmed, false),
    },
  };
};

const buildClauseRegistryV2 = ({ requirements = [] }) =>
  toArray(requirements)
    .filter((item) => item && typeof item === 'object')
    .map((row, index) => buildClauseContractFromRequirementRow(row, index + 1));

const normalizeToken = (value) =>
  trimText(value)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[：:（）()【】\[\]、，,。.!?？;；]/g, '');

const inferTemplateSlotByChapterTitle = (title) => {
  const text = trimText(title);
  if (!text) return '';
  if (/封面/.test(text)) return 'COVER_CONTENT';
  if (/目录/.test(text)) return 'TOC_CONTENT';
  if (/报价|偏离/.test(text)) return 'QUOTATION_VOLUME_CONTENT';
  if (/技术|服务|采购需求|实施/.test(text)) return 'TECHNICAL_VOLUME_CONTENT';
  if (/商务|资格|合规/.test(text)) return 'BUSINESS_VOLUME_CONTENT';
  if (/附录|附件|格式/.test(text)) return 'APPENDIX_INDEX_CONTENT';
  return '';
};

const inferRequirementTypeByChapterTitle = (title) => {
  const text = trimText(title);
  if (/评标|评分/.test(text)) return 'SCORING';
  if (/技术|参数|采购需求|实施/.test(text)) return 'TECH_PARAM';
  if (/商务/.test(text)) return 'BUSINESS';
  if (/资格|资质/.test(text)) return 'QUALIFICATION';
  if (/格式|目录|封面|附录|附件/.test(text)) return 'FORMAT';
  return '';
};

const matchClauseToChapter = (clause, chapterTitle) => {
  const chapterToken = normalizeToken(chapterTitle);
  if (!chapterToken) return false;
  const clauseChapterToken = normalizeToken(clause?.chapter_title);
  if (clauseChapterToken && (chapterToken.includes(clauseChapterToken) || clauseChapterToken.includes(chapterToken))) return true;
  const guessedType = inferRequirementTypeByChapterTitle(chapterTitle);
  if (guessedType && guessedType === trimText(clause?.requirement_type).toUpperCase()) return true;
  return false;
};

const buildClauseRouteBuckets = ({ clauses = [] }) => {
  const rows = buildClauseRegistryV2({ requirements: clauses });
  const map = {};
  for (const clause of rows) {
    const key = firstNonEmpty(clause?.route?.target_module, 'UNKNOWN');
    if (!map[key]) map[key] = [];
    map[key].push(clause);
  }
  return map;
};

const buildSectionLinksFromClauseRegistry = ({ clauses = [], chapters = [] }) => {
  const normalizedClauses = buildClauseRegistryV2({ requirements: clauses });
  const links = {};
  for (const chapter of toArray(chapters)) {
    const title = trimText(chapter?.title);
    if (!title) continue;
    const matched = normalizedClauses.filter((clause) => matchClauseToChapter(clause, title));
    if (!matched.length) continue;
    const requirementIds = Array.from(new Set(matched.map((item) => trimText(item.clause_id)).filter(Boolean)));
    const scoreItemIds = Array.from(new Set(
      matched
        .filter((item) => item.scoring_related || trimText(item.requirement_type).toUpperCase() === 'SCORING')
        .map((item) => trimText(item.clause_id))
        .filter(Boolean)
    ));
    links[title] = {
      requirement_ids: requirementIds,
      evidence_ids: [],
      score_item_ids: scoreItemIds,
      template_slot: inferTemplateSlotByChapterTitle(title),
    };
  }
  return links;
};

const normalizeChapterRows = (chapters = []) =>
  toArray(chapters)
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      ...item,
      title: trimText(item.title),
      content: Array.isArray(item.content)
        ? item.content.map((line) => trimText(line)).filter(Boolean)
        : normalizeChapterParagraphs(item.content),
    }));

const findChapterIndexByTitle = (chapters, title) => {
  const target = normalizeToken(title);
  if (!target) return -1;
  return chapters.findIndex((item) => {
    const current = normalizeToken(item?.title);
    if (!current) return false;
    return current.includes(target) || target.includes(current);
  });
};

const selectChapterIndexByClause = (chapters, clause) => {
  const chapterTitle = trimText(clause?.chapter_title);
  const chapterByName = findChapterIndexByTitle(chapters, chapterTitle);
  if (chapterByName >= 0) return chapterByName;

  const requirementType = trimText(clause?.requirement_type).toUpperCase();
  if (requirementType === 'SCORING') {
    const index = chapters.findIndex((item) => /评标|评分/.test(trimText(item?.title)));
    if (index >= 0) return index;
  }
  if (requirementType === 'TECH_PARAM') {
    const index = chapters.findIndex((item) => /偏离|技术|采购需求/.test(trimText(item?.title)));
    if (index >= 0) return index;
  }
  if (requirementType === 'BUSINESS') {
    const index = chapters.findIndex((item) => /商务|投标人须知/.test(trimText(item?.title)));
    if (index >= 0) return index;
  }
  if (requirementType === 'QUALIFICATION' || requirementType === 'ATTACHMENT') {
    const index = chapters.findIndex((item) => /资格|投标人须知|附件/.test(trimText(item?.title)));
    if (index >= 0) return index;
  }
  return chapters.length ? 0 : -1;
};

const ensureChapter = (chapters, preferredTitle = '') => {
  const title = trimText(preferredTitle) || '路由补充项';
  const index = findChapterIndexByTitle(chapters, title);
  if (index >= 0) return index;
  chapters.push({ title, content: [] });
  return chapters.length - 1;
};

const appendUniqueLine = (chapter, line) => {
  const normalized = trimText(line);
  if (!normalized) return false;
  const exists = toArray(chapter?.content).some((item) => trimText(item) === normalized);
  if (exists) return false;
  chapter.content = [...toArray(chapter.content), normalized];
  return true;
};

const executeClauseRoutes = ({ clauses = [], chapters = [] }) => {
  const normalizedClauses = buildClauseRegistryV2({ requirements: clauses });
  const chapterRows = normalizeChapterRows(chapters);
  const responseModeCounts = {};
  const appliedItems = [];
  let appliedChanges = 0;

  const appendByClause = ({ clause, line, chapterHint }) => {
    let index = findChapterIndexByTitle(chapterRows, chapterHint);
    if (index < 0) index = selectChapterIndexByClause(chapterRows, clause);
    if (index < 0) index = ensureChapter(chapterRows, chapterHint || clause?.chapter_title || '路由补充项');
    const chapter = chapterRows[index];
    const appended = appendUniqueLine(chapter, line);
    if (!appended) return;
    appliedChanges += 1;
    if (appliedItems.length < 80) {
      appliedItems.push({
        clause_id: trimText(clause?.clause_id),
        response_mode: trimText(clause?.response_mode).toUpperCase(),
        section_title: trimText(chapter?.title),
      });
    }
  };

  for (const clause of normalizedClauses) {
    const mode = trimText(clause?.response_mode).toUpperCase() || 'MANUAL_ONLY';
    responseModeCounts[mode] = Number(responseModeCounts[mode] || 0) + 1;

    if (mode === 'EXACT_QUOTE') {
      const sourceText = trimText(clause?.source_text || clause?.normalized_text || clause?.response_strategy);
      if (!sourceText) continue;
      appendByClause({
        clause,
        line: `【原文引用】${sourceText}`,
        chapterHint: firstNonEmpty(clause?.chapter_title, '商务响应'),
      });
      continue;
    }

    if (mode === 'PARAM_COMPARE') {
      const compareText = firstNonEmpty(clause?.normalized_text, clause?.source_text, clause?.response_strategy);
      if (!compareText) continue;
      appendByClause({
        clause,
        line: `【参数比对项】${compareText}｜响应：满足/偏离待确认`,
        chapterHint: '偏离表',
      });
      continue;
    }

    if (mode === 'EVIDENCE_BINDING') {
      const bindText = firstNonEmpty(clause?.title, clause?.normalized_text, clause?.source_text);
      if (!bindText) continue;
      appendByClause({
        clause,
        line: `【材料绑定项】${bindText}（请绑定资质/业绩/证书证据）`,
        chapterHint: firstNonEmpty(clause?.chapter_title, '附件资料'),
      });
    }
  }

  return {
    chapters: chapterRows,
    response_mode_counts: responseModeCounts,
    applied_changes: appliedChanges,
    applied_items: appliedItems,
  };
};

const appendClauseContractToRequirementRows = (rows = []) =>
  toArray(rows).map((row, index) => {
    const sourceRaw = row?.source_json && typeof row.source_json === 'string'
      ? parseJsonObject(row.source_json)
      : (row?.source_json && typeof row.source_json === 'object' ? row.source_json : {});
    const clauseContract = buildClauseContractFromRequirementRow({ ...row, source_json: sourceRaw }, index + 1);
    return {
      ...row,
      source_json: toJson({
        ...sourceRaw,
        clause_contract_v2: clauseContract,
      }),
    };
  });

const buildRequirementRows = ({
  jobId,
  bidCategory = '',
  finalJson = {},
  scoringItems = [],
  stage1RiskClauses = [],
  tableSummaries = [],
}) => {
  const rows = [];
  const nextRow = (requirementType, payload = {}) => {
    rows.push({
      job_id: Number(jobId) || 0,
      bid_category: trimText(bidCategory),
      requirement_type: normalizeRequirementType(requirementType),
      requirement_code: buildCode('REQ', normalizeRequirementType(requirementType), rows.length + 1),
      ...payload,
    });
  };

  scoringItems.forEach((item) => {
    nextRow('SCORING', {
      title: trimText(item.title),
      section_key: trimText(item.section_key),
      section_title: trimText(item.section_title),
      requirement_text: trimText(item.evidence || item.suggestion || item.title),
      suggestion_text: trimText(item.suggestion),
      source_json: toJson(item),
    });
  });

  stage1RiskClauses.forEach((item) => {
    nextRow('INVALID_BID', {
      title: trimText(item.clause_type) || '无效标条款',
      requirement_text: trimText(item.clause_content),
      risk_level: trimText(item.risk_level),
      section_title: trimText(item?.source_reference?.chapter),
      source_json: toJson(item),
    });
  });

  const qualificationRules = finalJson?.bidder_qualification_requirements || {};
  [
    ...toArray(qualificationRules.qualification_review_items),
    ...toArray(qualificationRules.compliance_review_items),
    ...toArray(qualificationRules.other_requirements),
  ].forEach((text) => {
    const normalized = trimText(text);
    if (!normalized) return;
    nextRow('QUALIFICATION', {
      title: '资格要求',
      requirement_text: normalized,
      source_json: toJson({ title: '资格要求', text: normalized }),
    });
  });

  const businessRules = finalJson?.business_performance_rules || {};
  [
    ['付款条款', businessRules.payment_terms],
    ['违约责任', businessRules.liability_for_breach_of_contract],
  ].forEach(([title, text]) => {
    const normalized = trimText(text);
    if (!normalized) return;
    nextRow('BUSINESS', {
      title,
      requirement_text: normalized,
      source_json: toJson({ title, text: normalized }),
    });
  });

  toArray(businessRules.other_business_rules).forEach((text) => {
    const normalized = trimText(text);
    if (!normalized) return;
    nextRow('BUSINESS', {
      title: '其他商务要求',
      requirement_text: normalized,
      source_json: toJson({ title: '其他商务要求', text: normalized }),
    });
  });

  const serviceDetail = finalJson?.service_procurement_detail || {};
  [
    ...toArray(serviceDetail.service_implementation_requirements),
    ...toArray(serviceDetail.after_sales_requirements),
  ].forEach((text) => {
    const normalized = trimText(text);
    if (!normalized) return;
    nextRow('TECH_PARAM', {
      title: '服务要求',
      requirement_text: normalized,
      source_json: toJson({ title: '服务要求', text: normalized }),
    });
  });

  tableSummaries.forEach((item) => {
    const summary = trimText(item.summary);
    if (!summary) return;
    nextRow('TECH_PARAM', {
      title: trimText(item.section_title || item.section_key || '技术参数表'),
      section_key: trimText(item.section_key),
      section_title: trimText(item.section_title),
      requirement_text: summary,
      source_json: toJson(item),
    });
  });

  return appendClauseContractToRequirementRows(rows);
};

const buildEvidenceRows = ({ bidId, librarySnapshot = {} }) => {
  const rows = [];
  const nextRow = (evidenceType, payload = {}) => {
    rows.push({
      bid_id: Number(bidId) || 0,
      evidence_type: evidenceType,
      evidence_code: buildCode('EVI', evidenceType, rows.length + 1),
      ...payload,
    });
  };

  const company = librarySnapshot.company || {};
  if (Object.keys(company).length > 0) {
    nextRow('COMPANY', {
      title: trimText(company.company_name) || '企业信息',
      evidence_text: [trimText(company.company_name), trimText(company.uscc)].filter(Boolean).join(' / '),
      source_json: toJson(company),
    });
  }

  toArray(librarySnapshot.qualifications).forEach((item) => {
    if (!item || typeof item !== 'object') return;
    nextRow('QUALIFICATION', {
      title: trimText(item.title) || '资质证书',
      evidence_text: [trimText(item.title), trimText(item.certificate_no)].filter(Boolean).join(' / '),
      library_record_id: Number(item.id) || null,
      source_json: toJson(item),
    });
  });

  toArray(librarySnapshot.finance).forEach((item) => {
    if (!item || typeof item !== 'object') return;
    nextRow('FINANCE', {
      title: trimText(item.info_name) || '财务材料',
      evidence_text: [trimText(item.info_type), trimText(item.info_name)].filter(Boolean).join(' / '),
      library_record_id: Number(item.id) || null,
      source_json: toJson(item),
    });
  });

  toArray(librarySnapshot.performance).forEach((item) => {
    if (!item || typeof item !== 'object') return;
    nextRow('PERFORMANCE', {
      title: trimText(item.project_name) || '业绩材料',
      evidence_text: [trimText(item.project_name), trimText(item.party_a_name)].filter(Boolean).join(' / '),
      library_record_id: Number(item.id) || null,
      source_json: toJson(item),
    });
  });

  const pushPersonnelRow = (item) => {
    if (!item || typeof item !== 'object') return;
    const name = trimText(item.name);
    const position = trimText(item.position);
    const extra = trimText(item.qualification_cert);
    if (!name && !position && !extra) return;
    nextRow('PERSONNEL', {
      title: name || position || '人员材料',
      evidence_text: [name, position, extra].filter(Boolean).join(' / '),
      library_record_id: Number(item.id) || null,
      source_json: toJson(item),
    });
  };

  toArray(librarySnapshot.personnel_list).forEach(pushPersonnelRow);
  pushPersonnelRow(librarySnapshot?.personnel?.legal);
  pushPersonnelRow(librarySnapshot?.personnel?.agent);

  return rows;
};

const normalizeChapterParagraphs = (content) => {
  if (Array.isArray(content)) return content.map((item) => trimText(item)).filter(Boolean);
  return String(content || '')
    .split(/\n+/)
    .map((item) => trimText(item))
    .filter(Boolean);
};

const buildDraftSectionRows = ({
  bidId,
  versionId,
  chapters = [],
  sectionLinks = {},
}) => {
  const rows = [];
  chapters.forEach((chapter) => {
    const sectionTitle = trimText(chapter?.title);
    const paragraphs = normalizeChapterParagraphs(chapter?.content);
    const linkInfo = sectionLinks?.[sectionTitle] || {};
    paragraphs.forEach((paragraph, index) => {
      rows.push({
        bid_id: Number(bidId) || 0,
        version_id: Number(versionId) || 0,
        section_title: sectionTitle,
        paragraph_no: index + 1,
        paragraph_text: paragraph,
        template_slot: trimText(linkInfo.template_slot),
        requirement_ids_json: toJson(toArray(linkInfo.requirement_ids)),
        evidence_ids_json: toJson(toArray(linkInfo.evidence_ids)),
        score_item_ids_json: toJson(toArray(linkInfo.score_item_ids)),
      });
    });
  });
  return rows;
};

module.exports = {
  buildRequirementRows,
  buildClauseRegistryV2,
  buildClauseRouteBuckets,
  buildSectionLinksFromClauseRegistry,
  executeClauseRoutes,
  buildEvidenceRows,
  buildDraftSectionRows,
};
