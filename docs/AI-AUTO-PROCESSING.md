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
| 2026-10-14 v93 | 主题游重构为两层结构（主题 → 景区 → 景区内的具体玩法点），不再与 1日/2日 同形；分区依据来自 `clusterRegionPts` 已算出却被丢弃的簇成员；`routes.sections` 落库，`stops` 仍是扁平序列故地图连线/交通分段/确认指纹不受影响；主题游不再受 L1/L2 限制（不声明跨区连续动线），仅 2 日全景游保留 L3 门槛；容量校验对主题游按片区数计日 |
| 2026-10-14 v92 | 知识绑定改善与真实瓶颈定位：节点名剥离设施后缀后再匹配（「蓝月谷游览车-候车厅」→「蓝月谷」）且真实景点节点优先于设施节点；新增分区动线覆盖率指标。实测未绑定站点 100% 是"知识里没有这个点"而非"名字对不上"，匹配只从 2/21 提到 3/21，真正的瓶颈是覆盖，提示词相应要求每个 zone 必须给 trail |
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

| 能力 | L3 已验证 | L2 未核实 | L1 无知识 |（v93 更新见下表）
|---|---|---|---|
| 1日精华游站点装配 | ✓ | ✓ | ✓ |
| 用 trails 固定站内顺序 | ✓ | ✓ | ✗ |
| 用 zones 决定 1 日线取哪几个点 | ✓ | ✗ | ✗ |
| 2日全景游（分区或第二景区划分） | ✓ | ✗ | ✗ |
| 主题游（v93 起全部分级开放，改为景区分组后不再声明跨区连续动线） | ✓ | ✓ | ✓ |
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

### 分区可编辑（v93 收尾）

分组现在是系统单方面判的，创作者只能看不能改，这和"把判断权交给创作者"的整体方向矛盾。
补上 `src/lib/routeSections.js`（纯函数）+ `RouteSectionsEditor`：
片区改名/改类型/上下移动、站点在片区之间移动、片区内调序、增删片区、线性路线一键"按景区分组"。

不变量写进测试：**任何一次编辑后，`stops` 仍是各片区顺序拼接 + 未归组补在后面**，
一个站点都不会被吞掉，所以地图连线、海拔剖面、交通分段、确认指纹都不会破。
删除片区不删站点，只退回未归组；同名片区靠 key 改名而不是丢站点（否则第二个片区的
站点归属会串到第一个片区上 —— 这是实现过程中踩到的真实坑）。

### 部署顺序脚本 `scripts/deploy.sh`

```bash
scripts/deploy.sh --check     # 只读探测（默认，不变更任何东西）
scripts/deploy.sh --deploy    # 三项前置全过才部署 process-tour
```

它守的是两个会让线上出事故的顺序问题：`routes.sections` 列不存在时新函数写该列会 400
把导览打进 `status=error`；前端没先上线时旧前端不认识 `needs_review`，
会把成功完成的导览一路等到 4 分钟超时报成"处理超时"。

当前实测状态：`legs`、`prof` 已就位，**`sections` 尚未创建**，CLI 未登录。

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
- ~~知识绑定率偏低~~ v92 已定位并处理：匹配侧做了设施后缀剥离 + 真实景点优先，
  但实测未绑定站点全部是"知识里没有这个点"，匹配只从 2/21 提到 3/21。
  **真正瓶颈是覆盖**，已加 `zoneTrailCoverage` 指标并让研究提示词要求每个 zone 必须给 trail。
  遗留：auto-research 仍倾向只给 1-2 条代表性动线，覆盖率需要后续用质量分反向约束
  （覆盖不足时不给 L2 以上的 trailOrder 权限）。

### 知识绑定的真实瓶颈是覆盖，不是匹配（v92）

原以为"有知识却用不上"是站点名写法不一致，做了两件事：

