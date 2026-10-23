# OhMyGame 游戏生成质量差异研究（2026-10-23）

## 研究范围与证据边界

本文对 OpenGame 的差异分析记录的是改进前的 0.2.0 基线；用户随后要求实施，0.3.0 的本地改动与验收记录见文末。基线结论不代表这些改动已经部署到线上。

**后续方向修正：** 用户进一步明确目标是学习更好的游戏制作管线。下文“先补视觉要求、音效与末尾复查”属于第一轮候选方案，已验证部分工具能力，尚未证明完整制作流程或生成质量提升。后续以 [游戏制作管线设计及0.4实施记录](game-production-pipeline-design-2026-10-23.md) 的体验定义、代表片段、制作中观察、按证据修复和独立验收为方向；最小闭环已接入本地候选，尚未部署。本文和 0.3 测试记录保留作历史证据，不代表 0.4 的当前文件。

本稿的 OhMyGame 部分只依据公开仓库的一手源码，研究时间为 2026-10-23（Asia/Shanghai）。读取的是 `main` 分支提交 [`ca2df725cc4e836e1120ea1f3374e7b99021a903`](https://github.com/WhiteTowerAI/ohmygame/commit/ca2df725cc4e836e1120ea1f3374e7b99021a903)，提交时间为 **2026-10-23 12:36:18 +08:00**，提交说明为合入 `v0.0.0-beta.4.13` 发布 PR。只读检出位于 `/private/tmp/ohmygame-quality-20261023`；没有运行该应用、调用媒体生成服务或修改其源码。

用户补充的原始请求是：“我想做一款2d的塔防游戏，类似保卫萝卜，但是主题变成乐高风格”；模型被用户称为“chatgpt astra”。这尚不能确定两次使用的 backend、具体模型 ID、推理档位、平台版本、插件开关、生成次数或上下文一致。以下是当前公开实现的机制分析，不能倒推截图那一次确实执行了某个技能、生成图片、调用音频服务或完成视觉复查。

## 结论与优先级

**最有证据的差距是默认制作要求和观察成品的反馈流程。** OpenGame 当前精确规定工程入口、依赖、文件、开始/重开和权限；OhMyGame 另外把美术方向、主题化 UI、素材落地和真实画面检查列为新游戏的默认交付内容。同一句用户需求经过两边包装后，模型实际收到的任务不同。具体到这次产物，尚不能量化各因素的贡献。

截图右侧的场景装饰、材质层次、城堡造型和状态区更完整，这个观察成立；但左图已暂停、选中了炮塔，右图是首波前的建造状态，两个视口比例也不同。经用户后续授权读取 OpenGame 的实际产物并在本机复现，现已确认左图的泛灰来自暂停遮罩、游戏存在三种塔、没有实现游戏音效，宽屏两侧留白来自固定比例缩放。右侧声音更完整来自用户的实际体验反馈；本轮没有读取 OhMyGame 的该次生成项目，不能确认其声音具体来源。

| 对比项       | OpenGame 当前实现                                        | OhMyGame 当前公开实现                                | 判断                                     |
| ------------ | -------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------- |
| 默认制作任务 | 原创玩法 + 工程约定 + 项目记忆；2D 没有具体美术交付清单  | 设计、关键画面、美术素材、玩法和试玩                 | 高可信的流程差异                         |
| 2D 视觉指导  | 可用 Phaser 图形；参考图按要求使用；3D 另有构图/光线要求 | 主题、镜头、材质、配色、字体、信息层级、动效都有指导 | 有助于解释右图完整度，但不是单次因果证明 |
| 素材获取     | 接收 PNG/JPEG；游戏执行器关闭外部服务，优先本地绘制      | 可复用/生成素材并要求进入最终构建                    | 能力差异，不代表右图使用了生图           |
| 音效         | 没有默认事件清单；常规音频文件链路未接齐；合成声音可行   | 有按配置启用的音效/音乐生成工具；未发现必做清单      | 不能把右图的声音直接归因到音频插件       |
| 画面复查     | 保存一张截图；没有送回模型评审                           | 真实输入、截图以图片返回 agent，可继续修改           | 高可信的反馈流程差异                     |
| 结束条件     | 构建/启动/重开通过就保存；技术失败才修复一次             | 指令要求自检，但没有宿主强制的美术/音效门禁          | 两边都不能把“任务完成”当作质量保证       |

下文分别提供本地代码、公开源码和实验依据。建议先补 **2D 交付要求、合成音效、截图复查**，再决定是否投入完整素材生成链路；没有证据支持必须先换引擎或换模型。

## 截图里实际能看出的差异

| 观察维度     | 左图：OpenGame                           | 右图：OhMyGame                                                   |
| ------------ | ---------------------------------------- | ---------------------------------------------------------------- |
| 场景层次     | 主要是底板、道路、塔位、炮塔与终点       | 额外有树木、花、路面拼接和更清楚的边缘层次                       |
| 积木主题表达 | 凸点和砖块形状已经存在，终点造型较简     | 底板、树木、炮台、城堡和图标的造型更丰富，城堡有屋顶、塔楼与门洞 |
| 信息层级     | 顶部小型数值牌，右侧显示当前塔的升级详情 | 货币/生命/波次有图标与强调色，底部塔种类有预览、名称、用途和价格 |
| 当前操作引导 | 当前是选中炮塔与暂停后的继续操作         | 直接提示点击“+”底座，建塔和开波入口相邻                          |
| 可比较性限制 | 已暂停，1/6 波，已有炮塔，宽视口         | 0/8 波，未建塔，视口较窄                                         |

授权后的源码和运行检查已把“左图可能有暂停遮罩”确认为事实：暂停时叠加 25% 不透明度的深绿色遮罩。左图选塔详情与右图建造商店不是同一 UI 状态；OpenGame 的建造菜单实际提供三种塔。静态截图仍不足以评估两者的完整胜负流程、声音听感或手机适配，具体复现证据见下一节。

## 授权后的实际产物核对与复现

用户在本聊天明确回复“允许”，授权只读分析两份线上《积木守卫队》的代码和设计，并汇报相关结论。检查限定于这两份已定位工作目录，未修改任何线上文件或服务；从只读副本构建，在本机临时服务与浏览器中操作。没有读取其他项目、账号凭据或 OhMyGame 的私有生成项目。

### 1. 两个目录保存的是同一份实现

`8cd5a616-79b4-4e50-8fcc-a7694f0fb175-1` 与 `3e689623-bc06-4027-a31f-4d56ccaaa892-1` 中复制用于分析的十个文件逐字节一致，包括三个源文件、配置、设计、计划、记忆与素材清单。`src/main.ts` SHA-256 为 `274146c3f2930533ab046eb990c1adf901e6dfad50828a7cc3852e7ef3a39c6f`。两份目录不代表两种不同质量的作品。[文件摘要与源码证据](../../output/ohmygame-quality-comparison-2026-10-23/source-evidence.json)

保持源码原样，放置三个积木炮并完成第一波，得到 **149 币、12 生命、1/6 波**，与用户截图一致。选中左上炮塔，再切换暂停即可复现截图中的详情面板和灰绿色地图。Chrome `155.0.8059.85` 下此流程无页面异常；这项验证覆盖首波和部分操作，不等于完整通关或全部塔种验证。[运行记录](../../output/ohmygame-quality-comparison-2026-10-23/verification.json)

### 2. 无声来自未实现音效

完整检查 `src/main.ts`、波次模块、设计、计划、配置与素材清单，没有游戏音频资源、加载/播放调用或合成声音代码；设计任务与验收清单也没有音效。建塔、升级、射击、命中、奖励和结束逻辑均未调用声音。Phaser 引擎本身带有音频能力不等于这份游戏使用了它。因此这份产物的无声可以解释为**声音未进入交付范围和实现**，无需以浏览器拦截或外部服务缺失作为前提。[音频检索与源文件摘要](../../output/ohmygame-quality-comparison-2026-10-23/source-evidence.json)

结合前面的 Web Audio 可用性实验，低成本改进路径已经明确：在默认设计和交付规范中纳入适合玩法的声音，并提供可复用合成器。仍不能据此判定 OhMyGame 的那份作品用了程序合成、音频文件还是媒体服务。

### 3. 暂停遮罩与失焦暂停是明确实现

`src/main.ts:34` 在 `paused` 时使用 `0x244734`、alpha `0.25` 覆盖整个 760×520 地图；第 39 行监听窗口失焦和页面隐藏，自动进入暂停。这能解释用户切换窗口后看到灰绿色画面的现象。恢复运行后颜色会还原，右侧开始波次按钮也会恢复可用。[源码摘录](../../output/ohmygame-quality-comparison-2026-10-23/source-evidence.json)

未暂停状态：

![OpenGame 原始源码复现：未暂停](../../output/ohmygame-quality-comparison-2026-10-23/wide-running.png)

相同状态下暂停：

![OpenGame 原始源码复现：暂停](../../output/ohmygame-quality-comparison-2026-10-23/wide-paused.png)

### 4. 宽屏留白来自固定地图比例，而非内容加载缺失

地图固定为 760×520，使用 `Phaser.Scale.FIT` 居中放入可伸展的主场景，控制区在右侧。1460×660 复现视口中，主场景容器为 1214×546，实际 canvas 约 795×544，左右合计约 419 像素空白，占容器宽度约 **34.5%**。它完整显示了地图，但没有利用宽屏扩展场景或调整整体构图。[尺寸实测](../../output/ohmygame-quality-comparison-2026-10-23/verification.json)

在 960×600、700×520 的本轮状态下，开始波次、重开和选塔面板均在视口内，没有横向溢出；700×520 因宽度约束则出现地图上下留白。因此应区分“能完整显示”和“空间安排漂亮”，不能把这次的不足统称为响应式失效。

### 5. 美术与反馈的确只做到较简的程度

地图绘制只包含底板凸点、道路、标题和简化城堡，没有右图中的树木、花等装饰层。三个塔共享砖块加炮管的基本轮廓，主要以颜色、炮管粗细和冰冻圆环区分；建造菜单图标也是通用彩色积木块。射击采用即时伤害配短暂射线和冲击环，没有飞行弹丸；被击败的敌人直接移除。这些是当前代码的实际取舍，并非 Phaser 能力限制。

菜单中确有积木炮、弹珠投射器、冰冻积木塔；不足在于视觉辨识与表现细节，而不是塔种不存在。右侧的造型、场景装饰和塔预览更丰富，这项截图观察在排除暂停遮罩之后仍然成立。[建造菜单复现](../../output/ohmygame-quality-comparison-2026-10-23/700x520-build-menu.png)

### 6. 本次计划与经验提供了哪些方向

实际 `development-plan.json` 包含程序绘制的积木视觉、三塔经济循环、单关卡波次与结算，验收点对应主题可辨、建造操作、塔效果区分与胜负，没有列入声音、地图装饰密度、轮廓差异或运行截图评审。`memory.md` 记录生成阶段仅做 JSON 配置解析，未做编译/浏览器检查；随后平台追加启动与重开检查通过记录。这与平台“生成后独立做基础检查”的实现一致。

第一份工作目录的知识快照实际含五条经验：容器布局、波次生命周期、刷怪配额、匹配消除的障碍/断桥结算、固定比例画布外的触屏控制。两条布局经验确实被提供给本次任务；其中还有与塔防贴合度较低的消除结算经验。它们未覆盖美术或声音，可以作为改进检索相关性的依据，但仍不能单独证明这些经验造成了某个画面缺陷。

## OpenGame：已核实的实现与实验

本地工作树基于 `d55f0839b887ac94d52fd5ad7b2fdedc18306220`，含用户已有未提交修改，本报告以读取时的实际文件为准。对线上服务目录做了只读核对：下表五份文件的 SHA-256 与本地逐项一致。因此相关流程分析不是仅针对一个尚未上线的本地草稿；这仍不能反推截图生成时的历史配置。

| 文件                             | 核验的 SHA-256                                                     |
| -------------------------------- | ------------------------------------------------------------------ |
| `src/server/workspace.ts`        | `7439e1ef77dd07af9c2ac76f42a7a4a81a40e2e64a3b9826e77b7fe594831211` |
| `src/server/build-game.ts`       | `d5f09ce902a17512906c86479a4ba56f60131770fb8105c8c2d1f9ed124606f2` |
| `src/server/generator-policy.ts` | `29acaab6181c42c156bf479aba1a33af2419c9acf985b382c5b9d5b422430576` |
| `src/server/conversation.ts`     | `63a1ee79c766550e8348a52413f0e4f5bcdab9444a6023c8bbc029ad1476dc16` |
| `resources/standards/0.2.0.md`   | `a01cf5980934b9871b9f9ab454aa8dc38869ef8cd0e418579748f1e23eb2a2bf` |

### 1. 生成器拿到的重点偏向工程约定

`makePrompt` 拼入基础规范、工程约定、项目历史、知识快照、选中素材和任务计划。它明确规定 Phaser、入口文件、按钮标识、禁止外部依赖、项目文档与经验归纳；对 3D 明确提出构图、材质、冷暖光和动态，对 2D 则主要写“Phaser 图形”和参考图用途。要求创建 `design.md` 不等于已有一套必须覆盖美术方向的设计流程。[实际提示词组装](../../packages/web/src/server/workspace.ts#L97)、[制作规范](../../packages/web/resources/standards/0.2.0.md)

生成参数显式关闭 MCP、联网搜索、多代理和项目文档自动注入，使用 `--ignore-user-config`，并将 `project_doc_max_bytes` 设为 0。因此不能指望这款云端执行器自动继承当前桌面 Codex 会话里的全部游戏制作技能；所需流程应该由平台显式传入。在所读参数中没有显式固定推理档位，只有选用 Astra 时传入模型 ID；现有超时策略给 Astra 20 分钟，其余默认 10 分钟，不能据此推断本次实际用了多少推理或制作时间。[执行参数](../../packages/web/src/server/generator-policy.ts#L50)、[模型传递](../../packages/web/src/server/codex.ts#L42)、[时限](../../packages/web/src/server/model-runtime.ts#L2)

内置可复用模块目前只有波次调度。基础知识四条主要围绕规则、撤销、波次和容器布局，其中容器经验常驻，且允许大容器“主玩法区加侧栏”。授权后核对的本次知识快照确实包含该经验和固定比例画布布局经验，但不能单独将它们认定为截图布局的原因；线上还按项目选择其他经验，不能从种子文件断言全平台不存在美术经验。[模块说明](../../packages/web/resources/modules/README.md)、[种子经验](../../packages/web/resources/knowledge/seed.json#L76)、[实际知识选择](../../packages/web/src/server/knowledge.ts#L128)

### 2. 验收通过后，没有视觉润色回合

`validateGame` 在 960×660 视口打开游戏，点击开始、确认 canvas、发送右方向键和空格、点击重开，再保存 `preview.png`。它监听页面异常和失败资源，但没有检查塔防的建塔、升级、命中、漏怪、胜负或声音。对塔防而言，通用按键不等于有效玩法验收。[浏览器检查](../../packages/web/src/server/build-game.ts#L104)

worker 最多执行两轮生成；只有第一轮构建/浏览器检查抛错时，才把错误文本反馈给生成器修复。成功就退出循环并保存。传入模型的图像是用户选中的画布图片，没有验证后截图的视觉评审路径。因此“已通过启动与重开检查”不能证明画面美观，也不会主动发现主场景留白、主题层次不足或缺少声音。[制作与修复循环](../../packages/web/src/server/worker-main.ts#L176)

另一个细节是提示词要求 960×600 和 700×520 完整可见，而当前自动浏览器检查只有 960×660；窄视口与更低高度尚未进入这条实际验收路径。[布局要求](../../packages/web/src/server/workspace.ts#L107)、[实际视口](../../packages/web/src/server/build-game.ts#L126)

### 3. 音频既缺默认要求，也有文件管线缺口，但程序合成可用

对话规划提示明确写着游戏项目“暂不能生成图片或音效文件”。这句话说的是文件能力，并未禁止程序合成声音，但也没有告诉规划器把合成音效作为可交付方案。当前基本规范、执行提示和公共模块均没有列出塔防应覆盖的声音事件。[规划提示](../../packages/web/src/server/conversation.ts#L79)、[制作规范](../../packages/web/resources/standards/0.2.0.md)、[公共模块](../../packages/web/resources/modules/README.md)

当前构建器只为图片配置了资源 loader，未建立音频文件导入/拷贝流程；静态资源白名单也没有 `.mp3/.wav/.ogg`。所以“把一个音效文件放进项目再正常引用”尚不是可靠可用的通路。不过这不等于所有发声方式都被禁止，代码生成音频信号与加载外部音频文件是不同路径。[构建器](../../packages/web/src/server/build-game.ts#L41)、[资源白名单及 CSP](../../packages/web/src/server/static-files.ts#L10)

**实际实验通过。** 2026-10-23，在本机用当前 `temporaryArtifactServer` 返回的 CSP，并套上与 `GameFrame` 一致的 `sandbox="allow-scripts"`、`allow="fullscreen"` iframe，模拟用户在游戏内点击后创建 `AudioContext`、振荡器和增益节点：Chrome `155.0.8059.85` 返回 `state=running`，48 kHz，分析器 RMS 约 `0.0070953`，无页面异常。临时页面、浏览器与服务均已清理。这个结果证明本机 Chromium 下存在可用的程序合成信号路径，不是听感评估，也不覆盖 Safari、手机或截图中游戏已有的声音逻辑。[相同 iframe 属性](../../packages/web/src/components/game-frame.tsx#L120)、[相同响应策略](../../packages/web/src/server/static-files.ts#L40)

**建议采用的默认声音覆盖：** 建塔、升级/出售、发射、命中、消灭/奖励、漏怪/基地受伤、波次开始、胜利/失败，并提供静音。用声音事件映射到集中管理的合成器，限制密集开火的频率和同时发声数，首次交互解锁，暂停/重开不叠加旧声音。背景音乐可按风格后续增加，不应靠强制音乐来证明“有声音”。这是本研究提出的改进清单，不是 OhMyGame 已有要求。

## 建议如何改，如何确认真的变好

| 顺序 | 改进                                                 | 可检查的结果                                                                           |
| ---- | ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1    | 把 2D 视觉方向和完整反馈写入默认交付规范             | 设计包含主题、配色、材质、主体轮廓、地图层次和关键交互；各塔种外形可区分，重要目标清楚 |
| 1    | 加入可复用的合成音效模块与事件清单                   | 新游戏默认覆盖实际存在的关键事件；静音、首次点击、暂停和重开正常；不需要媒体服务       |
| 2    | 让生成器看到实际运行截图，并留出一次有依据的润色     | 在建造、交战、选塔/暂停、结束状态及宽窄视口检查；将截图与缺陷列表返回修正，然后复查    |
| 2    | 把塔防行为写成针对这款玩法的检查，而非只发送通用按键 | 建塔扣款、升级、击杀奖励、漏怪扣生命、波次推进、胜负和重开有实际操作证据               |
| 3    | 接通可选的生图、音频文件与素材打包                   | 生成资源进入最终构建；可追溯用途；只有确有视觉需求时调用，不把付费素材数量当质量       |

这些步骤可在现有 Phaser 与项目隔离架构里实施。截图评审应走平台受控工具或把指定截图作为模型输入，不需要为了观察游戏而开放宿主文件、账号或任意联网。更完整的视觉规范也不应强制所有游戏套同一个侧栏、卡片或配色。

建议使用本次原提示做最小对照：A 为当前流程，B 只增加 2D 交付规范和音效模块，C 在 B 上增加截图复查。固定实际模型 ID、推理档位、平台版本、素材条件和预算上限，每组至少重复 5 次并记录实际耗时、token、失败与修复次数。随机打乱作品由人评审，分别比较主题辨识、画面层次、信息可读性、操作反馈、声音覆盖和基础玩法正确性。截图使用同一视口和同一状态；记录质量提升所需的额外成本。这里是实验建议，本轮没有提交这些生成任务或消耗模型制作额度。

## 本轮完成范围与剩余边界

已完成两张截图的静态观察、本地生成链路检查、线上五份关键文件摘要一致性验证、OhMyGame 固定版本源码研究，以及现有 iframe/CSP 下的合成音效实验。经用户进一步明确授权，另完成两份线上游戏文件的只读核对、源码差异比较、首波实玩、暂停/运行对照和两个规范视口的检查。产出为研究报告、截图和证据记录，没有修改生成规范、游戏源码或生产服务。

此前私有项目读取被自动审批拒绝，用户已在本聊天明确授权后才继续，当前该项核对已完成。仍未读取用户本机 OhMyGame 游戏项目或两次生成的完整运行日志，因而不能确定右侧作品具体用了什么声音资源、哪些技能、多少轮视觉修改，也不能证明两次实际模型参数和推理预算完全相同。没有进行完整六波通关、真实手机或 Safari 验证。

## OhMyGame：可以确认的核心差异

OhMyGame 当前 Web Game 默认工作流把**美术方向、界面信息层级、素材整合、真实输入和截图检查**写进了实际传给 agent 的指令，并提供 agent 可操作的素材与试玩工具。因此，“同一段用户提示词”不代表“模型收到相同任务”。但这些内容主要是 agent 行为要求，不能等同于平台每次都会通过的自动质量门禁。[系统指令](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/agent-prompts.ts#L25-L34)、[运行时注入](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/agent.ts#L2950-L2970)、[完成判定](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/agent.ts#L1145-L1176)。

### 1. 指令和技能确实接进了生成链路

| 层次           | 实际行为                                                                                                    | 源码                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 内置插件       | 从仓库 `plugins/` 加载；Web Game Studio 的 manifest 指定 `./skills/`，限定 `web-game` 项目                  | [app.ts 824](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/app.ts#L824)、[manifest 1–17](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/plugins/web-game-studio/.ohmygame-plugin/plugin.json#L1-L17)                                                                                                                                                       |
| 默认开关       | manifest 不指定关闭则插件默认开启，技能默认开启；用户保存的设置可以覆盖                                     | [插件默认值 372–394](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/local-plugins.ts#L372-L394)、[技能默认值 486–502](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/local-plugins.ts#L486-L502)、[覆盖设置 44–50](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/plugin-settings.ts#L44-L50) |
| 技能筛选       | 仅收集已启用、项目类型匹配、组件未关闭的技能                                                                | [plugin-runtime.ts 75–98](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/plugin-runtime.ts#L75-L98)                                                                                                                                                                                                                                                                                                 |
| Pi agent       | `createPiSession` 接收项目专用系统指令，resource loader 注册 `additionalSkillPaths` 和 `appendSystemPrompt` | [agent.ts 2950–2970](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/agent.ts#L2950-L2970)、[3042–3057](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/agent.ts#L3042-L3057)                                                                                                                                                                      |
| 原生 CLI agent | Claude Code、Codex、OpenCode 路径也收到插件技能目录与相同项目指令                                           | [app.ts 942–973](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/app.ts#L942-L973)、[runtime IDs](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/shared/agent-runtimes.ts#L1-L14)                                                                                                                                                                        |

“技能可发现、系统指令要求使用”不等于“全部技能正文每轮自动展开”。源码把技能路径交给资源加载器，并要求按任务使用相关技能；要证明某次读过正文，还需要那次会话的工具记录。[专门技能按需路由](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/plugins/web-game-studio/skills/web-game-studio/SKILL.md#L33-L46)。

### 2. 美术要求具体到信息层级、材质和游戏状态

新建 Web Game 的系统指令要求交付设计文档、关键画面 mockup、生产素材、完整可玩循环与真实试玩；规定统一配色、适合主题的字体和每次输入的可见反馈。它还要求 iframe 内自适应、避免固定宽度和横向溢出，并强调生成文件必须进入游戏自己的构建路径。[agent-prompts.ts 25–33](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/agent-prompts.ts#L25-L33)。

`web-game-studio` 把新游戏拆成四步：记录玩法与视觉方向及素材表；先出关键界面 mockup；复用或生成缺失的生产素材并整合进玩法；检查真实游戏截图、素材是否实际使用、可读性及 HUD 遮挡，然后修复复查。mockup、空的生成节点和未使用文件都不能算美术完成。用户明确要求灰盒、不生成素材或程序绘制时会覆盖默认流程；工具不可用时允许一致的替代方案，并披露缺口。[创建流程 22–31](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/plugins/web-game-studio/skills/web-game-studio/SKILL.md#L22-L31)。

`game-ui-frontend` 的指令比“做得美观”更具体：

- 实现前确定玩家幻想、镜头、主要动作、信息层级、材质语言、字体、配色和动效基调。
- 保护主要操作区域；常驻信息服务当前决策；次要信息进入情境面板或暂停菜单；避免上下左右同时出现多条按钮区。
- 用图标、数字、短标签、情境引导和短暂反馈；避免大段常驻说明、SaaS 仪表盘网格和装饰性卡片堆叠。
- UI 皮肤沿用世界的形状、材质和色彩；在实际游戏尺寸验证可读性；桌面、移动端与遮罩开关状态都应检查。

以上可作为解释截图中“更像成品游戏”的**机制假设**，不能单凭源码证明因果，也不能证明截图使用过生成图片。[game-ui-frontend 10–44](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/plugins/web-game-studio/skills/game-ui-frontend/SKILL.md#L10-L44)。

2D 素材技能另外要求角色身份、轮廓、相机角度、调色、尺寸、锚点一致，整条动画尽量一起生成，并检查实际游戏尺度中的预览与动画。这属于生产素材的一致性规范，不是固定“生成 N 张图”的配额。[sprite-pipeline 8–37](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/plugins/web-game-studio/skills/sprite-pipeline/SKILL.md#L8-L37)。

### 3. 试玩可以把图片送回 agent，但视觉质量没有硬性放行条件

系统要求 `game_use` 可用时用真实输入及截图检查重要改动，明确构建成功不等于试玩。技能要求检查首屏、主要操作、暂停、失败/重启、桌面/移动视口；Canvas/WebGL 代表状态必须截图，DOM 检查不足以证明画面正确。[系统要求 33](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/agent-prompts.ts#L33)、[试玩工作流 18–37](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/plugins/web-game-studio/skills/game-playtest/SKILL.md#L18-L37)。

这不只是文字：`game_use` 提供点击、键盘、触摸、等待、调整视口等动作，`capture` 返回的工具内容中包含真正的 `type: "image"`，可供支持图像的 agent 继续判断和修正。默认打开尺寸是 1280×720，调用时可改；截图动作和后续修正仍需要 agent 主动执行。[输入及视口接口 13–80](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/playtest-tools.ts#L13-L80)、[capture 图片返回 101–135](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/playtest-tools.ts#L101-L135)。

边界有三项：

- `game_use` 只有运行环境的 driver 可用、支持该项目类型时才注册。[agent-tools.ts 589–591](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/agent-tools.ts#L589-L591)。
- 技能明确允许视觉工具缺失时只做可执行的逻辑/构建验证，说明未做视觉试玩；空白帧启发式也只是警告，不是完整视觉断言。[game-playtest 35–39](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/plugins/web-game-studio/skills/game-playtest/SKILL.md#L35-L39)。
- 所检查的回合完成路径在 agent 正常结束且无最终错误后就标记完成，未检查“是否有截图”“是否有音效”“是否达到美术分数”。完成回调只启动预览和清理快照。因此应称“指令要求 + 可执行工具 + agent 自检”，不应称为宿主强制的美术验收流水线。[agent.ts 1145–1176](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/agent.ts#L1145-L1176)、[app.ts 1020–1030](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/app.ts#L1020-L1030)。

### 4. 音频能力存在，但未发现“每个游戏必须音效齐全”或 WebAudio 默认配方

当前代码定义 `generate_speech`、`generate_sound_effect`、`generate_music` 工具，可把语音、音效和音乐保存进项目。宿主注册 Doubao Speech 与 Seed Audio 两个适配器；后者能力声明包括 `sound-effect`、`music`，输出 MP3/WAV，最长 120 秒，不声明无缝循环支持。[工具定义 432–482](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/agent-tools.ts#L432-L482)、[适配器注册 757–770](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/app.ts#L757-L770)、[Seed Audio 能力 15–43](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/volcengine-seed-audio-provider.ts#L15-L43)。

这些不是免配置默认效果包。音频目录只返回已配置且启用的适配器模型；回合工具列表根据可用的音频 operation 过滤，缺少兼容模型时不能生成。[ProviderAudio 41–92](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/audio-generation.ts#L41-L92)、[工具过滤 1012–1018](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/app.ts#L1012-L1018)。

对 `plugins/web-game-studio`、`plugins/game-studio` 的全文检查，只找到四处泛指 audio：polish 可改音频、presentation/scene 层处理音频；`game-ui-frontend` 没有声音设计条目。进一步在 `src/`、`plugins/`、`integrations/` 检索 `AudioContext`、`webkitAudioContext`、`WebAudio`、`Web Audio` 无匹配。系统 Web Game 指令也未列出建塔、发射、命中、击杀、奖励、胜败等必须覆盖的音效事件。[polish 定义](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/plugins/web-game-studio/skills/web-game-studio/SKILL.md#L12-L18)、[Phaser 场景职责](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/plugins/web-game-studio/skills/phaser-2d-game/SKILL.md#L10-L17)、[Web Game 系统指令](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/agent-prompts.ts#L25-L34)。

因此，用户报告的那次音效更完整是值得复现验证的现象，但不能归因于强制音效清单、内置 WebAudio 模板或实际调用了 Seed Audio。它也可能来自该模型这次主动编写的程序合成、已有素材或附加上下文；判定需要那次生成项目的代码、音频文件及工具日志。当前仓库未命中相关词，也不代表它禁止生成项目自行使用 Web Audio。

### 5. 没有统一固定的生成模型，推理默认也不能从标签推定

运行时支持内置 Pi 和三种可选 CLI agent；会话模型由选择的 provider/model 确定。外部 CLI 默认关闭，启用后读取自己的 CLI 配置。没有模型时，创建 agent 会话会提示选择可用模型。[native runtime IDs](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/shared/agent-runtimes.ts#L1-L14)、[CLI 默认设置 24–32](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/agent-runtimes/settings.ts#L24-L32)、[会话模型选择 988–1006](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/app.ts#L988-L1006)。

仓库有首次连接 provider 后的推荐 ID，例如 `openai → gpt-5.5`、`openai-codex → gpt-6.1-sol`，但这些是按 provider 的推荐，不是每次生成固定使用的模型。常规模型选择顺序是显式选择、已配置默认、可用列表首项。Pi 推理 fallback 为 `medium`，受已保存设置和模型支持范围影响；CLI 使用自己的 native reasoning 选项，不能套用同一个 fallback。[推荐和选择逻辑](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/shared/agent-models.ts#L11-L37)、[创建会话 2924–2962](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/app.ts#L2924-L2962)、[Pi fallback 3906–3922](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/daemon/app.ts#L3906-L3922)、[nativeEffort](https://github.com/WhiteTowerAI/ohmygame/blob/ca2df725cc4e836e1120ea1f3374e7b99021a903/src/shared/agent-runtimes.ts#L24-L36)。

## 后续对照实验需要保留的信息

要把机制差异和模型随机性分开，至少保留两次生成的完整用户提示、平台版本、实际 provider/model ID、推理档位、已注入系统指令与技能清单、模型可用工具、媒体工具调用、生成文件和试玩记录。针对声音，额外检查项目是加载音频文件还是程序合成，以及浏览器首次交互解锁、静音开关和关键玩法事件的覆盖。针对画面，比较同一运行状态、相近视口的画面，避免将暂停遮罩或不同关卡状态误判为整体美术差距。

## 用户确认后的平台改进：0.3.0

本次实现直接作用于平台后续制作流程，没有修改已发布的《积木守卫队》。

- 新版制作规范将主题造型、场景层次、界面决策顺序和宽窄布局写入新建游戏的默认要求，同时要求在设计与真实代码路径中覆盖适合玩法的声音事件，尊重无声、灰盒及旧项目的修改范围。[制作规范](../../packages/web/resources/standards/0.3.0.md)
- 增加可复制的离线 `GameAudio`，提供 11 类短音效、真实交互解锁、事件节流、最多 8 个发声单元、静音、暂停、重开清理和销毁。音色可调整；没有声卡/音频支持时不阻塞玩法，不提供背景音乐或外部素材生成。[音效模块](../../packages/web/resources/modules/audio.ts)
- 项目提供有上限的 `playtest.json`。平台在开始后执行真实点击/按键与可见结果断言；限制步骤、选择器、等待和按住时长，不执行项目自定义脚本。新制作缺少试玩计划会进入有限修复；仅复验旧项目时允许缺少计划，并明确记录 `missing`。[试玩执行](../../packages/web/src/server/game-playtest.ts)
- 每次检查保存开始后、操作后、宽屏和窄屏四张截图，操作后画面作为 `preview.png`。第一次通过后把真实截图作为图片附件发回模型一次，再对复查后代码独立构建、操作与重开；验证失败不能保存为通过版本。[流程编排](../../packages/web/src/server/game-generation.ts)、[浏览器检查](../../packages/web/src/server/build-game.ts)
- 检查镜像升为 `opengame-project-runtime:0.3.0`，导出文件白名单与元数据校验同步更新。没有放宽项目网络、宿主文件或凭据权限。成功流程通常增加一次模型调用，两个阶段各最多一次技术修复，共用整次任务时限；取消、超时或失败继续保留旧版本。

本机验证已完成：类型检查、45 项基础测试（其中两项浏览器/端口测试在解除工具沙箱限制后复验通过）、5 项 Docker 运行测试以及 1 项真实浏览器音频测试通过。Docker 覆盖真实点击/按键、错误金币断言被拒绝、四张真实 PNG 及尺寸、3D 旧场景、跨项目隔离、取消与崩溃回收。两项 Linux 专用生成器沙箱测试在 macOS 上按原规则跳过。音频测试在实际预览 CSP 下测得非零音频样本，并确认静音、暂停、重开和释放行为；这不等于人工听感验收。

独立目录中的正式前端构建通过。现有 Privy/viem 依赖有可选模块缺失和动态导入警告，本轮未修改这些依赖。构建验证产物保存在本机 `.opengame/quality-build-20261023`，线上服务尚未切换。本地另有既存未提交改动，上线应对照服务器基线只合入本轮变更，并同步准备新镜像；不直接把整个工作目录或验证构建覆盖到线上，也不能只替换提示词或混用旧检查器。

这些检查证明流程可执行、有限修复与隔离边界仍生效，不构成自动美术评分或“稳定超过 OhMyGame”的结论。原提示词的真实生成验证由 [质量流程基准](../../packages/web/benchmarks/quality/README.md) 留存，可继续进行多次、相同模型设置与状态的对照。

### 原提示词的真实生成与试玩

2026-10-23 在独立本地目录使用原始提示词，请求模型 `gpt-6-astra`，完整制作流程用时 **868 秒（约 14 分 28 秒）**，共 3 次模型调用：首次制作、一次技术修复、一次截图复查。首次遇到浏览器截图超时，修复改为缓存静态背景并减少渲染开销后通过。复查前实际宽屏截图出现画布只占容器约 33% 的提示，窄屏可见裁切和比例异常；模型收到四张截图后调整等比缩放，最终 12 步实际操作、重新开始、三个尺寸截图与资源异常检查通过，最终布局提示为空。[流程记录及用量](../../output/game-quality-A7jwzo/result.json)

| 实际截图 | 复查前                                                                  | 复查后                                                                   |
| -------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 宽屏     | [1440×800](../../output/game-quality-A7jwzo/check-2/preview-wide.png)   | [1440×800](../../output/game-quality-A7jwzo/artifact/preview-wide.png)   |
| 窄屏     | [700×520](../../output/game-quality-A7jwzo/check-2/preview-compact.png) | [700×520](../../output/game-quality-A7jwzo/artifact/preview-compact.png) |

随后在 Chrome 155 中通过真实界面操作完成第一波、建造三种塔、暂停/继续和重开。建造、升级和战斗测得原生 Web Audio 非零样本；静音后的峰值为 0，重开恢复 240 币并保留静音偏好，音频上下文数量重开前后不增加，无页面异常。Phaser 与 GameAudio 各有一个上下文；初次检测将“总数必须为 1”误作断言，改为正确检查重开是否累积后复验通过。没有人工音质评分，也没有验证六波通关。[实际试玩记录](../../output/game-quality-A7jwzo/sample-playtest.json)、[三种炮塔画面](../../output/game-quality-A7jwzo/manual-preview.png)

根据本次样例暴露的问题，制作规范另外补充静态画面缓存、HUD 按状态变化更新，以及暂停测试结束后恢复游戏再截图。这两项文字补充尚未另跑一次完整生成。上述实测直接进入制作流程，没有覆盖聊天规划、数据库保存或线上发布。

本轮平台改动另存为 [23 个文件的独立补丁](../../output/game-quality-A7jwzo/platform-changes.patch) 与 [基线/结果摘要](../../output/game-quality-A7jwzo/platform-change-manifest.json)，已确认可应用到记录的本地基线，排除了工作目录原有的其他改动。补丁未应用到线上。
