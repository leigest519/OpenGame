---
title: PixelForge 全功能下穿与后端需求合同
status: accepted-working-plan
snapshot_date: 2026-08-05
---

# PixelForge 全功能下穿与后端需求合同

**结论：前端不是“接一个生成接口”即可；它要求一条从账户、Create、Revision、Mod、Runtime Tuning、运营审核、媒体、发布，到首页、Feed、社区和计费的可追溯生产链。**

## 1. 统一术语

| 术语          | 当前定义                                                   | 禁止混用                     |
| ------------- | ---------------------------------------------------------- | ---------------------------- |
| Game          | 作品的长期身份和公开目录条目                               | 不等同某次构建目录           |
| Revision      | 一次不可变、可运行、可回滚的作品版本                       | 不原地覆盖                   |
| Artifact      | Revision 的构建产物与 manifest                             | 不用本机绝对路径作为公开引用 |
| Job           | Create/Mod/QA/截图/媒体/转码的异步任务                     | 不以浏览器内存作为任务真相   |
| Op            | 对 config/code/asset 的结构化修改指令                      | 不把自然语言直接当已应用结果 |
| MediaAssetSet | 绑定一个 Revision 的宣传媒体集合                           | 不只存 game 级 URL           |
| PreviewPolicy | Feed 对实时 attract、视频、静态图和 inline play 的安全策略 | 缺字段不得默认允许执行       |
| CreditLedger  | 充值、赠送、冻结、消费、退款的追加式账本                   | 不只维护可覆盖余额字段       |

## 2. 前端功能全下穿矩阵

