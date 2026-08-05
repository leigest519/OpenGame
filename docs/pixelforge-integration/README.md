---
title: PixelForge × OpenGame 融合执行包
status: accepted-working-plan
snapshot_date: 2026-08-05
owners: OpenGame / opengame-server / pixelforge-web
---

# PixelForge × OpenGame 融合执行包

**结论：本目录是下一阶段前后端融合的唯一执行入口。OpenGame 的目标是支撑 PixelForge 全业务，3D 只是其中一条生产管线。**

本目录只保留当前有效结论。旧调研可作为证据来源，但不得覆盖这里的选型、顺序和验收门。

## 1. 文档阅读顺序

| 顺序 | 文档                                                             | 用途                     | 读完后应能回答                         |
| ---- | ---------------------------------------------------------------- | ------------------------ | -------------------------------------- |
| 1    | [requirements.md](requirements.md)                               | 前端功能全下穿与后端合同 | 每个页面、动作、状态需要后端提供什么   |
| 2    | [architecture-and-selections.md](architecture-and-selections.md) | 架构、依赖、选型与排除项 | 用什么、为什么、复杂度和退出条件是什么 |
| 3    | [execution-plan.md](execution-plan.md)                           | 10 步施工单              | 先做什么、产物是什么、怎样回滚         |
| 4    | [acceptance-and-risks.md](acceptance-and-risks.md)               | P0/P1、风险与放行门      | 什么情况下能联调、灰度和上线           |

## 2. 当前唯一有效决策

| 领域                      | 已采纳结论                                           | 边界                                                                                            |
| ------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 产品                      | **OpenGame 支撑 PixelForge 全业务**                  | Create、Mod、Runtime Tuning、Operations Admin、发布、媒体、Feed、社区、账户与用量都要有后端认知 |
| 沙箱                      | **BoxLite**                                          | 不依赖腾讯沙箱；生产启用前必须等网络修复进入正式 release 并完成安全验收                         |
| 生产主库                  | **PostgreSQL**                                       | 保存租户、账户、作品、Revision、Job、Ops、媒体、社区、订单与账本                                |
| SQLite                    | **仅本地开发/单机运行账本**                          | 不承担 5–10 万 DAU 的社区主数据、队列或收入权威                                                 |
| 文件                      | **对象存储 + CDN**                                   | DB 只存不可变对象键、URL、hash、来源、尺寸和状态，不存大文件                                    |
| 任务编排                  | **现有 Job/worker 合同 + PostgreSQL lease**          | 不引入 Temporal；Redis 只做短期状态和广播，不做正确性权威                                       |
| 美术模型                  | **复用 OpenGame provider adapter**                   | 通义、豆包、OpenAI-compatible；不新建美术微服务                                                 |
| 图片处理                  | **把 sharp 提升为 `packages/core` 直接依赖**         | 复用现有实现；负责裁切、缩略、格式转换和确定性文字叠加                                          |
| 视频处理                  | **固定 FFmpeg capability**                           | Step 4 为现有 I2V/抽帧做 preflight，无能力则关 I2V；Step 8 产 H.264 MP4；首版不做 HLS           |
| 媒体版本                  | **`MediaAssetSet` 绑定 `revisionId + artifactHash`** | `Game.publishedMediaAssetSetId` 与 published Revision 原子切换；旧任务不得覆盖新版              |
| 封面策略                  | **横、竖两个无字母版**                               | thumbnail/OG 确定性派生；Hero 只为精选游戏生成，禁止每次修改都重生图                            |
| Runtime Tuning（GM 参数） | **`POST /api/ops/apply` 是唯一权威写入口**           | 退役 `/tuning` 双写；写入对目标 RevisionHead 做 CAS                                             |
| Mod                       | **CAS → BoxLite → QA → 新 Revision → 发布**          | 不原地覆盖文件，不绕过沙箱和 QA                                                                 |
| 3D v1                     | **primitive + 2D texture/billboard**                 | GLB/FBX、text-to-3D、骨骼换装与模型 Mod 另立里程碑                                              |
| 移动 Feed                 | **安全 attract / MP4 / 竖封面三级降级**              | 当前卡才运行；邻卡只预取 poster/metadata；缺策略不得默认放行                                    |
| 商业基础                  | **不整体迁入 ShipAny**                               | 可购买作账户、订单、积分、管理台的代码参考；核心权威仍在 Go + PostgreSQL                        |
| 实时状态                  | **REST event cursor + SSE**                          | v1 不同时维护 WS 公共合同；SSE 断线按 `Last-Event-ID` 恢复                                      |

## 3. 三个仓库的责任边界

