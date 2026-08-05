---
title: PixelForge × OpenGame 验收门、预警与冲突
status: accepted-working-plan
snapshot_date: 2026-08-05
---

# PixelForge × OpenGame 验收门、预警与冲突

**结论：当前可以开始施工，但不能宣称“已融合”或直接承接生产流量；真 API、PostgreSQL、Revision、BoxLite、CAS、媒体版本和跨端 Feed 安全都是 P0。**

## 1. 当前断点与源码证据

| #   | 断点                                  | 当前证据                                                                               | 严重度     | 关闭标准                                                                     |
| --- | ------------------------------------- | -------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------- |
| 1   | Web 无环境闸启动 MSW                  | `pixelforge-web/web/src/main.tsx:50-52`                                                | P0         | production bundle/启动不注册 MSW，真后端 smoke 命中 Go API                   |
| 2   | Go 只有基础生成/读取面                | `opengame-server/internal/api/api.go:52-58`                                            | P0         | Catalog/Revision/Job/Mod/Ops/Media/Auth 最小合同落地                         |
| 3   | SQLite 是当前 store                   | `opengame-server/internal/store/store.go:1-16`、`go.mod:9`                             | P0         | production 强制 PostgreSQL；迁移与恢复演练通过                               |
| 4   | 默认继承主进程环境                    | `workspace.go:168-176`                                                                 | P0         | sandbox env 从空白安全基线构造，只加任务级白名单                             |
| 5   | BoxLite 尚未接入                      | 当前 workspace 仍组装本机目录并启动 engine；无 BoxLite runner                          | P0         | 固定安全 release，隔离矩阵全绿，生产开关才能启用                             |
| 6   | preview/thumbnail 只绑定 gameId       | `uploads.ts:22-73`                                                                     | P0         | 上传返回 MediaAsset，强制绑定 revisionId/artifactHash                        |
| 7   | GM 仍走 `/tuning` + `/ops/apply`      | `use-tuning-surface.ts:83-90`                                                          | P0         | 只保留 `/api/ops/apply` 权威写入，旧路径不产生 Revision                      |
| 8   | Web 视频与静音错误耦合                | `RuntimeSurfaces.tsx:264-271`                                                          | P0         | `mode=video`/preview 决定播放，元素固定 muted；静音开关不阻止视频            |
| 9   | Android preview policy fail-open      | `FeedAttractPreviewPolicy.kt:3-15`                                                     | P0         | 缺策略默认 false；只有显式 attract+safe 才执行                               |
| 10  | 原生 DTO 缺 cover 三字段              | `MobileGame.swift:105-161`、`MobileContracts.kt:411-447`                               | P0         | iOS/Android 解码并按方向消费 cover/coverPortrait/heroCover                   |
| 11  | Web 静态 Feed 只优先 thumbnail        | `gameViews.ts:56-65`                                                                   | P0         | Web/iOS/Android 同 fixture：portrait MP4→coverPortrait→thumbnail→plate       |
| 12  | OpenGame manifest 信息不足            | `generate-assets-types.ts:136-145`                                                     | P0         | 加 hash/size/source/license/lineage/revision/status 或转成 Artifact manifest |
| 13  | asset key 未形成安全文件名合同        | `generate-assets-types.ts:47-50`、`generate-assets.ts:1453-1455`                       | P0         | slug 校验 + resolved path containment 负例通过                               |
| 14  | 损坏 manifest 被当空对象              | `generate-assets.ts:1424-1430`                                                         | P0         | 不存在与损坏分开；临时文件 fsync/rename 原子替换                             |
| 15  | 部分失败仍返回成功式结果              | `generate-assets.ts:493-508,532-535`                                                   | P0         | machine-readable item results；required 失败使 Job/Revision 不 ready         |
| 16  | 3D v1 只支持基础几何和贴图            | `generate-gdd.ts:629-640`                                                              | 已接受边界 | 文案/合同不承诺 GLB/text-to-3D；独立里程碑跟踪                               |
| 17  | output_dir 与 provider URL 缺完整边界 | `generate-assets.ts:416-420,1433-1438,1545-1547`                                       | P0         | output/key containment、重复 key、host/MIME/size allowlist 与 SSRF 负例通过  |
| 18  | provider 取消与结构化账单不贯通       | `assetModelRouter.ts:125-173`                                                          | P0         | AbortSignal 贯穿；item result 含 requestId/taskId/usage/cost/failureCode     |
| 19  | OpenGame 尚无 MediaJob/宣传图生产者   | 现有请求仅 background/image/animation/audio/tileset：`generate-assets-types.ts:47-110` | P0         | 新 MediaJob 从截图证据产 set/assets/attempts，并通过媒体角色验收             |
| 20  | FFmpeg 是隐式能力而非部署门           | I2V/抽帧/音频路径依赖 FFmpeg：`generate-assets.ts:658-755,823-849`                     | P0         | 固定版本/checksum/codec probe；缺失时 I2V 关闭且状态可见                     |
| 21  | Vite SPA 无动态 OG HTML 生产面        | 当前只有客户端壳；无 `/g/:slug` 服务端 HTML                                            | P0         | Go/edge 返回 crawler HTML，发布/回滚 purge 后映射正确 hash                   |

