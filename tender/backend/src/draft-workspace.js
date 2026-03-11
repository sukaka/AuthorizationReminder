const normalizeText = (value) => String(value ?? '').trim();

const parseJson = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (Array.isArray(fallback) && Array.isArray(value)) return value;
  if (!Array.isArray(fallback) && value && typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(String(value));
    if (Array.isArray(fallback)) return Array.isArray(parsed) ? parsed : fallback;
    if (fallback && typeof fallback === 'object') return parsed && typeof parsed === 'object' ? parsed : fallback;
    return parsed;
  } catch {
    return fallback;
  }
};

const normalizeStringArray = (value) => {
  const items = Array.isArray(value) ? value : parseJson(value, []);
  return items
    .map((item) => normalizeText(item))
    .filter(Boolean);
};

const normalizeDraftSectionRows = (rows = []) => (Array.isArray(rows) ? rows : [])
  .map((item) => ({
    id: Number(item?.id || 0) || 0,
    section_title: normalizeText(item?.section_title) || '文档正文',
    paragraph_no: Number(item?.paragraph_no || 0) || 0,
    paragraph_text: normalizeText(item?.paragraph_text),
    requirement_ids: normalizeStringArray(item?.requirement_ids ?? item?.requirement_ids_json),
    evidence_ids: normalizeStringArray(item?.evidence_ids ?? item?.evidence_ids_json),
    score_item_ids: normalizeStringArray(item?.score_item_ids ?? item?.score_item_ids_json),
  }))
  .sort((a, b) => Number(a.paragraph_no || 0) - Number(b.paragraph_no || 0));

const normalizeArtifactGroup = (value, fallback = 'TECHNICAL') => {
  const text = normalizeText(value).toUpperCase();
  return text === 'BUSINESS' ? 'BUSINESS' : fallback;
};

const normalizeArtifactType = (value) => {
  const text = normalizeText(value).toUpperCase();
  if (text === 'RESPONSE_TABLE') return 'RESPONSE_TABLE';
  return 'DEVIATION_TABLE';
};

const normalizeArtifactRowPayload = (value = {}) => {
  const payload = value && typeof value === 'object' ? value : parseJson(value, {});
  const artifactType = normalizeArtifactType(payload?.artifact_type || payload?.artifactType);
  const rowNo = Number(payload?.row_no || 0) || 0;
  const base = {
    row_no: rowNo,
    parameter_key: normalizeText(payload?.parameter_key),
    tender_requirement: normalizeText(payload?.tender_requirement),
    satisfy_status: normalizeText(payload?.satisfy_status),
    satisfy_basis: normalizeText(payload?.satisfy_basis),
    evidence_source: normalizeText(payload?.evidence_source),
    risk_level: normalizeText(payload?.risk_level),
    risk_grade: normalizeText(payload?.risk_grade || payload?.risk_level),
    manual_review_required: Boolean(payload?.manual_review_required),
  };

  if (
    artifactType === 'RESPONSE_TABLE'
    || (
      !Object.prototype.hasOwnProperty.call(payload, 'bidder_response')
      && !Object.prototype.hasOwnProperty.call(payload, 'deviation_note')
      && Object.prototype.hasOwnProperty.call(payload, 'response_text')
    )
  ) {
    return {
      ...base,
      response_text: normalizeText(payload?.response_text),
    };
  }

  return {
    ...base,
    bidder_response: normalizeText(payload?.bidder_response),
    deviation_note: normalizeText(payload?.deviation_note) || '无偏离',
  };
};

const emptyDraftArtifacts = () => ({
  deviation_tables: {
    technical: [],
    business: [],
  },
  response_tables: {
    technical: [],
    business: [],
  },
});

const normalizeGeneratedArtifactRows = (rows = [], artifactType, artifactGroup) => (Array.isArray(rows) ? rows : [])
  .map((item, index) => normalizeArtifactRowPayload({
    row_no: index + 1,
    ...(item && typeof item === 'object' ? item : {}),
    artifact_type: artifactType,
    artifact_group: artifactGroup,
  }))
  .filter((item) => item.tender_requirement || item.bidder_response || item.response_text || item.evidence_source);

