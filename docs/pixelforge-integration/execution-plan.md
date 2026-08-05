---
title: PixelForge × OpenGame 十步融合施工计划
status: accepted-working-plan
snapshot_date: 2026-08-05
---

# PixelForge × OpenGame 十步融合施工计划

**结论：严格按 1→10 推进；先统一合同和数据脊柱，再接生成与沙箱，最后才开放媒体、社区、充值和规模化流量。**

## 1. 十步总表

| 步骤 | 解决的独立问题                           | 依赖 | 主要输出                                                                                 | 完成判定                                                               | 回滚点                                            |
| ---- | ---------------------------------------- | ---- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------- |
| 1    | 真 API 合同与 Mock 分流                  | 无   | OpenAPI/Schema、DTO、错误码、MSW 环境闸                                                  | production 不注册 MSW；Web/iOS/Android/Go 合同测试一致                 | 前端显式 `mock` 环境仍可工作                      |
| 2    | 多用户、PostgreSQL、鉴权与幂等           | 1    | PG store、User/Session/Tenant/Game/Job 基表、真实 OIDC middleware                        | 吊销写请求立即拒绝；双用户并发不串；同幂等键只建一个 Job               | 只回应用版本；迁移 forward-only，保留导出快照     |
| 3    | Revision、Artifact、上传与对象存储       | 2    | RevisionCandidate/Head/Revision/Artifact/Upload/Manifest、对象存储                       | QA 后才建 Revision；产物按 hash 回读；跨租户拒绝                       | 读旧本机 artifact adapter；新上传保持私有         |
| 4    | Job/worker、SSE 与 OpenGame 接线         | 2,3  | PG lease、REST cursor+SSE、版本化 worker I/O、provider capability/取消、FFmpeg preflight | 重启续跑；SSE 可恢复；required 失败不假成功；无 FFmpeg 时 I2V 明确关闭 | 停 worker，不影响已发布作品读取                   |
| 5    | BoxLite 隔离执行                         | 4    | profile-based runner、策略、资源/网络/密钥验收                                           | OpenGame 落盘/build/Mod/QA 在沙箱；宿主不接收用户 command              | feature flag 关闭不可信远程执行                   |
| 6    | Create→预览真闭环                        | 4,5  | Generate API、阶段状态、QA、draft Revision、runtime URL                                  | 关闭 MSW 后完整创建一款 2D 和一款 3D v1 游戏并可玩                     | 新建流量回旧 Create；已产 Revision 可读           |
| 7    | Mod、Art Swap、Runtime Tuning 与直播状态 | 6    | ModJob、OpBatch、TuningSchema、head CAS、单写 `/api/ops/apply`                           | 冲突不写；有效 ack 才保存；成功产生可回滚 Revision                     | 关闭 Mod/Tuning 写开关，保留只读历史              |
| 8    | 媒体、宣传图、视频、审核与发布           | 6,7  | **新增 MediaJob**、MediaAssetSet/Attempt、sharp/FFmpeg、`/g/:slug` HTML、双指针发布      | 必需/可选角色清楚；媒体与 Revision 同发布同回滚                        | 继续服务上一 approved 媒体集                      |
| 9    | Feed、原生端、社区、账户与充值           | 2,8  | 移动 DTO/策略、social API、credit ledger、单支付 provider                                | 三端同数据；账务 0 重复；Feed 降级链通过                               | 分模块 feature flag；支付停新单不影响余额查询     |
| 10   | 5–10 万 DAU、灾备、安全与切流            | 1–9  | 压测、安全报告、备份恢复、灰度看板、runbook                                              | 全部 P0 和容量门通过，灰度可回滚且数据可对账                           | 按 tenant/百分比切回旧读面与旧 published Revision |

## 2. Step 1：合同冻结与 MSW 环境闸

| 子任务                                  | 仓库            | 输出                                                      | 完成判定                                             |
| --------------------------------------- | --------------- | --------------------------------------------------------- | ---------------------------------------------------- |
| 盘点所有 `/api` 调用、DTO、Mock handler | pixelforge-web  | endpoint/consumer 清单                                    | 每个前端写动作都映射到一个权威后端 command           |
| 定义核心 Schema                         | opengame-server | Game/Revision/Job/Event/Op/Media/PreviewPolicy            | 示例 JSON 可被 Go、TS、Swift、Kotlin 解码            |
| 统一错误与状态词表                      | 三仓            | `code, retryable, stage, requestId`                       | UI 不再靠错误字符串猜状态                            |
| 冻结实时合同                            | 三仓            | REST cursor + SSE、Last-Event-ID、heartbeat、410 snapshot | 断线、慢消费者、cursor 过期均有确定恢复路径；WS 后置 |
| 给 MSW 加环境闸                         | pixelforge-web  | `mock/real` 启动策略                                      | build/production 中 Mock bundle 不接管请求           |
| 建合同 CI                               | 三仓            | schema diff + fixture decode                              | 任一端删改必填字段即 CI 失败                         |

