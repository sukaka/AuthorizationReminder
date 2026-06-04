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
        <el-menu-item index="remediation">
          <el-icon><Document /></el-icon>
          <span>整改闭环</span>
        </el-menu-item>
        <el-menu-item index="devops">
          <el-icon><Connection /></el-icon>
          <span>DevSecOps</span>
        </el-menu-item>
        <el-menu-item index="ops">
          <el-icon><DataAnalysis /></el-icon>
          <span>生产运维</span>
        </el-menu-item>
        <el-menu-item index="system-config">
          <el-icon><Setting /></el-icon>
          <span>系统配置</span>
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
            <el-table-column label="操作" width="180">
              <template #default="{ row }">
                <el-button text type="primary" :icon="Connection" @click="openProject(row)">查看依赖</el-button>
                <el-button text type="danger" :icon="Delete" :loading="deletingProjectId === row.id" @click="deleteProject(row)">删除</el-button>
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
          <el-alert
            v-if="scanCompleteness.message"
            class="scan-completeness-alert"
            type="warning"
            show-icon
            :closable="false"
            :title="scanCompleteness.message"
          />
          <section class="scan-completeness-grid">
            <div><span>扫描模式</span><strong>{{ scanCompleteness.scan_mode || '-' }}</strong></div>
            <div><span>高可信</span><strong>{{ scanCompleteness.high_confidence_count || 0 }}</strong></div>
            <div><span>中可信</span><strong>{{ scanCompleteness.medium_confidence_count || 0 }}</strong></div>
            <div><span>低可信</span><strong>{{ scanCompleteness.low_confidence_count || 0 }}</strong></div>
            <div><span>未知版本</span><strong>{{ scanCompleteness.unknown_version_count || 0 }}</strong></div>
            <div><span>待确认</span><strong>{{ scanCompleteness.manual_confirm_count || 0 }}</strong></div>
          </section>
          <el-table :data="components" empty-text="暂无依赖，请等待扫描完成">
            <el-table-column type="expand">
              <template #default="{ row }">
                <div class="component-evidence">
                  <div>
                    <span class="muted">标准包名</span>
                    <strong>{{ row.normalized_name || row.package_name }}</strong>
                  </div>
                  <div>
                    <span class="muted">PURL</span>
                    <strong>{{ row.purl || '-' }}</strong>
                  </div>
                  <div>
                    <span class="muted">CPE</span>
                    <strong>{{ row.cpe || '-' }}</strong>
                  </div>
                  <div>
                    <span class="muted">证据文件</span>
                    <strong>{{ row.evidence_file || row.source_path || '-' }}{{ row.evidence_line ? `:${row.evidence_line}` : '' }}</strong>
                  </div>
                  <div>
                    <span class="muted">识别方式</span>
                    <strong>{{ row.detected_by || '-' }} / {{ row.detection_method || row.evidence_level || '-' }}</strong>
                  </div>
                  <div>
                    <span class="muted">置信度</span>
                    <strong>{{ row.confidence_level || '-' }} / {{ Math.round((row.confidence_score || 0) * 100) }}%</strong>
                  </div>
                  <div>
                    <span class="muted">版本锁定</span>
                    <strong>{{ row.version_lock_status || '-' }}</strong>
                  </div>
                  <div>
                    <span class="muted">实际版本</span>
                    <strong>{{ row.resolved_version || row.package_version || '-' }}</strong>
                  </div>
                  <div>
                    <span class="muted">文件指纹</span>
                    <strong>{{ row.sha256 ? `${row.component_file_name || 'artifact'} / ${row.sha256.slice(0, 16)}...` : '-' }}</strong>
                  </div>
                  <div class="evidence-text">
                    <span class="muted">证据文本</span>
                    <code>{{ row.evidence_text || '-' }}</code>
                  </div>
                  <div v-if="row.version_risk_type" class="evidence-text conflict">
                    <span class="muted">{{ row.version_risk_type }}</span>
                    <code>{{ row.risk_explanation }} {{ row.fix_recommendation }}</code>
                  </div>
                  <div v-if="row.version_conflict" class="evidence-text conflict">
                    <span class="muted">版本来源不一致</span>
                    <code>{{ row.conflict_reason }}</code>
                  </div>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="ecosystem" label="生态" width="110" />
            <el-table-column prop="package_name" label="依赖名称" min-width="220" show-overflow-tooltip />
            <el-table-column prop="package_version" label="版本" width="140" show-overflow-tooltip>
              <template #default="{ row }">
                <el-tag v-if="row.version_conflict" type="warning" effect="plain">不一致</el-tag>
                <span class="version-text">{{ row.package_version }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="scope" label="范围" width="110" />
            <el-table-column prop="dependency_type" label="类型" width="120" />
            <el-table-column prop="confidence_level" label="可信度" width="115">
              <template #default="{ row }">
                <el-tag :type="componentConfidenceTag(row.confidence_level)" effect="plain">{{ row.confidence_level }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="version_lock_status" label="版本风险" width="145">
              <template #default="{ row }">
                <el-tag :type="row.version_risk_type ? 'warning' : 'success'" effect="plain">
                  {{ row.version_risk_type || row.version_lock_status }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="detected_by" label="来源" width="110" />
            <el-table-column prop="source_path" label="来源文件" min-width="180" show-overflow-tooltip />
            <el-table-column label="操作" width="110">
              <template #default="{ row }">
                <el-button v-if="row.need_manual_version_confirm || row.package_version === 'unknown'" text type="primary" @click="manualVersion(row)">补录版本</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
        <div class="panel side-panel">
          <div class="panel-head">
            <h2>依赖树</h2>
          </div>
          <div class="meta-stack dependency-track-status">
            <div><span>DTrack 状态</span><strong>{{ dependencyTrackStatus.last_status || 'not_linked' }}</strong></div>
            <div><span>项目 UUID</span><strong>{{ dependencyTrackStatus.dependency_track_project_uuid || '-' }}</strong></div>
            <div><span>BOM 上传</span><strong>{{ dependencyTrackStatus.bom_uploaded_at || '-' }}</strong></div>
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
              <el-select v-model="vulnerabilityFilter" placeholder="可信度筛选" style="width: 170px">
                <el-option label="全部漏洞" value="all" />
                <el-option label="高可信漏洞" value="high" />
                <el-option label="中可信漏洞" value="medium" />
                <el-option label="低可信漏洞" value="low" />
                <el-option label="待确认漏洞" value="review" />
                <el-option label="疑似误报漏洞" value="false_positive" />
              </el-select>
              <el-button type="primary" :loading="vulnerabilityQuerying" :icon="Search" @click="queryVulnerabilities">查询漏洞</el-button>
            </div>
          </div>
          <div class="risk-command">
            <div class="quick-filters">
              <el-button :type="quickFilters.p01 ? 'primary' : 'default'" plain @click="toggleQuickFilter('p01')">只看 P0/P1</el-button>
              <el-button :type="quickFilters.hideDev ? 'primary' : 'default'" plain @click="toggleQuickFilter('hideDev')">隐藏开发依赖</el-button>
              <el-button :type="quickFilters.hideTest ? 'primary' : 'default'" plain @click="toggleQuickFilter('hideTest')">隐藏测试依赖</el-button>
              <el-button :type="quickFilters.publicOnly ? 'primary' : 'default'" plain @click="toggleQuickFilter('publicOnly')">只看公网项目</el-button>
              <el-button :type="quickFilters.reachableOnly ? 'primary' : 'default'" plain @click="toggleQuickFilter('reachableOnly')">只看可达漏洞</el-button>
              <el-button :type="quickFilters.kevOnly ? 'danger' : 'default'" plain @click="toggleQuickFilter('kevOnly')">只看 KEV</el-button>
              <el-button :type="quickFilters.pocOnly ? 'warning' : 'default'" plain @click="toggleQuickFilter('pocOnly')">只看有 PoC</el-button>
              <el-button :type="quickFilters.reviewOnly ? 'warning' : 'default'" plain @click="toggleQuickFilter('reviewOnly')">需要人工确认</el-button>
              <el-button :type="quickFilters.falsePositiveOnly ? 'info' : 'default'" plain @click="toggleQuickFilter('falsePositiveOnly')">疑似误报</el-button>
              <el-button text @click="resetQuickFilters">清空</el-button>
            </div>
            <el-segmented v-model="projectResultView" :options="resultViewOptions" />
          </div>

          <section class="scan-result-board" :class="`is-${projectResultView}`">
            <template v-if="projectResultView === 'management'">
              <div class="scan-brief">
                <span>管理层结论</span>
                <strong>{{ managementSummary.title }}</strong>
                <p>{{ managementSummary.description }}</p>
              </div>
              <div class="scan-kpis">
                <div><span>风险等级</span><strong>{{ managementSummary.level }}</strong></div>
                <div><span>P0/P1</span><strong>{{ p01Count }}</strong></div>
                <div><span>整改进度</span><strong>{{ remediationProgress }}%</strong></div>
                <div><span>可信漏洞</span><strong>{{ trustedVulnerabilityCount }}</strong></div>
              </div>
              <div class="mini-trend">
                <div v-for="item in vulnerabilityTrend" :key="item.month">
                  <span>{{ item.month }}</span>
                  <i :style="{ height: trendHeight(item.total) }"></i>
                  <b>{{ item.total }}</b>
                </div>
              </div>
            </template>
            <template v-else-if="projectResultView === 'security'">
              <div class="security-lanes">
                <div v-for="level in ['P0', 'P1', 'P2', 'Review']" :key="level">
                  <span>{{ level }}</span>
                  <strong>{{ priorityCount(level) }}</strong>
                  <p>{{ priorityTopReason(level) }}</p>
                </div>
              </div>
              <div class="evidence-strip">
                <span>匹配证据：{{ evidenceCoverage.match }} 条</span>
                <span>可达证据：{{ evidenceCoverage.reachability }} 条</span>
                <span>待确认：{{ reviewCount }} 条</span>
              </div>
            </template>
            <template v-else>
              <div class="developer-fix-list">
                <div v-for="item in developerFixItems" :key="item.id">
                  <strong>{{ item.package_name }} {{ item.package_version }}</strong>
                  <code>{{ fixCommand(item) }}</code>
                  <span>{{ item.related_files || componentSource(item) || '影响文件待补充' }}</span>
                  <el-tag :type="priorityTag(item.risk_priority)" effect="plain">{{ item.risk_priority || 'Review' }}</el-tag>
                </div>
              </div>
            </template>
          </section>

          <el-table :data="filteredVulnerabilities" empty-text="暂无漏洞，请先查询">
            <el-table-column type="expand">
              <template #default="{ row }">
                <div class="component-evidence">
                  <div>
                    <span class="muted">可达性</span>
                    <strong>{{ reachabilityLabel(row.reachability_status) }}</strong>
                  </div>
                  <div>
                    <span class="muted">入口点</span>
                    <strong>{{ row.entry_points || '-' }}</strong>
                  </div>
                  <div>
                    <span class="muted">相关文件</span>
                    <strong>{{ row.related_files || '-' }}</strong>
                  </div>
                  <div class="evidence-text">
                    <span class="muted">判断原因</span>
                    <code>{{ row.call_path_summary || '暂无可达性分析结论' }}</code>
                  </div>
                  <div class="evidence-text">
                    <span class="muted">调用证据</span>
                    <code>{{ row.reachability_evidence || '未发现调用证据' }}</code>
                  </div>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="severity" label="等级" width="100">
              <template #default="{ row }">
                <el-tag :type="severityTag(row.severity)">{{ severityLabel(row.severity) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="risk_priority" label="优先级" width="100">
              <template #default="{ row }">
                <el-tag :type="priorityTag(row.risk_priority)">{{ row.risk_priority || 'Review' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="cve_id" label="CVE" width="150" show-overflow-tooltip />
            <el-table-column prop="package_name" label="组件" min-width="180" show-overflow-tooltip />
            <el-table-column prop="package_version" label="版本" width="130" show-overflow-tooltip />
            <el-table-column prop="cvss_score" label="CVSS" width="90" />
            <el-table-column prop="risk_score" label="风险分" width="90" />
            <el-table-column label="可信度" width="120">
              <template #default="{ row }">
                <el-tag :type="confidenceTag(row.confidence_score, row.needs_human_review)" effect="plain">
                  {{ Math.round((row.confidence_score || 0) * 100) }}%
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="match_status" label="匹配" width="110">
              <template #default="{ row }">
                <el-tag :type="row.match_status === 'affected' ? 'success' : 'warning'" effect="plain">{{ row.match_status }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="reachability_status" label="可达性" width="130">
              <template #default="{ row }">
                <el-tag :type="reachabilityTag(row.reachability_status)" effect="plain">{{ reachabilityLabel(row.reachability_status) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="fixed_version" label="修复版本" width="140" show-overflow-tooltip />
            <el-table-column prop="priority_reason" label="优先级原因" min-width="220" show-overflow-tooltip />
            <el-table-column prop="description" label="漏洞详情" min-width="240" show-overflow-tooltip />
            <el-table-column label="情报" width="130">
              <template #default="{ row }">
                <el-tag v-if="row.cisa_kev" type="danger" effect="plain">KEV</el-tag>
                <el-tag v-if="row.has_poc" type="warning" effect="plain">POC</el-tag>
                <el-tag v-if="row.exploited_in_wild" type="danger" effect="plain">在野</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" fixed="right" width="110">
              <template #default="{ row }">
                <el-button text type="primary" @click="openVulnerabilityDetail(row)">详情</el-button>
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
            <li>本次扫描结论摘要与上线建议</li>
            <li>漏洞可信度说明：已确认、待确认、疑似误报</li>
            <li>按 P0/P1/P2/P3 输出整改优先级</li>
            <li>Maven / npm / pip / Go / Docker 修复命令</li>
          </ul>
        </div>
      </section>

      <el-dialog v-model="reportMetadataDialogVisible" title="报告属性信息" width="760px">
        <el-form label-position="top" class="metadata-form">
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="委托单位名称">
                <el-input v-model="reportMetadata.client_name" placeholder="例如：XXXX公司" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="版本号">
                <el-input v-model="reportMetadata.version_number" placeholder="例如：V1.0" />
              </el-form-item>
            </el-col>
            <el-col :span="24">
              <el-form-item label="委托单位地址">
                <el-input v-model="reportMetadata.client_address" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="联系人">
                <el-input v-model="reportMetadata.contact_name" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="联系电话">
                <el-input v-model="reportMetadata.contact_phone" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="邮箱">
                <el-input v-model="reportMetadata.contact_email" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="审计机构名称">
                <el-input v-model="reportMetadata.organization_name" placeholder="例如：XXXXXX有限公司" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="审计地点">
                <el-input v-model="reportMetadata.audit_address" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="审计人员">
                <el-input v-model="reportMetadata.auditor_name" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="审核人员">
                <el-input v-model="reportMetadata.reviewer_name" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="质量人员">
                <el-input v-model="reportMetadata.quality_reviewer_name" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="代码接收日期">
                <el-input v-model="reportMetadata.accepted_date" placeholder="YYYY.MM.DD" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="审计开始日期">
                <el-input v-model="reportMetadata.audit_start_date" placeholder="YYYY.MM.DD" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="审计结束日期">
                <el-input v-model="reportMetadata.audit_end_date" placeholder="YYYY.MM.DD" />
              </el-form-item>
            </el-col>
          </el-row>
        </el-form>
        <template #footer>
          <el-button @click="reportMetadataDialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="reportCreating" @click="submitReport">生成报告</el-button>
        </template>
      </el-dialog>

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
            <el-table-column prop="confidence" label="置信度" width="90">
              <template #default="{ row }">{{ Math.round((row.confidence || 0) * 100) }}%</template>
            </el-table-column>
            <el-table-column prop="priority_score" label="优先级" width="90" />
            <el-table-column prop="reason" label="降噪原因" min-width="220" show-overflow-tooltip />
            <el-table-column prop="evidence_summary" label="证据摘要" min-width="220" show-overflow-tooltip />
            <el-table-column prop="fix_advice" label="修复建议" min-width="220" show-overflow-tooltip />
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
          <div class="meta-stack">
            <div><span>Prompt 版本</span><strong>{{ aiMeta.schema_version || '-' }}</strong></div>
            <div><span>输出等级</span><strong>{{ (aiMeta.supported_priorities || []).join(' / ') || '-' }}</strong></div>
            <div><span>脱敏字段</span><strong>{{ (aiMeta.redaction_keys || []).join(', ') || '-' }}</strong></div>
          </div>
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
            <el-table-column prop="risk_score" label="风险分" width="90" />
            <el-table-column prop="package_name" label="组件" min-width="180" show-overflow-tooltip />
            <el-table-column prop="ecosystem" label="生态" width="100" />
            <el-table-column prop="project_count" label="项目数" width="90" />
            <el-table-column prop="project_names" label="关联项目" min-width="180" show-overflow-tooltip />
            <el-table-column prop="version_count" label="版本数" width="90" />
            <el-table-column prop="vulnerability_count" label="漏洞数" width="90" />
            <el-table-column prop="eol_status" label="EOL" width="90" />
            <el-table-column prop="license_name" label="License" width="130" show-overflow-tooltip />
          </el-table>
        </div>
        <div class="panel side-panel">
          <div class="panel-head"><h2>组件图谱</h2></div>
          <div class="distribution-board">
            <div>
              <span>风险分布</span>
              <strong>{{ formatDistribution(assetDashboard.risk_distribution) }}</strong>
            </div>
            <div>
              <span>EOL 分布</span>
              <strong>{{ formatDistribution(assetDashboard.eol_distribution) }}</strong>
            </div>
            <div>
              <span>License 分布</span>
              <strong>{{ formatDistribution(assetDashboard.license_distribution) }}</strong>
            </div>
          </div>
          <div class="graph-list">
            <div v-for="node in assetGraph.nodes.slice(0, 14)" :key="node.id" class="graph-node">
              <span>{{ node.type }}</span>
              <strong>{{ node.label }}</strong>
            </div>
          </div>
        </div>
      </section>

      <section v-if="activeMenu === 'remediation'" class="workbench">
        <div class="panel">
          <div class="panel-head">
            <h2>漏洞整改闭环</h2>
            <div class="panel-actions">
              <el-select v-model="selectedProjectId" placeholder="选择项目" style="width: 220px" @change="loadProjectDetails">
                <el-option v-for="project in projects" :key="project.id" :label="project.name" :value="project.id" />
              </el-select>
              <el-button :icon="Bell" @click="checkOverdueTickets">超时提醒</el-button>
              <el-button type="primary" :icon="Document" @click="createRemediationTicket">创建工单</el-button>
            </div>
          </div>
          <div class="ai-context">
            <el-select v-model="remediationForm.vulnerability_id" placeholder="选择漏洞" style="width: 240px">
              <el-option v-for="item in vulnerabilities" :key="item.id" :label="item.cve_id || item.advisory_id" :value="item.id" />
            </el-select>
            <el-input v-model="remediationForm.assignee" placeholder="整改人" style="width: 160px" />
            <el-input v-model="remediationForm.due_date" placeholder="期限 YYYY-MM-DD" style="width: 170px" />
            <el-select v-model="remediationForm.priority" style="width: 110px">
              <el-option label="P0" value="P0" />
              <el-option label="P1" value="P1" />
              <el-option label="P2" value="P2" />
              <el-option label="P3" value="P3" />
            </el-select>
          </div>
          <el-table :data="remediationTickets" empty-text="暂无整改工单">
            <el-table-column prop="ticket_no" label="工单号" min-width="170" show-overflow-tooltip />
            <el-table-column prop="assignee" label="整改人" width="110" />
            <el-table-column prop="priority" label="优先级" width="90" />
            <el-table-column prop="status" label="状态" width="100" />
            <el-table-column prop="due_date" label="期限" width="120" />
            <el-table-column prop="verification_result" label="验证" width="90" />
            <el-table-column label="操作" width="240">
              <template #default="{ row }">
                <el-button text type="primary" @click="transitionTicket(row, '修复中')">开始</el-button>
                <el-button text type="success" @click="verifyTicket(row, 'pass')">验证通过</el-button>
                <el-button text type="warning" @click="transitionTicket(row, '已忽略')">忽略</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
        <div class="panel side-panel">
          <div class="panel-head"><h2>白名单</h2></div>
          <div class="upload-form">
            <el-button :icon="WarningFilled" @click="createWhitelist">加入白名单</el-button>
          </div>
          <el-table :data="whitelistItems" empty-text="暂无白名单" size="small">
            <el-table-column prop="reason" label="原因" min-width="130" show-overflow-tooltip />
            <el-table-column prop="expires_at" label="到期" width="110" />
          </el-table>
        </div>
      </section>

      <section v-if="activeMenu === 'devops'" class="workbench">
        <div class="panel">
          <div class="panel-head">
            <h2>DevSecOps 集成</h2>
            <div class="panel-actions">
              <el-select v-model="selectedProjectId" placeholder="选择项目" style="width: 220px">
                <el-option v-for="project in projects" :key="project.id" :label="project.name" :value="project.id" />
              </el-select>
              <el-button :icon="Connection" @click="simulateWebhook('gitlab')">GitLab</el-button>
              <el-button :icon="Connection" @click="simulateWebhook('github')">GitHub Actions</el-button>
              <el-button :icon="Connection" @click="simulateWebhook('jenkins')">Jenkins</el-button>
            </div>
          </div>
          <section class="metric-grid asset-metrics">
            <div class="metric"><span>流水线</span><strong>{{ devopsDashboard.total }}</strong></div>
            <div class="metric danger"><span>阻断</span><strong>{{ devopsDashboard.blocked_count }}</strong></div>
            <div class="metric"><span>放行</span><strong>{{ devopsDashboard.passed_count }}</strong></div>
            <div class="metric warn"><span>来源</span><strong>{{ Object.keys(devopsDashboard.by_source || {}).length }}</strong></div>
          </section>
          <el-table :data="devopsEvents" empty-text="暂无流水线事件">
            <el-table-column prop="source" label="来源" width="120" />
            <el-table-column prop="pipeline_id" label="流水线" width="130" show-overflow-tooltip />
            <el-table-column prop="ref" label="分支" width="120" show-overflow-tooltip />
            <el-table-column prop="decision" label="决策" width="100" />
            <el-table-column prop="report_id" label="报告" width="90" />
            <el-table-column prop="block_reason" label="阻断原因" min-width="240" show-overflow-tooltip />
            <el-table-column prop="created_at" label="时间" width="210" />
          </el-table>
        </div>
        <div class="panel side-panel">
          <div class="panel-head"><h2>接入方式</h2></div>
          <ul class="capability-list">
            <li>GitLab Webhook 自动触发</li>
            <li>GitHub Actions 调用 API</li>
            <li>Jenkins Pipeline 阻断发布</li>
            <li>高危漏洞按策略拦截</li>
          </ul>
        </div>
      </section>

      <section v-if="activeMenu === 'ops'" class="workbench">
        <div class="panel">
          <div class="panel-head">
            <h2>最终部署与优化</h2>
            <el-button type="primary" :icon="Refresh" @click="createBackupJob">创建备份计划</el-button>
          </div>
          <section class="metric-grid asset-metrics">
            <div class="metric"><span>HTTPS</span><strong>{{ opsConfig.https_enabled ? '开' : '关' }}</strong></div>
            <div class="metric"><span>JWT 安全</span><strong>{{ opsConfig.jwt_secure ? '开' : '关' }}</strong></div>
            <div class="metric"><span>代理</span><strong>{{ opsConfig.reverse_proxy }}</strong></div>
            <div class="metric"><span>备份</span><strong>{{ backupJobs.length }}</strong></div>
          </section>
          <el-table :data="backupJobs" empty-text="暂无备份任务">
            <el-table-column prop="scope" label="范围" width="120" />
            <el-table-column prop="target" label="目标" width="120" />
            <el-table-column prop="status" label="状态" width="110" />
            <el-table-column prop="storage_path" label="路径" min-width="260" show-overflow-tooltip />
            <el-table-column prop="created_at" label="时间" width="210" />
          </el-table>
        </div>
        <div class="panel side-panel">
          <div class="panel-head"><h2>优化项</h2></div>
          <ul class="capability-list">
            <li v-for="item in opsConfig.optimizations" :key="item">{{ item }}</li>
          </ul>
        </div>
      </section>

      <section v-if="activeMenu === 'system-config'" class="workbench">
        <div class="panel">
          <div class="panel-head">
            <h2>系统配置</h2>
            <el-button type="primary" :loading="systemConfigSaving" @click="saveSystemConfig">保存配置</el-button>
          </div>
          <el-form class="config-form" label-position="top">
            <section class="config-section">
              <h3>上传限制</h3>
              <el-form-item label="上传文件大小上限（MB）">
                <el-input-number v-model="systemConfig.upload_max_file_size_mb" :min="0" :max="102400" :step="100" />
              </el-form-item>
              <p class="sub">设置为 0 表示不在应用层限制文件大小；当前断点续传每片 512KB。</p>
            </section>
            <section class="config-section">
              <h3>大模型配置</h3>
              <el-form-item label="OpenAI API Key">
                <el-input
                  v-model="systemConfig.openai_api_key"
                  type="password"
                  show-password
                  :placeholder="systemConfig.openai_api_key_configured ? `已配置：${systemConfig.openai_api_key_masked}` : '请输入 API Key'"
                />
              </el-form-item>
              <el-form-item label="BaseURL">
                <el-input v-model="systemConfig.openai_base_url" placeholder="例如：https://api.openai.com/v1" />
              </el-form-item>
              <el-form-item label="模型">
                <el-input v-model="systemConfig.openai_model" placeholder="例如：gpt-4o-mini、deepseek-chat、qwen-plus" />
              </el-form-item>
              <el-form-item label="超时时间（毫秒）">
                <el-input-number v-model="systemConfig.openai_timeout_ms" :min="1000" :max="300000" :step="1000" />
              </el-form-item>
              <el-checkbox v-model="systemConfig.clear_openai_api_key">清空已保存的 API Key</el-checkbox>
            </section>
          </el-form>
        </div>
        <div class="panel side-panel">
          <div class="panel-head"><h2>当前状态</h2></div>
          <section class="metric-grid asset-metrics">
            <div class="metric"><span>上传上限</span><strong>{{ systemConfig.upload_max_file_size_mb || '不限' }} MB</strong></div>
            <div class="metric"><span>API Key</span><strong>{{ systemConfig.openai_api_key_configured ? '已配置' : '未配置' }}</strong></div>
            <div class="metric"><span>模型</span><strong>{{ systemConfig.openai_model || '-' }}</strong></div>
            <div class="metric"><span>超时</span><strong>{{ systemConfig.openai_timeout_ms }} ms</strong></div>
          </section>
          <ul class="capability-list">
            <li>保存后上传限制立即生效</li>
            <li>AI 降噪会优先使用页面配置</li>
            <li>API Key 不会在接口中明文返回</li>
          </ul>
        </div>
      </section>

      <section v-if="activeMenu === 'logs'" class="panel">
        <div class="panel-head">
          <h2>扫描日志</h2>
          <el-select v-model="selectedProjectId" placeholder="选择项目" style="width: 240px" @change="loadProjectDetails">
            <el-option v-for="project in projects" :key="project.id" :label="project.name" :value="project.id" />
          </el-select>
        </div>
        <el-table :data="scanTasks" empty-text="暂无扫描任务" class="task-table">
          <el-table-column prop="task_type" label="任务节点" min-width="200" />
          <el-table-column prop="engine_name" label="引擎" width="150" />
          <el-table-column prop="status" label="状态" width="130">
            <template #default="{ row }">
              <el-tag :type="taskStatusTag(row.status)" effect="plain">{{ row.status }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="progress" label="进度" width="150">
            <template #default="{ row }"><el-progress :percentage="row.progress || 0" /></template>
          </el-table-column>
          <el-table-column prop="summary" label="摘要" min-width="220" show-overflow-tooltip />
          <el-table-column prop="error_message" label="错误" min-width="180" show-overflow-tooltip />
          <el-table-column label="操作" width="120">
            <template #default="{ row }">
              <el-button v-if="row.parent_task_id && ['failed', 'timeout'].includes(row.status)" text type="primary" @click="rerunScanTask(row)">重跑</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-table :data="scanLogs" empty-text="暂无扫描日志">
          <el-table-column prop="level" label="级别" width="100" />
          <el-table-column prop="message" label="日志内容" min-width="260" show-overflow-tooltip />
          <el-table-column prop="created_at" label="时间" width="210" />
        </el-table>
      </section>
    </main>

    <el-drawer v-model="vulnerabilityDrawerVisible" size="46%" class="vuln-drawer" :title="selectedVulnerabilityTitle">
      <template v-if="selectedVulnerability">
        <section class="detail-summary">
          <el-tag :type="priorityTag(selectedVulnerability.risk_priority)">{{ selectedVulnerability.risk_priority || 'Review' }}</el-tag>
          <el-tag :type="severityTag(selectedVulnerability.severity)">{{ severityLabel(selectedVulnerability.severity) }}</el-tag>
          <el-tag :type="confidenceTag(selectedVulnerability.confidence_score, selectedVulnerability.needs_human_review)" effect="plain">
            可信度 {{ Math.round((selectedVulnerability.confidence_score || 0) * 100) }}%
          </el-tag>
          <p>{{ selectedVulnerability.description || '暂无漏洞摘要' }}</p>
        </section>

        <section class="detail-grid">
          <div><span>影响组件</span><strong>{{ selectedVulnerability.package_name }}</strong></div>
          <div><span>当前版本</span><strong>{{ selectedVulnerability.package_version || '-' }}</strong></div>
          <div><span>受影响版本范围</span><strong>{{ selectedVulnerability.version_range || selectedVulnerability.match_reason || '-' }}</strong></div>
          <div><span>修复版本</span><strong>{{ selectedVulnerability.fixed_version || '待确认' }}</strong></div>
          <div><span>相关项目</span><strong>{{ selectedProject?.name || '-' }}</strong></div>
          <div><span>发布时间</span><strong>{{ selectedVulnerability.published_at_text || '-' }}</strong></div>
        </section>

        <section class="detail-section">
          <h3>匹配证据</h3>
          <p>{{ selectedVulnerability.matched_by || '未知来源' }}：{{ selectedVulnerability.match_reason || '暂无匹配说明' }}</p>
          <code>{{ selectedComponent?.evidence_file || selectedComponent?.source_path || '-' }}{{ selectedComponent?.evidence_line ? `:${selectedComponent.evidence_line}` : '' }} {{ selectedComponent?.evidence_text || '' }}</code>
        </section>

        <section class="detail-section">
          <h3>可达性证据</h3>
          <p>{{ reachabilityLabel(selectedVulnerability.reachability_status) }}：{{ selectedVulnerability.call_path_summary || '暂无调用路径摘要' }}</p>
          <code>{{ selectedVulnerability.reachability_evidence || '未发现调用证据' }}</code>
          <small>入口点：{{ selectedVulnerability.entry_points || '-' }}；相关文件：{{ selectedVulnerability.related_files || '-' }}</small>
        </section>

        <section class="detail-section">
          <h3>AI 降噪结果</h3>
          <template v-if="selectedAiResult">
            <p>{{ selectedAiResult.ai_priority }} / 置信度 {{ Math.round((selectedAiResult.confidence || 0) * 100) }}%：{{ selectedAiResult.reason || selectedAiResult.noise_reason }}</p>
            <code>{{ selectedAiResult.evidence_summary || selectedAiResult.risk_explanation }}</code>
          </template>
          <p v-else>暂无 AI 降噪结论，可在“AI 降噪”中批量分析。</p>
        </section>

        <section class="detail-section">
          <h3>处置建议</h3>
          <p>{{ selectedVulnerability.remediation_type }}：{{ selectedVulnerability.priority_reason || selectedVulnerability.business_impact || '建议人工复核后处理' }}</p>
          <code>{{ fixCommand(selectedVulnerability) }}</code>
          <small>建议期限：{{ selectedVulnerability.suggested_deadline }}</small>
        </section>

        <section class="detail-section">
          <h3>历史处置记录</h3>
          <div v-if="vulnerabilityHistory.length" class="history-list">
            <div v-for="item in vulnerabilityHistory" :key="item.id || `${item.ticket_id}-${item.created_at}`">
              <span>{{ item.created_at || item.updated_at }}</span>
              <strong>{{ item.to_status || item.status || item.human_status }}</strong>
              <p>{{ item.comment || item.ticket_no || item.manual_review_reason || '页面记录' }}</p>
            </div>
          </div>
          <p v-else>暂无处置记录。</p>
        </section>
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { Bell, Connection, DataAnalysis, Delete, Document, Files, Grid, MagicStick, Refresh, Search, Setting, Share, UploadFilled, WarningFilled } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { apiUrl, requestJson, resumableUploadWithProgress, uploadArchiveWithProgress, uploadImageTarWithProgress } from './api'

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
const systemConfigSaving = ref(false)
const deletingProjectId = ref(null)
const taskPollingPaused = ref(false)
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
const scanTasks = ref([])
let projectDetailsLoading = false
let taskRefreshTimer = null
let taskPollingGatewayWarningShown = false
const scanCompleteness = reactive({
  project_id: 0,
  has_standard_manifest: false,
  scan_mode: '',
  component_count: 0,
  high_confidence_count: 0,
  medium_confidence_count: 0,
  low_confidence_count: 0,
  unknown_version_count: 0,
  manual_confirm_count: 0,
  fallback_enabled: false,
  message: '',
  suggestions: [],
})
const dependencyTrackStatus = reactive({
  local_project_id: 0,
  dependency_track_project_uuid: '',
  dependency_track_project_name: '',
  dependency_track_project_version: '',
  bom_uploaded_at: '',
  last_fetch_at: '',
  last_metrics_json: '{}',
  last_status: 'not_linked',
})
const vulnerabilities = ref([])
const vulnerabilityFilter = ref('all')
const vulnerabilityDrawerVisible = ref(false)
const selectedVulnerability = ref(null)
const vulnerabilityHistory = ref([])
const projectResultView = ref('management')
const vulnerabilityTrend = ref([])
const reports = ref([])
const sboms = ref([])
const imageScans = ref([])
const riskSnapshots = ref([])
const riskAlerts = ref([])
const riskTrend = ref([])
const riskChanges = ref([])
const aiResults = ref([])
const aiMeta = ref({ schema_version: '', supported_priorities: [], redaction_keys: [] })
const assetComponents = ref([])
const assetGraph = ref({ nodes: [], edges: [] })
const assetSearch = ref('')
const remediationTickets = ref([])
const whitelistItems = ref([])
const devopsEvents = ref([])
const backupJobs = ref([])
const reportFormat = ref('docx')
const reportMetadataDialogVisible = ref(false)
const sbomFormat = ref('cyclonedx')
const todayText = () => new Date().toISOString().slice(0, 10).replaceAll('-', '.')
const reportMetadata = reactive({
  client_name: '',
  client_address: '',
  contact_name: '',
  contact_phone: '',
  contact_email: '',
  organization_name: '',
  audit_address: '',
  auditor_name: '',
  reviewer_name: '',
  quality_reviewer_name: '',
  accepted_date: todayText(),
  audit_start_date: todayText(),
  audit_end_date: todayText(),
  version_number: 'V1.0',
})
const resultViewOptions = [
  { label: '管理层视图', value: 'management' },
  { label: '安全人员视图', value: 'security' },
  { label: '研发人员视图', value: 'developer' },
]
const quickFilters = reactive({
  p01: false,
  hideDev: false,
  hideTest: false,
  publicOnly: false,
  reachableOnly: false,
  kevOnly: false,
  pocOnly: false,
  reviewOnly: false,
  falsePositiveOnly: false,
})
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
const remediationForm = reactive({
  vulnerability_id: null,
  assignee: '',
  due_date: '',
  priority: 'P2',
})
const devopsDashboard = reactive({
  total: 0,
  blocked_count: 0,
  passed_count: 0,
  by_source: {},
})
const opsConfig = reactive({
  https_enabled: true,
  jwt_secure: true,
  reverse_proxy: 'nginx',
  backup_root: '',
  optimizations: [],
  monitoring: [],
})
const systemConfig = reactive({
  upload_max_file_size_mb: 2048,
  upload_max_file_size_bytes: 2048 * 1024 * 1024,
  openai_api_key: '',
  openai_api_key_configured: false,
  openai_api_key_masked: '',
  openai_base_url: 'https://api.openai.com/v1',
  openai_model: 'gpt-4o-mini',
  openai_timeout_ms: 30000,
  clear_openai_api_key: false,
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

const selectedProject = computed(() => projects.value.find((project) => project.id === selectedProjectId.value) || null)

const projectIsInternetExposed = computed(() => {
  const text = `${selectedProject.value?.name || ''} ${selectedProject.value?.scan_note || ''}`.toLowerCase()
  return /公网|internet|public|external|prod|生产/.test(text)
})

const componentForVulnerability = (item) =>
  components.value.find((component) => component.id === item?.component_id)
  || components.value.find((component) => component.package_name === item?.package_name && component.package_version === item?.package_version)
  || null

const selectedComponent = computed(() => componentForVulnerability(selectedVulnerability.value))

const selectedAiResult = computed(() => aiResults.value.find((item) => item.vulnerability_id === selectedVulnerability.value?.id) || null)

const selectedVulnerabilityTitle = computed(() => {
  if (!selectedVulnerability.value) return '漏洞详情'
  return `${selectedVulnerability.value.cve_id || selectedVulnerability.value.advisory_id || '漏洞'} · ${selectedVulnerability.value.package_name}`
})

const isDevDependency = (item) => {
  const component = componentForVulnerability(item)
  const text = `${component?.scope || ''} ${component?.dependency_type || ''}`.toLowerCase()
  return text.includes('dev') || text.includes('development')
}

const isTestDependency = (item) => {
  const component = componentForVulnerability(item)
  const text = `${component?.scope || ''} ${component?.dependency_type || ''}`.toLowerCase()
  return text.includes('test') || text.includes('pytest') || text.includes('spec')
}

const isReviewVulnerability = (item) => item.needs_human_review || item.match_status === 'unknown' || item.risk_priority === 'Review'

const isFalsePositiveCandidate = (item) => item.false_positive_possibility === 'high' || item.risk_priority === 'Ignore'

const filteredVulnerabilities = computed(() => {
  return vulnerabilities.value.filter((item) => {
    const confidence = Number(item.confidence_score || 0)
    if (vulnerabilityFilter.value === 'high' && !(confidence >= 0.85 && !item.needs_human_review)) return false
    if (vulnerabilityFilter.value === 'medium' && !(confidence >= 0.55 && confidence < 0.85 && !item.needs_human_review)) return false
    if (vulnerabilityFilter.value === 'low' && !(confidence < 0.55 && !item.needs_human_review)) return false
    if (vulnerabilityFilter.value === 'review' && !isReviewVulnerability(item)) return false
    if (vulnerabilityFilter.value === 'false_positive' && !isFalsePositiveCandidate(item)) return false
    if (quickFilters.p01 && !['P0', 'P1'].includes(item.risk_priority)) return false
    if (quickFilters.hideDev && isDevDependency(item)) return false
    if (quickFilters.hideTest && isTestDependency(item)) return false
    if (quickFilters.publicOnly && !projectIsInternetExposed.value) return false
    if (quickFilters.reachableOnly && item.reachability_status !== 'reachable') return false
    if (quickFilters.kevOnly && !item.cisa_kev) return false
    if (quickFilters.pocOnly && !item.has_poc) return false
    if (quickFilters.reviewOnly && !isReviewVulnerability(item)) return false
    if (quickFilters.falsePositiveOnly && !isFalsePositiveCandidate(item)) return false
    return true
  })
})

const trustedVulnerabilityCount = computed(() => vulnerabilities.value.filter((item) => item.match_status === 'affected' && !item.needs_human_review).length)

const p01Count = computed(() => vulnerabilities.value.filter((item) => ['P0', 'P1'].includes(item.risk_priority)).length)

const reviewCount = computed(() => vulnerabilities.value.filter(isReviewVulnerability).length)

const remediationProgress = computed(() => {
  if (!remediationTickets.value.length) return 0
  const closed = remediationTickets.value.filter((item) => ['已修复', '已忽略'].includes(item.status)).length
  return Math.round((closed / remediationTickets.value.length) * 100)
})

const managementSummary = computed(() => {
  if (p01Count.value > 0) {
    return {
      level: '高',
      title: '建议整改后再上线',
      description: `当前项目存在 ${p01Count.value} 个 P0/P1 风险，建议优先完成修复验证。`,
    }
  }
  if (reviewCount.value > 0) {
    return {
      level: '中',
      title: '存在待确认风险',
      description: `当前有 ${reviewCount.value} 个漏洞需要人工复核，建议安全人员确认后再决策。`,
    }
  }
  return {
    level: '低',
    title: '未发现阻断风险',
    description: '当前未发现 P0/P1 已确认漏洞，可按常规整改节奏推进。',
  }
})

const evidenceCoverage = computed(() => ({
  match: vulnerabilities.value.filter((item) => item.match_reason || item.matched_by).length,
  reachability: vulnerabilities.value.filter((item) => item.reachability_evidence).length,
}))

const developerFixItems = computed(() => filteredVulnerabilities.value.filter((item) => item.fixed_version || item.risk_priority !== 'Ignore').slice(0, 8))

const toggleQuickFilter = (key) => {
  quickFilters[key] = !quickFilters[key]
}

const resetQuickFilters = () => {
  Object.keys(quickFilters).forEach((key) => {
    quickFilters[key] = false
  })
  vulnerabilityFilter.value = 'all'
}

const priorityCount = (level) => vulnerabilities.value.filter((item) => item.risk_priority === level).length

const priorityTopReason = (level) => {
  const item = vulnerabilities.value.find((row) => row.risk_priority === level)
  return item?.priority_reason || '暂无代表性风险'
}

const trendHeight = (value) => `${Math.max(10, Math.min(76, Number(value || 0) * 12))}px`

const componentSource = (item) => {
  const component = componentForVulnerability(item)
  if (!component) return ''
  return component.evidence_file || component.source_path || component.source_file || ''
}

const fixCommand = (item) => {
  const name = item?.package_name || 'package'
  const fixed = item?.fixed_version || '安全版本'
  const ecosystem = String(item?.ecosystem || componentForVulnerability(item)?.ecosystem || '').toLowerCase()
  if (['maven', 'java'].includes(ecosystem)) return `mvn versions:use-dep-version -Dincludes=${name} -DdepVersion=${fixed}`
  if (['npm', 'node', 'javascript'].includes(ecosystem)) return `npm install ${name}@${fixed}`
  if (['pypi', 'python'].includes(ecosystem)) return `pip install ${name}==${fixed}`
  if (['go', 'golang'].includes(ecosystem)) return `go get ${name}@${fixed}`
  if (['docker', 'container'].includes(ecosystem)) return `更新 Dockerfile 基础镜像或组件 ${name}:${fixed}`
  return `升级 ${name} 到 ${fixed} 后重新扫描`
}

const openVulnerabilityDetail = async (row) => {
  selectedVulnerability.value = row
  vulnerabilityDrawerVisible.value = true
  vulnerabilityHistory.value = []
  const relatedTickets = remediationTickets.value.filter((ticket) => ticket.vulnerability_id === row.id)
  vulnerabilityHistory.value = relatedTickets.map((ticket) => ({
    id: `ticket-${ticket.id}`,
    created_at: ticket.updated_at || ticket.created_at,
    status: ticket.status,
    ticket_no: `${ticket.ticket_no} / ${ticket.assignee}`,
  }))
  const ai = aiResults.value.find((item) => item.vulnerability_id === row.id)
  if (ai?.human_status && ai.human_status !== 'pending') {
    vulnerabilityHistory.value.push({
      id: `ai-${ai.id}`,
      created_at: ai.confirmed_at || ai.created_at,
      human_status: `AI 人工确认：${ai.human_status}`,
      manual_review_reason: ai.manual_review_reason || ai.reason,
    })
  }
  for (const ticket of relatedTickets) {
    try {
      const events = await requestJson(`/api/sca/remediation/tickets/${ticket.id}/events`)
      vulnerabilityHistory.value.push(...(events || []))
    } catch {
      // 历史事件加载失败不影响详情查看。
    }
  }
}

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

const priorityTag = (priority) => ({
  P0: 'danger',
  P1: 'danger',
  P2: 'warning',
  P3: 'success',
  Review: 'info',
  Ignore: 'info',
}[priority] || 'info')

const confidenceTag = (confidence, review) => {
  if (review) return 'warning'
  if (confidence >= 0.85) return 'success'
  if (confidence >= 0.55) return 'warning'
  return 'info'
}

const componentConfidenceTag = (level) => ({
  High: 'success',
  'Medium-High': 'success',
  Medium: 'warning',
  Low: 'info',
  Review: 'warning',
}[level] || 'info')

const taskStatusTag = (status) => ({
  completed: 'success',
  success: 'success',
  running: 'primary',
  pending: 'info',
  queued: 'info',
  skipped: 'info',
  partial_completed: 'warning',
  failed: 'danger',
  timeout: 'danger',
}[status] || 'info')

const reachabilityLabel = (status) => ({
  reachable: '可达',
  possibly_reachable: '可能可达',
  not_found: '未发现调用证据',
  unknown: '未知',
}[status] || status || '未知')

const reachabilityTag = (status) => ({
  reachable: 'danger',
  possibly_reachable: 'warning',
  not_found: 'info',
  unknown: 'info',
}[status] || 'info')

const trendWidth = (value, total) => {
  if (!total) return '0%'
  return `${Math.max(4, Math.round((value / total) * 100))}%`
}

const hasActiveProjectTasks = computed(() => scanTasks.value.some((task) => (
  ['pending', 'queued', 'running'].includes(task.status)
  || task.task_type === 'vulnerability_query_task' && ['pending', 'queued', 'running'].includes(task.status)
)))

const formatDistribution = (value) => {
  const entries = Object.entries(value || {})
  if (!entries.length) return '-'
  return entries.map(([key, count]) => `${key}:${count}`).join(' / ')
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

const clearProjectDetails = () => {
  components.value = []
  dependencyTree.value = []
  scanLogs.value = []
  scanTasks.value = []
  vulnerabilities.value = []
  vulnerabilityTrend.value = []
  reports.value = []
  sboms.value = []
  riskSnapshots.value = []
  riskAlerts.value = []
  riskChanges.value = []
  riskTrend.value = []
  aiResults.value = []
  remediationTickets.value = []
  whitelistItems.value = []
  selectedVulnerability.value = null
  vulnerabilityDrawerVisible.value = false
  vulnerabilityHistory.value = []
  Object.assign(vulnerabilityStats, {
    total: 0,
    by_severity: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
    poc_count: 0,
    exploited_count: 0,
    average_cvss: 0,
  })
  Object.assign(scanCompleteness, {
    project_id: 0,
    has_standard_manifest: false,
    scan_mode: '',
    component_count: 0,
    high_confidence_count: 0,
    medium_confidence_count: 0,
    low_confidence_count: 0,
    unknown_version_count: 0,
    manual_confirm_count: 0,
    fallback_enabled: false,
    message: '',
    suggestions: [],
  })
  Object.assign(dependencyTrackStatus, {
    local_project_id: 0,
    dependency_track_project_uuid: '',
    dependency_track_project_name: '',
    dependency_track_project_version: '',
    bom_uploaded_at: '',
    last_fetch_at: '',
    last_metrics_json: '{}',
    last_status: 'not_linked',
  })
}

const loadProjects = async () => {
  projects.value = (await requestJson('/api/sca/projects')) || []
  if (selectedProjectId.value && !projects.value.some((project) => project.id === selectedProjectId.value)) {
    selectedProjectId.value = projects.value[0]?.id || null
  } else if (!selectedProjectId.value && projects.value.length) {
    selectedProjectId.value = projects.value[0].id
  }
  if (!selectedProjectId.value) clearProjectDetails()
}

const loadUploads = async () => {
  const data = await requestJson('/api/sca/uploads')
  uploads.value = data?.items || []
}

const loadProjectDetails = async () => {
  if (!selectedProjectId.value) return
  if (projectDetailsLoading) return
  projectDetailsLoading = true
  try {
    components.value = (await requestJson(`/api/sca/projects/${selectedProjectId.value}/components`)) || []
    dependencyTree.value = (await requestJson(`/api/sca/projects/${selectedProjectId.value}/dependency-tree`)) || []
    const completeness = await requestJson(`/api/sca/projects/${selectedProjectId.value}/scan-completeness`)
    if (completeness) Object.assign(scanCompleteness, completeness)
    const dtrack = await requestJson(`/api/sca/projects/${selectedProjectId.value}/dependency-track`)
    if (dtrack) Object.assign(dependencyTrackStatus, dtrack)
    scanTasks.value = (await requestJson(`/api/sca/projects/${selectedProjectId.value}/scan-tasks`)) || []
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
    const tickets = await requestJson(`/api/sca/projects/${selectedProjectId.value}/remediation/tickets`)
    remediationTickets.value = tickets?.items || []
    whitelistItems.value = (await requestJson(`/api/sca/projects/${selectedProjectId.value}/remediation/whitelist`)) || []
    taskPollingPaused.value = false
    taskPollingGatewayWarningShown = false
  } finally {
    projectDetailsLoading = false
  }
}

const manualVersion = async (row) => {
  try {
    const { value } = await ElMessageBox.prompt(`为 ${row.package_name} 补录实际版本`, '人工补录版本', {
      confirmButtonText: '保存',
      cancelButtonText: '取消',
      inputValue: row.package_version === 'unknown' ? '' : row.package_version,
      inputPlaceholder: '例如：2.14.1',
    })
    const payload = {
      version: value,
      package_manager: row.package_manager || '',
      purl: row.purl || '',
      note: '人工补录版本，建议重新执行漏洞匹配',
    }
    await requestJson(`/api/sca/components/${row.id}/manual-version`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
    ElMessage.success('已补录版本，可重新查询漏洞')
    await loadProjectDetails()
  } catch (err) {
    if (err !== 'cancel') {
      ElMessage.error(err?.message || '补录失败')
    }
  }
}

const rerunScanTask = async (row) => {
  await requestJson(`/api/sca/scan-tasks/${row.id}/rerun`, { method: 'POST' })
  ElMessage.success('已标记为待重跑')
  await loadProjectDetails()
}

const refreshAll = async () => {
  taskPollingPaused.value = false
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
      maxUploadSizeMb: systemConfig.upload_max_file_size_mb,
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

const deleteProject = async (row) => {
  try {
    await ElMessageBox.confirm(
      `确认从整个 SCA 系统中删除项目“${row.name}”？该操作会删除项目、上传文件、依赖、漏洞、扫描任务、报告、SBOM、监测、AI 降噪和整改记录，且不可恢复。`,
      '全系统删除项目',
      {
        type: 'warning',
        confirmButtonText: '全系统删除',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger',
      },
    )
    deletingProjectId.value = row.id
    const deletedSelected = selectedProjectId.value === row.id
    if (deletedSelected) {
      selectedProjectId.value = null
      clearProjectDetails()
    }
    await requestJson(`/api/sca/projects/${row.id}`, { method: 'DELETE' })
    ElMessage.success('项目已从整个系统删除')
    await Promise.all([loadOverview(), loadProjects(), loadUploads()])
    await loadProjectDetails()
  } catch (err) {
    if (err !== 'cancel') {
      ElMessage.error(err?.message || '删除项目失败')
    }
  } finally {
    deletingProjectId.value = null
  }
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
  taskPollingPaused.value = false
  try {
    const data = await requestJson(`/api/sca/projects/${selectedProjectId.value}/vulnerabilities/query`, { method: 'POST' })
    await loadProjectDetails()
    ElMessage.success(data?.task_id ? `漏洞查询任务已入队：${data.task_id}` : '漏洞查询任务已入队')
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
  reportMetadataDialogVisible.value = true
}

const submitReport = async () => {
  if (!selectedProjectId.value) {
    ElMessage.warning('请先选择项目')
    return
  }
  reportCreating.value = true
  try {
    await requestJson(`/api/sca/projects/${selectedProjectId.value}/reports`, {
      method: 'POST',
      body: JSON.stringify({ format: reportFormat.value, metadata: reportMetadata }),
    })
    await loadProjectDetails()
    reportMetadataDialogVisible.value = false
    ElMessage.success('报告已生成')
  } catch (err) {
    ElMessage.error(err?.message || '报告生成失败')
  } finally {
    reportCreating.value = false
  }
}

const downloadReport = (row) => {
  window.open(apiUrl(`/api/sca/reports/${row.id}/download`), '_blank')
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

const loadAiMeta = async () => {
  const meta = await requestJson('/api/sca/ai-triage/meta')
  if (meta) aiMeta.value = meta
}

const loadDevops = async () => {
  const data = await requestJson('/api/sca/devops/dashboard')
  if (data) Object.assign(devopsDashboard, data)
  const events = await requestJson('/api/sca/devops/events')
  devopsEvents.value = events?.items || []
}

const loadOps = async () => {
  const config = await requestJson('/api/sca/ops/config')
  if (config) Object.assign(opsConfig, config)
  const backups = await requestJson('/api/sca/ops/backups')
  backupJobs.value = backups?.items || []
}

const applySystemConfig = (config) => {
  if (!config) return
  Object.assign(systemConfig, {
    ...config,
    openai_api_key: '',
    clear_openai_api_key: false,
  })
}

const loadSystemConfig = async () => {
  const config = await requestJson('/api/sca/system-config')
  applySystemConfig(config)
}

const saveSystemConfig = async () => {
  systemConfigSaving.value = true
  try {
    const payload = {
      upload_max_file_size_mb: Number(systemConfig.upload_max_file_size_mb || 0),
      openai_api_key: systemConfig.openai_api_key || '',
      openai_base_url: systemConfig.openai_base_url || 'https://api.openai.com/v1',
      openai_model: systemConfig.openai_model || 'gpt-4o-mini',
      openai_timeout_ms: Number(systemConfig.openai_timeout_ms || 30000),
      clear_openai_api_key: Boolean(systemConfig.clear_openai_api_key),
    }
    const saved = await requestJson('/api/sca/system-config', {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
    applySystemConfig(saved)
    ElMessage.success('系统配置已保存')
  } catch (err) {
    ElMessage.error(err?.message || '系统配置保存失败')
  } finally {
    systemConfigSaving.value = false
  }
}

const createRemediationTicket = async () => {
  if (!selectedProjectId.value || !remediationForm.vulnerability_id) {
    ElMessage.warning('请先选择项目和漏洞')
    return
  }
  if (!remediationForm.assignee || !remediationForm.due_date) {
    ElMessage.warning('请填写整改人和修复期限')
    return
  }
  await requestJson(`/api/sca/projects/${selectedProjectId.value}/remediation/tickets`, {
    method: 'POST',
    body: JSON.stringify(remediationForm),
  })
  await loadProjectDetails()
  ElMessage.success('整改工单已创建')
}

const checkOverdueTickets = async () => {
  const result = await requestJson('/api/sca/remediation/overdue/check', { method: 'POST' })
  await loadProjectDetails()
  ElMessage.success(`超时检查完成：超时 ${result?.overdue || 0}，新增提醒 ${result?.notified || 0}`)
}

const transitionTicket = async (row, status) => {
  await requestJson(`/api/sca/remediation/tickets/${row.id}/transition`, {
    method: 'POST',
    body: JSON.stringify({ status, comment: '页面操作' }),
  })
  await loadProjectDetails()
  ElMessage.success('状态已更新')
}

const verifyTicket = async (row, verificationResult) => {
  await requestJson(`/api/sca/remediation/tickets/${row.id}/verify`, {
    method: 'POST',
    body: JSON.stringify({ verification_result: verificationResult, comment: '修复验证' }),
  })
  await loadProjectDetails()
  ElMessage.success('验证完成')
}

const createWhitelist = async () => {
  if (!selectedProjectId.value || !remediationForm.vulnerability_id) {
    ElMessage.warning('请先选择漏洞')
    return
  }
  await requestJson(`/api/sca/projects/${selectedProjectId.value}/remediation/whitelist`, {
    method: 'POST',
    body: JSON.stringify({ vulnerability_id: remediationForm.vulnerability_id, reason: '业务确认可忽略', expires_at: '' }),
  })
  await loadProjectDetails()
  ElMessage.success('已加入白名单')
}

const simulateWebhook = async (source) => {
  if (!selectedProjectId.value) {
    ElMessage.warning('请先选择项目')
    return
  }
  const path = source === 'github' ? 'github' : source
  await requestJson(`/api/sca/devops/webhooks/${path}`, {
    method: 'POST',
    body: JSON.stringify({
      project_id: selectedProjectId.value,
      pipeline_id: `${source}-${Date.now()}`,
      ref: 'main',
      commit_sha: String(Date.now()),
    }),
  })
  await loadDevops()
  ElMessage.success('流水线事件已记录')
}

const createBackupJob = async () => {
  await requestJson('/api/sca/ops/backups', {
    method: 'POST',
    body: JSON.stringify({ scope: 'database', target: 'local' }),
  })
  await loadOps()
  ElMessage.success('备份计划已创建')
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
onMounted(() => {
  taskRefreshTimer = window.setInterval(async () => {
    if (!selectedProjectId.value || taskPollingPaused.value || !hasActiveProjectTasks.value) return
    try {
      await loadProjectDetails()
      await loadUploads()
    } catch (err) {
      if (err?.isGatewayError) {
        taskPollingPaused.value = true
        if (!taskPollingGatewayWarningShown) {
          ElMessage.warning('SCA API 网关或后端暂不可用，已暂停扫描状态自动刷新，请刷新页面或稍后重试。')
          taskPollingGatewayWarningShown = true
        }
      }
      console.warn('[SCA] refresh active tasks failed', err?.message || err)
    }
  }, 5000)
})
onUnmounted(() => {
  if (taskRefreshTimer) window.clearInterval(taskRefreshTimer)
})
onMounted(loadAiMeta)
onMounted(loadImageScans)
onMounted(loadAssets)
onMounted(loadDevops)
onMounted(loadOps)
onMounted(loadSystemConfig)
</script>
