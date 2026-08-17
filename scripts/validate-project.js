const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const root = path.resolve(__dirname, '..');
const failures = [];
const warnings = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.name === 'node_modules') return [];
    return entry.isDirectory() ? walk(target) : [target];
  });
}

['project.config.json', 'miniprogram/app.json', 'miniprogram/sitemap.json'].forEach((file) => {
  try {
    JSON.parse(read(file));
  } catch (error) {
    failures.push(`${file} 不是有效 JSON：${error.message}`);
  }
});

walk(root).filter((file) => file.endsWith('.js')).forEach((file) => {
  try {
    childProcess.execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    failures.push(`${path.relative(root, file)} JavaScript 语法检查失败`);
  }
});

const scenarios = require(path.join(root, 'miniprogram/data/scenarios'));
const serverScenarios = require(path.join(root, 'cloudfunctions/analyzeResponse/data/scenarios'));
check(scenarios.length >= 6, '至少需要 6 个场景');
check(new Set(scenarios.map((item) => item.id)).size === scenarios.length, '场景 ID 必须唯一');
scenarios.forEach((scenario) => {
  check(Boolean(scenario.id && scenario.title && scenario.role && scenario.background
    && scenario.speech && scenario.audioUrl), `场景 ${scenario.id || '?'} 缺少必填字段`);
  check(Boolean(serverScenarios[scenario.id]), `服务端缺少场景 ${scenario.id}`);
  const audioPath = path.join(root, 'miniprogram', scenario.audioUrl.replace(/^\//, ''));
  check(fs.existsSync(audioPath), `场景 ${scenario.id} 缺少音频`);
  if (fs.existsSync(audioPath)) {
    check(fs.statSync(audioPath).size > 50 * 1024, `场景 ${scenario.id} 音频可能是占位文件`);
    try {
      const type = childProcess.execFileSync('/usr/bin/file', [audioPath], { encoding: 'utf8' });
      check(/MPEG|Audio file/i.test(type), `场景 ${scenario.id} 不是可识别的 MP3`);
      check(/16 kHz|16000 Hz/i.test(type), `场景 ${scenario.id} 不是 16kHz`);
      check(/mono|monaural/i.test(type), `场景 ${scenario.id} 不是单声道`);
    } catch (_) {
      warnings.push(`无法读取 ${scenario.id} 的音频元数据`);
    }
  }
});

const clientSource = walk(path.join(root, 'miniprogram'))
  .filter((file) => /\.(js|json|wxml|wxss)$/.test(file))
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n');
check(!/(?:sk-[A-Za-z0-9]{16,}|TC_SECRET_(?:ID|KEY)\s*[:=]\s*['"][^'"]+)/.test(clientSource),
  '小程序前端疑似包含第三方密钥');
const config = require(path.join(root, 'miniprogram/config/env'));
check(config.mockMode === false, '真实测试交付必须关闭 mockMode');

const wxml = read('miniprogram/pages/index/index.wxml');
const pageJs = read('miniprogram/pages/index/index.js');
const handlerNames = [...wxml.matchAll(/(?:bind|catch)[a-z]+="([A-Za-z0-9_]+)"/g)]
  .map((match) => match[1]);
new Set(handlerNames).forEach((handler) => {
  check(new RegExp(`\\n\\s*(?:async\\s+)?${handler}\\s*\\(`).test(pageJs), `WXML 事件处理器 ${handler} 未实现`);
});

const projectConfig = JSON.parse(read('project.config.json'));
if (projectConfig.appid === 'touristappid') {
  warnings.push('project.config.json 仍为 touristappid，真实部署前必须替换 AppID');
}
if (!config.cloudEnvId) {
  warnings.push('cloudEnvId 留空，将使用开发者工具当前选择的云环境');
}

warnings.forEach((message) => console.warn(`WARN ${message}`));
if (failures.length) {
  failures.forEach((message) => console.error(`FAIL ${message}`));
  process.exitCode = 1;
} else {
  console.log(`PASS 项目静态检查完成：${scenarios.length} 个场景，${handlerNames.length} 个事件绑定`);
}
