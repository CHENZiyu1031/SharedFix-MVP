# SharedFix MVP

SharedFix 是开源软件升级联合采购的课堂原型。三家应用团队为同一项钱包连接器升级分别出资 4,000、3,000 和 3,000 mUSDC。可以在浏览器中切换角色，观察智能合约何时允许付款、复核或退款。mUSDC 是模拟代币，余额和交易回执来自本机运行的 Ganache 测试链。

## 本地启动

安装 Node.js 20 或更高版本，以及能读取 v9 锁文件的 pnpm（如 pnpm 9）。克隆仓库并进入含 `package.json` 的目录，运行：

```bash
pnpm install --frozen-lockfile
pnpm run build
pnpm start
```

打开终端显示的地址，默认为 `http://127.0.0.1:8787/`。端口已被占用时，以终端输出为准。演示使用自动创建的本地测试账户，无需连接个人钱包。按 Ctrl+C 结束服务，重启会重新创建测试链。

## 演示场景

| 页面 | 可以观察什么 |
| --- | --- |
| Fund & settle | 三方存款全部到账后订单生效。维护者提交交付材料，两名买方批准且异议期届满后，维护者和平台分别领取 9,500 和 500 mUSDC。 |
| Expire & refund | 只存入前两份资金便推进至筹资截止时间。A、B 可各自领回原款，重复领取会被合约拒绝。 |
| Independent review | 买方提出异议或审批超时后，订单进入独立复核。可以推进本地时钟，查看主复核人、备用复核人的权限及最终退款条件。 |

三个场景各有一条独立的本地链。演示步骤和中英文讲稿见[课堂演示指南](docs/课堂演示指南.md)。

## 从哪里修改

| 文件或目录 | 用途 |
| --- | --- |
| `contracts/` | 联合采购订单与模拟代币的 Solidity 合约 |
| `compile.cjs` | 编译合约，将 ABI 和字节码写入 `artifacts/` |
| `engine.cjs`、`server.cjs` | 创建测试账户与场景，执行交易并向本地页面提供数据 |
| `web/` | 浏览器页面、交互和样式 |
| `docs/` | [订单条款](docs/order-terms.json)、[交付材料样例](docs/example-delivery.json)与演示指南 |
| `verify.cjs` | 使用本地链检查筹资、结算、退款和复核流程 |

## 小组协作

1. 在 GitHub 新建 Issue，写明要改进的场景和期望结果。
2. 从默认分支创建自己的分支，例如 `git switch -c feature/refund-ui`。
3. 修改合约后运行 `pnpm run build`。用 `pnpm run verify` 检查订单流程，修改页面时也可从 `pnpm start` 进入对应场景查看效果。
4. 推送分支并发起 Pull Request，关联 Issue，写明修改内容和验证结果。界面修改可附截图，方便组员审阅。
