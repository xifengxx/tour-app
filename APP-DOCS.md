# 文学巡礼 App — 开发文档

> 🎨 **设计规范见 [DESIGN.md](./DESIGN.md)**（Claude/Anthropic 风格：羊皮纸底 + 陶土色 + 衬线标题，全站亮色）。

本次代码结构、性能和测试优化见 **[2026-09 优化变更总结](./docs/OPTIMIZATION-2026-09.md)**。

## 关键密钥

操作前先确认以下密钥可用：

| 密钥              | 值                                                              | 用途                    |
| ----------------- | --------------------------------------------------------------- | ----------------------- |
| 高德 Web 服务 Key | `2ff1bf71b26aed0a92eb4ab63657bb25`                              | REST API 坐标查询 ⭐    |
| 高德 JS API Key   | `858c05dea3990ef1b900bfd298ebefa7`                              | 前端地图显示            |
| 高德 安全码       | `f98c91fa4c7219afe557be4f0786f594`                              | JS API 安全密钥         |
| Supabase PAT      | `你的 Supabase PAT`（见 Supabase Dashboard → Account → Tokens） | Management API 写入数据 |
| Supabase URL      | `https://qxunedraoviaonjdanag.supabase.co`                      | 数据库                  |
| Supabase Anon Key | `sb_publishable_Pp21-3ssB3rSxwFnA-WZZw_eUHmF31E`                | 前端匿名访问            |

> ⚠️ **JS Key ≠ Web 服务 Key**。用 JS Key 调 REST API 返回 `USERKEY_PLAT_NOMATCH`。查坐标必须用 Web 服务 Key。

---

## 新增导览 · 自动化

用户在前端（首页 → 登录 → + 创建导览 → 填信息 → 粘贴源材料 → 点 AI 分析）提交后，系统自动完成处理，30-60 秒后跳到审核页面。无需手动操作。

详细架构和测试方法见 **[docs/AI-AUTO-PROCESSING.md](./docs/AI-AUTO-PROCESSING.md)**。

### 流程图

```
用户点 AI 分析
  → TourEdit 保存草稿到 Supabase (status=processing)
  → 数据库触发器 (pg_net) 服务器端调用 Edge Function
  → Edge Function: DeepSeek 提取地点 → 高德查坐标 → DeepSeek 生成内容 → 规划路线
  → 写入 Supabase (locations, routes, content_layers)
  → ProcessingPhase 轮询检测到数据 → 自动加载完整数据 → 审核页
```

> **关键设计决策**：Edge Function 由数据库触发器服务器端调用，浏览器不发起任何长连接。避免了 Chrome 连接池耗尽导致的 `ERR_INTERNET_DISCONNECTED`。

### 数据库配置

```sql
-- pg_net 扩展 (服务器端 HTTP 请求)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 触发器函数
CREATE OR REPLACE FUNCTION trigger_ai_process()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://qxunedraoviaonjdanag.supabase.co/functions/v1/process-tour',
    body := json_build_object('tourId', NEW.id)::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer sb_publishable_...'
    ),
    timeout_milliseconds := 60000
  );
  RETURN NEW;
END;
$$;

-- INSERT 触发器（新导览）
CREATE TRIGGER ai_process_trigger_insert
  AFTER INSERT ON tours
  FOR EACH ROW
  WHEN (NEW.status = 'processing')
  EXECUTE FUNCTION trigger_ai_process();

-- UPDATE 触发器（重新处理已有导览）：仅 status 从非 processing 转入时触发，
-- 避免与函数内部 setStatus('processing') 形成死循环
CREATE TRIGGER ai_process_trigger_update
  AFTER UPDATE ON tours
  FOR EACH ROW
  WHEN (NEW.status = 'processing' AND OLD.status IS DISTINCT FROM 'processing')
  EXECUTE FUNCTION trigger_ai_process();
```

> 完整可重复执行的 SQL 见 **`supabase/ai-triggers.sql`**。若库里已有旧版 `ai_process_trigger`，建议删除以免 INSERT 双触发。

### 手动处理（备选）

如需手动批量导入数据（离线场景），仍可用原有的 JSON + 脚本方式：

- [ ] 构建数据 JSON 文件（格式参考下方「数据写入方法对比」）
- [ ] 运行 `node scripts/insert-tour.mjs scripts/xx-data.json`

