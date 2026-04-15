export const readConfigTestBlockMessage = ({ configDirty = false, configSaving = false } = {}) => {
  if (configSaving) return '配置保存中，请稍候再测试'
  if (configDirty) return '配置已修改但未保存，请先点击“保存配置”'
  return ''
}

export const pickBusinessConfigs = (configForm = {}) => {
  const { security, ...businessConfigs } = configForm || {}
  return businessConfigs
}

export const buildBusinessConfigSnapshot = (configForm = {}) =>
  JSON.stringify(pickBusinessConfigs(configForm))

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