| ID    | 前端功能/动作                 | 后端必须提供                                               | OpenGame/沙箱职责                             | 当前判定             | 完成判定                                                                                      |
| ----- | ----------------------------- | ---------------------------------------------------------- | --------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------- |
| PF-01 | 注册、登录、退出、找回        | OIDC/JWT 校验、Session/tokenVersion、User/Profile、封禁态  | 无                                            | **缺失 P0**          | 三端同一身份；写请求查 session/tokenVersion，吊销后立即拒绝；纯 access token 最大 TTL 15 分钟 |
| PF-02 | 个人资料、头像、作品列表      | Profile CRUD、公开/私有字段、游标分页                      | 无                                            | **缺失 P1**          | 修改可回读；他人只见公开字段                                                                  |
| PF-03 | 首页 Hero/精选/最新           | 目录查询、精选位、排序版本、屏幕适配字段                   | 无                                            | **前端有壳 P0**      | 真 API 返回且分页稳定；Hero 只引用 approved 媒体                                              |
| PF-04 | 搜索、标签、分类              | 索引字段、过滤、游标、空态                                 | 无                                            | **后端缺失 P1**      | 相同 cursor 不重不漏；下架作品不可搜到                                                        |
| PF-05 | Web/移动 Feed 滑屏            | feed cursor、PreviewPolicy、封面/视频、统计摘要            | 仅安全准入的 attract runtime                  | **部分 P0**          | 当前卡运行，邻卡只预取 poster/metadata，降级链一致                                            |
| PF-06 | 游戏详情、分享                | Game+published Revision+MediaAssetSet、Go `/g/:slug` HTML  | 提供可运行 artifact                           | **未闭环 P0**        | 不执行 JS 的 crawler 获得 canonical/title/description/当前 approved OG；回滚后缓存失效        |
| PF-07 | 在线玩、暂停、音量、输入      | runtime URL、短期票据、运行桥事件                          | BoxLite/静态产物运行；ready/score/over bridge | **部分 P0**          | 无 cookie 隔离域可运行，暂停/音量/ready 可验证                                                |
| PF-08 | Prompt Create                 | 幂等创建、Job、事件流、取消、配额                          | 生成 GDD、代码、游戏内资产、build             | **仅基础后端 P0**    | 202+jobId；断线后按 cursor 续看；重复请求只执行一次                                           |
| PF-09 | Create 过程状态               | stage、percent、event cursor、结构化失败                   | 输出阶段与机器可读结果                        | **协议未合流 P0**    | 刷新/换端后重建相同状态；失败能准确重试                                                       |
| PF-10 | 实时预览                      | draft Revision、runtime ticket、刷新/ready                 | 构建可预览 artifact                           | **前端有壳 P0**      | 仅 ready Revision 可加载；旧任务不得替换新预览                                                |
| PF-11 | 截图与录屏                    | 上传签名、MediaAsset、Revision 绑定                        | 给出 scene-ready/录制窗口                     | **game 级上传 P0**   | 上传失败无脏公开 URL；回滚恢复同版本 poster/video                                             |
| PF-12 | 资产上传/素材包               | 预签名上传、MIME/大小/hash/许可/租户校验                   | 消费受信 assetId                              | **未闭环 P0**        | 客户端只提交 assetId；跨租户和篡改 hash 被拒绝                                                |
| PF-13 | Fork                          | lineage、权限、许可快照、初始 Revision                     | 可从指定 artifact 重建                        | **后端缺失 P1**      | 来源链可查；下架/不可 fork 策略生效                                                           |
| PF-14 | Mod It 自然语言修改           | ModJob、expectedRevisionId、冲突和事件                     | BoxLite 内 patch/build/test/QA                | **后端缺失 P0**      | CAS 冲突不写；成功产生新 Revision，旧版可回滚                                                 |
| PF-15 | Art Swap                      | 结构化 asset op、旧/新 hash、审核                          | 在沙箱中替换并验证引用                        | **后端缺失 P0**      | 替换只作用新 Revision；许可和运行检查通过                                                     |
| PF-16 | Runtime Tuning（GM 参数）试调 | TuningSchema、candidate、runtime ack+metrics               | runtime 真正读取并应用参数                    | **假闭环 P0**        | 每个 runtimeKey 有真实读者；无有效 ack 禁止保存                                               |
| PF-17 | Runtime Tuning 保存           | 单一 `/api/ops/apply`、head CAS、审计                      | 根据 Op 重建或热更                            | **双写 P0**          | `/tuning` 不再写；响应返回 nextRevisionId 与 applied Ops                                      |
| PF-18 | QA                            | 自动 build/smoke/gameplay/media/moderation 结果            | 执行真实检查并产 evidence                     | **缺失 P0**          | required gate 失败绝不进入 published                                                          |
| PF-19 | 发布、撤回、回滚              | 原子切换 publishedRevisionId、审计、幂等                   | 无                                            | **缺失 P0**          | Revision、artifact、媒体同切；失败继续服务上一版                                              |
| PF-20 | 宣传图生成                    | MediaJob、MediaAssetSet、审核、锁版                        | 截图、creative spec、provider adapter         | **生产者缺失 P0**    | 横/竖母版 + 派生图可回读，均绑定 artifactHash                                                 |
| PF-21 | 移动预览录像                  | 转码任务、posterAssetId、codec/时长/方向/Fast Start 元数据 | 输出安全录制窗口                              | **未闭环 P0**        | portrait MP4 必需；landscape 仅 universal 双端 QA 通过时可选，缺失不阻塞普通发布              |
| PF-22 | 点赞、收藏、关注              | 幂等关系写入、聚合计数、鉴权                               | 无                                            | **Mock/壳 P1**       | 重试不重复计数；读写一致且有反滥用限流                                                        |
| PF-23 | 评论、举报、审核              | 评论树、游标、举报、封禁/下架、审计                        | 可提供内容风险信号                            | **后端缺失 P1**      | 被审核内容按权限隐藏；操作可追责                                                              |
| PF-24 | 通知                          | durable notification、已读游标、去重                       | Job 终态产生事件                              | **缺失 P1**          | 同一业务终态不重复轰炸；跨端已读一致                                                          |
| PF-25 | 用量与积分                    | UsageCost、CreditLedger、预授权、结算、退款                | 输出 provider usage/requestId                 | **仅 token 原型 P0** | 每笔消费追到 user/game/job/provider；重复 webhook 不重复入账                                  |
| PF-26 | 充值与订单                    | Order、PaymentAttempt、验签 webhook、退款                  | 无                                            | **缺失 P1**          | 服务端验签、幂等入账、金额/币种不可由客户端决定                                               |
| PF-27 | Creator/美术外接臂            | 候选、重生、裁切焦点、安全区、锁版、角色权限               | 复用图像 provider 与截图                      | **缺失 P1**          | 美术不能发布；锁版资产仍需 reviewer/自动门通过                                                |
| PF-28 | Operations Admin（运营后台）  | 精选、下架、审核、退款、封禁、审计                         | 无                                            | **缺失 P1**          | 与 Runtime Tuning 分开授权；高风险动作二次确认并写 immutable audit log                        |
| PF-29 | 可观测性/客服排障             | requestId、jobId、stage、failureCode、trace                | 透传 provider/沙箱诊断但清洗密钥              | **部分 P0**          | 用户错误可读，内部 trace 可定位，敏感值不下发                                                 |
| PF-30 | 多租户/多用户并行创作         | owner、角色、资源限额、CAS、租户隔离                       | 每 Job 独立 BoxLite/工作目录                  | **缺失 P0**          | 并发 Mod 不互踩；跨租户文件、事件、密钥均不可见                                               |