“当前代码未发现”只代表 2026-08-05 这三个 checkout 的快照；施工前仍需在目标 branch 复核。

## 2. P0 放行门

| Gate                  | 必须完成                                                                               | 可执行验收                                                           | 不通过时                   |
| --------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------- |
| G0 合同               | OpenAPI/DTO/错误码/完整媒体字段/Mock 同源                                              | Go/TS/Swift/Kotlin 同 fixture decode 与降级决策                      | 禁止跨仓并行实现           |
| G1 真后端             | MSW 环境闸、CORS/auth、real smoke                                                      | production 请求命中真实 API，Mock 请求数为 0                         | 不做 UI“联调完成”结论      |
| G2 数据               | PostgreSQL、迁移、owner、幂等                                                          | 多实例并发写、备份恢复、生产 SQLite 拒启                             | 不接公开用户               |
| G3 文件/Revision      | candidate/head/immutable Revision、双发布指针、对象存储、CAS                           | QA 前无 Revision；路径/hash/租户/并发/回滚负例全过                   | 不开放 Mod/发布            |
| G4 Job/Event          | lease、REST cursor+SSE、worker I/O、provider cancel/usage、FFmpeg preflight            | kill/断线/过期 cursor 可恢复；required 失败不假成功                  | 不开放付费生成             |
| G5 沙箱               | BoxLite 固定版、profile operation、OpenGame 落盘/执行入沙箱、env/network/resource 隔离 | 用户 command、逃逸、DNS/TCP/UDP/alias、fork bomb 全拒绝              | 生产 sandbox flag 保持关闭 |
| G6 Create             | 2D+3D v1 真生成/QA/预览                                                                | 从 prompt 到 ready Revision 可重放                                   | 不开放 Create              |
| G7 Mod/Runtime Tuning | single write、head CAS、带 session/nonce/origin 的 ack                                 | stale base/假 ack/重放/并发修改负例通过                              | 只读展示，不开放保存       |
| G8 发布/媒体          | 新 MediaJob、Attempt、审核、双指针原子切换、`/g/:slug`                                 | 失败/驳回/回滚仍服务上一批准版本和 OG hash                           | 不展示新 Revision          |
| G9 跨端 Feed          | 策略、完整媒体 DTO、MP4/封面降级                                                       | Web/iOS/Android 执行同一 `safe attract→MP4→portrait→thumbnail→plate` | 三端退全静态               |
| G10 账务              | order/webhook/ledger/usage 对账                                                        | 重放 10 次 webhook/Job 仍只入账一次                                  | 停充值与付费任务           |
| G11 运维              | metrics、告警、PITR、runbook                                                           | 故障演练和值班人员按文档恢复                                         | 不超过内部灰度             |

## 3. P1 完整度门

| 领域             | P1 能力                                    | 完成判定                                                     |
| ---------------- | ------------------------------------------ | ------------------------------------------------------------ |
| 搜索/发现        | 标签、搜索、精选策略、稳定游标             | 下架不可检索；分页不重不漏                                   |
| 社区             | 点赞、收藏、关注、评论、举报、通知         | 幂等、限流、审核、已读游标通过                               |
| 美术工作台       | regenerate/focal/safe-area/lock commands   | artist 不可 approve/publish；每次生成 attempt 可追溯         |
| Operations Admin | approve/reject/feature/takedown/refund/ban | 与 Runtime Tuning 分权；操作人、原因、版本、前后 hash 可审计 |
| 前端性能         | `srcset/sizes`、按尺寸解码、缓存           | Feed 100 卡无内存持续增长，弱网可用                          |
| 推荐             | 先规则/精选/热度                           | 只有业务指标证明需要才上复杂推荐系统                         |
| Hero             | 精选游戏 1800×600、3:1±2%、≤500KiB         | 404 退 cover；旧 fixture/资产版权清理；普通作品不阻塞        |

## 4. 必跑端到端旅程

