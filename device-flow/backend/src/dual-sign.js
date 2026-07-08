const normalizeExpectedSecondSigner = (value) => {
  const text = String(value || '').trim();
  if (!text) throw new Error('请选择第二复签人');
  return text;
};

const assertExpectedSecondSigner = ({ expectedSub, actorSub, expectedName }) => {
  const expected = normalizeExpectedSecondSigner(expectedSub);
  const actor = String(actorSub || '').trim();
  if (expected !== actor) {
    throw new Error(`该会签已指定由 ${String(expectedName || expected).trim()} 完成复签`);
  }
};

module.exports = {
  assertExpectedSecondSigner,
  normalizeExpectedSecondSigner,
};
