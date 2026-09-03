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
    │                            │              └─ 路线站点/顺序由代码确定，DeepSeek 只写文案
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
| `supabase/functions/process-tour/trail-routes.ts` | 知名山岳步道知识层：补关键步道点、确定站序、提供换乘提示 |
| `supabase/functions/process-tour/route-knowledge.ts` | 目的地路线知识读取层：数据库优先，内置策展数据兜底 |
| `supabase/functions/process-tour/route-graph.ts` | 路线图构建、顺序/跨区/长距离交通校验、AI narrative 衔接提示 |
| `supabase/functions/route-research/research.ts` | 自动路线研究：抓取外部证据并让 AI 抽取结构化路线 |
| `supabase/functions/route-research/index.ts` | 手动研究入口：按目的地/tourId 研究并写入路线知识表 |
| `supabase/route-knowledge.sql` | `destination_route_knowledge` 表与初始策展种子数据 |

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

### tours.status 字段

```sql
ALTER TABLE tours ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft';
```

状态流转：`draft` → `processing`（保存/重新处理时）→ `done`（AI 处理完成）/ `error`（处理失败，可重试）

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
| `GAODE_KEY` | 高德 Web API key（坐标、周边景点） |
| `ROUTE_RESEARCH_SECRET` | `route-research` 手动接口访问密钥 |

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
| v6 | regeo 逆地理编码：高德 API 验证坐标是否在目的地城市 |
| v7 | 路线最近邻排序：按地理距离重排 stops，避免 A→C→B 乱序 |
| v8 | Gaode `city` + `citylimit=true`：限定搜索范围到目的地城市 |
| v9 | 严格 regeo：API 调用失败时跳过地点，不给错误坐标可乘之机 |
| v10 | 修复 `regionMatch` 对"省+市"格式的坐标误杀；`gaode` city 参数只取城市名（"安徽省黄山市"→"黄山"，否则被高德忽略）；直辖市空数组绕过校验；regeo 三态区分；`GAODE_KEY` 环境变量化；错误状态检测与「重新处理」|
| v11 | 坐标质量防线：目的地中心地理编码（`geocode/geo`）+ place 搜索偏置（`location=<中心>&radius=20000`）；`>12km` 距离校验拦截同城不同地；`<150m` haversine 坐标去重；地址式 POI 名称过滤（`省…市` 整串地址当名称的假点）；防幻觉提示词（反幻觉主防线放外部校验层，提示词对空源文本要有著名景点回退，避免过度收紧导致提取骤减）|
| v12 | 路线规划修复：移除固定「2日游/1日游/主题游」模板（按地点规模生成，禁止编造多日行程）；路线 stops 重叠 >70% 视为重复去重；**修复函数开头 `setStatus('processing')` 在导览为 done 时触发 UPDATE 触发器导致并发双重写**；提取提示词排除临时展览/活动 |
| v13 | `regionMatch` 重写：支持裸省名（"江西"）与省份级匹配，城市优先规则防同省不同市误通过；移除固定中心距离校验，改**聚类离群点剔除**（>20km，解决"三清山被编码到上饶市区距真景点 50km"导致 0 地点）；移除地理编码搜索偏置；deepseek JSON 解析失败自动重试；前端审核页区分「AI 无结果」与「加载失败」 |
| v14 | 路线生成：改为**2 条完整闭环路线**（全程徒步线 + 车行索道线），narrative 写完整行程（入口/索道→逐段交通→景点→出口，闭环+耗时）；stop id 约束强化 + 空结果自动重试；路线去重阈值 70%→95%（不同交通类型可共享景点）；postRows 加 `resolution=ignore-duplicates` 防并发 409；前端 TourView 展示路线行程描述 |
| v15 | 提取提示词放宽：**至少 8-12 个地点、宁可多列**（反幻觉主防线放在外层坐标校验 + 聚类剔除，不过度收紧导致提取骤减）；路线去重改为**类型感知**：仅「同交通类型（徒步 vs 车行/索道）且 stops 完全一致」才视为重复，两种路线共享景点也必须都保留；路线空结果时自动重试一次 |
| v66 | 确定性路线站点规划 `planRoutes`：1日=前山核心≤8 / 2日=前山+后山（地区点8km聚类最大簇）/ 主题游=4热核心+每簇统一景点；AI 只写 narrative，强制 stops==allow 组成 100% 确定（修 2日=1日+2点、主题游全塞的旧行为） |
| v67 | 核心锚点优先精确匹配 destName（防「青城山景区前山」污染 coreScenicName）；后山池 ≤25km（西岭雪山 45km 排除） |
| v68 | 路线按 day_label 匹配防 AI 顺序错位；统一地区景点 ≤30km |
| v69 | `normalizeLayers()` 写库前统一内容层结构（扁平字符串→`{text:...}`，scenes 保持）；前端 `ContentCard` 兼容两种格式 → 修「部分地点 4 层内容显示为空」 |
| v70 | 系统性大修（详见 `docs/AI-PIPELINE-REVIEW.md`，含 dry-run A/B 实测）：**P0** `regionMatch` 支持 district 县级市/区县（"河南登封"全拒→status=error 实锤修复）；DeepSeek 全类型错误退避重试（429/5xx/超时不再一次崩全链路）+ 单路超时 120s→60s；内容 chunk 8→5 + 截断自动拆半 + 单点补生成（不再一个 chunk 炸全链路）；失败原因/质量报告落库 `tours.process_error`/`process_report`（前端失败页显示真实原因）；**P1** 早退路径置 error + 前端 4 分钟总超时（防无限死等）；内容 id 按名兜底 + 完整性补生成；锚点收严（"青城山索道/中国嵩山卢崖瀑布"不再当锚点，修 1日只剩 1 站）；地区合并剔目的地别名 + 负向过滤商业游乐（方特/海洋馆，不误杀都江堰/古镇）；AI 提议点设施过滤（饭庄/公交站）；离群剔除簇感知恢复（天门山不再被误杀）；高德限流退避 2→4 次 + 县级 city 无结果去 city 兜底（中岳庙/法王寺/天子山召回）；提取下限 ≥3；**P2** mainPool 逐点距离过滤；提取/路线 temperature 0.7→0.2；源文本上限 6000→12000 字 |
| v70.1 | `planRoutes` 距离阈值放宽：后山池 25→35km、主题游统一景点 30→40km —— 修天门山↔武陵源 32km 双景区被挤出路线（主题游整条消失） |
| v70.2 | 卫星景区锚点规则：`isScenicAnchor` 识别"目的地+方位后缀"命名（青城后山/黄山北坡直接成锚点）→ 修青城山 2 日 day-2 偏都江堰簇；路线 `stops` 保序去重 → 修天门山 1 日首末站重复 |
| v70.3 | 文学巡礼线 resolve 为空时回退核心池 top4（防小说源静默丢线）；`FACILITY_RE` 增补 招商中心/营销中心/售楼处；`cleanName` 剥"（暂停开放）"类状态后缀 |
| v70.4 | 文学巡礼线 dedup 豁免：route 标记 `_free`（自由选点），stops-set 去重跳过 → 修黄山文学巡礼线与 1 日线同站点集合被误删（routes 3→4）；`process_report` 埋点 `plans`/`corePool`/`📖 resolve N 站` warning 辅助诊断 |
| 2026-09-03 | 新增知名山岳策展步道层：先按已知步道补关键点，再按真实动线固定站序；AI 只负责 narrative 和换乘描述，不能改站点集合/顺序 |
| 2026-09-03 v78 | 新增 `destination_route_knowledge` 结构化路线知识层：`zones/trails/edges` 存数据库，`process-tour` 启动时按目的地别名加载；命中高置信数据时用数据库路线，未命中回退内置 `CURATED_TRAILS`。处理报告记录 `routeKnowledge.source/confidence/destination`。这是后续自动搜索和 route-research 写入的落库地基。 |
| 2026-09-03 v79 | 新增自动路线研究：山岳目的地缺少数据库知识时，先抓取 Wikipedia/OSM/高德证据，再抽取 `zones/trails/edges` 并以 `auto-research` 写入。自动研究置信度上限 0.80，不会覆盖人工策展的 0.90+ 数据；研究失败仍回退内置数据。 |
| 2026-09-03 v80 | 新增路线图校验：`trails` 连续站点生成默认徒步边，显式 `edges` 可表达索道/观光车/专车。写库前检查步道顺序回退、跨徒步区交错、>8km 长距离位移是否缺少非徒步衔接；结果写入 `process_report.routeGraph`，并给路线 narrative 提供交通衔接提示。 |

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
| `ERR_INTERNET_DISCONNECTED` 轮询失败 | Chrome DevTools Network 面板打开时连接挂起，占满连接池 | 关闭 DevTools；加 AbortController 10s 超时 |
| 数据写入但查询返回空 | RLS 策略：anon key 查不到非公开导览 | 轮询用 Supabase 客户端（带用户 JWT） |
| 审核页显示空数据 | 复杂 join 查询比简单轮询更易失败 | `onCheckDone` 预加载 + 5 次重试 |
| 保存后跳转 404 | `vercel.json` 被删，SPA rewrite 丢失 | 保留 `"rewrites": [{"source": "/(.*)", "destination": "/"}]` |
| Edge Function 409 主键冲突 | ID 全局唯一约束，DeepSeek 生成重复 slug | v3：ID 加 tourId 前缀做命名空间 |
| 坐标错到其他省份 | Gaode `city` 参数传了"省+市"（`安徽省黄山市`），被高德静默忽略 → 全国同名点乱入 | v10：city 参数只取城市名（`黄山`） |
| 所有地点被「不在目的地」跳过 | `regionMatch` 无法处理"省+市"格式：`kw="安徽省黄山"` 对 `geo.city="黄山市"` 永不匹配 | v10：拆分省/市分别匹配 |
| 直辖市坐标校验被绕过 | regeo 对直辖市返回 `city=[]`（truthy 空数组），`kw.includes([])` 恒为 true | v10：空数组回退到 province |
| AI 处理失败后无限等待 | 轮询只看 `locations` 表，看不到 `status='error'` | v10：轮询 `tours.status`，error 时显示重试 |
| 重新处理已有导览不生效 | 触发器只监听 INSERT，UPDATE 不触发 | v10：新增 UPDATE 触发器（仅转入 processing 时触发） |
| 同城同名不同地（江夏"龟山" vs 汉阳"龟山"） | 城市级 regeo 校验放行同城任意坐标，错误点距目的地 45km | v11：目的地中心地理编码 + 搜索偏置 + >15km 距离拦截 |
| 重复地点（3×"龟山风景区"重叠标记） | DeepSeek 提取近义地名解析到同一 POI，未去重 | v11：haversine <150m 坐标去重，保留重要性更高者 |
| 路线顺序混乱（A→C→B→D） | DeepSeek 输出无序，从中间点出发 | v7：最近邻排序，从最远点出发 |
| 地点数与响应不一致 / 数据混乱 | 函数开头 `setStatus('processing')` 在导览为 done 时触发 UPDATE 触发器 → 并发两次运行 | v12：删除该行 setStatus（导览已由触发器置为 processing） |

