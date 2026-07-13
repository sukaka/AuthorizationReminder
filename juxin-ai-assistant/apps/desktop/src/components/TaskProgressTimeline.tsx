type TaskStageItem = Record<string, unknown> & {
  stage?: string;
  label?: string;
  next_action?: string;
};

type TaskProgressTimelineProps = {
  stage?: string;
  label?: string;
  nextAction?: string;
  stageHistory?: TaskStageItem[];
  selectedSources?: Array<Record<string, unknown>>;
  toolCalls?: Array<Record<string, unknown>>;
  onRetry?: () => void;
  onSaveToMyMaterials?: () => void;
  onSubmitCompanyReview?: () => void;
};

const stageLabels: Record<string, string> = {
  analyzing: '正在识别任务',
  building_context: '正在整理依据',
  checking_sources: '正在整理来源',
  retrieving: '正在查资料',
  composing: '正在整理内容',
  generating: '正在生成回答',
  quality_check: '正在复核结果',
  completed: '生成完成',
  failed: '生成遇到问题',
  stopped: '已停止生成',
};

const toolLabels: Record<string, string> = {
  web_search: '联网查找',
  deep_web_research: '深度调研',
  web_capture: '网页采集',
  search_knowledge_base: '公司知识查询',
  search_personal_references: '我的资料查询',
  search_current_attachments: '当前附件查询',
  company_knowledge_search: '公司知识查询',
  personal_reference_search: '我的资料查询',
  current_attachment_search: '当前附件查询',
  word_export: 'Word 导出',
};

function stageLabel(item: TaskStageItem): string {
  const rawStage = String(item.stage || '');
  return item.label || stageLabels[rawStage] || item.next_action || '正在处理';
}

function toolLabel(value: unknown): string {
  const raw = String(value || '');
  return toolLabels[raw] || '任务处理';
}

function toolFailed(tool: Record<string, unknown>): boolean {
  const status = String(tool.status || '').toLowerCase();
  return status === 'failed' || status === 'error';
}

function collapseConsecutiveStages(stageHistory: TaskStageItem[]): TaskStageItem[] {
  return stageHistory.reduce<TaskStageItem[]>((items, item) => {
    const previous = items[items.length - 1];
    if (previous && previous.stage === item.stage) {
      items[items.length - 1] = item;
    } else {
      items.push(item);
    }
    return items;
  }, []);
}

export function TaskProgressTimeline({
  stage = '',
  label = '',
  nextAction = '',
  stageHistory = [],
  selectedSources = [],
  toolCalls = [],
  onRetry,
  onSaveToMyMaterials,
  onSubmitCompanyReview,
}: TaskProgressTimelineProps) {
  const normalizedStages = stageHistory.length
    ? collapseConsecutiveStages(stageHistory)
    : stage
      ? [{ stage, label, next_action: nextAction }]
      : [];
  const failedTools = toolCalls.filter(toolFailed);
  const isFailed = stage === 'failed' || failedTools.length > 0;
  const canPersistSources = selectedSources.length > 0 && (onSaveToMyMaterials || onSubmitCompanyReview);

  return (
    <section className="chat-task-progress" aria-label="任务进度" role="status">
      <div className="chat-task-progress__summary">
        <span>任务进度</span>
        <strong>{label || stageLabels[stage] || '正在处理'}</strong>
        {nextAction ? <p>{nextAction}</p> : null}
      </div>

      {normalizedStages.length ? (
        <ol aria-label="任务阶段">
          {normalizedStages.map((item, index) => {
            const itemStage = String(item.stage || '');
            return (
              <li
                className={[
                  itemStage === stage ? 'is-active' : '',
                  itemStage === 'failed' ? 'is-failed' : '',
                ].filter(Boolean).join(' ')}
                key={`${itemStage || item.label || 'stage'}-${index}`}
              >
                {stageLabel(item)}
              </li>
            );
          })}
        </ol>
      ) : null}

      {isFailed ? (
        <div className="chat-task-progress__recovery" aria-label="可恢复操作">
          {failedTools.slice(0, 2).map((tool, index) => (
            <span key={`${String(tool.tool_name || 'tool')}-${index}`}>
              {toolLabel(tool.tool_name)}未完成
            </span>
          ))}
          <button onClick={onRetry} type="button">可重试</button>
          <button type="button">继续普通回答</button>
        </div>
      ) : null}

      {canPersistSources ? (
        <div className="chat-task-progress__persist" aria-label="资料保存确认">
          {onSaveToMyMaterials ? (
            <button onClick={onSaveToMyMaterials} type="button">保存到我的资料</button>
          ) : null}
          {onSubmitCompanyReview ? (
            <button onClick={onSubmitCompanyReview} type="button">申请加入公司知识库</button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
