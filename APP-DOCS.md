# 文学巡礼 App — 开发文档

## 关键密钥

操作前先确认以下密钥可用：

| 密钥 | 值 | 用途 |
|------|------|------|
| 高德 Web 服务 Key | `2ff1bf71b26aed0a92eb4ab63657bb25` | REST API 坐标查询 ⭐ |
| 高德 JS API Key | `858c05dea3990ef1b900bfd298ebefa7` | 前端地图显示 |
| 高德 安全码 | `f98c91fa4c7219afe557be4f0786f594` | JS API 安全密钥 |
| Supabase PAT | `你的 Supabase PAT`（见 Supabase Dashboard → Account → Tokens）| Management API 写入数据 |
| Supabase URL | `https://qxunedraoviaonjdanag.supabase.co` | 数据库 |
| Supabase Anon Key | `sb_publishable_Pp21-3ssB3rSxwFnA-WZZw_eUHmF31E` | 前端匿名访问 |

> ⚠️ **JS Key ≠ Web 服务 Key**。用 JS Key 调 REST API 返回 `USERKEY_PLAT_NOMATCH`。查坐标必须用 Web 服务 Key。

---

## 新增导览 · 自动化

用户在前端（首页 → 登录 → + 创建导览 → 填信息 → 粘贴源材料 → 点 AI 分析）提交后，系统自动完成处理，30-60 秒后跳到审核页面。无需手动操作。

详细架构和测试方法见 **[docs/AI-AUTO-PROCESSING.md](./docs/AI-AUTO-PROCESSING.md)**。

### 流程图

```
用户点 AI 分析
  → TourEdit 保存草稿到 Supabase
  → 调用 Supabase Edge Function (process-tour)
  → Edge Function 调用 DeepSeek API: 提取地点 → 生成内容 → 规划路线
  → Edge Function 调用高德 API 查坐标
  → 数据写入 Supabase
  → ProcessingPhase 轮询检测到数据 → 自动跳审核页
```

### 手动处理（备选）

如需手动批量导入数据（离线场景），仍可用原有的 JSON + 脚本方式：

- [ ] 构建数据 JSON 文件（格式参考下方「数据写入方法对比」）
- [ ] 运行 `node scripts/insert-tour.mjs scripts/xx-data.json`

---

## 数据写入方法对比

| 方法 | 优点 | 缺点 | 适用场景 |
|------|------|------|------|
| JSON 文件 + `insert-tour.mjs` | **中文天然安全** | 多一步 | **插入含中文的内容数据** ⭐ |
| Management API SQL | 无需连接配置 | 中文需转义 | 简单 SQL（UPDATE / ALTER / DELETE） |
| REST API (anon key) | 直接传 JSON | 受 RLS 限制 | 前端 CRUD |
| REST API (service_role) | 绕过 RLS | 需要 service_role key | 批量写入 |
| psql 直连 | 最快 | DNS / IP 限制 | 生产环境 |

### 黄山 vs 泰山的教训

同为脚本内联 JS 对象，黄山一次成功，泰山踩坑多次：

| | 黄山 | 泰山 |
|------|------|------|
| 结果 | ✅ 一次成功 | ❌ SyntaxError → 3 次重试 |
| 失败原因 | — | 中文弯引号 `"东方三大神殿"` 被 JS 解析器当字符串终止符 |

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

---

## 架构概览

```
用户浏览器 (Vercel SPA)       Supabase                 DeepSeek / 高德
    │                           │                         │
    │ React SPA (Vite)          │ PostgreSQL              │
    │ ↓                         │ ↓                       │
    │ 浏览导览 ←────────────────→ tours                   │
    │ 创建草稿 ─────────────────→ tours (draft)           │
    │     │                     │                         │
    │     └─ 触发 Edge Function ─→ process-tour           │
    │                           │     │                   │
    │                           │     ├─ 提取地点 ──────→ DeepSeek API
    │                           │     ├─ 查坐标 ────────→ 高德 Web API
    │                           │     ├─ 生成内容 ──────→ DeepSeek API
    │                           │     └─ 规划路线 ──────→ DeepSeek API
    │                           │                         │
    │ 轮询检测 ←─────────────── locations/routes ←────── 写入
    │ 审核编辑 ←────────────────→ 更新数据               │
```

| 层 | 技术 | 用途 |
|------|------|------|
| 前端 | React 19 + Vite + Tailwind CSS 4 | SPA, 移动端适配 |
| 部署 | Vercel | 自动 CI/CD |
| 地图 | 高德 JS API v2.0 (GCJ-02) | 地图显示、标记、路线连线 |
| 坐标 | 高德 Web 服务 REST API | 地点精确坐标查询 |
| 后端 | Supabase (PostgreSQL + Auth) | 数据存储、用户认证 |
| AI | DeepSeek API + Supabase Edge Function | 自动分析文本、生成内容、规划路线 |

---

## 限制

1. **ProcessingPhase 轮询偶发 ERR_INTERNET_DISCONNECTED**：当前在排查中，详见 [docs/AI-AUTO-PROCESSING.md](./docs/AI-AUTO-PROCESSING.md)
2. **坐标查询需逐一进行**：高德 Web API 不支持批量查询
3. **旧版静态 HTML 仍可用**：`~/lib/tour-guide/` 下 build.sh 独立运行，与 App 无关
4. **图片不支持**：当前版本无地点实景照片上传功能
5. **PWA 当前已移除**：因 workbox 可能干扰 API 请求，临时移除，待修复后重新启用
