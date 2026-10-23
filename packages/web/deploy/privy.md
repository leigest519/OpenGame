# Privy 邮箱验证码与 Google 登录

第一阶段仅注册和身份验证，不自动创建 Ethereum / Solana 钱包，不启用支付或链选择。应用的公开 App ID 为 `cmv9infp6034t0gl4aapfil6s`。不需要 App Secret；后端通过该应用的公开 JWKS 验证 ES256 签名、issuer、audience、有效期和 subject/session claims。

本次只读检查：应用名 `opengame`，邮箱已开启、Google 尚未开启、自动建钱包已关闭；CAPTCHA 尚未开启，允许域名列表为空。此为检查时状态，完成控制台设置后需再验收。

## Privy 控制台

在 [Privy Dashboard](https://dashboard.privy.io/) 选择上述应用：

1. 在登录方式设置中启用 **Email（验证码）** 和 **Google**。保留注册能力，避免仅允许既有用户的配置。Google 按控制台要求选择默认 OAuth 配置或自己的 OAuth 客户端；如果使用自己的客户端，回调 URL 必须使用 Privy 控制台给出的精确地址，不是自行填写 OpenGame API 地址。
2. 配置工作台的 Allowed origins / 允许访问地址：生产环境为 `https://studio.xiajuan.app`；本机测试按实际端口添加 `http://127.0.0.1:4190`（若使用 localhost，也单独添加）。不要添加游戏资源域名 `studio-games.xiajuan.app`。
3. 关闭自动创建嵌入式钱包；客户端也明确设置两个钱包类型的 `createOnLogin: 'off'`。
4. 开放注册前启用 Privy 的 CAPTCHA 和临时邮箱等反滥用设置。邮箱验证不等于一个自然人，现有邀请奖励仍不能完全防止多账号获取额度。

参考：[登录方式](https://docs.privy.io/basics/get-started/dashboard/configure-login-methods)、[React 设置](https://docs.privy.io/basics/react/setup)、[令牌验证](https://docs.privy.io/authentication/user-authentication/access-tokens)。

## 服务端配置

在实际服务环境文件中加入：

```dotenv
OPENGAME_ACCESS_MODE=invite
OPENGAME_AUTH_PROVIDER=privy
OPENGAME_PRIVY_APP_ID=cmv9infp6034t0gl4aapfil6s
```

继续保留数据库、两个访问地址和 `OPENGAME_PREVIEW_SECRET` 等现有配置。`invite` 在这里负责开启会话保护；`AUTH_PROVIDER=privy` 才决定邮箱/Google 开放注册。缺少 App ID 或试图搭配 local 模式时启动失败，不会降级成免登录。

依赖安装后重新构建并重启服务：

```sh
npm ci --workspace=@opengame/web --include-workspace-root=false --ignore-scripts
npm run build:production --workspace=@opengame/web
```

服务使用原来的环境文件启动。App ID 经 `/api/session` 动态提供，修改 App ID 后只需重启，不需要为配置变化重新构建。不要把 App Secret、OAuth secret 放进公开变量或前端代码。

本机可将上述配置和随机预览密钥写入仓库忽略的 `packages/web/.env`，在 `packages/web` 目录运行：

```sh
node --env-file=.env --import tsx scripts/dev.ts
```

本机与生产应使用不同 Privy 应用/环境。切换为需要登录的模式后，原先没有 owner 的本机项目不会自动归属新账号；确认后使用现有 `invite.ts claim-local <成员ID>` 命令迁移。

## 用户行为与迁移

- 新用户点击邮箱或 Google，验证成功后才创建内部账号。默认沿用 10 个项目、每日 10 次/累计 100 次制作额度；新注册账号不设置内测到期时间，管理员仍可停用。当前展示名为“创作者 + 内部 ID 短码”，不依赖客户端传入的邮箱或昵称授权。
- 旧用户先在“已有访问码？先恢复原账号”中登录，然后在账号菜单绑定邮箱或 Google。绑定保留原 ID、名称、作品、额度、邀请关系与原到期时间；不会因为绑定而延长内测权限。
- 绑定完成后，原访问码失效，旧设备会话和试玩票据全部撤销，当前设备获得新会话。以后使用绑定后的 Privy 身份登录。
- 已属于其他内部账号的登录身份不会自动合并；当前账号已绑定别的 Privy 身份也不能覆盖。不要先注册新号再尝试合并旧号。
- 同一个 Privy 用户的重复/并发首次登录只创建一个内部账号。身份按 `provider + app_id + subject` 唯一识别，不按邮箱地址匹配。邮箱和 Google 是否关联成同一 Privy 用户由 Privy 的账号关联规则决定，OpenGame 不自行合并。
- 退出同时清除 OpenGame 会话和当前浏览器的 Privy 登录状态；页面不会仅因存在 Privy 缓存身份就自动重新登录。
- 平台会话最长 7 天、最多 5 个设备。会话到期后需要用户再次点击登录，不在后台无限续期。Privy 控制台单独删除/冻结用户不会即时撤销已签发的 OpenGame 会话；立即禁用必须使用本平台 `invite.ts disable <成员ID>`。后续如需要供应商事件同步，可单独接入 webhooks。
- 推荐奖励当前仍在访问码首次登录时发放一次，绑定本身不重复发放；普通开放注册不凭空增加推荐奖励。邀请码流程的进一步身份化可以另做。
- 钱包 SDK、登录令牌及签名能力只在工作台外层运行，不传给生成游戏或其 iframe。

## 验收与回滚

自动化测试覆盖实际 ES256 签名验证、伪造/过期/错误应用令牌、跨站请求、并发建号、绑定冲突、旧会话撤销、额度/作品保留、账号停用和限流。集成测试使用独立临时数据库与合成签名，不会创建真实 Privy 用户或发送邮件。

真实上线前还需要人工验收：邮箱收码和错误验证码、Google 授权返回、取消登录、刷新和跨设备登录、旧账号绑定、退出后刷新、手机端显示。没有真实登录验收前，不能将测试通过视为 Google/邮件配置已完成。

数据库启动迁移新增 `studio_identities` 并允许无访问码账号；不改动旧项目和余额。回滚代码前备份数据库。将 `AUTH_PROVIDER` 改回 `invite` 会关闭邮箱/Google 登录，但已绑定或新注册用户没有有效访问码，因此不能以此作为无损用户回滚方案；保留 Privy 入口或先制定账号恢复安排。

## 依赖检查记录

锁定 Privy React SDK 3.49.0、jose 6.2.2。安装器包含 SDK 的完整钱包依赖树，当前应用只使用认证功能。更新了新依赖中的 hono 和 lodash 后，生产依赖审计仍报告 28 项（3 high）：涉及钱包依赖的旧 ws，以及既有 sharp、source-map-js；其余为 moderate/low。没有使用 `audit fix --force` 降级 SDK 或升级既有图片处理模块。钱包相关能力尚未启用，但这不等于这些依赖已无风险；生产发布前应继续处置和评估这些已知告警。

构建有 SDK 可选 Farcaster 包未安装及 viem/ox 动态导入的警告；当前邮箱弹窗与旧账号登录路径已进行浏览器检查。未将未使用的 Farcaster 功能加入产品。
