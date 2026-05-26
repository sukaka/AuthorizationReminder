<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <strong><span class="brand-red">聚信</span><span class="brand-blue">SCA</span></strong>
        <small>软件成分分析平台</small>
      </div>

      <el-menu class="menu" :default-active="activeMenu">
        <el-menu-item index="overview">
          <el-icon><DataAnalysis /></el-icon>
          <span>平台总览</span>
        </el-menu-item>
        <el-menu-item index="projects">
          <el-icon><FolderOpened /></el-icon>
          <span>项目资产</span>
        </el-menu-item>
        <el-menu-item index="components">
          <el-icon><Grid /></el-icon>
          <span>组件清单</span>
        </el-menu-item>
        <el-menu-item index="policy">
          <el-icon><Lock /></el-icon>
          <span>策略基线</span>
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
          <p class="sub">第一阶段已接入 FastAPI、PostgreSQL、Redis、Celery 与统一登录，后续可扩展 SBOM、漏洞库和许可证策略。</p>
        </div>
        <div class="hero-actions">
          <el-button :icon="Refresh" @click="loadOverview">刷新</el-button>
          <el-button type="primary" :icon="Connection" @click="enqueueTask">测试任务队列</el-button>
        </div>
      </section>

      <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" />

      <section class="metric-grid" v-loading="loading">
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

      <section class="workbench">
        <div class="panel">
          <div class="panel-head">
            <h2>最近分析项目</h2>
            <el-tag>Bootstrap</el-tag>
          </div>
          <el-table :data="overview.recent_projects" empty-text="暂无项目，等待下一阶段接入代码仓库扫描">
            <el-table-column prop="name" label="项目名称" min-width="160" />
            <el-table-column prop="owner" label="负责人" width="120" />
            <el-table-column prop="risk_level" label="风险" width="110">
              <template #default="{ row }">
                <el-tag :type="riskTag(row.risk_level)">{{ row.risk_level }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="130" />
          </el-table>
        </div>

        <div class="panel side-panel">
          <div class="panel-head">
            <h2>阶段能力</h2>
          </div>
          <ul class="capability-list">
            <li>统一登录平台鉴权</li>
            <li>FastAPI Swagger 文档</li>
            <li>PostgreSQL 初始化脚本</li>
            <li>Redis + Celery 异步任务</li>
            <li>Docker Compose 一键启动</li>
          </ul>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { Connection, DataAnalysis, FolderOpened, Grid, Lock, Refresh } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { requestJson } from './api'

const activeMenu = ref('overview')
const loading = ref(false)
const error = ref('')
const overview = reactive({
  project_count: 0,
  component_count: 0,
  high_risk_count: 0,
  pending_component_count: 0,
  recent_projects: [],
  user: null,
})

const userLabel = computed(() => {
  if (!overview.user?.username) return '未加载'
  return `${overview.user.username} / ${overview.user.role}`
})

const riskTag = (value) => {
  if (value === 'high') return 'danger'
  if (value === 'medium') return 'warning'
  return 'success'
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

const enqueueTask = async () => {
  try {
    const data = await requestJson('/api/sca/tasks/demo', { method: 'POST' })
    if (data?.task_id) ElMessage.success(`任务已入队：${data.task_id}`)
  } catch (err) {
    ElMessage.error(err?.message || '任务提交失败')
  }
}

onMounted(loadOverview)
</script>
