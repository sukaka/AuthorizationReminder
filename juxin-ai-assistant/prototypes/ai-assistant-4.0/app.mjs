import {
  addBlock,
  cloneBlocks,
  createInitialState,
  createVersion,
  moveBlock,
  removeBlock,
  reorderBlocks,
} from './model.mjs';

const state = createInitialState();
const history = [];
const future = [];
let blockSequence = 5;
let dragSourceId = '';
let dragTargetId = '';
let dragPosition = 'before';
let dragCancelled = false;
let dirtyTimer;
let savingTimer;
let toastTimer;

const blocksRoot = document.querySelector('[data-blocks]');
const outlineRoot = document.querySelector('[data-outline-list]');
const inspectorRoot = document.querySelector('[data-inspector-content]');
const saveStatus = document.querySelector('[data-save-status]');
const versionChip = document.querySelector('[data-version-chip]');
const toast = document.querySelector('[data-toast]');

const blockTypeLabels = {
  paragraph: '段落',
  table: '表格',
  image: '图片',
};

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function blockIndex(blockId) {
  return state.blocks.findIndex((block) => block.id === blockId);
}

function setSaveState(nextState) {
  state.saveState = nextState;
  saveStatus.className = `save-status is-${nextState}`;
  saveStatus.innerHTML = nextState === 'dirty'
    ? '<i></i>有未保存修改'
    : nextState === 'saving'
      ? '<i></i>正在保存到本机…'
      : '<i></i>本机草稿已保存';
}

function markDirty() {
  window.clearTimeout(dirtyTimer);
  window.clearTimeout(savingTimer);
  setSaveState('dirty');
  dirtyTimer = window.setTimeout(() => {
    setSaveState('saving');
    savingTimer = window.setTimeout(() => setSaveState('saved'), 360);
  }, 760);
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('is-visible');
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 3400);
}

function updateToolbarState() {
  document.querySelector('[data-action="undo"]').disabled = history.length === 0;
  document.querySelector('[data-action="redo"]').disabled = future.length === 0;
  versionChip.textContent = `V${state.version}`;
  document.querySelector('[data-block-count]').textContent = String(state.blocks.length);
}

function commitBlocks(nextBlocks, selectedId = state.selectedId) {
  history.push(cloneBlocks(state.blocks));
  if (history.length > 30) history.shift();
  future.length = 0;
  state.blocks = nextBlocks;
  state.selectedId = selectedId;
  markDirty();
  renderDocument();
}

function renderOutline() {
  outlineRoot.innerHTML = state.blocks.map((block, index) => `
    <li>
      <button class="${state.selectedId === block.id ? 'is-selected' : ''}" data-select-block="${escapeHtml(block.id)}" type="button">
        <span>${String(index + 1).padStart(2, '0')}</span>
        <div><strong>${escapeHtml(block.title)}</strong><small>${blockTypeLabels[block.type]} · ${escapeHtml(block.id)}</small></div>
      </button>
    </li>
  `).join('');
}

function paragraphMarkup(block) {
  return `
    <div class="paragraph-content">
      <div class="section-kicker"><span>${escapeHtml(block.orderLabel)} / ${escapeHtml(block.eyebrow)}</span><i></i></div>
      <h2 contenteditable="true" data-field="title" spellcheck="false">${escapeHtml(block.title)}</h2>
      <p contenteditable="true" data-field="body" spellcheck="false">${escapeHtml(block.body)}</p>
    </div>
  `;
}

function tableMarkup(block) {
  return `
    <div class="table-content">
      <div class="section-kicker"><span>${escapeHtml(block.orderLabel)} / ${escapeHtml(block.eyebrow)}</span><i></i></div>
      <h2 contenteditable="true" data-field="title" spellcheck="false">${escapeHtml(block.title)}</h2>
      <div class="table-scroll">
        <table>
          <thead><tr>${block.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}</tr></thead>
          <tbody>${block.rows.map((row, rowIndex) => `
            <tr>${row.map((cell, cellIndex) => `
              <td contenteditable="true" data-field="cell" data-row="${rowIndex}" data-cell="${cellIndex}" spellcheck="false">${escapeHtml(cell)}</td>
            `).join('')}</tr>
          `).join('')}</tbody>
        </table>
      </div>
    </div>
  `;
}

