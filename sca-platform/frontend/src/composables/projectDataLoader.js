import { requestJson } from '../api.js'

export const loadProjectDetailRequests = (projectId) => Promise.allSettled([
  requestJson(`/api/sca/projects/${projectId}/components`),
  requestJson(`/api/sca/projects/${projectId}/dependency-tree`),
  requestJson(`/api/sca/projects/${projectId}/scan-completeness`),
  requestJson(`/api/sca/projects/${projectId}/dependency-track`),
  requestJson(`/api/sca/projects/${projectId}/scan-tasks`),
  requestJson(`/api/sca/projects/${projectId}/scan-logs`),
  requestJson(`/api/sca/projects/${projectId}/vulnerabilities`),
  requestJson(`/api/sca/projects/${projectId}/vulnerabilities/stats`),
  requestJson(`/api/sca/projects/${projectId}/vulnerabilities/trend`),
  requestJson(`/api/sca/projects/${projectId}/reports`),
  requestJson(`/api/sca/projects/${projectId}/sbom`),
  requestJson(`/api/sca/projects/${projectId}/risk-monitor/snapshots`),
  requestJson(`/api/sca/projects/${projectId}/risk-monitor/alerts`),
  requestJson(`/api/sca/projects/${projectId}/risk-monitor/changes`),
  requestJson(`/api/sca/projects/${projectId}/risk-monitor/trend`),
  requestJson(`/api/sca/projects/${projectId}/ai-triage/results`),
  requestJson(`/api/sca/projects/${projectId}/remediation/tickets`),
  requestJson(`/api/sca/projects/${projectId}/remediation/whitelist`),
])