## 3. 最小领域合同

| 对象                     | 必须字段                                                                                                                                                    | 不变量                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| User/Session             | `id, externalSubject, status, tokenVersion, sessionId, revokedAt`                                                                                           | `externalSubject` 唯一；写请求检查用户/会话状态；封禁用户不能新建付费任务                    |
| Game                     | `id, ownerId, slug, title, visibility, defaultHeadId, publishedRevisionId, publishedMediaAssetSetId`                                                        | 两个 published 指针必须指向同一 Revision；slug 唯一；公开读不暴露本机目录                    |
| RevisionCandidate        | `id, gameId, jobId, baseRevisionId, status`                                                                                                                 | Create 202 只创建 candidate；失败 candidate 不得冒充 Revision                                |
| RevisionHead             | `id, gameId, name, headRevisionId, version`                                                                                                                 | Mod/Ops CAS 比较 head+version；自然语言/code patch 冲突必须重跑，不自动重放                  |
| Revision                 | `id, gameId, parentRevisionId, kind, artifactId, qaEvidenceId, createdBy, createdAt`                                                                        | artifact+必需 QA 通过后才创建；内容不可变；发布状态由 Game 指针表达                          |
| Artifact                 | `id, manifestUrl, manifestHash, entryUrl, sizeBytes, engine, createdAt`                                                                                     | 内容寻址；URL immutable；入口只能引用允许的对象                                              |
| Job                      | `id, tenantId, gameId, baseRevisionId, type, status, stage, idempotencyKey, leaseUntil`                                                                     | 同业务幂等键唯一；终态不可倒退                                                               |
| Event                    | `id, jobId, seq, type, stage, payload, createdAt`                                                                                                           | `(jobId, seq)` 唯一；客户端按 cursor 重放                                                    |
| OpBatch                  | `id, gameId, headId, expectedHeadVersion, expectedRevisionId, ops, actorId, reason`                                                                         | CAS 失败不产生 Revision；只有确定性 typed Ops 可重放，所有 Op 经过 schema 校验               |
| MediaAssetSet            | `id, gameId, revisionId, artifactHash, policyVersion, status`                                                                                               | `(revisionId, artifactHash, policyVersion)` 幂等；整组发布/回滚                              |
| MediaAsset               | `id, role, url, hash, width, height, format, byteSize, focalPoint, source, moderationStatus, codec?, durationMs?, orientation?, fastStart?, posterAssetId?` | 公开 URL 只能来自 approved set；视频 poster 必须指向同 Revision 图片；landscape preview 可空 |
| MediaGenerationAttempt   | `mediaSetId, provider, model, promptHash, requestId, cost, license, safeArea, lockedBy, approvedBy, rejectionReason`                                        | 每次重生独立留痕；锁版不绕过审核；失败 attempt 不改 published pointer                        |
| PreviewPolicy            | `mode, attractSafe, inlinePlay, fallback, version`                                                                                                          | `attract` 必须显式 `attractSafe=true`；缺失时 fail-closed                                    |
| UsageCost                | `jobId, provider, requestId, units, amount, currency, status`                                                                                               | provider request 可对账；金额只由服务端价格表计算                                            |
| Wallet/CreditReservation | `walletId, userId, balance`；`jobId, amount, status, expiresAt`                                                                                             | Job、信用冻结、outbox 同事务；终态按真实 usage 结算或释放                                    |
| Order/Payment            | `Order, PaymentAttempt, PaymentEvent(providerEventId), Refund`                                                                                              | providerEventId 唯一；验签后推进订单；退款关联原支付                                         |
| CreditLedger             | `id, walletId, orderId?, jobId?, type, delta, balanceAfter, idempotencyKey`                                                                                 | 追加写；余额不得为负；充值、消费、释放、退款均可关联                                         |
| AuditLog                 | `actorId, action, targetType, targetId, beforeHash, afterHash, reason, createdAt`                                                                           | 高风险后台操作不可删除或覆盖                                                                 |

