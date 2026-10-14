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
| 2026-09-03 v82 | 路线图交通分段落库：显式 `edges` 强制覆盖同向默认徒步边；`buildRouteLegs` 为每条路线生成结构化 `legs` 并写入 `routes.legs`；详情页和 AI 使用同一份交通分段。新增每日容量校验，按资料时长或保守默认速度累计移动/停留时间，超过日数 × 10 小时时写入 `long-day` 告警。 |
| 2026-09-03 v83 | 新增创作者路线确认：AI 生成后仍可直接发布，确认不阻断展示。创作者确认单条路线后，系统把站点顺序、`legs`、`zones/trails/edges` 快照存入 `route_confirmations`。加载路线知识时优先级为官方/精选 0.90+ > 创作者确认 0.85 > 自动研究 0.80 > 内置兜底。 |
| 2026-09-03 v84 | 冷启动验证后的通用修复：交通设施节点派生短别名；地点与路线图节点一对一分配；同区未匹配点按最小绕行插回步道骨架；离群接驳点保留在步道段后；自动研究恢复外部 POI 坐标；地区景点不再拼入无第二景区的两日山岳线。 |
| 2026-09-04 v85 | 新增地名语义清洗层：同一地标的不同官方写法合并，目的地伞形名标记为 `景区泛指` 且不进入徒步路线；店铺、道路名在地区合并和路线组成层过滤；路线补全不再把语义相邻但性质不同的 POI（如“金顶帐篷”）当成同一站点；单条已知步道也可接管核心景区池。 |
| 2026-10-13 v86a | 路线海拔剖面：`elevation.ts` 沿站点插值采样 OpenTopoData 写入 `routes.prof`；`destination.ts` 从标题解析真实景区核心名；地理编码优先行政区（提交 `2cecd30`/`22d3d28`/`ca2b0f1`） |
| 2026-10-13 v87 | 地图海拔联动叠加层：`ElevationProfile` 与路线进度圆点联动；`planRoutes` 按知识层 `zones` 拆分路线池；索道显式边同时覆盖正反向，修「索道上、徒步下」 |
| 2026-10-14 v88 | 路线质量收口（详见下文「路线质量收口（v88-v89）」）：交通方式改由直线距离**分层 + 高差**决定且资料显式边保持权威；车程按绕行系数与山区均速估算；`routeGraphIssues` 不再在无知识目的地整体短路、主题游不再整体豁免长距离检查、整体反向视为合法下撤；新增 `poi-filter.ts` 统一五路入口的非游览点判据与总闸；`process_report` 首次接入审核页（`ProcessReport`/`RouteIssueList`）；新增 `scripts/audit-routes.ts` 路线质量体检与回归基线 |
| 2026-10-14 v89 | 路线知识能力分层：`knowledge-tier.ts` 把知识来源映射成能力授权（L1/L2/L3），未核实知识不再支撑 2日全景游、主题游与分区选点；`planRoutes` 通过 `capabilities` + `onSuppressed` 降级产出并把原因写进 `report.suppressedPlans`；审核页说明分级与解锁方式。实测现网 34 条路线有 13 条（38%）本就不该自动生成 |
| 2026-10-14 v90 | 重复路线检测与存量重跑：`route-dedup.ts` 用 Jaccard ≥0.9 判重（不能用包含率，2日线按构造完全包含 1日线）；自由选点撞站改为上报不删除；`scripts/reprocess-tours.ts` 带 dry-run/备份/--confirm 范围复核/串行四道安全闸；`research-knowledge.ts` 离线复现真实知识（只读、不写库），实测暴露证据噪声、厕所被当景点注入、设施节点派生别名冒充游览点三类缺陷并修复 |
| 2026-10-14 v91 | 可信度改为可解释评分：`knowledge-quality.ts` 按来源权威度/坐标覆盖/证据可追溯/设施噪声/结构打分；交通断言要求显式边覆盖 ≥0.6 的相邻站点对；知识选路先分级再完整度；体检增加知识绑定率指标（玉龙雪山实测 21 站仅 2 站可绑定到知识节点） |

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

写库前会检查四类结构问题：

1. **步道顺序回退**：同一条已知步道的站点出现 A→C→B；
2. **跨徒步区交错**：北线→南线→北线这类乱跳；
3. **长距离徒步误判**：相邻点相距超过 8km，但没有索道、观光车、专车等非徒步衔接；
4. **每日容量超载**：按资料时长或保守默认速度累计移动时间，加上每站约 20 分钟停留估算；超过 `日数 × 10 小时` 时写 `long-day` 告警。

主题游允许长距离接驳，因为它本来就会串联核心景区和 60km 内的独立景点。校验结果不会中断生成，但会写入 `process_report.routeGraph` 和 `warnings`，便于发现数据源质量问题。