---

## 数据写入方法对比

| 方法                          | 优点             | 缺点                  | 适用场景                            |
| ----------------------------- | ---------------- | --------------------- | ----------------------------------- |
| JSON 文件 + `insert-tour.mjs` | **中文天然安全** | 多一步                | **插入含中文的内容数据** ⭐         |
| Management API SQL            | 无需连接配置     | 中文需转义            | 简单 SQL（UPDATE / ALTER / DELETE） |
| REST API (anon key)           | 直接传 JSON      | 受 RLS 限制           | 前端 CRUD                           |
| REST API (service_role)       | 绕过 RLS         | 需要 service_role key | 批量写入                            |
| psql 直连                     | 最快             | DNS / IP 限制         | 生产环境                            |

### 黄山 vs 泰山的教训

同为脚本内联 JS 对象，黄山一次成功，泰山踩坑多次：

|          | 黄山        | 泰山                                                   |
| -------- | ----------- | ------------------------------------------------------ |
| 结果     | ✅ 一次成功 | ❌ SyntaxError → 3 次重试                              |
| 失败原因 | —           | 中文弯引号 `"东方三大神殿"` 被 JS 解析器当字符串终止符 |

**根因**：中文弯引号 `""`（U+201C / U+201D）与 ASCII `"`（U+0022）外形相近，JS 解析器随机误判。JSON 文件方案彻底消除此不确定性——JSON 规范中只有 ASCII `"` 是分隔符。

---

## 常见问题

### 1. 高德坐标偏移 500m

- 原因：用了 WGS-84 坐标而非 GCJ-02
- 解决：用高德 Web 服务 REST API 查，返回即 GCJ-02，直接使用

### 2. `USERKEY_PLAT_NOMATCH`

- 原因：用 JS API Key 调 REST API
- 解决：用 Web 服务 Key (`2ff1bf71b26aed0a92eb4ab63657bb25`)

### 3. 中文引号导致 SyntaxError

- 原因：JS 字符串中 `""` 被解析器误认
- 解决：数据写入 JSON 文件，脚本读取后插入

### 4. Management API INSERT 显示成功但数据不存在

- 原因：SQL 转义失败静默丢弃
- 解决：用 JSON 文件 + 脚本方式

### 5. 首页卡片显示 `?` 地点

- 原因：Supabase 数据无 `stats` 字段
- 解决：查询加 `locations(count), routes(count)`，UI 读 `tour.locations[0].count`

### 6. 路线不显示标记

- 原因：`stops` 中 ID 与 `locations.id` 不匹配
- 解决：确保 stops 格式为 `{id1,id2,id3}`，ID 与 locations 保持一致

### 7. routes 表列名

- `routes` 表用 **`day_label`**（不是 `day`），查询报 `column "day" does not exist` 即此因
- 常用列：`id` / `tour_id` / `day_label` / `title` / `narrative` / `stops`(text[]) / `sort_order`
- `locations` 表：`id`(text) / `tour_id` / `name` / `lat` / `lng` / `elevation` / `importance` / `tags`(text[]) / `layers`(jsonb) / `reflection` / `practical`(jsonb) / `sort_order`

---

## 架构概览

```
用户浏览器 (Vercel SPA)       Supabase                     DeepSeek / 高德
    │                           │                             │
    │ React SPA (Vite)          │ PostgreSQL                  │
    │ ↓                         │ ↓                           │
    │ 浏览导览 ←────────────────→ tours                       │
    │ 创建草稿 (status=processing)─→ tours ─→ 触发器 fire     │
    │                           │     └──→ http_post ────→  Edge Function
    │                           │               │               │
    │                           │               ├─ 提取地点 ──→ DeepSeek
    │                           │               ├─ 查坐标 ────→ 高德 Web API
    │                           │               ├─ 生成内容 ──→ DeepSeek
    │                           │               └─ 规划路线 ──→ DeepSeek
    │                           │                         │
    │ 轮询检测 ←─────────────── locations/routes ←────── 写入
    │ 加载数据 → 审核编辑 ←────→ 更新数据                  │
```

> **注意**：Edge Function 由数据库触发器**服务器端**调用，浏览器不参与。浏览器仅轮询 Supabase 检测数据写入完成。