| J   | 旅程                                          | 通过条件                                                                        |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------- |
| J1  | 新用户登录→Create→刷新→预览                   | QA 前只有 candidate；通过后同一 Job 创建一个 Revision，未重复扣费               |
| J2  | 两个用户并发 Create                           | workspace、事件、文件、用量完全隔离                                             |
| J3  | 重复点击/网络重试 Create                      | 同幂等键只执行一次 provider 调用                                                |
| J4  | Create 中取消/超时/worker 崩溃                | 无残留进程；状态可恢复且余额正确                                                |
| J5  | 3D v1 创建                                    | primitive+texture 游戏可玩，触控不被错误承诺                                    |
| J6  | 两人从同一 RevisionHead/version 同时 Mod      | 一人成功、一人明确 conflict；自然语言 patch 重跑，不静默自动重放                |
| J7  | Runtime Tuning→伪 origin/重放 ack→真 ack→保存 | session/nonce/seq/expiry/origin 任一不合 fail-closed；真保存返回 nextRevisionId |
| J8  | Art Swap 使用跨租户/篡改 assetId              | 403/422，沙箱未启动、无扣费                                                     |
| J9  | QA 失败或宣传图审核拒绝                       | 线上仍是旧 Revision/旧媒体，无半成品泄漏                                        |
| J10 | 发布→首页/详情→`/g/:slug`→Feed                | Web/iOS/Android/无 JS crawler 引用同一 Revision/MediaAssetSet                   |
| J11 | 回滚                                          | 两个 published 指针、artifact、封面、视频、OG 一起回到原 hash                   |
| J12 | Android 缺 PreviewPolicy                      | 不加载 attract，显示 MP4 或静态兜底                                             |
| J13 | Reduce Motion/省流/弱网                       | 不自动运行；video 失败退 portrait/thumbnail                                     |
| J14 | 支付 webhook 重放/乱序/退款                   | 账本唯一、余额正确、订单状态可对账                                              |
| J15 | Redis/SSE 故障                                | REST cursor 能查进度和终态，业务正确性不丢                                      |
| J16 | FFmpeg/provider 不支持所需能力                | I2V 明确关闭或 Job 结构化失败，不静默生成错误格式                               |
| J17 | Hero/cover URL 404                            | Hero→cover→品牌底板；Feed→portrait→thumbnail→plate，无空白卡                    |

## 5. 5–10 万 DAU 容量门

容量模型先按 **DAU 50,000–100,000、峰值同时在线 5%、即 2,500–5,000 在线**；实测用户曲线出来后替换假设。

| 指标             | 放行线                                                  | 测试方式                                                           | 超标优先动作                     |
| ---------------- | ------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------- |
| Catalog/Feed API | p95 < 300ms，p99 < 800ms                                | 真实分页/权限/计数数据压测                                         | 索引、批量查询、缓存热门页       |
| 写 API           | p95 < 500ms（异步任务仅入队）                           | like/save/create/order 混合流量                                    | 幂等索引、连接池、减少事务范围   |
| 错误率           | < 0.5%，账务/发布错误为 0                               | 稳态+故障注入                                                      | 回滚、熔断昂贵入口               |
| DB               | 无长事务/锁风暴，连接低于上限 80%                       | `pg_stat_statements`、慢查询门                                     | 索引/查询修复，再考虑只读副本    |
| Job 入队         | p95 < 200ms                                             | Create 20/min、Mod 80/min、Media 10/min 持续；10min 突发 60/200/30 | worker 扩容，不在 API 同步执行   |
| Job 正确性       | 0 丢失、0 重复扣费                                      | kill/restart/lease expiry/重复投递                                 | 修幂等和 lease，不靠人工对账兜底 |
| Event 恢复       | 断线后 5s 内恢复；≤200 events/job、单条≤32KiB           | Last-Event-ID、慢消费者、7 天过期/410 snapshot                     | 回源 REST cursor/snapshot        |
| Feed 视频并发    | 每客户端最多当前卡 1 路                                 | 连滑 100 卡、前后台切换                                            | 取消旧请求、释放 video/iframe    |
| Feed 首屏        | poster 可见 p75 < 1.5s（目标网络档）                    | 冷 CDN、弱网、低端机                                               | 图片尺寸、CDN、预连接            |
| CDN 命中         | immutable media > 95%                                   | 真实 key 和回源日志                                                | cache header/key 策略            |
| 沙箱/Provider    | worker 数按到达量×p95秒数公式；quota≤80%；队列 ETA 可见 | 每 tenant Create 2、Mod 4 并发；provider/FFmpeg 分池               | 公平队列、限额，不静默换模型     |
| 视频/流量        | 每方向 MP4≤8MiB；API 0 热视频代理                       | CDN 冷/热缓存、范围请求、回源日志                                  | 调码率/尺寸/CDN，不加 HLS 首发   |
| Soak             | 峰值 2h + 50% 峰值 24h 无 lease/RSS/DB/event 持续增长   | worker kill/restart、Redis/SSE/Provider 抖动                       | 不扩流，修泄漏/retention         |
| 恢复             | PostgreSQL RPO≤5min、RTO≤60min（首发目标）              | 备份恢复演练                                                       | 达不到则不接商业流量             |