## 4. API 家族与单写入口

| 家族         | 最小端点/通道                                                   | 权威规则                                                                                                           |
| ------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Auth/Profile | `/api/session`、`/api/me`、`/api/users/:id`                     | 身份由服务端 token 验证，不信客户端 userId                                                                         |
| Catalog      | `GET /api/games`、`GET /api/games/:id`                          | cursor 分页；只投影当前可见 Revision                                                                               |
| Create       | `POST /api/generate`、`GET/DELETE /api/jobs/:id`                | 返回 202；Idempotency-Key 必填                                                                                     |
| Events       | `GET /api/jobs/:id/events` + SSE                                | REST cursor 是真相；SSE 使用 `Last-Event-ID`、15s heartbeat、背压断开重连；v1 不开放 WS 公共合同                   |
| Runtime      | `GET /sandbox/r/:revisionId/` + ticket                          | cookieless origin；短期票据；尾斜杠和静态头一致                                                                    |
| Upload       | `POST /api/uploads` 或预签名                                    | 返回 immutable assetId；校验 MIME/大小/hash/owner                                                                  |
| Mod          | `POST /api/games/:id/mods`                                      | `expectedRevisionId` 必填；实际执行进入 BoxLite                                                                    |
| Ops          | `POST /api/ops/apply`                                           | **唯一 Runtime Tuning/结构化修改写入口**                                                                           |
| QA/Publish   | `GET /api/revisions/:id/qa`、`POST /api/games/:id/publish`      | 发布事务同时切 Revision 与 MediaAssetSet                                                                           |
| Media        | `POST /api/revisions/:id/media-jobs`、`GET /api/media-sets/:id` | 所有产物绑定 Revision 和 artifactHash                                                                              |
| Share HTML   | `GET /g/:slug`                                                  | Go/edge 输出可抓取 HTML；带 canonical/title/description/approved `og:image`；`s-maxage≤300s` 且发布/回滚主动 purge |
| Social       | like/save/follow/comment/report/notifications                   | 每种关系有幂等键、权限和反滥用限流                                                                                 |
| Billing      | orders/payment-webhook/credits/usage                            | webhook 验签后入账；账本追加写                                                                                     |
| Admin        | review/feature/takedown/refund/ban                              | RBAC + 审计；不复用普通用户写接口绕过策略                                                                          |

现有 `/v1/*` 可保留为控制面兼容入口，但必须调用同一 domain service；不得形成第二套写逻辑。

SSE 事件保留期首发为 7 天；cursor 过期返回 `410 event_cursor_expired` 并附当前 Job snapshot，客户端从 snapshot 继续，而不是从头猜状态。

## 5. Create 生产过程

| 阶段              | 输入                           | 产物/事件                                              | 失败处理                 | 完成判定                                                |
| ----------------- | ------------------------------ | ------------------------------------------------------ | ------------------------ | ------------------------------------------------------- |
| 1. 准入           | user、prompt、目标屏幕、幂等键 | `gameId + jobId + candidateId`，Job queued             | 配额不足不启动 provider  | 同键返回原 Job；此时尚无 Revision                       |
| 2. 设计           | prompt                         | GDD、engine、tuningSchema 草案                         | 结构错误可重试一次       | schema 和目标能力匹配                                   |
| 3. 资产           | GDD/style anchor               | 游戏内资产、来源、hash                                 | 必需资产失败则 Job 失败  | 不以“部分成功文案”放行                                  |
| 4. 构建           | code+assets                    | immutable artifact                                     | 编译错误进入可诊断 stage | build 绿且 manifest 完整                                |
| 5. 沙箱 QA        | artifact                       | smoke/gameplay/security evidence                       | 超时/越权终止沙箱        | 必需门全绿                                              |
| 6. Ready Revision | artifact+evidence              | 一次性创建 immutable Revision，并推进目标 RevisionHead | 事务失败不暴露半成品     | 刷新后可回读同一 Revision；失败 candidate 永无 Revision |
| 7. 媒体           | ready Revision                 | screenshot/video/MediaAssetSet                         | 保留上一 approved set    | 媒体状态可独立观察                                      |
| 8. 发布           | Revision+approved media        | published pointer                                      | 原子失败保持旧版         | 三端看到同一版本                                        |

