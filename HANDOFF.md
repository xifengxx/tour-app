# HANDOFF — 工作交接（2026-08-06 更新）

> 原 Claude Code 会话 9d6c4422 因上下文超限无法恢复（见文末「会话丢失说明」）。本文件是当前进度的权威来源，由新会话无缝续接。
> 开工前先跑：`git status` 确认工作区状态。

---

## 一句话当前状态

**AI 处理管线已到 v76（v70 系列 = Kimi K3 系统性容错大修，覆盖我 v69 的失败路径盲区）**：我的确定性路线组成（`planRoutes`）+ 外部校验层被完整继承；Kimi 补上了全类型错误重试、内容点级补生成、失败原因落库、卫星景区锚点确定性、文学线 dedup 豁免等。嵩山/青城山/天门山/泰山/黄山五场景验证通过（详见 `docs/AI-PIPELINE-REVIEW.md`）。**08-06 已把 Kimi 对比经验沉淀为第 9 节 —— 今后改这套管线必须遵守的原则。**

## 会话改动 —— 全部实测驱动（2026-08-05 第二轮；08-06 补 Kimi K3 对比沉淀第 9 节）

### 1. 地区格式「省名+市名连写」（修「AI没有生成任何地点」）
- **症状**：用户新建导览目的地地区填 `湖南张家界`（无"省/市"分隔符）→ 高德坐标正确但 `regionMatch()` 全部拒绝 → 0 地点、前端报「AI 没有生成任何地点」。不是会话改坏了逻辑（`git diff` 确认 regionMatch 未动），是既有格式缺口。
- **修复**：`splitRegion()` 加省级前缀表 `PROV_PREFIX`（34 个省级区划短名），`湖南张家界` → `{prov:"湖南", city:"张家界"}`，`gaode()` 的 city 参数因此能正确限定到张家界市（此前 city="湖南张家界" 非法 → 全国兜底 → 天门洞/鬼谷洞/凌霄台解析到北京/洛阳/南京的错点）。
- `regionMatch()` 裸名分支改为**先城市精确匹配、后省份匹配**（省份匹配仅限 ≤3 字纯省名，防「湖南张家界」放行同省他市）。加 0 地点防御性 throw（status=error，不再静默 success）。
- 单元测试 +13 条（splitRegion/regionMatch 连写场景），全部通过。

### 2. 性能并行化（修 Edge Function `WORKER_RESOURCE_LIMIT`）
- **症状**：修复 1 后地点全量通过，完整管线（提取+地区+子景点扫描+分批内容+路线）串行 4-6 个 DeepSeek + ~60 个高德调用 → 超 Edge Function 预算被 `WORKER_RESOURCE_LIMIT` 杀掉（一度返 0 地点）。
- **修复**：新增 `mapLimit(items, limit, fn)` 有界并发助手。
  - 逐地点 gaode+regeo：串行 → 并发 6。
  - 地区 AI 提议（rr2）+ 地区高德查询：提前与核心提取**并行**启动。
  - 地区 AI 景点 gaode 校验：串行 → 并发 5。
  - 内容分批（8/批）：多批**并发**，且与路线生成**并行**（路线只用 locs/id，不依赖内容）。
- 效果：被打爆 → 实测 58-65s 稳定完成（HTTP 200）。

### 3. 子景点确定性覆盖收口（补上 袁家界/百龙天梯）
- **袁家界**：地区合并改为 **AI 提议知名景点优先**，regionScenics 补足到 20（原顺序 regionScenics 30 个先占满 20 上限，AI 只提名的袁家界/百龙天梯被挤掉）。
- **百龙天梯**：子景点扫描去重阈值 **1000m → 300m**（百龙天梯距"张家界国家森林公园"仅 ~700m、袁家界距金鞭溪 ~900m，被 1000m 误判为同一地点剔除）。
- **杂点过滤**：扫描 rank 2（非 AI 已知、非官方景区名的奶茶店/足道馆/高山流水等）**直接拒绝**；只收 rank0（AI 已知）+ rank1（官方景区名）。
- 扫描只扫**非核心**锚点（核心景区子景点 AI 提取已覆盖），省 API 调用与时间；高德限流重试 2→3 次+退避，防静默返空。
- rr2 地区 AI 提议 prompt 强化：**"若知名景区有多个著名子景点必须全部列出、一个都不能漏"**（通用表述，示例仍用张家界武陵源 8 子景点），降低 AI 漏列概率。
- 实测：8/8 著名子景点进 2日 day-2；七星山/黄龙洞/大峡谷未混入扫描。

