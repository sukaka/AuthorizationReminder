const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..', '..');
const compose = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
const readOptional = (filePath) => fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
const backendDockerfile = readOptional(path.join(root, 'big-screen-center', 'backend', 'Dockerfile'));
const frontendDockerfile = readOptional(path.join(root, 'big-screen-center', 'frontend', 'Dockerfile'));
const nginx = readOptional(path.join(root, 'big-screen-center', 'frontend', 'nginx.conf'));
const bigScreenApiBlock = compose.split('\n  big-screen-api:')[1]?.split('\n  web-big-screen:')[0] || '';
const webBigScreenBlock = compose.split('\n  web-big-screen:')[1]?.split('\n  dependency-track-apiserver:')[0] || '';

test('compose registers unified big-screen backend and frontend services', () => {
  assert.match(compose, /^  big-screen-api:/m);
  assert.match(compose, /^  web-big-screen:/m);
  assert.match(bigScreenApiBlock, /args: \*build_args_node_bookworm_slim/);
  assert.match(webBigScreenBlock, /args: \*build_args_node_alpine_nginx/);
  assert.match(compose, /APP_BIG_SCREEN_URL: "http:\/\/localhost:18092"/);
  assert.match(compose, /AUTH_SYSTEM_KEY: "big-screen"/);
  assert.match(compose, /MYSQL_DATABASE: juxin_big_screen/);
  assert.match(compose, /SCA_API_URL: "http:\/\/sca-api:5191"/);
  assert.match(compose, /TRAIN_EXAM_API_URL: "http:\/\/train-exam-api:5188"/);
  assert.match(compose, /REMINDER_API_URL: "http:\/\/api:5179"/);
  assert.match(compose, /- "5192:5192"/);
  assert.match(compose, /- "18092:80"/);
});

test('big-screen Dockerfiles build the TypeScript backend and Vue frontend', () => {
  assert.match(backendDockerfile, /npm run build/);
  assert.match(backendDockerfile, /CMD \["node", "dist\/server\.js"\]/);
  assert.match(frontendDockerfile, /npm run build/);
  assert.match(frontendDockerfile, /COPY nginx\.conf \/etc\/nginx\/conf\.d\/default\.conf/);
});

test('big-screen nginx proxies API, health, and streaming responses safely', () => {
  assert.match(nginx, /big-screen-api:5192/);
  assert.match(nginx, /location \/api\/big-screen\//);
  assert.match(nginx, /location \/health/);
  assert.match(nginx, /proxy_buffering off/);
  assert.match(nginx, /try_files \$uri \$uri\/ \/index\.html/);
});
