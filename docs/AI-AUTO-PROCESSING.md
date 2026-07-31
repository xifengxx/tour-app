# AI 自动处理导览 — 功能文档

## 功能目标

用户在前端创建导览 → 点击「AI 分析」→ 保存草稿到 Supabase → 数据库触发器服务器端调用 Edge Function → DeepSeek 提取地点、生成内容、规划路线 → 高德 API 查坐标 → 写入数据库 → 前端轮询检测完成 → 自动跳转审核页。

## 架构

```
用户浏览器 (Vercel SPA)        Supabase                      DeepSeek / 高德
    │                            │                              │
    │ 1. INSERT (status=process)─→ tours                        │
    │                            │ 2. 触发器 fire               │
    │                            │    └──→ http_post ──────→  Edge Function
    │                            │              │                 │
    │                            │              ├─ 提取地点 ────→ DeepSeek
    │                            │              ├─ 查坐标 ──────→ 高德 Web API
    │                            │              ├─ 生成内容 ────→ DeepSeek
    │                            │              └─ 规划路线 ────→ DeepSeek
    │                            │              │
    │ 3. 轮询 GET locations ←────┼──────────────┘ 写入 locations
    │ 4. 加载完整数据 ←──────────┼────────────────── SELECT tours+join
    │ 5. 审核页 → 保存 → 查看    │
```

> **关键设计**：Edge Function 由数据库触发器（pg_net）**服务器端**调用，浏览器不发起任何长连接。

## 组件

| 文件 | 职责 |
|------|------|
| `src/pages/TourEdit.jsx` | 导览编辑：保存草稿、ProcessingPhase 控制、审核保存 |
| `src/components/ProcessingPhase.jsx` | 等待页面：轮询检测 + 自动重试加载数据 |
| `supabase/functions/process-tour/index.ts` | Supabase Edge Function：AI 处理核心逻辑 |

## 数据库配置

### pg_net 触发器

```sql
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION trigger_ai_process()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://qxunedraoviaonjdanag.supabase.co/functions/v1/process-tour',
    body := json_build_object('tourId', NEW.id)::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer sb_publishable_Pp21-3ssB3rSxwFnA-WZZw_eUHmF31E'
    ),
    timeout_milliseconds := 60000
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_process_trigger
  AFTER INSERT ON tours
  FOR EACH ROW
  WHEN (NEW.status = 'processing')
  EXECUTE FUNCTION trigger_ai_process();
```

### tours.status 字段

```sql
ALTER TABLE tours ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft';
```

状态流转：`draft` → `processing`（草稿保存时）→ `done`（AI 处理完成）

## Supabase Edge Function

### 部署

```bash
npx supabase functions deploy process-tour --project-ref qxunedraoviaonjdanag --no-verify-jwt
```

### Secrets

| Key | 说明 |
|-----|------|
| `SB_SERVICE_ROLE_KEY` | Supabase service_role key（绕过 RLS 写数据） |
| `DEEPSEEK_API_KEY` | DeepSeek API key（AI 内容生成） |

### 函数地址

`https://qxunedraoviaonjdanag.supabase.co/functions/v1/process-tour`

### 关键修复

| 版本 | 修复内容 |
|------|---------|
| v1 | 初始版本，基础 AI 处理流程 |
| v2 | `res.ok` 检查：fetch 对 4xx 不抛异常，之前静默失败 |
| v3 | ID 命名空间：`{tourId前8位}-{slug}` 避免全局主键冲突 |
| v4 | stops 格式兼容：DeepSeek 可能返回对象数组，做 slug/中文名/包含关系三重匹配 |
| v5 | `setStatus` 记录处理进度，支持 `status` 字段 |

## 测试记录

### 端到端验证

```bash
# 1. 确认函数可用
curl -X POST "https://qxunedraoviaonjdanag.supabase.co/functions/v1/process-tour" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sb_publishable_Pp21-3ssB3rSxwFnA-WZZw_eUHmF31E" \
  -d '{"tourId":"<TOUR_ID>"}'
# 返回: {"success":true,"locations":N,"routes":M}

# 2. 确认数据写入（用 service_role key，绕过 RLS）
curl -s "https://qxunedraoviaonjdanag.supabase.co/rest/v1/locations?tour_id=eq.<TOUR_ID>" \
  -H "apikey: <SERVICE_ROLE_KEY>" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>"

# 3. 确认函数日志
# 打开: https://supabase.com/dashboard/project/qxunedraoviaonjdanag/functions/process-tour/logs
```

### 已知问题 & 修复记录

| 问题 | 根因 | 修复 |
|------|------|------|
| `ERR_INTERNET_DISCONNECTED` 轮询失败 | Chrome 连接池耗尽（长 POST + 并发 GET） | 数据库触发器替代浏览器调用 |
| 数据写入但查询返回空 | RLS 策略：anon key 查不到非公开导览 | 轮询用 Supabase 客户端（带用户 JWT） |
| 审核页显示空数据 | 复杂 join 查询比简单轮询更易失败 | `onCheckDone` 预加载 + 5 次重试 |
| 保存后跳转 404 | `vercel.json` 被删，SPA rewrite 丢失 | 保留 `"rewrites": [{"source": "/(.*)", "destination": "/"}]` |
| Edge Function 409 主键冲突 | ID 全局唯一约束，DeepSeek 生成重复 slug | v3：ID 加 tourId 前缀做命名空间 |

## 错误排查清单

1. **函数日志**：`https://supabase.com/dashboard/project/qxunedraoviaonjdanag/functions/process-tour/logs`
2. **数据确认**：用 service_role key 查询 `locations`/`routes` 表
3. **触发器状态**：`SELECT * FROM pg_trigger WHERE tgname = 'ai_process_trigger';`
4. **RLS 策略**：`SELECT * FROM pg_policies WHERE tablename IN ('locations', 'routes');`
5. **浏览器扩展**：`chrome://extensions/` 禁用所有扩展后测试
6. **SPA 路由**：确认 `vercel.json` 存在且含 `rewrites` 配置