### 4. 报告修正
- `deduped` 改用提取去重后计数（原来地区/子景点并入后再减 → 负数如 -10）。

### 5. 副标题自动生成（用户没填 subtitle 时 AI 补）
- 用户在创建导览时可填 subtitle（TourEditInput 已有输入框）；没填 → `process-tour` 用 DeepSeek 生成一句文学味副标题（15-30字），与地点提取**并行**启动（短输出，不占关键路径），完成时随 `done` 一并写回 `tours.subtitle`（≤40 字防线）。
- 参考风格示例（黄山/泰山/三清山）内嵌在 prompt 里；novel 导览会带上《书名》（作者）作素材。
- 实测：`三清山之旅10-test`（原空 subtitle）重跑后自动生成「访葛洪仙踪，观三清云海奇峰」。手动补的 4 个公开导览 subtitle 见上文。

### 6. 青城山导览修「九寨沟/四姑娘山混入 2日游」（实测驱动的 4 连击）
- **症状**：目的地地区填裸省名「四川」→ 2日 day-2 混入九寨沟/四姑娘山/峨眉山等 150-500km 的点，且 祖师殿/朝阳洞/老君阁 被解析到全省同名错点（广汉/遂宁/北京）。
- **Fix 1 — 地区合并 60km 半径过滤**（`REGION_RADIUS=60000`）：地区点只在核心周边 60km 内并入。四川 → 九寨沟(250km)/四姑娘山(72km)/峨眉山(151km)/泸沽湖(500km) 全剔除，都江堰(12km)/成都景点 保留。
- **Fix 2 — `mainScenicName` 排除「独立」且要求真实景区 ≥2 子点**：原代码把「独立」兜底标签也算进去 → 它成了"站点最多的景区" → 2日 day-2 被要求"只含独立景区站点"，把九寨沟全塞进来。现「独立」不计入；无 ≥2 子点的非核心景区 → 主景区留空 → 2日 day-2 继续覆盖核心景区其余子景点。
- **Fix 3 — 高德搜索 location 位置偏置**：先 `gaode(destName)` 得目的地坐标，传给所有后续高德搜索作 `&location=` 偏置（青城山 → 朝阳洞/祖师殿 解析到青城山那个而不是全省同名）。
- **Fix 4 — 裸省名不传 city 参数**：实测 `city=四川&citylimit=true` 会**压过 location 偏置**（传了偏置朝阳洞仍解析到遂宁）。新增 `PROV_EXACT`：city 是裸省名（四川/江西/河南省）→ 省略 city 参数，靠偏置定位。
- 实测：青城山重跑 → 13 地点（青城山 8 + 都江堰/后山/五龙沟/白云万佛洞 5）、3 路线；2日 全青城山景点，主题游含都江堰等周边；朝阳洞坐标正确。祖师殿本次因 regeo 限流偶发被跳（可重跑）。
- 回归确认：天门山（湖南张家界，有效城市）不受影响 —— 有效 city 仍传，偏置仅辅助。

