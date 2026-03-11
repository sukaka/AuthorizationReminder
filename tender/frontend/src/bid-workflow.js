const REVIEW_STAGE_LABELS = {
  COMPILE: '编制审核',
  TECH: '技术审核',
  BUSINESS: '商务审核',
  FINAL: '终审',
}

const REVIEW_STATUS_LABELS = {
  draft: '草稿',
  submitted: '待处理',
  approved: '通过',
  returned: '发回修改',
  rejected: '驳回',
  conditional: '条件通过',
}

export const bidMemberRoleOptions = [
  { value: 'OWNER', label: '项目负责人' },
  { value: 'COORDINATOR', label: '协调人' },
  { value: 'COMPILE', label: '编制负责人' },
  { value: 'TECH', label: '技术负责人' },
  { value: 'BUSINESS', label: '商务负责人' },
  { value: 'FINAL', label: '终审负责人' },
  { value: 'RISK', label: '风险校验' },
  { value: 'EXPORT', label: '导出负责人' },
]

const bidMemberRoleSet = new Set(bidMemberRoleOptions.map((item) => item.value))

const lifecycleDefs = [
  { key: 'draft', label: '草稿立项' },
  { key: 'files', label: '文件就绪' },
  { key: 'materials', label: '资料补齐' },
  { key: 'generate', label: '生成编制' },
  { key: 'review', label: '多级审核' },
  { key: 'export', label: '导出归档' },
]

const lifecycleStepOrder = lifecycleDefs.map((item) => item.key)

const determineLifecycleStepKey = (status) => {
  const key = String(status || '').trim().toUpperCase()
  if (['ARCHIVED', 'EXPORTED', 'SUBMITTED', 'EXPORT_READY'].includes(key)) return 'export'
  if (['COMPILE_REVIEW_PENDING', 'TECH_REVIEW_PENDING', 'BUSINESS_REVIEW_PENDING', 'FINAL_REVIEW_PENDING', 'IN_REVIEW', 'FINALIZED'].includes(key)) return 'review'
  if (['READY_TO_GENERATE', 'GENERATING'].includes(key)) return 'generate'
  if (key === 'MATERIALS_PENDING') return 'materials'
  if (['FILES_UPLOADED', 'PARSE_COMPLETED'].includes(key)) return 'files'
  return 'draft'
}

export const deriveBidLifecycleSteps = (bid = {}) => {
  const currentKey = determineLifecycleStepKey(bid?.status)
  const currentIndex = lifecycleStepOrder.indexOf(currentKey)
  return lifecycleDefs.map((item, index) => {
    let state = 'pending'
    if (index < currentIndex) state = 'done'
    else if (index === currentIndex) state = 'current'
    return {
      ...item,
      state,
    }
  })
}

export const normalizeBidMemberDraft = (row = {}) => {
  const memberUserIdNum = Number(row?.member_user_id)
  const memberRole = String(row?.member_role || '').trim().toUpperCase()
  return {
    member_user_id: Number.isFinite(memberUserIdNum) && memberUserIdNum > 0 ? Math.floor(memberUserIdNum) : null,
    member_username: String(row?.member_username || '').trim(),
    member_role: bidMemberRoleSet.has(memberRole) ? memberRole : 'COORDINATOR',
    member_title: String(row?.member_title || '').trim(),
  }
}

export const validateBidMemberDrafts = (rows = []) => {
  const errors = []
  const duplicateKeys = new Set()
  const seen = new Set()

  rows.forEach((item, index) => {
    const row = normalizeBidMemberDraft(item)
    if (!row.member_username) {
      errors.push(`第 ${index + 1} 行成员用户名不能为空`)
    }
    const duplicateKey = `${row.member_role}::${row.member_username}`
    if (row.member_username) {
      if (seen.has(duplicateKey) && !duplicateKeys.has(duplicateKey)) {
        duplicateKeys.add(duplicateKey)
        errors.push(`成员 ${row.member_username} 在角色 ${row.member_role} 下重复`)
      }
      seen.add(duplicateKey)
    }
  })

  return {
    ok: errors.length === 0,
    errors,
  }
}

export const reviewStageLabel = (value) => REVIEW_STAGE_LABELS[String(value || '').trim().toUpperCase()] || value || '-'

export const reviewStatusLabel = (value) => REVIEW_STATUS_LABELS[String(value || '').trim().toLowerCase()] || value || '-'

export const bidMemberRoleLabel = (value) => {
  const match = bidMemberRoleOptions.find((item) => item.value === String(value || '').trim().toUpperCase())
  return match?.label || value || '-'
}