## 6. Mod、实时修改与 Runtime Tuning 过程

| 场景                | 统一流程                                                           | 关键并发规则                                                                                | 用户可见状态                                              |
| ------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 自然语言 Mod        | 解析为 Op/patch → BoxLite → build → QA → Revision                  | `expectedRevisionId` CAS                                                                    | queued/patching/building/validating/ready/conflict/failed |
| Art Swap            | assetId+目标槽 → 许可校验 → 替换 → smoke → Revision                | oldAssetHash 必须匹配                                                                       | uploading/validating/applying/ready/rejected              |
| Runtime Tuning 试调 | TuningSchema → runtime candidate → 真 applied ack+metrics          | ack 校验 `runtimeSessionId, nonce, schemaVersion, ackSeq, expiresAt, origin, ticket, actor` | previewing/applied/ack_missing                            |
| Runtime Tuning 保存 | `/api/ops/apply` → target head CAS → build/QA → nextRevisionId     | 禁止 `/tuning` 双写                                                                         | saving/applied/conflict/failed                            |
| 多人并行            | 每人从 baseRevision 建 candidate；typed Ops 可重放                 | Mod/Ops 比较 target RevisionHead；自然语言/code patch 冲突后重跑                            | stale/rebase_required/conflict                            |
| 发布/回滚           | 比较 publishedRevisionId，并原子切 Revision+MediaAssetSet 两个指针 | 不重新生成媒体                                                                              | rolling_back/published                                    |

“直播修改状态”是事件流，不等于在主进程热改文件。不能安全热更的字段明确标为 `requiresRebuild=true`。

### OpenGame/BoxLite 版本化执行合同

| 方向                | 字段                                                                                                            | 规则                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Worker→Runner       | `contractVersion, profileId, operation, structuredArgs, jobId, tenantId, candidateId, baseRevisionId, deadline` | 不接受用户提供的 shell command；服务端把 operation 映射到固定入口           |
| 输入引用            | `prompt/typedOps, assetIds, artifactManifest, capabilityTicket`                                                 | 只传 immutable refs；provider 通过短期代理票据访问，不注入主密钥            |
| OpenGame→Worker     | `itemResults[], artifactManifest, evidenceRefs[], usage[], providerRequests[], failureCode`                     | 每项含 success/required/taskId/requestId/cost；required 失败使整个 Job 失败 |
| 取消                | worker 标记 cancel + runner signal                                                                              | AbortSignal 贯穿 provider、下载、FFmpeg 与子进程；终态后无残留任务          |
| Provider capability | `imageSizes, edit, video, audio, cancel, maxBytes`                                                              | 路由前显式匹配；不支持必须返回结构化降级原因，禁止静默换能力                |
| 产物交接            | output manifest + hash，或单 Job 预签名上传票据                                                                 | 宿主复核 hash/MIME/size/path 后入对象存储；沙箱不能覆盖已发布对象           |

## 7. 宣传媒体与移动预览

| `MediaAsset.role` / DTO 字段 | 固定规格/预算                               | 生产策略                                                   | 消费与回退                               |
| ---------------------------- | ------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------- |
| `cover`                      | 1920×1080、16:9、WebP≤350KiB                | QA 后从实机截图+creative spec 生成无字母版                 | Web 横卡；404 退同 Revision screenshot   |
| `coverPortrait`              | 1080×1920、9:16、WebP≤450KiB                | 独立构图，不从横图硬裁                                     | 移动 Feed；失败退 thumbnail/品牌底板     |
| `thumbnail`                  | 640×360、WebP≤100KiB                        | sharp 从合适母版确定性派生；另产 320/640/960/1280 `srcset` | 列表兜底；客户端不得下载原母版充小卡     |
| `ogImage`                    | 1200×630、WebP/JPEG≤300KiB                  | 母版裁切 + 确定性标题/品牌叠加                             | `/g/:slug` crawler；失败退 cover         |
| `heroCover`                  | 1800×600、3:1±2%、WebP≤500KiB               | **仅精选游戏**生成/人工锁版                                | URL 404 退 cover+安全背景；普通作品可空  |
| `previewPortrait`            | 720×1280、4–6s、静音 H.264/yuv420p MP4≤8MiB | FFmpeg 转码，Fast Start；`posterAssetId` 指 coverPortrait  | 移动默认；失败退 coverPortrait           |
| `previewLandscape`           | 1280×720、4–6s、静音 H.264/yuv420p MP4≤8MiB | **可选**；仅 universal 且双端 QA 通过才生成                | 横屏卡；缺失不阻塞普通发布；首版不做 HLS |