### 路线图分段规划（v81）

路线组成仍由 `planRoutes` 决定；`route-graph.ts` 只负责在每条路线内部排序和描述交通衔接。当前顺序是：

1. `routeGraphSegments`：把站点归到完整徒步区段，段内按已知 trail 顺序推进；未匹配近点归入 5km 内区段，远点保留在末尾等待接驳；
2. `planGraphStops`：展开所有区段，形成“太室山整段 → 少室山整段”这类稳定站序；
3. `buildRouteLegs`：为相邻站生成交通 leg。显式 `edges` 优先；没有资料时，>60km 推断为专车/出租车，>8km 推断为观光车/摆渡车，其余默认徒步；
4. `routeLegsText`：把 legs 转成给 AI 的固定衔接约束，写进路线 prompt。AI 只负责叙述这些衔接，不能自行发明站点顺序或交通方式；
5. 处理完成后把每条路线自己的 `legs` 写入 `routes.legs`，详情页读取同一份数据展示交通分段。

这层不做路线组成决策，也不改变站点集合；研究知识不足时仍回退 trail 排序，再回退地理最近邻。

### 创作者路线确认（v83）

这不是发布审核。AI 处理完成后，导览可以继续直接预览和发布；路线校验只写入警告。

导览详情页只给导览作者显示“这条路线正确吗？”入口。确认对象是当前选中的单条路线；确认后会保存一条 `route_confirmations` 历史：

- `destination_name/destination_aliases`：目的地与常用别名；
- `stops/route_fingerprint`：确认时的站点顺序和指纹；
- `legs`：结构化交通分段；
- `route_model`：确认时的 `zones/trails/edges` 快照；
- `user_id/created_at`：确认人和时间。

站点指纹用于防止旧确认被自动套用到已修改路线。只要站点顺序改变，旧确认仍保留为历史，但当前路线需要重新确认。

`process-tour` 会把确认记录合并进目的地路线知识候选集。同目的地同置信度下的顺序是：官方/精选 > 创作者确认 > 自动研究 > 内置兜底。这样普通自动研究结果不会覆盖用户确认过的路线；官方/精选数据仍然优先。

### 冷启动验证记录（v84）

以当时无 `destination_route_knowledge`、无 `route_confirmations` 记录的“武功山”做端到端验证：

1. 首次处理成功走 `auto-research`，置信度 0.75，并自动沉淀武功山路线知识。
2. 验证暴露出三类通用问题：交通设施名变体导致 `edges` 失配；多个地点抢占同一个路线图节点；地区景点被拼成两日山岳线。
3. 修复后复测：路线研究、地点坐标校验、路线生成、`legs` 落库、路线图校验全链路成功；最终复测 `routeGraph.issues=0`，索道和主题游接驳能进入结构化交通分段。
4. 结论：冷启动链路可用。自动研究仍受 0.80 置信度约束；路线事实应继续沉淀到数据库和创作者确认，而不是给某个山岳写特例规则。

### 地名语义清洗（v85）

地点来源现在统一经过 `semanticDedupLocations`：

1. `landmarkKey` 先剥离目的地前缀、城市前缀和“风景名胜区/景区/公园”等通用后缀，只比较真实地标词；
2. 剥离后为空的名字是目的地伞形名（如“武功山”“萍乡武功山国家级风景名胜区”），会标为 `景区泛指`，可以留在地图背景，但不会进入 1日/2日/主题游站点；
3. 同一 `landmarkKey` 的地点按重要性和来源评分合并，路线补全点的优先级低于高德/AI 坐标点；
4. 自动研究的证据坐标必须通过语义键精确匹配，禁止“武功山金顶帐篷”这类相邻 POI 冒充“金顶”；
5. 地区合并层同时过滤商业设施（大米/特产/便利店等）和普通道路名（路/街/大道/巷等）；
6. `getPrimaryTrailScenicName` 在只有一条已知步道时也返回该步道的景区名，避免伞形锚点抢占核心池。

武功山 v85 复测显示：金顶不再重复；“武功山”“明月山大米”“白鹤峰路”不再进入路线；`coreScenicName` 回到真实步道景区池；自动研究虽仍记录帐篷营地证据，但不再把该坐标绑定到金顶。主题游会产生 10.1 小时容量告警，这是长距离接驳的预期提示；不使用发布前人工审核。

### 路线海拔剖面（v86a，摘要）

> 本节按提交 `2cecd30`/`7b85d4a` 与 `supabase/route-enrichment.sql` 补记，此前文档缺失。

生成路线后沿站点折线插值采样 OpenTopoData（`etopo1`，单次 ≤100 点），结果写入 `routes.prof`
（`[[km, m], ...]`）。采样失败静默返回空数组，不阻断导览生成。前端 `ElevationProfile` 渲染剖面与累计爬升。