### 7. 2日游真实两日 + 主题游数量约束（确定性路线站点规划）
- **症状**：青城山之旅 2日全景游 = 1日精华游 + 朝阳洞/山门 2 个点（全是前山），不是真两日；主题游把全部 13 点塞进去无数量约束。
- **根因**：路线站点由 DeepSeek 自由选择，`req3` 景区分区规则 AI 屡次不遵守（之前九寨沟/七星山混入 2日同理）。实测：青城后山非锚点（"青城后山"不连续含"青城山"），`attachScenicTags` 把 都江堰/青城后山/五龙沟/白云万佛洞 全归到 scenic=青城山 → `mainScenicName` 空 → 2日第2天无「后山」来源。
- **修复**：新增纯函数 `clusterRegionPts`/`pickRep`/`planRoutes`，**路线组成改由代码确定性计算**，DeepSeek 只写 narrative + 站内排序：
  - 1日精华游 = 前山核心 ≤8（含 朝阳洞/山门）。
  - 2日全景游 = 前山(第1天) + 后山(第2天)。后山池优先 `mainScenicName`（张家界武陵源）；为空则对 地区景点 8km 空间聚类取最大簇（青城后山/五龙沟/白云万佛洞）。
  - 主题游 = 4 热核心 + 每簇一个「统一景点」代表（都江堰、青城后山；青城山景区与核心同坐标被剔除）。
  - 确定性兜底：解析 AI 返回 stops 后强制 `stop 集合 == allow 集合`（剔除多出、补齐缺失），100% 不依赖 AI 自觉。
- 实测（`scripts/test-gaode.mjs` planRoutes 12 断言全过）：1日=8 / 2日=11 / 主题游=6（4热核心+都江堰+青城后山），主题游不含 五龙沟/白云万佛洞。
- 注意：主题游 top-4 核心并列（建福宫/老君阁 importance4）按原 sort_order 取，可能与人工期望差一个点。

### 8. 4层内容「显示为空」修复（存储格式扁平/嵌套不一致）
- **症状**：用户检查 青城山之旅，2日 的青城后山/五龙沟/白云万佛洞 + 主题游的 都江堰 四层内容（novel/history/folklore/customs）全空；质问上次跑有没有验证 4 层完整度。
- **根因**（实测 `jsonb_typeof` 定位）：内容**早已生成**，不是缺失。内容按 ~8 个分批调 DeepSeek，第一批（前山核心）返回嵌套 `{novel:{text:"..."}}`，第二批（地区景点）返回扁平字符串 `{novel:"..."}` —— 前端 `ContentCard` 只读 `.text`，扁平数据整卡显示为空。上一轮验证只查 `layers != '{}'`，扁平数据非空 → 漏检。
- **修复**：
  - `process-tour` 写库前新增 `normalizeLayers()`：扁平字符串 → `{text:"..."}`；已嵌套 / `scenes` 结构保持原样。（v69 已部署）
  - 前端 `ContentCard.jsx` 同时兼容两种格式，存量扁平数据也能正常显示。
- **验证**：重跑青城山 → 全部 16 地点 4 层文本非空、均为 object 结构；`normalizeLayers` 8 条断言单测通过。
- **教训**：验证内容完整性不能只查"非空"，还要查**结构**（`jsonb_typeof` object vs string）。

### 9. Kimi K3 对比沉淀（v69 vs v70 系列，2026-08-06）—— 今后改管线的原则

与用户用 Kimi K3 优化的 v70→v70.4 系列逐版本对比（我的 v69 847 行 → 现 v76）：
**我的架构方向（确定性规划 + 外部校验层）被完整继承、未推翻；盲区全在"失败路径"—— 我让正常流程更稳，却让管线自己的失败都汇到同一个 catch 全崩。**

#### 9.1 我的盲区（Kimi 补上的）

| 维度 | 我 v69 | Kimi v70 |
|---|---|---|
| **重试范围** | `deepseek` 只对 JSON 解析失败重试；HTTP 429/5xx/超时直接 throw | 全类型错误重试 + 指数退避 1s/3s/8s + 并发 6→3 防自我限流 |
| **内容批次** | 一个 chunk 失败 → 整个 `Promise.all` 崩 → status=error | allSettled 语义：截断自动拆半 → 单点补生成 → 完整性检查 → 仍失败记 warning 不阻断 |
| **早退路径** | GAODE_KEY 缺失/Tour not found 直接 return，status 永远 processing（无限转圈） | 所有早退置 error |
| **失败原因** | message 返回给 pg_net（被丢弃），前端只见「服务器端出错」 | `process_error`/`process_report` 落库，前端失败页显示真实原因 |
| **聚合过滤** | `mainPool.every(≤25km)` 一票否决；离群剔除误杀真远景区簇（天门山+天门洞 35km） | 逐点 filter + 簇感知恢复（≥2 点簇是真景区，恢复） |
| **锚点识别** | `isScenicAnchor` 子串匹配过宽（「青城山索道」「中国嵩山卢崖瀑布」成锚点 → corePool 剩 1 点） | 收严（等于目的地 或 以景区词结尾）+ v70.2 卫星景区规则（青城后山/黄山北坡确定性成锚点） |
| **诊断能力** | 结果二元（成功/失败），AI 随机性问题只能重跑碰运气 | `process_report` 埋点 plans/corePool/warnings → 黄山 routes 3/4 靠埋点两轮实锤定位 |
| **复现手段** | 改完跑一遍看结果 | 先写 `debug-songshan.mjs` 100% 复现失败，再 dry-run 双模式管线同输入 A/B |