## 6. 安全验收

| 边界         | 必测                                                                | 通过标准                                                              |
| ------------ | ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| API          | JWT 伪造、过期、错 audience、IDOR、CORS、CSRF                       | 所有写入先认证授权；错误不泄露内部路径                                |
| Upload       | MIME 欺骗、超限、zip bomb、hash、路径、跨租户                       | 校验失败不落公开对象、不启动 Job                                      |
| Artifact     | output_dir/key 的 `../`、绝对路径、symlink、重复 key、恶意 HTML/CSP | resolved containment；原子 manifest；入口只加载允许资源并运行于隔离域 |
| BoxLite      | 用户 command/入口替换、文件/设备/进程/网络/host alias/DNS/UDP       | 仅 profileId+operation；默认拒绝，策略不可由 prompt 放宽              |
| Provider     | SSRF URL、假 MIME、超大响应、取消失效、错误体含密钥                 | host/MIME/size allowlist；AbortSignal 生效；日志脱敏                  |
| Ops/Mod      | schema 绕过、旧 Revision、越权 asset                                | CAS/owner/schema 任一失败则 0 写入                                    |
| Media        | NSFW、侵权、提示词注入、未审核 URL                                  | 公开集合只接受 approved；lineage 可追责                               |
| Payment      | 假 webhook、重放、金额篡改、乱序退款、Job 冻结失败                  | 验签+providerEventId 唯一；Job+reservation+outbox 同事务；账本可对账  |
| Admin        | 越权精选/下架/退款/封禁                                             | RBAC、二次确认、immutable audit log                                   |
| Supply chain | BoxLite/FFmpeg/sharp/image checksum/SBOM                            | 固定版本和 checksum；高危漏洞有升级路径                               |

## 7. 风险登记

| 风险                         | 概率 | 影响 | 预警信号                               | 预防/缓解                                              | 回滚                            |
| ---------------------------- | ---- | ---- | -------------------------------------- | ------------------------------------------------------ | ------------------------------- |
| BoxLite 修复迟迟未发布       | 中   | 高   | 最新 release 不含 #1090/#1106          | adapter 先行、生产开关关闭、持续看 release             | 不开放不可信任务                |
| 沙箱网络策略仍可绕过         | 中   | 极高 | UDP/alias/DNS 负例成功                 | 默认无网、代理票据、红队门                             | 全局关闭 sandbox                |
| SQLite→PG 语义漂移           | 中   | 高   | 测试绿但生产 SQL/事务失败              | 生产同引擎集成测试、一次性迁移                         | 回应用版本，保留 PG 数据        |
| API `/api` 与 `/v1` 双逻辑   | 高   | 高   | 同动作产生不同状态/Revision            | 两套路由调用同一 service；新功能只写一次               | 关闭兼容路由写面                |
| Runtime Tuning 假/重放 ack   | 高   | 高   | UI 显示 applied 但玩法无变化           | session+nonce+origin+seq+expiry+metrics 全校验         | 禁用保存，只留预览              |
| 并行 Mod 覆盖                | 高   | 高   | head/version 与 base 不一致仍成功      | head CAS；仅 typed Ops 重放；自然语言 patch 重跑       | 保留旧 Revision，撤回新 head    |
| 媒体与 Revision 错配         | 高   | 高   | 回滚后封面/视频仍是新版                | 两个 published 指针同事务并校验 revisionId             | 固定上一 approved set           |
| Provider 部分失败/取消假成功 | 高   | 高   | Errors>0、cancel 后仍计费或进入 ready  | required gate、AbortSignal、结构化 item/usage          | candidate 失败，不创建 Revision |
| OpenGame 在宿主落盘/执行     | 中   | 极高 | npm/build/Mod 出现在主进程树           | 只下发 BoxLite profile/operation，宿主验 manifest/hash | 关闭生产 runner                 |
| FFmpeg 能力漂移              | 中   | 高   | 开发可用、镜像缺 codec，I2V/MP4 才失败 | 固定版本/checksum/codec probe；无能力关 I2V            | 退静态媒体                      |
| Feed 自动运行不安全作品      | 中   | 极高 | 缺 policy 仍创建 iframe                | 所有端 fail-closed、server 下发 policy                 | 全局 attract kill switch        |
| 移动视频带宽/内存过高        | 中   | 高   | 邻卡下载、OOM、掉帧                    | 单视频、poster 邻卡、生命周期释放                      | 全局退静态封面                  |
| 充值重复入账                 | 中   | 极高 | webhook 重放余额增长                   | providerEventId/ledger 幂等唯一约束                    | 停新单、冻结异常余额            |
| ShipAny 整体融合诱发双后端   | 中   | 高   | Next.js/Go 同时写用户订单              | 只移植 UI/流程，不运行第二权威                         | 删除未接入模块                  |
| 过早引入 Redis/队列平台      | 中   | 中   | 正确性依赖缓存、运维增多               | PG 先行，指标触发升级                                  | 关闭缓存回源 PG                 |
| 封面生成成本失控             | 中   | 中   | 每次调参触发多图生成                   | 仅 publish candidate；横竖两母版                       | 停 AI，退实机截图               |
| 3D 能力宣传超出现状          | 高   | 中   | 需求出现 GLB/换装但仍排 v1             | 明示边界，独立里程碑                                   | 降级到 primitive+texture        |

