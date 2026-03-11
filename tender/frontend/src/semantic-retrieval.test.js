import test from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeSemanticMatchMeta,
} from './semantic-retrieval.js'

test('normalizeSemanticMatchMeta reads score breakdown and manual review state from payload', () => {
  const normalized = normalizeSemanticMatchMeta({
    match_source: 'hybrid',
    payload: {
      semantic_score: 0.82,
      rule_score: 0.56,
      rerank_score: 0.77,
      need_manual_review: true,
      manual_review_reasons: ['资质/授权类证据必须人工复核'],
      chunk_preview: '建立本地服务团队，提供7×24小时响应和2小时到场。',
      source_table: 'kb_section_assets',
      title: '售后服务方案 / 服务响应机制',
    },
  })

  assert.equal(normalized.match_source, 'HYBRID')
  assert.equal(normalized.match_source_label, '混合召回')
  assert.equal(normalized.semantic_score, 0.82)
  assert.equal(normalized.rule_score, 0.56)
  assert.equal(normalized.rerank_score, 0.77)
  assert.equal(normalized.need_manual_review, true)
  assert.deepEqual(normalized.manual_review_reasons, ['资质/授权类证据必须人工复核'])
  assert.equal(normalized.chunk_preview, '建立本地服务团队，提供7×24小时响应和2小时到场。')
  assert.equal(normalized.source_table, 'kb_section_assets')
  assert.equal(normalized.source_label, '知识库章节')
})

test('normalizeSemanticMatchMeta falls back to safe defaults when payload is missing', () => {
  const normalized = normalizeSemanticMatchMeta({
    match_source: '',
    payload: null,
  })

  assert.equal(normalized.match_source, 'RULE')
  assert.equal(normalized.match_source_label, '规则匹配')
  assert.equal(normalized.semantic_score, 0)
  assert.equal(normalized.rule_score, 0)
  assert.equal(normalized.rerank_score, 0)
  assert.equal(normalized.need_manual_review, false)
  assert.deepEqual(normalized.manual_review_reasons, [])
  assert.equal(normalized.chunk_preview, '')
  assert.equal(normalized.source_label, '项目资产')
})