#### 9.2 今后改这套管线必须遵守的原则

1. **失败路径一律置 error + 落库真实原因**，包括"确信不会发生"的早退。
2. **重试覆盖 HTTP 错误全集**（429/5xx/超时/空内容），不只 JSON 解析；配退避 + 降并发防自我限流。
3. **大任务用 allSettled 语义**：点级补生成 + 完整性检查，绝不让一个点/批拖垮全链路。
4. **聚合过滤改逐点过滤**：写 `every()`/`some()` 前先问"元素是否独立"，独立就该逐点判断。
5. **AI 随机环节要么确定性化，要么埋 `process_report` 诊断标记**（无埋点的随机问题 = 不可复现问题）。
6. **改 bug 前先写能稳定复现的脚本**，复现脚本比代码审查值钱（嵩山 district 失败用真实高德 API 100% 复现）。

#### 9.3 我做对、被继承/印证的部分（方向正确）

- `planRoutes` 确定性路线组成 —— 完全继承，成为 v70.1-70.4 迭代的地基。
- 负向过滤优于正向（都江堰/灌县古镇误杀教训）—— Kimi 的 P1-10 独立得出一致结论。
- day_label 匹配防张冠李戴、名称多轮清洗、外层校验拦截幻觉 —— 全部保留。

> 完整 A/B 实测与逐版本改动见 `docs/AI-PIPELINE-REVIEW.md`；版本号对应关系见 `docs/AI-AUTO-PROCESSING.md` 版本表。

## Git 状态

最近提交（已落盘，按新→旧）：

| 提交 | 说明 |
|---|---|
| `6fae04b` | fix(v70.2-v70.4): 卫星景区锚点(青城后山确定性) + stops 保序去重 + 文学巡礼线 dedup 豁免/空回退 — 青城山天门山泰山黄山四场景验证通过 |
| `012523e` | fix(v70.1): planRoutes 距离阈值放宽 25→35 / 30→40km — 修天门山↔武陵源 32km 双景区被挤出路线 |
| `c2415e7` | fix: AI 管线 v70 系统性大修 — 嵩山 district 失败根因 + 全链路容错（详见 `docs/AI-PIPELINE-REVIEW.md` 与第9节） |
| `05ae725` | feat: 交互动效层 — 朱印盖印入场/印章轻摆/下划线展开/按钮按压/panTo平滑/路线运笔渐绘/手卷展开淡入 |
| `6cbfa64` | feat: 「纸上山河」v2 精进 — 纸边晕影/朱印渐变/品牌化选中·滚动条·焦点/hero对联/金泥细线/卡片双线框hover/翻页淡入 |
| `fd80815` | feat: 「纸上山河」Phase 3 — 研墨展卷等待动画 + TourEdit/弹窗风格统一 + 全站 emoji 图标清零 |
| `5cde688` | feat: 「纸上山河」Phase 2 — 地图页手卷化：国画五色路线/卷轴拉手/壹贰叁地点条/批注式引文/ContentCard暗色残留修复 |
| `13c5b81` | feat: 「纸上山河」视觉重构 Phase 0+1 — 宣纸/朱砂/黛青新色板 + Noto Serif SC + 纸纹/印章/竖排装饰语言 + NavBar/Home/Login 改版 |
| `849ebb9` | fix: 内容层扁平/嵌套结构不一致 → 写库前 `normalizeLayers()` 统一 + 前端兼容（详见本次会话第8节） |
| `a85a0cf` | fix: 2日游真实两日(前山+后山) + 主题游数量约束(4热核心+统一景点)，路线组成确定性 `planRoutes`（详见本次会话第7节） |
| `1bd2727` | fix: 青城山/四川类导览 2日游混入远点 + 常见名解析错点（地区60km半径 + 主景区排除独立 + 位置偏置 + 裸省名不传city，详见本次会话第6节） |
| `59ba1b5` | feat: 用户未填副标题时 AI 自动生成 subtitle（详见本次会话第5节） |
| `6d59092` | fix: 地区格式「湖南张家界」连写致0地点 + 子景点确定性收口(百龙天梯/袁家界) + 并行化防 WORKER_RESOURCE_LIMIT（本轮，详见「本次会话改动」第1-4节） |
| `a1eba59` | fix: gaode 坐标查询重构 — 名称重叠过滤防错点 + 无匹配才放宽兜底 + 限流重试 + 名称多轮清洗 |
| `c56b24d` | fix: DeepSeek/高德 fetch 加超时(120s/30s) 防挂死 + 2日主景区覆盖子景点 |
| `8ded175` | feat: 地区合并 AI提议+高德校验 + 2日主景区覆盖著名子景点 |
| `001850b` | feat: 地区景点改用「AI提议知名景点 + 高德校验坐标」合并 |
| `d51fd6a` | feat: 地区并入确定化 — AI只提核心 + 高德锚点周边并入 + 杂点过滤 + 上限20 |
| `6b5e009` | feat: 地区并入上限 6→10 + 地区点互去重 5km→2km |