1. `stripFacilitySuffix`：节点名剥离设施后缀后再参与匹配。
   「蓝月谷游览车-候车厅」→「蓝月谷」、「牦牛坪下部站」→「牦牛坪」，
   这样知识里写好的索道/观光车边才连得上实际入库的「蓝月谷」「牦牛坪」。
   只剥确定收录的设施词，不做任意包含匹配：「武功山金顶帐篷」剥不出「金顶」，
   历史上专门防过的那类误配不会因此复活。
2. 同一景区名下若同时存在真实景点节点与设施节点，**绑定给真实景点**
   （剥离匹配只给 1.5 分，低于精确 3 与后缀 2）。实测「蓝月谷」绑到导览驿站而非候车厅。

然后逐个未绑定站点归因，结论和预期相反：

```
丽江玉龙雪山：18 个未绑定站点，全部是"知识里根本没有这个点"，零个是"名字对不上"
绑定率 2/21 → 3/21（匹配改善只贡献 1 个站点）
知识声明 3 个分区，只给了 2 条 trail —— 云杉坪/牦牛坪分区下的地点全部悬空
```

所以瓶颈是**覆盖**，不是匹配。据此新增 `zoneTrailCoverage`（声明的分区里有多少真的给了动线）
作为质量缺口项，并要求研究提示词「每个 zone 必须给一条 trail，zoneId 必须引用已声明分区」。

这条经验值得记下来：**在没有度量之前，我把自己下的判断（"是名称规范化问题"）当成了事实。**
`bindingRate` 一跑就把方向纠正了 —— 这也是先做度量工具、后做优化的理由。

---

## 主题游改成两层结构（v93）

### 问题

主题游过去和 1日/2日 用同一种形态：把一堆散点串成一条线。于是它既在"声明一条不存在的动线"，
又和 1日/2日 在内容节奏上完全没有区别。实测形态：

```
丽江主题游 7 站 = 冰川公园栈道 → 蓝月谷 → 邀月楼 → 云杉坪索道上部站
              → 甘海子 → 拉市海(28.6km) → 香格里拉虎跳峡(再 36.7km)
```

一条被写成连续行程、实际横跨两个地级市的"线"。

### 新结构

```
主题 → 若干就近可连着玩的景区（片区）→ 每个景区内部具体怎么玩
```

分区数据其实早就有：`clusterRegionPts` 会把 60km 内的地区景点按 8km 聚成簇，
但过去只取每簇一个代表点、**把成员丢掉**，所以主题游退化成一串互不相关的点。
现在保留成员：一簇 = 一个景区，簇内的点就是"这个景区里玩什么"。

```ts
type RouteSection = { key, name, kind: "核心景区"|"周边景点", allow: string[], text?: string }
```

约束：片区 ≤6、每片区 ≤6 站、总站点 ≤20；代表点排在片区首位（它就是景区名），
其余成员按重要性列在其后；片区内部顺序仍走 `orderStops`（路线图/步道/最近邻），
片区之间不假装连续。

### 兼容性设计（重要）

`routes.stops` **仍是扁平序列**，`sections` 只是叠在它上面的分组视图，
且每个片区的 `stopIds` 必须是 `stops` 的子集（已写成测试断言）。
这样地图连线、海拔剖面、交通分段、路线确认指纹全部不受影响，
旧的 12 条导览没有 `sections` 也只是退化为原来的线性展示，不会破。

### 容量语义跟着变

主题游是 N 个片区 ≈ N 天，按 1 日容量校验会把正常的分组行程全判成超容量。
所以 `RouteGraphOptions` 新增 `dayCount`，主题游按片区数计日；
容量修复也改成**逐片区**削站（一个片区排不下只削它自己，不会牵连其他片区）。

### 分层随之放开

主题游不再需要 L3：它只声明"这几个就近景区值得连着玩"，
依据是经过坐标校验的真实地点，不声明跨区交通连续性。
**只有 2 日全景游仍然要 L3** —— 那才是真正需要分区与换乘知识的地方（要回答"哪几个区算第一天"）。

### 最终路线矩阵

