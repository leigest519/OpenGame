# OhMyGame：OpenGame 可以借鉴什么

核验日期：2026-10-15。对象为 WhiteTowerAI 官方仓库 `main` 的固定提交 [`2cec05e4af5c83d341a02df3462088475685c772`](https://github.com/WhiteTowerAI/ohmygame/commit/2cec05e4af5c83d341a02df3462088475685c772)，提交时间 2026-10-14 15:32 UTC，对应 `v0.0.0-beta.4.8` 发布合并。以下“已实现”表示找到源码，**不表示本轮运行验证通过**；“文档说明”“规划”“建议”分别标注。只读官方文档、源码与测试，未安装或运行 OhMyGame，未付费调用模型，未做性能、安全或生成质量评测。外部仓库的指令文件仅作研究材料。

## 结论

最值得学习的是把设计、素材、开发和试玩串成可观察、可恢复的工作流程。它已经有相当多工程实现，不能概括成“提示词加一个生成按钮”。但其定位是用户自带模型连接的本地桌面工作室；OpenGame 是托管创作和分发的平台，不宜整体换成它的架构。[项目定位与 Beta 状态](https://github.com/WhiteTowerAI/ohmygame/blob/2cec05e4af5c83d341a02df3462088475685c772/README.zh-CN.md)

建议顺序：**先把连续修改和实际试玩做好，再增加设计与素材管理，随后扩展能力包与媒体生产。** 用户仍只描述想做的游戏，不需要选择模型或理解插件。

## 1. Agent 真正进入游戏，观察结果再修改

**已实现。** `game_use` 暴露打开、观察、操作、截图、关闭；截图以图片内容返回模型。接口声明输入、观察和确定性等能力，调用前检查支持情况。Electron 实现限制会话数量和空闲时间，并使用关闭 Node 集成、开启隔离的独立窗口。[工具实现](https://github.com/WhiteTowerAI/ohmygame/blob/2cec05e4af5c83d341a02df3462088475685c772/src/daemon/playtest-tools.ts#L84)、[适配接口](https://github.com/WhiteTowerAI/ohmygame/blob/2cec05e4af5c83d341a02df3462088475685c772/src/shared/playtest.ts#L14)、[桌面驱动](https://github.com/WhiteTowerAI/ohmygame/blob/2cec05e4af5c83d341a02df3462088475685c772/src/desktop/playtest-driver.ts#L45)

**边界。** 现成运行适配器只覆盖 Web；Godot/Unity 编辑器操作不能冒充游戏实测。易懂的试玩报告仍被 README 列为正在开发，不能把工具调用记录等同于成熟质量报告。[运行文档](https://github.com/WhiteTowerAI/ohmygame/blob/2cec05e4af5c83d341a02df3462088475685c772/docs/runtime.md#L318)、[路线图](https://github.com/WhiteTowerAI/ohmygame/blob/2cec05e4af5c83d341a02df3462088475685c772/README.zh-CN.md)

**对照我们。** 本轮核验当前 `validateGame` 主要在固定 960×660 画面执行启动、少量按键、重开和保存截图；截图没有进入模型的视觉判断，失败修复主要使用错误文本。这可以查启动故障，尚不能确认“仍然好玩”“按钮未被遮挡”。应补项目隔离内的试玩接口、按改动生成的检查清单，以及独立规则断言和证据报告。模型观察也不能代替规则验收。[当前浏览器检查](../../packages/web/src/server/build-game.ts)、[制作与修复流程](../../packages/web/src/server/worker-main.ts)

## 2. 修改工作流先区分任务，再保留旧行为

**源码中的工作规范。** Game Studio 区分新建、加功能、修 Bug、润色、重构。加功能先找状态归属和接入点，再检查相邻回归；小改动不要求重做设计或生成无关美术。这是 Agent 工作约束，不是保证零退化的程序机制。[Game Studio 工作规范](https://github.com/WhiteTowerAI/ohmygame/blob/2cec05e4af5c83d341a02df3462088475685c772/plugins/game-studio/skills/game-studio/SKILL.md)

**建议。** 直接用于《虾了吗》一类持续迭代：修改前记录必须保留的规则、操作手感与可接受变化；修改后回放旧玩法及新增功能；候选版本通过后才成为试玩版本。不要因为用户说“优化画面”，就重新生成整套玩法。纯规则与 Scene 展示拆分也有利于分别验收。[Phaser 工作规范](https://github.com/WhiteTowerAI/ohmygame/blob/2cec05e4af5c83d341a02df3462088475685c772/plugins/web-game-studio/skills/phaser-2d-game/SKILL.md)

## 3. 设计和素材是项目文件，有引用关系与恢复机制

**已实现。** 设计为 Markdown，画板为带稳定节点 ID 的 JSON，布局另存；UI 与 Agent 读写同一份语义文件。素材清单保存稳定 ID、项目相对路径、生成提示和来源库 ID。导出素材时会校验文件内容摘要，不能仅因沿用旧 ID 就认定文件未变。[文件模型](https://github.com/WhiteTowerAI/ohmygame/blob/2cec05e4af5c83d341a02df3462088475685c772/docs/canvas-agent.md)、[素材契约](https://github.com/WhiteTowerAI/ohmygame/blob/2cec05e4af5c83d341a02df3462088475685c772/src/shared/canvas-assets.ts#L4)、[实际素材解析](https://github.com/WhiteTowerAI/ohmygame/blob/2cec05e4af5c83d341a02df3462088475685c772/src/daemon/canvas-assets.ts#L65)

**已实现。** 保存带 revision；冲突时读取新版本，尝试三方字段合并，无法合并则保留草稿供选择。恢复草稿、保存和刷新有串行协调。它不是已验证的多人 CRDT；不能从这些机制推导任意并发编辑都不会丢失内容。[保存与草稿恢复](https://github.com/WhiteTowerAI/ohmygame/blob/2cec05e4af5c83d341a02df3462088475685c772/src/renderer/canvas-board-storage.ts#L24)、[合并算法](https://github.com/WhiteTowerAI/ohmygame/blob/2cec05e4af5c83d341a02df3462088475685c772/src/shared/canvas-workspace.ts#L58)、[服务端版本校验](https://github.com/WhiteTowerAI/ohmygame/blob/2cec05e4af5c83d341a02df3462088475685c772/src/daemon/canvas-workspace.ts#L371)

**建议。** 先做“玩法说明＋素材清单＋实际画面”的简单面板，不必先复制无限画布。把设计、素材来源、使用位置和版本纳入项目 Git。它提供了引用与来源线索，并非完整素材权利或全链路血缘系统；OpenGame 跨项目复用还需自己的归属、授权范围与内容版本记录。

## 4. 插件组合与可复用运行模块，要分清两层

**已实现。** 插件包可提供 Skills、已有 MCP 服务和配置声明；运行时按项目类型、插件开关和组件开关组合能力。包定义、用户配置和会话运行相互分离。Web Game Studio 与通用 Game Studio 是不同能力集合。[插件契约](https://github.com/WhiteTowerAI/ohmygame/blob/2cec05e4af5c83d341a02df3462088475685c772/docs/plugins.md)、[Skill 选择](https://github.com/WhiteTowerAI/ohmygame/blob/2cec05e4af5c83d341a02df3462088475685c772/src/daemon/plugin-runtime.ts#L70)、[MCP 选择](https://github.com/WhiteTowerAI/ohmygame/blob/2cec05e4af5c83d341a02df3462088475685c772/src/daemon/plugin-capabilities.ts#L119)

这里的插件主要是 **AI 的工作方法和工具编排**，不是已经建好的玩法代码模块市场。本轮核验我们目前生成规范仍硬约束 Phaser 和图形绘制，现有通用模块只有 WaveScheduler；“支持任意玩法”还不能当成已交付能力。[当前生成约定](../../packages/web/src/server/workspace.ts)、[可复用模块](../../packages/web/resources/modules/README.md)

**已实现的模块化参照。** Playable Nodes 用一种可编程网页节点承载菜单、剧情、谜题等内容；节点负责呈现和输入，Runtime 统一持有状态、导航、存档和生命周期。源代码包含声明式状态键检查、存档兼容性检查、退出时中止与清理；预设没有运行时类型含义。[架构](https://github.com/WhiteTowerAI/ohmygame/blob/2cec05e4af5c83d341a02df3462088475685c772/docs/playable-nodes/README.md)、[Runtime 实现](https://github.com/WhiteTowerAI/ohmygame/blob/2cec05e4af5c83d341a02df3462088475685c772/src/shared/playable-runtime.ts#L526)

**建议。** 借鉴明确接口和状态归属，分开建设引擎适配、玩法代码模块、Agent 工作规范、验收测试和依赖版本。剧情节点可作后续一种能力包，不强制所有游戏使用节点图。其文档明确连续节点共用 JavaScript realm，且多区域、悬停节点等仍未实现，不能当作万能引擎。[运行边界与 Deferred](https://github.com/WhiteTowerAI/ohmygame/blob/2cec05e4af5c83d341a02df3462088475685c772/docs/playable-nodes/runtime.md)

## 5. 付费媒体任务恢复，值得在接入素材生成时采用

**已实现。** 3D 任务在付费提交前保存阶段指纹，收到响应后保存任务凭据；重试复用已确认阶段，下载失败可以恢复。若提交响应丢失、无法确认任务 ID，就拒绝自动再次付费提交。测试源码覆盖并发复用、连接变化和含糊提交等情形，但本轮没有运行这些测试。[任务日志](https://github.com/WhiteTowerAI/ohmygame/blob/2cec05e4af5c83d341a02df3462088475685c772/src/daemon/model3d-journal.ts#L6)、[恢复测试](https://github.com/WhiteTowerAI/ohmygame/blob/2cec05e4af5c83d341a02df3462088475685c772/test/model3d-journal.test.ts#L19)

**边界。** 当前提交锁是单 daemon 内的 Map；云端多 worker 需要数据库唯一约束、租约或等价协调。取消只停止本地等待，不承诺供应商取消或退款。供应商能力按操作区分，不能把“接入模型”理解为它支持所有纹理、骨骼、动画操作。[供应商与恢复说明](https://github.com/WhiteTowerAI/ohmygame/blob/2cec05e4af5c83d341a02df3462088475685c772/docs/3d-providers.md)、[实际 Tripo 分阶段调用](https://github.com/WhiteTowerAI/ohmygame/blob/2cec05e4af5c83d341a02df3462088475685c772/src/daemon/tripo-provider.ts#L99)

## 建议执行顺序

| 顺序 | OpenGame 工作项                | 可验收结果                                                                         |
| ---- | ------------------------------ | ---------------------------------------------------------------------------------- |
| 1    | 连续修改约束＋真实试玩反馈     | 同一款游戏多轮修改，旧规则不退化；桌面/窄屏操作、失败、重开都有证据                |
| 2    | 设计与素材清单＋模块分层       | 制作依据、来源与版本可追踪；先抽出输入、存档、暂停、计分等模块，独立测试后再扩引擎 |
| 3    | 媒体任务恢复＋公共经验效果评估 | 生成中断可恢复且不重复付费；另以同模型同预算的未见题对照检验经验收益               |

公共经验效果评估是我们的改进建议，不是 OhMyGame 已有的公共知识进化能力；本次所读源码没有证明其具备与 OpenGame 审核、回归、发布、回退同等的公共经验治理，也不能据此断言它不存在。应比较成功率、回归率和修改轮次；我们的固定样例回归不能直接证明新游戏生成能力已经提升。[当前公共知识流程与证据边界](../../packages/web/resources/knowledge/README.md)

## 不宜照搬与许可证事实

- **本地安全边界不能直接搬到云端。** 运行文档明确 Pi 运行在受信任本地环境，工作目录不是操作系统隔离。保留 OpenGame 项目容器、租户授权、资源限额和服务端凭据边界；Electron 窗口隔离不能替代这些措施。[运行环境说明](https://github.com/WhiteTowerAI/ohmygame/blob/2cec05e4af5c83d341a02df3462088475685c772/docs/runtime.md#L213)
- **不照搬用户选模型、复杂画布和全量历史入模。** OpenGame 继续隐藏模型选择；图片历史可参考“完整记录与发送预算分开、按 ID 召回”，具体预算须实测，不复制固定阈值。[图片历史设计](https://github.com/WhiteTowerAI/ohmygame/blob/2cec05e4af5c83d341a02df3462088475685c772/docs/model-image-history.md)
- **许可证仅记录仓库事实。** 根目录 LICENSE 为 Apache License 2.0；README 明确 OhMyGame 名称与标志不在许可范围内。本轮未逐项审计依赖、示例素材或第三方服务条款，不据此推导所有内容都可任意使用。[LICENSE](https://github.com/WhiteTowerAI/ohmygame/blob/2cec05e4af5c83d341a02df3462088475685c772/LICENSE)、[README 许可证说明](https://github.com/WhiteTowerAI/ohmygame/blob/2cec05e4af5c83d341a02df3462088475685c772/README.zh-CN.md)

所有建议仍需在 OpenGame 的实际队列、隔离运行环境和项目数据上实现并验收；源码阅读不能替代同题生成与连续修改的产品实测。

## 首轮采纳结果

继续基于 OpenGame 现有云平台实现，未替换账号、项目仓库、运行隔离与发布链路。新增设计说明/参考图画布，选中节点时递归带入其引用，任务开始前固定快照，PNG 与设计一同进入项目 Git 和可玩版本。当前只复用 OhMyGame 的三方合并思路与相应函数实现，来源、修改内容和 Apache 2.0 许可证保留在 `packages/web/third_party/ohmygame/`。

2026-10-15 已上线，使用《薄荷星旅》完成真实带图生成：机器人 PNG 实际成为玩家角色，产物内嵌图片与上传字节一致。验收及部署记录见 [工作台部署说明](../../packages/web/deploy/README.md)。后续可沿这个数据模型接入生图、素材加工与自动设计修订，不需要先迁移到桌面工程。