function imageMarkup(block) {
  return `
    <figure class="image-content">
      <div class="section-kicker"><span>${escapeHtml(block.orderLabel)} / ${escapeHtml(block.eyebrow)}</span><i></i></div>
      <h2 contenteditable="true" data-field="title" spellcheck="false">${escapeHtml(block.title)}</h2>
      <div class="architecture-diagram" role="img" aria-label="自动流程与人工审核边界示意图">
        <div class="diagram-lane is-input">
          <span>01 / INPUT</span>
          <strong>专业上下文</strong>
          <small>Skill · 资料 · 模板 · 规则</small>
        </div>
        <div class="diagram-arrow"><i></i><span>受控输入</span></div>
        <div class="diagram-lane is-agent">
          <span>02 / AGENT LOOP</span>
          <strong>规划 → 执行 → 验证</strong>
          <small>失败可恢复 · 每步可追踪</small>
        </div>
        <div class="diagram-arrow"><i></i><span>质量门禁</span></div>
        <div class="diagram-lane is-output">
          <span>03 / ARTIFACT</span>
          <strong>结构化专业成果</strong>
          <small>草稿 · 审核 · 版本 · 交付</small>
        </div>
        <div class="human-gate"><span>人工批准</span><strong>HUMAN GATE</strong></div>
      </div>
      <div class="figure-caption">
        <figcaption contenteditable="true" data-field="caption" spellcheck="false">${escapeHtml(block.caption)}</figcaption>
        <button data-action="replace-image" type="button">替换图片</button>
      </div>
    </figure>
  `;
}

function blockMarkup(block, index) {
  const content = block.type === 'table'
    ? tableMarkup(block)
    : block.type === 'image'
      ? imageMarkup(block)
      : paragraphMarkup(block);
  const dropClass = dragTargetId === block.id ? `is-drop-${dragPosition}` : '';

  return `
    <article
      class="content-block ${state.selectedId === block.id ? 'is-selected' : ''} ${dragSourceId === block.id ? 'is-dragging' : ''} ${dropClass}"
      data-block-id="${escapeHtml(block.id)}"
      data-testid="standalone-editor-block"
    >
      <div class="drop-line is-before"><span>放到这里</span></div>
      <div class="block-chrome" aria-label="${escapeHtml(block.title)}块工具栏">
        <button class="drag-handle" draggable="true" data-drag-handle="${escapeHtml(block.id)}" type="button" aria-label="拖动${escapeHtml(block.title)}" title="拖动调整位置">⠿</button>
        <span>${blockTypeLabels[block.type]} <i></i> ${escapeHtml(block.id)}</span>
        <div>
          <button data-move="-1" type="button" aria-label="上移${escapeHtml(block.title)}" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button data-move="1" type="button" aria-label="下移${escapeHtml(block.title)}" ${index === state.blocks.length - 1 ? 'disabled' : ''}>↓</button>
          <button data-remove-block="${escapeHtml(block.id)}" type="button" aria-label="删除${escapeHtml(block.title)}">×</button>
        </div>
      </div>
      ${content}
      <div class="drop-line is-after"><span>放到这里</span></div>
    </article>
  `;
}

function renderBlocks() {
  blocksRoot.innerHTML = state.blocks.map(blockMarkup).join('');
}

function evidencePanel() {
  return `
    <div class="inspector-section-title"><div><span>FACT ANCHORS</span><h3>事实锚点</h3></div><small>3 条已绑定</small></div>
    <article class="evidence-item is-verified">
      <div><span>已核验</span><time>方案 § 6.2</time></div>
      <strong>4.0 首期采用单人编辑权</strong>
      <p>草稿只允许一个有效编辑租约，避免静默覆盖。</p>
      <button data-select-block="delivery-plan" type="button">查看对应内容块 →</button>
    </article>
    <article class="evidence-item is-verified">
      <div><span>已核验</span><time>能力盘点</time></div>
      <strong>Office 负责导入、导出和交付</strong>
      <p>浏览器内的块编辑仍由聚信编辑器负责。</p>
      <button data-select-block="architecture-map" type="button">查看对应内容块 →</button>
    </article>
    <article class="evidence-item is-warning">
      <div><span>待补充</span><time>性能门槛</time></div>
      <strong>自动保存指标仍需压测</strong>
      <p>建议目标：保存响应 P95 不超过 800ms。</p>
      <button data-action="bind-evidence" type="button">绑定证据</button>
    </article>
    <div class="source-note"><span>来源策略</span><p>每个关键结论至少绑定一条可访问、可版本化的事实记录。</p></div>
  `;
}