| 场景 | 产出 |
|---|---|
| 新目的地（任何分级） | 1日精华游（必须）+ 主题游（当 60km 内可成组 ≥2 个片区时） |
| 源材料提到书名/作品 | 再加文学巡礼线 |
| 有 L3 知识（人工策展或创作者确认） | 再加 2日全景游 |

即：新目的地至少 1 条、通常 2 条（含主题游），有小说源则 3 条；确认后 4 条全开。

---

## 跨片区判定改为与顺序无关（v94）+ 首次线上端到端验证

第一次真跑生产重跑，抓出三个只有实跑才会暴露的问题。

### 1. 主题游分区从来没落库成功

`planRoutes` 产出 slug 空间站点 id（`h1`），`routes.stops` 存的是带导览前缀的 db id
（`77a1-h1`）。我上一轮写的 `sec.allow.filter(id => stops.includes(id))` 两侧永不相交，
于是每个分区都被"非空站点"过滤掉，`sections` 落库恒为 `[]`。
抽成 `mapSectionsToDbIds` 并补 3 条测试。

### 2. 站点被排了两次序，校验对象与写库对象不是同一个东西

诊断日志给出决定性事实：同一批 9 个站点

```
[plan] 1日精华游 池=9 car段=0   顺序 栈道→蓝月谷→牦牛坪→云杉坪→白水河→甘海子→玉水寨→东巴谷→玉峰寺
[写库] 1日精华游 站点=9 car段=1  顺序 栈道→蓝月谷→甘海子→白水河→云杉坪→牦牛坪→玉水寨→东巴谷→玉峰寺
```

`orderStops` 对输入顺序敏感（`integrateUnmatchedStops` 与最近邻的平票都按先出现者排），
而 plan 阶段排一次、写库阶段又排一次。校验针对的是前者，发布出去的是后者。
修法：顺序只在 plan 阶段决定一次，写库直接采用 `plan.allow`。

### 3. 我 v94 那条"car 段即阻断"的规则是错的

顺着上面的事实继续查，发现更根本的问题：**"相邻站是否出现 car 段"是序列的产物，
不是路线的性质**。同一批站点，一种排序最长跳 11.4km（无 car 段），
另一种排序出现 19km 的 car 段。拿序列当判据，会让同一条路线既通过又被拦。

改成与顺序无关的连通性判定：站点两两按"景区摆渡可达"（≤12km）连边，
**并且资料里的显式交通边无条件算连通**（否则 `主峰→南门 28km/30分钟观光车`
这类已验证衔接会被误判成跨片区）；若站点集被切成多个互不可达的分量，
才判阻断，并从少数分量里按重要性削站。car 段本身降为待核实，
只要求文案写明交通方式与时长。

实测结果符合预期：丽江那条 1日线里 `甘海子↔玉水寨` 只有 11.4km，属可达一跳，
整条路线是一个连通片区，不再被误判为阻断；而 `恒山 + 应县木塔`（47km）
仍被正确识别为两个片区并削掉少数侧。

### 4. 首次线上端到端验证

```
重跑前：status=done / 公开 / 17 地点 / 3 路线（含 19km 断裂的 2日线与 78km 主题游）
第一次重跑（v110，规则过严）：status=needs_review / 被自动收回公开 / 阻断 1
修正后重跑（v111）：status=done / 阻断 0 / 2日全景游未生成（分层生效）/
                    plan 与写库两阶段 car 段一致（0 = 0）
```

闸门收回公开的行为已验证可用。丽江的公开状态是**被我那条错规则误伤**后收回的，
过检后已恢复 `is_public=true`（公开导览回到 12 条）。
注意：闸门不会自动重新公开，恢复是人工动作 —— 这个不对称是故意的，
系统不该在没人看过的情况下自行决定重新上线。

另外这次也再次确认 auto-research 的不可复现性：同一目的地三次重跑，
地点数在 16/17/20 之间浮动。这是"未核实知识不能授权多日线"的又一条实证。

---

## 批量重跑与它暴露的四个问题（v95）

