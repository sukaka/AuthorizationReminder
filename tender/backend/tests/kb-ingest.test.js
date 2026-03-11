import { describe, expect, it } from 'vitest';

import {
  buildKbProjectRecord,
  buildKbScoreItemRows,
  buildKbAssetChunks,
} from '../src/kb-ingest.js';

describe('kb ingest helpers', () => {
  it('builds a project record from bid, parse summary, and ingest overrides', () => {
    const record = buildKbProjectRecord({
      bid: {
        id: 19,
        bid_no: 'TB-20260308-0009',
        title: '政务云安全运营项目投标文件',
        customer_name: '市大数据局',
        project_name: '安全运营服务项目',
        summary: '面向政务云平台提供安全运营服务',
        status: 'EXPORT_READY',
      },
      latestParseJob: {
        merged_fields: {
          project_name: '政务云安全运营项目',
          purchaser: '市大数据局',
          bid_deadline: '2026-04-20 09:30:00',
        },
      },
      overrides: {
        project_type: 'service',
        industry_type: '政务',
        result_status: 'won',
        bid_amount: '2800000',
        tags: [' 政务 ', 'service', '政务', 'Cloud-Sec'],
        remarks: '人工确认后沉淀',
      },
      user: {
        id: 1,
        username: 'admin',
      },
    });

    expect(record.project_name).toBe('政务云安全运营项目');
    expect(record.project_no).toBe('TB-20260308-0009');
    expect(record.purchaser).toBe('市大数据局');
    expect(record.project_type).toBe('SERVICE');
    expect(record.industry_type).toBe('政务');
    expect(record.result_status).toBe('WON');
    expect(record.bid_amount).toBe(2800000);
    expect(record.source_bid_id).toBe(19);
    expect(record.tags).toEqual([
      'bid-project',
      'status-export-ready',
      'project-service',
      '政务',
      'service',
      'cloud-sec',
    ]);
    expect(record.remarks).toBe('人工确认后沉淀');
    expect(record.created_by_name).toBe('admin');
  });

  it('derives score item rows from scoring clauses with stable priority levels', () => {
    const rows = buildKbScoreItemRows({
      kbProjectId: 88,
      clauses: [
        {
          id: 701,
          clause_title: '售后服务方案',
          clause_text: '根据响应时间、服务机制、本地化服务综合评分。',
          scoring_flag: 1,
          score_value: 8,
        },
        {
          id: 702,
          clause_title: '项目经理资质',
          clause_text: '项目经理具备同类项目经验得 2 分。',
          scoring_flag: 1,
          score_value: 2,
        },
        {
          id: 703,
          clause_title: '合同条款',
          clause_text: '合同签订后 30 日内进场。',
          scoring_flag: 0,
          score_value: 0,
        },
      ],
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      kb_project_id: 88,
      item_name: '售后服务方案',
      full_score: 8,
      priority_level: 'HIGH',
      source_clause_id: 701,
    });
    expect(rows[0].recommended_response_points).toEqual(['响应时间', '服务机制', '本地化服务']);
    expect(rows[1]).toMatchObject({
      item_name: '项目经理资质',
      full_score: 2,
      priority_level: 'MEDIUM',
      source_clause_id: 702,
    });
  });

  it('builds normalized chunks for project summary, clauses, sections, tables, and attachment OCR', () => {
    const chunks = buildKbAssetChunks({
      kbProjectId: 501,
      project: {
        project_name: '政务云安全运营项目',
        purchaser: '市大数据局',
        project_type: 'SERVICE',
        industry_type: '政务',
        remarks: '重点关注 SLA 与驻场服务',
        tags: ['bid-project', '政务'],
      },
      clauses: [
        {
          id: 801,
          clause_title: '服务可用性要求',
          clause_text: '服务可用性不得低于 99.9%，响应时间 15 分钟内。',
          clause_type: 'TECHNICAL',
          scoring_flag: 1,
          mandatory_flag: 1,
          source_file_path: '/data/tender/uploads/parse/main.docx',
        },
      ],
      sections: [
        {
          id: 901,
          section_title: '实施方案',
          paragraph_text: '建立 7x24 响应机制，并配置本地驻场服务团队。',
          source_kb_section_asset_id: null,
        },
      ],
      tables: [
        {
          id: 1001,
          table_name: '评分表',
          summary_text: '售后服务方案 8 分，本地化服务 4 分。',
          header: ['评分项', '分值'],
          rows: [
            ['售后服务方案', '8'],
            ['本地化服务', '4'],
          ],
        },
      ],
      attachments: [
        {
          id: 1101,
          asset_type: 'QUALIFICATION',
          original_file_name: '高新技术企业证书.pdf',
          ocr_text: '高新技术企业证书，有效期至 2028 年 12 月 31 日。',
        },
      ],
    });

    expect(chunks.some((item) => item.chunk_type === 'PROJECT_SUMMARY')).toBe(true);
    expect(chunks.some((item) => item.chunk_type === 'CLAUSE_TEXT')).toBe(true);
    expect(chunks.some((item) => item.chunk_type === 'SECTION_PARAGRAPH')).toBe(true);
    expect(chunks.some((item) => item.chunk_type === 'TABLE_SUMMARY')).toBe(true);
    expect(chunks.some((item) => item.chunk_type === 'TABLE_ROW')).toBe(true);
    expect(chunks.some((item) => item.chunk_type === 'ATTACHMENT_OCR')).toBe(true);

    const clauseChunk = chunks.find((item) => item.chunk_type === 'CLAUSE_TEXT');
    expect(clauseChunk).toMatchObject({
      kb_project_id: 501,
      source_table: 'kb_tender_clauses',
      source_id: 801,
      asset_type: 'TENDER_CLAUSE',
      reusable_flag: 1,
    });
    expect(clauseChunk.tags).toEqual(expect.arrayContaining([
      'bid-project',
      'project-service',
      'clause-technical',
      'clause-scoring',
      'clause-mandatory',
    ]));
    expect(Number(clauseChunk.quality_score)).toBeGreaterThan(0.8);

    const attachmentChunk = chunks.find((item) => item.chunk_type === 'ATTACHMENT_OCR');
    expect(attachmentChunk).toMatchObject({
      source_table: 'tender_assets',
      source_id: 1101,
      asset_type: 'QUALIFICATION',
      reusable_flag: 1,
    });
    expect(attachmentChunk.tags).toEqual(expect.arrayContaining([
      'attachment-qualification',
      'ocr-evidence',
    ]));
  });
});
