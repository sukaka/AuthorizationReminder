import { FormEvent, useEffect, useState } from 'react';

import {
  addProjectMember,
  confirmProjectContract,
  confirmProjectMemory,
  confirmProjectServiceScope,
  createProjectAsset,
  createProjectContract,
  createProjectExecutionRule,
  createProjectMemory,
  createProjectScopeVersion,
  createProjectServiceScope,
  createProjectServiceTarget,
  createProjectSystem,
  createProjectTargetGroup,
  getProjectInitialization,
  copyProjectArtifactToPersonal,
  linkProjectArtifact,
  linkProjectFile,
  listProjectArtifacts,
  listProjectAssets,
  listProjectContracts,
  listProjectExecutionRules,
  listProjectFiles,
  listProjectMembers,
  listProjectMemories,
  listProjectServiceScopes,
  listProjectServiceTargets,
  listProjectSystems,
  listProjectTargetGroups,
  moveProjectSession,
  removeProjectMember,
  updateProjectMember,
  type ProjectArtifactPayload,
  type ProjectAssetPayload,
  type ProjectContractPayload,
  type ProjectExecutionRulePayload,
  type ProjectFilePayload,
  type ProjectInitializationPayload,
  type ProjectMemberPayload,
  type ProjectMemoryPayload,
  type ProjectServiceScopePayload,
  type ProjectServiceTargetPayload,
  type ProjectSystemPayload,
  type ProjectTargetGroupPayload,
} from '../api/projects';
import { uploadKnowledgeFile } from '../api/chat';
import { ChatPage } from '../pages/ChatPage';

export type ProjectWorkspaceExtendedTab = 'chat' | 'initialization' | 'knowledge' | 'memory' | 'members';

type ProjectWorkspaceExtendedPanelProps = {
  activeTab: ProjectWorkspaceExtendedTab;
  projectUuid: string;
};

type InitializationData = {
  summary: ProjectInitializationPayload;
  contracts: ProjectContractPayload[];
  scopes: ProjectServiceScopePayload[];
  systems: ProjectSystemPayload[];
  assets: ProjectAssetPayload[];
  targetGroups: ProjectTargetGroupPayload[];
  targets: ProjectServiceTargetPayload[];
  rules: ProjectExecutionRulePayload[];
};

type KnowledgeData = {
  files: ProjectFilePayload[];
  artifacts: ProjectArtifactPayload[];
};

const roleOptions = [
  { value: 'project_admin', label: '项目管理员' },
  { value: 'member', label: '成员' },
  { value: 'reviewer', label: '审核人' },
  { value: 'read_only', label: '只读' },
  { value: 'external_customer', label: '外部客户' },
];

function roleLabel(value: string): string {
  return roleOptions.find((item) => item.value === value)?.label || value;
}

function resourceCount(data: InitializationData): string {
  return [
    `合同 ${data.contracts.length}`,
    `范围 ${data.scopes.length}`,
    `系统 ${data.systems.length}`,
    `资产 ${data.assets.length}`,
    `对象 ${data.targetGroups.length + data.targets.length}`,
    `规则 ${data.rules.length}`,
  ].join(' · ');
}