12 条公开导览全部重跑，结果 11 条 `done` 且保持公开，1 条（黄山）被闸门拦为
`needs_review` 并自动转私有。批量跑本身暴露了四个只有真跑才会发现的问题。

### 1. 最短的路线恰好是唯一不被检查的那条

`routeGraphIssues` 开头是 `if (stopIds.length < 2) return []`。黄山重跑后
"1日精华游" 只剩 **1 个站点**，于是它直接跳过全部体检、以 0 问题通过。
现改为：少于 2 站报阻断（`路线只有 N 个站点，不构成可游览行程`）。
下限取 2 而不是 3，因为现网存在合法的 2 站"半日游"（龟山风景区→晴川阁）。

### 2. 路线生成完全没有截断兜底

内容层早就有"截断 → 拆半重试"，路线层没有。黄山 17 个地点，路线提示词要 3 条路线的
stops + narrative + sections，输出超 `max_tokens=8192` 被截断，`TruncatedError`
一路抛到顶层 → 整条导览 `status=error`，失败原因只有一句 `finish_reason=length`。
现在截断时改用精简文案（narrative 150-300 → 60-100 字，分区说明 60-120 → 20-40 字）重试一次。

### 3. 修复器对退化计划静默放行

`repairPlanStops` 在 `stopIds.length < 2` 时返回 `issues: []`，
等于"没有修复动作"被当成"没有问题"。改为把校验器结论原样带出。

### 4. `--tour` / `--dest` 被我自己加的 `--public` 弄坏了

加 `--public` 时我把一个 `if (onlyPublic)` 插进了 `if / else if` 链中间，
于是 `else if (!wantAll)` 挂到了新 if 上，`--tour` 单独使用时会掉进"未指定范围"分支
被清空。批量那次因为用了 `--all` 才没受影响。改成显式 `scoped` 标记。

### 首次读到生产知识表

| 项 | 实测 |
|---|---|
| `destination_route_knowledge` | 16 行：5 行 curated（恒山/嵩山/衡山/泰山/华山，conf 0.90-0.92）+ 11 行 auto-research |
| `route_confirmations` | **0 行** —— 创作者确认飞轮从未转动过一次 |
| auto-research confidence 分布 | 0.49×6、0.62、0.74、0.75×2、0.77 |

最后那行是 v91 评分上线的直接证据：旧公式对所有"三条证据"的研究一律给 0.75，
新评分把 6 个明显更差的研究结果区分到了 0.49。

### 仍未解决：规划器与校验器对"步道顺序"互相不一致

黄山现在的 3 项阻断全是 `trail-backtrack`（步道「北海景区」「白云景区」出现顺序回退），
而自动修复的"重排"手段无效（重排后问题数没减少，所以按设计不采纳）。

根因方向：`orderStops` 走 `planGraphStops`（内部用 `trailOrderForZone`，按
`matches.get(id)?.key` 找站点），而 `routeGraphIssues` 的检查 1 用
`matchLocsToGraph` 的**一对一**匹配结果算索引序列。两套匹配规则不同，
规划器认为自己排好的顺序，校验器认为回退了 —— 也就是**规划器的输出通不过规划器自己
使用的校验器**。这属于真缺陷，但修它要统一两套匹配语义，不能靠调阈值糊过去，
留作下一轮第一项。

## v96：主题游改为必出项

### 产品要求（用户明确定义）

一条新导览至少两条路线：**1日精华游** + **与周边地区组成的主题游**。
"地区景点 <3 个就不出主题游"的旧规则是错的——恒山本身一两个小时徒步就走完，
它的主题游恰恰必须靠周边（大同古城、悬空寺、应县木塔）来构成；青城山周边有都江堰；
龟山/东湖就在武汉市区，黄鹤楼、长江大桥、武汉大学、昙华林都可以组成主题。
景点大到一天玩不完（张家界国家森林公园级）才需要两日游；有书/小说/游记源材料才出文学巡礼线。

### 实测依据与改动

