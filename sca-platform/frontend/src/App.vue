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
        <el-menu-item index="vulnerabilities">
          <el-icon><WarningFilled /></el-icon>
          <span>漏洞查询</span>
        </el-menu-item>
        <el-menu-item index="reports">
          <el-icon><Document /></el-icon>
          <span>报告导出</span>
        </el-menu-item>
        <el-menu-item index="sbom">
          <el-icon><Files /></el-icon>
          <span>SBOM/镜像扫描</span>
        </el-menu-item>
        <el-menu-item index="monitor">
          <el-icon><Bell /></el-icon>
          <span>持续监测</span>
        </el-menu-item>
        <el-menu-item index="ai">
          <el-icon><MagicStick /></el-icon>
          <span>AI 降噪</span>
        </el-menu-item>
        <el-menu-item index="assets">
          <el-icon><Share /></el-icon>
          <span>资产中心</span>
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
          <p class="sub">上传源码包后自动识别依赖，联动漏洞情报、报告、SBOM、持续监测、AI 降噪与资产中心，形成可追踪的软件供应链风险闭环。</p>
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
            <li>OSV / NVD / GitHub Advisory 漏洞查询</li>
            <li>Word / PDF / Excel 中文报告导出</li>
            <li>CycloneDX / SPDX SBOM 与镜像风险评分</li>
            <li>持续风险监测、AI 降噪与软件资产地图</li>
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

      <section v-if="activeMenu === 'vulnerabilities'" class="workbench">
        <div class="panel">
          <div class="panel-head">
            <h2>漏洞列表</h2>
            <div class="panel-actions">
              <el-select v-model="selectedProjectId" placeholder="选择项目" style="width: 220px" @change="loadProjectDetails">
                <el-option v-for="project in projects" :key="project.id" :label="project.name" :value="project.id" />
              </el-select>
              <el-button type="primary" :loading="vulnerabilityQuerying" :icon="Search" @click="queryVulnerabilities">查询漏洞</el-button>
            </div>
          </div>
          <el-table :data="vulnerabilities" empty-text="暂无漏洞，请先查询">
            <el-table-column prop="severity" label="等级" width="100">
              <template #default="{ row }">
                <el-tag :type="severityTag(row.severity)">{{ severityLabel(row.severity) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="cve_id" label="CVE" width="150" show-overflow-tooltip />
            <el-table-column prop="package_name" label="组件" min-width="180" show-overflow-tooltip />
            <el-table-column prop="package_version" label="版本" width="130" show-overflow-tooltip />
            <el-table-column prop="cvss_score" label="CVSS" width="90" />
            <el-table-column prop="fixed_version" label="修复版本" width="140" show-overflow-tooltip />
            <el-table-column prop="description" label="漏洞详情" min-width="240" show-overflow-tooltip />
            <el-table-column label="情报" width="130">
              <template #default="{ row }">
                <el-tag v-if="row.has_poc" type="warning" effect="plain">POC</el-tag>
                <el-tag v-if="row.exploited_in_wild" type="danger" effect="plain">在野</el-tag>
              </template>
            </el-table-column>
          </el-table>
        </div>
        <div class="panel side-panel">
          <div class="panel-head">
            <h2>统计与趋势</h2>
          </div>
          <div class="stats-list">
            <div><span>漏洞总数</span><strong>{{ vulnerabilityStats.total }}</strong></div>
            <div><span>平均 CVSS</span><strong>{{ vulnerabilityStats.average_cvss }}</strong></div>
            <div><span>POC</span><strong>{{ vulnerabilityStats.poc_count }}</strong></div>
            <div><span>在野利用</span><strong>{{ vulnerabilityStats.exploited_count }}</strong></div>
          </div>
          <div class="trend">
            <div v-for="item in vulnerabilityTrend" :key="item.month" class="trend-row">
              <span>{{ item.month }}</span>
              <div class="trend-bar">
                <i class="critical" :style="{ width: trendWidth(item.critical, item.total) }"></i>
                <i class="high" :style="{ width: trendWidth(item.high, item.total) }"></i>
                <i class="medium" :style="{ width: trendWidth(item.medium, item.total) }"></i>
                <i class="low" :style="{ width: trendWidth(item.low, item.total) }"></i>
              </div>
              <b>{{ item.total }}</b>
            </div>
          </div>
        </div>
      </section>

      <section v-if="activeMenu === 'reports'" class="workbench">
        <div class="panel">
          <div class="panel-head">
            <h2>中文安全报告</h2>
            <div class="panel-actions">
              <el-select v-model="selectedProjectId" placeholder="选择项目" style="width: 220px" @change="loadProjectDetails">
                <el-option v-for="project in projects" :key="project.id" :label="project.name" :value="project.id" />
              </el-select>
              <el-segmented v-model="reportFormat" :options="['docx', 'pdf', 'xlsx']" />
              <el-button type="primary" :loading="reportCreating" :icon="Document" @click="createReport">生成</el-button>
            </div>
          </div>
          <el-table :data="reports" empty-text="暂无导出报告">
            <el-table-column prop="filename" label="文件名" min-width="240" show-overflow-tooltip />
            <el-table-column prop="format" label="格式" width="90" />
            <el-table-column prop="status" label="状态" width="110" />
            <el-table-column prop="created_at" label="生成时间" width="210" />
            <el-table-column label="操作" width="110">
              <template #default="{ row }">
                <el-button text type="primary" @click="downloadReport(row)">下载</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
        <div class="panel side-panel">
          <div class="panel-head"><h2>模板内容</h2></div>
          <ul class="capability-list">
            <li>项目概况、扫描时间、组件统计</li>
            <li>漏洞统计图与风险等级统计</li>
            <li>高危漏洞清单与修复建议</li>
            <li>风险趋势与等保整改建议</li>
          </ul>
        </div>
      </section>

      <section v-if="activeMenu === 'sbom'" class="workbench">
        <div class="panel">
          <div class="panel-head">
            <h2>SBOM 生成</h2>
            <div class="panel-actions">
              <el-select v-model="selectedProjectId" placeholder="选择项目" style="width: 220px" @change="loadProjectDetails">
                <el-option v-for="project in projects" :key="project.id" :label="project.name" :value="project.id" />
              </el-select>
              <el-segmented v-model="sbomFormat" :options="['cyclonedx', 'spdx']" />
              <el-button type="primary" :loading="sbomCreating" :icon="Files" @click="createSbom">生成</el-button>
            </div>
          </div>
          <el-table :data="sboms" empty-text="暂无 SBOM">
            <el-table-column prop="filename" label="文件名" min-width="240" show-overflow-tooltip />
            <el-table-column prop="format" label="格式" width="120" />
            <el-table-column prop="component_count" label="组件数" width="100" />
            <el-table-column prop="source" label="来源" width="120" />
            <el-table-column label="操作" width="110">
              <template #default="{ row }">
                <el-button text type="primary" @click="downloadSbom(row)">下载</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
        <div class="panel side-panel">
          <div class="panel-head"><h2>镜像扫描</h2></div>
          <div class="upload-form">
            <el-form label-position="top">
              <el-form-item label="扫描器">
                <el-segmented v-model="imageScanForm.scanner" :options="['trivy', 'grype']" />
              </el-form-item>
              <el-form-item label="Docker 镜像">
                <el-input v-model="imageScanForm.imageRef" placeholder="例如：python:3.12-alpine" />
              </el-form-item>
              <el-button type="primary" :loading="imageScanning" :icon="Search" @click="scanImage">扫描镜像</el-button>
              <el-divider />
              <el-form-item label="镜像 tar">
                <input class="native-file" type="file" accept=".tar" @change="onImageTarChange" />
              </el-form-item>
              <el-progress v-if="imageUploadProgress > 0" :percentage="imageUploadProgress" />
              <el-button :loading="imageScanning" :icon="UploadFilled" @click="scanImageTar">上传 tar 并扫描</el-button>
            </el-form>
          </div>
          <el-table :data="imageScans" empty-text="暂无镜像扫描" size="small">
            <el-table-column prop="image_ref" label="镜像" min-width="130" show-overflow-tooltip />
            <el-table-column prop="status" label="状态" width="100" />
            <el-table-column prop="risk_score" label="评分" width="80" />
          </el-table>
        </div>
      </section>

      <section v-if="activeMenu === 'monitor'" class="workbench">
        <div class="panel">
          <div class="panel-head">
            <h2>持续风险监测</h2>
            <div class="panel-actions">
              <el-select v-model="selectedProjectId" placeholder="选择项目" style="width: 220px" @change="loadProjectDetails">
                <el-option v-for="project in projects" :key="project.id" :label="project.name" :value="project.id" />
              </el-select>
              <el-button type="primary" :loading="monitorRunning" :icon="Bell" @click="runRiskMonitor">立即监测</el-button>
            </div>
          </div>
          <el-table :data="riskSnapshots" empty-text="暂无监测快照">
            <el-table-column prop="risk_level" label="风险" width="90">
              <template #default="{ row }"><el-tag :type="severityTag(row.risk_level)">{{ severityLabel(row.risk_level) }}</el-tag></template>
            </el-table-column>
            <el-table-column prop="component_name" label="组件" min-width="180" show-overflow-tooltip />
            <el-table-column prop="current_version" label="当前版本" width="120" show-overflow-tooltip />
            <el-table-column prop="latest_version" label="最新版本" width="120" show-overflow-tooltip />
            <el-table-column prop="version_delta" label="更新级别" width="100" />
            <el-table-column prop="eol_status" label="生命周期" width="110" />
            <el-table-column prop="recommendation" label="更新建议" min-width="240" show-overflow-tooltip />
          </el-table>
        </div>
        <div class="panel side-panel">
          <div class="panel-head"><h2>风险提醒</h2></div>
          <div class="trend">
            <div v-for="item in riskTrend" :key="item.day" class="trend-row">
              <span>{{ item.day }}</span>
              <div class="trend-bar">
                <i class="high" :style="{ width: trendWidth(item.high, item.total) }"></i>
                <i class="medium" :style="{ width: trendWidth(item.medium, item.total) }"></i>
                <i class="low" :style="{ width: trendWidth(item.low, item.total) }"></i>
              </div>
              <b>{{ item.total }}</b>
            </div>
          </div>
          <el-table :data="riskAlerts" empty-text="暂无提醒" size="small">
            <el-table-column prop="level" label="等级" width="80" />
            <el-table-column prop="title" label="提醒" min-width="160" show-overflow-tooltip />
          </el-table>
        </div>
      </section>

      <section v-if="activeMenu === 'ai'" class="workbench">
        <div class="panel">
          <div class="panel-head">
            <h2>AI 漏洞降噪</h2>
            <div class="panel-actions">
              <el-select v-model="selectedProjectId" placeholder="选择项目" style="width: 220px" @change="loadProjectDetails">
                <el-option v-for="project in projects" :key="project.id" :label="project.name" :value="project.id" />
              </el-select>
              <el-button type="primary" :loading="aiAnalyzing" :icon="MagicStick" @click="runAiTriage">批量分析</el-button>
            </div>
          </div>
          <div class="ai-context">
            <el-checkbox v-model="aiContext.internet_exposed">公网</el-checkbox>
            <el-checkbox v-model="aiContext.core_business">核心业务</el-checkbox>
            <el-checkbox v-model="aiContext.actually_called">实际调用</el-checkbox>
            <el-checkbox v-model="aiContext.runtime_path">运行路径</el-checkbox>
            <el-checkbox v-model="aiContext.has_waf_ips">WAF/IPS</el-checkbox>
            <el-select v-model="aiContext.fix_complexity" style="width: 140px">
              <el-option label="低复杂度" value="low" />
              <el-option label="中复杂度" value="medium" />
              <el-option label="高复杂度" value="high" />
            </el-select>
          </div>
          <el-table :data="aiResults" empty-text="暂无 AI 分析结果">
            <el-table-column prop="ai_risk_level" label="AI 等级" width="100" />
            <el-table-column prop="priority_score" label="优先级" width="90" />
            <el-table-column prop="noise_reason" label="降噪原因" min-width="220" show-overflow-tooltip />
            <el-table-column prop="remediation" label="修复建议" min-width="220" show-overflow-tooltip />
            <el-table-column prop="fix_deadline" label="期限" width="100" />
            <el-table-column prop="token_total" label="Token" width="90" />
            <el-table-column label="人工确认" width="150">
              <template #default="{ row }">
                <el-button text type="primary" @click="confirmAi(row, 'accepted')">确认</el-button>
                <el-button text type="warning" @click="confirmAi(row, 'false_positive')">误报</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
        <div class="panel side-panel">
          <div class="panel-head"><h2>排序因素</h2></div>
          <ul class="capability-list">
            <li>公网、核心业务、实际调用、运行路径</li>
            <li>POC、在野利用、开发/测试依赖</li>
            <li>WAF/IPS、修复复杂度、人工确认</li>
          </ul>
        </div>
      </section>

      <section v-if="activeMenu === 'assets'" class="workbench">
        <div class="panel">
          <div class="panel-head">
            <h2>软件资产中心</h2>
            <div class="panel-actions">
              <el-input v-model="assetSearch" placeholder="搜索组件" style="width: 220px" @keyup.enter="loadAssets" />
              <el-button :icon="Search" @click="loadAssets">搜索</el-button>
            </div>
          </div>
          <section class="metric-grid asset-metrics">
            <div class="metric"><span>组件</span><strong>{{ assetDashboard.component_total }}</strong></div>
            <div class="metric danger"><span>漏洞</span><strong>{{ assetDashboard.vulnerability_total }}</strong></div>
            <div class="metric warn"><span>EOL</span><strong>{{ assetDashboard.eol_total }}</strong></div>
            <div class="metric"><span>License 风险</span><strong>{{ assetDashboard.license_risk_total }}</strong></div>
          </section>
          <el-table :data="assetComponents" empty-text="暂无资产">
            <el-table-column prop="highest_severity" label="风险" width="90" />
            <el-table-column prop="package_name" label="组件" min-width="180" show-overflow-tooltip />
            <el-table-column prop="ecosystem" label="生态" width="100" />
            <el-table-column prop="project_count" label="项目数" width="90" />
            <el-table-column prop="version_count" label="版本数" width="90" />
            <el-table-column prop="vulnerability_count" label="漏洞数" width="90" />
            <el-table-column prop="eol_status" label="EOL" width="90" />
            <el-table-column prop="license_name" label="License" width="130" show-overflow-tooltip />
          </el-table>
        </div>
        <div class="panel side-panel">
          <div class="panel-head"><h2>组件图谱</h2></div>
          <div class="graph-list">
            <div v-for="node in assetGraph.nodes.slice(0, 14)" :key="node.id" class="graph-node">
              <span>{{ node.type }}</span>
              <strong>{{ node.label }}</strong>
            </div>
          </div>
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
import { Bell, Connection, DataAnalysis, Document, Files, Grid, MagicStick, Refresh, Search, Share, UploadFilled, WarningFilled } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { requestJson, resumableUploadWithProgress, uploadArchiveWithProgress, uploadImageTarWithProgress } from './api'

const activeMenu = ref('overview')
const loading = ref(false)
const error = ref('')
const uploading = ref(false)
const vulnerabilityQuerying = ref(false)
const reportCreating = ref(false)
const sbomCreating = ref(false)
const imageScanning = ref(false)
const monitorRunning = ref(false)
const aiAnalyzing = ref(false)
const uploadProgress = ref(0)
const imageUploadProgress = ref(0)
const selectedFile = ref(null)
const selectedImageTar = ref(null)
const resumableMode = ref(true)
const selectedProjectId = ref(null)
const projects = ref([])
const uploads = ref([])
const components = ref([])
const dependencyTree = ref([])
const scanLogs = ref([])
const vulnerabilities = ref([])
const vulnerabilityTrend = ref([])
const reports = ref([])
const sboms = ref([])
const imageScans = ref([])
const riskSnapshots = ref([])
const riskAlerts = ref([])
const riskTrend = ref([])
const riskChanges = ref([])
const aiResults = ref([])
const assetComponents = ref([])
const assetGraph = ref({ nodes: [], edges: [] })
const assetSearch = ref('')
const reportFormat = ref('docx')
const sbomFormat = ref('cyclonedx')
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
const imageScanForm = reactive({
  imageRef: '',
  scanner: 'trivy',
})
const aiContext = reactive({
  internet_exposed: false,
  core_business: false,
  actually_called: false,
  runtime_path: false,
  has_waf_ips: false,
  fix_complexity: 'medium',
})
const assetDashboard = reactive({
  project_total: 0,
  component_total: 0,
  vulnerability_total: 0,
  high_risk_total: 0,
  eol_total: 0,
  license_risk_total: 0,
  by_ecosystem: {},
  by_severity: {},
})
const vulnerabilityStats = reactive({
  total: 0,
  by_severity: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
  poc_count: 0,
  exploited_count: 0,
  average_cvss: 0,
})

const userLabel = computed(() => {
  if (!overview.user?.username) return '未加载'
  return `${overview.user.username} / ${overview.user.role}`
})

const uploadPercent = (row) => {
  if (!row?.file_size) return 0
  return Math.min(100, Math.round((Number(row.received_bytes || 0) / Number(row.file_size)) * 100))
}

const severityLabel = (severity) => ({
  critical: '严重',
  high: '高危',
  medium: '中危',
  low: '低危',
  unknown: '未知',
}[severity] || severity)

const severityTag = (severity) => ({
  critical: 'danger',
  high: 'danger',
  medium: 'warning',
  low: 'success',
}[severity] || 'info')

const trendWidth = (value, total) => {
  if (!total) return '0%'
  return `${Math.max(4, Math.round((value / total) * 100))}%`
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
  const vulnerabilityData = await requestJson(`/api/sca/projects/${selectedProjectId.value}/vulnerabilities`)
  vulnerabilities.value = vulnerabilityData?.items || []
  const stats = await requestJson(`/api/sca/projects/${selectedProjectId.value}/vulnerabilities/stats`)
  if (stats) Object.assign(vulnerabilityStats, stats)
  const trend = await requestJson(`/api/sca/projects/${selectedProjectId.value}/vulnerabilities/trend`)
  vulnerabilityTrend.value = trend?.items || []
  reports.value = (await requestJson(`/api/sca/projects/${selectedProjectId.value}/reports`)) || []
  sboms.value = (await requestJson(`/api/sca/projects/${selectedProjectId.value}/sbom`)) || []
  riskSnapshots.value = (await requestJson(`/api/sca/projects/${selectedProjectId.value}/risk-monitor/snapshots`)) || []
  riskAlerts.value = (await requestJson(`/api/sca/projects/${selectedProjectId.value}/risk-monitor/alerts`)) || []
  riskChanges.value = (await requestJson(`/api/sca/projects/${selectedProjectId.value}/risk-monitor/changes`)) || []
  const monitorTrend = await requestJson(`/api/sca/projects/${selectedProjectId.value}/risk-monitor/trend`)
  riskTrend.value = monitorTrend?.items || []
  aiResults.value = (await requestJson(`/api/sca/projects/${selectedProjectId.value}/ai-triage/results`)) || []
}

const refreshAll = async () => {
  await Promise.all([loadOverview(), loadProjects(), loadUploads()])
  await loadProjectDetails()
}

const onFileChange = (event) => {
  selectedFile.value = event.target.files?.[0] || null
}

const onImageTarChange = (event) => {
  selectedImageTar.value = event.target.files?.[0] || null
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

const queryVulnerabilities = async () => {
  if (!selectedProjectId.value) {
    ElMessage.warning('请先选择项目')
    return
  }
  vulnerabilityQuerying.value = true
  try {
    const data = await requestJson(`/api/sca/projects/${selectedProjectId.value}/vulnerabilities/query`, { method: 'POST' })
    vulnerabilities.value = data?.items || []
    await loadProjectDetails()
    ElMessage.success(`漏洞查询完成：${data?.total || 0} 条`)
  } catch (err) {
    ElMessage.error(err?.message || '漏洞查询失败')
  } finally {
    vulnerabilityQuerying.value = false
  }
}

const createReport = async () => {
  if (!selectedProjectId.value) {
    ElMessage.warning('请先选择项目')
    return
  }
  reportCreating.value = true
  try {
    await requestJson(`/api/sca/projects/${selectedProjectId.value}/reports`, {
      method: 'POST',
      body: JSON.stringify({ format: reportFormat.value }),
    })
    await loadProjectDetails()
    ElMessage.success('报告已生成')
  } catch (err) {
    ElMessage.error(err?.message || '报告生成失败')
  } finally {
    reportCreating.value = false
  }
}

const downloadReport = (row) => {
  window.open(`/api/sca/reports/${row.id}/download`, '_blank')
}

const createSbom = async () => {
  if (!selectedProjectId.value) {
    ElMessage.warning('请先选择项目')
    return
  }
  sbomCreating.value = true
  try {
    await requestJson(`/api/sca/projects/${selectedProjectId.value}/sbom`, {
      method: 'POST',
      body: JSON.stringify({ format: sbomFormat.value }),
    })
    await loadProjectDetails()
    ElMessage.success('SBOM 已生成')
  } catch (err) {
    ElMessage.error(err?.message || 'SBOM 生成失败')
  } finally {
    sbomCreating.value = false
  }
}

const downloadSbom = (row) => {
  window.open(`/api/sca/sbom/${row.id}/download`, '_blank')
}

const loadImageScans = async () => {
  imageScans.value = (await requestJson('/api/sca/image-scans')) || []
}

const runRiskMonitor = async () => {
  if (!selectedProjectId.value) {
    ElMessage.warning('请先选择项目')
    return
  }
  monitorRunning.value = true
  try {
    const data = await requestJson(`/api/sca/projects/${selectedProjectId.value}/risk-monitor/run`, { method: 'POST' })
    await loadProjectDetails()
    ElMessage.success(data?.summary || '持续风险监测完成')
  } catch (err) {
    ElMessage.error(err?.message || '持续风险监测失败')
  } finally {
    monitorRunning.value = false
  }
}

const runAiTriage = async () => {
  if (!selectedProjectId.value) {
    ElMessage.warning('请先选择项目')
    return
  }
  const ids = vulnerabilities.value.map((item) => item.id)
  if (!ids.length) {
    ElMessage.warning('请先查询漏洞')
    return
  }
  aiAnalyzing.value = true
  try {
    aiResults.value = await requestJson(`/api/sca/projects/${selectedProjectId.value}/ai-triage/analyze`, {
      method: 'POST',
      body: JSON.stringify({ vulnerability_ids: ids, context: aiContext }),
    })
    ElMessage.success('AI 降噪分析完成')
  } catch (err) {
    ElMessage.error(err?.message || 'AI 降噪失败')
  } finally {
    aiAnalyzing.value = false
  }
}

const confirmAi = async (row, status) => {
  await requestJson(`/api/sca/ai-triage/${row.id}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ human_status: status }),
  })
  await loadProjectDetails()
  ElMessage.success('已确认')
}

const loadAssets = async () => {
  const dashboard = await requestJson('/api/sca/assets/dashboard')
  if (dashboard) Object.assign(assetDashboard, dashboard)
  const params = new URLSearchParams()
  if (assetSearch.value.trim()) params.set('search', assetSearch.value.trim())
  const componentsData = await requestJson(`/api/sca/assets/components?${params.toString()}`)
  assetComponents.value = componentsData?.items || []
  assetGraph.value = (await requestJson('/api/sca/assets/graph')) || { nodes: [], edges: [] }
}

const scanImage = async () => {
  if (!imageScanForm.imageRef.trim()) {
    ElMessage.warning('请填写 Docker 镜像名称')
    return
  }
  imageScanning.value = true
  try {
    await requestJson('/api/sca/image-scans', {
      method: 'POST',
      body: JSON.stringify({ image_ref: imageScanForm.imageRef.trim(), scanner: imageScanForm.scanner }),
    })
    await loadImageScans()
    ElMessage.success('镜像扫描任务已完成')
  } catch (err) {
    ElMessage.error(err?.message || '镜像扫描失败')
  } finally {
    imageScanning.value = false
  }
}

const scanImageTar = async () => {
  if (!selectedImageTar.value) {
    ElMessage.warning('请选择镜像 tar 文件')
    return
  }
  imageScanning.value = true
  imageUploadProgress.value = 0
  try {
    await uploadImageTarWithProgress({
      file: selectedImageTar.value,
      scanner: imageScanForm.scanner,
      onProgress: (percent) => {
        imageUploadProgress.value = percent
      },
    })
    await loadImageScans()
    ElMessage.success('镜像 tar 已上传并扫描')
  } catch (err) {
    ElMessage.error(err?.message || '镜像 tar 扫描失败')
  } finally {
    imageScanning.value = false
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

onMounted(refreshAll)
onMounted(loadImageScans)
onMounted(loadAssets)
</script>