const buildDraftArtifactCollections = ({ persistedRows = [], generatedArtifacts = {} } = {}) => {
  const collections = emptyDraftArtifacts();
  const persistedMap = new Map();

  for (const row of Array.isArray(persistedRows) ? persistedRows : []) {
    const artifactType = normalizeArtifactType(row?.artifact_type);
    const artifactGroup = normalizeArtifactGroup(row?.artifact_group);
    const key = `${artifactType}:${artifactGroup}`;
    if (!persistedMap.has(key)) persistedMap.set(key, []);
    persistedMap.get(key).push(normalizeArtifactRowPayload({
      artifact_type: artifactType,
      ...(row?.row_json && typeof row.row_json === 'object' ? row.row_json : parseJson(row?.row_json, {})),
    }));
  }

  const generatedDeviation = generatedArtifacts?.deviation_tables && typeof generatedArtifacts.deviation_tables === 'object'
    ? generatedArtifacts.deviation_tables
    : {};
  const generatedResponse = generatedArtifacts?.response_tables && typeof generatedArtifacts.response_tables === 'object'
    ? generatedArtifacts.response_tables
    : {};

  const groups = [
    { type: 'DEVIATION_TABLE', key: 'deviation_tables', generated: generatedDeviation },
    { type: 'RESPONSE_TABLE', key: 'response_tables', generated: generatedResponse },
  ];

  for (const groupDef of groups) {
    for (const artifactGroup of ['TECHNICAL', 'BUSINESS']) {
      const key = `${groupDef.type}:${artifactGroup}`;
      const targetBucket = collections[groupDef.key][artifactGroup.toLowerCase()];
      if (persistedMap.has(key)) {
        collections[groupDef.key][artifactGroup.toLowerCase()] = persistedMap.get(key)
          .map((item, index) => ({ ...item, row_no: Number(item.row_no || index + 1) || index + 1 }))
          .sort((a, b) => Number(a.row_no || 0) - Number(b.row_no || 0));
        continue;
      }

      const fallbackRows = groupDef.generated?.[artifactGroup.toLowerCase()] || [];
      collections[groupDef.key][artifactGroup.toLowerCase()] = normalizeGeneratedArtifactRows(
        fallbackRows,
        groupDef.type,
        artifactGroup
      );
    }
  }

  return collections;
};

const buildDraftArtifactRowsForSave = ({ bidId, versionId, artifacts = {} } = {}) => {
  const normalizedBidId = Number(bidId || 0) || 0;
  const normalizedVersionId = Number(versionId || 0) || 0;
  const rows = [];
  const groups = [
    { type: 'DEVIATION_TABLE', key: 'deviation_tables' },
    { type: 'RESPONSE_TABLE', key: 'response_tables' },
  ];

  for (const groupDef of groups) {
    const groupSource = artifacts?.[groupDef.key] && typeof artifacts[groupDef.key] === 'object'
      ? artifacts[groupDef.key]
      : {};
    for (const artifactGroup of ['TECHNICAL', 'BUSINESS']) {
      const sourceRows = Array.isArray(groupSource?.[artifactGroup.toLowerCase()]) ? groupSource[artifactGroup.toLowerCase()] : [];
      sourceRows.forEach((item, index) => {
        const payload = normalizeArtifactRowPayload({
          artifact_type: groupDef.type,
          row_no: index + 1,
          ...(item && typeof item === 'object' ? item : {}),
        });
        if (!payload.tender_requirement && !payload.bidder_response && !payload.response_text && !payload.evidence_source) return;
        rows.push({
          bid_id: normalizedBidId,
          version_id: normalizedVersionId,
          artifact_type: groupDef.type,
          artifact_group: artifactGroup,
          row_no: index + 1,
          row_json: JSON.stringify({
            ...payload,
            row_no: index + 1,
          }),
        });
      });
    }
  }

  return rows;
};

module.exports = {
  normalizeDraftSectionRows,
  buildDraftArtifactCollections,
  buildDraftArtifactRowsForSave,
};