**提交节点：**合同文件、Web MSW 闸、各端 DTO 生成/校验分三个可回滚 commit。

## 3. Step 2：生产数据脊柱与身份

| 子任务              | 最小实现                                                               | 完成判定                                            |
| ------------------- | ---------------------------------------------------------------------- | --------------------------------------------------- |
| PostgreSQL adapter  | 复用 store/domain 边界，生产 DSN 强制 PG                               | production 配 SQLite 时启动失败并给明确错误         |
| User/Session/Tenant | 真实 OIDC subject 镜像 + status/roles/tokenVersion；access token≤15min | JWT 校验失败即 401；吊销 session 后下一次写请求拒绝 |
| 所有权              | Game/Job/Upload 带 tenantId/ownerId                                    | 双租户负例无法枚举或读取对方资源                    |
| 幂等                | endpoint scope + actor + Idempotency-Key 唯一                          | 并发十次相同 Create 只产生一条收费 Job              |
| 审计                | actor/action/target/before-after hash                                  | 发布、封禁、退款、Runtime Tuning 保存均可追溯       |

SQLite 仅保留 `dev` adapter，不实施长期双写。

## 4. Step 3：不可变 Revision 与文件链

| 子任务                 | 最小实现                                           | 完成判定                                                     |
| ---------------------- | -------------------------------------------------- | ------------------------------------------------------------ |
| 对象存储               | tenant/game/revision 内容寻址对象键                | 相同 hash 去重；上传后不可覆盖                               |
| Upload                 | 预签名或服务端流式上传、MIME/大小/hash 校验        | 伪扩展名、超限、跨租户、hash 不符全部拒绝                    |
| RevisionCandidate/Head | Create 先建 candidate；分支 head 带 version        | QA 失败不产生 Revision；Mod/Ops CAS 精确比较 head version    |
| Revision               | parent/kind/status/artifactId                      | artifact+QA 通过后一次性创建；ready 后不可变                 |
| 发布指针               | `publishedRevisionId + publishedMediaAssetSetId`   | 两个指针同事务切换且媒体集属于该 Revision；回滚恢复同组 hash |
| Artifact manifest      | entry、文件 hash/size/MIME、engine、build metadata | manifest 缺文件或越界引用不能 ready                          |
| 生命周期               | draft 私有、published 保留、孤儿延迟回收           | Job 失败不会生成公开 URL                                     |

## 5. Step 4：异步任务与 OpenGame

| 子任务              | 最小实现                                                                       | 完成判定                                             |
| ------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------- |
| PG lease worker     | queued→running→terminal、heartbeat、attempt                                    | worker 异常退出后 lease 到期可恢复                   |
| Event cursor/SSE    | `(jobId, seq)` 唯一、Last-Event-ID、15s heartbeat、7 天保留、410 snapshot      | 断线/慢消费者/cursor 过期均可恢复，不重复终态通知    |
| OpenGame 输入       | versioned `profileId+operation+structuredArgs`、refs、budget、deadline         | 同输入合同可重放；不允许用户 shell command           |
| OpenGame 输出       | itemResults、artifact manifest、usage、requestId/taskId、evidence、failureCode | required 失败时 Job 失败，不返回假成功               |
| Provider capability | sizes/edit/video/audio/cancel/maxBytes                                         | 调用前匹配；不支持给明确降级，不静默换模型           |
| 取消/超时           | AbortSignal 贯穿 provider/download/FFmpeg/子进程，再终止 BoxLite               | 超时后无残留 provider task/进程，状态固定为 timeout  |
| FFmpeg preflight    | 固定版本/checksum 和 `ffmpeg -version`/codec probe                             | 有 capability 才开 I2V；无则 Step 6 样本显式禁用 I2V |

不引入 Temporal、Kafka 或新的 workflow DSL。

## 6. Step 5：BoxLite

| 子任务                 | 验收负例                                          | 完成判定                                                       |
| ---------------------- | ------------------------------------------------- | -------------------------------------------------------------- |
| profile/operation 映射 | 传任意 shell、替换入口、注入结构化参数            | 只有服务端注册的固定入口可执行，用户无法提供 command           |
| 环境白名单             | 读取 DB/Auth/S3 主密钥                            | 沙箱中变量不存在，日志中也不出现                               |
| 文件隔离               | output_dir/key 的 `../`/绝对路径/symlink/重复 key | resolved containment 生效，无法读写 workspace 外或覆盖同名产物 |
| 网络策略               | DNS/TCP/UDP/host alias 绕过                       | 默认拒绝；只允许声明目标                                       |
| 下载/SSRF              | provider 返回内网 URL、超大体、假 MIME            | host/MIME/size allowlist 生效，响应不合规即失败                |
| 资源治理               | fork bomb、磁盘填满、无限循环                     | PID/CPU/内存/磁盘/墙钟限制生效                                 |
| 版本供应链             | 篡改 binary/image/checksum                        | 固定 release/checksum/SBOM；来源可审计                         |

