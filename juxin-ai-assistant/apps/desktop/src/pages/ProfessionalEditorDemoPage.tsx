import { useEffect, useRef, useState, type DragEvent } from 'react';

import './professional-editor-demo.css';

type SaveState = 'saved' | 'dirty' | 'saving';
type ReviewTab = 'facts' | 'review' | 'comments' | 'versions';
type DemoBlockType = 'paragraph' | 'table' | 'image';

interface DemoBlockBase {
  blockId: string;
  label: string;
  type: DemoBlockType;
}

interface ParagraphBlock extends DemoBlockBase {
  type: 'paragraph';
  eyebrow?: string;
  text: string;
}

interface TableBlock extends DemoBlockBase {
  type: 'table';
  columns: string[];
  rows: string[][];
}

interface ImageBlock extends DemoBlockBase {
  type: 'image';
  caption: string;
}

type DemoBlock = ParagraphBlock | TableBlock | ImageBlock;

const initialBlocks: DemoBlock[] = [
  {
    blockId: 'executive-summary',
    label: '执行摘要',
    type: 'paragraph',
    eyebrow: '01 / 核心结论',
    text: '4.0 应把“AI 生成结果”升级为可持续编辑的专业成果：正文保持结构化，修改保留块级定位，审阅结论能够追溯到事实与版本。',
  },
  {
    blockId: 'risk-table',
    label: '风险清单',
    type: 'table',
    columns: ['风险', '影响', '处置建议'],
    rows: [
      ['数据口径', '结论不可复核', '绑定事实来源并在发布前阻断'],
      ['版本覆盖', '审核记录丢失', '草稿可变、正式版本不可变'],
    ],
  },
  {
    blockId: 'architecture-image',
    label: '自动流程结构',
    type: 'image',
    caption: '图 1 · 自动流程与人工审核边界（演示图片块）',
  },
  {
    blockId: 'next-actions',
    label: '下一步',
    type: 'paragraph',
    eyebrow: '04 / 落地顺序',
    text: '先统一内容块、草稿与版本契约，再接入现有 Office 导入导出；多人实时协作放到单人编辑稳定之后。',
  },
];

const tabLabels: Record<ReviewTab, string> = {
  facts: '事实与证据',
  review: '质量审阅',
  comments: '评论',
  versions: '版本',
};

function cloneBlocks(blocks: DemoBlock[]): DemoBlock[] {
  return blocks.map((block) => {
    if (block.type === 'table') {
      return {
        ...block,
        columns: [...block.columns],
        rows: block.rows.map((row) => [...row]),
      };
    }
    return { ...block };
  });
}

function blockKindLabel(type: DemoBlockType): string {
  if (type === 'table') return '表格';
  if (type === 'image') return '图片';
  return '段落';
}