| 改动 | 证据 |
|---|---|
| `gaodeRegionScenics` 去掉 `location=` 坐标偏置、offset 30→50 | 带偏置时"大同+恒山坐标"只返回恒山子 POI（介石/财神庙/洗心亭），华严寺/云冈/都江堰/黄鹤楼一个都拿不到；去偏置后三城实测全部覆盖全城（大同45个：大同古城/华严寺/浑源古城；武汉44个：黄鹤楼/昙华林；成都45个：都江堰12km） |
| 剔除距核心 <3km 的"地区点" | 这类点是同一景区的子 POI，当独立片区会把主题游变成同一景区的内部路线（恒山实测） |
| 主题游并入阈值 `regionFinal ≥3` → `≥1` | 恒山/青城山重跑后只剩 1 条路线的直接原因之一 |
| 主题游缺席时必须写 warning，禁止静默 | 线上报告里主题游消失没有任何一行解释，创作者与开发者都看不见原因 |
| 主题游片区边界段（>12km）交通表述改为"跨区域接驳" | 旧表述把景区间位移断言成"专车/出租车"，与大同恒山线全程走景区直通车的实况不符；但无资料时反向断言"有直通车"同样是未核实声明，故用"班车优先、无班车包车"的择一条件表述，距离下限（car 保守车程）不变 |

### 保留的边界

- 两日全景游仍需 L3 已验证知识（它才真正回答"哪天去哪个区"）。
- 应县木塔属朔州，市级检索天然覆盖不到；这类跨市名点由 AI 提议点路径
  （`aiAttractions` 逐个定位）补足，不靠放宽地区检索半径。
- 非山岳目的地仍没有知识研究入口（`destinationType === "mountain"` 闸），列入下一轮。

### 验证

261 tests passed（新增：片区边界接驳表述、单周边景区主题游分区结构）；
生产文件 `deno check` 干净（test 文件 16 处历史类型错误与基线一致，非本次引入）；
lint 19 warnings 持平基线；三城高德探针实测通过。

## v96.1：路线文案逐路线生成（恒山重跑实测倒逼）

v96 上线后重跑恒山，导览直接 `status=error`，原因还是 `finish_reason=length`。
根因：恒山路线从 1 条变 2 条（主题游必出），主题游要带全部 stops 和逐分区
sections 文案，**整批**输出的 token 需求翻了一倍还多，v95 的"截断→精简文案
重试一次"在精简档同样超 8192 token，于是又整条崩掉。

这和 v70 内容层的教训完全同构：**容错粒度必须等于失败域**。批内拆半重试
对"整批超限"没有意义，路线层因此同样改为逐路线调用：

- 每条 plan 一次 AI 调用（并度 2），提示词只要求返回这一条；
- 单条截断/失败 → 精简文案重试 → 仍失败 → narrative 留空，
  **站点与分区照常产出**（路线组成本来就 100% 由代码决定，AI 只贡献文案）；
- 每一步降级都写 warnings，禁止静默。

原批量实现里的 day_label 模糊匹配（AI 返回顺序与 plans 不一致会张冠李戴）
在逐路线模式下不再需要，删除；站点集合仍以 plan 为准，AI 多报/漏报只记告警。

验证：261 tests passed；生产文件 `deno check` 干净；lint 19 持平。

## v96.3：重跑暴露的四处缺陷（行政区点 / 主题簇身份 / 目的地锚点 / 假车程）

恒山、青城山、东湖、龟山四条导览按 v96 重跑后逐个对照线上结果，发现四类真缺陷：

1. **行政区名被当景点入库**：AI 提取产出"湖北省武汉市"、裸省名地区检索产出
   "四川省成都市都江堰市"（挤掉真正的都江堰景区，青城山因此只剩 1 个地区点、
   主题游无法成线）。poi-filter 新增 `ADMIN_REGION_RE`（"省…市"链条或纯城市名），
   五个地点入口共用的闸门统一拦截；"黄陂木兰文化生态旅游区""湖北省博物馆-盘龙城
   展厅"等真实名不受影响（单测钉死）。
