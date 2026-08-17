# 云数据库集合与指标

客户端不直接读写以下集合。建议所有集合安全规则设为 `read: false, write: false`，只允许云函数服务端 SDK 和管理员访问。

## `practice_events`

轻量匿名行为事件，不含录音和完整转写。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `userKey` | string | OpenID 经服务端盐值 HMAC-SHA256 后的不可逆键 |
| `sessionId` | string | 客户端生成的随机练习会话 ID |
| `scenarioId` | string | 静态场景 ID |
| `round` | number | `0`、`1` 或 `2` |
| `eventName` | string | 白名单事件名 |
| `durationMs` | number | 当前动作或会话耗时 |
| `errorCode` | string | 失败事件的稳定错误码；成功为空 |
| `dimensions` | object/null | 三个维度的布尔结果，不含分数或文案 |
| `mockMode` | boolean | 云端真实事件恒为 `false`；开发模拟默认不入库 |
| `date` | string | Asia/Shanghai 自然日，`YYYY-MM-DD` |
| `createdAt` | date | 服务端时间 |

建议索引：

- `sessionId` 升序 + `eventName` 升序
- `eventName` 升序 + `createdAt` 降序
- `userKey` 升序 + `date` 升序 + `eventName` 升序

事件白名单包含任务中要求的全部事件：`app_open`、`practice_start`、`scenario_play_start`、`scenario_play_complete`、`prep_start`、`record_start`、`record_submit`、`analysis_success`、`analysis_fail`、`feedback_view`、`retry_start`、`retry_submit`、`practice_complete`、`feedback_helpful_yes`、`feedback_helpful_no`、`scenario_request_submit`、`audio_fallback_text`。

## `analysis_usage_daily`

服务端日额度。文档 ID 是 `userKey + date` 的 SHA-256；字段为 `userKey`、`date`、`count`、`updatedAt`。事务内最多增加到 10。

该集合按文档 ID 直接读写，不需要额外索引。

## `analysis_requests`

防重复计费记录。文档 ID 是 `userKey + date + requestId` 的 SHA-256。

保存 `requestIdHash`、`status`、`errorCode`、三个布尔 `resultFlags` 和时间；不保存完整转写或反馈文案。相同请求 ID 再次提交返回 `DUPLICATE_REQUEST`，不再次计费。

## `temp_audio_files`

临时云文件清理索引，字段为 `fileID`、`requestIdHash`、`createdAt`、`createdAtMs`、`cleanupAttempts`、`lastCleanupErrorAt`。

正常分析在 `finally` 删除音频并移除该文档；删除失败时保留文档。`cleanupTempAudio` 每 30 分钟扫描 `createdAtMs` 早于一小时的记录并逐个重试，部分失败不会影响已成功文件。

建议建立 `createdAtMs` 升序索引。

## `scenario_requests`

保存用户主动填写的下一场景建议：`userKey`、`sessionId`、`scenarioId`、`requestText`（最多 100 个汉字）和 `createdAt`。输入框已提醒不要填写个人或客户敏感信息。

建议建立 `createdAt` 降序索引。

## 指标口径

按 `sessionId` 去重后计算：

- 激活：同时出现第一轮 `analysis_success` 和第一轮 `feedback_view` 的会话。
- 完成率：出现 `practice_complete` 的会话数 ÷ 出现 `practice_start` 的会话数。
- 复练率：第二轮出现 `record_start` 的会话数 ÷ 第一轮出现 `feedback_view` 的会话数。
- 有用率：选择 `feedback_helpful_yes` 的去重 `userKey` 数 ÷ 出现任一 helpful 事件的去重 `userKey` 数。
- 次日复访：某 `userKey` 在相邻两个 Asia/Shanghai 自然日都出现 `practice_start`。

`practice_complete` 只在第二次结果成功形成并显示前后对比后写入。固定三点自检形成的对比也属于“完成练习”，但分析成功率仍可用 `analysis_success` 单独区分。

建议按业务需要配置数据保留期，例如行为事件 90 天、幂等请求与日额度 30 天；删除策略应与正式隐私指引一致。