export function ProjectWorkspaceExtendedPanel({ activeTab, projectUuid }: ProjectWorkspaceExtendedPanelProps) {
  const [initialization, setInitialization] = useState<InitializationData | null>(null);
  const [knowledge, setKnowledge] = useState<KnowledgeData | null>(null);
  const [memories, setMemories] = useState<ProjectMemoryPayload[] | null>(null);
  const [members, setMembers] = useState<ProjectMemberPayload[] | null>(null);
  const [loadingTab, setLoadingTab] = useState(false);
  const [submitting, setSubmitting] = useState('');
  const [error, setError] = useState('');

  const [contractName, setContractName] = useState('');
  const [contractCustomer, setContractCustomer] = useState('');
  const [contractFile, setContractFile] = useState<File | null>(null);
  const [scopeName, setScopeName] = useState('');
  const [scopeContractUuid, setScopeContractUuid] = useState('');
  const [systemName, setSystemName] = useState('');
  const [assetName, setAssetName] = useState('');
  const [assetSystemUuid, setAssetSystemUuid] = useState('');
  const [targetGroupName, setTargetGroupName] = useState('');
  const [targetType, setTargetType] = useState('system');
  const [targetValue, setTargetValue] = useState('');
  const [targetScopeUuid, setTargetScopeUuid] = useState('');
  const [targetGroupUuid, setTargetGroupUuid] = useState('');
  const [ruleFrequency, setRuleFrequency] = useState('monthly');
  const [ruleDeliverableType, setRuleDeliverableType] = useState('报告');
  const [ruleScopeUuid, setRuleScopeUuid] = useState('');
  const [ruleTargetGroupUuid, setRuleTargetGroupUuid] = useState('');
  const [scopeVersionScopeUuid, setScopeVersionScopeUuid] = useState('');
  const [scopeVersionSummary, setScopeVersionSummary] = useState('');

  const [memoryType, setMemoryType] = useState('project_rule');
  const [memoryTitle, setMemoryTitle] = useState('');
  const [memoryContent, setMemoryContent] = useState('');
  const [fileUuid, setFileUuid] = useState('');
  const [artifactUuid, setArtifactUuid] = useState('');
  const [sessionUuid, setSessionUuid] = useState('');
  const [moveAttachments, setMoveAttachments] = useState(true);
  const [moveArtifacts, setMoveArtifacts] = useState(true);
  const [keepPersonalCopy, setKeepPersonalCopy] = useState(true);
  const [memberUserId, setMemberUserId] = useState('');
  const [memberRole, setMemberRole] = useState('member');

  useEffect(() => {
    if (activeTab === 'chat' || (activeTab === 'initialization' && initialization) || (activeTab === 'knowledge' && knowledge) || (activeTab === 'memory' && memories) || (activeTab === 'members' && members)) {
      return undefined;
    }
    let cancelled = false;
    setLoadingTab(true);
    setError('');

    const load = activeTab === 'initialization'
      ? Promise.all([
        getProjectInitialization(projectUuid),
        listProjectContracts(projectUuid),
        listProjectServiceScopes(projectUuid),
        listProjectSystems(projectUuid),
        listProjectAssets(projectUuid),
        listProjectTargetGroups(projectUuid),
        listProjectServiceTargets(projectUuid),
        listProjectExecutionRules(projectUuid),
      ]).then(([summary, contracts, scopes, systems, assets, targetGroups, targets, rules]) => {
        if (!cancelled) setInitialization({ summary, contracts, scopes, systems, assets, targetGroups, targets, rules });
      })
      : activeTab === 'knowledge'
        ? Promise.all([listProjectFiles(projectUuid), listProjectArtifacts(projectUuid)]).then(([files, artifacts]) => {
          if (!cancelled) setKnowledge({ files, artifacts });
        })
        : activeTab === 'memory'
          ? listProjectMemories(projectUuid).then((nextMemories) => {
            if (!cancelled) setMemories(nextMemories);
          })
          : listProjectMembers(projectUuid).then((nextMembers) => {
            if (!cancelled) setMembers(nextMembers);
          });

    load.catch(() => {
      if (!cancelled) setError('项目资源加载失败，请稍后重试。');
    }).finally(() => {
      if (!cancelled) setLoadingTab(false);
    });

    return () => {
      cancelled = true;
    };
  }, [activeTab, initialization, knowledge, members, memories, projectUuid]);

  const runMutation = async (key: string, action: () => Promise<void>, message: string) => {
    setSubmitting(key);
    setError('');
    try {
      await action();
    } catch {
      setError(message);
    } finally {
      setSubmitting('');
    }
  };

  const handleCreateContract = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!initialization || !contractName.trim()) return;
    await runMutation('contract', async () => {
      const uploaded = contractFile
        ? await uploadKnowledgeFile(contractFile, {
          usageType: 'official_knowledge',
          reviewStatus: 'draft',
          ragScope: 'project',
          permissionScope: 'project',
          category: '项目合同',
          documentType: '合同',
        })
        : null;
      const created = await createProjectContract(projectUuid, {
        name: contractName.trim(),
        customer_name: contractCustomer.trim(),
        source_file_uuid: uploaded?.file_uuid || null,
      });
      setInitialization((current) => current ? { ...current, contracts: [created, ...current.contracts] } : current);
      setContractName('');
      setContractCustomer('');
      setContractFile(null);
    }, '合同保存失败，请检查名称或文件后重试。');
  };

  const handleCreateScope = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!initialization || !scopeName.trim()) return;
    await runMutation('scope', async () => {
      const created = await createProjectServiceScope(projectUuid, {
        name: scopeName.trim(),
        contract_uuid: scopeContractUuid || null,
      });
      setInitialization((current) => current ? { ...current, scopes: [created, ...current.scopes] } : current);
      setScopeName('');
      setScopeContractUuid('');
    }, '服务范围保存失败，请稍后重试。');
  };

  const handleCreateScopeVersion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!initialization || !scopeVersionScopeUuid || !scopeVersionSummary.trim()) return;
    const scope = initialization.scopes.find((item) => item.scope_uuid === scopeVersionScopeUuid);
    if (!scope) return;
    await runMutation('scope-version', async () => {
      const created = await createProjectScopeVersion(projectUuid, scope.scope_uuid, {
        change_summary: scopeVersionSummary.trim(),
        snapshot_json: {
          name: scope.name,
          category: scope.category,
          description: scope.description,
          frequency: scope.frequency,
          deliverable: scope.deliverable,
          acceptance_criteria: scope.acceptance_criteria,
        },
      });
      setInitialization((current) => current ? {
        ...current,
        scopes: current.scopes.map((item) => item.scope_uuid === scope.scope_uuid ? { ...item, current_version: created.version } : item),
      } : current);
      setScopeVersionSummary('');
    }, '服务范围版本保存失败，请稍后重试。');
  };

  const handleCreateSystem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!initialization || !systemName.trim()) return;
    await runMutation('system', async () => {
      const created = await createProjectSystem(projectUuid, { name: systemName.trim() });
      setInitialization((current) => current ? { ...current, systems: [created, ...current.systems] } : current);
      setSystemName('');
    }, '业务系统保存失败，请稍后重试。');
  };

  const handleCreateAsset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!initialization || !assetName.trim()) return;
    await runMutation('asset', async () => {
      const created = await createProjectAsset(projectUuid, { name: assetName.trim(), business_system_uuid: assetSystemUuid || null });
      setInitialization((current) => current ? { ...current, assets: [created, ...current.assets] } : current);
      setAssetName('');
      setAssetSystemUuid('');
    }, '资产保存失败，请稍后重试。');
  };

  const handleCreateTargetGroup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!initialization || !targetGroupName.trim()) return;
    await runMutation('target-group', async () => {
      const created = await createProjectTargetGroup(projectUuid, { name: targetGroupName.trim() });
      setInitialization((current) => current ? { ...current, targetGroups: [created, ...current.targetGroups] } : current);
      setTargetGroupName('');
    }, '目标组保存失败，请稍后重试。');
  };

  const handleCreateTarget = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!initialization || !targetType.trim() || !targetValue.trim()) return;
    await runMutation('target', async () => {
      const created = await createProjectServiceTarget(projectUuid, {
        target_type: targetType.trim(),
        target_value: targetValue.trim(),
        scope_uuid: targetScopeUuid || null,
        target_group_uuid: targetGroupUuid || null,
      });
      setInitialization((current) => current ? { ...current, targets: [created, ...current.targets] } : current);
      setTargetValue('');
    }, '服务对象保存失败，请稍后重试。');
  };

  const handleCreateRule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!initialization) return;
    await runMutation('rule', async () => {
      const created = await createProjectExecutionRule(projectUuid, {
        frequency: ruleFrequency,
        deliverable_type: ruleDeliverableType.trim(),
        needs_approval: true,
        scope_uuid: ruleScopeUuid || null,
        target_group_uuid: ruleTargetGroupUuid || null,
      });
      setInitialization((current) => current ? { ...current, rules: [created, ...current.rules] } : current);
    }, '执行规则保存失败，请稍后重试。');
  };

  const handleCreateMemory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!memories || !memoryTitle.trim() || !memoryContent.trim()) return;
    await runMutation('memory', async () => {
      const created = await createProjectMemory(projectUuid, {
        memory_type: memoryType,
        title: memoryTitle.trim(),
        content: memoryContent.trim(),
        source: 'human',
      });
      setMemories((current) => current ? [created, ...current] : current);
      setMemoryTitle('');
      setMemoryContent('');
    }, '项目记忆保存失败，请稍后重试。');
  };

  const handleLinkFile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!knowledge || !fileUuid.trim()) return;
    await runMutation('file', async () => {
      const created = await linkProjectFile(projectUuid, fileUuid.trim());
      setKnowledge((current) => current ? { ...current, files: [created, ...current.files] } : current);
      setFileUuid('');
    }, '知识文件关联失败，请确认文件 UUID 和权限。');
  };

  const handleLinkArtifact = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!knowledge || !artifactUuid.trim()) return;
    await runMutation('artifact-link', async () => {
      const created = await linkProjectArtifact(projectUuid, artifactUuid.trim());
      setKnowledge((current) => current ? { ...current, artifacts: [created, ...current.artifacts] } : current);
      setArtifactUuid('');
    }, '成果关联失败，请确认成果 UUID 和权限。');
  };

  const handleCopyArtifact = async (artifact: ProjectArtifactPayload) => {
    await runMutation(`artifact-copy-${artifact.artifact_uuid}`, async () => {
      await copyProjectArtifactToPersonal(projectUuid, artifact.artifact_uuid, {
        sanitized_title: `${artifact.title}（个人副本）`,
        sanitized_content_summary: artifact.content_summary.trim() || '项目成果个人副本',
      });
    }, '成果复制失败，请稍后重试。');
  };

  const handleMoveSession = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sessionUuid.trim()) return;
    await runMutation('session-move', async () => {
      await moveProjectSession(projectUuid, sessionUuid.trim(), {
        move_attachments: moveAttachments,
        move_artifacts: moveArtifacts,
        keep_personal_copy: keepPersonalCopy,
      });
      setSessionUuid('');
    }, '会话迁移失败，请确认会话 UUID 和项目权限。');
  };

  const handleAddMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!members || !memberUserId.trim()) return;
    await runMutation('member-add', async () => {
      const created = await addProjectMember(projectUuid, { user_id: memberUserId.trim(), role: memberRole });
      setMembers((current) => current ? [...current, created] : current);
      setMemberUserId('');
    }, '成员添加失败，请检查用户 ID 或权限。');
  };

  const handleUpdateMember = async (member: ProjectMemberPayload, role: string) => {
    await runMutation(`member-${member.member_uuid}`, async () => {
      const updated = await updateProjectMember(projectUuid, member.member_uuid, role);
      setMembers((current) => current ? current.map((item) => item.member_uuid === updated.member_uuid ? updated : item) : current);
    }, '成员角色更新失败，请稍后重试。');
  };

  const handleRemoveMember = async (member: ProjectMemberPayload) => {
    await runMutation(`member-remove-${member.member_uuid}`, async () => {
      await removeProjectMember(projectUuid, member.member_uuid);
      setMembers((current) => current ? current.filter((item) => item.member_uuid !== member.member_uuid) : current);
    }, '成员移除失败，请稍后重试。');
  };

  const renderFormButton = (key: string, label: string) => (
    <button className="project-secondary-button" disabled={submitting === key} type="submit">
      {submitting === key ? '保存中…' : label}
    </button>
  );

  const renderInitialization = (data: InitializationData) => (
    <div className="project-extended-stack">
      <section className="project-extended-status-card">
        <div>
          <span className="project-card-kicker">INITIALIZATION STATUS</span>
          <h4>{data.summary.initialization_complete ? '初始化已完成' : '初始化尚未完成'}</h4>
          <p>{resourceCount(data)}</p>
        </div>
        <span className={`project-status ${data.summary.initialization_complete ? 'project-status-active' : 'project-status-in_review'}`}>
          {data.summary.initialization_complete ? '可执行' : '待确认'}
        </span>
      </section>

      <div className="project-extended-grid project-extended-grid-two">
        <section className="project-extended-card">
          <div className="project-extended-card-header"><div><span className="project-card-kicker">CONTRACT</span><h4>合同与服务范围</h4></div><span>{data.contracts.length + data.scopes.length}</span></div>
          <form aria-label="新增项目合同" className="project-extended-form" onSubmit={(event) => void handleCreateContract(event)}>
            <input aria-label="合同名称" onChange={(event) => setContractName(event.target.value)} placeholder="合同名称" value={contractName} />
            <input aria-label="客户名称" onChange={(event) => setContractCustomer(event.target.value)} placeholder="客户名称（可选）" value={contractCustomer} />
            <label className="project-file-input"><span>上传合同文件（可选）</span><input aria-label="合同文件" onChange={(event) => setContractFile(event.target.files?.[0] || null)} type="file" /></label>
            {renderFormButton('contract', '保存合同')}
          </form>
          <div className="project-inline-list">
            {data.contracts.map((item) => <div className="project-inline-row" key={item.contract_uuid}><div><strong>{item.name}</strong><small>{item.customer_name || '未填写客户'}{item.source_file_uuid ? ' · 已关联文件' : ''}</small></div>{item.confirmed_at ? <span className="project-status project-status-active">已确认</span> : <button aria-label={`确认合同 ${item.name}`} className="project-secondary-button" disabled={submitting === `contract-confirm-${item.contract_uuid}`} onClick={() => void runMutation(`contract-confirm-${item.contract_uuid}`, async () => { const updated = await confirmProjectContract(projectUuid, item.contract_uuid); setInitialization((current) => current ? { ...current, contracts: current.contracts.map((contract) => contract.contract_uuid === updated.contract_uuid ? updated : contract) } : current); }, '合同确认失败，请稍后重试。')} type="button">确认</button>}</div>)}
            {!data.contracts.length ? <p className="project-empty-inline">还没有合同</p> : null}
          </div>
          <form aria-label="新增服务范围" className="project-extended-form project-extended-form-compact" onSubmit={(event) => void handleCreateScope(event)}>
            <input aria-label="服务范围名称" onChange={(event) => setScopeName(event.target.value)} placeholder="新增服务范围" value={scopeName} />
            <select aria-label="关联合同" onChange={(event) => setScopeContractUuid(event.target.value)} value={scopeContractUuid}><option value="">不关联合同</option>{data.contracts.map((item) => <option key={item.contract_uuid} value={item.contract_uuid}>{item.name}</option>)}</select>
            {renderFormButton('scope', '添加范围')}
          </form>
          <div className="project-inline-list">{data.scopes.map((item) => <div className="project-inline-row" key={item.scope_uuid}><div><strong>{item.name}</strong><small>{item.frequency || '频次待补充'} · v{item.current_version}</small></div>{item.confirmed_at ? <span className="project-status project-status-active">已确认</span> : <button aria-label={`确认服务范围 ${item.name}`} className="project-secondary-button" disabled={submitting === `scope-confirm-${item.scope_uuid}`} onClick={() => void runMutation(`scope-confirm-${item.scope_uuid}`, async () => { const updated = await confirmProjectServiceScope(projectUuid, item.scope_uuid); setInitialization((current) => current ? { ...current, scopes: current.scopes.map((scope) => scope.scope_uuid === updated.scope_uuid ? updated : scope) } : current); }, '服务范围确认失败，请稍后重试。')} type="button">确认</button>}</div>)}</div>
          <form aria-label="新增服务范围版本" className="project-extended-form project-extended-form-compact" onSubmit={(event) => void handleCreateScopeVersion(event)}><select aria-label="版本服务范围" onChange={(event) => setScopeVersionScopeUuid(event.target.value)} value={scopeVersionScopeUuid}><option value="">选择服务范围</option>{data.scopes.map((item) => <option key={item.scope_uuid} value={item.scope_uuid}>{item.name} · v{item.current_version}</option>)}</select><input aria-label="版本变更摘要" onChange={(event) => setScopeVersionSummary(event.target.value)} placeholder="版本变更摘要" value={scopeVersionSummary} />{renderFormButton('scope-version', '创建版本')}</form>
        </section>

        <section className="project-extended-card">
          <div className="project-extended-card-header"><div><span className="project-card-kicker">SYSTEMS & ASSETS</span><h4>业务系统与资产</h4></div><span>{data.systems.length + data.assets.length}</span></div>
          <form aria-label="新增业务系统" className="project-extended-form project-extended-form-compact" onSubmit={(event) => void handleCreateSystem(event)}><input aria-label="业务系统名称" onChange={(event) => setSystemName(event.target.value)} placeholder="新增业务系统" value={systemName} />{renderFormButton('system', '添加系统')}</form>
          <div className="project-inline-list">{data.systems.map((item) => <div className="project-inline-row" key={item.system_uuid}><div><strong>{item.name}</strong><small>{item.system_type || '系统类型待补充'} · {item.confirmation_status}</small></div><span className="project-status">{item.in_scope ? '范围内' : '范围外'}</span></div>)}{!data.systems.length ? <p className="project-empty-inline">还没有业务系统</p> : null}</div>
          <form aria-label="新增项目资产" className="project-extended-form project-extended-form-compact" onSubmit={(event) => void handleCreateAsset(event)}><input aria-label="资产名称" onChange={(event) => setAssetName(event.target.value)} placeholder="新增资产" value={assetName} /><select aria-label="资产所属系统" onChange={(event) => setAssetSystemUuid(event.target.value)} value={assetSystemUuid}><option value="">不关联系统</option>{data.systems.map((item) => <option key={item.system_uuid} value={item.system_uuid}>{item.name}</option>)}</select>{renderFormButton('asset', '添加资产')}</form>
          <div className="project-inline-list">{data.assets.map((item) => <div className="project-inline-row" key={item.asset_uuid}><div><strong>{item.name}</strong><small>{item.asset_type || '资产类型待补充'}{item.identifier ? ` · ${item.identifier}` : ''}</small></div><span className="project-status">{item.in_scope ? '范围内' : '范围外'}</span></div>)}{!data.assets.length ? <p className="project-empty-inline">还没有资产</p> : null}</div>
        </section>
      </div>

      <div className="project-extended-grid project-extended-grid-two">
        <section className="project-extended-card">
          <div className="project-extended-card-header"><div><span className="project-card-kicker">TARGET MAPPING</span><h4>服务对象映射</h4></div><span>{data.targetGroups.length + data.targets.length}</span></div>
          <form aria-label="新增服务对象组" className="project-extended-form project-extended-form-compact" onSubmit={(event) => void handleCreateTargetGroup(event)}><input aria-label="服务对象组名称" onChange={(event) => setTargetGroupName(event.target.value)} placeholder="新增服务对象组" value={targetGroupName} />{renderFormButton('target-group', '添加对象组')}</form>
          <div className="project-inline-list">{data.targetGroups.map((item) => <div className="project-inline-row" key={item.group_uuid}><div><strong>{item.name}</strong><small>{item.group_type}</small></div></div>)}</div>
          <form aria-label="新增服务对象" className="project-extended-form project-extended-form-compact" onSubmit={(event) => void handleCreateTarget(event)}><input aria-label="对象类型" onChange={(event) => setTargetType(event.target.value)} placeholder="对象类型" value={targetType} /><input aria-label="对象值" onChange={(event) => setTargetValue(event.target.value)} placeholder="对象值或范围" value={targetValue} /><select aria-label="对象服务范围" onChange={(event) => setTargetScopeUuid(event.target.value)} value={targetScopeUuid}><option value="">不关联范围</option>{data.scopes.map((item) => <option key={item.scope_uuid} value={item.scope_uuid}>{item.name}</option>)}</select><select aria-label="对象组" onChange={(event) => setTargetGroupUuid(event.target.value)} value={targetGroupUuid}><option value="">不关联对象组</option>{data.targetGroups.map((item) => <option key={item.group_uuid} value={item.group_uuid}>{item.name}</option>)}</select>{renderFormButton('target', '添加映射')}</form>
          <div className="project-inline-list">{data.targets.map((item) => <div className="project-inline-row" key={item.target_uuid}><div><strong>{item.target_type}</strong><small>{item.target_value}</small></div></div>)}{!data.targets.length ? <p className="project-empty-inline">还没有服务对象映射</p> : null}</div>
        </section>

        <section className="project-extended-card">
          <div className="project-extended-card-header"><div><span className="project-card-kicker">EXECUTION RULES</span><h4>执行规则</h4></div><span>{data.rules.length}</span></div>
          <form aria-label="新增执行规则" className="project-extended-form project-extended-form-compact" onSubmit={(event) => void handleCreateRule(event)}><select aria-label="执行频次" onChange={(event) => setRuleFrequency(event.target.value)} value={ruleFrequency}><option value="weekly">每周</option><option value="monthly">每月</option><option value="quarterly">每季度</option><option value="custom">自定义</option></select><input aria-label="交付物类型" onChange={(event) => setRuleDeliverableType(event.target.value)} placeholder="交付物类型" value={ruleDeliverableType} /><select aria-label="规则服务范围" onChange={(event) => setRuleScopeUuid(event.target.value)} value={ruleScopeUuid}><option value="">不关联范围</option>{data.scopes.map((item) => <option key={item.scope_uuid} value={item.scope_uuid}>{item.name}</option>)}</select><select aria-label="规则对象组" onChange={(event) => setRuleTargetGroupUuid(event.target.value)} value={ruleTargetGroupUuid}><option value="">不关联对象组</option>{data.targetGroups.map((item) => <option key={item.group_uuid} value={item.group_uuid}>{item.name}</option>)}</select>{renderFormButton('rule', '添加规则')}</form>
          <div className="project-inline-list">{data.rules.map((item) => <div className="project-inline-row" key={item.rule_uuid}><div><strong>{item.frequency || '未设置频次'}</strong><small>{item.deliverable_type || '交付物待补充'} · {item.needs_approval ? '需要审批' : '自动执行'}</small></div></div>)}{!data.rules.length ? <p className="project-empty-inline">还没有执行规则</p> : null}</div>
        </section>
      </div>
    </div>
  );

  const renderKnowledge = (data: KnowledgeData) => (
    <div className="project-extended-stack">
      <section className="project-extended-status-card"><div><span className="project-card-kicker">PROJECT KNOWLEDGE</span><h4>项目资料与成果</h4><p>把项目范围内的资料和已产出的成果集中到同一个可追溯上下文。</p></div><span className="project-status project-status-active">{data.files.length + data.artifacts.length} 项</span></section>
      <div className="project-extended-grid project-extended-grid-two">
        <section className="project-extended-card"><div className="project-extended-card-header"><div><span className="project-card-kicker">FILES</span><h4>项目知识文件</h4></div><span>{data.files.length}</span></div><form aria-label="关联项目知识文件" className="project-extended-form project-extended-form-compact" onSubmit={(event) => void handleLinkFile(event)}><input aria-label="知识文件 UUID" onChange={(event) => setFileUuid(event.target.value)} placeholder="粘贴知识文件 UUID" value={fileUuid} />{renderFormButton('file', '关联文件')}</form><div className="project-inline-list">{data.files.map((item) => <div className="project-inline-row" key={item.project_file_uuid}><div><strong>{item.file_name}</strong><small>{item.category} · {item.file_type}</small></div><span className="project-status project-status-active">已关联</span></div>)}{!data.files.length ? <p className="project-empty-inline">还没有项目知识文件。可在项目对话中上传后关联。</p> : null}</div></section>
        <section className="project-extended-card"><div className="project-extended-card-header"><div><span className="project-card-kicker">ARTIFACTS</span><h4>项目成果</h4></div><span>{data.artifacts.length}</span></div><form aria-label="关联项目成果" className="project-extended-form project-extended-form-compact" onSubmit={(event) => void handleLinkArtifact(event)}><input aria-label="成果 UUID" onChange={(event) => setArtifactUuid(event.target.value)} placeholder="粘贴成果 UUID" value={artifactUuid} />{renderFormButton('artifact-link', '关联成果')}</form><div className="project-inline-list">{data.artifacts.map((item) => <div className="project-inline-row project-inline-row-top" key={item.project_artifact_uuid}><div><strong>{item.title}</strong><small>{item.file_name || item.artifact_type} · {item.content_summary || '暂无摘要'}</small></div><div className="project-inline-actions"><span className="project-status project-status-active">项目内</span><button aria-label={`复制成果到个人 ${item.title}`} className="project-secondary-button" disabled={submitting === `artifact-copy-${item.artifact_uuid}`} onClick={() => void handleCopyArtifact(item)} type="button">复制到个人</button></div></div>)}{!data.artifacts.length ? <p className="project-empty-inline">项目交付物归属项目后会显示在这里。</p> : null}</div></section>
      </div>
      <section className="project-extended-card"><div className="project-extended-card-header"><div><span className="project-card-kicker">SESSION MIGRATION</span><h4>迁移个人会话</h4></div><span className="project-status">可选</span></div><p className="project-inline-help">将个人会话迁入当前项目；可保留个人副本，并同步会话中的附件和成果。</p><form aria-label="迁移个人会话" className="project-extended-form project-extended-form-compact" onSubmit={(event) => void handleMoveSession(event)}><input aria-label="个人会话 UUID" onChange={(event) => setSessionUuid(event.target.value)} placeholder="粘贴个人会话 UUID" value={sessionUuid} /><label className="project-check-option"><input checked={keepPersonalCopy} onChange={(event) => setKeepPersonalCopy(event.target.checked)} type="checkbox" />保留个人副本</label><label className="project-check-option"><input checked={moveAttachments} onChange={(event) => setMoveAttachments(event.target.checked)} type="checkbox" />迁移附件</label><label className="project-check-option"><input checked={moveArtifacts} onChange={(event) => setMoveArtifacts(event.target.checked)} type="checkbox" />迁移成果</label>{renderFormButton('session-move', '迁移会话')}</form></section>
    </div>
  );

  const renderMemory = (items: ProjectMemoryPayload[]) => (
    <div className="project-extended-stack">
      <section className="project-extended-status-card"><div><span className="project-card-kicker">PROJECT MEMORY</span><h4>项目记忆</h4><p>沉淀项目规则、客户偏好和长期有效的协作约定，后续项目对话可以持续复用。</p></div><span className="project-status project-status-active">{items.length} 条</span></section>
      <section className="project-extended-card"><form aria-label="新增项目记忆" className="project-extended-form project-memory-form" onSubmit={(event) => void handleCreateMemory(event)}><input aria-label="记忆标题" onChange={(event) => setMemoryTitle(event.target.value)} placeholder="记忆标题" value={memoryTitle} /><select aria-label="记忆类型" onChange={(event) => setMemoryType(event.target.value)} value={memoryType}><option value="project_rule">项目规则</option><option value="customer_preference">客户偏好</option><option value="delivery_decision">交付决策</option><option value="risk">风险提醒</option></select><textarea aria-label="记忆内容" onChange={(event) => setMemoryContent(event.target.value)} placeholder="记录一条后续仍然有效的项目事实或约定" value={memoryContent} />{renderFormButton('memory', '保存记忆')}</form><div className="project-inline-list">{items.map((item) => <div className="project-inline-row project-inline-row-top" key={item.memory_uuid}><div><strong>{item.title}</strong><small>{item.memory_type} · {item.content}</small></div>{item.confirmation_status === 'active' ? <span className="project-status project-status-active">已确认</span> : <button aria-label={`确认记忆 ${item.title}`} className="project-secondary-button" disabled={submitting === `memory-confirm-${item.memory_uuid}`} onClick={() => void runMutation(`memory-confirm-${item.memory_uuid}`, async () => { const updated = await confirmProjectMemory(projectUuid, item.memory_uuid); setMemories((current) => current ? current.map((memory) => memory.memory_uuid === updated.memory_uuid ? updated : memory) : current); }, '项目记忆确认失败，请稍后重试。')} type="button">确认</button>}</div>)}{!items.length ? <p className="project-empty-state">还没有项目记忆。把重要的项目约定先记下来。</p> : null}</div></section>
    </div>
  );

  const renderMembers = (items: ProjectMemberPayload[]) => (
    <div className="project-extended-stack">
      <section className="project-extended-status-card"><div><span className="project-card-kicker">MEMBERS & PERMISSIONS</span><h4>成员与权限</h4><p>按项目维护成员角色。项目负责人是不可移除的项目所有者。</p></div><span className="project-status project-status-active">{items.length} 人</span></section>
      <section className="project-extended-card"><form aria-label="添加项目成员" className="project-extended-form project-extended-form-compact" onSubmit={(event) => void handleAddMember(event)}><input aria-label="成员用户 ID" onChange={(event) => setMemberUserId(event.target.value)} placeholder="成员用户 ID" value={memberUserId} /><select aria-label="新成员角色" onChange={(event) => setMemberRole(event.target.value)} value={memberRole}>{roleOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>{renderFormButton('member-add', '添加成员')}</form><div className="project-member-table" role="table" aria-label="项目成员列表">{items.map((item) => { const owner = item.role === 'project_lead'; return <div className="project-member-row" key={item.member_uuid} role="row"><div><strong>{item.user_id}</strong><small>{owner ? '项目负责人 · 不可修改' : `加入于 ${new Date(item.created_at).toLocaleDateString('zh-CN')}`}</small></div><div className="project-member-actions">{owner ? <span className="project-status project-status-active">项目负责人</span> : <><select aria-label={`${item.user_id} 的角色`} disabled={submitting === `member-${item.member_uuid}`} onChange={(event) => void handleUpdateMember(item, event.target.value)} value={item.role}>{roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><button aria-label={`移除成员 ${item.user_id}`} className="project-secondary-button" disabled={submitting === `member-remove-${item.member_uuid}`} onClick={() => void handleRemoveMember(item)} type="button">移除</button></>}</div></div>; })}{!items.length ? <p className="project-empty-state">项目还没有其他成员。</p> : null}</div></section>
    </div>
  );

  if (activeTab === 'chat') {
    return <div className="project-chat-embed"><ChatPage key={projectUuid} initialProjectUuid={projectUuid} /></div>;
  }

  return (
    <div aria-busy={loadingTab} className="project-extended-panel">
      <header className="project-extended-header"><div><span className="project-card-kicker">PROJECT OPERATING SYSTEM</span><h3>{activeTab === 'initialization' ? '项目初始化' : activeTab === 'knowledge' ? '资料与知识' : activeTab === 'memory' ? '项目记忆' : '成员权限'}</h3><p>{activeTab === 'initialization' ? '把合同、服务范围、业务系统、资产、服务对象和执行规则整理成可执行的项目上下文。' : activeTab === 'knowledge' ? '管理项目资料和成果的归属，让项目知识可追溯、可复用。' : activeTab === 'memory' ? '沉淀跨会话仍然有效的项目事实和协作约定。' : '维护项目协作边界和成员角色。'}</p></div></header>
      {error ? <p aria-live="polite" className="project-extended-error">{error}</p> : null}
      {loadingTab ? <p className="project-loading-state">正在加载项目资源…</p> : null}
      {!loadingTab && activeTab === 'initialization' && initialization ? renderInitialization(initialization) : null}
      {!loadingTab && activeTab === 'knowledge' && knowledge ? renderKnowledge(knowledge) : null}
      {!loadingTab && activeTab === 'memory' && memories ? renderMemory(memories) : null}
      {!loadingTab && activeTab === 'members' && members ? renderMembers(members) : null}
    </div>
  );
}