## 错误排查清单

1. **Chrome DevTools**：**关闭 Network 面板**后测试。开着 DevTools 会导致连接挂起 → `ERR_INTERNET_DISCONNECTED`
2. **函数日志**：`https://supabase.com/dashboard/project/qxunedraoviaonjdanag/functions/process-tour/logs`
3. **数据确认**：用 service_role key 查询 `locations`/`routes` 表
4. **触发器状态**：`SELECT * FROM pg_trigger WHERE tgname = 'ai_process_trigger';`
5. **RLS 策略**：`SELECT * FROM pg_policies WHERE tablename IN ('locations', 'routes');`
6. **浏览器扩展**：`chrome://extensions/` 禁用所有扩展后测试
7. **SPA 路由**：确认 `vercel.json` 存在且含 `rewrites` 配置

## 路线知识层

`destination_route_knowledge` 是为“真实路线证据 → 结构化模型 → 确定性规划”准备的表。当前 `model` 至少包含：

```json
{
  "zones": [
    { "id": "taishi", "name": "太室山", "aliases": ["太室山", "嵩山"] }
  ],
  "trails": [
    {
      "id": "songshan-taishi",
      "zoneId": "taishi",
      "aliases": ["嵩山", "太室山"],
      "scenicName": "太室山",
      "stops": [{ "name": "嵩阳书院" }, { "name": "峻极峰" }],
      "notes": "太室山经典线。"
    }
  ],
  "edges": [
    { "from": "嵩阳书院", "to": "老母洞", "mode": "walk" }
  ]
}
```

