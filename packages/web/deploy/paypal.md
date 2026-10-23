# PayPal 制作额度购买

OpenGame 使用自己的登录账号、PostgreSQL 订单和额度流水。支付协议参考 `gnuser/RobloxCursorClickerSite/website/checkout-api/paypal.js`，没有调用 Clicker 的固定 $5 商品接口，也没有修改 Clicker 的部署或凭据。

## 当前状态

本地已实现套餐读取、跳转 PayPal、收款确认、通知验签、自动入账、购买记录、额度消费与退款撤销。默认关闭，尚未配置 OpenGame 的真实商户凭据及 webhook，也未进行真实 PayPal 沙箱买家或 Live 付款验收。模拟测试不证明商户审核或真实付款成功。

第一版为一次性 USD 套餐，1 credit 对应 1 次制作。基础额度 → 邀请奖励 → 购买额度依次消费。购买额度不受基础每日/累计上限限制，但不增加项目上限或纯讨论上限；失败、取消也扣一次，与现有制作次数规则一致。购买额度本身不设到期时间，但账号有效期和停用状态仍然生效，售前应让用户知晓账号可用期限。

## 配置

配置写入服务器已有的私有环境文件，重启工作台即可生效，无需为套餐变动重建前端。不要把真实凭据写进仓库、命令参数或聊天。

| 配置                            | 含义                                                      |
| ------------------------------- | --------------------------------------------------------- |
| `OPENGAME_PAYPAL_ENVIRONMENT`   | `sandbox` 或 `live`，默认 sandbox                         |
| `OPENGAME_PAYPAL_CLIENT_ID`     | PayPal REST App Client ID                                 |
| `OPENGAME_PAYPAL_CLIENT_SECRET` | 同一 App 的私密 Secret                                    |
| `OPENGAME_PAYPAL_MERCHANT_ID`   | 收款商户的 13 位 Merchant ID，逐单校验                    |
| `OPENGAME_PAYPAL_WEBHOOK_ID`    | 为 OpenGame 回调注册的 webhook ID，不是 Clicker 回调的 ID |
| `OPENGAME_CREDIT_PACKS`         | 套餐 JSON 数组，默认 `[]`，空数组或格式错误关闭新购买     |
| `OPENGAME_PAYPAL_ENABLED`       | 默认关闭；`true` 才能创建和主动收款                       |
| `OPENGAME_PAYPAL_LIVE_READY`    | Live 额外开关；必须为 `true` 且工作台使用 HTTPS           |

需要 `OPENGAME_ACCESS_MODE=invite`，支持现有访问码和 Privy 登录。未登录不能购买或查询他人订单。

套餐结构示例（仅说明配置格式，不代表已经确定价格）：

```dotenv
OPENGAME_CREDIT_PACKS='[{"id":"starter","credits":10,"amountMinor":500},{"id":"creator","credits":30,"amountMinor":1200}]'
```

`amountMinor` 为美元分，500 表示 $5.00。最多 10 个套餐，ID 唯一；单个套餐 1–100000 次、100–1000000 美分。已创建订单保存价格和次数快照，之后改价不改变旧订单。删除套餐会阻止该套餐未创建完毕的链接重试，完整订单仍可核对。

测试环境必须使用独立数据库、测试账号和沙箱凭据。不要让真实用户进入沙箱，或把沙箱已发放的测试额度迁入生产数据库。

## 回调及开通

在拟供 OpenGame 使用的 PayPal REST App 中新增 webhook：

`https://studio.xiajuan.app/api/payments/webhook`

订阅：

- `PAYMENT.CAPTURE.COMPLETED`
- `PAYMENT.CAPTURE.PENDING`
- `PAYMENT.CAPTURE.DECLINED`
- `PAYMENT.CAPTURE.DENIED`（旧事件，如控制台提供）
- `PAYMENT.CAPTURE.REFUNDED`
- `PAYMENT.CAPTURE.REVERSED`

