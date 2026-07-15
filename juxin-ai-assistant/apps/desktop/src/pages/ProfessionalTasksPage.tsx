import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiError } from '../api/client';
import {
  createProfessionalDeliverable,
  cancelProfessionalRun,
  getProfessionalRunDetail,
  resumeProfessionalRun,
  startProfessionalRun,
  streamProfessionalRunEvents,
  submitProfessionalModelResult,
  supplyProfessionalRunInput,
  type DeliverableContent,
  type ProfessionalRun,
  type ProfessionalRunDetail,
  type ProfessionalRunProjection,
  type ProfessionalRunStage,
} from '../api/deliverables';
import { listProjectFiles, listProjects, type ProjectFilePayload, type ProjectPayload } from '../api/projects';
import {
  listProfessionalSkills,
  selectProfessionalSkill,
  type ProfessionalSkillSummary,
} from '../api/skills';
import { listProfessionalTemplates, type ProfessionalTemplateSummary } from '../api/templates';
import { cancelModelGeneration, generateLocalModel, listModelProfiles } from '../local/modelStream';
import type { ModelProfile } from '../types/tauri';

import './professional-delivery.css';

const deliverableType = 'security_ops_monthly_report';
const activeRunSessionKey = 'juxin-professional-active-run';

const stageDefinitions = [
  { key: 'scenario', label: '识别任务场景', summary: '等待识别任务场景' },
  { key: 'scope', label: '确定交付范围', summary: '等待确定交付范围' },
  { key: 'completeness', label: '检查输入完整性', summary: '等待检查必要输入' },
  { key: 'plan', label: '制定执行计划', summary: '等待制定执行计划' },
  { key: 'gather_facts', label: '收集材料并提取事实', summary: '等待收集材料并提取事实' },
  { key: 'confirm_facts', label: '确认关键事实', summary: '等待确认关键事实' },
  { key: 'draft', label: '生成专业草稿', summary: '等待模型生成专业草稿' },
  { key: 'review', label: '执行质量审查', summary: '等待执行质量审查' },
  { key: 'persist', label: '保存成果版本', summary: '等待保存成果版本' },
] as const;

const phaseStageKey: Record<string, string> = {
  select_skill: 'scenario',
  scenario: 'scenario',
  scope: 'scope',
  completeness: 'completeness',
  plan: 'plan',
  gather: 'gather_facts',
  extract_facts: 'gather_facts',
  facts: 'gather_facts',
  confirm_facts: 'confirm_facts',
  confirmation: 'confirm_facts',
  draft: 'draft',
  review: 'review',
  persist: 'persist',
  version: 'persist',
};

const recoveryFieldLabels: Record<string, string> = {
  period: '报告周期',
  objective: '交付目标',
};

const recoveryActionLabels: Record<Exclude<ProfessionalRunStage['recover_action'], null>, string> = {
  supply_input: '定位待补输入',
  resume: '恢复模型步骤',
  open_deliverable: '打开成果',
};

type ActiveRunSession = {
  runUuid: string;
  deliverableUuid: string;
  projectUuid: string;
  profileId: string;
  period: string;
};

type ProfessionalTasksPageProps = {
  onOpenDeliverable?: (deliverableUuid: string) => void;
};

function readableError(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : fallback;
  const payload = error.payload as { detail?: string | { message?: string } } | undefined;
  if (typeof payload?.detail === 'string' && payload.detail.trim()) return payload.detail;
  if (payload?.detail && typeof payload.detail === 'object' && payload.detail.message) {
    return payload.detail.message;
  }
  return fallback;
}

function canonicalSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalSerialize(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

async function canonicalHash(value: unknown): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('当前运行环境不支持内容完整性校验');
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(canonicalSerialize(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function parseModelContent(raw: string): DeliverableContent {
  const normalized = raw.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const parsed = JSON.parse(normalized) as Record<string, unknown>;
  const candidate = parsed.content && typeof parsed.content === 'object'
    ? parsed.content as Record<string, unknown>
    : parsed;
  const blocks = Array.isArray(candidate.blocks) ? candidate.blocks : [];
  if (!blocks.length) throw new Error('本地模型没有返回可保存的成果区块');
  return {
    ...candidate,
    schema_version: '1',
    blocks: blocks.map((item, index) => {
      const block = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      return {
        ...block,
        block_id: typeof block.block_id === 'string' && block.block_id.trim()
          ? block.block_id.trim()
          : `generated-block-${index + 1}`,
        type: typeof block.type === 'string' && block.type.trim() ? block.type.trim() : 'paragraph',
        ...(typeof block.text === 'string' ? { text: block.text } : {}),
      };
    }),
  };
}

function readActiveRunSession(): ActiveRunSession | null {
  try {
    const raw = window.sessionStorage.getItem(activeRunSessionKey);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ActiveRunSession>;
    if (!value.runUuid || !value.deliverableUuid) return null;
    return {
      runUuid: String(value.runUuid),
      deliverableUuid: String(value.deliverableUuid),
      projectUuid: String(value.projectUuid || ''),
      profileId: String(value.profileId || ''),
      period: String(value.period || ''),
    };
  } catch {
    return null;
  }
}

function rememberActiveRun(session: ActiveRunSession): void {
  try {
    window.sessionStorage.setItem(activeRunSessionKey, JSON.stringify(session));
  } catch {
    // Session recovery is best effort; the server remains the source of truth.
  }
}

function forgetActiveRun(): void {
  try {
    window.sessionStorage.removeItem(activeRunSessionKey);
  } catch {
    // Ignore unavailable browser storage.
  }
}

function runFromProjection(
  projection: ProfessionalRunProjection,
  current: ProfessionalRun | null,
): ProfessionalRun {
  const currentPending = current?.run_uuid === projection.run_uuid
    ? current.pending_model_request
    : null;
  const canKeepToken = projection.status === 'waiting_for_model'
    && Boolean(currentPending?.one_time_token)
    && currentPending?.request_hash === projection.pending_model_request?.request_hash;
  return {
    run_uuid: projection.run_uuid,
    deliverable_uuid: projection.deliverable_uuid,
    status: projection.status,
    phase: projection.phase,
    source_version_uuid: projection.source_version_uuid,
    skill_version_uuid: projection.skill_version_uuid,
    template_version_uuid: projection.template_version_uuid,
    context_hash: projection.context_hash,
    missing_fields: projection.missing_fields,
    pending_model_request: canKeepToken ? currentPending : projection.pending_model_request,
    created_version: current?.run_uuid === projection.run_uuid ? current.created_version : null,
    replayed: true,
  };
}

function fallbackStages(run: ProfessionalRun | null): ProfessionalRunStage[] {
  if (!run) {
    return stageDefinitions.map((stage) => ({
      ...stage,
      status: 'pending',
      duration_ms: 0,
      recover_action: null,
    }));
  }
  const currentKey = phaseStageKey[run.phase] ?? 'plan';
  const currentIndex = stageDefinitions.findIndex((stage) => stage.key === currentKey);
  return stageDefinitions.map((stage, index) => {
    let status: ProfessionalRunStage['status'] = 'pending';
    if (run.status === 'completed' || index < currentIndex) status = 'succeeded';
    if (index === currentIndex && run.status !== 'completed') {
      if (run.status === 'failed') status = 'failed';
      else if (run.status === 'cancelled') status = 'cancelled';
      else if (run.status === 'waiting_for_input' || run.status === 'waiting_for_model') status = 'waiting';
      else status = 'running';
    }
    const recoverAction = index === currentIndex
      ? run.status === 'waiting_for_input'
        ? 'supply_input'
        : run.status === 'waiting_for_model'
          ? 'resume'
          : null
      : run.status === 'completed' && stage.key === 'persist'
        ? 'open_deliverable'
        : null;
    return {
      ...stage,
      status,
      duration_ms: 0,
      recover_action: recoverAction,
    };
  });
}

function completeStageProjection(stages: ProfessionalRunStage[]): ProfessionalRunStage[] {
  const byKey = new Map(stages.map((stage) => [stage.key, stage]));
  return stageDefinitions.map((definition) => byKey.get(definition.key) ?? {
    ...definition,
    status: 'pending',
    duration_ms: 0,
    recover_action: null,
  });
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1) return '尚未执行';
  if (durationMs < 1000) return `${durationMs} 毫秒`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)} 秒`;
  return `${Math.floor(durationMs / 60_000)} 分 ${Math.round((durationMs % 60_000) / 1000)} 秒`;
}

function stageClassName(status: ProfessionalRunStage['status']): string {
  if (status === 'succeeded') return 'is-complete';
  if (status === 'running' || status === 'waiting') return 'is-current';
  if (status === 'failed') return 'is-failed';
  if (status === 'cancelled') return 'is-cancelled';
  return '';
}

export function ProfessionalTasksPage({ onOpenDeliverable }: ProfessionalTasksPageProps) {
  const [projects, setProjects] = useState<ProjectPayload[]>([]);
  const [projectUuid, setProjectUuid] = useState('');
  const [files, setFiles] = useState<ProjectFilePayload[]>([]);
  const [selectedFileUuids, setSelectedFileUuids] = useState<string[]>([]);
  const [skills, setSkills] = useState<ProfessionalSkillSummary[]>([]);
  const [templates, setTemplates] = useState<ProfessionalTemplateSummary[]>([]);
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [profileId, setProfileId] = useState('');
  const [period, setPeriod] = useState('');
  const [objective, setObjective] = useState('形成可审阅、可追溯、可导出的安全运营月报');
  const [projectSwitchNotice, setProjectSwitchNotice] = useState('');
  const [validationVisible, setValidationVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [run, setRun] = useState<ProfessionalRun | null>(null);
  const [runDetail, setRunDetail] = useState<ProfessionalRunDetail | null>(null);
  const [recoveryInputs, setRecoveryInputs] = useState<Record<string, string>>({});
  const [activeRequestId, setActiveRequestId] = useState('');
  const cancelRequestedRef = useRef(false);
  const recoveryInputRef = useRef<HTMLInputElement | null>(null);
  const eventCursorRef = useRef<Record<string, number>>({});

  const project = useMemo(
    () => projects.find((item) => item.project_uuid === projectUuid) ?? null,
    [projectUuid, projects],
  );
  const selectedSkill = skills[0] ?? null;
  const selectedTemplate = templates.find(
    (item) => item.current_version.version_uuid === selectedSkill?.current_version.default_template_version_uuid,
  ) ?? templates[0] ?? null;
  const missing = [
    ...(!period ? ['报告周期'] : []),
    ...(!selectedFileUuids.length ? ['至少一份项目资料'] : []),
  ];
  const professionalState = runDetail?.professional;
  const activeRunUuid = professionalState?.run_uuid ?? run?.run_uuid ?? '';
  const activeRunStatus = professionalState?.status ?? run?.status ?? null;
  const activeDeliverableUuid = professionalState?.deliverable_uuid ?? run?.deliverable_uuid ?? '';
  const activeRunTerminal = activeRunStatus === 'completed'
    || activeRunStatus === 'failed'
    || activeRunStatus === 'cancelled';
  const allowedActions = professionalState?.allowed_actions ?? [];
  const recoveryFields = professionalState?.missing_fields ?? run?.missing_fields ?? [];
  const stages = professionalState?.stages.length
    ? completeStageProjection(professionalState.stages)
    : fallbackStages(run);
  const hasActiveRun = Boolean(activeRunUuid && !activeRunTerminal);
  const canCancel = generating || (!activeRunTerminal && (
    allowedActions.includes('cancel') || Boolean(activeRunUuid)
  ));

  const applyRunDetail = useCallback((detail: ProfessionalRunDetail) => {
    setRunDetail(detail);
    if (!detail.professional) return;
    setRun((current) => runFromProjection(detail.professional!, current));
    setRecoveryInputs((current) => {
      const next = { ...current };
      detail.professional!.missing_fields.forEach((field) => {
        if (next[field] === undefined) next[field] = '';
      });
      return next;
    });
  }, []);

  const refreshRunDetail = useCallback(async (runUuid: string) => {
    const detail = await getProfessionalRunDetail(runUuid);
    applyRunDetail(detail);
    return detail;
  }, [applyRunDetail]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([listProjects(), listModelProfiles().catch(() => [])])
      .then(async ([nextProjects, nextProfiles]) => {
        if (!active) return;
        const saved = readActiveRunSession();
        setProjects(nextProjects);
        setProfiles(nextProfiles);
        const savedProfileId = saved?.profileId && nextProfiles.some((item) => item.id === saved.profileId)
          ? saved.profileId
          : '';
        setProfileId(savedProfileId
          || nextProfiles.find((item) => item.isDefault)?.id
          || nextProfiles[0]?.id
          || '');
        if (saved?.period) {
          setPeriod(saved.period);
          setRecoveryInputs((current) => ({ ...current, period: saved.period }));
        }
        if (nextProjects.length) {
          const savedProjectUuid = saved?.projectUuid
            && nextProjects.some((item) => item.project_uuid === saved.projectUuid)
            ? saved.projectUuid
            : '';
          setProjectUuid((current) => current || savedProjectUuid || nextProjects[0].project_uuid);
        }
        if (saved?.runUuid) {
          try {
            const detail = await getProfessionalRunDetail(saved.runUuid);
            if (active) applyRunDetail(detail);
          } catch (nextError: unknown) {
            if (!active) return;
            if (nextError instanceof ApiError && nextError.status === 404) {
              forgetActiveRun();
            } else {
              setError(readableError(nextError, '专业任务恢复失败'));
            }
          }
        }
      })
      .catch((nextError: unknown) => {
        if (active) setError(readableError(nextError, '专业任务初始化失败'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applyRunDetail]);

  useEffect(() => {
    if (!activeRunUuid || activeRunTerminal) return undefined;
    const controller = new AbortController();
    const knownSequence = (runDetail?.events ?? [])
      .filter((event) => event.run_id === activeRunUuid)
      .reduce((maximum, event) => Math.max(maximum, event.sequence), 0);
    const after = Math.max(eventCursorRef.current[activeRunUuid] ?? 0, knownSequence);
    void streamProfessionalRunEvents(activeRunUuid, {
      after,
      signal: controller.signal,
      maxReconnects: 3,
      onEvent: async (event) => {
        eventCursorRef.current[activeRunUuid] = Math.max(
          eventCursorRef.current[activeRunUuid] ?? 0,
          event.sequence,
        );
        await refreshRunDetail(activeRunUuid);
      },
    }).catch((nextError: unknown) => {
      if (!controller.signal.aborted) {
        setError(readableError(nextError, '执行轨迹连接已中断，可稍后刷新恢复'));
      }
    });
    return () => controller.abort();
  }, [activeRunTerminal, activeRunUuid, refreshRunDetail]);

  useEffect(() => {
    if (!projectUuid) return;
    let active = true;
    setError('');
    Promise.all([
      listProjectFiles(projectUuid),
      listProfessionalSkills({
        scopeType: 'project',
        deliverableType,
        projectUuid,
      }),
      listProfessionalTemplates({
        scopeType: 'project',
        deliverableType,
        projectUuid,
      }),
    ])
      .then(([nextFiles, skillList, templateList]) => {
        if (!active) return;
        setFiles(nextFiles.filter((item) => item.status === 'active'));
        setSkills(skillList.items);
        setTemplates(templateList.items);
      })
      .catch((nextError: unknown) => {
        if (active) setError(readableError(nextError, '项目专业能力加载失败'));
      });
    return () => {
      active = false;
    };
  }, [projectUuid]);

  const chooseProject = (nextProjectUuid: string) => {
    if (projectUuid && projectUuid !== nextProjectUuid) {
      setSelectedFileUuids([]);
      setProjectSwitchNotice('已切换项目，原项目的附件选择已清空。');
      setSuccess('');
    }
    setProjectUuid(nextProjectUuid);
  };

  const toggleFile = (fileUuid: string, checked: boolean) => {
    setSelectedFileUuids((current) => checked
      ? Array.from(new Set([...current, fileUuid]))
      : current.filter((item) => item !== fileUuid));
  };

  const invokePendingModel = async (
    currentRun: ProfessionalRun,
    profile: ModelProfile,
  ): Promise<ProfessionalRun> => {
    let nextRun = currentRun;
    let callCount = 0;
    while (nextRun.status === 'waiting_for_model' && nextRun.pending_model_request && callCount < 2) {
      if (cancelRequestedRef.current) throw new Error('任务已取消');
      const pending = nextRun.pending_model_request;
      if (!pending.one_time_token) throw new Error('服务端没有签发本次模型调用令牌');
      const requestId = `professional-${nextRun.run_uuid}-${pending.step_uuid}`;
      setActiveRequestId(requestId);
      const generated = await generateLocalModel({
        profileId: profile.id,
        temperature: profile.temperature,
        requestId,
        messages: [
          { role: 'system', content: pending.system_prompt },
          {
            role: 'user',
            content: [
              ...pending.instructions,
              '只返回符合输出结构的 JSON，不要使用 Markdown 代码围栏。',
              `输入：${JSON.stringify(pending.inputs)}`,
              `允许使用的项目上下文：${JSON.stringify(pending.context)}`,
              `输出结构：${JSON.stringify(pending.output_schema)}`,
            ].join('\n\n'),
          },
        ],
      }, () => undefined);
      const content = parseModelContent(generated.output);
      nextRun = await submitProfessionalModelResult(nextRun.run_uuid, pending.step_uuid, {
        one_time_token: pending.one_time_token,
        request_hash: pending.request_hash,
        content,
        content_hash: await canonicalHash(content),
        summary: `${typeof pending.inputs.period === 'string' && pending.inputs.period
          ? pending.inputs.period
          : period || '当前周期'} 安全运营月报专业稿`,
        model_metadata: {
          latency_ms: generated.latencyMs,
          model_profile_uuid: profile.id,
        },
      });
      setRun(nextRun);
      callCount += 1;
    }
    await refreshRunDetail(nextRun.run_uuid).catch(() => undefined);
    return nextRun;
  };

  const generateReport = async () => {
    setValidationVisible(true);
    setError('');
    setSuccess('');
    if (missing.length) return;
    if (!project || !selectedSkill || !selectedTemplate) {
      setError('当前项目没有可用的安全月报 Skill 或模板。');
      return;
    }
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) {
      setError('请先在“设置”中配置一个本地 OpenAI 兼容模型。');
      return;
    }

    setGenerating(true);
    cancelRequestedRef.current = false;
    setRunDetail(null);
    try {
      const selection = await selectProfessionalSkill({
        objective,
        deliverable_type: deliverableType,
        scope_type: 'project',
        project_uuid: project.project_uuid,
        input_fields: { period, selected_file_count: selectedFileUuids.length },
        explicit_skill_version_uuid: selectedSkill.current_version.version_uuid,
        user_confirmed: true,
      });
      const selectedVersion = selection.selected?.version_uuid ?? selectedSkill.current_version.version_uuid;
      const selectedTemplateVersion = selection.selected?.default_template_version_uuid
        ?? selectedTemplate.current_version.version_uuid;
      const initial = await createProfessionalDeliverable({
        title: `${period} 安全运营月报`,
        deliverable_type: deliverableType,
        scope_type: 'project',
        formality: 'formal',
        project_uuid: project.project_uuid,
        skill_version_uuid: selectedVersion,
        template_version_uuid: selectedTemplateVersion,
        content: {
          schema_version: '1',
          blocks: [{
            block_id: 'generation-pending',
            type: 'paragraph',
            text: '专业月报生成中，待本地模型完成受控步骤。',
          }],
        },
        content_summary: `${period} 安全运营月报待生成`,
        creation_reason: 'professional_task',
      });
      let nextRun = await startProfessionalRun(initial.deliverable_uuid, {
        row_version: initial.row_version,
        source_version_uuid: initial.current_version.version_uuid,
        inputs: { period, objective },
        resource_refs: selectedFileUuids.map((resourceUuid) => ({
          resource_type: 'knowledge_file' as const,
          resource_uuid: resourceUuid,
        })),
        model_profile_uuid: profile.id,
        max_steps: 16,
        max_model_calls: 2,
      });
      setRun(nextRun);
      rememberActiveRun({
        runUuid: nextRun.run_uuid,
        deliverableUuid: initial.deliverable_uuid,
        projectUuid: project.project_uuid,
        profileId: profile.id,
        period,
      });
      nextRun = await invokePendingModel(nextRun, profile);
      if (nextRun.status !== 'completed') {
        throw new Error(nextRun.status === 'waiting_for_input'
          ? `仍需补充：${nextRun.missing_fields.join('、')}`
          : '专业任务尚未完成，请查看执行阶段。');
      }
      setSuccess('专业月报已生成并保存为不可变成果版本。');
      onOpenDeliverable?.(initial.deliverable_uuid);
    } catch (nextError: unknown) {
      if (!cancelRequestedRef.current) setError(readableError(nextError, '专业月报生成失败'));
    } finally {
      setActiveRequestId('');
      setGenerating(false);
    }
  };

  const resumeModelStep = async () => {
    if (!activeRunUuid) return;
    const pendingProfileId = professionalState?.pending_model_request?.model_profile_uuid ?? '';
    const profile = profiles.find((item) => item.id === pendingProfileId)
      ?? profiles.find((item) => item.id === profileId);
    if (!profile) {
      setError('无法恢复模型步骤：请先在“设置”中恢复原本地模型配置。');
      return;
    }
    setGenerating(true);
    setError('');
    setSuccess('');
    cancelRequestedRef.current = false;
    try {
      let nextRun = await resumeProfessionalRun(activeRunUuid);
      setRun(nextRun);
      nextRun = await invokePendingModel(nextRun, profile);
      if (nextRun.status === 'completed') {
        setSuccess('专业月报已恢复执行并保存为不可变成果版本。');
      } else if (nextRun.status === 'waiting_for_input') {
        setError(`仍需补充：${nextRun.missing_fields.join('、')}`);
      }
    } catch (nextError: unknown) {
      if (!cancelRequestedRef.current) {
        setError(readableError(nextError, '专业任务恢复执行失败'));
      }
    } finally {
      setActiveRequestId('');
      setGenerating(false);
    }
  };

  const submitRecoveryInputs = async () => {
    if (!activeRunUuid || !recoveryFields.length) return;
    const inputs = Object.fromEntries(recoveryFields.map((field) => [
      field,
      (recoveryInputs[field] ?? '').trim(),
    ]));
    const emptyField = recoveryFields.find((field) => !inputs[field]);
    if (emptyField) {
      setError(`请补充${recoveryFieldLabels[emptyField] ?? emptyField}。`);
      recoveryInputRef.current?.focus();
      return;
    }
    setGenerating(true);
    setError('');
    setSuccess('');
    cancelRequestedRef.current = false;
    try {
      if (typeof inputs.period === 'string') setPeriod(inputs.period);
      let nextRun = await supplyProfessionalRunInput(activeRunUuid, inputs);
      setRun(nextRun);
      if (nextRun.status === 'waiting_for_model') {
        const requestedProfileId = nextRun.pending_model_request?.model_profile_uuid ?? profileId;
        const profile = profiles.find((item) => item.id === requestedProfileId)
          ?? profiles.find((item) => item.id === profileId);
        if (profile) {
          nextRun = await invokePendingModel(nextRun, profile);
        } else {
          setError('输入已保存；请在“设置”中恢复原本地模型配置后继续。');
        }
      } else {
        await refreshRunDetail(activeRunUuid).catch(() => undefined);
      }
      if (nextRun.status === 'completed') {
        setSuccess('必要输入已补齐，专业月报已保存为不可变成果版本。');
      }
    } catch (nextError: unknown) {
      if (!cancelRequestedRef.current) {
        setError(readableError(nextError, '补充任务输入失败'));
      }
    } finally {
      setActiveRequestId('');
      setGenerating(false);
    }
  };

  const cancel = async () => {
    cancelRequestedRef.current = true;
    setError('');
    setSuccess('');
    try {
      if (activeRequestId) await cancelModelGeneration(activeRequestId).catch(() => undefined);
      if (activeRunUuid) {
        await cancelProfessionalRun(activeRunUuid);
        await refreshRunDetail(activeRunUuid);
      }
      setSuccess('任务已取消；已有材料与草稿已保留。');
    } catch (nextError: unknown) {
      setError(readableError(nextError, '停止任务失败'));
    } finally {
      setGenerating(false);
      setActiveRequestId('');
    }
  };

  const handleRecoveryAction = (action: ProfessionalRunStage['recover_action']) => {
    if (action === 'supply_input') {
      recoveryInputRef.current?.focus();
    } else if (action === 'resume') {
      void resumeModelStep();
    } else if (action === 'open_deliverable' && activeDeliverableUuid) {
      onOpenDeliverable?.(activeDeliverableUuid);
    }
  };

  return (
    <div className="professional-page professional-task-page">
      <header className="professional-hero">
        <div>
          <span className="professional-eyebrow">PROFESSIONAL DELIVERY · 3.0</span>
          <h1>专业任务</h1>
          <p>把项目资料约束在明确边界内，通过已发布 Skill 生成可审阅、可追溯的正式成果。</p>
        </div>
        <span className="professional-status-chip">安全运营月报</span>
      </header>

      {error ? <div className="professional-alert is-error" role="alert">{error}</div> : null}
      {success ? <div className="professional-alert is-success" role="status">{success}</div> : null}
      {projectSwitchNotice ? <div className="professional-alert" role="status">{projectSwitchNotice}</div> : null}

      <div className="professional-task-grid">
        <section className="professional-panel professional-task-form" aria-labelledby="task-config-title">
          <div className="professional-section-heading">
            <div>
              <span>01 · 范围与输入</span>
              <h2 id="task-config-title">配置月报任务</h2>
            </div>
            <span>{loading ? '载入中' : '项目级隔离'}</span>
          </div>

          <label className="professional-field">
            <span>所属项目</span>
            <select value={projectUuid} onChange={(event) => chooseProject(event.target.value)}>
              <option value="">请选择项目</option>
              {projects.map((item) => <option key={item.project_uuid} value={item.project_uuid}>{item.name}</option>)}
            </select>
          </label>

          {project ? (
            <div className="professional-context-summary">
              <strong>{project.name}</strong>
              <span>{project.description || '暂无项目说明'}</span>
              <small>本次运行仅允许读取当前项目已授权资料，切换项目会自动清空选择。</small>
            </div>
          ) : null}

          <div className="professional-field-row">
            <label className="professional-field">
              <span>报告周期</span>
              <input aria-label="报告周期" onChange={(event) => setPeriod(event.target.value)} type="month" value={period} />
            </label>
            <label className="professional-field">
              <span>本地模型</span>
              <select aria-label="本地模型" onChange={(event) => setProfileId(event.target.value)} value={profileId}>
                <option value="">请选择模型</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.displayName} · {profile.modelId}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="professional-field">
            <span>交付目标</span>
            <textarea onChange={(event) => setObjective(event.target.value)} rows={3} value={objective} />
          </label>

          <fieldset className="professional-resource-list">
            <legend>项目资料</legend>
            {files.length ? files.map((file) => (
              <label key={file.file_uuid}>
                <input
                  checked={selectedFileUuids.includes(file.file_uuid)}
                  onChange={(event) => toggleFile(file.file_uuid, event.target.checked)}
                  type="checkbox"
                />
                <span>
                  <strong>{file.file_name}</strong>
                  <small>{file.summary || file.category || file.file_type}</small>
                </span>
              </label>
            )) : <p className="professional-empty">当前项目暂无可用资料。</p>}
          </fieldset>
        </section>

        <aside className="professional-task-rail">
          <section className="professional-panel">
            <div className="professional-section-heading compact">
              <div>
                <span>02 · 能力绑定</span>
                <h2>推荐 Skill</h2>
              </div>
            </div>
            {selectedSkill ? (
              <div className="professional-skill-card">
                <div>
                  <strong>{selectedSkill.name}</strong>
                  <span>V{selectedSkill.current_version.version}</span>
                </div>
                <p>{selectedSkill.description}</p>
                <small>推荐原因：与当前交付类型和项目范围匹配</small>
              </div>
            ) : <p className="professional-empty">当前范围没有已发布的 Skill。</p>}
            {selectedTemplate ? (
              <dl className="professional-meta-list">
                <div><dt>模板</dt><dd>{selectedTemplate.name}</dd></div>
                <div><dt>模板版本</dt><dd>V{selectedTemplate.current_version.version}</dd></div>
                <div><dt>输出</dt><dd>正式 Word 成果</dd></div>
              </dl>
            ) : null}
          </section>

          <section className="professional-panel">
            <div className="professional-section-heading compact">
              <div>
                <span>03 · 运行门禁</span>
                <h2>资料完整性</h2>
              </div>
              <span className={missing.length ? 'is-warning' : 'is-ready'}>{missing.length ? '待补充' : '可执行'}</span>
            </div>
            <ul className="professional-check-list">
              <li className={period ? 'is-complete' : ''}>报告周期</li>
              <li className={selectedFileUuids.length ? 'is-complete' : ''}>项目事实资料</li>
              <li className={selectedSkill && selectedTemplate ? 'is-complete' : ''}>已发布 Skill 与模板</li>
              <li className={profileId ? 'is-complete' : ''}>BYOM 本地模型</li>
            </ul>
            {validationVisible && missing.map((item) => (
              <p className="professional-validation" key={item}>缺少：{item}</p>
            ))}
            {!profiles.length ? <p className="professional-hint">尚未配置本地模型，可在“设置”中添加 OpenAI 兼容配置。</p> : null}
            <div className="professional-run-actions">
              <button
                className="professional-primary-button"
                disabled={generating || hasActiveRun}
                onClick={() => void generateReport()}
                type="button"
              >
                {generating ? '正在处理…' : hasActiveRun ? '已有任务待处理' : '生成专业月报'}
              </button>
              {canCancel ? (
                <button className="professional-quiet-button" onClick={() => void cancel()} type="button">
                  停止任务
                </button>
              ) : null}
            </div>
          </section>
        </aside>
      </div>

      <section className="professional-panel professional-stage-panel" aria-label="执行阶段">
        <div className="professional-section-heading compact">
          <div>
            <span>受控执行轨迹</span>
            <h2>九阶段专业交付流程</h2>
          </div>
          <span>{activeRunStatus ? `${activeRunStatus} · ${professionalState?.phase ?? run?.phase ?? ''}` : '尚未开始'}</span>
        </div>
        {recoveryFields.length
          && (allowedActions.includes('supply_input') || activeRunStatus === 'waiting_for_input') ? (
            <div className="professional-recovery-panel">
              <div>
                <strong>补齐必要输入</strong>
                <span>任务已安全暂停，补齐后会从当前阶段继续，不会覆盖已有材料或草稿。</span>
              </div>
              <div className="professional-recovery-fields">
                {recoveryFields.map((field, index) => {
                  const label = recoveryFieldLabels[field] ?? field;
                  return (
                    <label className="professional-field" key={field}>
                      <span>{label}</span>
                      <input
                        aria-label={`恢复任务：${label}`}
                        onChange={(event) => setRecoveryInputs((current) => ({
                          ...current,
                          [field]: event.target.value,
                        }))}
                        ref={index === 0 ? recoveryInputRef : undefined}
                        type={field === 'period' ? 'month' : 'text'}
                        value={recoveryInputs[field] ?? ''}
                      />
                    </label>
                  );
                })}
                <button
                  className="professional-secondary-button"
                  disabled={generating}
                  onClick={() => void submitRecoveryInputs()}
                  type="button"
                >
                  补充并继续
                </button>
              </div>
            </div>
          ) : null}
        <ol className="professional-stage-list">
          {stages.map((stage, index) => (
            <li
              aria-current={stage.status === 'running' || stage.status === 'waiting' ? 'step' : undefined}
              className={stageClassName(stage.status)}
              key={stage.key}
            >
              <span>{String(index + 1).padStart(2, '0')}</span>
              <div className="professional-stage-copy">
                <div>
                  <strong>{stage.label}</strong>
                  <small>{formatDuration(stage.duration_ms)}</small>
                </div>
                <p>{stage.summary}</p>
                {stage.recover_action ? (
                  <button
                    className="professional-stage-action"
                    disabled={generating}
                    onClick={() => handleRecoveryAction(stage.recover_action)}
                    type="button"
                  >
                    {recoveryActionLabels[stage.recover_action]}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
