export const readConfigTestBlockMessage = ({ configDirty = false, configSaving = false } = {}) => {
  if (configSaving) return '配置保存中，请稍候再测试'
  if (configDirty) return '配置已修改但未保存，请先点击“保存配置”'
  return ''
}

export const CONFIG_SECRET_MASK = '******'

export const BUSINESS_CONFIG_SECTION_FIELDS = Object.freeze({
  email: ['email'],
  sms: ['sms'],
  ocr: ['ocr'],
  wecom: ['wecom'],
  control: ['retry', 'rateLimit'],
  template: ['reminder'],
})

export const pickBusinessConfigs = (configForm = {}) => {
  const { security, ...businessConfigs } = configForm || {}
  return businessConfigs
}

export const pickBusinessConfigSection = (configForm = {}, sectionKey = '') => {
  const fields = BUSINESS_CONFIG_SECTION_FIELDS[sectionKey] || []
  return fields.reduce((acc, fieldKey) => {
    if (Object.prototype.hasOwnProperty.call(configForm || {}, fieldKey)) {
      acc[fieldKey] = configForm[fieldKey]
    }
    return acc
  }, {})
}

export const buildBusinessConfigFormFromApi = (configForm = {}, previousConfig = {}) => {
  const previousBusinessConfigs = pickBusinessConfigs(previousConfig)
  const smsConfig = configForm.sms || {}
  return {
    email: configForm.email || previousBusinessConfigs.email || {},
    sms: { ...(previousBusinessConfigs.sms || {}), ...smsConfig },
    wecom: configForm.wecom || previousBusinessConfigs.wecom || {},
    ocr: configForm.ocr || previousBusinessConfigs.ocr || {},
    reminder: configForm.reminder || previousBusinessConfigs.reminder || {},
    reminderSchedule: configForm.reminderSchedule || previousBusinessConfigs.reminderSchedule || {},
    retry: configForm.retry || previousBusinessConfigs.retry || {},
    rateLimit: configForm.rateLimit || previousBusinessConfigs.rateLimit || {},
  }
}

export const buildBusinessConfigSnapshot = (configForm = {}) =>
  JSON.stringify(pickBusinessConfigs(configForm))

export const maskBusinessSecretFields = (configForm = {}, previousConfig = {}) => {
  const next = JSON.parse(JSON.stringify(configForm || {}))
  const previous = previousConfig || {}

  const maskIfPresent = (groupKey, fieldKey) => {
    if (!next?.[groupKey]) return
    const currentValue = String(next[groupKey][fieldKey] ?? '').trim()
    const previousValue = String(previous?.[groupKey]?.[fieldKey] ?? '').trim()
    if (currentValue || previousValue) {
      next[groupKey][fieldKey] = CONFIG_SECRET_MASK
    }
  }

  maskIfPresent('email', 'pass')
  maskIfPresent('sms', 'accessKeySecret')
  maskIfPresent('wecom', 'secret')
  maskIfPresent('ocr', 'accessKeySecret')

  return next
}

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export const listBusinessConfigDiffPaths = (currentConfig = {}, savedConfig = {}) => {
  const diffs = []

  const walk = (currentValue, savedValue, path) => {
    if (currentValue === savedValue) return

    if (Array.isArray(currentValue) || Array.isArray(savedValue)) {
      if (JSON.stringify(currentValue ?? null) !== JSON.stringify(savedValue ?? null)) {
        diffs.push(path || '配置')
      }
      return
    }

    if (isPlainObject(currentValue) && isPlainObject(savedValue)) {
      const keys = Array.from(new Set([...Object.keys(currentValue), ...Object.keys(savedValue)])).sort()
      keys.forEach((key) => walk(currentValue[key], savedValue[key], path ? `${path}.${key}` : key))
      return
    }

    diffs.push(path || '配置')
  }

  walk(currentConfig, savedConfig, '')
  return Array.from(new Set(diffs))
}

export const describeBusinessConfigDiffs = (diffPaths = []) => {
  if (!Array.isArray(diffPaths) || diffPaths.length === 0) return ''
  const preview = diffPaths.slice(0, 3).join('、')
  return diffPaths.length > 3 ? `${preview} 等 ${diffPaths.length} 项` : preview
}
