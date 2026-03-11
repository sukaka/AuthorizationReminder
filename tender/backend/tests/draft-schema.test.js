import { describe, expect, it } from 'vitest';

import draftSchema from '../src/draft-schema.js';

const {
  buildDraftChapterSchema,
  buildDraftChapterQualitySummary,
  normalizeDraftChaptersToSchema,
} = draftSchema;

describe('draft schema helpers', () => {
  it('normalizes ai draft chapters into the fixed service schema with fallback chapters', () => {
    const baselineChapters = [
      { title: '封面', content: ['封面'] },
      { title: '目录', content: ['目录'] },
      { title: '投标邀请', content: ['邀请'] },
      { title: '投标人须知', content: ['须知'] },
      { title: '采购需求', content: ['规则需求'] },
      { title: '评标方法与评标标准', content: ['规则评分'] },
      { title: '服务方案框架', content: ['规则服务方案'] },
      { title: '偏离表', content: ['规则偏离表'] },
      { title: '合同主要条款及格式', content: ['规则合同'] },
      { title: '投标文件格式', content: ['规则格式'] },
    ];

    const result = normalizeDraftChaptersToSchema({
      bidCategory: 'SERVICE',
      baselineChapters,
      aiChapters: [
        { title: '采购需求', content: ['AI 采购需求'] },
        { title: '评标方法与评分响应', content: ['AI 评分响应'] },
        { title: '服务方案框架', content: ['AI 服务方案'] },
      ],
    });

    expect(buildDraftChapterSchema({ bidCategory: 'SERVICE' }).length).toBeGreaterThan(5);
    expect(result.validation.valid).toBe(true);
    expect(result.validation.used_ai_count).toBe(3);
    expect(result.validation.fallback_count).toBeGreaterThan(0);
    expect(result.chapters.find((item) => item.title === '采购需求')?.content[0]).toBe('AI 采购需求');
    expect(result.chapters.find((item) => item.title === '评标方法与评标标准')?.content[0]).toBe('AI 评分响应');
    expect(result.chapters.find((item) => item.title === '投标文件格式')?.content[0]).toBe('规则格式');
  });

  it('marks schema invalid when required product chapter is missing from both ai output and baseline fallback', () => {
    const result = normalizeDraftChaptersToSchema({
      bidCategory: 'PRODUCT',
      baselineChapters: [
        { title: '封面', content: ['封面'] },
        { title: '目录', content: ['目录'] },
        { title: '投标邀请', content: ['邀请'] },
      ],
      aiChapters: [],
    });

    expect(result.validation.valid).toBe(false);
    expect(result.validation.missing_required_keys).toContain('BIDDER_INSTRUCTION');
    expect(result.validation.missing_required_keys).toContain('BID_DOC_FORMAT');
  });

  it('builds chapter quality summary with overall score, warnings and per-chapter grades', () => {
    const normalized = normalizeDraftChaptersToSchema({
      bidCategory: 'SERVICE',
      baselineChapters: [
        { title: '封面', content: ['封面'] },
        { title: '目录', content: ['目录'] },
        { title: '投标邀请', content: ['邀请'] },
        { title: '投标人须知', content: ['须知补充'] },
        { title: '采购需求', content: ['规则需求补位'] },
        { title: '评标方法与评标标准', content: ['规则评分'] },
        { title: '服务方案框架', content: ['规则服务方案'] },
        { title: '偏离表', content: ['规则偏离表'] },
        { title: '合同主要条款及格式', content: ['规则合同'] },
        { title: '投标文件格式', content: ['规则格式'] },
      ],
      aiChapters: [
        {
          title: '采购需求',
          content: [
            'AI 采购需求：提供驻场服务、平台巡检与定期培训。',
            '服务范围覆盖日常运维、故障响应、周报月报和专项保障。',
            '服务标准要求响应时限明确、交付物齐全、过程留痕可追溯。',
          ],
        },
        {
          title: '服务方案框架',
          content: [
            'AI 服务方案：围绕实施路径、团队配置、质量保障和应急响应展开。',
            '实施路径按启动、交接、运行、复盘四阶段推进，形成里程碑管理。',
            '团队配置包含项目经理、实施工程师、运维工程师和质控角色。',
            '质量保障覆盖 SLA 管控、日报周报、问题闭环和客户满意度回访。',
          ],
        },
        { title: '补充说明', content: ['额外补充章节'] },
      ],
    });

    const quality = buildDraftChapterQualitySummary({
      bidCategory: 'SERVICE',
      chapters: normalized.chapters,
      validation: normalized.validation,
    });

    expect(Number.isFinite(Number(quality?.overall_score ?? NaN))).toBe(true);
    expect(Number(quality?.overall_score || 0)).toBeGreaterThan(0);
    expect(['A', 'B', 'C', 'D']).toContain(String(quality?.grade || ''));
    expect(Array.isArray(quality?.chapter_scores || [])).toBe(true);
    expect(quality.chapter_scores.length).toBeGreaterThan(5);
    expect(Array.isArray(quality?.summary_lines || [])).toBe(true);
    expect(quality.summary_lines.length).toBeGreaterThan(0);

    const procurement = quality.chapter_scores.find((item) => item.chapter_key === 'PROCUREMENT_REQUIREMENT');
    const invitation = quality.chapter_scores.find((item) => item.chapter_key === 'INVITATION');
    const extraAi = quality.chapter_scores.find((item) => item.chapter_key === 'EXTRA_AI_1');

    expect(procurement && Number(procurement.score || 0)).toBeGreaterThan(80);
    expect(invitation && String(invitation.source || '')).toBe('FALLBACK');
    expect(extraAi && String(extraAi.source || '')).toBe('EXTRA_AI');
    expect(Number(quality?.high_risk_count || 0)).toBeGreaterThanOrEqual(0);
  });
});