| 仓库              | 负责                                                                       | 不负责                                                        |
| ----------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `pixelforge-web`  | Web/iOS/Android 交互、客户端状态、上传发起、Feed/播放/调参/运营/Mod 操作面 | 业务权威、假回执、生产 Mock、直接改游戏文件                   |
| `opengame-server` | 公共 API、鉴权授权、租户、Revision、Job、CAS、审核、发布、用量、社区与账本 | 在主进程直接执行不可信游戏、把 SQLite 当生产社区库            |
| `OpenGame`        | 生成引擎、GDD、游戏内资产、provider adapter 与版本化 worker I/O 合同       | 用户账户、社区主数据、支付权威、在宿主直接落盘/执行不可信项目 |
| BoxLite           | 承载 OpenGame 项目落盘、build、Mod、QA、截图/转码等写文件或执行进程的步骤  | 媒体主数据、任务编排、业务授权；命令不得来自用户字符串        |
| 对象存储/CDN      | immutable artifact、图片、视频与下载分发                                   | 版本选择、审核状态和授权判断                                  |

## 4. 已核实的当前差距

| 事实                                | 当前证据                                                            | 影响                                                    |
| ----------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------- |
| Web 启动即启用 MSW                  | `pixelforge-web/web/src/main.tsx:50-52`                             | 前端旅程不能证明真后端已闭环                            |
| Go 仅有 7 条基础 `/v1` 路由         | `opengame-server/internal/api/api.go:52-58`                         | 目录、Revision、Job、Mod、Ops、媒体、账户、社区均未实现 |
| Go 生产原型仍是 SQLite              | `opengame-server/go.mod:9`、`internal/store/store.go:1-16`          | 不能直接按 5–10 万 DAU 上线                             |
| Workspace 默认继承当前进程环境      | `opengame-server/internal/workspace/workspace.go:168-176`           | 沙箱接入前有密钥外泄风险                                |
| 媒体上传只绑定 game                 | `pixelforge-web/web/src/components/create/preview/uploads.ts:22-73` | 发布、并发修改和回滚会错配媒体                          |
| Web 视频播放受“未静音”控制          | `RuntimeSurfaces.tsx:264-271`                                       | 静音时反而不播放静音预览，策略含义错误                  |
| Android 缺策略时允许 attract        | `FeedAttractPreviewPolicy.kt:3-15`                                  | 未经安全认证的游戏可在浏览态运行                        |
| iOS/Android DTO 缺 cover 三字段     | `MobileGame.swift:105-161`、`MobileContracts.kt:411-447`            | 原生端无法消费横/竖/Hero 封面                           |
| GM 仍保留双写                       | `use-tuning-surface.ts:83-90`                                       | 两条状态链可能生成不同 Revision                         |
| OpenGame manifest 只有 type/key/url | `generate-assets-types.ts:136-145`                                  | 缺 hash、来源、Revision、许可、审核和 lineage           |
| 3D v1 明确不支持模型                | `generate-gdd.ts:629-640`                                           | 不得把基础 3D 宣称为模型生成/换装能力                   |

## 5. 执行纪律

| 规则           | 要求                                                                         |
| -------------- | ---------------------------------------------------------------------------- |
| 单一真相       | 新决策直接修改本目录对应条目，不新建“v2/最终版/新版”副本                     |
| 事实与目标分离 | **当前已实现**必须有代码证据；**目标态**必须有完成判定                       |
| 一步一门       | 上一步验收未通过，不启动依赖它的发布面施工                                   |
| 单写入口       | 同一业务动作只能有一个权威写入口；兼容路由只调用同一 service，不复制业务逻辑 |
| 可回滚         | 每步通过 feature flag、兼容读或旧 Revision 保留回滚路径                      |
| 依赖克制       | 先复用现有代码、stdlib、已安装依赖；只有验收指标证明不足才升级组件           |
| 分支与提交     | 一项可独立回滚的合同或能力一个 Conventional Commit；不得混入现有 3D WIP      |

## 6. 下一步从哪里开工

| 顺序 | 首批动作                                                                  | 完成判定                                                        |
| ---- | ------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1    | 冻结 PixelForge-facing API/DTO/OpenAPI                                    | Web、iOS、Android、Go 共用字段表与错误码，Mock 也从同一合同生成 |
| 2    | 给 MSW 增加环境闸和真后端 smoke                                           | `production` 绝不注册 MSW；测试环境可显式开启                   |
| 3    | 在 PostgreSQL 建 Game/RevisionHead/Revision/Artifact/Job/Event 的最小脊柱 | QA 后才创建不可变 Revision；重试不重复烧任务                    |
| 4    | BoxLite adapter 与环境白名单 PoC                                          | 沙箱内看不到 DB/Auth/对象存储主密钥，网络规则 fail-closed       |

完整顺序见 [execution-plan.md](execution-plan.md)。