**`a1eba59` 的核心改动**（`supabase/functions/process-tour/index.ts` 的 `gaode()` 函数）—— 本次会话实测驱动的完整重构：

1. **名称重叠过滤（关键，修复静默错点）**：高德文本搜索 top 结果常是同景区相关点（搜「袁家界」→「杨家界乘车处」、搜「十里画廊」→「索溪峪」），原代码取 `realPois[0]` 会把袁家界放到杨家界坐标。现只接受 `p.name.includes(name) || name.includes(p.name)` 的 POI；无匹配返回 null（跳过+告警，比放错安全）。
2. **兜底条件修正**：原来只在 `realPois.length === 0` 时放宽；但袁家界在严格 types 下返回 20 个「无关但非空」结果 → 不触发兜底。现改为 **「严格无名称匹配」才放宽** 全类型重查。
3. **类型优先**：名称匹配点中优先 `风景名胜|旅游景点` 类型（袁家界游客基地是生活服务，让位「袁家界景区-观景台」）。
4. **限流重试**：高德 `CUQPS_HAS_EXCEEDED_THE_LIMIT` 高频出现 → 延迟 300ms 重试一次。
5. **名称多轮清洗**：剥 `武陵源风景名胜区-` 前缀 + `游客基地/上站/小火车/乘车处/观景台/风景区/景区` 等后缀，最多 3 轮直至稳定（注意：必须「风景区$」优先于「景区$」，否则「天子山风景区」→「天子山风」）。

**实测记录**（验证脚本 `scripts/test-gaode.mjs`，从进程 env / `.env` / 旧会话备份自取 GAODE_KEY，不打印密钥）：
- 袁家界/金鞭溪/十里画廊/百龙天梯/天子山/黄石寨/杨家界/水绕四门 **8/8 解析成功**，坐标均在武陵源范围内（lng≈110.4-110.5, lat≈29.33-29.40），名称全干净。
- 名称清洗正则 17/17 通过（含边界：张家界国家森林公园剥空前回落原名）。

## 开放项 / 下一步