### 地图海拔联动叠加层（v87，摘要）

> 按提交 `73a1ff5` 补记，此前文档缺失。

选中路线时地图上的进度圆点沿折线随剖面联动播放；`routes.ts` 按知识层 `zones` 拆分路线池，
并修正索道边的反向覆盖，避免「索道上、徒步下」的错误叙述。

---

## 路线质量收口（v88-v89）

本轮不改架构，只把「直线距离 → 交通方式」这条错误映射、以及诊断结果的出口链路修通。
起因是一份跨模型诊断结论的复核：现网 12 条公开导览里，海拔剖面只有 1 条有数据、
交通分段只有 2 条有数据，而系统早已能诊断出缺陷却从未交给能修它的人。

### 1. 交通方式不再由平面距离直接决定（P1-3）

线上事故：丽江玉龙雪山主题游的公开文案写着
「乘观光车/摆渡车，**直线约 37 公里**，前往香格里拉虎跳峡」（拉市海→虎跳峡直线 36.7km，
实际约 2.3 小时车程且跨地级市）。旧 `buildRouteLegs` 只有两条阈值：`>3km → shuttle`、
`>60km → car`，任何 3-60km 的位移都会被写成「景区观光车」，再经
`routeLegsText → prompt（narrative 必须按此执行）` 复述给游客。

现在：

| 项 | 规则 |
| --- | --- |
| 直线距离分层 | `≤3km` 徒步 / `≤12km` 景区观光车 / `>12km` 专车（`inferTransferMode`） |
| 高差 | 相邻站高差 `≥300m` 且距离 `>3km` 时至少升为观光车，并在衔接说明里写明「须借助索道或景区交通下撤，禁止写成连续徒步」。**高差不升级为 car**：山地大落差通常是索道而非公路 |
| 资料权威性 | 人工/研究**显式边**保持原方式，只有资料主张 `walk` 且物理量明显越界（`>8km` 或大落差）才纠正；`buildRouteGraph` 为 trail 相邻站生成的**默认 walk 边**视为"资料未给方式"，按距离/高差校正 |
| 车程估算 | 机动车段按绕行系数（shuttle 1.6 / car 1.9）折成山路里程，再按山区均速 30km/h 计分钟数，替代旧「直线 55km/h」的隐含假设 |
| prompt 约束 | `>12km` 的段在交通衔接里显式带上「禁止描述为景区观光车短驳或索道直达」 |

海拔文本解析新增护栏：`locations.elevation` 是 AI 自由文本，`"4506-4680米"` 曾被解析成
**-4680**，与 2900 米相减得到荒谬的 7580m 高差。现在取第一个 0-9000 的合理数字，
并要求字符串含单位或为纯数字；高差绝对值 >3000m 整段作废，不用于任何判定。

### 2. 校验器对新目的地真正生效（P1-3）

`routeGraphIssues` 原先在 `knowledge.trails` 为空时**整体短路返回 `[]`**。
而新导览必然没有知识：实测 12 个公开目的地有 10 个走的就是这条短路，
等于所有新导览从未被校验过。现在只有依赖知识的「步道顺序回退 / 跨区交错」两项自然不产出，
交通衔接与每日容量两项物理量校验始终执行。

同时修正两处检查语义：

- **主题游不再整体豁免长距离检查**。旧实现 `allowLongTransfers` 等于跳过全部距离校验，
  正是 37km 观光车文案被静默放行的原因。现在允许长距离串联，但标注方式必须正确。
- **`trail-backtrack` 承认整体反向是合法下撤**。同一批站点既可能上山走也可能下山走，
  只有既非递增也非递减的序列才算折返乱序（恒山 1日线实测索引 `8,10,5,4,3,1,2,11,12,13`
  是真乱序：下山到山脚三清殿后又折回半山三元宫，仍必须告警）。

现网体检结果：同一份数据下问题数由 **2 → 22**，自动捕获了此前需要用户投诉才能发现的
全部案例（泰山日观峰→岱庙 7.1km/1386m 的假阴性、黄山 2日线混入呈坎 28km、
天门山 2日线跨景区 33km、武功山与黄山主题游超容量）。

### 3. 非游览点统一总闸（P1-4）

地点有五个入口（AI 提取 / AI 核心补全 / AI 地区提议 / 高德地区知名景点 / 锚点子景点扫描），
过滤规则原先只在首层提取生效，「高德地区知名景点」那一路完全没有过滤。
现网因此入库并被排进路线的有：

- 武当山：`玄岳门(公交站)`
- 泰山：`两期岩体穿插关系`（地质描述条目）
- 丽江：`凌雪草坪(礼成旅行婚礼)`