BoxLite 正式 release 未包含已合并修复前，只合入关闭状态的 adapter 和测试，不承接生产不可信任务。

## 7. Step 6：Create 真闭环

| 旅程阶段 | 前端表现               | 后端/worker                                                              | 完成判定                               |
| -------- | ---------------------- | ------------------------------------------------------------------------ | -------------------------------------- |
| 提交     | 立即进入 queued        | 202 + gameId + jobId + candidateId；**不创建 Revision**                  | 重试不重复创建                         |
| 生产     | stage/percent/log 摘要 | OpenGame 生成并持续写 Event                                              | 刷新/换端仍显示相同进度                |
| 失败     | 精确 stage、可重试提示 | failureCode/retryable/attempt                                            | provider 配额与代码失败能区分          |
| QA/建版  | 显示验证步骤           | BoxLite build/smoke/gameplay；通过后一次性创建 Revision 并 CAS 推进 head | 必需门失败不生成任何 Revision          |
| 预览     | 只加载 ready URL       | 短期 runtime ticket                                                      | 2D 和 3D v1 均可交互、暂停、回报 ready |

首批样本必须包含：2D、3D v1、provider 失败、取消、超时、重复提交和刷新恢复。

## 8. Step 7：Mod、Art Swap 与 Runtime Tuning

| 子任务             | 规则                                                                                                 | 完成判定                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| TuningSchema       | pointer/type/range/step/runtimeKey/requiresRebuild                                                   | 每个可见参数有真实 runtime reader                                           |
| Runtime Tuning ack | 带 revisionId/candidateId/runtimeSessionId/nonce/schemaVersion/ackSeq/expiresAt/applied keys/metrics | 校验 iframe source/origin/ticket/actor；假、旧、重放、空 metrics 均不能保存 |
| 单写收口           | 只写 `/api/ops/apply`                                                                                | `/tuning` 只读兼容或删除，绝不二次生成 Revision                             |
| ModJob             | targetHeadId + expectedHeadVersion + expectedRevisionId + prompt/ops                                 | stale base 返回 `revision_conflict`，无文件改写                             |
| Art Swap           | assetId + target + oldHash                                                                           | 许可、hash、schema、smoke 全通过才 ready                                    |
| 并行创作           | 独立 candidate + head CAS                                                                            | 只有确定性 typed Ops 可重放；自然语言/code patch 冲突必须重跑               |
| 发布/回滚 CAS      | 比较当前 publishedRevisionId                                                                         | 代码、资产和同 Revision MediaAssetSet 两指针一起切换                        |

## 9. Step 8：宣传媒体与发布

| 顺序 | 任务                                                                     | 完成判定                                                                                                  |
| ---- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| 1    | **新增 MediaJob worker contract**                                        | 输入 revision/artifact/screenshots/creativeSpec/roles/policyVersion；输出 set/assets/attempts/itemResults |
| 2    | QA 后在 BoxLite 截标题页/关键场景                                        | evidence 带 revision/artifact hash 与 scene-ready 时间                                                    |
| 3    | 固化 creative spec/attempt                                               | provider/model/promptHash/requestId/cost/license/safeArea/审批信息可回读                                  |
| 4    | 生成 1920×1080 横版与 1080×1920 竖版无字母版                             | 两母版通过相关性、安全、比例、字节预算门                                                                  |
| 5    | sharp 派生 thumbnail/OG/srcset，确定性叠字                               | 规格/字节预算通过；多语言标题不越 safe area                                                               |
| 6    | FFmpeg 产必需 portrait MP4；universal 双端 QA 通过才产可选 landscape MP4 | 4–6 秒、静音、H.264/yuv420p、Fast Start≤8MiB；缺 landscape 不阻塞                                         |
| 7    | 候选重生/焦点/锁版 + 自动审核；风险/精选转人工                           | artist 不能 approve/publish；approve/reject/feature 均写审计                                              |
| 8    | 事务切 `publishedRevisionId + publishedMediaAssetSetId`                  | set.revisionId 匹配；失败继续服务上一 approved set                                                        |
| 9    | Go/edge `/g/:slug` HTML + CDN purge                                      | crawler 读 canonical/title/description/OG；`s-maxage≤300s`，回滚 purge 后命中旧 hash                      |

Hero 仅精选游戏触发，固定 1800×600、3:1±2%、WebP≤500KiB；404 退 cover。普通作品不因缺 Hero 阻塞发布，现有 fixture/Hero 资产上线前须替换或完成版权审核。

## 10. Step 9：Feed、社区与商业基础