1. **AI 随机性的残余（比 v69 大幅收窄，未归零）**：v70.2 卫星景区锚点已把「青城后山 day-2 抽到都江堰」修成确定性（day-2=泰安古镇→五龙沟）；**剩余随机性在"地区合并是否触发/构成"** —— 黄山两次运行 26→17→22→28 地点漂移，取决于 DeepSeek 当次提议构成（质量合格但不可复现）。如要归零：把 rr2 地区提议也确定性化（类似 regionScenics types 查询）。
2. **回归一条非张家界导览**（黄山/泰山/三清山等）确认并行化 + 子景点扫描不破坏单景区目的地的路线与内容（本轮只实测了天门山 + 青城山）。
3. **Edge Function 时长余量**：实测 58-65s，依赖 DeepSeek/高德延迟。Management API 的 `timeout_seconds` 元数据不生效（已试，被忽略）——如后续偶发 `WORKER_RESOURCE_LIMIT`，需装 supabase CLI（`supabase functions deploy --timeout-seconds 300`）或进一步砍调用量。
4. **金鞭溪/水绕四门仍依赖 AI/regionScenics**：高德 around 在它们自身坐标也扫不到（实测 8km 46-52 候选均不中），只能靠地区合并（AI 提议 + regionScenics types 查询）覆盖。rr2 prompt 已强化"宁多勿漏"，当前实测通过；若未来再偶发漏，可考虑把 regionScenics 的 types 查询范围放宽（但会引入杂点）。
5. **武陵源"风景名胜区十里画廊"这类扫描复名**：与"十里画廊"重复出现在 locs（扫描命名源），可由 name 去重进一步收口，当前不影响路线（stops 只引用其一）。
6. **环境问题**：AuraKit build-verify hook 每次编辑都报缺 `tsc@2.0.3`（`npx canceled due to missing packages`）—— 需要装 tsc 或修 hook，当前是噪音不影响功能。
7. **supabase CLI 未装**：GitHub 下载被重置，本轮全程用 Management API 部署（`/tmp/deploy-process-tour.sh`，raw index.ts 上传）。CLI 装好后可回归 `--timeout-seconds`。

## 核心代码位置

- **路线生成主逻辑**：`supabase/functions/process-tour/index.ts`（500 行）
  - `gaode(name, destCity)` — 高德坐标查询（含本次未提交改动）
  - `gaodeRegionScenics(city)` — 确定性地区景点
  - `gaodeAroundScenics(lng, lat)` — 景区锚点周边子景点（如武陵源内的百龙天梯/金鞭溪/十里画廊）
  - `pruneFarPoints(cands)` — 离群点过滤（与核心 >5km）
  - `deepseek(messages, retries=2)` — AI 调用（超时 120s + 重试，防挂死）
  - 主流程：地区景点确定性补充 → 路线生成（1日精华 / 2日全景 / 主题游；2日全景第2天覆盖主景区全部著名子景点，≤8站/天、总≤14）
- 前端：`src/pages/TourEdit.jsx`（创建/审核）、`src/pages/TourView.jsx`（浏览）、`src/hooks/useTourData.js`（数据）
- 数据库触发器：`supabase/ai-triggers.sql`（pg_net 服务器端调 Edge Function，浏览器零长连接）
- 架构/设计/密钥：`APP-DOCS.md`、`DESIGN.md`、`docs/AI-AUTO-PROCESSING.md`

## 验证脚本（`scripts/test-gaode.mjs`）

复刻 `gaode()` 完整逻辑（含本次重构）+ 确定性路线规划镜像，四段：
1. **名称清洗正则单元测试**（无需密钥，17 用例）；
2. **实时高德解析**（8 个武陵源子景点 + 坐标范围校验，需 GAODE_KEY）；
3. **planRoutes 确定性路线单测**（青城山 13 点 mock，无需密钥，12 断言）：1日=8 / 2日=11(前山8+后山3) / 主题游=6(4热核心+都江堰+青城后山)；
4. **normalizeLayers 内容结构单测**（无需密钥，8 断言）：扁平字符串→嵌套、scenes 保持、非对象→空对象。

运行：`GAODE_KEY=<key> node scripts/test-gaode.mjs`（或把 key 放 `.env`；脚本也会从 `~/session-backup-9d6c4422.jsonl` 自取旧 key，不打印密钥）。

## 运行 / 测试

```bash
cd ~/Documents/旅行导览/tour-app
npm run dev      # 前端
npm test         # vitest
npm run lint     # oxlint
```