新增 `poi-filter.ts`，把判据收敛为 `isNonSitePOI` 并在五路汇合处设总闸，
**但豁免策展步道上已确认的站点**（已验证知识优先于启发式）。
本模块刻意不使用 `FACILITY_RE`：该规则含 `栈道$|观景台$|索道站$|广场$`，
用于子景点扫描合适，用在路线站点上会误杀「金龙峡栈道」「天门洞前广场」。

实测精度：对 12 个公开导览的 181 个地点全量扫描，**只剔除上述 3 个脏数据，
其余 178 个（含 5 种栈道命名、索道站、打卡点）全部保留**。

### 4. 质量报告进入审核页（P1-1）

`process_report` 此前在前端**零引用**：`ProcessingPhase` 只读 `process_error`，
审核页 `TourEditReview` 完全不显示报告，因此只有手动查库的开发者能看到诊断结果。
这就是「每新增一条导览都要迭代一次规划逻辑」的信息流成因：
能修路线的创作者拿不到质量信号。

现在 `useTourData.normalizeTour` 透传 `process_report`，`src/lib/routeReport.js`
按路线标签归组缺陷，新增 `ProcessReport` 面板与 `RouteIssueList` 行内标记：

- 概览指标：地点/路线/坐标剔除/交通问题/预计总时长；
- 知识可信度低于策展阈值时明确提示「尚未经人工核实，请逐条确认衔接」；
- 交通衔接缺陷同时出现在报告总览**和**它所描述的路线卡片内；
- `plans > routes` 报为阻断项（有路线被静默丢弃）。

### 5. 路线质量体检脚本（P1-5）

新增 `scripts/audit-routes.ts`，用真实 Edge Function 模块（非镜像实现）重算线上每条路线的
交通分段、结构问题与容量，并与已落库 `legs` 对比：

```bash
set -a && . ./.env && set +a
deno run --allow-net --allow-read --allow-env scripts/audit-routes.ts
deno run ... --allow-write scripts/audit-routes.ts \
  --json scripts/out/route-audit-baseline.json          # 生成回归基线（写文件需 --allow-write）
deno run ... scripts/audit-routes.ts --all                                  # 含私有导览（需可读权限）
deno run ... scripts/audit-routes.ts --knowledge <导出.json>                 # 复现线上路径
```

只读，全程仅 SELECT。脚本会区分「本次有路线知识可用」与「无知识对照」两类改判，
避免 anon key 读不到 `destination_route_knowledge` 时被误读成质量退化。

### 路线站点资格：景区伞形名不能作为游览站

`planRoutes` 的 1日/2日/主题游池子本来就用 `canRoute` 排除伞形景区名，但**文学巡礼线走
AI 自由选点、`resolveStop` 又是名称双向包含匹配**，绕过了这层过滤：AI 提一句"黄山风景区"
就能命中名为"黄山"的伞形 POI。这类点的坐标是景区质心或行政点，不是游览位置，进路线后
产生假位移：

```
红门宫 → 泰山风景名胜区   7.01km / 高差 1295m
泰山风景名胜区 → 中天门   3.76km
天门山国家森林公园 → 天门山索道   8.83km
```

泰山 1日线的 3 条交通告警里有 2 条、天门山那条误判都是它造成的。

判据抽成 `isRouteStopEligible` / `filterRouteStops`（`routes.ts` 导出，`planRoutes`
内部 `canRoute` 改为复用同一份，避免两套真相），并在**写库前对所有路线统一过闸**。

一刀切会出事：策展步道会刻意用目的地名当入口/换乘点（恒山首站「游客中心」的别名就是
「北岳恒山」），删掉会让路线从山顶开始。所以命中步道站点名或别名时豁免 ——
延续"已验证知识优先于启发式"这条原则。

文学巡礼线还可能选中的全是伞形点导致整条路线为空，因此把回退池抽成
`coreFallbackStops`，让"AI 选点无法 resolve"和"被资格闸清空"两种情况共用，
避免 `routes < plans` 的静默丢线。伞形点仍保留在 `locations` 表里作地图标注，
只是不再作为游览站。

实测精度：对 12 个公开导览重算，**34 条路线中有 21 条含伞形站点**（62% 存量），
新代码不会再产出，但存量需重跑才会清理。

### 路线质量闸门（P1-2）

校验器能诊断问题，但结果只写进 `warnings`，路线照原样入库、`status` 照原样置 `done`。
本轮把它变成真正的闸门。

#### 闸门必须在 AI 写文案之前

修复动作（重排、按容量砍站）放在 `planRoutes` 排序之后、**调用 DeepSeek 生成 narrative 之前**。
如果放在写库前砍站，`narrative` 里"全程依次经过 X、Y、Z"会与被砍掉的站点数组不一致 ——
那种文本缺陷比路线缺陷更难发现，而且直接显示在详情页上。

