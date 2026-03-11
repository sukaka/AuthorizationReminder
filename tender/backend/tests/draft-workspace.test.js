import { describe, expect, it } from 'vitest';

import draftWorkspace from '../src/draft-workspace.js';

const {
  normalizeDraftSectionRows,
  buildDraftArtifactCollections,
  buildDraftArtifactRowsForSave,
} = draftWorkspace;

describe('draft workspace helpers', () => {
  it('normalizes draft section rows into stable editable records', () => {
    const rows = normalizeDraftSectionRows([
      {
        id: 12,
        section_title: '售后服务方案',
        paragraph_no: '2',
        paragraph_text: '提供 7x24 小时响应。',
        requirement_ids_json: '["REQ-1","REQ-2"]',
        evidence_ids_json: '["EVI-1"]',
        score_item_ids_json: '["SCORE-1"]',
      },
      {
        id: 13,
        section_title: '',
        paragraph_no: 3,
        paragraph_text: '补充原厂协同机制。',
        requirement_ids_json: 'not-json',
        evidence_ids_json: null,
        score_item_ids_json: '[]',
      },
    ]);

    expect(rows).toEqual([
      {
        id: 12,
        section_title: '售后服务方案',
        paragraph_no: 2,
        paragraph_text: '提供 7x24 小时响应。',
        requirement_ids: ['REQ-1', 'REQ-2'],
        evidence_ids: ['EVI-1'],
        score_item_ids: ['SCORE-1'],
      },
      {
        id: 13,
        section_title: '文档正文',
        paragraph_no: 3,
        paragraph_text: '补充原厂协同机制。',
        requirement_ids: [],
        evidence_ids: [],
        score_item_ids: [],
      },
    ]);
  });

  it('prefers persisted draft artifact rows and falls back to generated artifacts by group', () => {
    const collections = buildDraftArtifactCollections({
      persistedRows: [
        {
          artifact_type: 'DEVIATION_TABLE',
          artifact_group: 'TECHNICAL',
          row_no: 1,
          row_json: JSON.stringify({
            tender_requirement: 'CPU 主频不低于 3.0GHz',
            parameter_key: 'PARAM_3_2_1_CPU_MAIN_FREQ',
            bidder_response: '满足，详见产品参数表',
            deviation_note: '无偏离',
            satisfy_basis: '依据投标响应“满足”和偏离说明“无偏离”判定为满足。',
            evidence_source: '产品参数表',
            risk_grade: 'LOW',
          }),
        },
      ],
      generatedArtifacts: {
        deviation_tables: {
          technical: [
            {
              tender_requirement: '旧技术偏离行',
              bidder_response: '旧响应',
              deviation_note: '旧偏离',
            },
          ],
          business: [
            {
              tender_requirement: '需提供原厂授权',
              bidder_response: '已提供授权函',
              deviation_note: '无偏离',
            },
          ],
        },
        response_tables: {
          technical: [
            {
              tender_requirement: '支持双机热备',
              parameter_key: 'PARAM_1_双机热备',
              response_text: '满足，所投产品支持双机热备。',
              satisfy_basis: '依据参数要求与响应文本判定为满足。',
              evidence_source: '产品参数表第12页',
              risk_grade: 'LOW',
            },
          ],
          business: [],
        },
      },
    });

    expect(collections.deviation_tables.technical).toEqual([
      {
        row_no: 1,
        tender_requirement: 'CPU 主频不低于 3.0GHz',
        parameter_key: 'PARAM_3_2_1_CPU_MAIN_FREQ',
        bidder_response: '满足，详见产品参数表',
        deviation_note: '无偏离',
        satisfy_status: '',
        satisfy_basis: '依据投标响应“满足”和偏离说明“无偏离”判定为满足。',
        evidence_source: '产品参数表',
        risk_level: '',
        risk_grade: 'LOW',
        manual_review_required: false,
      },
    ]);
    expect(collections.deviation_tables.business).toHaveLength(1);
    expect(collections.response_tables.technical[0].parameter_key).toBe('PARAM_1_双机热备');
    expect(collections.response_tables.technical[0].risk_grade).toBe('LOW');
    expect(collections.response_tables.business).toEqual([]);
  });

  it('flattens editable draft artifact groups into db persistence rows', () => {
    const rows = buildDraftArtifactRowsForSave({
      bidId: 91,
      versionId: 7,
      artifacts: {
        deviation_tables: {
          technical: [
            {
              tender_requirement: '双机热备',
              parameter_key: 'PARAM_3_2_1_双机热备',
              bidder_response: '满足',
              deviation_note: '无偏离',
              satisfy_basis: '依据投标响应“满足”和偏离说明“无偏离”判定为满足。',
              evidence_source: '产品参数表',
              risk_grade: 'LOW',
            },
          ],
          business: [],
        },
        response_tables: {
          technical: [],
          business: [
            {
              tender_requirement: '提供原厂授权',
              parameter_key: 'PARAM_BUS_1_提供原厂授权',
              response_text: '已提供原厂授权函。',
              satisfy_basis: '依据响应文本判定为满足。',
              evidence_source: '附件-授权函',
              risk_grade: 'LOW',
            },
          ],
        },
      },
    });

    expect(rows).toHaveLength(2);
    expect({ ...rows[0], row_json: JSON.parse(rows[0].row_json) }).toEqual({
      bid_id: 91,
      version_id: 7,
      artifact_type: 'DEVIATION_TABLE',
      artifact_group: 'TECHNICAL',
      row_no: 1,
      row_json: {
        row_no: 1,
        parameter_key: 'PARAM_3_2_1_双机热备',
        tender_requirement: '双机热备',
        satisfy_status: '',
        bidder_response: '满足',
        deviation_note: '无偏离',
        satisfy_basis: '依据投标响应“满足”和偏离说明“无偏离”判定为满足。',
        evidence_source: '产品参数表',
        risk_level: '',
        risk_grade: 'LOW',
        manual_review_required: false,
      },
    });
    expect({ ...rows[1], row_json: JSON.parse(rows[1].row_json) }).toEqual({
      bid_id: 91,
      version_id: 7,
      artifact_type: 'RESPONSE_TABLE',
      artifact_group: 'BUSINESS',
      row_no: 1,
      row_json: {
        row_no: 1,
        parameter_key: 'PARAM_BUS_1_提供原厂授权',
        tender_requirement: '提供原厂授权',
        response_text: '已提供原厂授权函。',
        satisfy_status: '',
        satisfy_basis: '依据响应文本判定为满足。',
        evidence_source: '附件-授权函',
        risk_level: '',
        risk_grade: 'LOW',
        manual_review_required: false,
      },
    });
  });
});
