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
  category_level1: '',
  category_level2: '',
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
const emptyCategoryForm = {
  department_id: '',
  parent_id: '',
  name: '',
  description: '',
  sort_order: 0,
  is_active: true,
};

function childCategories(categories, departmentId, parentId = null) {
  return categories.filter((item) => (
    Number(item.department_id) === Number(departmentId || 0)
    && Number(item.parent_id || 0) === Number(parentId || 0)
  ));
}

function findCategoryPath(categories, categoryId) {
  const byId = new Map(categories.map((item) => [Number(item.id), item]));
  const path = [];
  let current = byId.get(Number(categoryId || 0));
  while (current) {
    path.unshift(current);
    current = byId.get(Number(current.parent_id || 0));
  }
  return path;
}

function firstLeafCategory(categories, departmentId) {
  const walk = (parentId = null) => {
    const children = childCategories(categories, departmentId, parentId);
    if (!children.length) return null;
    for (const child of children) {
      const leaf = walk(child.id);
      if (leaf) return leaf;
    }
    return children[0];
  };
  return walk(null);
}

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
  const [libraryMode, setLibraryMode] = useState('list');
  const [me, setMe] = useState(null);
  const [permissions, setPermissions] = useState({});
  const [overview, setOverview] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [categories, setCategories] = useState([]);
  const [prompts, setPrompts] = useState([]);
  const [favoritePrompts, setFavoritePrompts] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [filters, setFilters] = useState({ keyword: '', department_id: '', category_id: '', status: '' });
  const [promptForm, setPromptForm] = useState(emptyPromptForm);
  const [departmentForm, setDepartmentForm] = useState(emptyDepartmentForm);
  const [categoryForm, setCategoryForm] = useState(emptyCategoryForm);
  const [selectedPrompt, setSelectedPrompt] = useState(null);
  const [browseDepartmentId, setBrowseDepartmentId] = useState('');
  const [browseCategoryId, setBrowseCategoryId] = useState('');
  const [versions, setVersions] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const formLevel1Categories = useMemo(
    () => childCategories(categories, promptForm.department_id, null),
    [categories, promptForm.department_id]
  );
  const formLevel2Categories = useMemo(
    () => childCategories(categories, promptForm.department_id, promptForm.category_level1),
    [categories, promptForm.department_id, promptForm.category_level1]
  );
  const formLevel3Categories = useMemo(
    () => childCategories(categories, promptForm.department_id, promptForm.category_level2),
    [categories, promptForm.department_id, promptForm.category_level2]
  );
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
      const initialDepartmentId = departmentData[0]?.id ? String(departmentData[0].id) : '';
      const initialCategory = initialDepartmentId ? firstLeafCategory(categoryData, initialDepartmentId) : null;
      const initialFilters = {
        ...filters,
        department_id: initialDepartmentId,
        category_id: initialCategory?.id ? String(initialCategory.id) : '',
      };
      setBrowseDepartmentId(initialDepartmentId);
      setBrowseCategoryId(initialFilters.category_id);
      setFilters(initialFilters);
      await loadPrompts(initialFilters);
      await loadFavorites();
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

  const loadFavorites = async () => {
    setFavoritePrompts(await api('/favorites'));
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
    setActiveTab('library');
    setLibraryMode('create');
  };

  const editPrompt = async (prompt) => {
    try {
      const detail = await api(`/prompts/${prompt.id}`);
      const categoryPath = findCategoryPath(categories, detail.category_id);
      setSelectedPrompt(detail);
      setPromptForm({
        title: detail.title || '',
        summary: detail.summary || '',
        content: detail.content || '',
        department_id: String(detail.department_id || ''),
        category_level1: String(categoryPath[0]?.id || ''),
        category_level2: String(categoryPath[1]?.id || ''),
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
      setLibraryMode('create');
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
      await Promise.all([loadPrompts(filters), loadFavorites(), loadAll()]);
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

  const deletePrompt = async (prompt) => {
    try {
      await api(`/prompts/${prompt.id}/archive`, { method: 'POST', body: '{}' });
      showMessage('提示词已删除');
      await Promise.all([loadPrompts(filters), loadFavorites()]);
      if (selectedPrompt?.id === prompt.id) resetPromptForm();
    } catch (err) {
      showError(err);
    }
  };

  const toggleFavorite = async (prompt) => {
    try {
      await api(`/prompts/${prompt.id}/favorite`, {
        method: prompt.is_favorite ? 'DELETE' : 'POST',
        body: '{}',
      });
      showMessage(prompt.is_favorite ? '已取消收藏' : '已收藏');
      await Promise.all([loadPrompts(filters), loadFavorites()]);
    } catch (err) {
      showError(err);
    }
  };

  const selectBrowseDepartment = (departmentId) => {
    setBrowseDepartmentId(String(departmentId || ''));
    setBrowseCategoryId('');
    setFilters((current) => ({
      ...current,
      department_id: departmentId ? String(departmentId) : '',
      category_id: '',
    }));
    setPrompts([]);
  };

  const selectBrowseCategory = async (categoryId) => {
    const nextFilters = {
      ...filters,
      department_id: browseDepartmentId,
      category_id: String(categoryId || ''),
    };
    setBrowseCategoryId(String(categoryId || ''));
    setFilters(nextFilters);
    await loadPrompts(nextFilters);
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

  const renderPromptRow = (prompt) => (
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
        <div className="row-actions">
          <button type="button" onClick={(event) => { event.stopPropagation(); editPrompt(prompt); }}>编辑</button>
          <button type="button" onClick={(event) => { event.stopPropagation(); deletePrompt(prompt); }}>删除</button>
          <button type="button" className={prompt.is_favorite ? 'favorite active' : 'favorite'} onClick={(event) => { event.stopPropagation(); toggleFavorite(prompt); }}>
            {prompt.is_favorite ? '已收藏' : '收藏'}
          </button>
          <button type="button" onClick={(event) => { event.stopPropagation(); copyPrompt(prompt); }}>复制</button>
        </div>
      </div>
    </article>
  );

  const renderPromptTableRow = (prompt) => (
    <tr key={prompt.id}>
      <td>
        <strong>{prompt.title}</strong>
        <p>{prompt.summary || '未填写摘要'}</p>
      </td>
      <td>{prompt.created_by_name || '-'}</td>
      <td>{formatDateTime(prompt.updated_at)}</td>
      <td><span className={`status ${prompt.status}`}>{statusLabels[prompt.status] || prompt.status}</span></td>
      <td>
        <div className="table-actions">
          <button type="button" onClick={() => editPrompt(prompt)}>编辑</button>
          <button type="button" onClick={() => deletePrompt(prompt)}>删除</button>
          <button type="button" className={prompt.is_favorite ? 'favorite active' : 'favorite'} onClick={() => toggleFavorite(prompt)}>
            {prompt.is_favorite ? '已收藏' : '收藏'}
          </button>
          <button type="button" onClick={() => copyPrompt(prompt)}>复制</button>
        </div>
      </td>
    </tr>
  );

  const renderFavoriteTableRow = (prompt) => (
    <tr key={prompt.id}>
      <td><strong>{prompt.title}</strong></td>
      <td>{prompt.category_name || '-'}</td>
      <td>{prompt.department_name || '-'}</td>
      <td>{formatDateTime(prompt.updated_at)}</td>
      <td>
        <button type="button" className="table-link" onClick={() => toggleFavorite(prompt)}>取消收藏</button>
      </td>
    </tr>
  );

  const renderCategoryTree = (parentId = null, depth = 1) => {
    const levelLabel = depth === 1 ? '一级分类' : depth === 2 ? '二级分类' : '三级分类';
    const items = childCategories(categories, browseDepartmentId, parentId);
    if (!items.length) return null;
    return (
      <div className={`category-level level-${depth}`}>
        <div className="category-level-title">{levelLabel}</div>
        {items.map((item) => (
          <div key={item.id} className="category-branch">
            <button
              type="button"
              className={Number(browseCategoryId) === Number(item.id) ? 'active' : ''}
              onClick={() => selectBrowseCategory(item.id)}
            >
              <span>{item.name}</span>
              <em>{item.prompt_count || 0} 条</em>
            </button>
            {renderCategoryTree(item.id, depth + 1)}
          </div>
        ))}
      </div>
    );
  };

  const renderPromptCategoryTree = (parentId = null, depth = 1) => {
    const items = childCategories(categories, browseDepartmentId, parentId);
    if (!items.length) return null;
    return (
      <ul className={depth === 1 ? 'prompt-tree-root' : 'prompt-tree-children'}>
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={Number(browseCategoryId) === Number(item.id) ? 'active' : ''}
              onClick={() => selectBrowseCategory(item.id)}
            >
              <span>{item.name}</span>
              {depth === 1 && <em>{item.prompt_count || 0} 条</em>}
            </button>
            {depth < 3 && renderPromptCategoryTree(item.id, depth + 1)}
          </li>
        ))}
      </ul>
    );
  };

  const browseDepartment = departments.find((item) => Number(item.id) === Number(browseDepartmentId || 0));
  const browseCategoryPath = findCategoryPath(categories, browseCategoryId);
  const promptListTitle = browseCategoryPath.length
    ? browseCategoryPath[browseCategoryPath.length - 1].name
    : browseDepartment
      ? '请选择分类'
      : '请选择部门';
  const promptListBreadcrumb = browseDepartment
    ? ['提示词列表', browseDepartment.name, ...browseCategoryPath.map((item) => item.name)].join(' / ')
    : '提示词列表 / 部门';
  const selectedCategoryName = browseCategoryPath[browseCategoryPath.length - 1]?.name || '';
  const departmentTone = ['blue', 'green', 'orange', 'purple'];
  const countDepartmentCategories = (departmentId) => categories.filter((item) => Number(item.department_id) === Number(departmentId)).length;

  return (
    <div className="app-shell">
      <aside className="side-nav">
        <div>
          <span className="eyebrow">统一身份认证</span>
          <h1>提示词管理中心</h1>
        </div>
        <nav>
          <div className="nav-group">
            <button className={activeTab === 'library' ? 'active' : ''} onClick={() => { setActiveTab('library'); setLibraryMode('list'); }}>提示词库</button>
            <div className="sub-nav">
              <button className={activeTab === 'library' && libraryMode === 'create' ? 'active' : ''} onClick={() => { setActiveTab('library'); setLibraryMode('create'); }}>提示词创建</button>
              <button className={activeTab === 'library' && libraryMode === 'list' ? 'active' : ''} onClick={() => { setActiveTab('library'); setLibraryMode('list'); }}>提示词列表</button>
            </div>
          </div>
          <button className={activeTab === 'favorites' ? 'active' : ''} onClick={() => { setActiveTab('favorites'); loadFavorites(); }}>我的收藏</button>
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
              <span>v5.16.1</span>
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

        {activeTab === 'library' && libraryMode === 'list' && (
          <section className="prompt-list-workspace">
            <div className="prompt-list-head">
              <div>
                <span className="eyebrow">提示词库</span>
                <h3>提示词列表</h3>
              </div>
              <div className="prompt-list-head-actions">
                <button type="button" className="ghost" onClick={() => loadAll()}>刷新</button>
                {permissions.can_write && <button type="button" onClick={resetPromptForm}>+ 创建提示词</button>}
              </div>
            </div>

            <div className="prompt-list-body">
              <div className="create-permission-notice prompt-list-notice">
                <span>i</span>
                <strong>先选择部门，再进入分类目录，最后查看该分类下的提示词。</strong>
              </div>
              <div className="prompt-list-layout">
                <aside className="list-department-panel">
                  <div className="list-panel-title">
                    <h3>提示词部门</h3>
                    <span>点击切换</span>
                  </div>
                  <div className="list-department-grid">
                  {departments.map((department, index) => (
                    <button
                      type="button"
                      key={department.id}
                      className={Number(browseDepartmentId) === Number(department.id) ? 'list-department-card active' : 'list-department-card'}
                      onClick={() => selectBrowseDepartment(department.id)}
                    >
                      <span className="department-card-top">
                        <span className={`department-mark ${departmentTone[index % departmentTone.length]}`}>{department.name.slice(0, 1)}</span>
                        <strong>{department.name}</strong>
                        <em>›</em>
                      </span>
                      <span>{department.description || '暂无说明'}</span>
                      <small>{department.prompt_count || 0} 条　{countDepartmentCategories(department.id)} 个分类</small>
                    </button>
                  ))}
                  </div>
                </aside>

                <div className="prompt-browser-stack">
                  <section className="prompt-table-panel">
                    <div className="prompt-browser-top">
                      <div className="breadcrumb">{promptListBreadcrumb}</div>
                      {permissions.can_write && <button type="button" onClick={resetPromptForm}>+ 创建提示词</button>}
                    </div>
                    <form className="prompt-list-filters" onSubmit={submitFilters}>
                      <input
                        value={filters.keyword}
                        placeholder={selectedCategoryName || '搜索标题、摘要或内容'}
                        onChange={(event) => setFilters({ ...filters, keyword: event.target.value })}
                      />
                      <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
                        <option value="">全部状态</option>
                        <option value="published">已发布</option>
                        <option value="draft">草稿</option>
                        <option value="archived">已归档</option>
                      </select>
                      <select defaultValue="updated_at">
                        <option value="updated_at">按更新时间</option>
                        <option value="created_at">按创建时间</option>
                      </select>
                      <button type="submit">筛选</button>
                    </form>
                    <div className="prompt-browser-grid">
                      <aside className="prompt-category-tree">
                        <h3>分类目录</h3>
                        {browseDepartment && <p>{browseDepartment.name}</p>}
                        {browseDepartment
                          ? renderPromptCategoryTree(null, 1) || <div className="empty">该部门暂无分类</div>
                          : <div className="empty">请先选择左侧部门</div>}
                      </aside>
                      <div className="prompt-table-wrap">
                        <div className="prompt-table-heading">
                          <div>
                            <h3>{promptListTitle}</h3>
                            <p>{browseCategoryId ? `提示词共 ${prompts.length} 条，当前展示最近更新的内容` : '点击左侧分类后展示该分类下的所有提示词'}</p>
                          </div>
                        </div>
                        {browseCategoryId && prompts.length > 0 ? (
                          <>
                            <table className="prompt-table">
                              <thead>
                                <tr>
                                  <th>标题</th>
                                  <th>创建人</th>
                                  <th>更新时间</th>
                                  <th>状态</th>
                                  <th>操作</th>
                                </tr>
                              </thead>
                              <tbody>{prompts.map((prompt) => renderPromptTableRow(prompt))}</tbody>
                            </table>
                            <div className="prompt-pager">
                              <span>共 {prompts.length} 条</span>
                              <span>‹</span>
                              <strong>1</strong>
                              <span>2</span>
                              <span>3</span>
                              <span>›</span>
                              <button type="button">10 条/页</button>
                            </div>
                          </>
                        ) : (
                          <div className="empty">{browseCategoryId ? '该分类下暂无提示词' : '请选择一个分类查看提示词'}</div>
                        )}
                      </div>
                    </div>
                  </section>

                  <section className="list-favorites-panel">
                    <div className="list-panel-title">
                      <h3>我的收藏</h3>
                      <span>当前用户：{me?.display_name || me?.username || '-'}</span>
                    </div>
                    {favoritePrompts.length > 0 ? (
                      <table className="prompt-table">
                        <thead>
                          <tr>
                            <th>标题</th>
                            <th>所属分类</th>
                            <th>所属部门</th>
                            <th>更新时间</th>
                            <th>操作</th>
                          </tr>
                        </thead>
                        <tbody>{favoritePrompts.map((prompt) => renderFavoriteTableRow(prompt))}</tbody>
                      </table>
                    ) : (
                      <div className="empty">暂无收藏提示词</div>
                    )}
                  </section>
                </div>
              </div>
            </div>
          </section>
        )}

        {activeTab === 'library' && libraryMode === 'create' && (
          <section className="create-workspace">
            <form className="editor-panel create-editor" onSubmit={savePrompt}>
              <div className="create-form-head">
                <div>
                  <span className="eyebrow">{selectedPrompt ? `ID ${selectedPrompt.id}` : '新建'}</span>
                  <h3>{selectedPrompt ? '编辑提示词' : '创建提示词'}</h3>
                </div>
                {permissions.can_write && <button type="button" onClick={resetPromptForm}>新建</button>}
              </div>
              <div className="create-permission-notice">
                <span>i</span>
                <strong>您拥有本部门提示词的创建与管理权限</strong>
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
              <div className="create-field">
                <label><span className="required">*</span>标题</label>
                <div className="counted-field">
                  <input value={promptForm.title} disabled={!canEditPrompt} placeholder="请输入提示词标题，建议简洁明确" maxLength={100} onChange={(event) => setPromptForm({ ...promptForm, title: event.target.value })} />
                  <span>{promptForm.title.length}/100</span>
                </div>
              </div>
              <div className="create-field">
                <label>摘要</label>
                <input value={promptForm.summary} disabled={!canEditPrompt} placeholder="请输入提示词摘要，便于列表快速识别用途" onChange={(event) => setPromptForm({ ...promptForm, summary: event.target.value })} />
              </div>
              <div className="create-field">
                <label><span className="required">*</span>部门</label>
                <div className="select-shell">
                  <select
                    value={promptForm.department_id}
                    disabled={!permissions.can_write}
                    onChange={(event) => setPromptForm({
                      ...promptForm,
                      department_id: event.target.value,
                      category_level1: '',
                      category_level2: '',
                      category_id: '',
                    })}
                  >
                    <option value="">请选择部门</option>
                    {departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="create-field">
                <label><span className="required">*</span>分类</label>
                <div className="category-select-grid">
                  <div>
                    <span>一级分类</span>
                    <div className="select-shell">
                      <select
                        value={promptForm.category_level1}
                        disabled={!canEditPrompt}
                        onChange={(event) => setPromptForm({ ...promptForm, category_level1: event.target.value, category_level2: '', category_id: '' })}
                      >
                        <option value="">请选择一级分类</option>
                        {formLevel1Categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <span>二级分类</span>
                    <div className="select-shell">
                      <select
                        value={promptForm.category_level2}
                        disabled={!canEditPrompt || !promptForm.category_level1}
                        onChange={(event) => setPromptForm({ ...promptForm, category_level2: event.target.value, category_id: '' })}
                      >
                        <option value="">请选择二级分类</option>
                        {formLevel2Categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <span>三级分类</span>
                    <div className="select-shell">
                      <select
                        value={promptForm.category_id}
                        disabled={!canEditPrompt || !promptForm.category_level2}
                        onChange={(event) => setPromptForm({ ...promptForm, category_id: event.target.value })}
                      >
                        <option value="">请选择三级分类</option>
                        {formLevel3Categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              </div>
              <div className="create-field">
                <label>标签</label>
                <input value={promptForm.tags} disabled={!canEditPrompt} placeholder="输入后按回车添加，可多选" onChange={(event) => setPromptForm({ ...promptForm, tags: event.target.value })} />
                <div className="tag-preview">
                  {tagsToInput(promptForm.tags).split(/[,，]/).map((item) => item.trim()).filter(Boolean).map((item) => (
                    <span key={item}>{item} ×</span>
                  ))}
                </div>
              </div>
              <div className="create-field">
                <label><span className="required">*</span>提示词内容</label>
                <div className="prompt-editor-shell">
                  <div className="prompt-toolbar" aria-hidden="true">
                    <span>↶</span><span>/</span><span>B</span><span>U</span><span>≡</span><span>☷</span><span>↔</span><span>链</span><span>图</span>
                  </div>
                  <div className="counted-field textarea-counter">
                    <textarea value={promptForm.content} disabled={!canEditPrompt} maxLength={5000} placeholder="请输入提示词内容，支持 Markdown 格式，建议包含背景、目标、约束、步骤、输出格式等信息。" onChange={(event) => setPromptForm({ ...promptForm, content: event.target.value })} />
                    <span>{promptForm.content.length}/5000</span>
                  </div>
                </div>
              </div>
              <div className="variable-box create-variable-box">
                <span>变量（可选）</span>
                <strong>通过变量可在调用时动态替换内容</strong>
                {variableList.length ? variableList.map((item) => <mark key={item}>{item}</mark>) : <em>无</em>}
              </div>
              {permissions.can_write && (
                <>
                  <div className="create-field">
                    <label>版本备注（可选）</label>
                    <div className="counted-field">
                      <input value={promptForm.change_note} disabled={!canEditPrompt} maxLength={200} placeholder="请输入本次创建或更新的备注信息" onChange={(event) => setPromptForm({ ...promptForm, change_note: event.target.value })} />
                      <span>{promptForm.change_note.length}/200</span>
                    </div>
                  </div>
                  <div className="actions create-actions">
                    <button type="button" className="ghost" onClick={resetPromptForm}>取消</button>
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

        {activeTab === 'favorites' && (
          <section className="favorites-panel">
            <div className="section-head">
              <div>
                <span className="eyebrow">我的收藏</span>
                <h3>个人收藏提示词</h3>
              </div>
              <button type="button" className="ghost" onClick={loadFavorites}>刷新</button>
            </div>
            <div className="prompt-list">
              {favoritePrompts.map((prompt) => renderPromptRow(prompt))}
              {favoritePrompts.length === 0 && <div className="empty">暂无收藏提示词</div>}
            </div>
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
                  <span>{item.department_name || '-'} / {item.parent_name || '一级分类'} / {item.level || 1}级</span>
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
                  <select value={categoryForm.department_id} onChange={(event) => setCategoryForm({ ...categoryForm, department_id: event.target.value, parent_id: '' })}>
                    <option value="">请选择部门</option>
                    {departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                  <select value={categoryForm.parent_id} onChange={(event) => setCategoryForm({ ...categoryForm, parent_id: event.target.value })}>
                    <option value="">不选上级，作为一级分类</option>
                    {categories
                      .filter((item) => Number(item.department_id) === Number(categoryForm.department_id || 0) && Number(item.level || 1) < 3)
                      .map((item) => <option key={item.id} value={item.id}>{`${item.level || 1}级 / ${item.name}`}</option>)}
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