`repairPlanStops()`（`route-graph.ts`）只重排或砍站，绝不新增站点：

| 问题 | 修复方式 |
|---|---|
| 步道顺序回退 / 跨区交错 | 用 `planGraphStops` 整段重排，站点集合不变。重排后问题变少才采纳 |
| 每日超容量 | 按"可移除性评分"逐站削减：低重要性、不在步道路径上、位于序列后半段的点先砍；入口段与已匹配到路线图节点的点受保护 |
| 资料缺交通边 | 不修。资料问题要靠核实解决，不靠删景点 |
| 削减到 3 站仍超容量 | 停止，把剩余问题交给闸门 |

#### 问题必须分级，否则闸门等于禁用开关

`RouteGraphIssue` 新增 `level`：

- **blocking**：`trail-backtrack`、`zone-interleaved`、`long-day`、单段直线 >30km 且非主题游、>30km 无车程估算
- **advisory**：`long-transfer` 中"资料无衔接方式，已按物理量推断（未经核实）"与"资料与物理量冲突但已改判"

这条区分是闸门能上线的前提：新目的地**必然**没有路线知识，若把"资料未覆盖"也算阻断，
每个新导览都会被拦死。用现网数据实测（`scripts/audit-routes.ts`）：

```
34 条路线 · 22 项问题 · 其中 blocking 4 项，且 3 项可被自动修复
  武功山 主题游    10.3h 超容量                        → 自动砍站 ✓
  北岳恒山 1日线    步道顺序回退（下山到三清殿后折返三元宫）→ 自动重排 ✓
  黄山   主题游    11.5h 超容量                        → 自动砍站 ✓
  天门山 2日线    天门山寺 → 黄石寨 直线 33km 跨独立景区  → 需人判断 ✗
```

只有最后一条会落进 `needs_review`，正是"必须由创作者决定是拆成两条还是删除"的那一类。

#### 状态与发布控制

- 闸门通过 → `status = 'done'`；仍有 blocking → `status = 'needs_review'`
- **路线内容始终写库**（不丢创作者数据），但阻断级未解决时审核页禁用"设为公开"，
  并在报告面板说明原因与处置方式（删路线 / 调站点 / 重新分析）
- 闸门拦下一个**原本公开**的导览时自动收回 `is_public` 并写入 `gate.unpublished`。
  本轮已经 `deleteRows + 重写 routes`，不收回就会把没过检的动线直接推给终端游客
- `ProcessingPhase` 必须把 `needs_review` 与 `done` 同等对待并停止轮询，
  否则会一路死等到 4 分钟超时、把正常完成的导览报成"处理超时"
- 首页「我的导览」把 `needs_review` 显示为朱印「待核实」印戳，否则创作者不知道自己有活要干

#### 不追溯封锁历史导览

`summarizeReport` 只认同一次生成写下的 `report.gate.blocking`。
v88 之前的报告没有分级字段，拿今天的阻断标准去判昨天的产物，
会让所有存量导览突然无法发布。历史报告里的 `🧭` 告警一律按 `advisory` 处理。

#### 数据库

`status` 是无 CHECK 约束的 TEXT，新增 `needs_review` 取值不需要迁移。
`supabase/tour-status.sql` 只写入取值与 `process_report` 的列注释、并建 `needs_review`
部分索引（用于观察闸门趋势），刻意不加约束：库里已有历史取值，加约束会让旧行写入失败。
**部署闸门前后需执行一次该文件。**

### 路线知识能力分层（P2 / v89）

前面所有修复都还在"没有知识也要产出三条路线"这个错误前提下工作。这一节把它改掉。

`knowledge-tier.ts` 把知识来源映射成**能力授权**，而不是质量分数：

| 能力 | L3 已验证 | L2 未核实 | L1 无知识 |
|---|---|---|---|
| 1日精华游站点装配 | ✓ | ✓ | ✓ |
| 用 trails 固定站内顺序 | ✓ | ✓ | ✗ |
| 用 zones 决定 1 日线取哪几个点 | ✓ | ✗ | ✗ |
| 2日全景游（分区或第二景区划分） | ✓ | ✗ | ✗ |
| 主题游（跨片区 60km 串联） | ✓ | ✗ | ✗ |
| 把交通方式当事实写进 narrative | ✓ | ✗ | ✗ |

来源映射：`curated / official / manual / creator-confirmed / builtin` → L3；
`auto-research / research / osm / 未识别来源` → L2；无 trails → L1。
`capabilitiesFor` 还会与数据实际形态取与：没有 zones 时 `zoneDriven` 自动关闭，
没有 edges 时 `assertTransport` 自动关闭 —— 现网 5 个策展目的地正是这种情况，
所以 `builtin` 计入 L3 也只解锁"按第二景区划分两天"。