Feed 决策顺序固定为：**显式安全 attract → H.264 MP4 → coverPortrait → thumbnail → 确定性品牌底板**。

### PixelForge `GameDTO` 媒体字段表

| 字段               | 类型/空值                 | 语义                                                          | 兼容规则                                      |
| ------------------ | ------------------------- | ------------------------------------------------------------- | --------------------------------------------- |
| `thumbnail`        | `string or null`          | 640×360 列表兜底                                              | 保留现字段                                    |
| `cover`            | `string or null`          | 横版 cover，唯一名称；不再使用 `coverLandscape`               | 保留现字段                                    |
| `coverPortrait`    | `string or null`          | 竖版静态首选                                                  | Web/iOS/Android 同名                          |
| `heroCover`        | `string or null`          | 精选 Hero；普通作品允许 null                                  | 404 必须有 cover fallback                     |
| `previewPortrait`  | `PreviewMediaDTO or null` | `url, posterUrl, codec, durationMs, width, height, fastStart` | 移动 Feed 首选；posterUrl 必须来自同 Revision |
| `previewLandscape` | `PreviewMediaDTO or null` | 同上，横版可选                                                | 只在布局为 landscape 时消费                   |
| `preview`          | `string or null`          | **过渡只读别名**                                              | Step 9 后删除；新代码不得写入                 |
| `previewPolicy`    | `PreviewPolicy or null`   | attract/inline/fallback 安全合同                              | null 等同 fail-closed，不允许 attract         |

Go、TypeScript、Swift、Kotlin 必须用同一 fixture 验证字段、null、metadata 和降级顺序。

## 8. 账户、社区与充值

| 领域   | 首发必须                          | 可后置            | 关键约束                                           |
| ------ | --------------------------------- | ----------------- | -------------------------------------------------- |
| 账户   | OIDC 登录、用户镜像、封禁态、角色 | 多身份绑定、组织  | 不自研密码存储；JWT 必须验签和校验 audience/issuer |
| 社区   | 点赞、收藏、关注、评论、举报      | 推荐图谱、勋章    | 幂等、游标、限流、审核与下架                       |
| 积分   | 余额、冻结、消费、退款、用量明细  | 促销券、等级      | 追加式账本；生成前预授权，终态结算                 |
| 充值   | 单一支付 provider、订单、webhook  | 第二支付 provider | 金额/币种服务端生成；webhook 验签+幂等             |
| 管理台 | 用户、作品、审核、订单、账本查询  | 复杂 BI           | RBAC、二次确认、全审计                             |

ShipAny 只作为上述表结构、页面和 webhook 流程的参考来源，不引入第二个 Next.js 业务后端。

### 美术与 Operations Admin 外接臂

| Command                                       | 允许角色                  | 结果                                         | 强制约束                                                      |
| --------------------------------------------- | ------------------------- | -------------------------------------------- | ------------------------------------------------------------- |
| `POST /api/media-sets/:id/regenerations`      | creator、artist           | 新 MediaGenerationAttempt/候选，不覆盖原资产 | 绑定 Revision/policyVersion，受预算和限流                     |
| `PATCH /api/media-assets/:id/focal-point`     | creator、artist           | 新焦点/safe-area 版本                        | 只改 draft set；锁版后需显式 unlock 审计                      |
| `POST /api/media-sets/:id/lock`               | creator、artist           | 锁定候选                                     | 锁定不等于审核通过，不得发布                                  |
| `POST /api/media-sets/:id/approve`            | reviewer/Operations Admin | approved                                     | 记录 approvedBy、版权/安全结果                                |
| `POST /api/media-sets/:id/reject`             | reviewer/Operations Admin | rejected                                     | rejectionReason 必填，公开指针不变                            |
| `POST /api/games/:id/feature`                 | Operations Admin          | featured/unfeatured                          | Hero 缺失时先排 Hero Job；全操作审计                          |
| `POST /api/admin/<takedown-or-refund-or-ban>` | Operations Admin 分权角色 | 管理动作                                     | action 服务端白名单；与 Runtime Tuning 权限完全分开，二次确认 |

