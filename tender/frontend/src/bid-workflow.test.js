import test from 'node:test'
import assert from 'node:assert/strict'

import {
  deriveBidLifecycleSteps,
  normalizeBidMemberDraft,
  validateBidMemberDrafts,
  reviewStageLabel,
  reviewStatusLabel,
} from './bid-workflow.js'

test('deriveBidLifecycleSteps marks current and completed lifecycle nodes from bid status', () => {
  const rows = deriveBidLifecycleSteps({
    status: 'BUSINESS_REVIEW_PENDING',
    review_stage: 'BUSINESS',
    review_status: 'submitted',
  })

  assert.equal(rows.length, 6)
  assert.deepEqual(
    rows.map((item) => ({ key: item.key, state: item.state })),
    [
      { key: 'draft', state: 'done' },
      { key: 'files', state: 'done' },
      { key: 'materials', state: 'done' },
      { key: 'generate', state: 'done' },
      { key: 'review', state: 'current' },
      { key: 'export', state: 'pending' },
    ]
  )
})

test('normalizeBidMemberDraft trims text and uppercases roles', () => {
  const row = normalizeBidMemberDraft({
    member_user_id: '42',
    member_username: '  editor01  ',
    member_role: 'compile',
    member_title: ' 编制负责人 ',
  })

  assert.deepEqual(row, {
    member_user_id: 42,
    member_username: 'editor01',
    member_role: 'COMPILE',
    member_title: '编制负责人',
  })
})

test('validateBidMemberDrafts rejects missing usernames and duplicate role-username pairs', () => {
  const invalid = validateBidMemberDrafts([
    normalizeBidMemberDraft({ member_username: 'editor01', member_role: 'compile', member_title: '编制负责人' }),
    normalizeBidMemberDraft({ member_username: 'editor01', member_role: 'compile', member_title: '备份编制' }),
    normalizeBidMemberDraft({ member_username: '', member_role: 'tech', member_title: '技术负责人' }),
  ])

  assert.equal(invalid.ok, false)
  assert.match(invalid.errors[0], /重复/)
  assert.match(invalid.errors[1], /用户名/)
})

test('reviewStageLabel and reviewStatusLabel map backend codes to Chinese labels', () => {
  assert.equal(reviewStageLabel('FINAL'), '终审')
  assert.equal(reviewStatusLabel('conditional'), '条件通过')
  assert.equal(reviewStatusLabel('returned'), '发回修改')
})
