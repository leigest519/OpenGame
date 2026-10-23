# Gemini 4 Argon：Pro 订阅权限与 OpenGame 接入边界

核验日期：2026-10-18（Asia/Shanghai）。只使用 Google 官方文档与公告。未修改登录、配置或计费，也未调用模型。沿用仓库 `docs/developers/*research*.md` 的调研笔记位置。

## 结论

**付费、非试用 Google AI Pro 已被官方列入 Antigravity 的 Argon 支持范围；但将消费级订阅登录包装成 OpenGame 模型后端不是官方支持路径。** 模型使用权限和第三方集成权限必须分别判断。[模型权限](https://www.antigravity.google/docs/models/)、[FAQ](https://antigravity.google/docs/faq)

## 已确认

- 最新模型表中 Argon 的 Google AI Pro 列为可用，脚注明确仅非试用订阅；支持 Antigravity App、CLI、IDE extensions，不支持 Antigravity IDE。不能把 App 和 IDE 混为一谈。[模型表](https://www.antigravity.google/docs/models/)
- 官方 FAQ 同样将 Argon、Claude Sonnet 5.5、Opus 5.5 列为付费 Pro / Ultra 模型，免费试用不含；提供试用转正式付费的申请入口。[FAQ：付费计划](https://antigravity.google/docs/faq#how-do-i-upgrade-to-a-paid-google-ai-plan)
- 官方 Antigravity 团队公告称从 2026-10-13 起向 Pro / Ultra 的 App 与 CLI 推出 Argon，并建议升级最新客户端。公告没有给出所有账号完成开放的日期，也未在本轮来源中找到 Argon 的精确最低 CLI 版本。[公告](https://antigravity.google/blog/gemini-4-argon-in-google-antigravity)
- Pro 有订阅基础额度，五小时刷新并受周限额约束；额外 AI credits 由 Overages 设置控制，`Never` 会等待基础额度恢复，不自动使用积分。[计划与额度](https://antigravity.google/docs/plans/)
- 官方 FAQ 明确：`agy -p` 用于直接脚本和 CI 工作流；消费级计划不支持将 `agy` 包进第三方编程 agent 或应用。该页另说明第三方软件使用 Antigravity 登录违反其条款，推荐第三方 agent 使用 Gemini Enterprise 或 AI Studio API key。[FAQ：第三方客户端与 headless](https://antigravity.google/docs/faq)
- Antigravity Python SDK 的文档认证方式是 Gemini API key、Gemini Enterprise/Vertex，或本地模型；未提供 Pro OAuth 订阅作为 SDK 的认证方式。不能因为 SDK 名为 Antigravity 就认定它消耗 Pro 权益。[SDK](https://antigravity.google/docs/sdk/overview)、[程序化认证](https://www.antigravity.google/docs/install/)
- 个人 Antigravity 需要支持地区、成年 Google 账号。官方要求检查 Google 条款页面关联地区；当前支持地区清单未列中国大陆、香港或澳门。不能仅凭本机会话时区推断用户账号地区。[地区与年龄](https://antigravity.google/docs/faq)

## 文档冲突及解释范围

本轮搜索结果和不同入口中出现过 Pro 不可用或只提 Ultra 的描述；这些片段不能替代当前页面正文。主会话直接打开 API latest-model 页面时未找到 Pro 限制文字，因此不把搜索片段当作该页面当前规则。当前 Antigravity 模型表与 FAQ 明确列出非试用 Pro，Antigravity 团队公告也写 Pro。

应优先用当前产品专属模型表与 FAQ 判断 Antigravity 资格，同时保留“文档/缓存尚未完全同步”的不确定性。API 的付费与可用性不能直接套用到 Antigravity 订阅入口。[旧搜索入口](https://antigravity.google/docs/models?authuser=117)、[API 模型说明](https://ai.google.dev/gemini-api/docs/latest-model?hl=en)、[发布公告](https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-gemini-4-argon/)

## 对当前账号的判断

主会话提供的实测背景：agy 1.4.2 OAuth 登录成功，列表只有 Gemini 3.8 Flash、Claude Sonnet/Opus 4.6、GPT-OSS 120B，没有 Argon 或 Claude 5.5。本笔记未重复读取或验证凭证。

该列表与低权限/试用可用模型相符，**但不足以证明账号是试用**。尚需确认实际登录账号、Google One 的非试用付费状态、家庭共享/优惠权益类型、账号关联地区、服务端权限是否刷新。不要仅凭列表要求用户重新付费。若正式付费权益明确且客户端最新，适合向官方支持报告权限不一致，而非反复更改模型字符串。

## 可行选项

| 目标                                                      | 当前结论                                                                         |
| --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 不增加 API 计费，在官方 agy 使用 Argon 开发 OpenGame 源码 | 满足非试用 Pro 与地区等要求后有官方路径；还需账号实测                            |
| OpenGame 内部包装 agy，把 Pro 变成模型服务                | 官方 FAQ 明确不支持消费级计划这种用法                                            |
| OpenGame 通过官方 Python SDK 或 Gemini API 调 Argon       | 有程序化路径，但未证明可消耗 Pro 聊天/CLI订阅额度；不满足当前不另开 API 计费要求 |
| 使用开发者赠金支付 API                                    | 属于 API 计费账户与额度体系，不能等同于直接复用网页订阅；不在本轮授权范围        |

下一步应先核对账号为何没有官方声明的模型权限，再决定是否仅用官方 agy 开发项目。在找到明确支持的第三方订阅接口前，不承诺 OpenGame 原生订阅接入已可实现。

## CLI 额外积分开关

官方 CLI 文档支持 `useG1Credits: false`，或在 `/settings` 中关闭 Use G1 Credits，以限制基础额度耗尽后的积分回退。此设置不增加模型权限。本机仅检查了该键，当前未显式设置；本轮没有修改设置，也不推断默认值。[CLI AI credits](https://www.antigravity.google/docs/cli/credits/)

## 后续核验：用户确认已扣费

用户确认当前为正常付费、已经扣费的 Pro 订阅。随后再次运行 `agy models`，列表未改变。进入 agy 1.4.2 官方界面后，页头显示 Google AI Pro，`/usage` 的 Gemini Weekly / Five Hour 剩余额度均为 100%。因此可排除本次缺失是基础额度用尽；界面只显示 Pro，并不能证明后端已经正确识别 non-trial 标志。未保存邮箱或凭证。

官方论坛存在高度相似的第一手用户报告：付费数月，但缺少 Argon 和 Claude 5.5，只见 Claude 4.6。回复提出试用/正式付费状态同步问题，发帖用户进一步说明曾看到5.5后来消失。该帖没有已验证解决办法，因此只作为同症状证据，不作为已确认根因。[同症状报告](https://discuss.ai.google.dev/t/google-ai-pro-paid-subscription-with-sonnet-and-opus-4-6-instead-of-the-5-5-models-and-without-argon-4/189764)

建议先核对 agy 登录邮箱与扣费订阅账号一致；若一致，向 Google One 支持提交 paid/non-trial entitlement 校验请求，附版本、模型列表、100%余量和订阅凭证。不要为排障再次付费或升级 Ultra。当前尚未证明重登可以修复，也未执行退出账号。
