import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const API_BASE = import.meta.env.VITE_API_BASE || ''

const stageLabelMap = {
  CREATED: '已创建',
  RECEIVED: '收货',
  HARDWARE_CHECKED: '硬件检查',
  WAREHOUSED_AFTER_HARDWARE: '入库',
  OUTBOUNDED_FOR_INSTALL: '出库',
  OS_INSTALLED: '系统安装',
  TESTED: '测试',
  APPROVED: '审核',
  PACKED: '装箱',
  WAREHOUSED_AFTER_PACK: '入库',
  OUTBOUNDED_FOR_SHIP: '出库',
  SHIPPED: '发货',
}

const timelineActionLabelMap = {
  CREATE: '创建流转单',
  RECEIVE: '执行收货',
  'HARDWARE-CHECK': '执行硬件检查',
  'WAREHOUSE-AFTER-HARDWARE': '执行入库',
  'OUTBOUND-FOR-INSTALL': '执行出库',
  'OS-INSTALL': '执行系统安装',
  TEST: '执行测试',
  APPROVE: '执行审核',
  PACK: '执行装箱',
  'WAREHOUSE-AFTER-PACK': '执行入库',
  'OUTBOUND-FOR-SHIP': '执行出库',
  SHIP: '执行发货',
  REWORK: '退回重做',
}

const auditActionLabelMap = {
  CREATE: '创建记录',
  CREATE_JOB: '创建流转单',
  UPDATE_ATTACHMENT_UPLOAD_SETTING: '更新附件上传配置',
  SLA_REMINDER: '生成SLA催办',
  RETENTION_RUN: '执行留存清理',
  SCAN_APPLY: '扫码应用',
  UPDATE_SLA_RULES: '更新SLA规则',
  DELETE_SLA_REMINDER: '删除催办记录',
  PURGE_SLA_REMINDERS: '清空催办记录',
  UPSERT_HW_TEMPLATES: '更新硬件模板',
  UPSERT_PERMISSION_POLICIES: '更新权限策略',
  UPDATE_DUAL_SIGN_POLICY: '更新双签策略',
  LOCK_JOB: '锁定流转单',
  UNLOCK_JOB: '解锁流转单',
  DELETE_ATTACHMENT: '删除附件',
  UPLOAD_ATTACHMENT: '上传附件',
  DUAL_SIGN_TEST_INIT: '发起双人复核测试',
  REWORK: '退回重做',
  CANCEL: '取消流转单',
  CHANGE_REQUEST_WITHDRAW: '撤回变更申请',
  CHANGE_REQUEST_REJECT: '驳回变更申请',
  CHANGE_REQUEST_APPROVE: '通过变更申请',
  WITHDRAW_APPROVED: '批准撤回',
  UPDATE_RETENTION_POLICIES: '更新留存策略',
  CREATE_CALLBACK_SUBSCRIPTION: '创建回调订阅',
  UPDATE_CALLBACK_SUBSCRIPTION: '更新回调订阅',
  CREATE_API_CLIENT: '创建API客户端',
}

const nextActionByStage = {
  CREATED: 'receive',
  RECEIVED: 'hardware-check',
  HARDWARE_CHECKED: 'warehouse-after-hardware',
  WAREHOUSED_AFTER_HARDWARE: 'outbound-for-install',
  OUTBOUNDED_FOR_INSTALL: 'os-install',
  OS_INSTALLED: 'test',
  TESTED: 'approve',
  APPROVED: 'pack',
  PACKED: 'warehouse-after-pack',
  WAREHOUSED_AFTER_PACK: 'outbound-for-ship',
  OUTBOUNDED_FOR_SHIP: 'ship',
}

const optionalNextActionsByStage = {
  HARDWARE_CHECKED: ['warehouse-after-hardware', 'os-install'],
  PACKED: ['warehouse-after-pack', 'ship'],
}

const actionLabelMap = {
  receive: '执行收货',
  'hardware-check': '执行硬件检查',
  'warehouse-after-hardware': '执行入库',
  'outbound-for-install': '执行出库',
  'os-install': '执行系统安装',
  test: '执行测试',
  approve: '执行审核',
  pack: '执行装箱',
  'warehouse-after-pack': '执行入库',
  'outbound-for-ship': '执行出库',
  ship: '执行发货',
}

const stageContextMap = {
  RECEIVED: '确认设备已到场',
  HARDWARE_CHECKED: '硬件核对与留证',
  WAREHOUSED_AFTER_HARDWARE: '检查后暂存',
  OUTBOUNDED_FOR_INSTALL: '安装前领出',
  OS_INSTALLED: '按需安装系统',
  TESTED: '测试结果需复核',
  APPROVED: '审核结论',
  PACKED: '包装与配件确认',
  WAREHOUSED_AFTER_PACK: '装箱后暂存',
  OUTBOUNDED_FOR_SHIP: '发货前领出',
  SHIPPED: '客户发货完成',
}

const actionGuidanceMap = {
  receive: { title: '确认收货', hint: '登记来件信息，开始设备流转。' },
  'hardware-check': { title: '完成硬件检查', hint: '核对 CPU、内存、磁盘、网卡、序列号，并补充检查留证。' },
  'warehouse-after-hardware': { title: '执行入库', hint: '设备检查后需要暂存时，记录库位后入库。' },
  'outbound-for-install': { title: '执行出库', hint: '设备准备安装系统时，从库存领出。' },
  'os-install': { title: '跳过入库，直接系统安装', hint: '设备检查后不暂存，立即进入系统安装。' },
  test: { title: '完成测试', hint: '记录开机、网络、压力测试结果，并指定复签人。' },
  approve: { title: '完成审核', hint: '审核测试结论，必要时进行双人复核。' },
  pack: { title: '完成装箱', hint: '确认包装、配件和箱号。' },
  'warehouse-after-pack': { title: '执行入库', hint: '装箱后暂无客户订单时，先入库等待发货。' },
  'outbound-for-ship': { title: '执行出库', hint: '客户采购后，从库存领出准备发货。' },
  ship: { title: '跳过入库，直接发货', hint: '装箱后已有客户订单，直接登记物流并发货。' },
}

const actionAllowedRoles = {
  receive: ['admin', 'sysadmin'],
  'hardware-check': ['admin', 'sysadmin'],
  'warehouse-after-hardware': ['admin', 'sysadmin'],
  'outbound-for-install': ['admin', 'sysadmin'],
  'os-install': ['admin', 'sysadmin'],
  test: ['admin', 'sysadmin'],
  approve: ['admin', 'sysadmin'],
  pack: ['admin', 'sysadmin'],
  'warehouse-after-pack': ['admin', 'sysadmin'],
  'outbound-for-ship': ['admin', 'sysadmin'],
  ship: ['admin', 'sysadmin'],
}

const stageSequence = Object.keys(stageLabelMap)

const payloadLabelMap = {
  cpu_match: 'CPU匹配',
  memory_match: '内存匹配',
  disk_match: '磁盘匹配',
  nic_match: '网卡匹配',
  serial_match: '序列号匹配',
  hardware_note: '硬件检查备注',
  warehouse_location: '库位',
  warehouse_note: '入库备注',
  outbound_target: '出库去向',
  outbound_note: '出库备注',
  os_name: '系统名称',
  os_version: '系统版本',
  install_mode: '安装方式',
  install_result: '安装结果',
  install_note: '安装备注',
  boot_test: '开机测试',
  network_test: '网络测试',
  stress_test: '压力测试',
  test_result: '测试结论',
  burnin_hours: '老化时长(小时)',
  test_note: '测试备注',
  approve_result: '审核结论',
  approve_note: '审核备注',
  reviewer_comment: '审核意见',
  package_check: '包装完整',
  accessory_check: '配件完整',
  box_no: '箱号',
  pack_note: '装箱备注',
  carrier: '物流公司',
  outbound_tracking_no: '发货快递单号',
  shipped_note: '发货备注',
  receive_note: '收货备注',
  current_stage: '当前阶段',
  status: '状态',
  stage_record_id: '阶段记录ID',
  stage_payload: '阶段参数',
  stage_code: '阶段编码',
  stage_label: '阶段名称',
  from_stage: '起始阶段',
  to_stage: '目标阶段',
  reason: '原因',
  source: '来源',
  deleted: '已删除',
  job_no: '流转单号',
  device_sn: '设备SN',
  customer_name: '客户名称',
  sales_order_no: '销售订单号',
  inbound_tracking_no: '来件单号',
  threshold_hours: 'SLA阈值(小时)',
  overdue_hours: '超时小时',
  remind_interval_minutes: '提醒间隔(分钟)',
  enabled: '是否启用',
  file_name: '文件名',
  file_size: '文件大小',
  attachment_id: '附件ID',
  operator_name: '操作人',
  operator_role: '操作角色',
  created_at: '创建时间',
  updated_at: '更新时间',
}

const initialAdvanceForm = {
  remark: '',
  inbound_tracking_no: '',
  outbound_tracking_no: '',
  receive_note: '',
  cpu_match: 'PASS',
  memory_match: 'PASS',
  disk_match: 'PASS',
  nic_match: 'PASS',
  serial_match: 'PASS',
  hardware_note: '',
  warehouse_location: '',
  warehouse_note: '',
  outbound_target: '',
  outbound_note: '',
  device_sn: '',
  os_name: '',
  os_version: '',
  install_mode: '',
  install_result: 'PASS',
  install_note: '',
  boot_test: 'PASS',
  network_test: 'PASS',
  stress_test: 'PASS',
  test_result: 'PASS',
  burnin_hours: '',
  test_note: '',
  approve_result: 'PASS',
  approve_note: '',
  reviewer_comment: '',
  package_check: 'PASS',
  accessory_check: 'PASS',
  box_no: '',
  pack_note: '',
  carrier: '',
  shipped_note: '',
  signature: '',
  dual_sign_token: '',
  expected_second_signer_sub: '',
}

const parseApiDate = (value) => {
  if (!value) return '-'
  const date = new Date(String(value).replace(' ', 'T'))
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

const stageText = (value) => {
  const key = String(value || '').toUpperCase()
  return stageLabelMap[key] || value || '-'
}

const timelineActionText = (value) => {
  const key = String(value || '').toUpperCase()
  return timelineActionLabelMap[key] || value || '-'
}

const auditActionText = (value) => {
  const key = String(value || '').toUpperCase()
  if (key.startsWith('STAGE_')) {
    const stageAction = key.slice(6)
    return timelineActionLabelMap[stageAction] || value || '-'
  }
  return auditActionLabelMap[key] || timelineActionLabelMap[key] || value || '-'
}

const auditMessageText = (value) => {
  const text = String(value || '').trim()
  if (!text) return '-'
  const stageAdvanceMatch = text.match(/^阶段推进\s+([A-Z_]+)\s*->\s*([A-Z_]+)$/i)
  if (stageAdvanceMatch) {
    return `阶段推进 ${stageText(stageAdvanceMatch[1])} → ${stageText(stageAdvanceMatch[2])}`
  }
  return Object.entries(stageLabelMap).reduce(
    (result, [code, label]) => result.replace(new RegExp(`\\b${code}\\b`, 'g'), label),
    text,
  )
}

const auditActionOptions = [
  { value: '', label: '全部动作' },
  ...Object.entries(auditActionLabelMap).map(([value, label]) => ({ value, label })),
  ...Object.entries(timelineActionLabelMap)
    .filter(([value]) => !['CREATE', 'REWORK'].includes(value))
    .map(([value, label]) => ({ value: `STAGE_${value}`, label })),
]

const roleText = (value) => {
  const key = normalizeRole(value)
  const map = {
    sysadmin: '系统管理员',
    admin: '管理员',
    auditor: '审计员',
    reviewer: '审核员',
    editor: '编辑员',
    user: '普通用户',
  }
  return map[key] || value || '-'
}

const getPortalBaseUrl = () => {
  const configured = String(import.meta.env.VITE_SSO_PORTAL_URL || '').trim()
  if (configured) return configured.replace(/\/+$/, '')
  const { protocol, hostname } = window.location
  return `${protocol}//${hostname}:5180`
}

const buildPortalEntryUrl = (system) => {
  const base = getPortalBaseUrl()
  return `${base}/portal?system=${encodeURIComponent(system)}`
}

const buildPortalSwitchUrl = (system) => {
  const base = getPortalBaseUrl()
  const params = new URLSearchParams()
  if (system) params.set('system', system)
  params.set('mode', 'switch')
  return `${base}/portal?${params.toString()}`
}

const portalSessionQueryKey = 'portal_session'
const portalSessionStorageKey = 'juxin_portal_session'

const readPortalSessionMarker = () => {
  try {
    return String(sessionStorage.getItem(portalSessionStorageKey) || '').trim()
  } catch {
    return ''
  }
}

const consumePortalSessionMarker = () => {
  try {
    const params = new URLSearchParams(window.location.search)
    const marker = String(params.get(portalSessionQueryKey) || '').trim()
    if (marker) {
      sessionStorage.setItem(portalSessionStorageKey, marker)
      params.delete(portalSessionQueryKey)
      const query = params.toString()
      const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash || ''}`
      window.history.replaceState({}, '', nextUrl)
      return marker
    }
  } catch {
    return ''
  }
  return readPortalSessionMarker()
}

const logoutFromSso = async () => {
  try {
    const csrfResp = await fetch(`${API_BASE}/api/auth/csrf`, { credentials: 'include' })
    if (!csrfResp.ok) return false
    let csrfToken = ''
    try {
      const csrfPayload = await csrfResp.json()
      csrfToken = String(csrfPayload?.token || '')
    } catch {
      csrfToken = ''
    }
    if (!csrfToken) return false
    const logoutResp = await fetch(`${API_BASE}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'X-CSRF-Token': csrfToken,
      },
    })
    return logoutResp.ok
  } catch {
    return false
  }
}

const downloadBlob = (blob, fileName) => {
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.URL.revokeObjectURL(url)
}

const normalizeRole = (role) => String(role || '').toLowerCase()

const roleCanDoAction = (role, action) => {
  const allowed = actionAllowedRoles[action] || []
  return allowed.includes(normalizeRole(role))
}

const formatStagePayload = (payload) => {
  if (!payload || typeof payload !== 'object') return []
  return Object.entries(payload)
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
    .map(([k, v]) => `${payloadLabelMap[k] || k}: ${v}`)
}

const buildStagePayloadByAction = (action, form) => {
  if (action === 'receive') {
    return { receive_note: form.receive_note }
  }
  if (action === 'hardware-check') {
    return {
      cpu_match: form.cpu_match,
      memory_match: form.memory_match,
      disk_match: form.disk_match,
      nic_match: form.nic_match,
      serial_match: form.serial_match,
      hardware_note: form.hardware_note,
    }
  }
  if (action === 'warehouse-after-hardware' || action === 'warehouse-after-pack') {
    return {
      warehouse_location: form.warehouse_location,
      warehouse_note: form.warehouse_note,
    }
  }
  if (action === 'outbound-for-install' || action === 'outbound-for-ship') {
    return {
      outbound_target: form.outbound_target,
      outbound_note: form.outbound_note,
    }
  }
  if (action === 'os-install') {
    return {
      device_sn: form.device_sn,
      os_name: form.os_name,
      os_version: form.os_version,
      install_mode: form.install_mode,
      install_result: form.install_result,
      install_note: form.install_note,
    }
  }
  if (action === 'test') {
    return {
      boot_test: form.boot_test,
      network_test: form.network_test,
      stress_test: form.stress_test,
      test_result: form.test_result,
      burnin_hours: form.burnin_hours,
      test_note: form.test_note,
    }
  }
  if (action === 'approve') {
    return {
      approve_result: form.approve_result,
      approve_note: form.approve_note,
      reviewer_comment: form.reviewer_comment,
    }
  }
  if (action === 'pack') {
    return {
      package_check: form.package_check,
      accessory_check: form.accessory_check,
      box_no: form.box_no,
      pack_note: form.pack_note,
    }
  }
  if (action === 'ship') {
    return {
      carrier: form.carrier,
      outbound_tracking_no: form.outbound_tracking_no,
      shipped_note: form.shipped_note,
    }
  }
  return null
}

const trimText = (value) => String(value || '').trim()

const deviceSnText = (value) => trimText(value) || '待安装后补录'

const ensureFailNote = (result, note, remark, label) => {
  if (result === 'FAIL' && !trimText(note) && !trimText(remark)) {
    return `${label}为不通过时，必须填写说明（备注或说明字段）`
  }
  return ''
}

