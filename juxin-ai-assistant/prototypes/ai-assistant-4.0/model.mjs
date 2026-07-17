const INITIAL_BLOCKS = [
  {
    id: 'executive-summary',
    type: 'paragraph',
    orderLabel: '01',
    eyebrow: '核心判断',
    title: '从“生成答案”升级为“交付成果”',
    body: '聚信 AI 助手 4.0 的重点，不是再增加一个聊天入口，而是让 AI 按照专业 Skill、资料、模板和质量规则，持续生成可编辑、可审核、可追溯的正式成果。',
  },
  {
    id: 'risk-register',
    type: 'table',
    orderLabel: '02',
    eyebrow: '上线门槛',
    title: '关键风险与控制动作',
    columns: ['风险', '影响', '控制动作'],
    rows: [
      ['事实口径漂移', '结论不可复核', '发布前绑定事实来源'],
      ['草稿相互覆盖', '审核记录丢失', '单活编辑权 + 修订号'],
      ['Office 转换失真', '错误内容进入交付', '输出支持 / 降级 / 拒绝报告'],
    ],
  },
  {
    id: 'architecture-map',
    type: 'image',
    orderLabel: '03',
    eyebrow: '工作方式',
    title: '自动流程与人工审核边界',
    caption: '图 1 · AI 负责规划、执行和自检；人负责处理阻断项并批准正式版本。',
  },
  {
    id: 'delivery-plan',
    type: 'paragraph',
    orderLabel: '04',
    eyebrow: '落地顺序',
    title: '先稳定单人编辑，再扩展自动流程',
    body: '第一阶段冻结内容块、草稿、版本和恢复契约；第二阶段接入 Office 导入导出；第三阶段再开放多人协作和更多自动触发器。',
  },
];

function deepClone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

export function cloneBlocks(blocks) {
  return deepClone(blocks);
}

export function createInitialState() {
  return {
    blocks: cloneBlocks(INITIAL_BLOCKS),
    selectedId: INITIAL_BLOCKS[0].id,
    activeInspector: 'evidence',
    saveState: 'saved',
    version: 3,
    versions: [
      { version: 3, label: '当前评审稿', author: '张磊', time: '刚刚' },
      { version: 2, label: '完成结构审阅', author: 'AI 助手', time: '今天 09:32' },
      { version: 1, label: '自动流程初稿', author: 'AI 助手', time: '昨天 18:10' },
    ],
  };
}

export function reorderBlocks(blocks, sourceId, targetId) {
  if (!sourceId || sourceId === targetId) return [...blocks];
  const source = blocks.find((block) => block.id === sourceId);
  if (!source) return [...blocks];
  const next = blocks.filter((block) => block.id !== sourceId);
  const targetIndex = next.findIndex((block) => block.id === targetId);
  if (targetIndex < 0) return [...blocks];
  next.splice(targetIndex, 0, source);
  return next;
}

export function moveBlock(blocks, blockId, direction) {
  const currentIndex = blocks.findIndex((block) => block.id === blockId);
  const targetIndex = currentIndex + direction;
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= blocks.length) return [...blocks];
  const next = [...blocks];
  [next[currentIndex], next[targetIndex]] = [next[targetIndex], next[currentIndex]];
  return next;
}

export function addBlock(blocks, type, sequence) {
  const common = {
    id: `${type}-${sequence}`,
    type,
    orderLabel: String(blocks.length + 1).padStart(2, '0'),
    eyebrow: '新增内容',
    title: type === 'table' ? '新表格' : type === 'image' ? '新图片' : '新段落',
  };

  if (type === 'table') {
    return [...blocks, {
      ...common,
      columns: ['项目', '状态', '说明'],
      rows: [['待补充', '进行中', '点击单元格开始编辑']],
    }];
  }

  if (type === 'image') {
    return [...blocks, {
      ...common,
      caption: '新增图片块 · 正式版将连接素材库与 Office 图片资源。',
    }];
  }

  return [...blocks, {
    ...common,
    body: '点击这里输入内容。这个内容块拥有稳定 ID，可以独立排序、评论和审核。',
  }];
}

export function removeBlock(blocks, blockId) {
  if (blocks.length <= 1) throw new Error('文档至少保留一个内容块');
  return blocks.filter((block) => block.id !== blockId);
}

export function createVersion(blocks, currentVersion, author) {
  return deepFreeze({
    version: currentVersion + 1,
    author,
    createdAt: new Date().toISOString(),
    blocks: cloneBlocks(blocks),
  });
}
