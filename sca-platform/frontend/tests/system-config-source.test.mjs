import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.join(import.meta.dirname, '..')
const appSource = fs.readFileSync(path.join(root, 'src', 'App.vue'), 'utf8')
const apiSource = fs.readFileSync(path.join(root, 'src', 'api.js'), 'utf8')
const nginxSource = fs.readFileSync(path.join(root, 'nginx.conf'), 'utf8')
const deployNginxSource = fs.readFileSync(path.join(root, '..', 'deploy', 'nginx', 'sca-platform.conf'), 'utf8')
const composeSource = fs.readFileSync(path.join(root, '..', '..', 'docker-compose.yml'), 'utf8')

test('system config menu exposes upload and OpenAI settings', () => {
  assert.match(appSource, /index="system-config"/)
  assert.match(appSource, />系统配置</)
  assert.match(appSource, /upload_max_file_size_mb/)
  assert.match(appSource, /openai_base_url/)
  assert.match(appSource, /openai_model/)
  assert.match(appSource, /\/api\/sca\/system-config/)
  assert.match(appSource, /testOpenaiConfig/)
  assert.match(appSource, /测试模型/)
  assert.match(appSource, /\/api\/sca\/system-config\/test-openai/)
  assert.match(appSource, /dependency_track_url/)
  assert.match(appSource, /dependency_track_api_key/)
})

test('uploads use runtime config and nginx allows configured request bodies', () => {
  assert.match(apiSource, /chunkSize = 512 \* 1024/)
  assert.match(appSource, /systemConfig\.upload_max_file_size_mb/)
  assert.match(nginxSource, /client_max_body_size 0;/)
})

test('nginx re-resolves sca-api after backend container recreation', () => {
  for (const source of [nginxSource, deployNginxSource]) {
    assert.match(source, /resolver 127\.0\.0\.11/)
    assert.match(source, /set \$sca_api_upstream http:\/\/sca-api:5191;/)
    assert.match(source, /proxy_pass \$sca_api_upstream;/)
    assert.match(source, /proxy_connect_timeout 300s;/)
    assert.match(source, /proxy_send_timeout 300s;/)
    assert.match(source, /proxy_read_timeout 300s;/)
    assert.match(source, /send_timeout 300s;/)
  }
})

test('api client reports non-json proxy errors without leaking JSON parse syntax', () => {
  assert.match(apiSource, /content-type/)
  assert.match(apiSource, /服务返回了非 JSON 响应/)
  assert.match(apiSource, /parseMaybeJson\(text\)/)
})

test('project task status refreshes while asynchronous jobs are active', () => {
  assert.match(appSource, /hasActiveProjectTasks/)
  assert.match(appSource, /setInterval/)
  assert.match(appSource, /clearInterval/)
  assert.match(appSource, /vulnerability_query_task/)
  assert.match(appSource, /task_id/)
})

test('project selectors hide historical project noise and reports can be deleted', () => {
  assert.match(appSource, /projectOptions/)
  assert.match(appSource, /latestProject/)
  assert.match(appSource, /v-for="project in projectOptions"/)
  assert.match(appSource, /deleteReport/)
  assert.match(appSource, /api\/sca\/reports\/\$\{row\.id\}/)
})

test('license catalog can be synchronized and displayed', () => {
  assert.match(appSource, /index="licenses"/)
  assert.match(appSource, />许可证库</)
  assert.match(appSource, /licenseCatalog/)
  assert.match(appSource, /syncLicenseCatalog/)
  assert.match(appSource, /\/api\/sca\/licenses\/sync/)
  assert.match(appSource, /\/api\/sca\/licenses/)
  assert.match(appSource, /prop="license_name" label="License"/)
})

test('gateway json errors prefer backend detail over generic proxy text', () => {
  assert.match(apiSource, /data\?\.message \|\| data\?\.detail \|\| data\?\.error \|\| \(GATEWAY_ERROR_STATUSES\.has\(status\)/)
})

test('dependency track env works with prefixed and standalone variables', () => {
  assert.match(composeSource, /DEPENDENCY_TRACK_API_KEY: \$\{SCA_DEPENDENCY_TRACK_API_KEY:-\$\{DEPENDENCY_TRACK_API_KEY:-\}\}/)
  assert.match(composeSource, /DEPENDENCY_TRACK_TIMEOUT: \$\{SCA_DEPENDENCY_TRACK_TIMEOUT:-\$\{DEPENDENCY_TRACK_TIMEOUT:-1800\}\}/)
})

test('tables expose default pagination controls', () => {
  assert.match(appSource, /const pageSizeOptions = \[10, 20, 50\]/)
  assert.match(appSource, /const paginateRows = /)
  assert.match(appSource, /:page-sizes="pageSizeOptions"/)
  assert.match(appSource, /:data="pagedProjects"/)
  assert.match(appSource, /:data="pagedUploads"/)
  assert.match(appSource, /:data="pagedComponents"/)
  assert.match(appSource, /:data="pagedFilteredVulnerabilities"/)
  assert.match(appSource, /:data="pagedAiResults"/)
  assert.match(appSource, /:data="pagedLicenseCatalog"/)
})