const validateAdvanceForm = (action, form, currentUserId = '') => {
  const remark = trimText(form.remark)
  if (!action) return ''

  if (action === 'hardware-check') {
    const hasFail = [form.cpu_match, form.memory_match, form.disk_match, form.nic_match, form.serial_match].includes('FAIL')
    if (hasFail) return ensureFailNote('FAIL', form.hardware_note, remark, '硬件检查项')
    return ''
  }

  if (action === 'os-install') {
    if (!trimText(form.os_name)) return '系统名称不能为空'
    if (!trimText(form.os_version)) return '系统版本不能为空'
    return ensureFailNote(form.install_result, form.install_note, remark, '安装结果')
  }

  if (action === 'test') {
    if (!trimText(form.signature)) return '测试阶段双人复核要求填写电子签名'
    if (!trimText(form.dual_sign_token) && !trimText(form.expected_second_signer_sub)) return '请选择第二复签人'
    if (!trimText(form.dual_sign_token) && String(form.expected_second_signer_sub) === String(currentUserId || '')) return '第二复签人不能选择当前用户'
    if (trimText(form.burnin_hours)) {
      const burnin = Number(form.burnin_hours)
      if (!Number.isFinite(burnin) || burnin < 0 || burnin > 9999) return '老化时长必须是 0-9999 的数字'
    }
    return ensureFailNote(form.test_result, form.test_note, remark, '测试结论')
  }

  if (action === 'approve') {
    if (!trimText(form.signature)) return '审核阶段双人复核要求填写电子签名'
    if (!trimText(form.dual_sign_token) && !trimText(form.expected_second_signer_sub)) return '请选择第二复签人'
    if (!trimText(form.dual_sign_token) && String(form.expected_second_signer_sub) === String(currentUserId || '')) return '第二复签人不能选择当前用户'
    return ensureFailNote(form.approve_result, `${trimText(form.approve_note)}${trimText(form.reviewer_comment)}`, remark, '审核结论')
  }

  if (action === 'pack') {
    if (!trimText(form.box_no)) return '箱号不能为空'
    const hasFail = form.package_check === 'FAIL' || form.accessory_check === 'FAIL'
    if (hasFail) return ensureFailNote('FAIL', form.pack_note, remark, '装箱检查')
    return ''
  }

  if (action === 'ship') {
    if (!trimText(form.carrier)) return '物流公司不能为空'
    if (!trimText(form.outbound_tracking_no)) return '发货快递单号不能为空'
    return ''
  }

  return ''
}

const tryParseAuditData = (value) => {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'object') return value
  const text = String(value).trim()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch (_err) {
    return text
  }
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const isEqualForSummary = (a, b) => {
  if (a === b) return true
  if ((typeof a !== 'object' || a === null) || (typeof b !== 'object' || b === null)) return false
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch (_err) {
    return false
  }
}

const formatAuditValueBrief = (value) => {
  if (value === null || value === undefined || value === '') return '空'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '无效数字'
  if (typeof value === 'string') {
    const text = value.replace(/\s+/g, ' ').trim()
    if (!text) return '空'
    return text.length > 24 ? `${text.slice(0, 24)}...` : text
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '空数组'
    const primitive = value.every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item))
    if (primitive) {
      const joined = value.map((item) => formatAuditValueBrief(item)).join('、')
      return joined.length > 30 ? `${joined.slice(0, 30)}...` : joined
    }
    return `数组(${value.length}项)`
  }
  if (isPlainObject(value)) {
    const size = Object.keys(value).length
    return size > 0 ? `对象(${size}个字段)` : '空对象'
  }
  return String(value)
}

const auditFieldTokenLabelMap = {
  id: 'ID',
  job: '流转单',
  ticket: '工单',
  project: '项目',
  user: '用户',
  username: '用户名',
  role: '角色',
  status: '状态',
  stage: '阶段',
  action: '动作',
  type: '类型',
  name: '名称',
  code: '编码',
  sn: 'SN',
  device: '设备',
  customer: '客户',
  product: '产品',
  location: '位置',
  order: '单',
  inbound: '来件',
  outbound: '发货',
  tracking: '快递',
  carrier: '物流公司',
  remark: '备注',
  reason: '原因',
  created: '创建',
  updated: '更新',
  deleted: '删除',
  count: '数量',
  payload: '参数',
  record: '记录',
  attachment: '附件',
  file: '文件',
  size: '大小',
  enabled: '启用',
  threshold: '阈值',
  overdue: '超时',
  hours: '小时',
  minutes: '分钟',
  source: '来源',
  ip: '来源IP',
  request: '请求',
}

const formatFieldLabelByToken = (fieldKey) => {
  const text = String(fieldKey || '').trim()
  if (!text) return '-'
  if (/[\u4e00-\u9fa5]/.test(text)) return text
  const normalized = text.replace(/[\s.-]+/g, '_').toLowerCase()
  if (payloadLabelMap[normalized]) return payloadLabelMap[normalized]
  if (normalized.startsWith('is_')) {
    const rest = normalized.slice(3)
    const restLabel = rest.split('_').map((token) => auditFieldTokenLabelMap[token] || token).join('')
    return restLabel ? `是否${restLabel}` : text
  }
  if (normalized.endsWith('_id')) {
    const rest = normalized.slice(0, -3)
    const restLabel = rest.split('_').map((token) => auditFieldTokenLabelMap[token] || token).join('')
    return restLabel ? `${restLabel}ID` : text
  }
  if (normalized.endsWith('_at')) {
    const rest = normalized.slice(0, -3)
    const restLabel = rest.split('_').map((token) => auditFieldTokenLabelMap[token] || token).join('')
    return restLabel ? `${restLabel}时间` : text
  }
  const tokens = normalized.split('_').filter(Boolean)
  if (!tokens.length) return text
  return tokens.map((token) => auditFieldTokenLabelMap[token] || token).join('')
}

const fieldLabel = (key) => {
  const normalized = String(key || '').trim()
  if (!normalized) return '-'
  return payloadLabelMap[normalized] || formatFieldLabelByToken(normalized)
}

const buildAuditChangeSummary = (beforeData, afterData) => {
  const before = tryParseAuditData(beforeData)
  const after = tryParseAuditData(afterData)
  if (before === null && after === null) return '无变更'

  if (!isPlainObject(before) || !isPlainObject(after)) {
    if (before === null) return `新增：${formatAuditValueBrief(after)}`
    if (after === null) return `删除：${formatAuditValueBrief(before)}`
    if (isEqualForSummary(before, after)) return '无字段变化'
    return `由“${formatAuditValueBrief(before)}”变更为“${formatAuditValueBrief(after)}”`
  }

  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
  const changes = []
  for (const key of keys) {
    const hasBefore = Object.prototype.hasOwnProperty.call(before, key)
    const hasAfter = Object.prototype.hasOwnProperty.call(after, key)
    const label = fieldLabel(key)
    if (!hasBefore && hasAfter) {
      changes.push(`新增「${label}」：${formatAuditValueBrief(after[key])}`)
      continue
    }
    if (hasBefore && !hasAfter) {
      changes.push(`移除「${label}」`)
      continue
    }
    if (!isEqualForSummary(before[key], after[key])) {
      changes.push(`「${label}」由“${formatAuditValueBrief(before[key])}”改为“${formatAuditValueBrief(after[key])}”`)
    }
  }
  if (!changes.length) return '无字段变化'
  const preview = changes.slice(0, 3).join('；')
  return changes.length > 3 ? `${preview}；等${changes.length}项变更` : preview
}

const batchPayloadTemplateMap = {
  receive: { receive_note: '批量收货' },
  'hardware-check': {
    cpu_match: 'PASS',
    memory_match: 'PASS',
    disk_match: 'PASS',
    nic_match: 'PASS',
    serial_match: 'PASS',
    hardware_note: '',
  },
  'warehouse-after-hardware': { warehouse_location: '', warehouse_note: '硬件检查后入库' },
  'outbound-for-install': { outbound_target: '系统安装', outbound_note: '系统安装前出库' },
  'os-install': { device_sn: '', os_name: 'JXOS', os_version: '1.0.0', install_result: 'PASS', install_note: '' },
  test: { boot_test: 'PASS', network_test: 'PASS', stress_test: 'PASS', test_result: 'PASS', test_note: '' },
  approve: { approve_result: 'PASS', approve_note: '批量审核通过' },
  pack: { package_check: 'PASS', accessory_check: 'PASS', box_no: 'BOX-BATCH-001', pack_note: '' },
  'warehouse-after-pack': { warehouse_location: '', warehouse_note: '装箱后入库' },
  'outbound-for-ship': { outbound_target: '客户发货', outbound_note: '发货前出库' },
  ship: { carrier: 'SF', shipped_note: '批量发货' },
}

const cloneBatchPayloadTemplate = (action) => ({ ...(batchPayloadTemplateMap[action] || {}) })

const parseBatchJobIdsText = (value) => {
  const text = String(value || '').trim()
  if (!text) return []
  return Array.from(
    new Set(
      text
        .split(/[\s,，]+/)
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0),
    ),
  )
}

const defaultAttachmentUploadSetting = {
  max_file_size_mb: 10,
  max_file_size_bytes: 10 * 1024 * 1024,
  min_file_size_mb: 1,
  max_allowed_file_size_mb: 200,
}

const defaultPermissionEffective = {
  loaded: false,
  menus: {},
  buttons: {},
  stageActions: {},
}

const detailTabs = [
  { key: 'advance', label: '执行推进' },
  { key: 'attachments', label: '附件留证' },
  { key: 'responsibility', label: '责任节点' },
  { key: 'rework', label: '退回处理' },
  { key: 'history', label: '流转记录' },
]

