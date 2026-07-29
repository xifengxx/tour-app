# AI 自动处理导览 — 功能文档

## 功能目标

用户在前端创建导览 → 点击「AI 分析」→ 服务器自动调用 DeepSeek 提取地点、生成内容、规划路线 → 数据库写入完成 → 前端自动检测并跳转到审核页面。

## 架构

```
用户浏览器 (Vercel SPA)
    │
    ├─ POST tours (保存草稿) ──────────→ Supabase REST API
    │
    ├─ POST Edge Function (触发处理) ──→ Supabase Edge Function
    │                                       │
    │                                       ├─ 读取草稿
    │                                       ├─ DeepSeek API (提取地点)
    │                                       ├─ 高德 API (查询坐标)
    │                                       ├─ DeepSeek API (生成四层内容)
    │                                       ├─ DeepSeek API (规划路线)
    │                                       └─ 写入 Supabase
    │
    └─ GET locations (轮询检测) ────────→ Supabase REST API
                                            │
                                        检测到数据 → 跳转审核页
```

## 组件

| 文件 | 职责 |
|------|------|
| `src/pages/TourEdit.jsx` | 导览编辑：保存草稿、触发 Edge Function |
| `src/components/ProcessingPhase.jsx` | 等待页面：轮询数据库，检测 AI 写入完成 |
| `supabase/functions/process-tour/index.ts` | Supabase Edge Function：AI 处理核心逻辑 |

## 部署配置

### Supabase Edge Function

```
部署命令:
  npx supabase functions deploy process-tour --project-ref qxunedraoviaonjdanag --no-verify-jwt

所需 Secrets:
  SB_SERVICE_ROLE_KEY  — Supabase service_role key（绕过 RLS 写数据）
  DEEPSEEK_API_KEY     — DeepSeek API key（AI 内容生成）

函数地址:
  https://qxunedraoviaonjdanag.supabase.co/functions/v1/process-tour
```

### Vercel 前端

```
框架: Vite (React SPA)
域名: https://tour-app-pro.vercel.app
环境变量:
  VITE_SUPABASE_URL        — Supabase 项目 URL
  VITE_SUPABASE_ANON_KEY   — Supabase 匿名 key
```

## 测试记录

### 函数测试

```bash
# Edge Function 直接测试（成功）
curl -X POST "https://qxunedraoviaonjdanag.supabase.co/functions/v1/process-tour" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sb_publishable_Pp21-3ssB3rSxwFnA-WZZw_eUHmF31E" \
  -d '{"tourId":"<TOUR_ID>"}'

# 返回: {"success":true,"locations":5,"routes":3}
```

### Console 手动请求测试

```javascript
// tours 表查询（成功）
fetch('https://qxunedraoviaonjdanag.supabase.co/rest/v1/tours?select=id&limit=1', {
  headers: { apikey: 'sb_publishable_Pp21-3ssB3rSxwFnA-WZZw_eUHmF31E', Authorization: 'Bearer sb_publishable_Pp21-3ssB3rSxwFnA-WZZw_eUHmF31E' }
}).then(r => r.json()).then(console.log);

// locations 表查询（成功）
fetch('https://qxunedraoviaonjdanag.supabase.co/rest/v1/locations?select=id&limit=1', {
  headers: { apikey: 'sb_publishable_Pp21-3ssB3rSxwFnA-WZZw_eUHmF31E', Authorization: 'Bearer sb_publishable_Pp21-3ssB3rSxwFnA-WZZw_eUHmF31E' }
}).then(r => r.json()).then(console.log);
```

### setInterval 轮询测试

```javascript
// ProcessingPhase 正在运行时，在 Console 执行手动轮询
let count = 0;
const id = setInterval(() => {
  fetch('https://qxunedraoviaonjdanag.supabase.co/rest/v1/locations?select=id&limit=1', {
    headers: { apikey: 'sb_publishable_Pp21-3ssB3rSxwFnA-WZZw_eUHmF31E', Authorization: 'Bearer sb_publishable_Pp21-3ssB3rSxwFnA-WZZw_eUHmF31E' }
  }).then(r => r.json()).then(() => console.log('✅ manual poll', ++count)).catch(e => console.log('❌', e.message));
  if (count >= 5) clearInterval(id);
}, 5000);
```

## 已知问题

| 问题 | 状态 | 说明 |
|------|------|------|
| ProcessingPhase 轮询 ERR_INTERNET_DISCONNECTED | ✅ 已解决（2026-07-29） | 根因：长时挂起的 Edge Function POST 与每 5s 轮询 GET 并发，国内网络下长连接被重置。方案：移除轮询，前端直接 await Edge Function 响应；tours 表新增 status 字段（draft/processing/done/error） |
| Edge Function 函数调用 | ✅ 正常 | curl 直接调用返回正确数据 |
| 草稿保存 | ✅ 正常 | POST 到 Supabase 成功 |
| 主页加载 | ✅ 正常 | Supabase 查询 tours 表成功 |

## 2026-07-29 架构调整：await 响应替代轮询

原设计在触发 Edge Function 后由 ProcessingPhase 每 5 秒轮询 locations 表检测完成。
在国内网络环境下，长时挂起的 POST（1-5 分钟）与高频轮询并发，连接被重置后
Chrome 对轮询请求报 `net::ERR_INTERNET_DISCONNECTED`（请求未发出，与应用层无关）。

现架构：

```
TourEdit 保存草稿 → await fetch(Edge Function) ──→ 成功：window.location.reload()
                                                  └─→ 失败：ProcessingPhase 显示错误 + 重试按钮
```

同时 `tours.status` 字段记录处理状态（Edge Function 写入），供后续"关闭页面后回来查看进度"使用。

部署注意：
1. 数据库执行：`ALTER TABLE tours ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft';`
2. 重新部署函数：`npx supabase functions deploy process-tour --project-ref qxunedraoviaonjdanag --no-verify-jwt`

## 2026-07-29 第二根因：Edge Function 的 service_role 密钥失效

修复轮询后端到端测试发现：函数返回 `success:true` 但数据库零写入。
根因是 secret `SB_SERVICE_ROLE_KEY` 的值无效，函数内所有 REST 调用 401。
**注意：fetch 收到 4xx 不会抛异常**，代码未检查响应状态，导致全部静默失败——
连读取草稿都失败（得到错误对象而非数组），DeepSeek 只能拿到空文本。

教训：
- 函数内所有 fetch 必须检查 `res.ok`，失败要显式抛错
- 端到端验证必须查数据库确认真实写入，不能只看函数返回值

修复：`supabase secrets set SB_SERVICE_ROLE_KEY=<legacy service_role JWT>`。
验证：E2E 测试 5 地点 + 3 路线 + status=done 全部落库（已清理测试数据）。

## 已排除的变量

- PWA Service Worker（已从构建中移除）
- Supabase JS 客户端（已换成原生 fetch）
- Vite 环境变量注入（已硬编码 URL 和 key）
- tours vs locations 表差异（console 测试两者均正常）
- Supabase 域名墙（console 测试可连通）
