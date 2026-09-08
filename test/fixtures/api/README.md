# 脱敏 API Fixtures

这些 fixture 用于锁定渲染进程/主进程对 PikPak 接口响应结构的解析契约。

**脱敏说明**

- 本仓库环境无法接入真实账号抓包，因此这些文件是**基于代码实际读取字段构造的、去敏的代表性响应**，而非逐字节的真实抓包。
- 所有 URL 一律使用保留域名 `example.invalid`，不含任何真实 token、cookie、手机号、邮箱、密码或客户端密钥。
- `test/fixtures.test.js` 会扫描全部 fixture，确保不出现 JWT 片段、邮箱、`access_token`/`refresh_token`/`password`/`client_secret` 非空值以及任何非 `example.invalid` 的 http(s) 端点。

**场景覆盖**

| 文件 | 场景 | 被解析函数 |
|---|---|---|
| `drive-list.ok.json` | 正常目录列表（含分页 token、媒体、收藏标记） | `filesFrom` / `nextPageToken` |
| `drive-list.401.json` | 401 未授权 / token 失效 | `apiErrorMessage` |
| `drive-list.429.json` | 429 限流 | `apiErrorMessage` |
| `drive-list.missing.json` | 字段缺失（缺 name/size/time/mime_type） | `filesFrom` + 渲染层回退 |
| `drive-list.schema-drift.json` | 接口结构变化（`data.files` / `data.next_page_token`） | `filesFrom` / `nextPageToken` |
| `quota.ok.json` | 容量信息 | `normalizeQuota` |
| `shares.list.json` | 我的分享列表 | `normalizeShareList` |
| `recent.events.json` | 最近事件 | `recentFilesFromEvents` |

任一真实账号验收还原了真实响应后，应以脱敏后的真实结构替换或补充相应文件，并保持 `npm test` 通过。
