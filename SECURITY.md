# 安全说明

## npm audit 已接受的风险

| 项 | 内容 |
|------|------|
| 告警 | [GHSA-qwww-vcr4-c8h2](https://github.com/advisories/GHSA-qwww-vcr4-c8h2) — React Router RSC Mode CSRF Bypass |
| 包 | `react-router` / `react-router-dom`（当前 `7.18.1`） |
| 受影响区间 | `7.12.0 ~ <8.3.0`；官方修复在 `8.3.0+` |
| CVSS | 6.5（中危；npm audit 标记为 high） |

**为什么接受**：该漏洞只影响 **unstable RSC（React Server Components）API** 的代码路径。本项目是纯客户端 SPA（`BrowserRouter` + `Routes`，无 RSC、无 server actions、无 SSR），部署在 Vercel 静态托管，永远不会走到受影响路径。升级到 v8 或降级到 7.11.0 都会为一条未使用的代码路径付出迁移/倒退成本，不值得。

**何时重新评估**：若本项目将来引入 RSC / SSR / Remix 等服务器渲染能力，须先将 `react-router` 升级到 `>= 8.3.0` 再上线，并解除本条记录。

## 验证命令

```bash
npm audit    # 预期剩余 2 high：即本表已接受项
```
