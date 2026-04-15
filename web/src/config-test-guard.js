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