可以评估复用现有商户，但 OpenGame 的回调要单独注册、单独配置 webhook ID。保留 Clicker 的原回调。原站保存在 Cloudflare 的加密 Secret 不会因复制源码而自动转移到 OpenGame。

回调只对精确路径豁免浏览器 Origin/会话检查；仍检查 Host、消息大小、证书域名，并调用 PayPal 验签。随后读取 PayPal 原始订单和 capture，核对商户、USD 金额、订单编号、套餐和 capture 编号。非本站订单直接忽略；用户点击同意、成功页面参数和未完成付款不能直接加额度。

## 用户流程与恢复

“额度与邀请”中显示购买余额、可售套餐和最近 50 笔记录。选择套餐创建本地订单后跳转 PayPal；返回工作台后向后端请求收款确认。只有确认完成，才在一个数据库事务中保存支付状态、唯一额度流水和账号额度。重复并发确认、重复通知不会多入账。

如果买家仅批准付款后关闭页面、尚未 capture，订单不会当作已付款；从原账号购买记录中点击“核对付款”可以继续确认。capture 已完成而浏览器关闭，后台通知可以独立入账。也可以主动核对恢复漏通知；本版没有后台全量定时对账任务。

网络断开后恢复支付链接使用同一请求编号；超过 1 小时的未知创建结果拒绝再次创建，应人工核对 PayPal 后处理。每账号每小时最多创建 10 笔新订单。返回 URL 只携带本地订单 ID，不携带账号权限；付款或核对始终需要原账号登录。

关闭 `OPENGAME_PAYPAL_ENABLED` 停止新订单及主动 capture，但保留凭据和回调，已有付款仍可查询、入账及处理退款。不要为关闭购买而删除 webhook 或凭据。

## 退款边界

首版不提供站内发起退款按钮。卖方在 PayPal 处理整单退款，收到已验证通知或主动核对后收回整笔套餐额度。撤销同样收回；迟到的成功通知不能恢复已收回额度。

部分退款采用保守处理：暂收回整笔套餐额度并标为待核对，不自动按金额比例补回，不提供自动部分退款结算。需要部分退款时先人工确认使用量和补偿方式；不要把这一状态展示成已完成的比例结算。

已消费的购买次数不因退款清零。退款后可出现内部额度欠额，界面最低显示 0；之后购买先抵扣欠额，避免把已消费额度重复兑现。基础额度和邀请奖励单独保留。`studio_credit_ledger` 保存 purchase/revoke 流水，消费由 `studio_jobs.uses_paid` 记录。

## 验证与生产切换

本次数据库集成测试使用独立临时数据库、模拟 PayPal 响应，不会创建真实支付或退款：

```sh
node --import tsx --test packages/web/test/integration/payments.test.ts packages/web/test/integration/access.test.ts packages/web/test/integration/conversation.test.ts
npm run typecheck --workspace=@opengame/web
```

真实启用前，在隔离沙箱以测试买家完成：批准付款 → 返回 → capture → 入账 → 使用一次 → 重复通知 → 整单退款，并检查关闭浏览器、账号重登、错误付款与查询恢复。之后准备正式套餐和售前退款/联系方式说明，配置 Live 凭据和 OpenGame webhook，完成部署备份，再启用两个销售开关。尚未完成这些步骤时保持关闭。

迁移仅增加购买表、购买额度字段与任务消费标记；数据库备份包含订单和账本。开始售卖后不能直接回滚到不认识 `uses_paid` 的旧代码，否则会把购买额度任务重新计入基础额度。停卖时保留新版本的查询、回调和额度逻辑。

官方参考：[Orders API](https://developer.paypal.com/docs/api/orders/v2/)、[请求幂等](https://developer.paypal.com/api/rest/reference/idempotency/)、[通知验签](https://developer.paypal.com/api/webhooks/v1/verify-webhook-signature-post)。
