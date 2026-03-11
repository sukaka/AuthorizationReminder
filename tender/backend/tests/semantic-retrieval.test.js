import { describe, expect, it } from 'vitest';

import semanticRetrieval from '../src/semantic-retrieval.js';

const {
  buildSemanticRetrievalChunks,
  buildSemanticFeedbackIndex,
  rankSemanticAssetRecommendations,
} = semanticRetrieval;

describe('semantic retrieval helpers', () => {
  it('builds normalized retrieval chunks from project assets and kb records', () => {
    const chunks = buildSemanticRetrievalChunks({
      projectAssets: [
        {
          id: 11,
          asset_type: 'QUALIFICATION',
          original_file_name: '售后服务承诺书.pdf',
          ocr_text: '提供7×24小时响应，2小时到场，本地服务团队。',
          tags_json: '["服务","售后"]',
          updated_at: '2026-03-08 10:00:00',
        },
      ],
      kbSectionAssets: [
        {
          id: 21,
          section_name: '售后服务方案',
          sub_section_name: '响应机制',
          content: '建立本地服务团队，7×24小时响应，2小时到场。',
          quality_score: 92,
          tags_json: '["服务","本地化"]',
          updated_at: '2026-03-01 10:00:00',
        },
      ],
      kbProjectCases: [
        {
          id: 31,
          case_name: '某市政务云安全运维项目',
          summary: '连续三年驻场运维，响应时间2小时。',
          industry_type: '政府',
          project_type: '服务',
          tags_json: '["案例","运维"]',
          updated_at: '2026-02-20 10:00:00',
        },
      ],
    });

    expect(chunks).toHaveLength(3);
    expect(chunks[0].chunk_id).toBe('asset:11');
    expect(chunks[0].source_table).toBe('tender_assets');
    expect(chunks[0].chunk_type).toBe('QUALIFICATION');
    expect(chunks[1].source_table).toBe('kb_section_assets');
    expect(chunks[1].chunk_type).toBe('SECTION_FRAGMENT');
    expect(chunks[2].source_table).toBe('kb_project_cases');
    expect(chunks[2].chunk_type).toBe('CASE_SUMMARY');
  });

  it('ranks hybrid semantic recommendations above weak keyword-only matches', () => {
    const clause = {
      id: 501,
      clause_title: '售后服务评分项',
      clause_text: '需提供7×24小时响应、本地服务团队和2小时到场保障。',
      clause_type: 'SCORING',
      mandatory_flag: 0,
      scoring_flag: 1,
    };
    const chunks = buildSemanticRetrievalChunks({
      projectAssets: [
        {
          id: 11,
          asset_type: 'QUALIFICATION',
          original_file_name: '营业执照.pdf',
          ocr_text: '统一社会信用代码与注册地址',
          updated_at: '2026-03-08 10:00:00',
        },
      ],
      kbSectionAssets: [
        {
          id: 21,
          section_name: '售后服务方案',
          sub_section_name: '服务响应机制',
          content: '建立本地服务团队，提供全天候响应，2小时到场，原厂协同。',
          quality_score: 95,
          tags_json: '["售后","本地服务","响应机制"]',
          updated_at: '2026-03-07 10:00:00',
        },
      ],
      kbProjectCases: [
        {
          id: 31,
          case_name: '网络安全运维案例',
          summary: '提供7×24服务和值守机制。',
          quality_score: 80,
          tags_json: '["案例","售后"]',
          updated_at: '2026-01-01 10:00:00',
        },
      ],
    });

    const ranked = rankSemanticAssetRecommendations({ clause, chunks, limit: 3 });

    expect(ranked).toHaveLength(2);
    expect(ranked[0].source_table).toBe('kb_section_assets');
    expect(ranked[0].match_source).toBe('HYBRID');
    expect(ranked[0].semantic_score).toBeGreaterThan(ranked[1].semantic_score);
    expect(ranked[0].rerank_score).toBeGreaterThan(ranked[1].rerank_score);
    expect(ranked[0].chunk_preview).toContain('2小时到场');
  });

  it('marks sensitive qualification-style recommendations for manual review', () => {
    const clause = {
      id: 601,
      clause_title: '资质要求',
      clause_text: '需提供有效资质证书和授权证明文件。',
      clause_type: 'QUALIFICATION',
      mandatory_flag: 1,
      scoring_flag: 0,
    };
    const chunks = buildSemanticRetrievalChunks({
      projectAssets: [
        {
          id: 41,
          asset_type: 'QUALIFICATION',
          original_file_name: '高新技术企业证书.pdf',
          ocr_text: '证书编号GR2026XXXX，有效期至2027年。',
          updated_at: '2026-03-08 10:00:00',
        },
      ],
    });

    const ranked = rankSemanticAssetRecommendations({ clause, chunks, limit: 3 });

    expect(ranked).toHaveLength(1);
    expect(ranked[0].need_manual_review).toBe(true);
    expect(ranked[0].manual_review_reasons).toContain('资质/授权类证据必须人工复核');
    expect(ranked[0].match_source).toBe('HYBRID');
  });

  it('builds feedback priors from confirmed, replaced and ignored matches', () => {
    const feedbackIndex = buildSemanticFeedbackIndex([
      {
        asset_id: 41,
        match_status: 'CONFIRMED',
        updated_at: '2026-03-09 10:00:00',
        payload: {
          chunk_id: 'kb_section:21',
        },
      },
      {
        asset_id: 41,
        match_status: 'REPLACED',
        updated_at: '2026-03-08 10:00:00',
        payload: {
          chunk_id: 'kb_section:21',
        },
      },
      {
        asset_id: 0,
        match_status: 'IGNORED',
        updated_at: '2026-03-07 10:00:00',
        payload: {
          chunk_id: 'kb_section:22',
        },
      },
      {
        asset_id: 99,
        match_status: 'RECOMMENDED',
        updated_at: '2026-03-06 10:00:00',
        payload: {
          chunk_id: 'kb_section:23',
        },
      },
    ]);

    expect(feedbackIndex.byChunkId['kb_section:21'].confirmed_count).toBe(1);
    expect(feedbackIndex.byChunkId['kb_section:21'].replaced_count).toBe(1);
    expect(feedbackIndex.byChunkId['kb_section:21'].positive_count).toBe(2);
    expect(feedbackIndex.byChunkId['kb_section:21'].last_feedback_status).toBe('CONFIRMED');
    expect(feedbackIndex.byChunkId['kb_section:22'].ignored_count).toBe(1);
    expect(feedbackIndex.byAssetId[41].positive_count).toBe(2);
    expect(feedbackIndex.byChunkId['kb_section:23']).toBeUndefined();
  });

  it('uses feedback priors to lift confirmed chunks and demote ignored chunks', () => {
    const clause = {
      id: 701,
      clause_title: '售后服务要求',
      clause_text: '需提供本地服务团队、7×24小时响应和2小时到场保障。',
      clause_type: 'SCORING',
      mandatory_flag: 0,
      scoring_flag: 1,
    };
    const chunks = buildSemanticRetrievalChunks({
      kbSectionAssets: [
        {
          id: 21,
          section_name: '售后服务方案',
          sub_section_name: '响应机制',
          content: '建立本地服务团队，提供7×24小时响应，2小时到场。',
          quality_score: 96,
          updated_at: '2026-03-08 10:00:00',
        },
        {
          id: 22,
          section_name: '服务承诺书',
          sub_section_name: '保障承诺',
          content: '建立本地服务团队，提供7×24小时响应，2小时到场。',
          quality_score: 80,
          updated_at: '2026-03-01 10:00:00',
        },
      ],
    });
    const feedbackIndex = buildSemanticFeedbackIndex([
      {
        match_status: 'IGNORED',
        updated_at: '2026-03-08 09:00:00',
        payload: {
          chunk_id: 'kb_section:21',
        },
      },
      {
        match_status: 'CONFIRMED',
        updated_at: '2026-03-09 09:00:00',
        payload: {
          chunk_id: 'kb_section:22',
        },
      },
    ]);

    const ranked = rankSemanticAssetRecommendations({ clause, chunks, limit: 3, feedbackIndex });

    expect(ranked).toHaveLength(2);
    expect(ranked[0].chunk_id).toBe('kb_section:22');
    expect(ranked[0].feedback_score).toBeGreaterThan(0);
    expect(ranked[0].feedback_summary.confirmed_count).toBe(1);
    expect(ranked[0].reason_text).toContain('反馈分');
    expect(ranked[1].chunk_id).toBe('kb_section:21');
    expect(ranked[1].feedback_score).toBeLessThan(0);
    expect(ranked[1].feedback_summary.ignored_count).toBe(1);
  });
});
