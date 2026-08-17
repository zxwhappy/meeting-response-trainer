# 会答小练 · 微信小程序 MVP

一个原生微信小程序单页练习闭环：用户从 6 个会议场景中选择一题，听完模拟发言，准备 30 秒并录制回应，获得“接住对方 / 说出判断 / 推进下一步”三点短反馈，再针对同一场景复练一次并查看前后变化。

当前源码、两组云函数、6 段中文场景 M4A、自动测试和部署文档均已包含在仓库中。代码默认关闭模拟模式；有效 AppID、云环境和密钥不在本文公开，真实 ASR/AI 链路仍须在有权限的测试账号与云环境中完成配置和验收。

## 已实现的边界

- 原生 JavaScript、WXML、WXSS；全部业务流程在 `pages/index/index` 一个页面内完成。
- 首屏展示 6 个可选场景；练习中可返回场景列表，录音或分析阶段返回前会确认放弃，并忽略已退出练习的异步分析结果。
- 10 个产品状态由显式状态机约束，没有 TabBar、登录页、课程或个人中心。
- `RecorderManager` 使用 16kHz、单声道、MP3，3 秒最短、60 秒自动停止；支持试听、重录、后台安全停止和授权拒绝恢复。
- 会议音频最多播放两次；连续两次失败后才显示文字版并记录 `audio_fallback_text`。
- 真实链路为：云存储临时文件 → 服务端额度/幂等检查 → 腾讯一句话识别 → 微信云开发 AI+ 混元模型 → 结构校验 → `finally` 删除录音。
- AI 返回格式不合格会自动重试一次；客户端 45 秒超时后进入可恢复异常页。
- 服务端每日最多 10 次分析；请求 ID 幂等；OpenID 只在内存中参与 HMAC，不保存原值。
- 数据库不保存完整转写或原始录音。删除失败的文件由每 30 分钟运行的清理函数再次处理，一小时后进入清理范围。
- 模拟模式仅供开发，界面会持续显示橙色警示；当前 `mockMode: false`。

## 目录

```text
miniprogram/                         小程序客户端与 6 段压缩后的 M4A
source-assets/audio/                 不进入小程序代码包的原始 MP3
cloudfunctions/analyzeResponse/     分析、埋点、额度、ASR、AI 适配器
cloudfunctions/cleanupTempAudio/    一小时遗留录音的定时清理
tests/                               Node 内置测试
scripts/validate-project.js         项目、音频、密钥和事件绑定检查
docs/database.md                    集合、权限、索引与指标口径
docs/privacy.md                     用户隐私文案与后台声明要点
docs/test-checklist.md              开发者工具及 iPhone/Android 真机清单
docs/release-status.md              已完成、未完成、风险与发布闸门
```

## 本地检查

要求 Node.js 18 或更高版本。

```bash
npm test
npm run check
```

`npm run check` 会检查 JavaScript/JSON 语法、6 个场景的客户端/服务端一致性、场景音频是否为 16kHz 单声道且不是小占位文件、代码包内图片和音频是否合计不超过 200 KB、WXML 事件处理器，以及前端是否疑似含密钥。

## 在微信开发者工具中打开

1. 用微信开发者工具导入仓库根目录，不要只导入 `miniprogram/`。
2. 把 `project.config.json` 的 `appid` 从 `touristappid` 改为你的测试小程序 AppID。
3. 创建或选择云开发环境，把环境 ID 写入 `miniprogram/config/env.js` 的 `cloudEnvId`；也可以留空并始终使用工具中当前选中的云环境，但真实测试建议显式填写。
4. 确认基础库不低于项目配置的 `3.7.12`，先点“编译”检查单页首屏和 6 个本地音频。

## 云开发部署

### 1. 创建数据库集合

创建以下集合，并将客户端安全规则设置为不可直接读写（`read: false, write: false`）；云函数通过服务端 SDK 访问：

- `practice_events`
- `analysis_usage_daily`
- `analysis_requests`
- `temp_audio_files`
- `scenario_requests`

字段、索引和指标查询说明见 [docs/database.md](docs/database.md)。

### 2. 配置云函数环境变量

在云开发控制台为 `analyzeResponse` 配置 `cloudfunctions/analyzeResponse/.env.example` 中列出的变量。真实值只填在云函数环境变量中，不要创建前端 `.env`，也不要把密钥提交到 Git。

至少需要：

- `USER_HASH_SALT`：至少 16 位的随机盐；上线后不要随意更换，否则匿名用户键与日额度会重新开始。
- `TC_SECRET_ID`、`TC_SECRET_KEY`：仅有语音识别权限的腾讯云子账号密钥。

AI 模型通过云函数内的 `wx-server-sdk` 调用，不需要配置 DeepSeek API Key 或模型 Base URL。`AI_PROVIDER`、`AI_MODEL` 和 `AI_TIMEOUT_MS` 都是可选项，默认分别为 `hunyuan-v3`、`hy3` 和 `12000`。

### 3. 部署函数

在开发者工具的云函数列表中：