| 子任务           | 最小实现                                                                               | 完成判定                                                                      |
| ---------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Web Feed 修正    | `mode=video` 独立于静音；竖屏消费 coverPortrait                                        | 三端同 fixture 执行 `safe attract→portrait MP4→coverPortrait→thumbnail→plate` |
| Android 安全策略 | 缺 PreviewPolicy 默认拒绝 attract                                                      | 只有显式 `attractSafe=true` 才加载 runtime                                    |
| 三端 DTO         | thumbnail/cover/coverPortrait/heroCover/previewPortrait/previewLandscape/previewPolicy | Go/TS/Swift/Kotlin fixture decode、null、poster metadata 和优先级一致         |
| Feed 预取        | 当前卡视频；邻卡 poster/metadata                                                       | 连续滑 100 卡无邻卡 iframe/视频并发堆积                                       |
| 社区             | like/save/follow/comment/report/notification                                           | 幂等、游标、限流、审核负例通过                                                |
| 钱包/积分        | WalletAccount、CreditReservation、ledger、结算/释放                                    | Job+冻结+outbox 同事务；重试不重复扣费                                        |
| 支付             | Order/PaymentAttempt/PaymentEvent/Refund + 单 provider webhook                         | providerEventId 唯一；验签、金额、乱序、退款对账通过                          |
| 美术/管理台      | regenerate/focal/lock/approve/reject/feature/takedown/refund/ban                       | artist 不可发布；Operations Admin 与 Runtime Tuning 分权并全审计              |

ShipAny 采购件只在此步选择性移植；每个移植模块必须先有明确调用方和适配清单。

## 11. Step 10：容量、安全与切流

| 门       | 验收                                                                                   | 失败动作                                     |
| -------- | -------------------------------------------------------------------------------------- | -------------------------------------------- |
| 容量     | 2,500–5,000 在线模型下 Catalog p95<300ms、错误率<0.5%                                  | 优先修查询/CDN/连接池，再决定 Redis/只读副本 |
| 昂贵 Job | Create 20/min、Mod 80/min、Media 10/min 持续；突发见需求合同；按实测 p95 秒数算 worker | 关新建、保留排队/ETA，不丢任务或重复扣费     |
| Soak     | 峰值 2h + 50% 峰值 24h；无 lease/RSS/DB/event 持续泄漏                                 | 不扩流，先修泄漏和 retention                 |
| 沙箱     | 逃逸、网络、密钥、资源耗尽负例全绿                                                     | BoxLite 生产开关保持关闭                     |
| 数据     | PITR/备份恢复演练，RPO/RTO 达标                                                        | 不切商业流量                                 |
| 媒体     | CDN 回源、404 降级、旧 Revision 回滚                                                   | 固定上一 approved set                        |
| 账务     | 订单/provider/ledger/usage 四方对账为零差异                                            | 停新单与付费任务，保留只读查询               |
| 灰度     | 内部→1%→5%→25%→100%，每级观察                                                          | 自动/手动回退到上一比例                      |

## 12. 仓库与提交切分

| 规则          | 执行方式                                                               |
| ------------- | ---------------------------------------------------------------------- |
| 一仓一 writer | 同一 worktree 同时只允许一个写入者；其他 agent 只读评审                |
| 一合同一提交  | schema、storage、job、sandbox、create、mod、media、billing 分开提交    |
| 分支          | `feat/pixelforge-<lane>`；修复用 `fix/pixelforge-<issue>`              |
| 验证          | 每个 commit 至少跑目标测试；里程碑跑三端合同 + 真后端旅程              |
| 合流          | 先合合同，再合后端，再合客户端消费者；不得靠 cherry-pick 未知 WIP 拼装 |
| IWE/CodeGraph | 只在里程碑开工/收尾做一次事实盘点与索引同步，不开多条并行 IWE 旅程     |

## 13. 首个可领取施工包

| 包  | 内容                                                          | 验收                                           |
| --- | ------------------------------------------------------------- | ---------------------------------------------- |
| C1  | 核心 OpenAPI/Schema + 完整媒体/Preview fixture                | Go/TS/Swift/Kotlin 四端 decode 与降级决策一致  |
| C2  | MSW 环境闸 + real-backend smoke                               | production 不注册 worker，smoke 命中 Go health |
| C3  | PG Game/RevisionCandidate/Head/Revision/Job + idempotency     | QA 前无 Revision；并发重试只有一个 Job         |
| C4  | S3-compatible Upload/Artifact manifest                        | 跨租户与 hash 负例通过                         |
| C5  | BoxLite profile runner + FFmpeg/provider capability preflight | 默认关闭；无用户 command；安全矩阵可自动执行   |

领取前先核对对应仓库的分支、远端差异、WIP 与 `docs/mistakes.md`，不得覆盖现有 3D 开发改动。
