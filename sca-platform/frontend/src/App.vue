<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <strong><span class="brand-red">聚信</span><span class="brand-blue">SCA</span></strong>
        <small>软件成分分析平台</small>
      </div>

      <el-menu class="menu" :default-active="activeMenu" @select="activeMenu = $event">
        <el-menu-item index="overview">
          <el-icon><DataAnalysis /></el-icon>
          <span>平台总览</span>
        </el-menu-item>
        <el-menu-item index="upload">
          <el-icon><UploadFilled /></el-icon>
          <span>源码上传</span>
        </el-menu-item>
        <el-menu-item index="components">
          <el-icon><Grid /></el-icon>
          <span>依赖识别</span>
        </el-menu-item>
        <el-menu-item index="logs">
          <el-icon><Document /></el-icon>
          <span>扫描日志</span>
        </el-menu-item>
      </el-menu>

      <div class="sidebar-footer">
        <el-tag type="success" effect="light">统一登录</el-tag>
        <span>{{ userLabel }}</span>
      </div>
    </aside>

    <main class="content">
      <section class="hero">
        <div>
          <p class="eyebrow">Software Composition Analysis</p>
          <h1>聚信软件成分分析平台</h1>
          <p class="sub">上传源码包后自动识别 Maven、npm、Python、Go 与 Docker 基础镜像依赖，并沉淀组件清单、依赖树与扫描日志。</p>
        </div>
        <div class="hero-actions">
          <el-button :icon="Refresh" @click="refreshAll">刷新</el-button>
          <el-button type="primary" :icon="Connection" @click="enqueueTask">测试任务队列</el-button>
        </div>
      </section>

      <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" />

      <section v-if="activeMenu === 'overview'" class="metric-grid" v-loading="loading">
        <div class="metric">
          <span>分析项目</span>
          <strong>{{ overview.project_count }}</strong>
        </div>
        <div class="metric">
          <span>组件数量</span>
          <strong>{{ overview.component_count }}</strong>
        </div>
        <div class="metric danger">
          <span>高风险项目</span>
          <strong>{{ overview.high_risk_count }}</strong>
        </div>
        <div class="metric warn">
          <span>待确认组件</span>
          <strong>{{ overview.pending_component_count }}</strong>
        </div>
      </section>

      <section v-if="activeMenu === 'overview'" class="workbench">
        <div class="panel">
          <div class="panel-head">
            <h2>最近分析项目</h2>
            <el-tag>Docker Ready</el-tag>
          </div>
          <el-table :data="projects" empty-text="暂无项目，请先上传源码包">
            <el-table-column prop="name" label="项目名称" min-width="160" />
            <el-table-column prop="status" label="状态" width="120" />
            <el-table-column prop="scan_note" label="扫描备注" min-width="180" show-overflow-tooltip />
            <el-table-column label="操作" width="110">
              <template #default="{ row }">
                <el-button text type="primary" @click="openProject(row)">查看依赖</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div class="panel side-panel">
          <div class="panel-head">
            <h2>阶段能力</h2>
          </div>
          <ul class="capability-list">
            <li>zip / tar.gz 源码上传</li>
            <li>断点续传与文件大小限制</li>
            <li>上传记录、删除与审计日志</li>
            <li>Celery 异步依赖识别</li>
            <li>依赖列表与依赖树展示</li>
          </ul>
        </div>
      </section>

      <section v-if="activeMenu === 'upload'" class="workbench upload-grid">
        <div class="panel">
          <div class="panel-head">
            <h2>源码上传</h2>
            <el-switch v-model="resumableMode" active-text="断点续传" inactive-text="普通上传" />
          </div>
          <div class="upload-form">
            <el-form label-position="top">
              <el-form-item label="项目名称">
                <el-input v-model="uploadForm.projectName" placeholder="例如：juxin-auth-service" />
              </el-form-item>
              <el-form-item label="扫描备注">
                <el-input v-model="uploadForm.scanNote" type="textarea" :rows="3" placeholder="记录本次扫描范围、分支或版本" />
              </el-form-item>
              <el-form-item label="源码包">
                <input class="native-file" type="file" accept=".zip,.tar.gz,.tgz" @change="onFileChange" />
              </el-form-item>
              <el-progress v-if="uploadProgress > 0" :percentage="uploadProgress" />
              <div class="form-actions">
                <el-button type="primary" :loading="uploading" :icon="UploadFilled" @click="submitUpload">上传并扫描</el-button>
              </div>
            </el-form>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head">
            <h2>上传文件列表</h2>
            <el-button :icon="Refresh" @click="loadUploads">刷新</el-button>
          </div>
          <el-table :data="uploads" empty-text="暂无上传文件">
            <el-table-column prop="project_name" label="项目" min-width="140" />
            <el-table-column prop="original_filename" label="文件名" min-width="160" show-overflow-tooltip />
            <el-table-column prop="status" label="状态" width="105" />
            <el-table-column label="进度" width="130">
              <template #default="{ row }">{{ uploadPercent(row) }}%</template>
            </el-table-column>
            <el-table-column label="操作" width="150">
              <template #default="{ row }">
                <el-button text type="primary" @click="selectProject(row.project_id)">依赖</el-button>
                <el-button text type="danger" @click="deleteUpload(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </section>

      <section v-if="activeMenu === 'components'" class="workbench">
        <div class="panel">
          <div class="panel-head">
            <h2>依赖列表</h2>
            <el-select v-model="selectedProjectId" placeholder="选择项目" style="width: 240px" @change="loadProjectDetails">
              <el-option v-for="project in projects" :key="project.id" :label="project.name" :value="project.id" />
            </el-select>
          </div>
          <el-table :data="components" empty-text="暂无依赖，请等待扫描完成">
            <el-table-column prop="ecosystem" label="生态" width="110" />
            <el-table-column prop="package_name" label="依赖名称" min-width="220" show-overflow-tooltip />
            <el-table-column prop="package_version" label="版本" width="140" show-overflow-tooltip />
            <el-table-column prop="scope" label="范围" width="110" />
            <el-table-column prop="source_path" label="来源文件" min-width="180" show-overflow-tooltip />
          </el-table>
        </div>
        <div class="panel side-panel">
          <div class="panel-head">
            <h2>依赖树</h2>
          </div>
          <el-tree :data="dependencyTree" node-key="id" default-expand-all :props="{ label: 'label', children: 'children' }" />
        </div>
      </section>

      <section v-if="activeMenu === 'logs'" class="panel">
        <div class="panel-head">
          <h2>扫描日志</h2>
          <el-select v-model="selectedProjectId" placeholder="选择项目" style="width: 240px" @change="loadProjectDetails">
            <el-option v-for="project in projects" :key="project.id" :label="project.name" :value="project.id" />
          </el-select>
        </div>
        <el-table :data="scanLogs" empty-text="暂无扫描日志">
          <el-table-column prop="level" label="级别" width="100" />
          <el-table-column prop="message" label="日志内容" min-width="260" show-overflow-tooltip />
          <el-table-column prop="created_at" label="时间" width="210" />
        </el-table>
      </section>
    </main>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { Connection, DataAnalysis, Document, Grid, Refresh, UploadFilled } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { requestJson, resumableUploadWithProgress, uploadArchiveWithProgress } from './api'