Edge Function 本地调试：`supabase/functions/process-tour/index.ts`（需 Supabase CLI + `.env` 密钥）。

## 密钥

完整密钥表见 `APP-DOCS.md` 开头。注意：查坐标必须用**高德 Web 服务 Key**（非 JS Key，JS Key 会报 `USERKEY_PLAT_NOMATCH`）。

## 会话丢失说明

原会话（9d6c4422）上下文超限，`/compact` 因数学上必败（DeepSeek 模型 completion 配额 131072 + 92万+ 消息 > 104.8万上限）无法恢复，已放弃该会话。代码、数据、git 历史全部完好；完整对话备份在 `~/session-backup-9d6c4422.jsonl`。本文件 + 记忆文件（`wenxue-xunli-app-route-generation.md`）为当前进度权威来源。

---

## 2026-08-06 v70 系列：AI 管线系统性大修（已全部完成并部署至 version 76）

**背景**：嵩山导览（4cdd951e）AI 处理失败 + 用户报告新建导览经常失败、四层内容缺失、路线规则差错。全量审查 847 行 Edge Function 后产出 `docs/AI-PIPELINE-REVIEW.md`（问题清单 + 根因 + 修复 + A/B 实测）。

**嵩山失败根因（已实锤）**：`regionMatch` 不比对 regeo 的 district——地区填"河南登封/河南省登封市"时，regeo 返回 city=郑州市/district=登封市 → 全部地点被拒 → locs=0 → status=error。dry-run 100% 复现。

**测试工具链（重要，后续迭代直接用）**：
- `scripts/dry-run-pipeline.mjs`：完整管线 dry-run（真实 DeepSeek+高德，不写库），`--dest/--region/--mode v69|v70` 双模式 A/B
- `scripts/debug-songshan.mjs`：高德侧 regionMatch 矩阵诊断
- `scripts/test-gaode.mjs`：60+ 单测断言（含 v70 district/锚点用例），全过
- `.env` 现有 `DEEPSEEK_API_KEY`（用户 2026-08-06 提供，可用于本地 dry-run）

**v70 已改（未部署）**：`supabase/functions/process-tour/index.ts`（P0×4+P1×10+P2 全部，见 REVIEW §七）、`ProcessingPhase.jsx`（真实错误原因+4min 超时）、`ai-triggers.sql`（新增 process_error/process_report 列，**部署前先在 SQL Editor 执行**）。esbuild 语法校验 + 前端 build + 单测全过。

**dry-run A/B 结论**：嵩山 v69（河南登封）必败 → v70 同输入 22 点/3 路线/内容 22/22；青城山 v69 day-2 灌县古城 → v70 真后山五龙沟；张家界天门山被离群误杀 → v70 簇感知恢复、武陵源子景点齐。

**部署待办（需用户批准）**：① SQL Editor 跑 ai-triggers.sql（加列）② 部署 process-tour ③ 备份后重新处理嵩山/青城山/张家界做线上 A/B diff。
**已知残留**：金鞭溪/水绕四门 around 扫不到（靠 AI 提议+regionScenics 兜底）；青城山"祖师殿"偶发解析到远点被剔除（同名歧义）；文学巡礼线 stops 全无法 resolve 时静默丢路线（仅告警）。

**2026-08-06 部署完成**：v70 已上线（Edge version 72 = v70.1）。嵩山失败导览已修复（done，19 点四层全齐）；青城山/张家界天门山已重处理，数据备份在 `scripts/out/backup/`。v70.1：路线距离阈值 25→35km / 30→40km（天门山↔武陵源 32km 被挤出路线的线上回归修复）。残留问题见 AI-PIPELINE-REVIEW §八。

**v70.2-v70.4 已上线（version 76）**：卫星景区锚点（青城后山确定性成锚点，修 2日 day-2 偏都江堰）+ stops 保序去重（天门山 1日首末重复）+ 文学巡礼线空回退 + dedup 豁免（黄山 routes 3→4）。验证：青城山/天门山/泰山/黄山 四场景通过，详见 AI-PIPELINE-REVIEW §九。