`builtin` 计入 L3 的理由：它是 `trail-routes.ts` 里人工撰写的策展步道快照，
与数据库 `curated` 行同源，只是存放在代码里，不该因为"没进数据库"被误罚成未核实。

#### 为什么分层而不是继续加规则

三个直接后果都来自现网数据：

1. **丽江玉龙雪山（auto-research）**：未经核实的 zones 把 13 个点全归进"冰川公园"一个分区，
   zoneDriven 选点把 1 日线压到只剩 4 站；同时"授权"了 2 日线，产出
   `牦牛坪 → 丽江玉水寨 19km 无衔接`。分层后：1 日线按重要性取满容量，2 日线不生成。
2. **天门山 2日全景游**：`天门山寺 → 黄石寨 33km` 跨两个独立售票 5A 景区，
   是 v70.1 把阈值 30→40km 放宽换来的。分层后这条路线根本不会被生成 ——
   阈值调参的死结从源头解开，而不是再改一个数字。
3. **主题游**：丽江 78km 直线串联拉市海与香格里拉虎跳峡、武功山串联 58.9km 外的
   杨岐山孽龙洞、黄山 11.5 小时。没有已验证的接驳知识时，这类路线的正确形态是"不产出"。

#### 存量影响面（实测）

`scripts/audit-routes.ts` 按 `process_report.routeKnowledge.source` 判定每个目的地当次实际
使用的知识来源（anon key 读不到知识表，但报告里有记录），结果：

```
L3 2 个目的地 / L2 2 个 / L1 8 个
现网 34 条路线中：7 条多日线 + 6 条主题游 = 13 条（38%）将不再自动生成
```

这 13 条就是"系统从未获得授权、却已经发布"的路线。分层不是减少功能，
而是停止在未知时假装理解。

#### 解锁路径

审核页说明分级与未生成的路线类型（`ProcessReport` 的"未生成的路线"区块），并给出解锁方式：
创作者确认一条路线 → 写入 `route_confirmations`（source `creator-confirmed`，L3）→
下次同目的地直接解锁多日线与主题游。这是第一条能让系统"越用越准"的闭环：
分层给了它一个真实的激励，确认不再只是存一份快照。

未生成的路线走 `suppressedPlans` 单独通道，**不计入 blocking、不阻断发布** ——
它是"少产出"，不是"产出错的东西"。

## 重复路线检测与存量重跑（v90）

### 相似度必须用 Jaccard，不能用包含率

`index.ts` 的旧去重是"排序后站点集合完全相等"，既漏掉近似重复，也与文档宣称的
"重叠 >70% 视为重复"不一致。改造时第一反应是换成包含率 `|A∩B| / min(|A|,|B|)`，
**这个指标会摧毁多日线**：2日全景游按构造就是 `[...1日核心站点, ...第二景区站点]`，
必然完全包含 1日线。实测现网 18 组路线对里有 12 组"包含率 100%"。

改用 Jaccard（交集/并集）后分布立刻分开了：

```
100%  三清山 1日游·徒步环线 × 1日游·车行索道线   ← 真重复（10 站完全相同）
100%  黄山   1日精华游 × 文学巡礼线              ← 真重复（AI 自由选点抄了 1日线）
 80%  青城山/泰山 1日精华游 × 2日全景游           ← 设计如此，必须保留
≤73%  其余全部                                    ← 正常
```

阈值取 `DUPLICATE_JACCARD = 0.9`：远高于合法包含关系的上限（80%），只抓真重复。
另设 `MIN_DUP_STOPS = 3`，避免两站的"半日游"互相误伤。

### 自由选点路线只上报，不删除

v70.4 的结论仍然成立：文学巡礼线的价值在叙事，与 1日线撞站不该直接删掉。
但撞成**完全相同**（黄山线上实况）也不能静默留着，等于把"AI 抄了一遍 1日线"藏起来。
所以 `dedupeRoutes` 分两路返回：`dropped`（自动删除）与 `suspicious`（上报待核实）。

重复检测在**生成阶段**做，因此省掉一条重复路线的 AI 文案开销；
`scripts/audit-routes.ts` 另外报告存量重复与处置方式。

### 存量重跑脚本 `scripts/reprocess-tours.ts`

v88-v90 的修复只作用于新生成，存量 12 个导览不会自动收敛。没有重跑工具，
这些修复对线上内容等于没发生。

重新处理会 `deleteRows` 后重建 locations/routes/content_layers，
创作者未保存的编辑会丢失，公开导览没过闸门还会被收回公开。所以脚本设了四道闸：

1. 默认 dry-run 只读，必须显式 `--apply` 才写
2. `--apply` 前自动导出备份到 `scripts/out/backup/<id>-<标题>-<时间>.json`
3. `--all` 需再用 `--confirm <数量>` 复核范围，防止一次误操作全库
4. 串行处理（每条约 1 分钟；并发会打爆高德限流与函数 worker 预算）