function qualityPanel() {
  return `
    <div class="inspector-section-title"><div><span>QUALITY GATE</span><h3>质量审阅</h3></div><small>阻断 1 · 提醒 1</small></div>
    <article class="finding-item is-blocking">
      <div><span>阻断发布</span><small>风险表 · 第 3 行</small></div>
      <strong>Office 转换风险缺少验证证据</strong>
      <p>当前控制动作没有引用 golden fixtures 或转换报告。</p>
      <button data-select-block="risk-register" type="button">定位并处理</button>
    </article>
    <article class="finding-item">
      <div><span>建议优化</span><small>执行摘要</small></div>
      <strong>首段信息密度偏高</strong>
      <p>建议拆成“产品判断”和“落地条件”两个块。</p>
      <button data-select-block="executive-summary" type="button">定位内容块</button>
    </article>
    <div class="quality-score">
      <span>当前质量分</span><strong>86<small>/100</small></strong>
      <div><i style="width: 86%"></i></div>
      <p>解决阻断项后才可进入正式交付。</p>
    </div>
  `;
}

function commentsPanel() {
  return `
    <div class="inspector-section-title"><div><span>BLOCK COMMENTS</span><h3>块级评论</h3></div><small>1 条未解决</small></div>
    <article class="comment-item">
      <header><span class="avatar">张</span><div><strong>张磊</strong><time>今天 10:42</time></div></header>
      <p>请在落地顺序中明确第一阶段的负责人和验收时间。</p>
      <small>定位：落地顺序 · delivery-plan</small>
      <div><button data-select-block="delivery-plan" type="button">定位</button><button data-action="resolve-comment" type="button">标记解决</button></div>
    </article>
    <form class="comment-form" data-comment-form>
      <label for="new-comment">评论当前内容块</label>
      <textarea id="new-comment" rows="4" placeholder="输入明确、可执行的修改意见"></textarea>
      <div><span>将绑定：<b>${escapeHtml(state.selectedId)}</b></span><button type="submit">发送评论</button></div>
    </form>
  `;
}

function versionsPanel() {
  return `
    <div class="inspector-section-title"><div><span>IMMUTABLE HISTORY</span><h3>版本记录</h3></div><small>正式版本不可覆盖</small></div>
    <ol class="version-timeline">
      ${state.versions.map((item, index) => `
        <li class="${index === 0 ? 'is-current' : ''}">
          <span>V${item.version}</span>
          <div><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.time)} · ${escapeHtml(item.author)}</small></div>
          ${index === 0 ? '<i>当前</i>' : '<button data-action="compare-version" type="button">对比</button>'}
        </li>
      `).join('')}
    </ol>
    <div class="version-rule"><strong>草稿可变，版本不可变</strong><p>每次提交审核或正式交付都引用明确的版本号，避免交付内容在审核后被悄悄修改。</p></div>
  `;
}

function renderInspector() {
  inspectorRoot.innerHTML = state.activeInspector === 'quality'
    ? qualityPanel()
    : state.activeInspector === 'comments'
      ? commentsPanel()
      : state.activeInspector === 'versions'
        ? versionsPanel()
        : evidencePanel();
  document.querySelectorAll('[data-tab]').forEach((button) => {
    const active = button.dataset.tab === state.activeInspector;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });
}

function renderDocument() {
  renderOutline();
  renderBlocks();
  renderInspector();
  updateToolbarState();
}

