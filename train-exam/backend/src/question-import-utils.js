const trimText = (value) => String(value || '').trim();

const buildQuestionImportTemplateRows = () => ([
  [
    '题干',
    '分类',
    '题型',
    '难度',
    '分值',
    '选项A',
    '选项B',
    '选项C',
    '选项D',
    '答案值',
    '标准答案文本',
    '同义答案',
    '解析',
    '标签',
  ],
  [
    '以下哪项是信息安全制度的核心目标？',
    '网络安全',
    '单选题',
    '中等',
    '2',
    '保障机密性、完整性、可用性',
    '只关注成本',
    '只关注性能',
    '',
    'A',
    '',
    '',
    '核心目标是CIA三要素。',
    '安全,制度',
  ],
  [
    '以下哪些做法属于账号口令管理要求？',
    '账号安全',
    '多选题',
    '中等',
    '2',
    '定期更新高风险账号密码',
    '多人共用同一个管理员账号',
    '密码复杂度符合制度要求',
    '将密码明文贴在工位上',
    'A,C',
    '',
    '',
    '多选题答案可使用逗号分隔多个选项。',
    '账号,口令',
  ],
  [
    '发现安全事件后可以等到月底统一上报。',
    '安全流程',
    '判断题',
    '简单',
    '1',
    '正确',
    '错误',
    '',
    '',
    '错误',
    '',
    '',
    '安全事件应按制度要求及时上报。',
    '应急,流程',
  ],
]);

const normalizeJudgementAnswer = (value) => {
  const answer = trimText(Array.isArray(value) ? value[0] : value).toLowerCase();
  if (!answer) return '';
  if (['true', 't', '对', '正确', 'yes', 'y', '是', '1', 'a'].includes(answer)) return 'true';
  if (['false', 'f', '错', '错误', 'no', 'n', '否', '0', 'b'].includes(answer)) return 'false';
  return '';
};

const resolveImportQuestionStatus = ({ publishAfterImport = false, canReview = false } = {}) =>
  publishAfterImport && canReview ? 'published' : 'draft';

module.exports = {
  buildQuestionImportTemplateRows,
  normalizeJudgementAnswer,
  resolveImportQuestionStatus,
};