export function ProfessionalEditorDemoPage() {
  const [blocks, setBlocks] = useState<DemoBlock[]>(() => cloneBlocks(initialBlocks));
  const [selectedBlockId, setSelectedBlockId] = useState(initialBlocks[0].blockId);
  const [dragSourceId, setDragSourceId] = useState('');
  const [dragTargetId, setDragTargetId] = useState('');
  const [history, setHistory] = useState<DemoBlock[][]>([]);
  const [future, setFuture] = useState<DemoBlock[][]>([]);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [version, setVersion] = useState(3);
  const [activeTab, setActiveTab] = useState<ReviewTab>('facts');
  const [notice, setNotice] = useState('');
  const blockCounter = useRef(5);

  useEffect(() => {
    if (saveState !== 'dirty') return undefined;
    const timer = window.setTimeout(() => setSaveState('saving'), 900);
    return () => window.clearTimeout(timer);
  }, [blocks, saveState]);

  useEffect(() => {
    if (saveState !== 'saving') return undefined;
    const timer = window.setTimeout(() => setSaveState('saved'), 350);
    return () => window.clearTimeout(timer);
  }, [saveState]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(''), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const commitBlocks = (nextBlocks: DemoBlock[], nextSelectedId?: string) => {
    setHistory((items) => [...items.slice(-19), cloneBlocks(blocks)]);
    setFuture([]);
    setBlocks(nextBlocks);
    setSaveState('dirty');
    if (nextSelectedId) setSelectedBlockId(nextSelectedId);
  };

  const updateBlock = (blockId: string, update: (block: DemoBlock) => DemoBlock) => {
    setBlocks((items) => items.map((block) => (block.blockId === blockId ? update(block) : block)));
    setSaveState('dirty');
  };

  const reorderBlock = (sourceId: string, targetId: string) => {
    if (!sourceId || sourceId === targetId) return;
    const source = blocks.find((block) => block.blockId === sourceId);
    if (!source) return;
    const remaining = blocks.filter((block) => block.blockId !== sourceId);
    const targetIndex = remaining.findIndex((block) => block.blockId === targetId);
    if (targetIndex < 0) return;
    remaining.splice(targetIndex, 0, source);
    commitBlocks(remaining, sourceId);
  };

  const moveBlock = (blockId: string, direction: -1 | 1) => {
    const index = blocks.findIndex((block) => block.blockId === blockId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    commitBlocks(next, blockId);
  };

  const addParagraph = () => {
    const blockId = `paragraph-${blockCounter.current}`;
    blockCounter.current += 1;
    const nextBlock: ParagraphBlock = {
      blockId,
      label: '新段落',
      type: 'paragraph',
      eyebrow: `${String(blocks.length + 1).padStart(2, '0')} / 新内容`,
      text: '点击这里输入内容。这个块拥有稳定 ID，可独立审阅、评论和排序。',
    };
    commitBlocks([...blocks, nextBlock], blockId);
  };

  const addTable = () => {
    const blockId = `table-${blockCounter.current}`;
    blockCounter.current += 1;
    const nextBlock: TableBlock = {
      blockId,
      label: '新表格',
      type: 'table',
      columns: ['项目', '状态', '说明'],
      rows: [['待补充', '进行中', '点击单元格编辑']],
    };
    commitBlocks([...blocks, nextBlock], blockId);
  };

  const addImage = () => {
    const blockId = `image-${blockCounter.current}`;
    blockCounter.current += 1;
    const nextBlock: ImageBlock = {
      blockId,
      label: '新图片',
      type: 'image',
      caption: '新增图片块 · 后续接入素材上传与 Office 图片复用',
    };
    commitBlocks([...blocks, nextBlock], blockId);
  };

  const removeBlock = (blockId: string) => {
    if (blocks.length === 1) {
      setNotice('文档至少保留一个内容块');
      return;
    }
    const next = blocks.filter((block) => block.blockId !== blockId);
    commitBlocks(next, next[0]?.blockId);
  };

  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setFuture((items) => [cloneBlocks(blocks), ...items].slice(0, 20));
    setHistory((items) => items.slice(0, -1));
    setBlocks(cloneBlocks(previous));
    setSaveState('dirty');
  };

  const redo = () => {
    const next = future[0];
    if (!next) return;
    setHistory((items) => [...items.slice(-19), cloneBlocks(blocks)]);
    setFuture((items) => items.slice(1));
    setBlocks(cloneBlocks(next));
    setSaveState('dirty');
  };

  const saveVersion = () => {
    const nextVersion = version + 1;
    setVersion(nextVersion);
    setSaveState('saved');
    setNotice(`已创建不可变版本 V${nextVersion}`);
  };

  const handleDragStart = (event: DragEvent<HTMLButtonElement>, blockId: string) => {
    setDragSourceId(blockId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', blockId);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>, targetId: string) => {
    event.preventDefault();
    const sourceId = dragSourceId || event.dataTransfer.getData('text/plain');
    reorderBlock(sourceId, targetId);
    setDragSourceId('');
    setDragTargetId('');
  };

  const saveLabel = saveState === 'dirty'
    ? '未保存'
    : saveState === 'saving'
      ? '正在保存草稿…'
      : '草稿已保存';

  return (
    <section className="editor-demo-shell" aria-label="4.0 在线编辑器交互原型">
      <header className="editor-demo-intro">
        <div>
          <div className="editor-demo-kicker">
            <span>4.0 交互原型</span>
            <span className="editor-demo-data-note">演示数据，不会写入正式成果</span>
          </div>
          <h1>专业成果在线编辑器</h1>
          <p>在同一个工作台完成结构调整、内容编辑、事实核验、质量审阅和版本发布。</p>
        </div>
        <div className="editor-demo-lease" aria-label="编辑权状态">
          <span className="editor-demo-live-dot" />
          <div><strong>你正在编辑</strong><small>编辑权剩余 27 分钟</small></div>
        </div>
      </header>

      <div className="editor-demo-toolbar" aria-label="文档编辑工具栏">
        <div className="editor-demo-toolbar-group">
          <button aria-label="插入段落" type="button" onClick={addParagraph}>＋ 插入段落</button>
          <button aria-label="插入表格" type="button" onClick={addTable}>▦ 插入表格</button>
          <button aria-label="插入图片" type="button" onClick={addImage}>▧ 插入图片</button>
        </div>
        <div className="editor-demo-toolbar-group editor-demo-history-tools">
          <button aria-label="撤销" disabled={!history.length} onClick={undo} type="button">↶</button>
          <button aria-label="重做" disabled={!future.length} onClick={redo} type="button">↷</button>
        </div>
        <div className="editor-demo-save-tools">
          <span className={`editor-demo-save-state is-${saveState}`}><i />{saveLabel}</span>
          <span className="editor-demo-version">V{version}</span>
          <button className="is-secondary" onClick={() => setNotice('Demo 仅展示导出入口；正式版将复用现有 Office 导出能力')} type="button">导出 Word</button>
          <button className="is-primary" onClick={saveVersion} type="button">保存为新版本</button>
        </div>
      </div>

      <div className="editor-demo-workbench">
        <aside className="editor-demo-outline" aria-label="文档大纲">
          <div className="editor-demo-rail-heading">
            <span>文档结构</span><small>{blocks.length} 个内容块</small>
          </div>
          <ol>
            {blocks.map((block, index) => (
              <li key={block.blockId}>
                <button
                  className={selectedBlockId === block.blockId ? 'is-selected' : ''}
                  onClick={() => {
                    setSelectedBlockId(block.blockId);
                    document.getElementById(`demo-${block.blockId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }}
                  type="button"
                >
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <strong>{block.label}</strong>
                  <small>{blockKindLabel(block.type)}</small>
                </button>
              </li>
            ))}
          </ol>
          <div className="editor-demo-outline-tip">
            <strong>拖拽说明</strong>
            <p>抓住块左侧手柄调整顺序；也可使用上移、下移按钮完成无障碍排序。</p>
          </div>
        </aside>

        <main className="editor-demo-stage">
          <div className="editor-demo-paper" data-testid="editor-canvas">
            <div className="editor-demo-paper-heading">
              <span>聚信 AI 助手 · 专业成果</span>
              <small>AI 助手 4.0 自动流程评估报告</small>
              <h2>从生成答案到交付成果</h2>
              <p>编辑草稿 · 2026 年 7 月 16 日</p>
            </div>

            {blocks.map((block, index) => (
              <article
                className={`editor-demo-block ${selectedBlockId === block.blockId ? 'is-selected' : ''} ${dragSourceId === block.blockId ? 'is-dragging' : ''} ${dragTargetId === block.blockId ? 'is-drop-target' : ''}`}
                data-block-id={block.blockId}
                data-testid="editor-block"
                id={`demo-${block.blockId}`}
                key={block.blockId}
                onClick={() => setSelectedBlockId(block.blockId)}
              >
                <div
                  className="editor-demo-drop-surface"
                  data-testid={`editor-block-${block.blockId}`}
                  onDragEnter={() => setDragTargetId(block.blockId)}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragTargetId('');
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => handleDrop(event, block.blockId)}
                >
                  <div className="editor-demo-block-controls">
                    <button
                      aria-label={`拖动${block.label}`}
                      className="editor-demo-drag-handle"
                      draggable
                      onDragEnd={() => {
                        setDragSourceId('');
                        setDragTargetId('');
                      }}
                      onDragStart={(event) => handleDragStart(event, block.blockId)}
                      title="拖动调整顺序"
                      type="button"
                    >
                      ⠿
                    </button>
                    <span>{blockKindLabel(block.type)} · {block.blockId}</span>
                    <div>
                      <button aria-label={`上移${block.label}`} disabled={index === 0} onClick={() => moveBlock(block.blockId, -1)} type="button">↑</button>
                      <button aria-label={`下移${block.label}`} disabled={index === blocks.length - 1} onClick={() => moveBlock(block.blockId, 1)} type="button">↓</button>
                      <button aria-label={`删除${block.label}`} onClick={() => removeBlock(block.blockId)} type="button">×</button>
                    </div>
                  </div>

                  {block.type === 'paragraph' ? (
                    <div className="editor-demo-paragraph">
                      {block.eyebrow ? <span>{block.eyebrow}</span> : null}
                      <h3>{block.label}</h3>
                      <p
                        aria-label={`${block.label}正文`}
                        contentEditable
                        onInput={(event) => updateBlock(block.blockId, (current) => current.type === 'paragraph' ? {
                          ...current,
                          text: event.currentTarget.textContent || '',
                        } : current)}
                        suppressContentEditableWarning
                      >
                        {block.text}
                      </p>
                    </div>
                  ) : null}

                  {block.type === 'table' ? (
                    <div className="editor-demo-table-wrap">
                      <div className="editor-demo-section-label"><span>02 / 风险控制</span><h3>{block.label}</h3></div>
                      <table>
                        <thead><tr>{block.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
                        <tbody>
                          {block.rows.map((row, rowIndex) => (
                            <tr key={`${block.blockId}-${rowIndex}`}>
                              {row.map((cell, cellIndex) => (
                                <td
                                  aria-label={rowIndex === 0 && cellIndex === 0 ? '风险名称：数据口径' : `${block.label}第 ${rowIndex + 1} 行第 ${cellIndex + 1} 列`}
                                  contentEditable
                                  key={`${block.blockId}-${rowIndex}-${cellIndex}`}
                                  onInput={(event) => updateBlock(block.blockId, (current) => {
                                    if (current.type !== 'table') return current;
                                    const rows = current.rows.map((item) => [...item]);
                                    rows[rowIndex][cellIndex] = event.currentTarget.textContent || '';
                                    return { ...current, rows };
                                  })}
                                  suppressContentEditableWarning
                                >
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}

                  {block.type === 'image' ? (
                    <figure className="editor-demo-figure">
                      <svg aria-labelledby={`${block.blockId}-title`} role="img" viewBox="0 0 820 300">
                        <title id={`${block.blockId}-title`}>专业成果自动流程结构图</title>
                        <rect fill="#f2eee5" height="300" rx="18" width="820" />
                        <path d="M184 150H264M456 150H536" stroke="#9b9589" strokeDasharray="6 7" strokeWidth="2" />
                        <g><rect fill="#173f3a" height="116" rx="12" width="160" x="24" y="92" /><text fill="#f9f5eb" fontSize="17" fontWeight="700" x="104" y="139" textAnchor="middle">资料与 Skill</text><text fill="#cbdcd7" fontSize="13" x="104" y="167" textAnchor="middle">事实 · 模板 · 规则</text></g>
                        <g><rect fill="#fcfaf4" height="172" rx="12" stroke="#b56a48" strokeWidth="2" width="192" x="264" y="64" /><text fill="#1f2d2b" fontSize="17" fontWeight="700" x="360" y="111" textAnchor="middle">Agent Loop</text><text fill="#6b655c" fontSize="13" x="360" y="140" textAnchor="middle">规划 → 执行 → 验证</text><rect fill="#f0dfd3" height="34" rx="17" width="120" x="300" y="169" /><text fill="#8c422c" fontSize="12" fontWeight="700" x="360" y="191" textAnchor="middle">失败可恢复</text></g>
                        <g><rect fill="#214b63" height="116" rx="12" width="260" x="536" y="92" /><text fill="#f9f5eb" fontSize="17" fontWeight="700" x="666" y="132" textAnchor="middle">结构化专业成果</text><text fill="#d6e1e6" fontSize="13" x="666" y="160" textAnchor="middle">草稿 · 审阅 · 版本 · 导出</text><text fill="#d6e1e6" fontSize="13" x="666" y="184" textAnchor="middle">段落 / 表格 / 图片可拖拽</text></g>
                      </svg>
                      <figcaption
                        aria-label={`${block.label}图注`}
                        contentEditable
                        onInput={(event) => updateBlock(block.blockId, (current) => current.type === 'image' ? {
                          ...current,
                          caption: event.currentTarget.textContent || '',
                        } : current)}
                        suppressContentEditableWarning
                      >{block.caption}</figcaption>
                      <button onClick={() => setNotice('Demo 仅演示图片块；正式版将打开素材库或本地上传')} type="button">替换图片</button>
                    </figure>
                  ) : null}
                </div>
              </article>
            ))}

            <button className="editor-demo-add-at-end" onClick={addParagraph} type="button">＋ 在文末添加内容块</button>
          </div>
        </main>

        <aside className="editor-demo-review" aria-label="审核与追溯">
          <div className="editor-demo-tabs" role="tablist" aria-label="成果审核信息">
            {(Object.keys(tabLabels) as ReviewTab[]).map((tab) => (
              <button
                aria-label={tabLabels[tab]}
                aria-selected={activeTab === tab}
                className={activeTab === tab ? 'is-active' : ''}
                key={tab}
                onClick={() => setActiveTab(tab)}
                role="tab"
                type="button"
              >
                {tabLabels[tab]}
                {tab === 'review' ? <b>2</b> : null}
                {tab === 'comments' ? <b>1</b> : null}
              </button>
            ))}
          </div>

          <div className="editor-demo-review-panel" role="tabpanel">
            {activeTab === 'facts' ? (
              <>
                <div className="editor-demo-rail-heading"><span>事实锚点</span><small>3 条已绑定</small></div>
                <article className="editor-demo-evidence is-verified"><span>已核验</span><strong>4.0 首期采用单人编辑权</strong><p>来源：4.0 总体方案 / 编辑并发策略</p></article>
                <article className="editor-demo-evidence is-verified"><span>已核验</span><strong>Office 负责导入、导出和交付</strong><p>来源：现有 Office 能力边界</p></article>
                <article className="editor-demo-evidence is-warning"><span>待补充</span><strong>自动保存间隔需压测确认</strong><p>建议指标：P95 保存响应 ≤ 800ms</p></article>
              </>
            ) : null}

            {activeTab === 'review' ? (
              <>
                <div className="editor-demo-rail-heading"><span>质量审阅</span><small>阻断 1 · 提醒 1</small></div>
                <article className="editor-demo-finding is-blocking"><span>阻断发布</span><strong>关键数字缺少可追溯来源</strong><p>风险清单中的性能指标未绑定事实卡片。</p><button onClick={() => setActiveTab('facts')} type="button">去补充证据</button></article>
                <article className="editor-demo-finding"><span>建议修改</span><strong>结论段信息密度偏高</strong><p>建议拆成“判断”和“落地条件”两个内容块。</p></article>
              </>
            ) : null}

            {activeTab === 'comments' ? (
              <>
                <div className="editor-demo-rail-heading"><span>块级评论</span><small>1 条未解决</small></div>
                <article className="editor-demo-comment"><div><span>张磊</span><time>10:42</time></div><p>请补充本段结论的负责人。</p><small>定位：下一步 · next-actions</small><button onClick={() => setNotice('评论已标记为已解决（Demo 状态）')} type="button">标记解决</button></article>
                <div className="editor-demo-comment-box"><label htmlFor="demo-comment">添加评论</label><textarea id="demo-comment" placeholder="评论将绑定当前选中的内容块" rows={3} /><button onClick={() => setNotice('评论已保存到 Demo 状态，不会发送通知')} type="button">发送评论</button></div>
              </>
            ) : null}

            {activeTab === 'versions' ? (
              <>
                <div className="editor-demo-rail-heading"><span>版本记录</span><small>不可变快照</small></div>
                <ol className="editor-demo-timeline">
                  <li className="is-current"><span>V{version}</span><div><strong>当前版本</strong><small>刚刚 · 张磊</small></div></li>
                  <li><span>V2</span><div><strong>完成质量审阅</strong><small>今天 09:32 · AI 助手</small></div></li>
                  <li><span>V1</span><div><strong>自动流程初稿</strong><small>昨天 18:10 · AI 助手</small></div></li>
                </ol>
              </>
            ) : null}
          </div>

          <div className="editor-demo-office-boundary">
            <span>Office 复用边界</span>
            <p>导入模板 → 在线结构化编辑 → 导出 Word / PDF</p>
            <small>Office 不作为编辑器内核，避免双模型冲突。</small>
          </div>
        </aside>
      </div>

      {notice ? <div aria-live="polite" className="editor-demo-notice" role="status">{notice}</div> : null}
    </section>
  );
}
