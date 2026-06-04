import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.join(import.meta.dirname, '..')
const appSource = fs.readFileSync(path.join(root, 'src', 'App.vue'), 'utf8')
const apiSource = fs.readFileSync(path.join(root, 'src', 'api.js'), 'utf8')
const nginxSource = fs.readFileSync(path.join(root, 'nginx.conf'), 'utf8')
const deployNginxSource = fs.readFileSync(path.join(root, '..', 'deploy', 'nginx', 'sca-platform.conf'), 'utf8')

test('system config menu exposes upload and OpenAI settings', () => {
  assert.match(appSource, /index="system-config"/)
  assert.match(appSource, />系统配置</)
  assert.match(appSource, /upload_max_file_size_mb/)
  assert.match(appSource, /openai_base_url/)
  assert.match(appSource, /openai_model/)
  assert.match(appSource, /\/api\/sca\/system-config/)
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
  }
})

test('api client reports non-json proxy errors without leaking JSON parse syntax', () => {
  assert.match(apiSource, /content-type/)
  assert.match(apiSource, /服务返回了非 JSON 响应/)
  assert.match(apiSource, /parseMaybeJson\(text\)/)
})