| 层   | 技术                                  | 用途                             |
| ---- | ------------------------------------- | -------------------------------- |
| 前端 | React 19 + Vite + Tailwind CSS 4      | SPA, 移动端适配                  |
| 部署 | Vercel                                | 自动 CI/CD                       |
| 地图 | 高德 JS API v2.0 (GCJ-02)             | 地图显示、标记、路线连线         |
| 坐标 | 高德 Web 服务 REST API                | 地点精确坐标查询                 |
| 后端 | Supabase (PostgreSQL + Auth)          | 数据存储、用户认证               |
| AI   | DeepSeek API + Supabase Edge Function | 自动分析文本、生成内容、规划路线 |

### Edge Function 模块

`supabase/functions/process-tour/index.ts` 负责流程编排，具体职责已拆分到独立模块：

- `config.ts`：环境变量和请求配置。
- `http.ts`：响应、CORS 和 Supabase 写入。
- `ai.ts`：DeepSeek 请求、重试和并发控制。
- `gaode-search.ts`：高德文本搜索和地区景点查询。
- `gaode-scan.ts`：名称清洗和周边景点扫描。
- `gaode-validation.ts`：逆地理编码校验。
- `geo.ts`：坐标距离计算。
- `anchors.ts`：景点锚点、子景点和景区归属。
- `routes.ts`：确定性路线规划。

---

## 调试经验

### 浏览器 `ERR_INTERNET_DISCONNECTED` 排查

此错误在开发过程中反复出现（20+ 次），最终确认是多个因素叠加：

| 根因                                         | 表现                               | 修复                                                         |
| -------------------------------------------- | ---------------------------------- | ------------------------------------------------------------ |
| PWA workbox 拦截 Supabase API 请求           | `workbox: no-response`             | 移除 PWA 插件                                                |
| `await` 长 POST（1-3 min）耗尽 Chrome 连接池 | POST 完成后所有 GET 失败           | 改用数据库触发器（浏览器零长连接）                           |
| 轮询用 anon key，RLS 拦截非公开导览          | 数据存在但查询返回 `[]`            | 用 Supabase 客户端（带用户 JWT）                             |
| 审核页嵌入 join 查询比简单轮询查询更易失败   | 轮询成功但审核页加载失败           | `onCheckDone` 预加载数据再跳转                               |
| 删除 `vercel.json` 时误删 SPA rewrite        | `<a href>` 全页加载返回 Vercel 404 | 保留 `"rewrites": [{"source": "/(.*)", "destination": "/"}]` |

### 核心教训

1. **3 次失败 → 必须查官方文档**，不能凭记忆猜测 API 签名或配置格式
2. **浏览器不适合做服务器端编排**，长连接/并发请求交给数据库触发器
3. **RLS 权限永远优先排查**，数据查询返回空大概率是权限问题
4. **删除文件前理解每一行**，看似冗余的配置可能是关键（如 vercel.json rewrite）
5. **状态跳转前完成数据加载**，不让用户看到空白错误页
6. **隔离变量逐层排除**：先去掉 PWA → 换 fetch 方式 → 查 RLS → 改连接模式

---

## 限制

1. **坐标查询需逐一进行**：高德 Web API 不支持批量查询
2. **旧版静态 HTML 仍可用**：`~/lib/tour-guide/` 下 build.sh 独立运行，与 App 无关
3. **图片功能暂不做**（2026-08 评估后搁置）。实测高德照片 API 部分可用：
   - `place/text` + `extensions=all` 正常返回 `pois[].photos[]`，大部分地点有 2-3 张
   - **只有 `store.is.autonavi.com/showpic/xxx` URL 能加载**（HTTP 200 / JPEG，低清 ~500px）；`aos-comment.amap.com` 用户评论图 URL 全部 404 不可用
   - 覆盖不全：部分地点（如三清宫、忠烈祠）返回 0 张
   - 若日后重启：Edge Function 查图 → 只保留 `store.is.autonavi.com` 的 URL → 存 `image` 字段；无图地点留空
   - 备选：手动上传（`image` 字段 + 上传入口，图质可控但全人工）
4. **PWA 当前已移除**：workbox 拦截 API 请求，待修复后重新启用