- `zones` 表示一个目的地内的独立徒步/游览区，如嵩山的太室山和少室山。
- `trails` 保留当前已验证的站点顺序，供补点、分区和排序使用。
- `edges` 是后续路线图化改造的关键，用来表达步行、索道、观光车、专车等真实交通关系。
- `source` 与 `confidence` 用来区分官方资料、人工策展、自动研究或低置信回退。

部署/更新：

```bash
supabase db query --linked --project-ref qxunedraoviaonjdanag --file supabase/route-knowledge.sql
```

### 自动路线研究（route-research）

`process-tour` 处理山岳目的地时的顺序是：

1. 读取 `destination_route_knowledge`；
2. 命中数据库知识 → 直接使用；
3. 未命中且 `destination.type === "mountain"` → 抓取 Wikipedia、OpenStreetMap、高德周边 POI；
4. DeepSeek 只做结构化抽取，输出 `zones/trails/edges/evidence`；若 `note` 明确写“索道/观光车/专车”，会确定性纠偏 `mode`；
5. 结果以 `source="auto-research"`、`confidence <= 0.80` 写入路线知识表，供本次和后续处理复用；
6. 抽取失败时回退 `CURATED_TRAILS`，处理不中断。

也可以手动预热某个目的地：

```bash
supabase secrets set ROUTE_RESEARCH_SECRET=<random-secret> \
  --project-ref qxunedraoviaonjdanag

curl -X POST 'https://qxunedraoviaonjdanag.supabase.co/functions/v1/route-research' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <random-secret>' \
  -d '{"destination":"北岳恒山","region":"山西省大同市"}'
```

