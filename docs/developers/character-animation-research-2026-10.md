# 月泊人物动画路线调研

调研日期：2026-10-18。范围：GitHub 项目与官方文档；未安装或运行所列工具，未修改线上场景。下文的推荐、成本比较和验收阈值是结合当前固定侧面桥景的工程判断，不是工具厂商的效果承诺。

## 建议

采用 **3D 角色骨骼制作动作 → 固定镜头渲染透明序列帧 → 网页播放 2D 图集**。保留现有背景分层、桥栏遮挡和镜头跟随。先验证一个人的慢走、收步、站立，再扩展舞蹈。

“3D 转 2D”“序列帧”“骨骼动画”不是互斥选项：骨骼是动作制作方式，3D 转 2D 是渲染流程，序列帧是网页可以使用的交付形式。Blender 原生支持逐帧输出；不必先押注某个第三方导出插件。[Blender 动画渲染文档](https://docs.blender.org/manual/en/latest/render/output/animation.html)

本项目需要小步、准确重心、宽袖和长裙，后续还有转身与舞蹈。我的判断是：同一个 3D 模型能提供更可控的连续体积、衣纹和前后遮挡；但需要先做好模型、绑定、动作修正和材质匹配，不能把“生成模型”当作“动画已完成”。若后续目标变为自由绕人物拍摄，应改用实时 3D 人物；当前横向镜头移动无需为此重做整座场景。

## 路线比较

| 路线                   | 本场景适合程度                   | 主要投入与限制                                                         | 建议                                         |
| ---------------------- | -------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------- |
| 3D 骨骼制作，再渲染 2D | 高；尤其舞蹈、转身、长袖         | 前期模型/绑定/动作成本高；角度和光照烘焙后固定；帧数增加会增加贴图内存 | 首选，先做短动作验证                         |
| 专业手绘序列帧         | 高，容易与绘画背景统一           | 每个动作都需画和修；一致性、补帧、转身劳动量大                         | 有动画画师时是可靠路线                       |
| AI 直接生成多格动作图  | 初稿快，最终动作可靠性低         | 必须检查脸、身高、手脚、衣纹、接触点和循环；统一裁切不能修复错误动作   | 用于设计和关键姿态参考，不作为最终完整动作链 |
| 2D 骨骼＋网格变形      | 适合固定角度慢走、待机、轻舞     | 需要拆图、隐藏部位补画、权重与遮挡设计；大转身通常需要额外视角素材     | 若坚持纯插画风格，作为第二选择               |
| 实时 3D 人物＋2D 背景  | 多角度、即时换装、动态打光更灵活 | 浏览器渲染、桥面映射、遮挡、阴影和风格融合复杂                         | 等自由镜头需求明确后再做                     |

表内成本是相对判断，不报价或估算完成天数。AI 动画研究本身也将人物一致性作为专门问题：Sprite Sheet Diffusion 提供了主体一致性评估，而不是只输出一张拼图。[论文](https://arxiv.org/abs/2412.03685)、[作者代码](https://github.com/chenganhsieh/Sprite-Sheet-Diffusion)

## GitHub 项目核查

### 3D 动作与转帧

- **Rokoko/rokoko-studio-live-blender**：官方 Blender 插件，提供动作重定向和骨骼映射；仓库标示 LGPL-3.0。发布页可见 1.4.2 加入 Blender 4.4 支持，1.4.3 修复依赖导致的启动问题。可作为把已有动作适配到角色的候选，不代表自动完成汉服、脚步或舞蹈修正；插件许可也不等于动作素材许可。[仓库](https://github.com/Rokoko/rokoko-studio-live-blender)、[发布记录](https://github.com/Rokoko/rokoko-studio-live-blender/releases)
- **Gloaming-Forge/Blender-Spritesheet-Renderer**：支持动画、多个朝向、材质轮换和图集输出，但 README 明写仅测试 Blender 2.9。适合参考导出设计；不能据此承诺兼容当前 Blender，更不应作为必须安装的基础依赖。[仓库与兼容声明](https://github.com/Gloaming-Forge/Blender-Spritesheet-Renderer)
- **craigrmccown/iso-render-pipeline**：展示动画采样、指定相机、PNG 图集和 JSON manifest 的流程。仓库根目录本次未见 LICENSE，也未获得足够的兼容性验证；可参考思路，不能把公开源码自动当作可自由复用的开源依赖。其示例是等距视角，本场景应自行匹配侧面相机。[仓库](https://github.com/craigrmccown/iso-render-pipeline)

实际首选是 Blender 原生 PNG 序列输出加简单图集打包，先避免插件版本成为阻碍。布料可以采用手调辅助骨骼，复杂甩袖再考虑离线布料；Blender 支持用顶点组钉住衣料的一部分，但此功能不保证自动避免穿模或获得正确舞姿。[布料形状与固定文档](https://docs.blender.org/manual/en/4.1/physics/cloth/examples.html)

### 2D 骨骼

- **EsotericSoftware/spine-runtimes**：官方提供网页和 Phaser 运行时。源代码公开，但使用自定义 Spine 许可，不能按 MIT 类开源处理。编辑器与运行时 major.minor 版本要匹配。若把它加入让用户制作并发布内容的平台，还需按实际产品方式审阅许可，不宜只套用单个游戏的授权理解。[仓库与版本说明](https://github.com/EsotericSoftware/spine-runtimes)、[运行时许可](https://github.com/EsotericSoftware/spine-runtimes/blob/4.3/LICENSE)、[编辑器许可](https://us.esotericsoftware.com/spine-editor-license)
- Spine 能用 IK 控制手脚、用权重驱动网格，并给图层前后顺序设置关键帧；这些才是小步落脚、柔软裙摆、手臂跨过身体所需的机制。并不是把完整人物图绑到几根骨头就够了。[IK](https://esotericsoftware.com/spine-ik-constraints)、[权重](https://esotericsoftware.com/spine-weights)、[遮挡顺序](https://esotericsoftware.com/spine-slots)
- **当前实现接入风险**：本项目已知采用 Phaser Canvas 加自定义绘制。最新官方文档中的部分限制专指 spine-phaser-v4，不能不核对版本就套用。不过官方论坛也记录了 Phaser 3 的 Canvas 网格附件问题，维护者建议完整功能使用 WebGL，不建议以实验性三角形绘制作为生产方案。若选裙袖网格方案，要核对本项目确切版本并验证渲染路径迁移；不能说装上插件就能保持现有效果。[最新文档](https://us.esotericsoftware.com/spine-phaser)、[Phaser 3 Canvas 问题与维护者回复](https://en.esotericsoftware.com/forum/d/26719-spine-phaser-some-attachments-not-visible-with-phasercanvas)
- **DragonBones/DragonBonesJS**：MIT 运行时，README 列出 Phaser、Pixi 等集成并推荐 LoongBones 制作。不能笼统说“早已停更”：本次提交页可见 2025-05-24 新增 Pixi 8 runtime。此证据仍不能证明与本项目 Phaser 版本和当前编辑器产物完全兼容，需真实导出小样测试；运行时许可也不能代替编辑器服务条款。[仓库](https://github.com/DragonBones/DragonBonesJS)、[提交记录](https://github.com/DragonBones/DragonBonesJS/commits/master/)
- **ndee85/coa_tools**：GPL-3.0，提供 Blender 内 2D 剪纸、骨骼、网格权重和 IK 工作流，文档主要说明 Blender/Godot 导入导出。可作为离线制作候选，不是已验证的 Phaser 即插即用方案；本次未确认当前 Blender 的端到端兼容。[仓库](https://github.com/ndee85/coa_tools)
- **Godot 原生 2D skeleton**：官方提供 Skeleton2D/Bone2D 与多边形权重，属于另一条完整引擎工作流。适合新 Godot 项目或离线生产，当前网页没有必要仅为一个角色迁移引擎。[官方教程](https://docs.godotengine.org/en/stable/tutorials/animation/2d_skeletons.html)

### 实时 3D 备选

Three.js 的 AnimationAction 支持动作权重、淡入淡出及交叉过渡，可用于站立/走路/舞蹈的状态切换。它解决播放和混合，不会自动修正动作重定向、脚底漂移或汉服穿插。本项目若采用该路线，仍需单独制作符合桥面的脚底约束和背景遮挡。[官方 AnimationAction 文档](https://threejs.org/docs/pages/AnimationAction.html)

## 动作准确的关键

以下是建议制作规范，先在没有花枝、栏杆和光效的灰底上验收，不能用遮挡掩盖问题。

1. **用真实参考确定姿态**：先明确慢走和舞蹈参考，检查落脚、承重、摆腿、收步；“慢”不仅是播放倍率降低，还要相应缩小步幅、抬脚高度和手臂摆幅。
2. **同一角色连续制作**：头身比例、发饰、袖口、裙边和灯光固定。直接生成八个互不约束的姿势，即使补到几十帧，也不等于准确的连续动作。
3. **脚步和位移只有一个来源**：使用根运动时，让根节点位移决定实际移动；使用原地循环时，按实测每周期步长匹配世界速度。不能同时应用根运动和网页平移，造成双倍移动。Godot 官方动画文档解释了根运动提取这一分工。[根运动说明](https://docs.godotengine.org/en/stable/tutorials/animation/animation_tree.html#root-motion)
4. **按路径距离推进步态**：设完整左右步周期对应距离为 L，路径弧长为 s，则循环相位为 `(s mod L)/L`。沿桥面用弧长而非只用水平 x；停止时走完收步过渡，不应瞬间换一张站姿。此公式是工程建议，L 必须来自所做动作，不能凭空设定。
5. **接触脚锁定**：支撑期脚在世界中基本静止，摆动期脚离地。3D/2D 骨骼可利用 IK；纯帧动画只能播放已烘焙的接触关系，对不同坡度的适应性有限，应限制桥坡或额外做坡面动作。[IK 功能依据](https://esotericsoftware.com/spine-ik-constraints)
6. **长裙、宽袖分别处理**：裙子不能随左右腿被拉成两条裤腿；袖子要保持肩肘腕结构，并管理袖口过身前/身后的遮挡。3D 需权重、辅助骨骼或布料修正，2D 需拆前后片、网格和必要的替换图。
7. **接触点和画框稳定**：导出固定相机、统一像素比例、统一世界根锚点，保留每帧原始裁切偏移；不能对每帧独立缩放“铺满格子”，否则人物会呼吸般变大变小。
8. **光影融入环境**：先用冷色月光加低强度暖色轮廓光匹配背景，另外渲染/绘制脚下接触影。普通彩色帧的光照已烘焙，后续换光需要新帧或额外法线等通道；当前先保持一个夜景光照方案。

## 最小验证：先验收人物，再放回梦境

建议只做一位角色、一个固定侧向镜头、约 8–10 秒样片，不先买整套工具、不重做场景。素材的模型、动作和衣装应分别记录来源与允许用途。

1. 找到/制作一个可绑定的汉服角色，先用简单材质；完成站立、起步、两轮慢走、收步、站立。另加 2 秒抬臂/转身测试，让长袖和裙子最容易出错的部位提前暴露。
2. 以 24 fps 试渲染透明帧，比较需要更细采样的片段；不是“24 帧总数”。保留 3D 源文件和动作曲线，之后才能准确修改步幅。动作源错误时不要用插帧掩饰。
3. 输出统一尺寸与锚点的图集、每帧时长、循环长度、接触阶段和位移元数据。按动作分页，记录 PNG 下载大小与解码内存。例如 48 张 512×512 RGBA 原始像素约 48 MiB，文件压缩小不代表显存同样小；实际设备仍需测试。
4. 灰底固定镜头观察完整脚部，再加入桥面和跟随镜头。建议支撑脚漂移不超过屏幕 1–2 px、循环接头不突跳、人物轮廓不忽大忽小、衣料不明显穿体；这些是小样验收目标，不是已取得结果。
5. 再放回现有场景，检查前栏遮挡、上坡/下坡脚底、停止和转向；在 Safari 与另一浏览器测试。没有通过人物单独验收时，不继续加光效和舞蹈数量。

通过这个小样，才能确认角色质感是否匹配插画场景、动作能否真正变准，以及制作成本。若 3D 渲染风格始终不协调，再比较同一段动作的专业 2D 骨骼版本；不建议再用一张 AI 多格图不断调播放速度作为主要改进路线。
