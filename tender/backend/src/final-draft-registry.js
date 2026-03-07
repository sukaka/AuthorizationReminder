const trimText = (value) => (value === undefined || value === null ? '' : String(value).trim());

const toArray = (value) => {
  if (Array.isArray(value)) return value.filter((item) => item !== undefined && item !== null);
  const text = trimText(value);
  return text ? [text] : [];
};

const toJson = (value) => JSON.stringify(value ?? null);

const buildCode = (prefix, type, index) => `${prefix}-${type}-${String(index).padStart(4, '0')}`;

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
      requirement_type: requirementType,
      requirement_code: buildCode('REQ', requirementType, rows.length + 1),
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

  return rows;
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
  buildEvidenceRows,
  buildDraftSectionRows,
};