`--apply` 必须提供 `SERVICE_ROLE_KEY` 或 `SUPABASE_JWT`：anon key 受 RLS 限制，
无法更新他人导览。卡在 `processing` 的历史行会先置 `draft` 再置 `processing`，
否则 UPDATE 触发器（只在"非 processing → processing"时开火）不会重跑。

```bash
export SERVICE_ROLE_KEY=***
deno run --allow-net --allow-read --allow-env --allow-write scripts/reprocess-tours.ts            # 预览
deno run ... scripts/reprocess-tours.ts --dest 丽江 --apply                                       # 单条
deno run ... scripts/reprocess-tours.ts --all --apply --confirm 12                                # 全量
deno run ... scripts/audit-routes.ts --json scripts/out/route-audit-baseline.json                  # 重跑后复验
```

### 尚未落地（下一轮）

- **闸门未做路线降级**：只实现了"重排 + 按容量砍站"两类自动修复，
  没有实现 2日→1日、删除整条主题游这类降级。v89 分层落地后，多日线在缺知识时
  已不会生成，降级的剩余收益主要在"有 L3 知识但当天行程仍排不下"的情形。
- ~~伪 confidence~~ 已完成（v91）。遗留：历史行里存的仍是旧算法算出的数值，
  重跑或重新研究时才会覆盖。
- ~~重复路线检测~~ 已完成（v90，见上文）。存量 2 组重复需重跑才会收敛。
- **非山岳目的地没有知识入口**：`loadOrResearchRouteKnowledge` 只在
  `destinationType === "mountain"` 时触发自动研究，古城/湖泊/园林类目的地恒为 L1。
  分层后它们至少不会再造出假装正确的多日线，但要能出好路线仍需知识来源。
- **存量数据待重跑**：21 条含伞形站点的路线、13 条不该自动生成的多日/主题游路线，
  都需要重新处理才会收敛。

### 存量清理清单

| 项目 | 存量规模 | 处理方式 |
|---|---|---|
| 路线含景区伞形站点 | 34 条中 21 条 | 重跑该导览即清理（新代码已阻断） |
| 未授权的多日/主题游 | 34 条中 13 条（38%） | 重跑后只保留 1 日线；创作者确认路线后解锁 |
| 路线缺 `legs` | 34 条中 28 条 | 重跑时生成 |
| 路线缺 `prof` 海拔剖面 | 34 条中约 31 条 | 重跑时采样 |
| `route_confirmations` | 疑似 0 条 | 需 service_role 确认；分层后确认才有解锁收益 |

---

### 真实 auto-research 知识的一次离线复现（v90）

新增 `scripts/research-knowledge.ts`：本地调用真正的 `research.ts`（Wikipedia + OSM + 高德 + DeepSeek），
**只读、不写 Supabase**，输出知识 JSON，可直接喂给 `audit-routes.ts --knowledge`。

此前体检只能跑 L1 无知识路径，读数是偏低的下限。有了它，第一次拿到线上真实路径的复算结果。

对玉龙雪山（云南）实跑一次，暴露出四个只有真数据才能发现的问题：

**1. 外部证据里混进无关省份条目，而置信度只数条数**

```
· wikipedia   丽江雪山观光火车   ← 相关
· wikipedia   东湖 (武汉)        ← 完全无关，武汉的东湖
· amap        周边景点
→ 置信度 0.75
```

`confidence = 0.6 + 0.05 × min(证据条数,3)`：一条不相干的维基条目照样给 +0.05。
这是伪置信度最直接的实证。

**2. 研究出的步道站点半数是服务设施**

6 个站点里 4 个是设施，且都带坐标、都被标 `required`：
`玉龙雪山国家级风景名胜区游客服务中心`、`索道候车厅`、`蓝月谷二级坝旅游厕所`、`蓝月谷游览车-候车厅`。

`injectTrailSeeds` 此前只检查 `required && lat && lng`，会把**一座公共厕所作为景点注入导览并排进路线**。
我上一轮判断"步道种子来自策展知识所以安全"，这个假设被真实数据推翻。

修复：种子补全同样过 `isNonSitePOI`。但入口/换乘设施是真正的动线节点
（"从游客中心乘索道进入"需要一个起点），所以用 `isTransferPOI` 区分，
**只在该步道的首站放行**；厕所、售票处一律拒绝。

**3. 设施节点用景区名派生别名，冒充了游览点**

`buildRouteGraph` 会给名字含景区名的节点派生该景区名作为别名。
节点「蓝月谷游览车**-候车厅**」因含"蓝月谷"拿到别名"蓝月谷"，
于是地点"玉龙雪山国家级风景名胜区蓝月谷"绑到了这座候车厅上，整段蓝月谷的步道顺序由一个设施点决定。