2. **主题游簇代表身份不一致**：`unifiedRegion60` 用 `pickRep(c)`（按重要性挑代表），
   `themeClusters` 却拿 `c.rep`（建簇时最先插入的点）过滤——两个"代表"不相等时
   整簇静默消失。东湖线上实测：黄鹤楼/昙华林/龟山/归元禅寺整个市区簇没了，
   主题游只剩远郊木兰。改为代表只算一次并复用；`pickRep` 同时按中文景区名后缀
   分层（景区/风景名胜区 > 公园/古城/古镇 > 寺/塔/楼），不再靠名字长度碰运气。
3. **目的地锚点兜底条件太窄**：只在 anchors 为空时兜底。恒山重跑时地区合并
   带进"大同火山群国家地质公园"等锚点，核心锚被 anchors[0] 顶成火山群，
   一日精华游只剩 1 站、闸门把导览自动转私有。改为"没有任何锚点匹配目的地名"时
   同样用目的地坐标兜底。
4. **跨区域接驳车程被拼成假数字**：衔接行同时有"直线约47km"和"约3小时车程"
   两个数字时，AI 拼出"约37.7小时车程"。边界段 note 去掉距离数字，车程只保留
   ETA 一处，提示词要求逐字照抄。

验证：264 tests passed（新增行政区拒绝、簇代表身份一致两条回归用例）；
生产文件 deno check 干净；lint 20（较基线 +1，来自 ADMIN_REGION_RE 的
\uXXXX 转义 warning，可接受）。

## v96.4：青城山/龟山重跑的第二轮修复（全部达标）

对四条重跑结果逐条验收时又挖出四个静默缺陷，全部修掉并重跑通过：

1. **裸省名地区检索返回空**：青城山地区只填"四川"，高德对无城市的 types 查询
   直接返回空（要它先选城市）→ 都江堰从未进候选。改为用目的地坐标
   `regeo` 反解所在城市再市级检索（实测成都候选 45 个、都江堰在列）。
2. **半径闸质心塌陷**：`planRoutes.nearCore` 用核心池质心 `cc`；核心池标签断裂时
   `cc≈(0,0)`，60km 内全部地区点被误杀且 plans 静默只剩 1 条。改为与
   coherentCorePool 一致优先目的地坐标（回归测试钉死）。
3. **`<3km 剔子POI` 一刀切误杀市区邻居**：龟山主题游里 1.4km 外的独立景区
   "黄鹤楼公园"被剔。规则收紧为"近 **且** 名称与核心/目的地同源"才剔
   （"北岳恒山-财神庙"这类照剔），龟山/东湖主题游随即出现黄鹤楼公园簇（6 站）。
4. **地点提取没有截断兜底**：它是管线里最后一个未防护的 AI 调用，
   "宁可多列"偶发输出爆 8192（青城山实测 status=error）。截断→限量 14 个重试。

最终线上形态（本轮验收标准 = 用户要求"一条景点至少两条路线"）：

| 导览 | 1日精华游 | 主题游分区 |
|---|---|---|
| 北岳恒山 | 10 站（主山线回归） | 核心+应县木塔+大同火山群+黄芪文化园+平型关+圣泉寺 |
| 青城山 | 9 站 | 前山核心+青城后山+都江堰熊猫谷+动物园+大熊猫基地+安仁古镇 |
| 武汉东湖 | 10 站 | 核心+**黄鹤楼公园(6)**+黄陂木兰+木兰草原+园博园 |
| 武汉龟山 | 7 站 | 核心+**黄鹤楼公园(6)**+黄陂木兰+解放公园 |

恒山恢复公开；四条全部 `done`。265 tests passed，lint 19 持平基线。

### 已知遗留（下一轮）
- 都江堰"市"挤掉"景区"簇的代表名（现分区叫熊猫谷/动物园等）——rep 分层可再加"市/县"惩罚。
- 两日全景游仍需 L3 已验证知识；非山岳目的地没有知识研究入口。
- 规划器/校验器步道顺序语义不一致（黄山 needs_review 卡在这）。
- 高德的"省…市"脏名与 Web Key 明文入公共仓库（P0，待批准处理）。

