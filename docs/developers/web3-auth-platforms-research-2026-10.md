# OpenGame 用户注册与嵌入式钱包平台调研

调研日期：2026-10-15（Asia/Shanghai）。范围：先建立普通用户账号，后续接入数字资产或稳定币。本文是选型建议，尚未接入任何服务。

## 建议

**优先验证 Privy，保留 Dynamic 为直接替代；如果用户规模增长后登录成本优先，则重点比较 MetaMask Embedded Wallets 和 Coinbase CDP。** thirdweb 更适合同时采用游戏链上资产、智能账户与合约工具的团队；Turnkey 更适合需要自主定义钱包权限与签名流程的团队。

这是针对 OpenGame 阶段的判断，并非市场份额排名。没有找到口径统一、可独立验证的实时市场占有率数据；官网客户案例和自报账户数量只能证明采用情况，不能证明“第一”。本次网页为实时抓取，部分网站存在页脚年份、旧文档和现行产品页面不一致，**不能将所有当前页面内容当作严格的截至日期历史快照**。正式采购应重新核对报价与功能开通条件。

## 主流候选与定位

| 平台                      | 当前品牌/采用证据                                                                                                                                                                                                                                                 | 对 OpenGame 的意义                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Privy                     | Stripe 的 2025 年度公开信确认已收购 Privy；官网展示 Hyperliquid、Deel 等案例。[Stripe](https://stripe.com/zh-my/newsroom/news/stripe-2025-update)、[Privy](https://www.privy.io/)                                                                                 | 普通登录、嵌入式钱包与稳定币路径结合紧密，最适合作为首轮验证对象。                                      |
| Dynamic                   | 官网注明 2025 年 10 月被 Fireblocks 收购，并提供 Magic Eden 客户案例入口。[官网](https://www.dynamic.xyz/pricing)                                                                                                                                                 | 适合同时服务普通用户与已有钱包用户；需要仔细核算企业功能门槛。                                          |
| MetaMask Embedded Wallets | 原 Web3Auth；2026 年官方发布文确认品牌整合，列举 McDonald's、eBay、NBCUniversal 等使用案例。[发布说明](https://metamask.io/en-GB/news/embedded-wallets-developer-platform)                                                                                        | 成熟的多平台钱包接入候选。MetaMask 插件用户数量不等于嵌入式钱包产品使用量。                             |
| thirdweb                  | 官方 2024 年 Ecosystem Wallets 发布文称其 in-app wallets 已服务数十万用户；这是历史自报数据。[发布说明](https://blog.thirdweb.com/changelog/introducing-ecosystem-wallets/)                                                                                       | 与游戏资产、合约和智能账户一起采购时更有价值；单独做网站注册时范围较大。                                |
| Turnkey                   | 官方公开 DIMO 钱包接入案例，并提供面向开发平台的白标钱包能力。[案例](https://www.turnkey.com/embedded-wallets/embedded-waas)                                                                                                                                      | 权限策略灵活；不能再简单描述成“没有登录 UI 的底层签名 API”，目前也有钱包套件。                          |
| Coinbase CDP              | 2025 年正式发布文说明 Coinbase Retail DEX 使用其嵌入式钱包；当前文档归入 Non-custodial Wallet。[发布说明](https://www.coinbase.com/en-ca/developer-platform/discover/launches/embedded-wallets-ga)、[当前定价文档](https://docs.cdp.coinbase.com/wallets/pricing) | 如果未来重点是 USDC、Base 与支付，可以进入首轮技术验证。注意区分用户认证与后端 API key 授权的钱包模式。 |

## 登录、链与钱包控制

| 平台                      | 登录与链支持                                                                                                                                                                                                                                            | 导出、恢复与控制边界                                                                                                                                                                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Privy                     | 邮箱、SMS、社交账号、passkey；支持自有 JWT 认证。钱包连接器明确覆盖 EVM、Solana；底层签名支持更广泛链，不代表所有链都有同等 UI/支付支持。[产品矩阵](https://www.privy.io/pricing)                                                                       | 导出是否提供取决于应用实现；丢失主要登录方式并不意味着客服可替用户恢复，应提前绑定备用登录方式。[用户帮助](https://www.privy.io/user-help-center)；钱包签名、导出和委托可配置策略，部分策略在 enclave 外执行，不能仅凭“非托管”标签判断授权边界。[策略文档](https://docs.privy.io/security/wallet-infrastructure/policy-and-controls) |
| Dynamic                   | 既有钱包连接与统一账号；当前产品页展示 TSS-MPC、EVM 与非 EVM 覆盖。[产品矩阵](https://www.dynamic.xyz/pricing)                                                                                                                                          | 有用户私钥/助记词导出流程；MPC 导出文档要求 headless 应用也提供导出入口。[导出文档](https://docs.dynamic.xyz/wallets/mpc/import-export)。旧文档仍标 Beta，不应据此断言当前生产版本状态；需确认所选 SDK 的恢复机制与灾难恢复附加服务。                                                                                                |
| MetaMask Embedded Wallets | 邮箱、SMS、社交账号、外部钱包；付费层列 passkey、自定义认证。官网列 EVM、Solana、Bitcoin 等。[产品页](https://metamask.io/developer/embedded-wallets)                                                                                                   | 使用分片/阈值架构，但不同 SDK 的实现不同。[架构](https://docs.metamask.io/embedded-wallets/infrastructure/)。Flutter SDK 明确暴露私钥获取接口及 MFA 备份因子，不能据此推断所有 Web SDK 都拥有同一密钥暴露边界。[SDK 文档](https://docs.metamask.io/embedded-wallets/sdk/flutter/)                                                    |
| thirdweb                  | 邮箱、手机号、社交、passkey、外部钱包；支持智能账户与 gas 代付。优先按 EVM 方案评估，不把其“2500+ chains”营销口径等同于所有链功能一致。[登录文档](https://portal.thirdweb.com/react/v5/in-app-wallet/get-started)、[定价](https://thirdweb.com/pricing) | 默认 Connect Modal 有私钥导出入口，也允许开发者隐藏；账号钱包按应用 clientId 隔离。[SDK](https://portal.thirdweb.com/references/typescript/latest/inAppWallet)。应保留导出入口，并验证更换设备及丢失登录凭证的实际恢复流程。                                                                                                         |
| Turnkey                   | OAuth、passkey、邮箱等；链无关签名架构，可结合多种链账户。[架构原则](https://whitepaper.turnkey.com/principles/)、[产品](https://www.turnkey.com/embedded-wallets/embedded-waas)                                                                        | 支持导入/导出密钥；钱包权限由配置决定。[定价功能表](https://www.turnkey.com/pricing)。邮箱认证及恢复可发放限时 API key，需把恢复权限纳入设计。[恢复文档](https://docs.turnkey.com/features/authentication/email)                                                                                                                     |
| Coinbase CDP              | 用户钱包支持邮箱、SMS、社交；可通过 JWT 接入自有认证。EVM EOA、EVM Smart Account、Solana 的网络支持范围不同。[账户管理](https://docs.cdp.coinbase.com/server-wallets/v2/using-the-wallet-api/managing-accounts)                                         | 用户认证模式与后端 API key 模式必须分别设计。[定价/认证模式说明](https://docs.cdp.coinbase.com/wallets/pricing)。本次未完整验证当前用户钱包导出与失去全部认证因素后的恢复流程，列为试用验收项；不能拿 Server Wallet 的导出 API 代替用户侧能力证明。                                                                                  |

“支持恢复”至少包含三个不同问题：换设备重新登录、丢失一个登录方式、供应商或应用停服后取回资产。支持前一种并不能证明支持后两种。导出签名者私钥也未必自动迁移智能账户的权限、部署状态和所有资产操作流程。

## 本次抓取的公开价格（USD）

| 平台                      | 公开收费口径                                                                                             | 关键限制                                                                                                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Privy                     | 0–499 MAU 免费；500–2,499 为 $299/月；2,500–9,999 为 $499/月                                             | 免费签名额度 50,000/月。超过 10,000 MAU 或签名额度，FAQ 列 PAYG 基础费 $2,000、超额 $0.05/MAU、$0.01/签名；页面另列 $1M 月交易量门槛，费用细节应确认。[来源](https://www.privy.io/pricing) |
| Dynamic                   | 至多 1,000 MAU 免费；其后到 5,000 为 $249/月；超过 5,000 部分 $0.05/MAU                                  | 登录或为用户生成嵌入式钱包都可能计 MAU；自带认证、webhooks、gasless 等在页首列入 Enterprise。[来源](https://www.dynamic.xyz/pricing)                                                       |
| MetaMask Embedded Wallets | Base：1,000 MAW 免费，超额 $0.05；Growth $69/月含 3,000，超额 $0.045；Scale $399/月含 10,000，超额 $0.04 | Base 面向个人 workspace；自定义认证、白标、passkey 等应按具体套餐核对。[来源](https://metamask.io/developer/embedded-wallets)                                                              |
| thirdweb                  | 钱包前 1,000 MAU 免费；第一计费阶梯 $0.015/MAU；Growth $99/月、Scale $499/月                             | 平台订阅费与用量费需一起算；不能把每用户单价当总成本。自定义认证列于 Growth。[来源](https://thirdweb.com/pricing)                                                                          |
| Turnkey                   | PAYG 前 25 次签名/月免费，此后 $0.10/签名；Pro 展示 $99/月最低费用、$0.05/签名                           | 页面列 PAYG 1,000 钱包、Pro 2,000 钱包限额；FAQ 与主表有不同 Pro 单价表述，应取得明确报价，不能假设无限免费创建。[来源](https://www.turnkey.com/pricing)                                   |
| Coinbase CDP              | 每月前 5,000 wallet operations 免费，此后 $0.005/operation                                               | 创建账户、签名分别消耗操作；发送交易（签名+广播）计 2 次；读取不收费。[来源](https://docs.cdp.coinbase.com/wallets/pricing)                                                                |

MAU、MAW、签名和 operation 不是同一计量单位。比如“很多人登录，但很少有人交易”的产品，按 MAU 收费与按链上操作收费差别很大。上表不包含网络 gas、短信、法币入金、兑换/跨链等第三方费用；正式预算需根据实际产品流程核算。

## 后续数字币/稳定币接入

登录认证、用户钱包、支付与业务账本是四个独立层次。用户能登录、能拥有链上地址，不等于应用已能正确收款、退款、发奖励和对账。

**如果数字币仅用于购买生成次数/额度，不必给每个注册用户创建嵌入式钱包。** 可以由用户现有钱包或支付页付款，后端验证订单到账后增加平台额度。用户需要在 OpenGame 持有资产、领取创作者收入或提现时，嵌入式钱包才更有直接价值。这是产品架构建议，具体收款渠道另行选择。

Privy 当前提供稳定币收付、资金路由及相关集成；Dynamic 把 Fireblocks Flow 稳定币收款作为产品能力；Coinbase 的正式发布说明将钱包与 onramp、支付结合。这些均构成路线选择理由，但不自动保证目标国家、法币或链可用。[Privy 支付](https://www.privy.io/payments)、[Dynamic 产品/套餐](https://www.dynamic.xyz/pricing)、[Coinbase 发布说明](https://www.coinbase.com/en-ca/developer-platform/discover/launches/embedded-wallets-ga)

建议先明确“数字币”属于哪一种需求：平台内部点数、USDC 等链上资产收款、创作者分成提现、或者发行自己的链上资产。内部点数通常可以继续使用业务数据库；只有真实链上交互才需要钱包和链选择。第二阶段可用单一测试网络验证 USDC 类代币收付，生产网络与支付服务商等目标市场确定后再选。

## OpenGame 的落地路线（设计建议）

根据本次仓库检查，网站使用 Next.js 16、React 19、PostgreSQL；现有 `studio_users` 以 UUID 标识用户，邀请码登录后发放自有 HttpOnly session，项目、额度和推荐奖励关联内部用户 ID。此处记录项目现状，非平台官方能力声明。

1. **保留内部用户 ID。** 新建独立身份映射（provider、provider subject、内部 user ID），保持现有项目/额度/奖励归属。不要直接用邮箱或钱包地址做主键。
2. **先邮箱与 Google 登录。** 服务端验证供应商令牌后映射用户并发放自有会话。认证成功与获得内测资格分开处理；邀请码成为邀请资格，而不是长期身份凭证。
3. **提供已有账号绑定路径。** 已经使用邀请码的用户在当前可信会话中绑定新身份；不要只因邮箱字符串相同就自动合并不同账号。
4. **调整旧约束。** 当前 `access_hash`、`expires_at` 非空，不能直接把供应商新用户塞入旧表而不考虑这些字段语义；区分账号有效性、会话过期与邀请资格。
5. **钱包按需启用。** 第一阶段不展示链选择/充值/助记词；后续在用户真正进入资产功能时创建或连接钱包。具体延迟创建开关需用选定 SDK 实测。身份仍采用稳定内部 ID。
6. **只在可信站点挂载钱包。** 不把 SDK、认证令牌或签名权限传入 AI 生成游戏的 iframe。将付款、提现及绑定身份操作保留在可信外层界面。
7. **额度账本与链上余额分开。** 后续根据经服务端验证的交易和最终状态记账，处理重复事件、失败和退款，不信任浏览器提交的“支付成功”。

首轮只需用 Privy 跑通新注册、旧账号绑定、重复登录不重复建号、退出、跨设备登录、账户删除及未来钱包创建；若成本模型或目标地区表现不合适，再使用相同验收项测试 Dynamic / MetaMask / CDP。需要实际测量 Next.js/React 兼容性、邮件到达、移动端 OAuth、目标用户网络可达性；本次是资料研究，尚未做 SDK 集成测试。

## 尚需验证

- 目标用户主要地区、预计活跃用户数，以及到底需要收款还是提现/分账。
- 私钥导出、备用登录方式、供应商停服恢复是否适用于最终选择的 SDK、钱包模式和套餐。
- 自有会话退出与供应商会话撤销的联动，以及绑定身份需要的重新认证。
- 定价页面边界、企业版功能和超额费用；尤其 Privy 的交易量门槛、Turnkey 同页报价差异。
- 稳定币产品的地区准入、身份核验和供应商合同要求，待具体市场和资金流程确定后查相应官方条款。本报告不据泛化产品宣传推断法律许可。