修复：设施节点不再派生 `scenicName` 别名（资料里**显式声明**的 aliases 不受限，那是人工/研究明确主张的等价名）。
修复后同一地点绑定到「蓝月谷导览驿站」，正确。

**4. 分层结论在真实知识下成立**

```
知识：zones 4 / trails 2 / edges 5（cableway 2、shuttle 1、walk 2）/ 置信度 0.75
能力分层：L2 → 多日线 不允许、主题游 不允许、分区选点 不允许、交通断言 不允许
体检：现网那条 19km 断裂的 2日全景游 与 78km 的主题游，按 L2 授权都不会再生成
```

另外注意：同一次研究跑两次的产出并不保证一致（temperature 0.1 + 外部数据源波动），
本地这次的 edges 与线上那份就不是同一组，这本身就是"未核实知识不能授权多日线"的又一个理由。

**5. 体检脚本两处读数偏差修正**

- 之前用原始 `destination.name`（丽江）查知识，而线上 `process-tour` 用的是从标题解析出的
  `resolveCoreDestination`（玉龙雪山），导致知识永远匹配不上、读数偏低
- `--knowledge` 现在既接受"目的地 → 知识"bundle，也接受 research 工具直接导出的单个对象

### 可信度改为可解释评分，并量化知识绑定率（v91）

`confidence = 0.6 + 0.05 × min(证据条数,3) + 0.02` 被替换为 `knowledge-quality.ts`
的分项评分：

| 分项 | 权重 | 含义 |
|---|---|---|
| `sourceTrust` | 0.35 | 来源权威度：人工撰写/确认 1.0｜内置策展 0.8｜机器抽取 0.55｜未知 0.3 |
| `coordCoverage` | 0.20 | 有坐标的站点比例 |
| `evidenceCoverage` | 0.15 | 坐标能追溯到外部 POI 证据的站点比例（模型自己填的不算） |
| `sitePurity` | 0.15 | 步道中不含厕所/售票处等非游览设施（索道候车厅、游客中心属登乘点，不算噪声） |
| `structureCompleteness` | 0.15 | 有 trails、有 ≥3 站步道、有 zones、有动线备注 |

`transportCoverage` 单独计算：显式交通边覆盖了多少**相邻站点对**。
`buildRouteGraph` 为 trail 相邻站生成的默认 walk 边（`source: "trail:*"`）不算覆盖，
因为它只表示"资料没说别的交通方式"。

与 `knowledge-tier` 的分工是刻意的，两个数字不能合并：

- `tier` 回答"来源有没有权威" → 决定能力授权（能不能出多日线、能不能断言交通方式）
- `quality` 回答"这份知识完不完整" → 决定选路排序、缺口提示与是否解锁交通断言

机器抽取的一行可以坐标很全（quality 高）但依然不该授权多日线（tier L2）。

落地细节：

- `normalizeResearchResult` 给每个站点打 `evidenceBound`（坐标来自外部 POI 证据而非模型自填），
  `confidence` 改由评分产出，自动研究仍封顶 0.8
- 提示词不再向模型索取 `confidence`，并明确"模型自评不作数"
- `selectRouteKnowledge` 排序改为 **先分级、再完整度、最后才看遗留 confidence 字段**
  （历史行那个字段是按条数算的虚高值，不能继续当唯一依据）
- `assertTransport` 需要 `transportCoverage ≥ 0.6`，不只是 `edges.length > 0`
- `process_report.routeKnowledge` 增加 `quality` 与 `gaps`，`audit-routes.ts` 增加**绑定率**指标

同一次玉龙雪山研究连跑两次的实测对比（也再次说明未核实知识不能授权多日线）：

```
第一次：zones 4 / trails 2 / edges 5，坐标覆盖 1.0，交通边覆盖 0.5 → 0.67 usable
第二次：zones 3 / trails 2 / edges 6，坐标覆盖 0.5，交通边覆盖 0.5 → 0.64 weak
旧公式两次都给 0.75
绑定率：路线 21 个站点里只有 2 个能对应到知识图节点
```

最后那行是这一节最重要的数字：**"有知识"和"知识可用"是两件事**。
research 写出了 6 条索道/观光车边，但站点名与实际入库地点对不上，绝大部分是死数据。
之前我默认前者等于后者，这个假设不成立。
- **知识绑定率偏低**：v91 实测玉龙雪山 21 个路线站点只有 2 个能对应到知识图节点，
  research 写出的 6 条索道/观光车边大部分连不上相邻站点对。
  现在这被 transportCoverage / bindingRate 显式度量并阻断 assertTransport，
  但要让 L3 名副其实，还需要站点名与高德地点之间的规范化匹配（含别名派生与行政区前缀剥离）。
