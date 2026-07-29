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

## 新增导览 · 执行清单

按顺序逐项执行。用户在前端创建草稿后（首页 → 登录 → + 创建导览 → 填信息 → 粘贴源材料 → 点 AI 分析），草稿保存到 `tours` 表，即可开始以下流程。

### ☐ 1. 读取草稿

```javascript
// Management API 读取最新未处理的草稿
const sql = `SELECT id, title, subtitle, source, destination
             FROM tours WHERE NOT EXISTS (
               SELECT 1 FROM locations WHERE locations.tour_id = tours.id
             ) ORDER BY created_at DESC LIMIT 1`;
```

### ☐ 2. 并行搜索

- [ ] **Web Search**：景点列表、海拔、文学/历史典故、民间传说、民俗文化
- [ ] **高德 Web API 查坐标**（逐个地点）：

```javascript
// 返回 GCJ-02 坐标，直接用，无需转换
const KEY = '2ff1bf71b26aed0a92eb4ab63657bb25';
const url = `https://restapi.amap.com/v3/place/text?keywords=${encodeURIComponent('目的地+地点名')}&key=${KEY}&city=城市&types=风景名胜|旅游景点`;
const data = await fetch(url).then(r => r.json());
const [lng, lat] = data.pois[0].location.split(',').map(Number);
```

- [ ] 查不到的坐标：去掉 `city` 参数或换关键词重试

### ☐ 3. 生成内容

- [ ] **更新 `tours` 表**：title、subtitle、theme、source（含 synopsis）、destination（含 bounds）、is_public = true

- [ ] **插入 `content_layers`**：4 层，层主题对齐目的地：

| 层 | 文学山岳示例 | 历史遗迹示例 |
|------|------|------|
| 第1层 | 文学意境 📖 | 历史现场 🏛 |
| 第2层 | 历史掌故 🏛 | 帝王足迹 👑 |
| 第3层 | 民间传说 🐉 | 民间传说 🐉 |
| 第4层 | 地域文化 🎭 | 考古发现 ⛏ |

- [ ] **构建 `locs` 数组**：每层 150-250 字，具体细节 + 故事性（非百科词条），附 reflection 和 practical：

```javascript
{
  id: "string-id", name: "地点名", lat: 36.25, lng: 117.11,
  elevation: "1545m", importance: 5,  // 1-5
  tags: ["标签1", "标签2"],
  layers: {
    novel: { text: "第一层内容..." },
    history: { text: "第二层内容..." },
    folklore: { text: "第三层内容..." },
    customs: { text: "第四层内容..." },
  },
  reflection: "引导读者思考的问题",
  practical: { access: "到达方式", difficulty: "难度", tip: "贴士" },
}
```

- [ ] **构建 `routes` 数组**：2-3 条路线，stops 用的是 location.id
  - 路线 1：完整路线（主要地点，2日）
  - 路线 2：精简路线（核心地点，1日）
  - 路线 3：主题路线（日出 / 亲子 / 文化）

### ☐ 4. 写入 Supabase

> ⚠️ **必须用 JSON 文件 + `insert-tour.mjs` 脚本**。禁止内联 JS 或 Management API SQL 直插中文。原因见下文「黄山 vs 泰山的教训」。

- [ ] 数据写入 JSON 文件：
  ```javascript
  const fs = require('fs');
  fs.writeFileSync('scripts/xx-data.json', JSON.stringify({ TOUR: 'uuid', locs, routes }, null, 2));
  ```
- [ ] 运行 `node scripts/insert-tour.mjs scripts/xx-data.json`
- [ ] 确认输出：「地点: N, 路线: M」

### ☐ 5. 验证

- [ ] 打开 `http://localhost:5173/tour/{TOUR_ID}`
- [ ] 地图标记位置正确（与高德地图一致）
- [ ] 点击路线 → 自动定位 + 显示第一个地点内容
- [ ] 四层 Tab 可切换
- [ ] 首页卡片显示正确的地点数 / 路线数

```javascript
// 快速校验
const locs = await fetch(`${URL}/rest/v1/locations?tour_id=eq.${TOUR}`, {headers:{apikey:ANON_KEY}}).then(r=>r.json());
const routes = await fetch(`${URL}/rest/v1/routes?tour_id=eq.${TOUR}`, {headers:{apikey:ANON_KEY}}).then(r=>r.json());
console.log(`地点: ${locs.length}, 路线: ${routes.length}`);
```

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
用户浏览器                    Supabase                     Claude (AI)
    │                           │                            │
    │ React SPA (Vite)          │ PostgreSQL                  │
    │ ↓                         │ ↓                           │
    │ 浏览导览 ←────────────────→ tours                      │
    │ 创建草稿 ─────────────────→ tours (draft)               │
    │ 显示处理中                 │ ← 读取草稿 ←────────────── │
    │                           │    分析生成 →               │
    │                           │    高德查坐标 →             │
    │ 自动刷新 ←─────────────── locations/routes ←────────── │
    │ 审核编辑 ←────────────────→ 更新数据                    │
```

| 层 | 技术 | 用途 |
|------|------|------|
| 前端 | React 19 + Vite + Tailwind CSS 4 | SPA, 移动端适配 |
| 地图 | 高德 JS API v2.0 (GCJ-02) | 地图显示、标记、路线连线 |
| 坐标 | 高德 Web 服务 REST API | 地点精确坐标查询 |
| 后端 | Supabase (PostgreSQL + Auth) | 数据存储、用户认证 |
| AI | Claude (对话中处理) | 分析文本、生成内容、规划路线 |

---

## 限制

1. **AI 处理非自动**：依赖 Claude 在对话中手动处理，未搭建 Edge Function 自动化链路
2. **坐标查询需逐一进行**：高德 Web API 不支持批量查询
3. **Management API 有速率限制**：大量请求建议间隔 100ms
4. **旧版静态 HTML 仍可用**：`~/lib/tour-guide/` 下 build.sh 独立运行，与 App 无关
5. **图片不支持**：当前版本无地点实景照片上传功能
