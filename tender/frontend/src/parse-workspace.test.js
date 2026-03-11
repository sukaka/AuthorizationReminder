import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildParseFileTree,
  flattenParseFileTree,
  buildSheetSelectionDrafts,
  buildClauseBulkPayload,
  buildMatchBulkPayload,
  resolveParseWorkspaceGenerateDefaults,
} from './parse-workspace.js'

test('buildParseFileTree groups uploaded roots and zip descendants together', () => {
  const tree = buildParseFileTree([
    { id: 11, root_file_id: 11, file_kind: 'UPLOAD', display_name: '招标总包.zip', source_ext: '.zip' },
    { id: 12, root_file_id: 11, parent_file_id: 11, file_kind: 'ARCHIVE_ENTRY', relative_path: '招标文件.docx', display_name: '招标文件.docx', source_ext: '.docx' },
    { id: 13, root_file_id: 11, parent_file_id: 11, file_kind: 'ARCHIVE_ENTRY', relative_path: '附件/参数表.xlsx', display_name: '参数表.xlsx', source_ext: '.xlsx' },
    { id: 21, root_file_id: 21, file_kind: 'UPLOAD', display_name: '澄清说明.pdf', source_ext: '.pdf' },
  ])

  assert.equal(tree.length, 2)
  assert.equal(tree[0].root.display_name, '招标总包.zip')
  assert.deepEqual(tree[0].children.map((item) => item.relative_path), ['招标文件.docx', '附件/参数表.xlsx'])
  assert.equal(tree[1].root.display_name, '澄清说明.pdf')
})

test('flattenParseFileTree preserves root then children order for rendering', () => {
  const rows = flattenParseFileTree(buildParseFileTree([
    { id: 1, root_file_id: 1, file_kind: 'UPLOAD', display_name: '主文件.docx', source_ext: '.docx' },
    { id: 2, root_file_id: 2, file_kind: 'UPLOAD', display_name: '附件.zip', source_ext: '.zip' },
    { id: 3, root_file_id: 2, parent_file_id: 2, file_kind: 'ARCHIVE_ENTRY', relative_path: '评分表.xlsx', display_name: '评分表.xlsx', source_ext: '.xlsx' },
  ]))

  assert.deepEqual(rows.map((item) => item.id), [1, 2, 3])
})

test('buildSheetSelectionDrafts prefers backend selected sheets and falls back to manifest order', () => {
  const drafts = buildSheetSelectionDrafts([
    {
      id: 31,
      source_ext: '.xlsx',
      sheet_manifest: [{ name: '封面' }, { name: '评分表' }, { name: '技术参数' }],
      selected_sheet_names: ['技术参数', '评分表'],
    },
    {
      id: 32,
      source_ext: '.xls',
      sheet_manifest: [{ name: '资格审查' }, { name: '偏离表' }],
      selected_sheet_names: [],
    },
  ])

  assert.deepEqual(drafts[31], ['技术参数', '评分表'])
  assert.deepEqual(drafts[32], ['资格审查', '偏离表'])
})

test('buildClauseBulkPayload and buildMatchBulkPayload shape editable rows into API payloads', () => {
  const clausePayload = buildClauseBulkPayload([
    {
      id: 1001,
      clause_type: 'technical',
      response_mode: 'matrix',
      mandatory_flag: 1,
      scoring_flag: 0,
      score_value: '',
    },
  ])
  const matchPayload = buildMatchBulkPayload([
    {
      id: 2001,
      clause_id: 1001,
      asset_id: 88,
      match_status: 'confirmed',
      confidence: '0.92',
      reason_text: '命中资质关键词',
      payload: { source: 'manual' },
    },
  ])

  assert.deepEqual(clausePayload, {
    items: [
      {
        id: 1001,
        clause_type: 'TECHNICAL',
        response_mode: 'MATRIX',
        mandatory_flag: true,
        scoring_flag: false,
        score_value: null,
      },
    ],
  })
  assert.deepEqual(matchPayload, {
    items: [
      {
        id: 2001,
        clause_id: 1001,
        asset_id: 88,
        match_status: 'CONFIRMED',
        confidence: 0.92,
        reason_text: '命中资质关键词',
        payload: { source: 'manual' },
      },
    ],
  })
})

test('resolveParseWorkspaceGenerateDefaults picks enabled defaults for parse-to-generate bridge', () => {
  const defaults = resolveParseWorkspaceGenerateDefaults({
    bidCategory: 'product',
    models: [
      { id: 7, is_enabled: 1, is_default: 0 },
      { id: 9, is_enabled: 1, is_default: 1 },
      { id: 11, is_enabled: 0, is_default: 0 },
    ],
    docTemplates: [
      { id: 21, status: 'ACTIVE', is_default: 0 },
      { id: 22, status: 'ACTIVE', is_default: 1 },
      { id: 23, status: 'DISABLED', is_default: 0 },
    ],
  })

  assert.deepEqual(defaults, {
    bid_category: 'PRODUCT',
    model_id: '9',
    doc_template_id: '22',
  })
})

test('resolveParseWorkspaceGenerateDefaults falls back safely when model or template is absent', () => {
  const defaults = resolveParseWorkspaceGenerateDefaults({
    bidCategory: '',
    models: [{ id: 5, is_enabled: 1, is_default: 0 }],
    docTemplates: [{ id: 15, status: 'ARCHIVED', is_default: 1 }],
  })

  assert.deepEqual(defaults, {
    bid_category: 'SERVICE',
    model_id: '5',
    doc_template_id: '',
  })
})