美术角色不能 approve/publish；creator 不能 feature/takedown；Operations Admin 不通过文件系统直接改游戏。

## 9. 5–10 万 DAU 的非功能要求

以下容量是**验收假设**，不是当前流量事实：按峰值 5% 同时在线，即 2,500–5,000 在线用户压测。

| 领域         | 首发验收线                         | 设计要求                                             |
| ------------ | ---------------------------------- | ---------------------------------------------------- |
| Catalog/Feed | p95 < 300ms，错误率 < 0.5%         | cursor 分页、CDN、批量聚合、避免 N+1                 |
| Feed 媒体    | 当前卡视频；邻卡只 poster/metadata | 按网络/省流/Reduce Motion 降级，不预加载邻卡 runtime |
| API          | 无状态横向扩展                     | session 不驻单机内存；限流键可分布式                 |
| Job          | 重启不丢、重复投递不重复扣费       | PostgreSQL lease + 幂等键 + outbox/event cursor      |
| 数据库       | 无 SQLite 单写瓶颈                 | PostgreSQL 连接池、索引、慢查询门、必要时只读副本    |
| 实时状态     | 断线可恢复                         | REST event cursor 为真相；Redis/pubsub 只加速        |
| 文件         | API 不代理大文件热流量             | 对象存储直传、CDN immutable、短期签名下载            |
| 沙箱         | 多租户资源硬隔离                   | CPU/内存/PID/时限/网络 allowlist、环境白名单         |
| 账务         | 0 重复入账/扣费                    | webhook、Job 和 ledger 全部幂等并可对账              |
| 可用性       | Redis/实时通道失败仍可查终态       | 正确性不依赖缓存；旧 published Revision 始终可服务   |

### 默认昂贵任务压测模型

这些是首轮容量假设，实测产品漏斗后必须重算；worker 数量按 `ceil(每分钟到达量 × p95任务秒数 / 60 × 1.3)`，再受 provider 配额上限约束。

| 负载             | 持续目标                        | 10 分钟突发            | 公平/大小约束                                       |
| ---------------- | ------------------------------- | ---------------------- | --------------------------------------------------- |
| Create           | 20 jobs/min                     | 60 jobs/min            | 每 tenant 同时 2 个；p95 sandbox≤8min、硬上限 20min |
| Mod/Runtime save | 80 jobs/min                     | 200 jobs/min           | 每 tenant 同时 4 个；typed no-op 不启动 sandbox     |
| MediaJob         | 10 jobs/min                     | 30 jobs/min            | provider/FFmpeg 分池；previewLandscape 可跳过       |
| Provider         | 按实测 p95 计算并发             | 不超过供应商 quota 80% | 超额排队可见，不静默换 provider/模型                |
| Event            | ≤200 events/job、单 event≤32KiB | cursor 7 天保留        | 过期返回 snapshot；禁止把原始二进制/完整日志入表    |
| 视频             | MP4≤8MiB/方向、图片预算见上表   | CDN 直传/直读          | API 不代理热视频；生命周期按 Revision               |
| Soak             | 峰值 2 小时                     | 50% 峰值 24 小时       | 无 lease 泄漏、DB 膨胀失控、worker/RSS 持续增长     |

## 10. 明确不在当前里程碑

| 能力                                  | 处理                                                 |
| ------------------------------------- | ---------------------------------------------------- |
| GLB/FBX/OBJ、text-to-3D、骨骼动画换装 | 另立 3D Asset/Mod 里程碑                             |
| 多人实时协同编辑 CRDT                 | 先用 Revision+CAS+Ops 重放；真实同屏协同有数据再评估 |
| HLS 短预览                            | 4–6 秒 MP4 已覆盖，长直播/长视频出现再评估           |
| GitLab 作为业务主库                   | 排除；PostgreSQL 保存 lineage 和收入权威             |
| 全量人工 GM 审批                      | 排除；默认自动门，风险/精选才转人工                  |