## v97：黄山 needs_review 的真正根因链（四轮重跑才挖到底）

黄山是本轮"每改一版仍出新问题"的活标本，最终定位到三层叠加缺陷：

1. **校验器把共享枢纽计入每条步道序列**：光明顶/排云亭同时属于玉屏/北海/白云
   三条步道（前山上北海下的换乘必经点）。枢纽在任一单条步道里的索引都不构成
   "必须走到那个位置"，但旧校验逐条步道计算单调性时把它们全算进去，
   规划器产出的合法换乘顺序被自己的校验器判成 3 处 blocking。
   → 只属于单条步道的点构成该步道的顺序骨架；≥2 条步道共用的点是连接器，
   不参与顺序断言。恒山式真折返（山脚→半山回跳）全部是单步道点，照旧阻断。
2. **文学巡礼线的叙事排序被发布闸误拦**：自由选点+按课本情节排序是产品设定，
   步道回退/跨区隔断对它是 advisory（仅供参考），物理类检查（长距离衔接、
   每日容量）保持 blocking。
3. **目的地坐标解析到行政市（最终根因）**：`gaode("黄山","安徽省黄山市")` 返回
   屯溪市区坐标，离山体 49km。半径闸（15km 核心池）与最近邻起点全被假锚点带偏，
   一日线在 1/2/3/4 站之间随每轮 AI 抖动漂移——这解释了"改了三轮还在出新问题"。
   → 候选非地区点聚成明显一团而 destLoc 距质心 >40km 时，判定解析到了行政市，
   动线锚改用候选质心（候选点全部经过地区坐标校验，它们在哪目的地就在哪），
   并写入 📍 告警。诊断行 🧮 核心池{destLoc/cc/标签池/地理全集/是否触发兜底}
   进入报告——兜底是否生效第一次变成可观测事实而不是推理。

最终线上：黄山 1日精华游 10 站（温泉→天都→迎客松→莲花峰→光明顶→始信峰→
清凉台→排云亭→飞来石→西海大峡谷，经典前后山大环线）、主题游 6 分区、
文学巡礼线 9 站；blocking=0，done，已恢复公开。

同轮附带修复：公司在建 POI 过滤（"东海索道分公司(建设中)"进过 1日线，
现网 289 名精准命中 2 个、零误杀）；`^\汉{2,10}市$` 加负向后顾防误杀
"星光夜市/花市"；文学巡礼线逐路线模式下必须拿到候选 id 清单（此前 AI 自创
拼音假 id 全部 resolve 失败回退 4 站）；核心池地理兜底改为"标签池相对
地理全集残缺 ≥4"的支配性判据，且不依赖 destLoc 存在。

268 tests passed；生产文件 deno check 干净；lint 19 持平基线。

## v98：非山岳知识入口 + 创作者确认飞轮实测通 + 密钥出库

### 1) 研究入口对全部目的地类型开放（片区模板）
`loadOrResearchRouteKnowledge` 不再只看 `type=mountain`；destinationType 透传到
route-research，非山岳走"片区模板"：zones=可独立成半天以上游览的片区、
trails=片区内实际走法、edges 支持地铁/轮渡（other+note 写线路名）与
观光车/直通车（shuttle）。本地实测 `--type city 武汉 湖北`：
产出 东湖景区带/武昌古城-黄鹤楼片区/汉口江滩-江汉路片区 三个 zone 各配一条
片区内 trail（黄鹤楼→昙华林→司门口），证据句可追溯。未写库（脚本本就只读）。