1. 右键 `analyzeResponse`，选择“上传并部署：云端安装依赖”。超时时间设为 45 秒，内存 256MB。
2. 右键 `cleanupTempAudio`，同样上传并部署。确认 `config.json` 中的每 30 分钟定时触发器已出现在控制台；若平台未自动创建，按 `0 */30 * * * * *` 手工创建。
3. 在云函数日志中执行一次测试调用，确认没有 `CONFIG_MISSING`。

两个函数的 `package-lock.json` 已锁定依赖。当前固定 `wx-server-sdk 4.0.2`；发布前仍需重新运行 `npm audit --omit=dev`，详见 [docs/release-status.md](docs/release-status.md)。

## 腾讯云一句话识别配置

1. 在腾讯云语音识别控制台开通服务。
2. 创建专用子账号，采用最小权限，只允许调用一句话识别 `asr:SentenceRecognition`；不要使用主账号永久密钥。
3. 将密钥配置到云函数环境变量。默认地域 `ap-shanghai`，引擎 `16k_zh`，格式 `mp3`。
4. 适配器使用官方 TC3-HMAC-SHA256 签名直接请求 `asr.tencentcloudapi.com`，没有把腾讯 SDK 或密钥打进前端。
5. 用 3 秒以上的中文录音验证。少于 5 个有效汉字会返回 `ASR_EMPTY`，不会继续生成虚假反馈。

参考：[一句话识别 API](https://cloud.tencent.com/document/api/1093/35646)、[TC3 签名方法](https://cloud.tencent.com/document/api/213/30654)。

## 微信云开发 AI+ 配置

1. 在当前云环境的 AI+ 模型管理中开通成长计划支持的 `hy3`。
2. 保持云函数依赖 `wx-server-sdk 4.0.2`，并在重新部署 `analyzeResponse` 时选择“云端安装依赖”。
3. 默认无需添加任何 AI 密钥；仅需在改模型或调整超时时间时覆盖以下变量：

```text
AI_PROVIDER=hunyuan-v3
AI_MODEL=hy3
AI_TIMEOUT_MS=12000
```

适配器使用 `cloud.ai().createModel('hunyuan-v3').generateText(...)`。成长计划免费 Token 额度要求通过小程序或云开发服务端官方 SDK 调用；直接请求其他模型厂商的 HTTP API 不会使用这部分额度。模型只收到服务端内置场景、会议原文和本次转写；提示词禁止评价发音、性格等内容，也不生成标准答案。

以上规则于 2026-08-17 按官方资料复核：[成长计划说明](https://docs.cloudbase.net/ai/ai-inspire-plan)、[接入指引](https://docs.cloudbase.net/ai/ai-inspire-plan-guide)、[服务端 SDK 接入](https://docs.cloudbase.net/ai/model/wx-server-sdk-access)。真实用户测试前仍须确认云开发 AI+ 与混元当日的数据留存、训练使用、数据地域和删除政策，并让隐私声明与实际处理链路一致。

## 模拟模式

开发时可将 `miniprogram/config/env.js` 的 `mockMode` 暂时设为 `true`。该模式仍会使用真实录音控件，但不会上传录音，返回值会在界面上明确标记为开发模拟模式。

真实用户测试前必须恢复为 `false`；`npm run check` 会阻止以模拟模式交付。

## 微信公众平台需要人工完成

- 填写真实 AppID、云环境和测试成员。
- 在“小程序用户隐私保护指引”中声明麦克风/录音用途、处理方式、保存期限，以及腾讯云 ASR、微信云开发 AI+ / 混元等第三方处理方。
- 确认服务类目、隐私指引、用户信息处理说明、第三方共享/委托处理和数据跨境情况符合提交审核当日规则。
- 使用 `open-type="agreePrivacyAuthorization"` 的同意按钮在代码中已实现；仍要在后台完成隐私指引配置，否则接口不会形成合规闭环。
- 复核云数据库安全规则、云函数环境变量和定时清理触发器。
- 不要把身份证、手机号、验证码、Cookie、SecretId 或 SecretKey 发给协作者或写入仓库。

微信官方参考：[小程序隐私协议开发指南](https://developers.weixin.qq.com/miniprogram/dev/framework/user-privacy/PrivacyAuthorize.html)、[`agreePrivacyAuthorization`](https://developers.weixin.qq.com/miniprogram/dev/component/button.html)。

## 验收与限制

自动化覆盖状态流转、录音提交边界、三点结构校验、四类前后对比、日额度、重复请求、ASR 空结果、AI 超时/非法格式、所有分析路径的录音删除、清理任务部分失败和 TC3 签名。

本仓库当前没有真实 AppID、云环境、腾讯/AI 密钥，也不能代替所有者完成公众平台隐私声明。因此“真实 ASR/AI 联调、iPhone 真机、Android 真机、审核版体验”仍是发布前人工闸门，不应把源码和 Node 测试通过表述为真机已通过。完整清单见 [docs/test-checklist.md](docs/test-checklist.md)。