## 8. 需要与用户讨论的冲突/门

| 决策门                  | 当前建议                            | 何时必须确认            | 不确认的默认动作                                            |
| ----------------------- | ----------------------------------- | ----------------------- | ----------------------------------------------------------- |
| 首发市场与身份 provider | 标准 OIDC，按首发地区选托管商       | Step 2 开始前           | 仅测试 issuer 做内部联调；真实 OIDC 未接前不开放公共 Create |
| 充值渠道                | 海外默认 Stripe；大陆需另做合规选型 | Step 9 账务施工前       | 不开放充值，只保留免费额度/人工赠送测试账                   |
| BoxLite release 时间    | 等包含 #1090/#1106 的正式 release   | Step 5 生产开关前       | adapter 合并但始终关闭                                      |
| 3D 模型资产里程碑       | 与当前融合解耦                      | 产品开始承诺 GLB/换装前 | 继续维持 v1 primitive+texture 边界                          |
| Redis 是否首发          | 由容量压测决定                      | Step 10                 | 不引入；REST cursor + PG 正确运行                           |
| 创作者分成/提现         | 另行法务、税务、KYC 方案            | 任何提现/转赠需求前     | 积分只能站内消费，不可提现/转赠                             |

其余核心选择已冻结；不得在施工中重新比较腾讯沙箱、Temporal、重型 DAM 或整体迁入 ShipAny。

## 9. 灰度 Go/No-Go

| 阶段                    | Go 条件                     | No-Go 条件                                                  |
| ----------------------- | --------------------------- | ----------------------------------------------------------- |
| 开发联调                | G0–G4                       | MSW 仍无闸、PG/幂等未完成                                   |
| 内部 Create             | G0–G6                       | BoxLite 安全负例任一失败                                    |
| 内部 Mod/Runtime Tuning | G0–G7                       | 双写、假/重放 ack、head CAS 覆盖任一存在                    |
| 媒体/Feed 灰度          | G0–G9                       | MediaJob 缺失、双指针错版、Android fail-open、三端 DTO 漂移 |
| 商业灰度                | G0–G11 + 账务对账           | 重复扣费/入账、备份未演练、无告警                           |
| 5–10 万 DAU 扩流        | 容量门全过，连续观察期无 P0 | 靠手工扩容、单机 SQLite、API 代理视频                       |

## 10. 每次验收必须留下的证据

| 类别 | 最小证据                                                       |
| ---- | -------------------------------------------------------------- |
| 合同 | schema SHA、四端 fixture decode 结果                           |
| 代码 | commit SHA、目标测试、build/lint 输出                          |
| 旅程 | final-SHA 真 API E2E、requestId/jobId/revisionId               |
| 沙箱 | BoxLite release/checksum、负例矩阵、资源指标                   |
| 数据 | migration version、行数/hash 对账、恢复演练时间                |
| 媒体 | revision/artifact/media hash、审核结果、多端截图/视频 metadata |
| 账务 | provider event/order/ledger/usage 四方对账                     |
| 容量 | 测试模型、数据量、并发、p50/p95/p99、错误率和瓶颈证据          |

聚焦测试、Mock E2E 或“agent 报告完成”都不能替代 final-SHA 真后端全旅程证据。
