# 从 OhMyGame 学习游戏制作管线：源码补充研究

研究日期：2026-10-23。本文回应“不是照着抄，要学习制作游戏的更优管线”。它补充[此前的质量差异报告](./ohmygame-generation-quality-comparison-2026-10-23.md)，不重做截图、美术和音效比较，也不以某个样例外观作为平台目标。

OhMyGame 一手证据固定于提交 [`ca2df725cc4e836e1120ea1f3374e7b99021a903`](https://github.com/WhiteTowerAI/ohmygame/commit/ca2df725cc4e836e1120ea1f3374e7b99021a903)，本地只读副本为 `/private/tmp/ohmygame-quality-20261023`。本轮未运行该应用，未生成游戏或素材，未修改实现，未部署。OpenGame 的说明基于本轮读取时的本地 0.3.0 实现与既有实验记录，不表示线上已经升级。

## 主要判断

值得迁移的机制是：**先把玩家体验和首个可玩范围说清楚，用同一份设计和素材用途贯穿实现，再用实际操作、运行状态和画面证据修正具体问题。** 统一配色、城堡装饰、声音数量等只是某款游戏的结果，不是管线本身。

OhMyGame 公开实现也不能直接视为成熟的质量标准。它提供制作规约、专门知识、持久设计资料和可交互预览；这些组合给模型较完整的工作条件。但“按阶段做完”“达到玩法质量”“已完成视觉验收”主要依赖 agent 遵守指令，没有相应的统一宿主放行条件。应学习它如何减少决策和验证的盲区，同时保留 OpenGame 独立构建、隔离验证和失败不发布的边界。[新建游戏系统指令](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/agent-prompts.ts#L25-L34)、[制作技能](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/plugins/web-game-studio/skills/web-game-studio/SKILL.md#L22-L46)、[正常完成路径](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/agent.ts#L1120-L1176)。

## 1. 实际流程：宿主提供工作环境，agent 决定制作步骤

| 环节       | 源码中真正发生的事                                                                                     | 约束来自哪里                                                  | 尚不能据此声称什么                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 创建项目   | 建立工作目录和项目元数据，保留外部工作目录；这段创建方法本身不生成游戏设计、源码或质量阶段             | `ProjectManager.create` 的代码行为                            | 创建项目成功不等于已有可玩原型。[来源](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/projects.ts#L136-L162)                                                                                                                                                                                                                                                                                                                                             |
| 组织任务   | 系统指令要求新游戏使用制作技能；技能先区分新建、加功能、修错、润色和重构，再选择相关领域技能           | 系统提示 + 可用时读取的技能                                   | 不是每次修改都要重走概念图、美术和全项目重做。[系统提示](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/agent-prompts.ts#L27)、[任务分类](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/plugins/web-game-studio/skills/web-game-studio/SKILL.md#L10-L24)                                                                                                                                                        |
| 设计与范围 | 要求记录玩家幻想、主要循环、控制、进展、成败/重置、首个可玩范围、视觉方向及素材用途                    | 制作技能的工作要求；宿主提供 Markdown、索引和画布文件         | 没有代码判断“这些设计合理”“首个循环有趣”。[创建步骤](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/plugins/web-game-studio/skills/web-game-studio/SKILL.md#L26-L29)                                                                                                                                                                                                                                                                                                |
| 视觉与素材 | 技能要求关键界面参考、生产素材、运行时整合；媒体工具读取保存的节点、引用与模型设置，保存生成记录和文件 | 流程主要由提示约束；依赖存在、模型输入、生成状态由代码校验    | 生成成功不等于素材合适，也不等于最终游戏使用了它。[技能](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/plugins/web-game-studio/skills/web-game-studio/SKILL.md#L27-L31)、[工具返回](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/agent-tools.ts#L563-L587)、[引用与请求解析](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/canvas-workspace.ts#L479-L549) |
| 玩法实现   | 按当前引擎选专门知识；规则、渲染、输入、资源与状态有职责建议，规模按项目需要控制                       | 按需技能                                                      | 没有为所有游戏自动建立同一种完整架构，也不保证 agent 实际分离了这些职责。[基础边界](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/plugins/web-game-studio/skills/web-game-foundations/SKILL.md#L18-L42)、[Phaser 适配](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/plugins/web-game-studio/skills/phaser-2d-game/SKILL.md#L10-L34)                                                                                      |
| 试玩与修正 | `game_use` 在同一会话内可打开预览、发送真实输入、返回新快照和截图；技能要求按问题修正并复查            | 工具能力由代码实现；选择状态、判断缺陷、决定重试由 agent 执行 | 不是仅在最终交付前强制拍一张图，也没有统一的审美分数或玩法覆盖率。[工具](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/playtest-tools.ts#L84-L148)、[试玩工作流](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/plugins/web-game-studio/skills/game-playtest/SKILL.md#L18-L39)                                                                                                                                  |
| 回合结束   | 会话正常返回、无最终模型错误就标记 completed；完成回调启动预览、清理旧检查点，结束时清理试玩会话       | 代码行为                                                      | 这不是“所有阶段和质量条件已验收”的判定。[完成路径](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/agent.ts#L1145-L1176)、[回调](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/app.ts#L1020-L1030)                                                                                                                                                                                                    |

因此，将它描述成“宿主依次调用设计师、程序员、美术师、测试员，全部通过后发布”会超出证据。它是**一个 agent 在统一上下文中，按需使用专门规约和工具的制作流程**；文件和工具有约束，但阶段成果主要靠提示驱动。另有用户选择的规划/执行模式，其计划状态转换也不能当作游戏质量阶段。[会话与工具注入](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/app.ts#L942-L973)、[规划状态转换](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/agent.ts#L1594-L1603)。

## 2. 哪些机制可迁移，解决的是什么问题

以下“降低风险”和“代价”是根据源码提出的工程判断，不是已经完成对照实验的效果量。

### 2.1 把短提示转为玩家体验与可观察结果

制作技能没有从“选框架、写多少文件”开始，而是先明确玩家做什么、为什么继续玩、如何成功/失败/重置以及首个可玩范围；润色也要求对应一个可命名的玩家改善。这有助于防止模型用更多按钮、装饰或系统数量代替完整体验。[任务分类和设计要求](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/plugins/web-game-studio/skills/web-game-studio/SKILL.md#L12-L29)。

OpenGame 可以吸收的是一份短、可验证的设计约定。例如塔防中的“有限资源下选择位置与塔型，敌人推进制造压力，成功防守带来下一次投资”，比“三种塔、六波、有音效”更能指导实现和试玩。后者是可选的具体方案，前者说明这些方案应该产生的行为。

本研究建议先做足以检验这个循环的可玩片段，再扩大内容或投入昂贵素材。这是对 OpenGame 的适配建议，**不是声称 OhMyGame 代码已经强制先灰盒、后美术**；其技能写出的默认顺序包含先出关键界面参考。[原始顺序](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/plugins/web-game-studio/skills/web-game-studio/SKILL.md#L26-L29)。代价是增加早期决策与一次小范围检查，但可减少做完大批内容才发现基本玩法不成立的返工。

### 2.2 用当前设计约束后续决策，而非每轮重新猜意图

宿主每轮取得主设计文档的标题、源路径、revision 和画布索引，并把这些信息加入提示上下文；要求读取相关当前文件。显式引用的文档快照带自己的 revision，同时明确当前用户请求优先，编辑前要重读，不能把旧快照当现状。正文不是在所有回合无条件全文灌入。[设计上下文](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/game-design-context.ts#L6-L32)、[每轮注入](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/agent.ts#L1136-L1139)。

可迁移的是稳定的“当前设计—当前实现—已验证事实”关系，不必复制整套画布。设计里记录已选玩法、内容边界、资产用途和未确定事项；后续更改说明哪项选择改变了。它降低需求漂移、重复重做和跨回合失忆的风险。代价是需要维护简短资料，过期文档反而会误导，因此要跟随实质性决策更新，并区分用户要求、模型假设和实验结论。

### 2.3 把素材当生产依赖，区分参考与交付

技能明确要求资产表包含玩法角色、规格、来源和运行时目的地；参考画面不代替可用素材，空生成节点和未引用文件不算完成。系统另外指出生成目录里的文件不直接属于发布构建，要求通过游戏自己的导入路径进入产物。[资产责任](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/plugins/web-game-studio/skills/web-game-studio/SKILL.md#L26-L31)、[构建归属](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/agent-prompts.ts#L31-L32)。

代码确实保存生成请求、节点关系和运行记录；`canvas_check` 校验文件、索引、引用和媒体类型。但这个检查没有判定素材是否漂亮，也没有检查一般 Web 游戏源码是否实际使用了所有素材；后两项仍依赖 agent 查看与试玩。[生成记录](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/canvas-workspace.ts#L434-L466)、[画布检查范围](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/canvas-check.ts#L12-L55)。

OpenGame 可以对程序绘制、合成声音、本地素材、未来的生成素材使用同一用途清单。为每项资源说明它服务哪个动作或状态，如何确认进入最终构建和实际画面。此做法降低“花钱生成了但没用”“预览正常、发布缺资源”的风险。代价是增加资源追踪；没有必要为简单几何图形建立庞大的素材生产流程。

### 2.4 按领域补充知识，保持一份完成定义

制作技能要求只读当前工作需要的专门技能，跨领域任务共用一个计划和完成定义。基础技能强调规则状态与渲染、输入、存档边界，但明确小项目不需要企业级框架；Phaser 技能把场景作为规则状态与视觉、声音、输入之间的适配层。[路由规则](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/plugins/web-game-studio/skills/web-game-studio/SKILL.md#L33-L46)、[适度架构](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/plugins/web-game-studio/skills/web-game-foundations/SKILL.md#L18-L28)、[Phaser 职责](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/plugins/web-game-studio/skills/phaser-2d-game/SKILL.md#L10-L17)。

可迁移的是选择性提供帮助，而不是向所有任务追加更长的统一提示词。生成前按任务类型、游戏类型、已有能力选择少量相关经验和模块；检查也跟随本次改动的风险。它可降低无关知识占上下文、错误类比和润色破坏玩法的风险。代价是需要维护领域分类与相关性评估，不能把“载入技能”本身视为能力已经落实。

### 2.5 让制作过程能观察结果，而不只交出代码

`game_use` 的 `open` 和 `act` 返回新状态，`capture` 返回真实图像内容；工具支持逐步继续同一个会话，允许 agent 根据实际结果决定下一步。桌面驱动真正发送浏览器输入、调整视口、截取页面，还能返回 console/请求失败和画布可见性等证据。[交互工具](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/playtest-tools.ts#L84-L148)、[真实输入与截图](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/desktop/playtest-driver.ts#L263-L350)、[状态读取](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/desktop/playtest-driver.ts#L616-L649)。

关键不是“多拍几张图”，而是**这次输入是否发生了预期变化，玩家是否看得懂变化，再据此决定改哪里**。先定义有意义的状态及结果，例如资源不足、执行主要动作、产生收益或伤害、失败、重新开始；不能靠同一局的几个不同尺寸截图代表全部状态覆盖。

观察能力有明确边界：工具只在驱动可用且支持项目类型时注册；限制预览路径不能跳出当前项目来源；试玩会话属于当前对话并可统一清理。[注册条件](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/agent-tools.ts#L589-L591)、[来源限制](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/playtest-tools.ts#L162-L166)、[会话所有权](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/owned-playtest.ts#L3-L38)。OpenGame 可在现有隔离检查环境里提供受控的观察与操作，不需要开放宿主或任意浏览器。代价是额外运行时间、模型观察成本和状态管理复杂度。

### 2.6 把规则证据、画面证据、体验判断分开

试玩技能区分基础启动、功能、回归、视觉和性能检查，要求分别记录；代表性 Canvas 状态需截图，DOM 不足以确认画面。难以通过真实输入稳定到达或识别的重要状态，可以加最小的 `snapshot/reset/setSeed/step` 测试桥，但不能用桥接替代真实输入和截图，也不应为普通试玩强加桥接。[检查分型](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/plugins/web-game-studio/skills/game-playtest/SKILL.md#L10-L37)。实际驱动仅发现并调用这些已实现的方法，不替游戏提供正确性断言；截图空白检测也被明确限定为提示。[桥接执行和读取](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/desktop/playtest-driver.ts#L595-L649)、[空白检测边界](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/plugins/web-game-studio/skills/game-playtest/SKILL.md#L39-L51)。

OpenGame 应把“实际执行成功”“状态结果正确”“画面能看清”“体验有趣/节奏合适”作为不同结论；后两项不能仅由文本断言或无报错推出。测试桥若增加，也应为可重复状态服务并受限于隔离环境，不能允许模型用测试专用逻辑伪造通过。代价是验收信息更细，但能减少以局部通过冒充整款游戏完成。

## 3. 不应直接照搬的部分

| 不应照搬                                         | 原因与适配方向                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 固定美术风格、界面布局、装饰密度或每款相同音效表 | 源码要求围绕玩家幻想、主要动作和当前决策，已有项目保留风格；因此应提炼决策原则，而非复制塔防样例外观。[视觉决策](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/plugins/web-game-studio/skills/game-ui-frontend/SKILL.md#L8-L22)                                                  |
| 所有任务必做关键画面生图、生产生图、再写代码     | 其默认流程有可用媒体能力前提，并允许范围例外；OpenGame 的成本、延迟和可用素材能力不同。应先判断不确定性在玩法、交互还是视觉，再选择最便宜的验证方式。[范围与降级](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/plugins/web-game-studio/skills/web-game-studio/SKILL.md#L24-L31) |
| 把技能里的要求当成代码已经强制的阶段             | 插件/组件只有启用且支持项目类型才进入技能列表，执行步骤仍由 agent 选择。必须分别记录“要求做”“可以做”“实际做了”“结果通过”。[技能解析](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/plugin-runtime.ts#L75-L98)                                                         |
| agent 正常结束就认定游戏质量通过                 | 完成路径没有核查设计覆盖、截图数量、核心循环或美术分数。OpenGame 已有的独立验证应保留；客观门禁和主观判断分开。[完成路径](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/agent.ts#L1168-L1176)                                                                         |
| 无限自检、或无论缺陷都固定追加同一种润色         | 所读技能要求针对缺陷修复与复查，并明确不能对不变的生成失败无限重试；没有证据支持“回合越多质量必然越高”。OpenGame 应设置总预算和有依据的停止条件。[修复与降级要求](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/plugins/web-game-studio/skills/web-game-studio/SKILL.md#L29-L31) |

## 4. 对现有 OpenGame 0.3.0 改动的重新定位

现有改动中，可复用声音模块、受限真实操作、截图回传、独立复验是制作管线的基础能力。它们有明确价值，但不应再用“画面像右图”“声音种类更多”作为总目标。声音模块是一种实现手段；截图是一种观察证据；需要由每款游戏的玩家体验和失败风险决定如何使用。[已完成改动与测试记录](./ohmygame-generation-quality-comparison-2026-10-23.md#用户确认后的平台改进030)。

本轮读取时，编排固定为首次制作/检查，再一次截图复查/检查；每阶段最多一次技术修复。四张图是开始后、操作后及同一局的宽窄视口。它主要补上了“模型看不到自己产物”的缺口，但还不是按不同玩法建立的制作与测试过程，也不能据此证明进展、失败、节奏或多轮循环正确。[当时的编排](../../packages/web/src/server/game-generation.ts#L43-L79)、[截图定义](../../packages/web/src/shared/game-quality.ts#L1-L7)。上述文件后续可能继续修改；这里描述的是本研究读取时的状态。

建议用以下可检查的成果串联后续流程，避免为阶段名称本身增加调用次数：

| 成果             | 要回答的问题                                                 | 继续投入的依据                                           |
| ---------------- | ------------------------------------------------------------ | -------------------------------------------------------- |
| 简短体验约定     | 玩家主要做什么选择？什么变化构成反馈和进展？本次范围是什么？ | 可观察的主要动作、结果、成败/重置和代表状态已明确        |
| 最小可玩片段     | 这个选择和结果在实际运行里成立吗？                           | 真输入与状态证据；若核心行为不成立，先修玩法             |
| 与玩法结合的表现 | 玩家能否识别对象、理解因果、及时做下一次决定？               | 为相关状态选择所需画面、动作、声音和资源；在实际尺寸观察 |
| 问题驱动的迭代   | 当前阻碍是什么，改动是否解决了它？                           | 每项修复关联复现、玩家影响和复验证据；无重要缺陷则停止   |
| 独立交付检查     | 最终代码是否保持可运行，关键行为是否仍满足约定？             | 平台控制的最终构建/检查；未覆盖部分明确记录              |

这是本文提出的 OpenGame 方案，不是 OhMyGame 原样流程。对于小修改可以合并或跳过无关成果；“最小可玩片段”也不意味着发布灰盒，更不需要对简单任务先生成长设计稿。应把预算优先放在本次最大的不确定性上。

## 5. 用一手游戏设计研究校验方向

Hunicke、LeBlanc 和 Zubek 的 MDA 论文把规则、运行中的交互行为和玩家体验区分开，强调在这些层次之间反复推演、试玩和调整。文中的 aesthetics 指玩家感受，不是狭义的画面美术。它支持以期望体验指导规则并用实际行为检验的思路，但没有证明任何具体 AI 管线优于另一种。[原论文，第 2–4 页](https://users.cs.northwestern.edu/~hunicke/MDA.pdf)。

因此，本次学习是否有效，应在不同类型游戏中比较：第一项操作是否自然、核心循环是否闭合、结果是否可理解、失败与重开是否正确，以及达到这些结果所需时间和成本。塔防样例可以暴露具体问题，不能成为全平台视觉模板；一次成功生成也不能证明稳定性。此前报告中的单次 868 秒实验证明截图修正流程可执行，并没有给出跨类型质量提升的统计证据。[原样例记录](./ohmygame-generation-quality-comparison-2026-10-23.md#原提示词的真实生成与试玩)。

## 适合 OpenGame 的六条管线启示

1. **按任务和游戏类型组织制作。** 先确定玩家动作、循环、范围和可观察结果；新建、修改、修错、润色走与风险相称的流程。
2. **尽早验证最关键的不确定性。** 用最小可玩片段确认行为，再投入内容和表现；视觉本身是核心时可先验证关键画面，但不把概念图算作成品。
3. **让设计、素材用途和运行证据贯穿各回合。** 记录当前版本、假设与事实，维护资源在最终游戏中的用途；不要求复制画布产品形态。
4. **让模型能操作并观察实际游戏。** 围绕代表状态收集真实输入、结果、截图和错误，按需要在受控环境继续检查，而非只在结尾观察同一状态。
5. **用有依据的修正和停止条件管理迭代。** 先修阻碍玩法的问题，再修理解与表现问题；保留总预算、失败回退和独立复验，避免机械增加润色次数。
6. **评估体验与成本，不评估相似度。** 用多个游戏类型、相同预算和盲评比较可玩性、辨识、反馈、稳定性与耗时；明确区分技术通过、视觉观察和人类体验判断。