### 2) 创作者确认飞轮端到端实测（伪造行验证后即删）
写入一条 route_confirmations（照 TourView.confirmRoute 的载荷形状）→
`loadRouteKnowledge("三清山")` 选中 creator-confirmed → **tier=L3**，
multiDay/trailOrder 解锁，zoneDriven/assertTransport 因数据形态自动关闭
（zones 空、交通边覆盖不足）——分层语义正确。重跑测试导览：status=done、
tier=L3、1日线按确认骨架排序；无第二片区标签时两日线不虚构（符合设计）。
测试行已删除，route_confirmations 回到 0 行。前端 RLS 策略核对：
authenticated 仅可插/查自己拥有的导览，函数侧走 service key——链路无断点。
**结论：功能没坏，是从没人点。** 使用姿势：导览详情（创作者本人）→ 路线卡
→ "确认这条路线" → 该目的地后续生成直接吃这份知识。

### 3) P0 仓库侧完成，平台侧待用户
高德 Web 服务密钥（2ff1bf…）已从 APP-DOCS.md 移除，本地工作副本转入 .env；
amap.js 的 JS key/安全密钥保留硬编码缺省——它们按高德模式本就该随浏览器
公开，真正防护是控制台"域名白名单"绑定（历史公网可见性不变，故轮换照旧必要）。
**待用户执行（约10分钟）**：高德控制台重置 Web 服务密钥 + JS密钥配白名单并
重新生成安全密钥；Supabase roll service_role key、吊销 sbp_ CLI token。
之后：新值进 .env，执行
`export SUPABASE_ACCESS_TOKEN=<新token>; supabase secrets set GAODE_KEY=<新webkey> --project-ref qxunedraoviaonjdanag`
并重新部署两个函数。git 历史里的旧值无法靠删除失效，轮换是唯一解。

268 tests passed；deno check 干净；process-tour v120 / route-research v7 已部署。

## v99：借鉴三仓库第一批（真实路径 + SRTM30m + 坐标纪律 + 路线深链）

对 SpaceZephyr 三仓库（map-motion / travel-vlog / trail-planet）的研究报告结论：
它们不做路线规划（路线是输入），价值在**地图表现力、地理数据工艺、内容产品化**三层。
第一批落地其中零架构风险的三项：

1. **真实路径成线**（`route-paths.ts`，学 map-motion"路线是高德真实路径"）：
   legs 的 walk→步行 API、shuttle/car/other→驾车 API、cableway→直线；
   `routes.path = {geom, stopKm, totalKm, planned, fellBack}` 落库（迁移已执行）。
   此前地图是"景点连直线"、剖面里程是直线距离（系统性低估 20-60%）。
   玉龙雪山实测：1日线真实步道里程 67.2km（直线版约 40km），
   8/9 段真实路径、索道段正确回退并计数上报（禁止静默降级）。
   Douglas-Peucker 抽稀（20m 容差）：5982 点/130KB → 809 点/18KB。
2. **海拔数据升级**（`elevation.ts`）：etopo1（1.8km 网格，把雪山剖面抹成直线）
   → **srtm30m**（30m），失败自动回退 etopo1；剖面改为沿真实路径采样。
3. **坐标纪律**（学 map-motion"全程 GCJ-02，查海拔时转回 WGS-84"）：
   `gcj02ToWgs84()`——30m 网格上 GCJ 数百米偏移会把陡坡海拔读错几十米。
4. **#r=\<routeId\> 深链**（学 trail-planet）：选中路线同步 hash、分享链接直达该路线、
   带 hash 打开自动等折线就绪后选中（轮询 5s 超时）。

发现并诚实记录：报告里 A1/A2 预想要做的"剖面看点标注/里程插值"其实**已经存在**
（ElevationProfile 的 stopPositions/routePathAtKm 弧长插值），本轮真正的增量是
把三者统一到**同一套真实几何**上。275 tests passed；lint 19 基线；已部署。

### 遗留（第二批候选）
- 网页内"路线回放模式"（trail-planet 的相机跟随 + travel-vlog 情绪配方 + 文学卡弹出）
- 存量导览的 path 回填（批量 --all 重跑，建议低峰期执行）
- 回顾视频离线导出（map-motion 管线复用）、日照金山光线推演