function selectBlock(blockId, shouldScroll = true) {
  if (!state.blocks.some((block) => block.id === blockId)) return;
  state.selectedId = blockId;
  renderOutline();
  renderBlocks();
  if (state.activeInspector === 'comments') renderInspector();
  if (shouldScroll) {
    document.querySelector(`[data-block-id="${CSS.escape(blockId)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function reorderForDrop(sourceId, targetId, position) {
  if (!sourceId || !targetId || sourceId === targetId) return [...state.blocks];
  if (position === 'before') return reorderBlocks(state.blocks, sourceId, targetId);
  const source = state.blocks.find((block) => block.id === sourceId);
  if (!source) return [...state.blocks];
  const next = state.blocks.filter((block) => block.id !== sourceId);
  const targetIndex = next.findIndex((block) => block.id === targetId);
  if (targetIndex < 0) return [...state.blocks];
  next.splice(targetIndex + 1, 0, source);
  return next;
}

function commitDrop(sourceId, targetId, position) {
  const next = reorderForDrop(sourceId, targetId, position);
  dragSourceId = '';
  dragTargetId = '';
  commitBlocks(next, sourceId);
  showToast('内容块顺序已调整，可使用撤销恢复');
}

function undo() {
  const previous = history.pop();
  if (!previous) return;
  future.unshift(cloneBlocks(state.blocks));
  state.blocks = previous;
  if (!state.blocks.some((block) => block.id === state.selectedId)) state.selectedId = state.blocks[0].id;
  markDirty();
  renderDocument();
}

function redo() {
  const next = future.shift();
  if (!next) return;
  history.push(cloneBlocks(state.blocks));
  state.blocks = next;
  markDirty();
  renderDocument();
}

function saveVersion() {
  const snapshot = createVersion(state.blocks, state.version, '张磊');
  state.version = snapshot.version;
  state.versions.unshift({
    version: snapshot.version,
    label: '手动保存的评审版本',
    author: snapshot.author,
    time: '刚刚',
  });
  setSaveState('saved');
  state.activeInspector = 'versions';
  renderInspector();
  updateToolbarState();
  showToast(`已创建不可变版本 V${snapshot.version}，原版本仍可追溯`);
}

function updateEditable(target) {
  const article = target.closest('[data-block-id]');
  if (!article) return;
  const block = state.blocks.find((item) => item.id === article.dataset.blockId);
  if (!block) return;
  const value = target.textContent.trim();
  if (target.dataset.field === 'title') {
    block.title = value;
    renderOutline();
  }
  if (target.dataset.field === 'body' && block.type === 'paragraph') block.body = value;
  if (target.dataset.field === 'caption' && block.type === 'image') block.caption = value;
  if (target.dataset.field === 'cell' && block.type === 'table') {
    block.rows[Number(target.dataset.row)][Number(target.dataset.cell)] = value;
  }
  markDirty();
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('button, [data-block-id]');
  if (!target) return;

  if (target.dataset.selectBlock) {
    selectBlock(target.dataset.selectBlock);
    return;
  }

  if (target.dataset.addBlock) {
    const next = addBlock(state.blocks, target.dataset.addBlock, blockSequence);
    const newId = `${target.dataset.addBlock}-${blockSequence}`;
    blockSequence += 1;
    commitBlocks(next, newId);
    requestAnimationFrame(() => selectBlock(newId));
    showToast(`已插入${blockTypeLabels[target.dataset.addBlock]}块，可继续拖拽调整位置`);
    return;
  }

  if (target.dataset.removeBlock) {
    try {
      const next = removeBlock(state.blocks, target.dataset.removeBlock);
      commitBlocks(next, next[Math.min(blockIndex(target.dataset.removeBlock), next.length - 1)].id);
      showToast('内容块已删除，可使用撤销恢复');
    } catch (error) {
      showToast(error.message);
    }
    return;
  }

  if (target.dataset.move) {
    const article = target.closest('[data-block-id]');
    const direction = Number(target.dataset.move);
    commitBlocks(moveBlock(state.blocks, article.dataset.blockId, direction), article.dataset.blockId);
    return;
  }

  if (target.dataset.tab) {
    state.activeInspector = target.dataset.tab;
    renderInspector();
    return;
  }

  const action = target.dataset.action;
  if (action === 'undo') undo();
  if (action === 'redo') redo();
  if (action === 'save-version') saveVersion();
  if (action === 'open-office') showToast('正式版将复用现有 Office 模板、导入和导出；Office 不作为在线编辑内核');
  if (action === 'replace-image') showToast('正式版将在这里打开素材库或本地上传，并生成转换报告');
  if (action === 'bind-evidence') showToast('正式版将打开事实库，并把证据锚定到当前块与版本');
  if (action === 'lease-info') showToast('单活编辑权防止两个人同时覆盖草稿；超时后可安全接管并保留修订记录');
  if (action === 'resolve-comment') showToast('评论已在本地原型中标记为解决');
  if (action === 'compare-version') showToast('正式版将在这里展示块级版本差异');
  if (action === 'collapse-outline') document.body.classList.toggle('is-outline-collapsed');
  if (action === 'preview') {
    const active = document.body.classList.toggle('is-preview');
    target.textContent = active ? '退出预览' : '预览成果';
  }
  if (action === 'start-review') {
    state.activeInspector = 'quality';
    renderInspector();
    document.querySelectorAll('.workflow-track li').forEach((item, index) => {
      item.classList.toggle('is-complete', index < 3);
      item.classList.toggle('is-current', index === 3);
    });
    showToast('已进入质量审核演示：必须先处理阻断项，才能正式交付');
  }

  const blockArticle = target.closest('[data-block-id]');
  if (blockArticle && !target.matches('[contenteditable="true"]')) selectBlock(blockArticle.dataset.blockId, false);
});

document.addEventListener('input', (event) => {
  if (event.target.matches('[contenteditable="true"]')) updateEditable(event.target);
});

document.addEventListener('focusin', (event) => {
  if (!event.target.matches('[contenteditable="true"]') || event.target.dataset.historyCaptured) return;
  history.push(cloneBlocks(state.blocks));
  if (history.length > 30) history.shift();
  future.length = 0;
  event.target.dataset.historyCaptured = 'true';
  updateToolbarState();
});

document.addEventListener('focusout', (event) => {
  if (event.target.matches('[contenteditable="true"]')) delete event.target.dataset.historyCaptured;
});

document.addEventListener('submit', (event) => {
  if (!event.target.matches('[data-comment-form]')) return;
  event.preventDefault();
  const field = event.target.querySelector('textarea');
  if (!field.value.trim()) {
    showToast('请输入评论内容');
    field.focus();
    return;
  }
  showToast(`评论已绑定到 ${state.selectedId}（仅保存在本地原型状态）`);
  field.value = '';
});

document.addEventListener('dragstart', (event) => {
  const handle = event.target.closest('[data-drag-handle]');
  if (!handle) return;
  dragSourceId = handle.dataset.dragHandle;
  dragCancelled = false;
  state.selectedId = dragSourceId;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', dragSourceId);
  document.querySelectorAll('.content-block').forEach((block) => {
    block.classList.toggle('is-selected', block.dataset.blockId === dragSourceId);
    block.classList.toggle('is-dragging', block.dataset.blockId === dragSourceId);
  });
  renderOutline();
});

document.addEventListener('dragover', (event) => {
  const article = event.target.closest('[data-block-id]');
  if (!article || article.dataset.blockId === dragSourceId) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  const rect = article.getBoundingClientRect();
  dragTargetId = article.dataset.blockId;
  dragPosition = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  document.querySelectorAll('.content-block').forEach((block) => {
    block.classList.remove('is-drop-before', 'is-drop-after');
    if (block.dataset.blockId === dragTargetId) block.classList.add(`is-drop-${dragPosition}`);
  });
});

document.addEventListener('drop', (event) => {
  const article = event.target.closest('[data-block-id]');
  if (!article) return;
  event.preventDefault();
  const sourceId = dragSourceId || event.dataTransfer.getData('text/plain');
  commitDrop(sourceId, article.dataset.blockId, dragPosition);
});

document.addEventListener('dragend', () => {
  if (!dragCancelled && dragSourceId && dragTargetId) {
    commitDrop(dragSourceId, dragTargetId, dragPosition);
    return;
  }
  dragSourceId = '';
  dragTargetId = '';
  document.querySelectorAll('.content-block').forEach((block) => block.classList.remove('is-drop-before', 'is-drop-after', 'is-dragging'));
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && dragSourceId) dragCancelled = true;
});

renderDocument();
