import { useEffect, useMemo, useState } from 'react';
import {
  buildPromptPayload,
  extractVariables,
  formatDateTime,
  roleLabels,
  statusLabels,
  tagsToInput,
} from './prompt-utils.js';

const API_BASE = '/api/prompt-center';
const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
let csrfToken = '';
let redirectingToPortal = false;

function getPortalBaseUrl() {
  const configured = String(import.meta.env.VITE_SSO_PORTAL_URL || '').trim();
  if (configured) return configured.replace(/\/+$/, '');
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:5180`;
}

function buildPortalUrl({ system = '', mode = '' } = {}) {
  const params = new URLSearchParams();
  if (system) params.set('system', system);
  if (mode) params.set('mode', mode);
  const query = params.toString();
  return `${getPortalBaseUrl()}/portal${query ? `?${query}` : ''}`;
}

function redirectToPortal(system = 'prompt-center') {
  if (redirectingToPortal) return;
  redirectingToPortal = true;
  window.location.replace(buildPortalUrl({ system }));
}

const emptyPromptForm = {
  title: '',
  summary: '',
  content: '',
  department_id: '',
  category_id: '',
  visibility: 'department',
  tags: '',
  change_note: '',
};
const emptyDepartmentForm = {
  id: '',
  name: '',
  description: '',
  manager_user_id: '',
  manager_name: '',
  sort_order: 0,
  is_active: true,
};
const emptyCategoryForm = { department_id: '', name: '', description: '', sort_order: 0, is_active: true };

async function fetchCsrfToken() {
  const resp = await fetch(`${API_BASE}/csrf`, { credentials: 'include' });
  const text = await resp.text();
  const data = text ? JSON.parse(text) : {};
  if (!resp.ok || !data.token) throw new Error(data.error || '安全校验初始化失败');
  csrfToken = String(data.token || '');
  return csrfToken;
}

async function ensureCsrfToken() {
  if (csrfToken) return csrfToken;
  return fetchCsrfToken();
}

async function api(path, options = {}) {
  const { csrfRetried = false, headers: optionHeaders = {}, ...fetchOptions } = options;
  const method = String(fetchOptions.method || 'GET').toUpperCase();
  const unsafe = !safeMethods.has(method);
  const headers = {
    'Content-Type': 'application/json',
    ...optionHeaders,
  };
  if (unsafe) headers['X-CSRF-Token'] = await ensureCsrfToken();

  const resp = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers,
    ...fetchOptions,
  });
  const text = await resp.text();
  const data = text ? JSON.parse(text) : {};
  if (!resp.ok) {
    if (resp.status === 401) {
      redirectToPortal('prompt-center');
      throw new Error('登录状态已失效');
    }
    if (unsafe && resp.status === 403 && !csrfRetried && /csrf/i.test(data.error || text)) {
      csrfToken = '';
      return api(path, { ...options, csrfRetried: true });
    }
    throw new Error(data.error || '请求失败');
  }
  return data;
}

export default function App() {
  const [activeTab, setActiveTab] = useState('library');
  const [me, setMe] = useState(null);
  const [permissions, setPermissions] = useState({});
  const [overview, setOverview] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [categories, setCategories] = useState([]);
  const [prompts, setPrompts] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [filters, setFilters] = useState({ keyword: '', department_id: '', category_id: '', status: '' });
  const [promptForm, setPromptForm] = useState(emptyPromptForm);
  const [departmentForm, setDepartmentForm] = useState(emptyDepartmentForm);
  const [categoryForm, setCategoryForm] = useState(emptyCategoryForm);
  const [selectedPrompt, setSelectedPrompt] = useState(null);
  const [versions, setVersions] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const selectedDepartmentCategories = useMemo(() => {
    const departmentId = Number(promptForm.department_id || filters.department_id || 0);
    if (!departmentId) return categories;
    return categories.filter((item) => Number(item.department_id) === departmentId);
  }, [categories, promptForm.department_id, filters.department_id]);

  const variableList = useMemo(() => extractVariables(promptForm.content), [promptForm.content]);
  const managedDepartmentIds = useMemo(
    () => (permissions.managed_department_ids || []).map((item) => Number(item)).filter(Boolean),
    [permissions.managed_department_ids]
  );
  const promptDepartmentId = Number(promptForm.department_id || 0);
  const canWriteSelectedDepartment = promptDepartmentId > 0 && managedDepartmentIds.includes(promptDepartmentId);
  const canEditPrompt = !!permissions.can_write && (!selectedPrompt || canWriteSelectedDepartment);
  const canSavePrompt = !!permissions.can_write && canWriteSelectedDepartment;

  const showMessage = (text) => {
    setMessage(text);
    setError('');
    window.clearTimeout(showMessage.timer);
    showMessage.timer = window.setTimeout(() => setMessage(''), 2600);
  };

  const showError = (err) => {
    setError(err?.message || '请求失败');
    setMessage('');
  };

  const loadAll = async () => {
    setLoading(true);
    try {
      const auth = await api('/auth/me');
      setMe(auth.user);
      setPermissions(auth.permissions || {});
      const [overviewData, departmentData, categoryData] = await Promise.all([
        api('/overview'),
        api('/departments'),
        api('/categories'),
      ]);
      setOverview(overviewData);
      setDepartments(departmentData);
      setCategories(categoryData);
      await loadPrompts(filters);
      if (auth.permissions?.can_read_audit) {
        setAuditLogs(await api('/audit/logs?limit=80'));
      }
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  const loadPrompts = async (nextFilters = filters) => {
    const query = new URLSearchParams();
    Object.entries(nextFilters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim()) query.set(key, String(value).trim());
    });
    setPrompts(await api(`/prompts?${query.toString()}`));
  };

  useEffect(() => {
    loadAll();
  }, []);

  const submitFilters = async (event) => {
    event.preventDefault();
    try {
      await loadPrompts(filters);
    } catch (err) {
      showError(err);
    }
  };

  const resetPromptForm = () => {
    setSelectedPrompt(null);
    setVersions([]);
    setPromptForm(emptyPromptForm);
  };

  const editPrompt = async (prompt) => {
    try {
      const detail = await api(`/prompts/${prompt.id}`);
      setSelectedPrompt(detail);
      setPromptForm({
        title: detail.title || '',
        summary: detail.summary || '',
        content: detail.content || '',
        department_id: String(detail.department_id || ''),
        category_id: String(detail.category_id || ''),
        visibility: detail.visibility || 'department',
        tags: tagsToInput(detail.tags || []),
        change_note: '',
      });
      if ((permissions.managed_department_ids || []).map(Number).includes(Number(detail.department_id))) {
        setVersions(await api(`/prompts/${detail.id}/versions`));
      } else {
        setVersions([]);
      }
      setActiveTab('library');
    } catch (err) {
      showError(err);
    }
  };

  const savePrompt = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = buildPromptPayload(promptForm);
      const saved = selectedPrompt
        ? await api(`/prompts/${selectedPrompt.id}`, { method: 'PUT', body: JSON.stringify(payload) })
        : await api('/prompts', { method: 'POST', body: JSON.stringify(payload) });
      showMessage(selectedPrompt ? '提示词已更新' : '提示词已创建');
      await Promise.all([loadPrompts(filters), loadAll()]);
      await editPrompt(saved);
    } catch (err) {
      showError(err);
    } finally {
      setSaving(false);
    }
  };

  const publishPrompt = async () => {
    if (!selectedPrompt) return;
    try {
      const saved = await api(`/prompts/${selectedPrompt.id}/publish`, { method: 'POST', body: '{}' });
      showMessage('提示词已发布');
      await loadPrompts(filters);
      await editPrompt(saved);
    } catch (err) {
      showError(err);
    }
  };

  const archivePrompt = async () => {
    if (!selectedPrompt) return;
    try {
      const saved = await api(`/prompts/${selectedPrompt.id}/archive`, { method: 'POST', body: '{}' });
      showMessage('提示词已归档');
      await loadPrompts(filters);
      await editPrompt(saved);
    } catch (err) {
      showError(err);
    }
  };

  const rollbackPrompt = async (versionId) => {
    if (!selectedPrompt) return;
    try {
      const saved = await api(`/prompts/${selectedPrompt.id}/rollback`, {
        method: 'POST',
        body: JSON.stringify({ version_id: versionId }),
      });
      showMessage('提示词已回滚');
      await loadPrompts(filters);
      await editPrompt(saved);
    } catch (err) {
      showError(err);
    }
  };

  const copyPrompt = async (prompt) => {
    try {
      const detail = prompt.content ? prompt : await api(`/prompts/${prompt.id}`);
      await navigator.clipboard.writeText(detail.content || '');
      await api(`/prompts/${detail.id}/usage`, { method: 'POST', body: '{}' });
      showMessage('内容已复制');
      await loadPrompts(filters);
    } catch (err) {
      showError(err);
    }
  };

  const saveDepartment = async (event) => {
    event.preventDefault();
    try {
      const departmentId = Number(departmentForm.id || 0);
      await api(departmentId ? `/departments/${departmentId}` : '/departments', {
        method: departmentId ? 'PUT' : 'POST',
        body: JSON.stringify(departmentForm),
      });
      setDepartmentForm(emptyDepartmentForm);
      showMessage(departmentId ? '部门已更新' : '部门已创建');
      await loadAll();
    } catch (err) {
      showError(err);
    }
  };

  const editDepartment = (department) => {
    setDepartmentForm({
      id: String(department.id || ''),
      name: department.name || '',
      description: department.description || '',
      manager_user_id: String(department.manager_user_id || ''),
      manager_name: department.manager_name || '',
      sort_order: Number(department.sort_order || 0),
      is_active: department.is_active !== 0,
    });
  };

  const saveCategory = async (event) => {
    event.preventDefault();
    try {
      await api('/categories', { method: 'POST', body: JSON.stringify(categoryForm) });
      setCategoryForm(emptyCategoryForm);
      showMessage('分类已创建');
      await loadAll();
    } catch (err) {
      showError(err);
    }
  };

  const goPortal = () => {
    window.location.href = buildPortalUrl({ system: 'prompt-center', mode: 'switch' });
  };

  const logout = () => {
    window.location.href = buildPortalUrl();
  };

  return (
    <div className="app-shell">
      <aside className="side-nav">
        <div>
          <span className="eyebrow">统一身份认证</span>
          <h1>提示词管理中心</h1>
        </div>
        <nav>
          <button className={activeTab === 'library' ? 'active' : ''} onClick={() => setActiveTab('library')}>提示词库</button>
          <button className={activeTab === 'taxonomy' ? 'active' : ''} onClick={() => setActiveTab('taxonomy')}>部门分类</button>
          {permissions.can_read_audit && (
            <button className={activeTab === 'audit' ? 'active' : ''} onClick={() => setActiveTab('audit')}>审计日志</button>
          )}
        </nav>
        <div className="side-footer">
          <button onClick={goPortal}>返回门户</button>
          <button onClick={logout}>退出登录</button>
        </div>
      </aside>

      <main className="main">
        <section className="top-band">
          <div>
            <div className="brand-row">
              <strong>聚信</strong>
              <h2>企业提示词管理中心</h2>
              <span>v5.11.5</span>
            </div>
            <p>按部门和分类沉淀提示词，保留版本、发布状态和审计记录。</p>
          </div>
          <div className="user-card">
            <span>{roleLabels[me?.role] || me?.role || '未登录'}</span>
            <strong>{me?.display_name || me?.username || '-'}</strong>
          </div>
        </section>

        {message && <div className="notice success">{message}</div>}
        {error && <div className="notice danger">{error}</div>}
        {loading && <div className="notice">正在检查登录状态...</div>}

        <section className="metric-grid">
          <article>
            <span>提示词总数</span>
            <strong>{overview?.counts?.total || 0}</strong>
          </article>
          <article>
            <span>已发布</span>
            <strong>{overview?.counts?.published || 0}</strong>
          </article>
          <article>
            <span>部门数量</span>
            <strong>{departments.length}</strong>
          </article>
          <article>
            <span>复制使用</span>
            <strong>{overview?.counts?.usage_count || 0}</strong>
          </article>
        </section>

        {activeTab === 'library' && (
          <section className="workspace-grid">
            <div className="list-panel">
              <form className="toolbar" onSubmit={submitFilters}>
                <input
                  value={filters.keyword}
                  onChange={(event) => setFilters({ ...filters, keyword: event.target.value })}
                  placeholder="搜索标题、摘要、内容"
                />
                <select
                  value={filters.department_id}
                  onChange={(event) => setFilters({ ...filters, department_id: event.target.value, category_id: '' })}
                >
                  <option value="">全部部门</option>
                  {departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <select
                  value={filters.category_id}
                  onChange={(event) => setFilters({ ...filters, category_id: event.target.value })}
                >
                  <option value="">全部分类</option>
                  {categories
                    .filter((item) => !filters.department_id || Number(item.department_id) === Number(filters.department_id))
                    .map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                {permissions.can_write && (
                  <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
                    <option value="">全部状态</option>
                    <option value="draft">草稿</option>
                    <option value="published">已发布</option>
                    <option value="archived">已归档</option>
                  </select>
                )}
                <button type="submit">查询</button>
              </form>

              <div className="prompt-list">
                {prompts.map((prompt) => (
                  <article
                    key={prompt.id}
                    className={selectedPrompt?.id === prompt.id ? 'prompt-row selected' : 'prompt-row'}
                    onClick={() => editPrompt(prompt)}
                  >
                    <div>
                      <strong>{prompt.title}</strong>
                      <p>{prompt.summary || '未填写摘要'}</p>
                      <div className="meta-line">
                        <span>{prompt.department_name}</span>
                        <span>{prompt.category_name}</span>
                        <span>创建人：{prompt.created_by_name || '-'}</span>
                        <span>{formatDateTime(prompt.updated_at)}</span>
                      </div>
                    </div>
                    <div className="row-side">
                      <span className={`status ${prompt.status}`}>{statusLabels[prompt.status] || prompt.status}</span>
                      <button type="button" onClick={(event) => { event.stopPropagation(); copyPrompt(prompt); }}>复制</button>
                    </div>
                  </article>
                ))}
                {prompts.length === 0 && <div className="empty">暂无匹配提示词</div>}
              </div>
            </div>

            <form className="editor-panel" onSubmit={savePrompt}>
              <div className="panel-head">
                <div>
                  <span className="eyebrow">{selectedPrompt ? `ID ${selectedPrompt.id}` : '新建'}</span>
                  <h3>{selectedPrompt ? '编辑提示词' : '创建提示词'}</h3>
                </div>
                {permissions.can_write && <button type="button" onClick={resetPromptForm}>新建</button>}
              </div>
              {selectedPrompt && (
                <div className="meta-line">
                  <span>创建人：{selectedPrompt.created_by_name || '-'}</span>
                  <span>最近更新：{selectedPrompt.updated_by_name || '-'}</span>
                </div>
              )}
              {promptDepartmentId > 0 && !canWriteSelectedDepartment && permissions.can_write && (
                <div className="notice">只有该部门负责人可以保存或回滚这个提示词。</div>
              )}
              <label>标题<input value={promptForm.title} disabled={!canEditPrompt} onChange={(event) => setPromptForm({ ...promptForm, title: event.target.value })} /></label>
              <label>摘要<input value={promptForm.summary} disabled={!canEditPrompt} onChange={(event) => setPromptForm({ ...promptForm, summary: event.target.value })} /></label>
              <div className="two-cols">
                <label>部门
                  <select value={promptForm.department_id} disabled={!permissions.can_write} onChange={(event) => setPromptForm({ ...promptForm, department_id: event.target.value, category_id: '' })}>
                    <option value="">请选择部门</option>
                    {departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
                <label>分类
                  <select value={promptForm.category_id} disabled={!canEditPrompt} onChange={(event) => setPromptForm({ ...promptForm, category_id: event.target.value })}>
                    <option value="">请选择分类</option>
                    {selectedDepartmentCategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
              </div>
              <label>标签<input value={promptForm.tags} disabled={!canEditPrompt} onChange={(event) => setPromptForm({ ...promptForm, tags: event.target.value })} /></label>
              <label>内容<textarea value={promptForm.content} disabled={!canEditPrompt} onChange={(event) => setPromptForm({ ...promptForm, content: event.target.value })} /></label>
              <div className="variable-box">
                <span>变量</span>
                {variableList.length ? variableList.map((item) => <mark key={item}>{item}</mark>) : <em>无</em>}
              </div>
              {permissions.can_write && (
                <>
                  <label>变更说明<input value={promptForm.change_note} disabled={!canEditPrompt} onChange={(event) => setPromptForm({ ...promptForm, change_note: event.target.value })} /></label>
                  <div className="actions">
                    <button disabled={saving || !canSavePrompt} type="submit">{saving ? '保存中' : '保存'}</button>
                    {selectedPrompt && permissions.can_publish && <button type="button" onClick={publishPrompt}>发布</button>}
                    {selectedPrompt && permissions.can_publish && <button type="button" className="ghost" onClick={archivePrompt}>归档</button>}
                  </div>
                </>
              )}
              {selectedPrompt && versions.length > 0 && (
                <div className="versions">
                  <h4>版本记录</h4>
                  {versions.map((item) => (
                    <div key={item.id} className="version-row">
                      <span>v{item.version_no}</span>
                      <strong>{item.change_note || item.title}</strong>
                      <small>{formatDateTime(item.created_at)}</small>
                      {canWriteSelectedDepartment && item.id !== selectedPrompt.current_version_id && (
                        <button type="button" onClick={() => rollbackPrompt(item.id)}>回滚</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </form>
          </section>
        )}

        {activeTab === 'taxonomy' && (
          <section className="taxonomy-grid">
            <div className="table-panel">
              <h3>部门</h3>
              {departments.map((item) => (
                <div className="table-row" key={item.id}>
                  <strong>{item.name}</strong>
                  <span>{item.description || '-'}</span>
                  <span>负责人：{item.manager_name || '未设置'}{item.manager_user_id ? `（ID ${item.manager_user_id}）` : ''}</span>
                  <em>{item.prompt_count} 条</em>
                  {permissions.can_manage_taxonomy && (
                    <button type="button" className="ghost" onClick={() => editDepartment(item)}>编辑</button>
                  )}
                </div>
              ))}
            </div>
            <div className="table-panel">
              <h3>分类</h3>
              {categories.map((item) => (
                <div className="table-row" key={item.id}>
                  <strong>{item.name}</strong>
                  <span>{item.department_name || '-'}</span>
                  <em>{item.prompt_count} 条</em>
                </div>
              ))}
            </div>
            {permissions.can_manage_taxonomy && (
              <div className="form-stack">
                <form className="compact-form" onSubmit={saveDepartment}>
                  <h3>{departmentForm.id ? '编辑部门' : '新增部门'}</h3>
                  <input placeholder="部门名称" value={departmentForm.name} onChange={(event) => setDepartmentForm({ ...departmentForm, name: event.target.value })} />
                  <input placeholder="部门说明" value={departmentForm.description} onChange={(event) => setDepartmentForm({ ...departmentForm, description: event.target.value })} />
                  <input placeholder="负责人用户ID" value={departmentForm.manager_user_id} onChange={(event) => setDepartmentForm({ ...departmentForm, manager_user_id: event.target.value })} />
                  <input placeholder="负责人姓名" value={departmentForm.manager_name} onChange={(event) => setDepartmentForm({ ...departmentForm, manager_name: event.target.value })} />
                  <button type="submit">{departmentForm.id ? '更新部门' : '保存部门'}</button>
                  {departmentForm.id && <button type="button" className="ghost" onClick={() => setDepartmentForm(emptyDepartmentForm)}>取消编辑</button>}
                </form>
                <form className="compact-form" onSubmit={saveCategory}>
                  <h3>新增分类</h3>
                  <select value={categoryForm.department_id} onChange={(event) => setCategoryForm({ ...categoryForm, department_id: event.target.value })}>
                    <option value="">请选择部门</option>
                    {departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                  <input placeholder="分类名称" value={categoryForm.name} onChange={(event) => setCategoryForm({ ...categoryForm, name: event.target.value })} />
                  <input placeholder="分类说明" value={categoryForm.description} onChange={(event) => setCategoryForm({ ...categoryForm, description: event.target.value })} />
                  <button type="submit">保存分类</button>
                </form>
              </div>
            )}
          </section>
        )}

        {activeTab === 'audit' && permissions.can_read_audit && (
          <section className="audit-panel">
            <h3>审计日志</h3>
            {auditLogs.map((item) => (
              <div className="audit-row" key={item.id}>
                <strong>{item.action}</strong>
                <span>{item.entity} #{item.entity_id || '-'}</span>
                <span>{item.actor_name || '-'}</span>
                <em>{formatDateTime(item.created_at)}</em>
              </div>
            ))}
            {auditLogs.length === 0 && <div className="empty">暂无审计记录</div>}
          </section>
        )}
      </main>
    </div>
  );
}