返回示例：

```json
{
  "success": true,
  "destination": "北岳恒山",
  "confidence": 0.75,
  "trails": 1,
  "stops": 4,
  "evidence": [
    { "provider": "wikipedia", "title": "恒山" },
    { "provider": "openstreetmap", "title": "12km POI" },
    { "provider": "amap", "title": "周边景点" }
  ]
}
```

自动研究当前定位是“低置信兜底 + 新目的地冷启动”，不是人工策展的替代。来源证据不足时，抽取的路线可能偏短；人工策展数据仍会优先。
接口也会在写入前检查同名现有知识：`curated` 或更高置信记录会直接跳过，返回 `skipped=true`。

### 路线图校验

`route-graph.ts` 会把路线知识转成可校验的图：

- 每条 `trail` 的连续站点生成默认 `walk` 边；
- 每条显式 `edge` 覆盖默认交通方式，可写 `walk/cableway/shuttle/car/other`；
- 反向查询也会建边，方便校验倒序或下山动线；
- `trail` 顺序仍保留方向语义，用于检测顺序回退。

写库前会检查三类结构问题：

1. **步道顺序回退**：同一条已知步道的站点出现 A→C→B；
2. **跨徒步区交错**：北线→南线→北线这类乱跳；
3. **长距离徒步误判**：相邻点相距超过 8km，但没有索道、观光车、专车等非徒步衔接。

主题游允许长距离接驳，因为它本来就会串联核心景区和 60km 内的独立景点。校验结果不会中断生成，但会写入 `process_report.routeGraph` 和 `warnings`，便于发现数据源质量问题。

### 路线图分段规划（v81）

路线组成仍由 `planRoutes` 决定；`route-graph.ts` 只负责在每条路线内部排序和描述交通衔接。当前顺序是：

1. `routeGraphSegments`：把站点归到完整徒步区段，段内按已知 trail 顺序推进；未匹配近点归入 5km 内区段，远点保留在末尾等待接驳；
2. `planGraphStops`：展开所有区段，形成“太室山整段 → 少室山整段”这类稳定站序；
3. `buildRouteLegs`：为相邻站生成交通 leg。显式 `edges` 优先；没有资料时，>60km 推断为专车/出租车，>8km 推断为观光车/摆渡车，其余默认徒步；
4. `routeLegsText`：把 legs 转成给 AI 的固定衔接约束，写进路线 prompt。AI 只负责叙述这些衔接，不能自行发明站点顺序或交通方式。

这层不做路线组成决策，也不改变站点集合；研究知识不足时仍回退 trail 排序，再回退地理最近邻。
