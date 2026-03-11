const trimText = (value) => String(value || '').trim();

const normalizePaperRuleCategories = (value) => {
  const values = Array.isArray(value)
    ? value
    : trimText(value)
      ? String(value).split(/[，,、\n\r;；|]+/)
      : [];

  return Array.from(
    new Set(
      values
        .map((item) => trimText(item))
        .filter(Boolean)
        .map((item) => item.slice(0, 64))
    )
  ).slice(0, 50);
};

module.exports = {
  normalizePaperRuleCategories,
};