const activeMenu = ref('overview')
const loading = ref(false)
const error = ref('')
const uploading = ref(false)
const uploadProgress = ref(0)
const selectedFile = ref(null)
const resumableMode = ref(true)
const selectedProjectId = ref(null)
const projects = ref([])
const uploads = ref([])
const components = ref([])
const dependencyTree = ref([])
const scanLogs = ref([])
const overview = reactive({
  project_count: 0,
  component_count: 0,
  high_risk_count: 0,
  pending_component_count: 0,
  recent_projects: [],
  user: null,
})
const uploadForm = reactive({
  projectName: '',
  scanNote: '',
})

const userLabel = computed(() => {
  if (!overview.user?.username) return '未加载'
  return `${overview.user.username} / ${overview.user.role}`
})

const uploadPercent = (row) => {
  if (!row?.file_size) return 0
  return Math.min(100, Math.round((Number(row.received_bytes || 0) / Number(row.file_size)) * 100))
}

const loadOverview = async () => {
  loading.value = true
  error.value = ''
  try {
    const data = await requestJson('/api/sca/overview')
    if (data) Object.assign(overview, data)
  } catch (err) {
    error.value = err?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

const loadProjects = async () => {
  projects.value = (await requestJson('/api/sca/projects')) || []
  if (!selectedProjectId.value && projects.value.length) {
    selectedProjectId.value = projects.value[0].id
  }
}

const loadUploads = async () => {
  const data = await requestJson('/api/sca/uploads')
  uploads.value = data?.items || []
}

const loadProjectDetails = async () => {
  if (!selectedProjectId.value) return
  components.value = (await requestJson(`/api/sca/projects/${selectedProjectId.value}/components`)) || []
  dependencyTree.value = (await requestJson(`/api/sca/projects/${selectedProjectId.value}/dependency-tree`)) || []
  scanLogs.value = (await requestJson(`/api/sca/projects/${selectedProjectId.value}/scan-logs`)) || []
}

const refreshAll = async () => {
  await Promise.all([loadOverview(), loadProjects(), loadUploads()])
  await loadProjectDetails()
}

const onFileChange = (event) => {
  selectedFile.value = event.target.files?.[0] || null
}

const submitUpload = async () => {
  if (!uploadForm.projectName.trim()) {
    ElMessage.warning('请填写项目名称')
    return
  }
  if (!selectedFile.value) {
    ElMessage.warning('请选择源码包')
    return
  }
  uploading.value = true
  uploadProgress.value = 0
  try {
    const uploader = resumableMode.value ? resumableUploadWithProgress : uploadArchiveWithProgress
    const uploaded = await uploader({
      file: selectedFile.value,
      projectName: uploadForm.projectName.trim(),
      scanNote: uploadForm.scanNote,
      onProgress: (percent) => {
        uploadProgress.value = percent
      },
    })
    if (uploaded?.project_id) {
      selectedProjectId.value = uploaded.project_id
      ElMessage.success('上传成功，已进入依赖识别流程')
    }
    await refreshAll()
    activeMenu.value = 'components'
  } catch (err) {
    ElMessage.error(err?.message || '上传失败')
  } finally {
    uploading.value = false
  }
}

const deleteUpload = async (row) => {
  await ElMessageBox.confirm(`确认删除 ${row.original_filename}？`, '删除上传文件', { type: 'warning' })
  await requestJson(`/api/sca/uploads/${row.id}`, { method: 'DELETE' })
  ElMessage.success('已删除')
  await refreshAll()
}

const selectProject = async (projectId) => {
  selectedProjectId.value = projectId
  activeMenu.value = 'components'
  await loadProjectDetails()
}

const openProject = async (project) => {
  await selectProject(project.id)
}

const enqueueTask = async () => {
  try {
    const data = await requestJson('/api/sca/tasks/demo', { method: 'POST' })
    if (data?.task_id) ElMessage.success(`任务已入队：${data.task_id}`)
  } catch (err) {
    ElMessage.error(err?.message || '任务提交失败')
  }
}

onMounted(refreshAll)
</script>