const formatFileSize = (bytes) => {
  const size = Number(bytes || 0)
  if (!Number.isFinite(size) || size < 0) return '-'
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(size >= 10 * 1024 * 1024 ? 1 : 2)} MB`
  if (size >= 1024) return `${Math.round(size / 1024)} KB`
  return `${Math.round(size)} B`
}

function App() {
  const [token, setToken] = useState('')
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [activeMenu, setActiveMenu] = useState('jobs')

  const [jobs, setJobs] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [limit] = useState(20)
  const [filters, setFilters] = useState({ keyword: '', stage: '' })

  const [selectedJobId, setSelectedJobId] = useState(0)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [detailModalPosition, setDetailModalPosition] = useState({ x: 0, y: 0 })
  const [detailModalDragging, setDetailModalDragging] = useState(false)
  const [activeDetailTab, setActiveDetailTab] = useState('advance')
  const detailModalRef = useRef(null)
  const detailModalDragRef = useRef(null)

  const [createForm, setCreateForm] = useState({
    device_sn: '',
    customer_name: '',
    sales_order_no: '',
    inbound_tracking_no: '',
    remark: '',
  })

  const [advanceForm, setAdvanceForm] = useState({ ...initialAdvanceForm })
  const [selectedAdvanceAction, setSelectedAdvanceAction] = useState('')

  const [reworkForm, setReworkForm] = useState({
    target_stage: 'RECEIVED',
    reason: '',
    remark: '',
  })

  const [attachmentForm, setAttachmentForm] = useState({
    stage_code: '',
    remark: '',
    file: null,
  })
  const [attachmentUploadSetting, setAttachmentUploadSetting] = useState(defaultAttachmentUploadSetting)
  const [attachmentUploadSettingForm, setAttachmentUploadSettingForm] = useState(String(defaultAttachmentUploadSetting.max_file_size_mb))
  const [attachmentUploadSettingLoading, setAttachmentUploadSettingLoading] = useState(false)
  const [systemUsers, setSystemUsers] = useState([])
  const [systemUsersLoading, setSystemUsersLoading] = useState(false)
  const [permissionEffective, setPermissionEffective] = useState(defaultPermissionEffective)
  const [permissionMeta, setPermissionMeta] = useState(null)
  const [permissionPolicies, setPermissionPolicies] = useState([])
  const [permissionPolicyDrafts, setPermissionPolicyDrafts] = useState([])
  const [permissionLoading, setPermissionLoading] = useState(false)

  const [dashboard, setDashboard] = useState(null)
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const [dashboardOverdueDays, setDashboardOverdueDays] = useState(3)
  const [dashboardFilter, setDashboardFilter] = useState({ stage: '', customer: '' })

  const [auditFilter, setAuditFilter] = useState({ from: '', to: '', action: '', keyword: '', username: '' })
  const [auditLogs, setAuditLogs] = useState([])
  const [auditTotal, setAuditTotal] = useState(0)
  const [auditPage, setAuditPage] = useState(1)
  const [auditLimit] = useState(20)
  const [auditLoading, setAuditLoading] = useState(false)

  const [slaData, setSlaData] = useState(null)
  const [slaLoading, setSlaLoading] = useState(false)
  const [slaRuleForm, setSlaRuleForm] = useState([])
  const [slaRunResult, setSlaRunResult] = useState(null)
  const [slaReminderPage, setSlaReminderPage] = useState(1)
  const [slaReminderTotal, setSlaReminderTotal] = useState(0)
  const [slaReminderLimit] = useState(10)

  const [batchImportFile, setBatchImportFile] = useState(null)
  const [batchImportResult, setBatchImportResult] = useState(null)
  const [batchExportFilter, setBatchExportFilter] = useState({ keyword: '', customer: '', stage: '' })
  const [batchStageForm, setBatchStageForm] = useState({
    action: 'receive',
    job_ids_text: '',
    remark: '',
    inbound_tracking_no: '',
    outbound_tracking_no: '',
    stage_payload_json: JSON.stringify(batchPayloadTemplateMap.receive, null, 2),
  })
  const [batchStagePayloadForm, setBatchStagePayloadForm] = useState(cloneBatchPayloadTemplate('receive'))
  const [batchStageAdvancedMode, setBatchStageAdvancedMode] = useState(false)
  const [batchStageResult, setBatchStageResult] = useState(null)

  const [auditVerifyForm, setAuditVerifyForm] = useState({ from_id: '', to_id: '', limit: 5000 })
  const [auditVerifyResult, setAuditVerifyResult] = useState(null)
  const [auditVerifyLoading, setAuditVerifyLoading] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    title: '',
    message: '',
    confirmLabel: '确认',
    onConfirm: null,
  })

  const isBaseWriter = user?.role === 'admin' || user?.role === 'sysadmin'
  const isAuditOnlyUser = normalizeRole(user?.role) === 'auditor'
  const permissionMenuFallback = (key) => {
    if (isAuditOnlyUser) return ['audit', 'audit-verify'].includes(key)
    if (isBaseWriter) return ['dashboard', 'sla', 'batch', 'jobs', 'create', 'permissions'].includes(key)
    return ['dashboard', 'jobs'].includes(key)
  }
  const permissionButtonFallback = (key) => {
    if (['auditExport', 'auditVerify'].includes(key)) return isAuditOnlyUser
    return isBaseWriter
  }
  const permissionMenuAllowed = (key) => {
    if (permissionEffective.loaded) return permissionEffective.menus?.[key] === true
    return permissionMenuFallback(key)
  }
  const permissionButtonAllowed = (key) => {
    if (permissionEffective.loaded) return permissionEffective.buttons?.[key] === true
    return permissionButtonFallback(key)
  }
  const permissionStageActionAllowed = (action) => {
    if (permissionEffective.loaded) return permissionEffective.stageActions?.[action] === true
    return roleCanDoAction(user?.role, action)
  }
  const canCreateJob = permissionButtonAllowed('createJob')
  const canBatchImport = permissionButtonAllowed('batchImport')
  const canBatchStage = permissionButtonAllowed('batchStage')
  const canUpload = permissionButtonAllowed('attachmentUpload')
  const canRework = permissionButtonAllowed('rework')
  const canDeleteAttachment = permissionButtonAllowed('attachmentDelete')
  const canEditSla = permissionButtonAllowed('slaWrite')
  const canRunSla = permissionButtonAllowed('slaRun')
  const canDeleteSlaReminder = permissionButtonAllowed('slaReminderDelete')
  const canManagePermissions = permissionButtonAllowed('permissionManage')
  const canEditAttachmentUploadSetting = permissionButtonAllowed('attachmentSettings')
  const canReadAuditLogs = isAuditOnlyUser && permissionMenuAllowed('audit')
  const sidebarMenuItems = useMemo(() => {
    const items = [
      { key: 'dashboard', label: '看板总览' },
      { key: 'sla', label: 'SLA催办' },
      { key: 'batch', label: '批量处理' },
      { key: 'jobs', label: '流转单列表' },
      { key: 'create', label: '新建流转单' },
      { key: 'permissions', label: '权限设置' },
      { key: 'audit', label: '审计日志' },
      { key: 'audit-verify', label: '审计验签' },
    ]
    return items.filter((item) => permissionMenuAllowed(item.key))
  }, [permissionEffective, isAuditOnlyUser, isBaseWriter])
  const detailMatchesSelection = Number(detail?.id || 0) === Number(selectedJobId || 0)

  const stageOptions = useMemo(
    () => [
      { value: '', label: '全部阶段' },
      ...Object.entries(stageLabelMap).map(([value, label]) => ({ value, label })),
    ],
    [],
  )

  const batchActionOptions = useMemo(
    () => Object.entries(actionLabelMap).map(([value, label]) => ({ value, label })),
    [],
  )

  const permissionActionOptions = useMemo(() => {
    const meta = permissionMeta || {}
    const menuOptions = (Array.isArray(meta.menus) ? meta.menus : []).map((item) => ({
      value: item.code,
      label: `菜单：${item.label || item.key}`,
    }))
    const buttonOptions = (Array.isArray(meta.buttons) ? meta.buttons : []).map((item) => ({
      value: item.code,
      label: `按钮：${item.label || item.key}`,
    }))
    const stageOptions = (Array.isArray(meta.stage_actions) ? meta.stage_actions : []).map((item) => ({
      value: item.action_code,
      label: `流程动作：${item.label || item.action}`,
      stage_code: item.stage_code,
    }))
    return [...menuOptions, ...buttonOptions, ...stageOptions]
  }, [permissionMeta])

  const permissionUserOptions = useMemo(
    () =>
      (Array.isArray(systemUsers) ? systemUsers : []).map((item) => ({
        value: String(item.id),
        label: `${item.username} · ${roleText(item.role)}${item.department_code ? ` · ${item.department_code}` : ''}`,
        name: item.username,
        role: item.role,
        department_code: item.department_code || '*',
      })),
    [systemUsers],
  )

  const permissionOverviewGroups = useMemo(() => {
    const meta = permissionMeta || {}
    const menus = Array.isArray(meta.menus) ? meta.menus : []
    const buttons = Array.isArray(meta.buttons) ? meta.buttons : []
    const stageActions = Array.isArray(meta.stage_actions) ? meta.stage_actions : []
    return [
      {
        title: '菜单权限',
        description: '决定用户登录后能看到哪些业务页面。',
        rows: menus.map((item) => ({
          key: item.key || item.code,
          label: item.label || item.key || item.code,
          allowed: permissionMenuAllowed(item.key),
        })),
      },
      {
        title: '操作权限',
        description: '控制上传、删除、批量、SLA、权限管理等按钮。',
        rows: buttons.map((item) => ({
          key: item.key || item.code,
          label: item.label || item.key || item.code,
          allowed: permissionButtonAllowed(item.key),
        })),
      },
      {
        title: '阶段权限',
        description: '控制用户能否推进收货、检查、安装、审核、发货等节点。',
        rows: stageActions.map((item) => ({
          key: item.action || item.action_code,
          label: item.label || actionLabelMap[item.action] || item.action,
          allowed: permissionStageActionAllowed(item.action),
        })),
      },
    ]
  }, [permissionMeta, permissionEffective, user?.role])

  const currentStage = detail ? String(detail.current_stage || '').toUpperCase() : ''
  const availableNextActions = detail
    ? optionalNextActionsByStage[currentStage] || (nextActionByStage[currentStage] ? [nextActionByStage[currentStage]] : [])
    : []
  const nextAction = availableNextActions.includes(selectedAdvanceAction)
    ? selectedAdvanceAction
    : (availableNextActions[0] || '')
  const nextStageCode = nextAction ? String(({
    receive: 'RECEIVED',
    'hardware-check': 'HARDWARE_CHECKED',
    'warehouse-after-hardware': 'WAREHOUSED_AFTER_HARDWARE',
    'outbound-for-install': 'OUTBOUNDED_FOR_INSTALL',
    'os-install': 'OS_INSTALLED',
    test: 'TESTED',
    approve: 'APPROVED',
    pack: 'PACKED',
    'warehouse-after-pack': 'WAREHOUSED_AFTER_PACK',
    'outbound-for-ship': 'OUTBOUNDED_FOR_SHIP',
    ship: 'SHIPPED',
  }[nextAction] || '')).toUpperCase() : ''
  const canRunNextAction = permissionStageActionAllowed(nextAction)
  const workflowSteps = useMemo(() => {
    if (!detail) return []
    const currentIndex = stageSequence.indexOf(currentStage)
    return stageSequence
      .filter((stage) => stage !== 'CREATED')
      .map((stage) => {
        const index = stageSequence.indexOf(stage)
        const state = stage === currentStage ? 'current' : (currentIndex >= 0 && index < currentIndex ? 'done' : 'todo')
        return {
          stage,
          state,
          label: stageText(stage),
          context: stageContextMap[stage] || '',
        }
      })
  }, [detail, currentStage])
  const attachmentCountByStage = useMemo(() => {
    const map = {}
    const attachments = Array.isArray(detail?.attachments) ? detail.attachments : []
    attachments.forEach((item) => {
      const stage = String(item.stage_code || '').toUpperCase()
      if (!stage) return
      map[stage] = (map[stage] || 0) + 1
    })
    return map
  }, [detail])
  const evidenceStageCode = nextStageCode || currentStage
  const evidenceStageCount = Number(attachmentCountByStage[evidenceStageCode] || 0)
  const evidenceRequired = evidenceStageCode === 'HARDWARE_CHECKED' || evidenceStageCode === 'TESTED'
  const evidenceStatusText = evidenceRequired ? (evidenceStageCount > 0 ? '已满足' : '待补充') : '按需上传'
  const responsibilityRows = useMemo(() => {
    if (!detail) return []
    const records = Array.isArray(detail.stage_records) ? detail.stage_records : []
    const latestByStage = new Map()
    records.forEach((item) => {
      const stage = String(item.to_stage || '').toUpperCase()
      if (stage && !latestByStage.has(stage)) latestByStage.set(stage, item)
    })
    const fallbackByStage = {
      RECEIVED: { by: detail.received_by_name, role: detail.received_by_role, at: detail.received_at },
      HARDWARE_CHECKED: { by: detail.hardware_checked_by_name, role: detail.hardware_checked_by_role, at: detail.hardware_checked_at },
      OS_INSTALLED: { by: detail.os_installed_by_name, role: detail.os_installed_by_role, at: detail.os_installed_at },
      TESTED: { by: detail.tested_by_name, role: detail.tested_by_role, at: detail.tested_at },
      APPROVED: { by: detail.approved_by_name, role: detail.approved_by_role, at: detail.approved_at },
      PACKED: { by: detail.packed_by_name, role: detail.packed_by_role, at: detail.packed_at },
      SHIPPED: { by: detail.shipped_by_name, role: detail.shipped_by_role, at: detail.shipped_at },
    }
    return stageSequence
      .filter((stage) => stage !== 'CREATED')
      .map((stage) => {
        const record = latestByStage.get(stage)
        if (record) {
          return {
            stage,
            by: record.operator_name,
            role: record.operator_role,
            at: record.operated_at,
          }
        }
        return { stage, ...(fallbackByStage[stage] || {}) }
      })
  }, [detail])

  const reworkTargetOptions = useMemo(() => {
    if (!detail) return []
    const current = String(detail.current_stage || '').toUpperCase()
    const currentIndex = stageSequence.indexOf(current)
    if (currentIndex <= 0) return []
    return stageSequence.slice(0, currentIndex).map((stage) => ({ value: stage, label: stageLabelMap[stage] || stage }))
  }, [detail])

  const dualSignUserOptions = useMemo(
    () =>
      (Array.isArray(systemUsers) ? systemUsers : [])
        .filter((item) => ['admin', 'sysadmin'].includes(normalizeRole(item?.role)))
        .map((item) => ({
          value: String(item.id),
          label: `${item.username} · ${item.role}`,
        })),
    [systemUsers],
  )

  const summary = useMemo(() => {
    const byStage = jobs.reduce((acc, item) => {
      const key = String(item.current_stage || '').toUpperCase()
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})

    return {
      total,
      pending: (byStage.CREATED || 0) + (byStage.RECEIVED || 0) + (byStage.HARDWARE_CHECKED || 0),
      testing: (byStage.OS_INSTALLED || 0) + (byStage.TESTED || 0) + (byStage.APPROVED || 0),
      shipped: byStage.SHIPPED || 0,
    }
  }, [jobs, total])

  const dashboardStageMap = useMemo(() => {
    const map = {}
    const rows = Array.isArray(dashboard?.stage_counts) ? dashboard.stage_counts : []
    rows.forEach((item) => {
      const key = String(item?.stage || '').toUpperCase()
      if (!key) return
      map[key] = Number(item?.total || 0)
    })
    return map
  }, [dashboard])

  const heroSummary = useMemo(() => {
    if (!dashboard) {
      return {
        total: summary.total,
        processing: summary.pending + summary.testing,
        shipped: summary.shipped,
      }
    }

    return {
      total: Number(dashboard?.totals?.total_jobs || 0),
      processing: Number(dashboard?.totals?.open_jobs || 0),
      shipped: Number(dashboardStageMap.SHIPPED || 0),
    }
  }, [dashboard, summary, dashboardStageMap])

  const showError = (msg) => {
    setErrorMsg(msg || '操作失败')
    setSuccessMsg('')
  }

  const showSuccess = (msg) => {
    setSuccessMsg(msg || '操作成功')
    setErrorMsg('')
  }

  const clearTips = () => {
    setErrorMsg('')
    setSuccessMsg('')
  }

  const openConfirmDialog = ({ title = '确认操作', message = '', confirmLabel = '确认', onConfirm }) => {
    setConfirmDialog({
      open: true,
      title,
      message,
      confirmLabel,
      onConfirm: typeof onConfirm === 'function' ? onConfirm : null,
    })
  }

  const closeConfirmDialog = () => {
    setConfirmDialog((prev) => ({ ...prev, open: false, onConfirm: null }))
  }

  const onConfirmDialogAccept = async () => {
    const callback = confirmDialog.onConfirm
    closeConfirmDialog()
    if (!callback) return
    await callback()
  }

  const isPassFailValue = (value) => {
    const normalized = String(value || '').toUpperCase()
    return normalized === 'PASS' || normalized === 'FAIL'
  }

  const updateBatchStagePayloadField = (key, value) => {
    setBatchStagePayloadForm((prev) => {
      const next = { ...prev, [key]: value }
      setBatchStageForm((current) => ({
        ...current,
        stage_payload_json: JSON.stringify(next, null, 2),
      }))
      return next
    })
  }

  const toggleBatchStageAdvancedMode = () => {
    if (batchStageAdvancedMode) {
      const text = trimText(batchStageForm.stage_payload_json)
      if (!text) {
        setBatchStagePayloadForm({})
      } else {
        try {
          const parsed = JSON.parse(text)
          if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
            return showError('阶段 payload 必须是 JSON 对象')
          }
          setBatchStagePayloadForm(parsed)
        } catch (_err) {
          return showError('阶段 payload 不是合法 JSON')
        }
      }
    } else {
      setBatchStageForm((prev) => ({
        ...prev,
        stage_payload_json: JSON.stringify(batchStagePayloadForm, null, 2),
      }))
    }
    setBatchStageAdvancedMode((prev) => !prev)
  }

  const onLogout = async () => {
    await logoutFromSso()
    setToken('')
    setUser(null)
    window.location.href = buildPortalEntryUrl('device-flow')
  }

  const apiRequest = async (path, options = {}) => {
    const isFormData = Boolean(options.formData)
    const headers = {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options.headers || {}),
    }

    const response = await fetch(`${API_BASE}${path}`, {
      method: options.method || 'GET',
      headers,
      credentials: 'include',
      body: isFormData ? options.body : options.body ? JSON.stringify(options.body) : undefined,
    })

    if (options.expectBlob) {
      if (!response.ok) {
        throw new Error(`请求失败 (${response.status})`)
      }
      return response.blob()
    }

    let payload = null
    try {
      payload = await response.json()
    } catch (_err) {
      payload = null
    }

    if (!response.ok) {
      if (response.status === 401) {
        setToken('')
        setUser(null)
      }
      throw new Error(payload?.error || `请求失败 (${response.status})`)
    }

    if (options.withMeta) {
      return {
        data: payload,
        meta: {
          totalCount: Number(response.headers.get('x-total-count') || 0),
          page: Number(response.headers.get('x-page') || 0),
          limit: Number(response.headers.get('x-limit') || 0),
        },
      }
    }

    return payload
  }

  const refreshJobs = async () => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('limit', String(limit))
    if (filters.keyword) params.set('keyword', filters.keyword)
    if (filters.stage) params.set('stage', filters.stage)

    const result = await apiRequest(`/api/device-flow/jobs?${params.toString()}`, { withMeta: true })
    const rows = Array.isArray(result?.data) ? result.data : []
    setJobs(rows)
    setTotal(Number(result?.meta?.totalCount || 0))

    if (!selectedJobId && rows.length > 0) {
      setSelectedJobId(Number(rows[0].id || 0))
    }

    return rows
  }

  const refreshDetail = async (id = selectedJobId) => {
    const targetId = Number(id || 0)
    if (!targetId) {
      setDetail(null)
      setDetailLoading(false)
      return
    }
    setDetailLoading(true)
    try {
      const data = await apiRequest(`/api/device-flow/jobs/${targetId}`)
      setDetail(data)
      setAttachmentForm((prev) => ({
        ...prev,
        stage_code: String(data?.current_stage || '').toUpperCase() || prev.stage_code,
      }))
    } finally {
      setDetailLoading(false)
    }
  }

  const buildDashboardParams = (overrides = {}) => {
    const safeOverdueDays = Math.min(30, Math.max(1, Number(overrides.overdueDays ?? dashboardOverdueDays ?? 3)))
    const stage = String(overrides.stage ?? dashboardFilter.stage ?? '').toUpperCase()
    const customer = String(overrides.customer ?? dashboardFilter.customer ?? '').trim()
    const params = new URLSearchParams()
    params.set('overdue_days', String(safeOverdueDays))
    if (stage) params.set('stage', stage)
    if (customer) params.set('customer', customer)
    return params
  }

  const refreshDashboard = async (overrides = {}) => {
    setDashboardLoading(true)
    try {
      const params = buildDashboardParams(overrides)
      const data = await apiRequest(`/api/device-flow/dashboard/summary?${params.toString()}`)
      setDashboard(data)
    } finally {
      setDashboardLoading(false)
    }
  }

  const refreshAuditLogs = async () => {
    setAuditLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('page', String(auditPage))
      params.set('limit', String(auditLimit))
      if (auditFilter.from) params.set('from', auditFilter.from)
      if (auditFilter.to) params.set('to', auditFilter.to)
      if (auditFilter.action) params.set('action', auditFilter.action)
      if (auditFilter.username) params.set('username', auditFilter.username)
      if (auditFilter.keyword) params.set('keyword', auditFilter.keyword)
      const result = await apiRequest(`/api/device-flow/logs?${params.toString()}`, { withMeta: true })
      const rows = Array.isArray(result?.data) ? result.data : []
      setAuditLogs(rows)
      setAuditTotal(Number(result?.meta?.totalCount || 0))
    } finally {
      setAuditLoading(false)
    }
  }

  const refreshSlaSummary = async (overrides = {}) => {
    setSlaLoading(true)
    try {
      const targetPageRaw = Number(overrides.page ?? slaReminderPage)
      const targetPage = Number.isInteger(targetPageRaw) && targetPageRaw > 0 ? targetPageRaw : 1
      const params = new URLSearchParams()
      params.set('page', String(targetPage))
      params.set('limit', String(slaReminderLimit))
      const data = await apiRequest(`/api/device-flow/sla/summary?${params.toString()}`)
      setSlaData(data)
      setSlaReminderTotal(Number(data?.reminder_paging?.total || 0))
      setSlaReminderPage(Number(data?.reminder_paging?.page || targetPage))
      const rules = Array.isArray(data?.rules) ? data.rules : []
      setSlaRuleForm(
        rules.map((item) => ({
          stage_code: item.stage_code,
          stage_label: item.stage_label || stageText(item.stage_code),
          threshold_hours: Number(item.threshold_hours || 0),
          remind_interval_minutes: Number(item.remind_interval_minutes || 0),
          enabled: Boolean(item.enabled),
        })),
      )
    } finally {
      setSlaLoading(false)
    }
  }

  const refreshAttachmentUploadSetting = async () => {
    setAttachmentUploadSettingLoading(true)
    try {
      const data = await apiRequest('/api/device-flow/settings/attachment-upload')
      const next = {
        ...defaultAttachmentUploadSetting,
        ...(data || {}),
      }
      setAttachmentUploadSetting(next)
      setAttachmentUploadSettingForm(String(Number(next.max_file_size_mb || defaultAttachmentUploadSetting.max_file_size_mb)))
      return next
    } finally {
      setAttachmentUploadSettingLoading(false)
    }
  }

  const normalizePermissionPolicyDraft = (item = {}) => {
    const actionCodes = Array.isArray(item.selected_action_codes)
      ? item.selected_action_codes
      : [item.action_code || 'menu.jobs']
    return {
      user_sub: trimText(item.user_sub || ''),
      user_name: trimText(item.user_name || ''),
      role_code: trimText(item.role_code || '*').toLowerCase() || '*',
      department_code: trimText(item.department_code || '*').toUpperCase() || '*',
      action_code: trimText(item.action_code || actionCodes[0] || 'menu.jobs').toLowerCase() || 'menu.jobs',
      selected_action_codes: Array.from(new Set(actionCodes.map((code) => trimText(code).toLowerCase()).filter(Boolean))),
      stage_code: trimText(item.stage_code || '*').toUpperCase() || '*',
      effect: trimText(item.effect || 'ALLOW').toUpperCase() === 'DENY' ? 'DENY' : 'ALLOW',
      enabled: item.enabled === undefined ? true : Boolean(item.enabled),
      note: trimText(item.note || ''),
    }
  }

  const refreshPermissionEffective = async () => {
    const data = await apiRequest('/api/device-flow/permissions/effective')
    setPermissionEffective({
      loaded: true,
      menus: data?.menus || {},
      buttons: data?.buttons || {},
      stageActions: data?.stageActions || {},
    })
    return data
  }

  const refreshPermissionSettings = async () => {
    setPermissionLoading(true)
    try {
      const [meta, policies] = await Promise.all([
        apiRequest('/api/device-flow/permissions/meta'),
        apiRequest('/api/device-flow/permissions/policies'),
      ])
      const rows = Array.isArray(policies) ? policies : []
      setPermissionMeta(meta || null)
      setPermissionPolicies(rows)
      setPermissionPolicyDrafts(rows.map(normalizePermissionPolicyDraft))
    } finally {
      setPermissionLoading(false)
    }
  }

  const onAddPermissionPolicy = () => {
    setPermissionPolicyDrafts((prev) => [
      ...prev,
      normalizePermissionPolicyDraft({
        user_sub: '',
        user_name: '',
        role_code: '*',
        department_code: '*',
        action_code: 'menu.jobs',
        selected_action_codes: ['menu.jobs'],
        stage_code: '*',
        effect: 'ALLOW',
        enabled: true,
        note: '',
      }),
    ])
  }

  const updatePermissionPolicyDraft = (index, patch) => {
    setPermissionPolicyDrafts((prev) =>
      prev.map((item, idx) => (idx === index ? normalizePermissionPolicyDraft({ ...item, ...patch }) : item)),
    )
  }

  const removePermissionPolicyDraft = (index) => {
    setPermissionPolicyDrafts((prev) => prev.filter((_item, idx) => idx !== index))
  }

  const onSavePermissionPolicies = async () => {
    if (!canManagePermissions) return showError('当前角色无权限保存权限策略')
    if (permissionPolicyDrafts.length === 0) return showError('请至少保留一条权限策略')
    try {
      setPermissionLoading(true)
      const rows = permissionPolicyDrafts.flatMap((item) => {
        const normalized = normalizePermissionPolicyDraft(item)
        const codes = normalized.selected_action_codes.length ? normalized.selected_action_codes : [normalized.action_code]
        const userOption = permissionUserOptions.find((entry) => entry.value === normalized.user_sub)
        return codes.map((code) => {
          const option = permissionActionOptions.find((entry) => entry.value === code)
          return {
            ...normalized,
            user_name: userOption?.name || normalized.user_name,
            role_code: userOption?.role || normalized.role_code,
            department_code: userOption?.department_code || normalized.department_code,
            action_code: code,
            stage_code: option?.stage_code || normalized.stage_code || '*',
          }
        })
      })
      if (rows.some((item) => !item.user_sub)) return showError('请选择用户')
      const saved = await apiRequest('/api/device-flow/permissions/policies', {
        method: 'PUT',
        body: { policies: rows },
      })
      const nextRows = Array.isArray(saved) ? saved : []
      setPermissionPolicies(nextRows)
      setPermissionPolicyDrafts(nextRows.map(normalizePermissionPolicyDraft))
      await refreshPermissionEffective()
      showSuccess(`权限策略已保存，共 ${nextRows.length} 条`)
    } catch (err) {
      showError(err.message)
    } finally {
      setPermissionLoading(false)
    }
  }

  const refreshSystemUsers = async () => {
    setSystemUsersLoading(true)
    try {
      const rows = await apiRequest('/api/auth/system-users?system=device-flow')
      setSystemUsers(Array.isArray(rows) ? rows : [])
    } finally {
      setSystemUsersLoading(false)
    }
  }

  const onSaveAttachmentUploadSetting = async () => {
    if (!canEditAttachmentUploadSetting) return showError('当前角色无权限修改附件上传配置')
    const maxFileSizeMb = Number(attachmentUploadSettingForm)
    const minFileSizeMb = Number(attachmentUploadSetting?.min_file_size_mb || 1)
    const maxAllowedFileSizeMb = Number(attachmentUploadSetting?.max_allowed_file_size_mb || 200)
    if (!Number.isInteger(maxFileSizeMb) || maxFileSizeMb < minFileSizeMb || maxFileSizeMb > maxAllowedFileSizeMb) {
      return showError(`附件上传上限必须是 ${minFileSizeMb}-${maxAllowedFileSizeMb} 的整数 MB`)
    }
    try {
      setAttachmentUploadSettingLoading(true)
      const data = await apiRequest('/api/device-flow/settings/attachment-upload', {
        method: 'PUT',
        body: { max_file_size_mb: maxFileSizeMb },
      })
      const next = {
        ...defaultAttachmentUploadSetting,
        ...(data || {}),
      }
      setAttachmentUploadSetting(next)
      setAttachmentUploadSettingForm(String(Number(next.max_file_size_mb || maxFileSizeMb)))
      showSuccess(`附件上传上限已保存为 ${Number(next.max_file_size_mb || maxFileSizeMb)}MB`)
    } catch (err) {
      showError(err.message)
    } finally {
      setAttachmentUploadSettingLoading(false)
    }
  }

  const onDeleteSlaReminder = async (item) => {
    const reminderId = Number(item?.id || 0)
    if (!reminderId) return showError('催办记录ID无效')
    if (!canDeleteSlaReminder) return showError('当前角色无权限删除催办记录')
    openConfirmDialog({
      title: '删除催办记录',
      message: `确认删除催办记录 #${reminderId}？删除后不可恢复。`,
      confirmLabel: '确认删除',
      onConfirm: async () => {
        try {
          setBusy(true)
          await apiRequest(`/api/device-flow/sla/reminders/${reminderId}`, { method: 'DELETE' })
          showSuccess('催办记录删除成功')
          await refreshSlaSummary({ page: slaReminderPage })
        } catch (err) {
          showError(err.message)
        } finally {
          setBusy(false)
        }
      },
    })
  }

  const onClearSlaReminders = async () => {
    if (!canDeleteSlaReminder) return showError('当前角色无权限删除催办记录')
    openConfirmDialog({
      title: '一键清空催办记录',
      message: '确认清空全部催办记录？该操作不可恢复。',
      confirmLabel: '确认清空',
      onConfirm: async () => {
        try {
          setBusy(true)
          const result = await apiRequest('/api/device-flow/sla/reminders', { method: 'DELETE' })
          showSuccess(`已删除 ${Number(result?.deleted || 0)} 条催办记录`)
          setSlaReminderPage(1)
          await refreshSlaSummary({ page: 1 })
        } catch (err) {
          showError(err.message)
        } finally {
          setBusy(false)
        }
      },
    })
  }

  const onSaveSlaRules = async () => {
    if (!canEditSla) return showError('当前角色无权限修改 SLA 规则')
    try {
      setBusy(true)
      const rules = slaRuleForm.map((item) => ({
        stage_code: item.stage_code,
        threshold_hours: Number(item.threshold_hours || 0),
        remind_interval_minutes: Number(item.remind_interval_minutes || 0),
        enabled: Boolean(item.enabled),
      }))
      await apiRequest('/api/device-flow/sla/rules', {
        method: 'PUT',
        body: { rules },
      })
      showSuccess('SLA 规则已保存')
      await refreshSlaSummary()
    } catch (err) {
      showError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const onRunSlaNow = async () => {
    if (!canRunSla) return showError('当前角色无权限执行催办')
    try {
      setBusy(true)
      const result = await apiRequest('/api/device-flow/sla/run', {
        method: 'POST',
        body: { max_scan: 300 },
      })
      setSlaRunResult(result)
      showSuccess(`本次催办执行完成，触发 ${Number(result?.triggered || 0)} 条`)
      await refreshSlaSummary()
    } catch (err) {
      showError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const onBatchDownloadTemplate = async () => {
    try {
      setBusy(true)
      const response = await fetch(`${API_BASE}/api/device-flow/templates/jobs-import.xlsx`, {
        method: 'GET',
        credentials: 'include',
      })
      if (!response.ok) {
        let message = `下载失败 (${response.status})`
        try {
          const payload = await response.json()
          if (payload?.error) message = payload.error
        } catch (_err) {
          // ignore
        }
        throw new Error(message)
      }
      const blob = await response.blob()
      downloadBlob(blob, 'device-flow-import-template.xlsx')
      showSuccess('模板下载成功')
    } catch (err) {
      showError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const onBatchExportJobs = async () => {
    try {
      setBusy(true)
      const params = new URLSearchParams()
      if (batchExportFilter.keyword) params.set('keyword', batchExportFilter.keyword)
      if (batchExportFilter.customer) params.set('customer', batchExportFilter.customer)
      if (batchExportFilter.stage) params.set('stage', batchExportFilter.stage)
      const response = await fetch(`${API_BASE}/api/device-flow/reports/jobs.xlsx?${params.toString()}`, {
        method: 'GET',
        credentials: 'include',
      })
      if (!response.ok) {
        let message = `导出失败 (${response.status})`
        try {
          const payload = await response.json()
          if (payload?.error) message = payload.error
        } catch (_err) {
          // ignore
        }
        throw new Error(message)
      }
      const blob = await response.blob()
      downloadBlob(blob, `device-flow-jobs-${Date.now()}.xlsx`)
      showSuccess('批量导出成功')
    } catch (err) {
      showError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const onBatchImportJobs = async () => {
    if (!canBatchImport) return showError('当前角色无权限导入')
    if (!batchImportFile) return showError('请先选择导入文件')
    try {
      setBusy(true)
      const formData = new FormData()
      formData.append('file', batchImportFile)
      const result = await apiRequest('/api/device-flow/import/jobs.xlsx', {
        method: 'POST',
        formData: true,
        body: formData,
      })
      setBatchImportResult(result)
      showSuccess(`导入完成：成功 ${Number(result?.success_count || 0)} 条，失败 ${Number(result?.failure_count || 0)} 条`)
      await Promise.all([refreshJobs(), refreshDashboard()])
    } catch (err) {
      showError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const onBatchAdvanceStage = async () => {
    if (!canBatchStage) return showError('当前角色无权限执行批量推进')
    const jobIds = parseBatchJobIdsText(batchStageForm.job_ids_text)
    if (jobIds.length === 0) return showError('请填写至少1个流转单 ID')

    let stagePayload = null
    if (batchStageAdvancedMode) {
      const payloadText = String(batchStageForm.stage_payload_json || '').trim()
      if (payloadText) {
        try {
          stagePayload = JSON.parse(payloadText)
          if (!stagePayload || Array.isArray(stagePayload) || typeof stagePayload !== 'object') {
            return showError('阶段 payload 必须是 JSON 对象')
          }
        } catch (_err) {
          return showError('阶段 payload 不是合法 JSON')
        }
      }
    } else {
      const normalized = Object.entries(batchStagePayloadForm).reduce((acc, [key, value]) => {
        if (value === null || value === undefined) return acc
        const text = String(value).trim()
        if (!text) return acc
        acc[key] = text
        return acc
      }, {})
      stagePayload = Object.keys(normalized).length ? normalized : null
    }
    if (batchStageForm.action === 'ship' && trimText(batchStageForm.outbound_tracking_no)) {
      stagePayload = {
        ...(stagePayload && typeof stagePayload === 'object' ? stagePayload : {}),
        outbound_tracking_no: trimText(batchStageForm.outbound_tracking_no),
      }
    }

    try {
      setBusy(true)
      const result = await apiRequest('/api/device-flow/jobs/batch/stage', {
        method: 'POST',
        body: {
          action: batchStageForm.action,
          job_ids: jobIds,
          remark: batchStageForm.remark,
          inbound_tracking_no: batchStageForm.inbound_tracking_no,
          outbound_tracking_no: batchStageForm.outbound_tracking_no,
          stage_payload: stagePayload,
        },
      })
      setBatchStageResult(result)
      showSuccess(`批量推进完成：成功 ${Number(result?.success_count || 0)} 条，失败 ${Number(result?.failure_count || 0)} 条`)
      await Promise.all([refreshJobs(), refreshDashboard()])
      if (selectedJobId) await refreshDetail(selectedJobId)
    } catch (err) {
      showError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const onVerifyAuditChain = async () => {
    try {
      setAuditVerifyLoading(true)
      const params = new URLSearchParams()
      if (trimText(auditVerifyForm.from_id)) params.set('from_id', String(Number(auditVerifyForm.from_id)))
      if (trimText(auditVerifyForm.to_id)) params.set('to_id', String(Number(auditVerifyForm.to_id)))
      if (trimText(auditVerifyForm.limit)) params.set('limit', String(Number(auditVerifyForm.limit)))
      const result = await apiRequest(`/api/device-flow/audit/verify?${params.toString()}`)
      setAuditVerifyResult(result)
      if (result?.passed) showSuccess('审计链校验通过')
      else showError(`审计链校验发现 ${Number(result?.issue_count || 0)} 个问题`)
    } catch (err) {
      showError(err.message)
    } finally {
      setAuditVerifyLoading(false)
    }
  }

  const refreshAll = async () => {
    setLoading(true)
    try {
      await refreshPermissionEffective()
      if (isAuditOnlyUser) {
        await refreshAuditLogs()
        clearTips()
        return
      }
      const [rows] = await Promise.all([refreshJobs(), refreshDashboard()])
      const fallbackId = Number(selectedJobId || (rows[0] && rows[0].id) || 0)
      await refreshDetail(fallbackId)
      clearTips()
    } catch (err) {
      showError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const onCreateJob = async (e) => {
    e.preventDefault()
    if (!canCreateJob) return showError('当前角色无权限创建流转单')
    try {
      setBusy(true)
      const created = await apiRequest('/api/device-flow/jobs', {
        method: 'POST',
        body: createForm,
      })
      showSuccess('流转单创建成功')
      setCreateForm({ device_sn: '', customer_name: '', sales_order_no: '', inbound_tracking_no: '', remark: '' })
      setSelectedJobId(Number(created?.id || 0))
      await Promise.all([refreshJobs(), refreshDashboard()])
      await refreshDetail(Number(created?.id || 0))
      setActiveMenu('jobs')
    } catch (err) {
      showError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const onAdvanceStage = async () => {
    if (!detail || !nextAction) return
    if (!canRunNextAction) return showError('当前角色无权执行该阶段动作')
    const validationError = validateAdvanceForm(nextAction, advanceForm, user?.id)
    if (validationError) return showError(validationError)

    try {
      setBusy(true)
      const payload = {
        remark: advanceForm.remark,
        stage_payload: buildStagePayloadByAction(nextAction, advanceForm),
      }
      if (nextAction === 'receive') payload.inbound_tracking_no = advanceForm.inbound_tracking_no
      if (nextAction === 'ship') payload.outbound_tracking_no = advanceForm.outbound_tracking_no
      if (nextAction === 'test' || nextAction === 'approve') {
        payload.signature = trimText(advanceForm.signature)
        if (trimText(advanceForm.dual_sign_token)) {
          payload.dual_sign_token = trimText(advanceForm.dual_sign_token)
        } else {
          payload.expected_second_signer_sub = trimText(advanceForm.expected_second_signer_sub)
        }
      }

      const resp = await apiRequest(`/api/device-flow/jobs/${detail.id}/stages/${nextAction}`, {
        method: 'POST',
        body: payload,
      })
      if (resp?.pending_dual_sign && resp?.dual_sign_token) {
        setAdvanceForm((prev) => ({
          ...prev,
          dual_sign_token: String(resp.dual_sign_token || ''),
          signature: '',
          expected_second_signer_sub: String(resp.expected_second_signer_sub || prev.expected_second_signer_sub || ''),
        }))
        showSuccess(`首签已提交，待 ${resp.expected_second_signer_name || '指定人员'} 复签。会签令牌：${resp.dual_sign_token}`)
        await refreshDetail()
        return
      }

      const dualCompleted = Boolean(resp?.dual_sign_completed)
      showSuccess(dualCompleted ? '双人复核完成，阶段推进成功' : '阶段推进成功')
      setAdvanceForm((prev) => ({
        ...prev,
        remark: '',
        inbound_tracking_no: '',
        outbound_tracking_no: '',
        signature: '',
        dual_sign_token: '',
        expected_second_signer_sub: '',
      }))
      await Promise.all([refreshJobs(), refreshDashboard()])
      await refreshDetail()
    } catch (err) {
      showError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const onRework = async () => {
    if (!detail) return
    if (!canRework) return showError('当前角色无权执行退回')

    try {
      setBusy(true)
      await apiRequest(`/api/device-flow/jobs/${detail.id}/rework`, {
        method: 'POST',
        body: reworkForm,
      })
      showSuccess('已退回到指定阶段')
      setReworkForm((prev) => ({ ...prev, reason: '', remark: '' }))
      await Promise.all([refreshJobs(), refreshDashboard()])
      await refreshDetail()
    } catch (err) {
      showError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const onUploadAttachment = async () => {
    if (!detail) return
    if (!canUpload) return showError('当前角色无权上传附件')
    if (!attachmentForm.file) return showError('请选择要上传的文件')
    const maxFileSizeBytes = Number(attachmentUploadSetting?.max_file_size_bytes || 0)
    if (maxFileSizeBytes > 0 && Number(attachmentForm.file.size || 0) > maxFileSizeBytes) {
      return showError(`文件大小 ${formatFileSize(attachmentForm.file.size)} 超过当前上限 ${attachmentUploadSetting.max_file_size_mb}MB`)
    }

    try {
      setBusy(true)
      const formData = new FormData()
      formData.append('file', attachmentForm.file)
      if (attachmentForm.stage_code) formData.append('stage_code', attachmentForm.stage_code)
      if (attachmentForm.remark) formData.append('remark', attachmentForm.remark)

      await apiRequest(`/api/device-flow/jobs/${detail.id}/attachments`, {
        method: 'POST',
        formData: true,
        body: formData,
      })

      showSuccess('附件上传成功')
      setAttachmentForm((prev) => ({ ...prev, remark: '', file: null }))
      await refreshDashboard()
      await refreshDetail()
    } catch (err) {
      showError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const onDownloadAttachment = async (item) => {
    try {
      const blob = await apiRequest(`/api/device-flow/attachments/${item.id}/download`, { expectBlob: true })
      downloadBlob(blob, item.file_name || `attachment-${item.id}`)
    } catch (err) {
      showError(err.message)
    }
  }

  const onDeleteAttachment = async (item) => {
    if (!detail) return
    if (!canDeleteAttachment) return showError('当前角色无权删除附件')
    openConfirmDialog({
      title: '删除附件',
      message: `确认删除附件“${item.file_name}”？删除后不可恢复。`,
      confirmLabel: '确认删除',
      onConfirm: async () => {
        try {
          setBusy(true)
          await apiRequest(`/api/device-flow/attachments/${item.id}`, { method: 'DELETE' })
          showSuccess('附件删除成功')
          await refreshDashboard()
          await refreshDetail()
        } catch (err) {
          showError(err.message)
        } finally {
          setBusy(false)
        }
      },
    })
  }

  const onExportAudit = async () => {
    try {
      setBusy(true)
      const params = new URLSearchParams()
      if (auditFilter.from) params.set('from', auditFilter.from)
      if (auditFilter.to) params.set('to', auditFilter.to)
      if (auditFilter.action) params.set('action', auditFilter.action)
      if (auditFilter.username) params.set('username', auditFilter.username)
      if (auditFilter.keyword) params.set('keyword', auditFilter.keyword)
      const response = await fetch(`${API_BASE}/api/device-flow/reports/audit.csv?${params.toString()}`, {
        method: 'GET',
        credentials: 'include',
      })
      if (!response.ok) {
        let message = `导出失败 (${response.status})`
        try {
          const payload = await response.json()
          if (payload?.error) message = payload.error
        } catch (_err) {
          // ignore
        }
        throw new Error(message)
      }
      const blob = await response.blob()
      downloadBlob(blob, `device-flow-audit-${Date.now()}.csv`)
      showSuccess('审计报表导出成功')
    } catch (err) {
      showError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const onExportDashboard = async () => {
    try {
      setBusy(true)
      const params = buildDashboardParams()
      const response = await fetch(`${API_BASE}/api/device-flow/reports/dashboard.csv?${params.toString()}`, {
        method: 'GET',
        credentials: 'include',
      })
      if (!response.ok) {
        let message = `导出失败 (${response.status})`
        try {
          const payload = await response.json()
          if (payload?.error) message = payload.error
        } catch (_err) {
          // ignore
        }
        throw new Error(message)
      }
      const blob = await response.blob()
      downloadBlob(blob, `device-flow-dashboard-${Date.now()}.csv`)
      showSuccess('看板明细导出成功')
    } catch (err) {
      showError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const closeDetailModal = () => {
    setDetailModalOpen(false)
    setDetailModalDragging(false)
    detailModalDragRef.current = null
  }

  const onStartDetailModalDrag = (event) => {
    if (event.button !== 0) return
    if (!detailModalRef.current) return
    event.preventDefault()
    const rect = detailModalRef.current.getBoundingClientRect()
    detailModalDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: detailModalPosition.x,
      originY: detailModalPosition.y,
      width: rect.width,
      height: rect.height,
    }
    setDetailModalDragging(true)
  }

  const onOpenJobDetail = async (jobId) => {
    const targetId = Number(jobId || 0)
    if (!targetId) {
      showError('该记录未关联流转单')
      return
    }
    setDetailModalOpen(true)
    setDetailModalPosition({ x: 0, y: 0 })
    setDetailModalDragging(false)
    detailModalDragRef.current = null
    setSelectedJobId(targetId)
    try {
      setActiveMenu('jobs')
      await refreshDetail(targetId)
    } catch (err) {
      showError(err.message)
    }
  }

  const renderStageFields = () => {
    if (!nextAction) return null

    const passFailSelect = (key, label) => (
      <div className="field" key={key}>
        <label>{label}</label>
        <select value={advanceForm[key]} onChange={(e) => setAdvanceForm((prev) => ({ ...prev, [key]: e.target.value }))}>
          <option value="PASS">通过</option>
          <option value="FAIL">不通过</option>
        </select>
      </div>
    )

    const selectedSecondSigner = dualSignUserOptions.find((item) => item.value === String(advanceForm.expected_second_signer_sub || ''))
    const renderDualSignFields = () => (
      <>
        <div className="field">
          <label>电子签名（必填）</label>
          <input
            value={advanceForm.signature}
            onChange={(e) => setAdvanceForm((prev) => ({ ...prev, signature: e.target.value }))}
            placeholder="输入签名口令或签名串"
          />
        </div>
        <div className="field">
          <label>指定复签人</label>
          <select
            value={advanceForm.expected_second_signer_sub}
            onChange={(e) => setAdvanceForm((prev) => ({ ...prev, expected_second_signer_sub: e.target.value }))}
            disabled={Boolean(trimText(advanceForm.dual_sign_token)) || systemUsersLoading}
          >
            <option value="">{systemUsersLoading ? '加载中...' : '请选择第二复签人'}</option>
            {dualSignUserOptions.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
          {trimText(advanceForm.dual_sign_token) && selectedSecondSigner ? (
            <span className="muted">本次会签指定由 {selectedSecondSigner.label} 复签</span>
          ) : null}
        </div>
        <div className="field">
          <label>双签令牌（第二人复签时填写）</label>
          <input
            value={advanceForm.dual_sign_token}
            onChange={(e) => setAdvanceForm((prev) => ({ ...prev, dual_sign_token: e.target.value }))}
            placeholder="首签后自动回填"
          />
        </div>
      </>
    )

    if (nextAction === 'receive') {
      return (
        <>
          <div className="field">
            <label>来件快递单号（可补录）</label>
            <input
              value={advanceForm.inbound_tracking_no}
              onChange={(e) => setAdvanceForm((prev) => ({ ...prev, inbound_tracking_no: e.target.value }))}
              placeholder="来件快递单号"
            />
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>收货备注</label>
            <textarea value={advanceForm.receive_note} onChange={(e) => setAdvanceForm((prev) => ({ ...prev, receive_note: e.target.value }))} />
          </div>
        </>
      )
    }

    if (nextAction === 'hardware-check') {
      return (
        <>
          {passFailSelect('cpu_match', 'CPU匹配')}
          {passFailSelect('memory_match', '内存匹配')}
          {passFailSelect('disk_match', '磁盘匹配')}
          {passFailSelect('nic_match', '网卡匹配')}
          {passFailSelect('serial_match', '序列号匹配')}
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>硬件检查备注</label>
            <textarea value={advanceForm.hardware_note} onChange={(e) => setAdvanceForm((prev) => ({ ...prev, hardware_note: e.target.value }))} />
          </div>
        </>
      )
    }

    if (nextAction === 'warehouse-after-hardware' || nextAction === 'warehouse-after-pack') {
      return (
        <>
          <div className="field">
            <label>库位</label>
            <input
              value={advanceForm.warehouse_location}
              onChange={(e) => setAdvanceForm((prev) => ({ ...prev, warehouse_location: e.target.value }))}
              placeholder="可填写库位/货架/区域"
            />
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>入库备注</label>
            <textarea value={advanceForm.warehouse_note} onChange={(e) => setAdvanceForm((prev) => ({ ...prev, warehouse_note: e.target.value }))} />
          </div>
        </>
      )
    }

    if (nextAction === 'outbound-for-install' || nextAction === 'outbound-for-ship') {
      return (
        <>
          <div className="field">
            <label>出库去向</label>
            <input
              value={advanceForm.outbound_target}
              onChange={(e) => setAdvanceForm((prev) => ({ ...prev, outbound_target: e.target.value }))}
              placeholder={nextAction === 'outbound-for-install' ? '系统安装' : '客户发货'}
            />
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>出库备注</label>
            <textarea value={advanceForm.outbound_note} onChange={(e) => setAdvanceForm((prev) => ({ ...prev, outbound_note: e.target.value }))} />
          </div>
        </>
      )
    }

    if (nextAction === 'os-install') {
      return (
        <>
          <div className="field">
            <label>设备SN（系统安装后补录）</label>
            <input
              value={advanceForm.device_sn}
              onChange={(e) => setAdvanceForm((prev) => ({ ...prev, device_sn: e.target.value }))}
              placeholder="系统安装完成后填写"
            />
          </div>
          <div className="field">
            <label>系统名称</label>
            <input value={advanceForm.os_name} onChange={(e) => setAdvanceForm((prev) => ({ ...prev, os_name: e.target.value }))} />
          </div>
          <div className="field">
            <label>系统版本</label>
            <input value={advanceForm.os_version} onChange={(e) => setAdvanceForm((prev) => ({ ...prev, os_version: e.target.value }))} />
          </div>
          <div className="field">
            <label>安装方式</label>
            <input value={advanceForm.install_mode} onChange={(e) => setAdvanceForm((prev) => ({ ...prev, install_mode: e.target.value }))} placeholder="U盘/网络安装" />
          </div>
          {passFailSelect('install_result', '安装结果')}
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>安装备注</label>
            <textarea value={advanceForm.install_note} onChange={(e) => setAdvanceForm((prev) => ({ ...prev, install_note: e.target.value }))} />
          </div>
        </>
      )
    }

    if (nextAction === 'test') {
      return (
        <>
          {passFailSelect('boot_test', '开机测试')}
          {passFailSelect('network_test', '网络测试')}
          {passFailSelect('stress_test', '压力测试')}
          {passFailSelect('test_result', '测试结论')}
          <div className="field">
            <label>老化时长(小时)</label>
            <input value={advanceForm.burnin_hours} onChange={(e) => setAdvanceForm((prev) => ({ ...prev, burnin_hours: e.target.value }))} />
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>测试备注</label>
            <textarea value={advanceForm.test_note} onChange={(e) => setAdvanceForm((prev) => ({ ...prev, test_note: e.target.value }))} />
          </div>
          {renderDualSignFields()}
        </>
      )
    }

    if (nextAction === 'approve') {
      return (
        <>
          {passFailSelect('approve_result', '审核结论')}
          <div className="field">
            <label>审核备注</label>
            <input value={advanceForm.approve_note} onChange={(e) => setAdvanceForm((prev) => ({ ...prev, approve_note: e.target.value }))} />
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>审核意见</label>
            <textarea value={advanceForm.reviewer_comment} onChange={(e) => setAdvanceForm((prev) => ({ ...prev, reviewer_comment: e.target.value }))} />
          </div>
          {renderDualSignFields()}
        </>
      )
    }

    if (nextAction === 'pack') {
      return (
        <>
          {passFailSelect('package_check', '包装完整')}
          {passFailSelect('accessory_check', '配件完整')}
          <div className="field">
            <label>箱号</label>
            <input value={advanceForm.box_no} onChange={(e) => setAdvanceForm((prev) => ({ ...prev, box_no: e.target.value }))} />
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>装箱备注</label>
            <textarea value={advanceForm.pack_note} onChange={(e) => setAdvanceForm((prev) => ({ ...prev, pack_note: e.target.value }))} />
          </div>
        </>
      )
    }

    if (nextAction === 'ship') {
      return (
        <>
          <div className="field">
            <label>物流公司（必填）</label>
            <input value={advanceForm.carrier} onChange={(e) => setAdvanceForm((prev) => ({ ...prev, carrier: e.target.value }))} />
          </div>
          <div className="field">
            <label>发货快递单号（必填）</label>
            <input
              value={advanceForm.outbound_tracking_no}
              onChange={(e) => setAdvanceForm((prev) => ({ ...prev, outbound_tracking_no: e.target.value }))}
              placeholder="发货快递单号"
            />
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>发货备注</label>
            <textarea value={advanceForm.shipped_note} onChange={(e) => setAdvanceForm((prev) => ({ ...prev, shipped_note: e.target.value }))} />
          </div>
        </>
      )
    }

    return null
  }

  useEffect(() => {
    let cancelled = false
    const bootstrapAuth = async () => {
      try {
        const marker = consumePortalSessionMarker()
        if (!marker) return
        const response = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' })
        if (!response.ok) return
        const data = await response.json()
        if (cancelled) return
        if (data?.id) {
          setToken('cookie')
          setUser(data)
        }
      } catch (_err) {
        // ignore
      }
    }
    bootstrapAuth()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!token || !user) return
    refreshAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user, isAuditOnlyUser])

  useEffect(() => {
    if (!token) return
    if (isAuditOnlyUser) return
    refreshJobs().catch((err) => showError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filters, token, isAuditOnlyUser])

  useEffect(() => {
    if (!token) return
    if (isAuditOnlyUser) return
    if (!selectedJobId) return
    refreshDetail().catch((err) => showError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJobId, token, isAuditOnlyUser])

  useEffect(() => {
    setSelectedAdvanceAction('')
    setActiveDetailTab('advance')
  }, [detail?.id, detail?.current_stage])

  useEffect(() => {
    if (!detailModalOpen) return
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      setDetailModalOpen(false)
      setDetailModalDragging(false)
      detailModalDragRef.current = null
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [detailModalOpen])

  useEffect(() => {
    if (activeMenu === 'jobs') return
    setDetailModalOpen(false)
    setDetailModalDragging(false)
    detailModalDragRef.current = null
  }, [activeMenu])

  useEffect(() => {
    if (!detailModalDragging) return

    const onPointerMove = (event) => {
      const drag = detailModalDragRef.current
      if (!drag) return
      if (Number.isInteger(drag.pointerId) && event.pointerId !== drag.pointerId) return

      const deltaX = event.clientX - drag.startX
      const deltaY = event.clientY - drag.startY
      const rawX = drag.originX + deltaX
      const rawY = drag.originY + deltaY
      const limitX = Math.max(0, (window.innerWidth - drag.width) / 2 - 20)
      const limitY = Math.max(0, (window.innerHeight - drag.height) / 2 - 20)

      setDetailModalPosition({
        x: Math.max(-limitX, Math.min(limitX, rawX)),
        y: Math.max(-limitY, Math.min(limitY, rawY)),
      })
    }

    const onPointerUp = (event) => {
      const drag = detailModalDragRef.current
      if (drag && Number.isInteger(drag.pointerId) && event.pointerId !== drag.pointerId) return
      setDetailModalDragging(false)
      detailModalDragRef.current = null
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [detailModalDragging])

  useEffect(() => {
    if (!token) return
    if (activeMenu !== 'dashboard') return
    refreshDashboard().catch((err) => showError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeMenu, dashboardOverdueDays])

  useEffect(() => {
    if (!token) return
    if (!canReadAuditLogs) return
    if (activeMenu !== 'audit') return
    refreshAuditLogs().catch((err) => showError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, canReadAuditLogs, activeMenu, auditPage, auditFilter])

  useEffect(() => {
    if (canReadAuditLogs) return
    if (activeMenu !== 'audit' && activeMenu !== 'audit-verify') return
    setActiveMenu('jobs')
  }, [canReadAuditLogs, activeMenu])

  useEffect(() => {
    if (!isAuditOnlyUser) return
    if (activeMenu === 'audit' || activeMenu === 'audit-verify') return
    setActiveMenu('audit')
  }, [isAuditOnlyUser, activeMenu])

  useEffect(() => {
    if (!token) return
    if (activeMenu !== 'sla') return
    refreshSlaSummary({ page: slaReminderPage }).catch((err) => showError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeMenu, slaReminderPage])

  useEffect(() => {
    if (!token) return
    if (activeMenu !== 'permissions') return
    refreshPermissionSettings().catch((err) => showError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeMenu])

  useEffect(() => {
    if (!token || sidebarMenuItems.length === 0) return
    if (sidebarMenuItems.some((item) => item.key === activeMenu)) return
    setActiveMenu(sidebarMenuItems[0].key)
  }, [token, activeMenu, sidebarMenuItems])

  useEffect(() => {
    if (!token || isAuditOnlyUser) return
    refreshAttachmentUploadSetting().catch((err) => showError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isAuditOnlyUser])

  useEffect(() => {
    if (!token || isAuditOnlyUser) return
    refreshSystemUsers().catch((err) => showError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isAuditOnlyUser])

  useEffect(() => {
    const action = batchStageForm.action
    const template = cloneBatchPayloadTemplate(action)
    if (!template) return
    setBatchStagePayloadForm(template)
    setBatchStageForm((prev) => {
      if (prev.action !== action) return prev
      return {
        ...prev,
        stage_payload_json: JSON.stringify(template, null, 2),
      }
    })
    setBatchStageAdvancedMode(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchStageForm.action])

  useEffect(() => {
    if (!detail) return
    if (!nextStageCode) return
    setAttachmentForm((prev) => ({ ...prev, stage_code: nextStageCode }))
  }, [detail, nextStageCode])

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(Math.max(total, 0) / limit))
    if (page > totalPages) setPage(totalPages)
  }, [total, page, limit])

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(Math.max(auditTotal, 0) / auditLimit))
    if (auditPage > totalPages) setAuditPage(totalPages)
  }, [auditTotal, auditPage, auditLimit])

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(Math.max(slaReminderTotal, 0) / slaReminderLimit))
    if (slaReminderPage > totalPages) setSlaReminderPage(totalPages)
  }, [slaReminderTotal, slaReminderPage, slaReminderLimit])

  if (!token || !user) {
    return (
      <main className="login-shell">
        <section className="login-card">
          <h1>
            <span className="brand-red">聚信</span>
            <span className="brand-blue">设备流转系统</span>
          </h1>
          <p className="sub">使用统一登录进入系统。</p>
          <div className="toolbar">
            <button className="btn btn-primary" onClick={() => (window.location.href = buildPortalEntryUrl('device-flow'))}>
              前往统一登录
            </button>
            <button className="btn" onClick={() => (window.location.href = buildPortalSwitchUrl('reminder'))}>
              切换其他系统
            </button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <strong>
            <span className="brand-red">聚信</span>
            <span className="brand-blue">设备流转系统</span>
          </strong>
          <div className="user-pill">{user.username} · {user.role}</div>
        </div>

        <div className="menu">
          {sidebarMenuItems.map((item) => (
            <button
              key={item.key}
              className={activeMenu === item.key ? 'active' : ''}
              onClick={() => setActiveMenu(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="sidebar-actions">
          <button className="ghost" onClick={() => (window.location.href = buildPortalSwitchUrl('reminder'))}>切换系统</button>
          <button className="ghost logout" onClick={onLogout}>退出登录</button>
        </div>
      </aside>

      <main className="content">
        <header className="hero">
          <div>
            <div className="muted">DEVICE FLOW V1</div>
            <h1>设备收货到发货全链路追踪</h1>
            <div className="sub">流程：收货 → 硬件检查 → 入库 → 出库 → 系统安装 → 测试 → 审核 → 装箱 → 入库 → 出库 → 发货</div>
          </div>
          <div className="toolbar">
            <div className="status-card">
              <div className="muted">当前列表总数</div>
              <strong>{heroSummary.total}</strong>
            </div>
            <div className="status-card">
              <div className="muted">处理中</div>
              <strong>{heroSummary.processing}</strong>
            </div>
            <div className="status-card">
              <div className="muted">已发货</div>
              <strong>{heroSummary.shipped}</strong>
            </div>
          </div>
        </header>

        {errorMsg ? <div className="msg error">{errorMsg}</div> : null}
        {successMsg ? <div className="msg success">{successMsg}</div> : null}

        {activeMenu === 'dashboard' ? (
          <section className="panel">
            <div className="panel-header">
              <strong>看板总览</strong>
              <div className="toolbar">
                <label className="muted">超时阈值(天)</label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={dashboardOverdueDays}
                  onChange={(e) => setDashboardOverdueDays(Math.min(30, Math.max(1, Number(e.target.value || 1))))}
                  style={{ width: 88 }}
                />
                <select
                  value={dashboardFilter.stage}
                  onChange={(e) => setDashboardFilter((prev) => ({ ...prev, stage: e.target.value }))}
                >
                  {stageOptions.map((item) => (
                    <option key={`dashboard-${item.value || 'all'}`} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <input
                  value={dashboardFilter.customer}
                  onChange={(e) => setDashboardFilter((prev) => ({ ...prev, customer: e.target.value }))}
                  placeholder="客户名筛选"
                />
                <button className="btn" onClick={() => refreshDashboard()} disabled={dashboardLoading}>
                  {dashboardLoading ? '查询中...' : '查询'}
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setDashboardFilter({ stage: '', customer: '' })
                    refreshDashboard({ stage: '', customer: '' }).catch((err) => showError(err.message))
                  }}
                  disabled={dashboardLoading}
                >
                  重置筛选
                </button>
                <button className="btn btn-primary" onClick={onExportDashboard} disabled={busy}>导出明细 CSV</button>
              </div>
            </div>
            <div className="panel-body">
              {!dashboard ? (
                <div className="muted">暂无看板数据</div>
              ) : (
                <>
                  <div className="stats-grid">
                    <div className="stat-tile">
                      <div className="muted">流转单总数</div>
                      <strong>{Number(dashboard?.totals?.total_jobs || 0)}</strong>
                    </div>
                    <div className="stat-tile">
                      <div className="muted">处理中</div>
                      <strong>{Number(dashboard?.totals?.open_jobs || 0)}</strong>
                    </div>
                    <div className="stat-tile">
                      <div className="muted">已完成</div>
                      <strong>{Number(dashboard?.totals?.completed_jobs || 0)}</strong>
                    </div>
                    <div className="stat-tile">
                      <div className="muted">今日发货</div>
                      <strong>{Number(dashboard?.totals?.shipped_today || 0)}</strong>
                    </div>
                  </div>

                  <div className="panel-subsection" style={{ marginTop: 14 }}>
                    <strong>阶段分布</strong>
                    <div className="stage-count-grid" style={{ marginTop: 8 }}>
                      {stageSequence.map((stage) => (
                        <div className="stage-count-card" key={stage}>
                          <div className="muted">{stageText(stage)}</div>
                          <strong>{Number(dashboardStageMap[stage] || 0)}</strong>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="panel-subsection" style={{ marginTop: 14 }}>
                    <strong>超时流转单（{Number(dashboard?.overdue_days || 0)} 天未更新）</strong>
                    <div className="table-wrap" style={{ marginTop: 8 }}>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>流转单号</th>
                            <th>设备SN</th>
                            <th>客户</th>
                            <th>当前阶段</th>
                            <th>超时天数</th>
                            <th>最后更新时间</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(Array.isArray(dashboard?.overdue_jobs) ? dashboard.overdue_jobs : []).map((item) => (
                            <tr key={`overdue-${item.id}`}>
                              <td>
                                <button
                                  type="button"
                                  className="text-link"
                                  onClick={() => onOpenJobDetail(item.id)}
                                  disabled={busy}
                                >
                                  {item.job_no || `#${item.id}`}
                                </button>
                              </td>
                              <td>{deviceSnText(item.device_sn)}</td>
                              <td>{item.customer_name || '-'}</td>
                              <td>{stageText(item.current_stage)}</td>
                              <td>{Number(item.overdue_days || 0)}</td>
                              <td>{parseApiDate(item.updated_at)}</td>
                            </tr>
                          ))}
                          {(Array.isArray(dashboard?.overdue_jobs) ? dashboard.overdue_jobs : []).length === 0 ? (
                            <tr><td colSpan={6} className="muted">暂无超时流转单</td></tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {canReadAuditLogs ? (
                    <div className="panel-subsection" style={{ marginTop: 14 }}>
                      <strong>最近审计日志</strong>
                      <div className="table-wrap" style={{ marginTop: 8 }}>
                        <table className="table">
                          <thead>
                            <tr>
                              <th>时间</th>
                              <th>操作人</th>
                              <th>动作</th>
                              <th>流转单号</th>
                              <th>说明</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(Array.isArray(dashboard?.recent_logs) ? dashboard.recent_logs : []).map((item) => (
                              <tr key={`recent-log-${item.id}`}>
                                <td>{parseApiDate(item.created_at)}</td>
                                <td>{item.username || '-'}</td>
                                <td>{auditActionText(item.action)}</td>
                                <td>
                                  {item.job_id ? (
                                    <button
                                      type="button"
                                      className="text-link"
                                      onClick={() => onOpenJobDetail(item.job_id)}
                                      disabled={busy}
                                    >
                                      {item.job_no || `#${item.job_id}`}
                                    </button>
                                  ) : (
                                    item.job_no || '-'
                                  )}
                                </td>
                                <td>{auditMessageText(item.message)}</td>
                              </tr>
                            ))}
                            {(Array.isArray(dashboard?.recent_logs) ? dashboard.recent_logs : []).length === 0 ? (
                              <tr><td colSpan={5} className="muted">暂无日志</td></tr>
                            ) : null}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </section>
        ) : null}

        {activeMenu === 'sla' ? (
          <section className="panel">
            <div className="panel-header">
              <strong>SLA 催办</strong>
              <div className="toolbar">
                <button className="btn" onClick={() => refreshSlaSummary()} disabled={slaLoading}>
                  {slaLoading ? '加载中...' : '刷新'}
                </button>
                <button className="btn" onClick={onRunSlaNow} disabled={busy || !canRunSla}>立即执行催办</button>
                <button className="btn btn-primary" onClick={onSaveSlaRules} disabled={busy || !canEditSla}>保存规则</button>
              </div>
            </div>
            <div className="panel-body">
              {!slaData ? (
                <div className="muted">暂无 SLA 数据</div>
              ) : (
                <>
                  {slaRunResult ? (
                    <div className="msg success">
                      本次催办：扫描 {Number(slaRunResult.checked || 0)} 条，触发 {Number(slaRunResult.triggered || 0)} 条，间隔内跳过 {Number(slaRunResult.skipped_interval || 0)} 条。
                    </div>
                  ) : null}

                  <div className="panel-subsection">
                    <strong>阶段 SLA 规则</strong>
                    <div className="table-wrap" style={{ marginTop: 8 }}>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>阶段</th>
                            <th>超时阈值(小时)</th>
                            <th>提醒间隔(分钟)</th>
                            <th>启用</th>
                          </tr>
                        </thead>
                        <tbody>
                          {slaRuleForm.map((row, idx) => (
                            <tr key={`sla-rule-${row.stage_code}`}>
                              <td>{row.stage_label || stageText(row.stage_code)}</td>
                              <td>
                                <input
                                  type="number"
                                  min={1}
                                  max={720}
                                  value={row.threshold_hours}
                                  onChange={(e) =>
                                    setSlaRuleForm((prev) =>
                                      prev.map((item, i) =>
                                        i === idx
                                          ? { ...item, threshold_hours: Math.max(1, Math.min(720, Number(e.target.value || 1))) }
                                          : item,
                                      ),
                                    )
                                  }
                                  style={{ width: 120 }}
                                />
                              </td>
                              <td>
                                <input
                                  type="number"
                                  min={10}
                                  max={1440}
                                  value={row.remind_interval_minutes}
                                  onChange={(e) =>
                                    setSlaRuleForm((prev) =>
                                      prev.map((item, i) =>
                                        i === idx
                                          ? {
                                            ...item,
                                            remind_interval_minutes: Math.max(10, Math.min(1440, Number(e.target.value || 10))),
                                          }
                                          : item,
                                      ),
                                    )
                                  }
                                  style={{ width: 120 }}
                                />
                              </td>
                              <td>
                                <input
                                  type="checkbox"
                                  checked={Boolean(row.enabled)}
                                  onChange={(e) =>
                                    setSlaRuleForm((prev) =>
                                      prev.map((item, i) => (i === idx ? { ...item, enabled: e.target.checked } : item)),
                                    )
                                  }
                                />
                              </td>
                            </tr>
                          ))}
                          {slaRuleForm.length === 0 ? <tr><td colSpan={4} className="muted">暂无规则</td></tr> : null}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="panel-subsection" style={{ marginTop: 12 }}>
                    <strong>超时流转单</strong>
                    <div className="table-wrap" style={{ marginTop: 8 }}>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>流转单号</th>
                            <th>设备SN</th>
                            <th>客户</th>
                            <th>当前阶段</th>
                            <th>超时小时</th>
                            <th>阈值小时</th>
                            <th>最后更新时间</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(Array.isArray(slaData?.overdue_jobs) ? slaData.overdue_jobs : []).map((item) => (
                            <tr key={`sla-overdue-${item.id}`}>
                              <td>
                                <button type="button" className="text-link" onClick={() => onOpenJobDetail(item.id)} disabled={busy}>
                                  {item.job_no || `#${item.id}`}
                                </button>
                              </td>
                              <td>{deviceSnText(item.device_sn)}</td>
                              <td>{item.customer_name || '-'}</td>
                              <td>{stageText(item.current_stage)}</td>
                              <td>{Number(item.overdue_hours || 0)}</td>
                              <td>{Number(item.threshold_hours || 0)}</td>
                              <td>{parseApiDate(item.updated_at)}</td>
                            </tr>
                          ))}
                          {(Array.isArray(slaData?.overdue_jobs) ? slaData.overdue_jobs : []).length === 0 ? (
                            <tr><td colSpan={7} className="muted">暂无超时数据</td></tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="panel-subsection" style={{ marginTop: 12 }}>
                    <div className="toolbar" style={{ justifyContent: 'space-between' }}>
                      <strong>最近催办记录</strong>
                      {canDeleteSlaReminder ? (
                        <button className="btn btn-danger" onClick={onClearSlaReminders} disabled={busy || slaLoading || slaReminderTotal <= 0}>
                          一键删除
                        </button>
                      ) : null}
                    </div>
                    <div className="table-wrap" style={{ marginTop: 8 }}>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>时间</th>
                            <th>流转单号</th>
                            <th>阶段</th>
                            <th>超时/阈值(小时)</th>
                            <th>说明</th>
                            {canDeleteSlaReminder ? <th>操作</th> : null}
                          </tr>
                        </thead>
                        <tbody>
                          {(Array.isArray(slaData?.recent_reminders) ? slaData.recent_reminders : []).map((item) => (
                            <tr key={`sla-remind-${item.id}`}>
                              <td>{parseApiDate(item.created_at)}</td>
                              <td>
                                <button type="button" className="text-link" onClick={() => onOpenJobDetail(item.job_id)} disabled={busy}>
                                  {item.job_no || `#${item.job_id}`}
                                </button>
                              </td>
                              <td>{stageText(item.stage_code)}</td>
                              <td>{Number(item.overdue_hours || 0)} / {Number(item.threshold_hours || 0)}</td>
                              <td>{item.message || '-'}</td>
                              {canDeleteSlaReminder ? (
                                <td>
                                  <button className="btn btn-danger" onClick={() => onDeleteSlaReminder(item)} disabled={busy || slaLoading}>
                                    删除
                                  </button>
                                </td>
                              ) : null}
                            </tr>
                          ))}
                          {(Array.isArray(slaData?.recent_reminders) ? slaData.recent_reminders : []).length === 0 ? (
                            <tr><td colSpan={canDeleteSlaReminder ? 6 : 5} className="muted">暂无催办记录</td></tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                    <div className="toolbar" style={{ marginTop: 10 }}>
                      <span className="muted">共 {slaReminderTotal} 条</span>
                      <button className="btn" disabled={slaReminderPage <= 1 || slaLoading} onClick={() => setSlaReminderPage((p) => Math.max(1, p - 1))}>上一页</button>
                      <span className="muted">第 {slaReminderPage} 页</span>
                      <button className="btn" disabled={slaLoading || slaReminderPage * slaReminderLimit >= slaReminderTotal} onClick={() => setSlaReminderPage((p) => p + 1)}>下一页</button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </section>
        ) : null}

        {activeMenu === 'batch' ? (
          <section className="panel">
            <div className="panel-header">
              <strong>批量处理（Excel）</strong>
            </div>
            <div className="panel-body">
              <div className="panel-subsection">
                <strong>批量导入</strong>
                <div className="toolbar" style={{ marginTop: 8 }}>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => {
                      const file = e.target.files && e.target.files[0] ? e.target.files[0] : null
                      setBatchImportFile(file)
                    }}
                  />
                  <button className="btn" onClick={onBatchDownloadTemplate} disabled={busy}>下载导入模板</button>
                  <button className="btn btn-primary" onClick={onBatchImportJobs} disabled={busy || !canBatchImport}>执行导入</button>
                </div>
                {!canBatchImport ? <div className="muted" style={{ marginTop: 6 }}>当前角色无导入权限</div> : null}
                {batchImportResult ? (
                  <div className="muted" style={{ marginTop: 8 }}>
                    导入结果：总计 {Number(batchImportResult.total_rows || 0)}，成功 {Number(batchImportResult.success_count || 0)}，失败 {Number(batchImportResult.failure_count || 0)}
                  </div>
                ) : null}
              </div>

              <div className="panel-subsection" style={{ marginTop: 12 }}>
                <strong>批量导出</strong>
                <div className="grid" style={{ marginTop: 8 }}>
                  <div className="field">
                    <label>关键词</label>
                    <input
                      value={batchExportFilter.keyword}
                      onChange={(e) => setBatchExportFilter((prev) => ({ ...prev, keyword: e.target.value }))}
                      placeholder="单号/客户/来件/SN"
                    />
                  </div>
                  <div className="field">
                    <label>客户</label>
                    <input
                      value={batchExportFilter.customer}
                      onChange={(e) => setBatchExportFilter((prev) => ({ ...prev, customer: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label>阶段</label>
                    <select
                      value={batchExportFilter.stage}
                      onChange={(e) => setBatchExportFilter((prev) => ({ ...prev, stage: e.target.value }))}
                    >
                      {stageOptions.map((item) => (
                        <option key={`batch-export-${item.value || 'all'}`} value={item.value}>{item.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="toolbar" style={{ marginTop: 10 }}>
                  <button className="btn btn-primary" onClick={onBatchExportJobs} disabled={busy}>导出流转单 Excel</button>
                </div>
              </div>

              <div className="panel-subsection" style={{ marginTop: 12 }}>
                <strong>批量阶段推进</strong>
                <div className="grid" style={{ marginTop: 8 }}>
                  <div className="field">
                    <label>动作</label>
                    <select
                      value={batchStageForm.action}
                      onChange={(e) =>
                        setBatchStageForm((prev) => ({
                          ...prev,
                          action: e.target.value,
                        }))
                      }
                    >
                      {batchActionOptions.map((item) => (
                        <option key={`batch-action-${item.value}`} value={item.value}>{item.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>统一备注</label>
                    <input
                      value={batchStageForm.remark}
                      onChange={(e) => setBatchStageForm((prev) => ({ ...prev, remark: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label>来件单号（收货用）</label>
                    <input
                      value={batchStageForm.inbound_tracking_no}
                      onChange={(e) => setBatchStageForm((prev) => ({ ...prev, inbound_tracking_no: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label>发货单号（发货用）</label>
                    <input
                      value={batchStageForm.outbound_tracking_no}
                      onChange={(e) => setBatchStageForm((prev) => ({ ...prev, outbound_tracking_no: e.target.value }))}
                    />
                  </div>
                  <div className="field" style={{ gridColumn: '1 / -1' }}>
                    <label>流转单 ID 列表（逗号/空格/换行分隔）</label>
                    <textarea
                      value={batchStageForm.job_ids_text}
                      onChange={(e) => setBatchStageForm((prev) => ({ ...prev, job_ids_text: e.target.value }))}
                      placeholder="例如：101,102,103"
                    />
                  </div>
                  <div className="field" style={{ gridColumn: '1 / -1' }}>
                    <div className="toolbar" style={{ justifyContent: 'space-between' }}>
                      <label>阶段参数</label>
                      <button className="btn" type="button" onClick={toggleBatchStageAdvancedMode}>
                        {batchStageAdvancedMode ? '切换可视化模式' : '切换高级 JSON 模式'}
                      </button>
                    </div>
                    {!batchStageAdvancedMode ? (
                      <div className="grid" style={{ marginTop: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                        {Object.entries(batchStagePayloadForm).map(([key, value]) => (
                          <div className="field" key={`batch-payload-${key}`}>
                            <label>{payloadLabelMap[key] || key}</label>
                            {isPassFailValue(value) ? (
                              <select
                                value={String(value || 'PASS').toUpperCase()}
                                onChange={(e) => updateBatchStagePayloadField(key, String(e.target.value || '').toUpperCase())}
                              >
                                <option value="PASS">PASS</option>
                                <option value="FAIL">FAIL</option>
                              </select>
                            ) : (
                              <input
                                value={value === undefined || value === null ? '' : String(value)}
                                onChange={(e) => updateBatchStagePayloadField(key, e.target.value)}
                              />
                            )}
                          </div>
                        ))}
                        {Object.keys(batchStagePayloadForm).length === 0 ? (
                          <div className="muted">当前动作无需阶段参数</div>
                        ) : null}
                      </div>
                    ) : (
                      <textarea
                        className="mono"
                        value={batchStageForm.stage_payload_json}
                        onChange={(e) => setBatchStageForm((prev) => ({ ...prev, stage_payload_json: e.target.value }))}
                        style={{ minHeight: 130, marginTop: 8 }}
                      />
                    )}
                  </div>
                </div>
                <div className="toolbar" style={{ marginTop: 10 }}>
                  <button className="btn btn-primary" onClick={onBatchAdvanceStage} disabled={busy || !canBatchStage}>执行批量推进</button>
                </div>
                {batchStageResult ? (
                  <div className="muted" style={{ marginTop: 8 }}>
                    执行结果：总计 {Number(batchStageResult.total || 0)}，成功 {Number(batchStageResult.success_count || 0)}，失败 {Number(batchStageResult.failure_count || 0)}
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        {activeMenu === 'create' ? (
          <section className="panel">
            <div className="panel-header">
              <strong>新建流转单</strong>
            </div>
            <div className="panel-body">
              <form className="grid" onSubmit={onCreateJob}>
                <div className="field">
                  <label>设备SN（系统安装后补录）</label>
                  <input
                    value={createForm.device_sn}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, device_sn: e.target.value }))}
                    placeholder="可留空，系统安装完成后填写"
                  />
                </div>
                <div className="field">
                  <label>客户名称 *</label>
                  <input
                    value={createForm.customer_name}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, customer_name: e.target.value }))}
                    placeholder="客户公司"
                    required
                  />
                </div>
                <div className="field">
                  <label>销售订单号</label>
                  <input
                    value={createForm.sales_order_no}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, sales_order_no: e.target.value }))}
                    placeholder="可选"
                  />
                </div>
                <div className="field">
                  <label>来件快递单号</label>
                  <input
                    value={createForm.inbound_tracking_no}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, inbound_tracking_no: e.target.value }))}
                    placeholder="可选"
                  />
                </div>
                <div className="field" style={{ gridColumn: '1 / -1' }}>
                  <label>备注</label>
                  <textarea value={createForm.remark} onChange={(e) => setCreateForm((prev) => ({ ...prev, remark: e.target.value }))} />
                </div>
                <div className="toolbar" style={{ gridColumn: '1 / -1' }}>
                  <button className="btn btn-primary" type="submit" disabled={!canCreateJob || busy}>
                    {busy ? '提交中...' : '创建流转单'}
                  </button>
                  {!canCreateJob ? <span className="muted">当前角色无创建权限</span> : null}
                </div>
              </form>
            </div>
          </section>
        ) : null}

        {activeMenu === 'permissions' ? (
          <section className="panel">
            <div className="panel-header">
              <strong>权限设置</strong>
              <div className="toolbar">
                <button className="btn" onClick={refreshPermissionSettings} disabled={permissionLoading}>
                  {permissionLoading ? '加载中...' : '刷新'}
                </button>
                <button className="btn" onClick={onAddPermissionPolicy} disabled={!canManagePermissions || permissionLoading}>
                  新增策略
                </button>
                <button className="btn btn-primary" onClick={onSavePermissionPolicies} disabled={!canManagePermissions || permissionLoading}>
                  保存策略
                </button>
              </div>
            </div>
            <div className="panel-body">
              <div className="permission-overview-grid">
                {permissionOverviewGroups.map((group) => (
                  <div className="permission-overview-card" key={group.title}>
                    <div className="section-title-row">
                      <div>
                        <strong>{group.title}</strong>
                        <div className="muted">{group.description}</div>
                      </div>
                      <span className="stage-chip">{group.rows.filter((item) => item.allowed).length}/{group.rows.length}</span>
                    </div>
                    <div className="permission-pill-list">
                      {group.rows.slice(0, 10).map((item) => (
                        <span className={item.allowed ? 'allowed' : 'denied'} key={`${group.title}-${item.key}`}>
                          {item.label}
                        </span>
                      ))}
                      {group.rows.length > 10 ? <span>还有 {group.rows.length - 10} 项</span> : null}
                      {group.rows.length === 0 ? <span>暂无元数据</span> : null}
                    </div>
                  </div>
                ))}
              </div>
              <div className="section-title-row" style={{ marginTop: 16, marginBottom: 10 }}>
                <div>
                  <strong>策略明细</strong>
                  <div className="muted">
                    在这里选择用户并配置权限项；用户角色仍在系统管理中维护。命中策略后，DENY 优先于 ALLOW。
                  </div>
                </div>
                <span className="muted">已加载 {Number(permissionPolicies.length || 0)} 条</span>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>用户</th>
                      <th>部门</th>
                      <th>权限项</th>
                      <th>适用阶段</th>
                      <th>结果</th>
                      <th>启用</th>
                      <th>备注</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {permissionPolicyDrafts.map((item, idx) => (
                      <tr key={`permission-policy-${idx}`}>
                        <td>
                          <select
                            value={item.user_sub}
                            onChange={(e) => {
                              const selected = permissionUserOptions.find((entry) => entry.value === e.target.value)
                              updatePermissionPolicyDraft(idx, {
                                user_sub: e.target.value,
                                user_name: selected?.name || '',
                                role_code: selected?.role || '*',
                                department_code: selected?.department_code || '*',
                              })
                            }}
                            disabled={!canManagePermissions || systemUsersLoading}
                          >
                            <option value="">{systemUsersLoading ? '用户加载中...' : '选择用户'}</option>
                            {permissionUserOptions.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            value={item.department_code}
                            onChange={(e) => updatePermissionPolicyDraft(idx, { department_code: e.target.value })}
                            disabled={!canManagePermissions}
                            placeholder="*"
                          />
                        </td>
                        <td>
                          <select
                            multiple
                            value={item.selected_action_codes}
                            onChange={(e) => {
                              const values = Array.from(e.target.selectedOptions).map((option) => option.value)
                              const first = values[0] || 'menu.jobs'
                              const option = permissionActionOptions.find((entry) => entry.value === first)
                              updatePermissionPolicyDraft(idx, {
                                action_code: first,
                                selected_action_codes: values,
                                stage_code: option?.stage_code || '*',
                              })
                            }}
                            disabled={!canManagePermissions}
                            size={4}
                          >
                            {(permissionActionOptions.length ? permissionActionOptions : [{ value: 'menu.jobs', label: '菜单：流转单列表' }]).map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            value={item.stage_code}
                            onChange={(e) => updatePermissionPolicyDraft(idx, { stage_code: e.target.value })}
                            disabled={!canManagePermissions}
                          >
                            <option value="*">全部阶段</option>
                            {Object.entries(stageLabelMap).map(([stage, label]) => (
                              <option key={stage} value={stage}>{label}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            value={item.effect}
                            onChange={(e) => updatePermissionPolicyDraft(idx, { effect: e.target.value })}
                            disabled={!canManagePermissions}
                          >
                            <option value="ALLOW">允许</option>
                            <option value="DENY">拒绝</option>
                          </select>
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            checked={Boolean(item.enabled)}
                            onChange={(e) => updatePermissionPolicyDraft(idx, { enabled: e.target.checked })}
                            disabled={!canManagePermissions}
                          />
                        </td>
                        <td>
                          <input
                            value={item.note}
                            onChange={(e) => updatePermissionPolicyDraft(idx, { note: e.target.value })}
                            disabled={!canManagePermissions}
                            placeholder="可选"
                          />
                        </td>
                        <td>
                          <button className="btn btn-danger" onClick={() => removePermissionPolicyDraft(idx)} disabled={!canManagePermissions || permissionPolicyDrafts.length <= 1}>
                            移除
                          </button>
                        </td>
                      </tr>
                    ))}
                    {permissionPolicyDrafts.length === 0 ? (
                      <tr><td colSpan={8} className="muted">暂无权限策略</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <div className="muted" style={{ marginTop: 10 }}>
                当前已加载策略：{Number(permissionPolicies.length || 0)} 条
              </div>
            </div>
          </section>
        ) : null}

        {activeMenu === 'jobs' ? (
          <>
            <section className="panel">
              <div className="panel-header">
                <strong>流转单列表</strong>
                <div className="toolbar">
                  <input
                    value={filters.keyword}
                    onChange={(e) => setFilters((prev) => ({ ...prev, keyword: e.target.value }))}
                    placeholder="搜索单号/客户/来件/SN"
                  />
                  <select value={filters.stage} onChange={(e) => setFilters((prev) => ({ ...prev, stage: e.target.value }))}>
                    {stageOptions.map((item) => (
                      <option key={item.value || 'all'} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                  <button className="btn" onClick={() => refreshJobs()} disabled={loading}>刷新</button>
                </div>
              </div>
              <div className="panel-body">
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>流转单号</th>
                        <th>设备SN</th>
                        <th>客户</th>
                        <th>来件单号</th>
                        <th>发货单号</th>
                        <th>当前阶段</th>
                        <th>更新时间</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobs.map((row) => (
                        <tr key={row.id}>
                          <td>{row.job_no}</td>
                          <td>{deviceSnText(row.device_sn)}</td>
                          <td>{row.customer_name || '-'}</td>
                          <td>{row.inbound_tracking_no || '-'}</td>
                          <td>{row.outbound_tracking_no || '-'}</td>
                          <td><span className="stage-chip">{stageText(row.current_stage)}</span></td>
                          <td>{parseApiDate(row.updated_at)}</td>
                          <td>
                            <button
                              className="btn"
                              onClick={() => onOpenJobDetail(row.id)}
                              disabled={busy || (detailModalOpen && Number(selectedJobId || 0) === Number(row.id || 0))}
                            >
                              详情
                            </button>
                          </td>
                        </tr>
                      ))}
                      {jobs.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="muted">暂无数据</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>

                <div className="toolbar" style={{ marginTop: 12 }}>
                  <span className="muted">共 {total} 条</span>
                  <button className="btn" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>上一页</button>
                  <span className="muted">第 {page} 页</span>
                  <button className="btn" disabled={page * limit >= total} onClick={() => setPage((p) => p + 1)}>下一页</button>
                </div>
              </div>
            </section>

            {detailModalOpen ? (
              <div
                className="floating-modal-mask"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) closeDetailModal()
                }}
              >
                <section
                  className={`floating-modal device-flow-detail-modal ${detailModalDragging ? 'dragging' : ''}`}
                  ref={detailModalRef}
                  style={{
                    transform: `translate(calc(-50% + ${detailModalPosition.x}px), calc(-50% + ${detailModalPosition.y}px))`,
                  }}
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <header className="floating-modal-header" onPointerDown={onStartDetailModalDrag}>
                    <div>
                      <h3>详情工作台</h3>
                      <div className="muted">流转单号：{detailMatchesSelection ? detail?.job_no || '-' : '-'} | 拖动标题栏可移动</div>
                    </div>
                    <button type="button" className="btn" onClick={closeDetailModal}>关闭</button>
                  </header>

                  <div className="floating-modal-body">
                    {!selectedJobId ? (
                      <div className="muted">请先从列表选择一条流转单</div>
                    ) : detailLoading || !detailMatchesSelection ? (
                      <div className="muted">正在加载流转详情...</div>
                    ) : !detail ? (
                      <div className="muted">未找到流转详情</div>
                    ) : (
                      <>
                        <div className="grid detail-summary-grid">
                          <div className="field"><label>流转单号</label><input value={detail.job_no || '-'} readOnly /></div>
                          <div className="field"><label>设备SN</label><input value={deviceSnText(detail.device_sn)} readOnly /></div>
                          <div className="field"><label>客户</label><input value={detail.customer_name || '-'} readOnly /></div>
                          <div className="field"><label>当前阶段</label><input value={stageText(detail.current_stage)} readOnly /></div>
                          <div className="field"><label>来件单号</label><input value={detail.inbound_tracking_no || '-'} readOnly /></div>
                          <div className="field"><label>发货单号</label><input value={detail.outbound_tracking_no || '-'} readOnly /></div>
                          <div className="field"><label>收货时间</label><input value={parseApiDate(detail.received_at)} readOnly /></div>
                          <div className="field"><label>发货时间</label><input value={parseApiDate(detail.shipped_at)} readOnly /></div>
                        </div>

                        <div className="workflow-stepper">
                          {workflowSteps.map((item) => (
                            <div className={`workflow-step ${item.state}`} key={`workflow-${item.stage}`}>
                              <div className="workflow-dot" />
                              <div>
                                <strong>{item.label}</strong>
                                <span>{item.context}</span>
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className="detail-tabbar">
                          {detailTabs.map((item) => (
                            <button
                              type="button"
                              className={activeDetailTab === item.key ? 'active' : ''}
                              key={item.key}
                              onClick={() => setActiveDetailTab(item.key)}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>

                        {activeDetailTab === 'responsibility' ? (
                        <div style={{ marginTop: 16 }} className="panel-subsection">
                          <strong>关键节点责任人</strong>
                          <div className="table-wrap" style={{ marginTop: 8 }}>
                            <table className="table">
                              <thead>
                                <tr>
                                  <th>阶段</th>
                                  <th>执行人</th>
                                  <th>角色</th>
                                  <th>执行时间</th>
                                </tr>
                              </thead>
                              <tbody>
                                {responsibilityRows.map((item) => (
                                  <tr key={`resp-${item.stage}`}>
                                    <td>{stageText(item.stage)}</td>
                                    <td>{item.by || '-'}</td>
                                    <td>{item.role || '-'}</td>
                                    <td>{parseApiDate(item.at)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                        ) : null}

                        {activeDetailTab === 'advance' ? (
                        <div style={{ marginTop: 16 }} className="panel-subsection detail-workbench">
                          <div className="section-title-row">
                            <div>
                              <strong>推荐动作</strong>
                              <div className="muted">先判断业务路径，再填写当前动作需要的信息。</div>
                            </div>
                            {nextAction ? <span className="stage-chip">{stageText(nextStageCode)}</span> : null}
                          </div>
                          <div className="grid" style={{ marginTop: 8 }}>
                            {availableNextActions.length > 0 ? (
                              <div className="action-choice-grid" style={{ gridColumn: '1 / -1' }}>
                                {availableNextActions.map((action, idx) => {
                                  const guidance = actionGuidanceMap[action] || { title: actionLabelMap[action] || action, hint: '' }
                                  const allowed = permissionStageActionAllowed(action)
                                  const selected = action === nextAction
                                  return (
                                    <button
                                      type="button"
                                      className={`action-choice ${selected ? 'selected' : ''}`}
                                      key={action}
                                      onClick={() => setSelectedAdvanceAction(action)}
                                      disabled={!allowed}
                                    >
                                      <span>{idx === 0 ? '推荐动作' : '可选路径'}</span>
                                      <strong>{guidance.title}</strong>
                                      <em>{guidance.hint}</em>
                                    </button>
                                  )
                                })}
                              </div>
                            ) : (
                              <div className="empty-state" style={{ gridColumn: '1 / -1' }}>流程已完成，当前无需继续推进。</div>
                            )}
                            <div className="field" style={{ gridColumn: '1 / -1' }}>
                              <label>阶段备注</label>
                              <textarea
                                value={advanceForm.remark}
                                onChange={(e) => setAdvanceForm((prev) => ({ ...prev, remark: e.target.value }))}
                                placeholder="阶段备注"
                              />
                            </div>
                            {renderStageFields()}
                          </div>
                          <div className="toolbar" style={{ marginTop: 10 }}>
                            <button className="btn btn-primary" onClick={onAdvanceStage} disabled={!nextAction || busy || !canRunNextAction}>
                              {nextAction ? actionLabelMap[nextAction] : '流程已完成'}
                            </button>
                            {nextAction && !canRunNextAction ? <span className="muted">当前角色无权限执行该阶段</span> : null}
                          </div>
                        </div>
                        ) : null}

                        {activeDetailTab === 'rework' ? (
                        <div style={{ marginTop: 16 }} className="panel-subsection">
                          <strong>退回重做</strong>
                          <div className="toolbar" style={{ marginTop: 8 }}>
                            <select
                              value={reworkForm.target_stage}
                              onChange={(e) => setReworkForm((prev) => ({ ...prev, target_stage: e.target.value }))}
                            >
                              {reworkTargetOptions.map((item) => (
                                <option key={item.value} value={item.value}>
                                  {item.label}
                                </option>
                              ))}
                            </select>
                            <input
                              value={reworkForm.reason}
                              onChange={(e) => setReworkForm((prev) => ({ ...prev, reason: e.target.value }))}
                              placeholder="退回原因（必填）"
                            />
                            <button className="btn btn-warning" onClick={onRework} disabled={reworkTargetOptions.length === 0 || busy || !canRework}>
                              退回重做
                            </button>
                          </div>
                        </div>
                        ) : null}

                        {activeDetailTab === 'attachments' ? (
                        <div style={{ marginTop: 16 }} className="panel-subsection">
                          <div className="section-title-row">
                            <div>
                              <strong>附件上传与留证</strong>
                              <div className="muted">留证要求：当前关注“{stageText(evidenceStageCode)}”，已上传 {evidenceStageCount} 个附件。</div>
                            </div>
                            <span className={`evidence-badge ${evidenceRequired && evidenceStageCount === 0 ? 'warning' : ''}`}>
                              {evidenceStatusText}
                            </span>
                          </div>
                          <div className="grid" style={{ marginTop: 8 }}>
                            <div className="field">
                              <label>所属阶段</label>
                              <select
                                value={attachmentForm.stage_code}
                                onChange={(e) => setAttachmentForm((prev) => ({ ...prev, stage_code: e.target.value }))}
                              >
                                {Object.entries(stageLabelMap).map(([value, label]) => (
                                  <option key={value} value={value}>{label}</option>
                                ))}
                              </select>
                            </div>
                            <div className="field">
                              <label>附件文件</label>
                              <input
                                type="file"
                                onChange={(e) => {
                                  const file = e.target.files && e.target.files[0] ? e.target.files[0] : null
                                  const maxFileSizeBytes = Number(attachmentUploadSetting?.max_file_size_bytes || 0)
                                  if (file && maxFileSizeBytes > 0 && Number(file.size || 0) > maxFileSizeBytes) {
                                    showError(`文件大小 ${formatFileSize(file.size)} 超过当前上限 ${attachmentUploadSetting.max_file_size_mb}MB`)
                                    e.target.value = ''
                                    setAttachmentForm((prev) => ({ ...prev, file: null }))
                                    return
                                  }
                                  setAttachmentForm((prev) => ({ ...prev, file }))
                                }}
                              />
                              {attachmentForm.file ? <span className="muted">当前文件：{formatFileSize(attachmentForm.file.size)}</span> : null}
                            </div>
                            <div className="field">
                              <label>上传上限（MB）</label>
                              <div className="toolbar">
                                <input
                                  type="number"
                                  min={Number(attachmentUploadSetting?.min_file_size_mb || 1)}
                                  max={Number(attachmentUploadSetting?.max_allowed_file_size_mb || 200)}
                                  step="1"
                                  value={attachmentUploadSettingForm}
                                  onChange={(e) => setAttachmentUploadSettingForm(e.target.value)}
                                  disabled={!canEditAttachmentUploadSetting || attachmentUploadSettingLoading}
                                />
                                <button
                                  className="btn"
                                  onClick={onSaveAttachmentUploadSetting}
                                  disabled={!canEditAttachmentUploadSetting || attachmentUploadSettingLoading}
                                >
                                  {attachmentUploadSettingLoading ? '保存中...' : '保存'}
                                </button>
                              </div>
                              <span className="muted">
                                当前上限：{Number(attachmentUploadSetting?.max_file_size_mb || attachmentUploadSettingForm || 10)}MB
                              </span>
                            </div>
                            <div className="field" style={{ gridColumn: '1 / -1' }}>
                              <label>附件备注</label>
                              <textarea value={attachmentForm.remark} onChange={(e) => setAttachmentForm((prev) => ({ ...prev, remark: e.target.value }))} />
                            </div>
                          </div>
                          <div className="toolbar" style={{ marginTop: 8 }}>
                            <button className="btn btn-primary" onClick={onUploadAttachment} disabled={busy || !canUpload}>上传附件</button>
                            {!canUpload ? <span className="muted">当前角色无上传权限</span> : null}
                            {evidenceRequired ? (
                              <span className="muted">提示：推进到“{stageText(evidenceStageCode)}”前，需先上传该阶段至少1个附件。</span>
                            ) : null}
                          </div>

                          <div className="table-wrap" style={{ marginTop: 10 }}>
                            <table className="table">
                              <thead>
                                <tr>
                                  <th>文件名</th>
                                  <th>阶段</th>
                                  <th>大小</th>
                                  <th>上传人</th>
                                  <th>上传时间</th>
                                  <th>备注</th>
                                  <th>操作</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(Array.isArray(detail.attachments) ? detail.attachments : []).map((item) => (
                                  <tr key={item.id}>
                                    <td>{item.file_name}</td>
                                    <td>{stageText(item.stage_code)}</td>
                                    <td>{formatFileSize(item.file_size)}</td>
                                    <td>{item.uploaded_by_name || '-'}</td>
                                    <td>{parseApiDate(item.uploaded_at)}</td>
                                    <td>{item.remark || '-'}</td>
                                    <td>
                                      <div className="toolbar">
                                        <button className="btn" onClick={() => onDownloadAttachment(item)}>下载</button>
                                        {canDeleteAttachment ? (
                                          <button className="btn btn-danger" onClick={() => onDeleteAttachment(item)} disabled={busy}>删除</button>
                                        ) : null}
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                                {(Array.isArray(detail.attachments) ? detail.attachments : []).length === 0 ? (
                                  <tr><td colSpan={7} className="muted">暂无附件</td></tr>
                                ) : null}
                              </tbody>
                            </table>
                          </div>
                        </div>
                        ) : null}

                        {activeDetailTab === 'history' ? (
                        <div style={{ marginTop: 14 }}>
                          <strong>阶段时间轴</strong>
                          <div className="timeline" style={{ marginTop: 8 }}>
                            {(Array.isArray(detail.stage_records) ? detail.stage_records : []).map((item) => (
                              <div className="timeline-item" key={item.id}>
                                <div>
                                  <strong>{timelineActionText(item.action)}</strong> · {stageText(item.from_stage)} → {stageText(item.to_stage)}
                                </div>
                                <div className="muted">
                                  执行人：{item.operator_name || '-'} ({item.operator_role || '-'}) · {parseApiDate(item.operated_at)}
                                </div>
                                {item.remark ? <div className="muted">备注：{item.remark}</div> : null}
                                {item.rework_reason ? <div className="muted">退回原因：{item.rework_reason}</div> : null}
                                {formatStagePayload(item.stage_payload).map((line, idx) => (
                                  <div className="muted" key={`${item.id}-payload-${idx}`}>- {line}</div>
                                ))}
                              </div>
                            ))}
                            {(Array.isArray(detail.stage_records) ? detail.stage_records : []).length === 0 ? (
                              <div className="muted">暂无阶段记录</div>
                            ) : null}
                          </div>
                        </div>
                        ) : null}
                      </>
                    )}
                  </div>
                </section>
              </div>
            ) : null}
          </>
        ) : null}

        {canReadAuditLogs && activeMenu === 'audit' ? (
          <section className="panel">
            <div className="panel-header">
              <strong>审计日志</strong>
            </div>
            <div className="panel-body">
              <div className="grid">
                <div className="field">
                  <label>开始日期</label>
                  <input
                    type="date"
                    value={auditFilter.from}
                    onChange={(e) => {
                      setAuditPage(1)
                      setAuditFilter((prev) => ({ ...prev, from: e.target.value }))
                    }}
                  />
                </div>
                <div className="field">
                  <label>结束日期</label>
                  <input
                    type="date"
                    value={auditFilter.to}
                    onChange={(e) => {
                      setAuditPage(1)
                      setAuditFilter((prev) => ({ ...prev, to: e.target.value }))
                    }}
                  />
                </div>
                <div className="field">
                  <label>动作</label>
                  <select
                    value={auditFilter.action}
                    onChange={(e) => {
                      setAuditPage(1)
                      setAuditFilter((prev) => ({ ...prev, action: e.target.value }))
                    }}
                  >
                    {auditActionOptions.map((item) => (
                      <option key={item.value || 'all'} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>操作人</label>
                  <input
                    value={auditFilter.username}
                    onChange={(e) => {
                      setAuditPage(1)
                      setAuditFilter((prev) => ({ ...prev, username: e.target.value }))
                    }}
                    placeholder="用户名"
                  />
                </div>
                <div className="field" style={{ gridColumn: '1 / -1' }}>
                  <label>关键词</label>
                  <input
                    value={auditFilter.keyword}
                    onChange={(e) => {
                      setAuditPage(1)
                      setAuditFilter((prev) => ({ ...prev, keyword: e.target.value }))
                    }}
                    placeholder="支持流转单号/客户/SN/动作/说明"
                  />
                </div>
              </div>

              <div className="toolbar" style={{ marginTop: 10 }}>
                <button className="btn" onClick={() => refreshAuditLogs()} disabled={auditLoading}>
                  {auditLoading ? '加载中...' : '查询'}
                </button>
                <button className="btn btn-primary" onClick={onExportAudit} disabled={busy}>导出 CSV</button>
              </div>

              <div className="table-wrap" style={{ marginTop: 10 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>操作人</th>
                      <th>角色</th>
                      <th>动作</th>
                      <th>流转单号</th>
                      <th>设备SN</th>
                      <th>说明</th>
                      <th>来源IP</th>
                      <th>变更摘要</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map((row) => (
                      <tr key={`audit-${row.id}`}>
                        <td>{parseApiDate(row.created_at)}</td>
                        <td>{row.username || '-'}</td>
                        <td>{roleText(row.user_role)}</td>
                        <td>{auditActionText(row.action)}</td>
                        <td>
                          {row.job_id ? (
                            <button
                              type="button"
                              className="text-link"
                              onClick={() => onOpenJobDetail(row.job_id)}
                              disabled={busy}
                            >
                              {row.job_no || `#${row.job_id}`}
                            </button>
                          ) : (
                            row.job_no || '-'
                          )}
                        </td>
                        <td>{deviceSnText(row.device_sn)}</td>
                        <td>{auditMessageText(row.message)}</td>
                        <td>{row.request_ip || '-'}</td>
                        <td>{buildAuditChangeSummary(row.before_data, row.after_data)}</td>
                      </tr>
                    ))}
                    {auditLogs.length === 0 ? (
                      <tr><td colSpan={9} className="muted">暂无日志</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <div className="toolbar" style={{ marginTop: 10 }}>
                <span className="muted">共 {auditTotal} 条</span>
                <button className="btn" disabled={auditPage <= 1} onClick={() => setAuditPage((p) => Math.max(1, p - 1))}>上一页</button>
                <span className="muted">第 {auditPage} 页</span>
                <button className="btn" disabled={auditPage * auditLimit >= auditTotal} onClick={() => setAuditPage((p) => p + 1)}>下一页</button>
              </div>
            </div>
          </section>
        ) : null}

        {canReadAuditLogs && activeMenu === 'audit-verify' ? (
          <section className="panel">
            <div className="panel-header">
              <strong>审计验签</strong>
            </div>
            <div className="panel-body">
              <div className="grid">
                <div className="field">
                  <label>起始日志ID（可选）</label>
                  <input
                    type="number"
                    min={1}
                    value={auditVerifyForm.from_id}
                    onChange={(e) => setAuditVerifyForm((prev) => ({ ...prev, from_id: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label>结束日志ID（可选）</label>
                  <input
                    type="number"
                    min={1}
                    value={auditVerifyForm.to_id}
                    onChange={(e) => setAuditVerifyForm((prev) => ({ ...prev, to_id: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label>校验条数上限</label>
                  <input
                    type="number"
                    min={1}
                    max={20000}
                    value={auditVerifyForm.limit}
                    onChange={(e) => setAuditVerifyForm((prev) => ({ ...prev, limit: e.target.value }))}
                  />
                </div>
              </div>

              <div className="toolbar" style={{ marginTop: 10 }}>
                <button className="btn btn-primary" onClick={onVerifyAuditChain} disabled={auditVerifyLoading || busy}>
                  {auditVerifyLoading ? '验签中...' : '执行验签'}
                </button>
              </div>

              {!auditVerifyResult ? (
                <div className="muted" style={{ marginTop: 10 }}>尚未执行验签</div>
              ) : (
                <>
                  <div className={`msg ${auditVerifyResult.passed ? 'success' : 'error'}`} style={{ marginTop: 10 }}>
                    校验时间：{parseApiDate(auditVerifyResult.verified_at)}，
                    校验 {Number(auditVerifyResult.total_checked || 0)} 条，
                    问题 {Number(auditVerifyResult.issue_count || 0)} 条。
                  </div>

                  <div className="table-wrap" style={{ marginTop: 10 }}>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>日志ID</th>
                          <th>问题类型</th>
                          <th>期望值</th>
                          <th>实际值</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(Array.isArray(auditVerifyResult.issues) ? auditVerifyResult.issues : []).map((item, idx) => (
                          <tr key={`audit-issue-${idx}-${item.id}`}>
                            <td>{item.id}</td>
                            <td>{item.issue}</td>
                            <td className="mono">{item.expected_hash || item.expected_prev_hash || '-'}</td>
                            <td className="mono">{item.actual_hash || item.actual_prev_hash || '-'}</td>
                          </tr>
                        ))}
                        {(Array.isArray(auditVerifyResult.issues) ? auditVerifyResult.issues : []).length === 0 ? (
                          <tr><td colSpan={4} className="muted">未发现审计链问题</td></tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </section>
        ) : null}
      </main>

      {confirmDialog.open ? (
        <div className="dialog-backdrop" onClick={closeConfirmDialog}>
          <div className="dialog-card" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-title">{confirmDialog.title || '确认操作'}</div>
            <div className="dialog-body">{confirmDialog.message || '确认执行该操作？'}</div>
            <div className="dialog-actions">
              <button className="btn" type="button" onClick={closeConfirmDialog}>取消</button>
              <button className="btn btn-primary" type="button" onClick={onConfirmDialogAccept}>
                {confirmDialog.confirmLabel || '确认'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default App
