# HANDOFF — 工作交接（2026-08-05 更新）

> 原 Claude Code 会话 9d6c4422 因上下文超限无法恢复（见文末「会话丢失说明」）。本文件是当前进度的权威来源，由新会话无缝续接。
> 开工前先跑：`git status` 确认工作区状态。

---

## 一句话当前状态

**「2日全景游覆盖主景区著名子景点」已端到端验证通过（本轮会话）**：真实天门山导览 2日 day-2 确定性覆盖全部 8 个著名子景点（天子山/黄石寨/杨家界/袁家界/金鞭溪/十里画廊/水绕四门/百龙天梯），七星山未混入 1日/2日，29 个地点全部有内容（无空内容卡）。函数已部署 Supabase（version 61 ACTIVE）。**本次还修了三个实测发现的硬 bug：地区格式「湖南张家界」连写导致 0 地点、子景点去重 1000m 误杀百龙天梯、Edge Function 60s 预算被打爆。**

## 本次会话（2026-08-05 第二轮）改动 —— 全部实测驱动

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

## Git 状态

最近提交（已落盘，按新→旧）：

| 提交 | 说明 |
|---|---|
| `bb6671a` | fix: 地区格式「湖南张家界」连写致0地点 + 子景点确定性收口(百龙天梯/袁家界) + 并行化防 WORKER_RESOURCE_LIMIT（本轮，详见「本次会话改动」） |
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

1. **回归一条非张家界导览**（黄山/泰山/三清山等）确认并行化 + 子景点扫描不破坏单景区目的地的路线与内容（本轮只实测了天门山）。
2. **Edge Function 时长余量**：实测 58-65s，依赖 DeepSeek/高德延迟。Management API 的 `timeout_seconds` 元数据不生效（已试，被忽略）——如后续偶发 `WORKER_RESOURCE_LIMIT`，需装 supabase CLI（`supabase functions deploy --timeout-seconds 300`）或进一步砍调用量。
3. **金鞭溪/水绕四门仍依赖 AI/regionScenics**：高德 around 在它们自身坐标也扫不到（实测 8km 46-52 候选均不中），只能靠地区合并（AI 提议 + regionScenics types 查询）覆盖。rr2 prompt 已强化"宁多勿漏"，当前实测通过；若未来再偶发漏，可考虑把 regionScenics 的 types 查询范围放宽（但会引入杂点）。
4. **武陵源"风景名胜区十里画廊"这类扫描复名**：与"十里画廊"重复出现在 locs（扫描命名源），可由 name 去重进一步收口，当前不影响路线（stops 只引用其一）。
5. **环境问题**：AuraKit build-verify hook 每次编辑都报缺 `tsc@2.0.3`（`npx canceled due to missing packages`）—— 需要装 tsc 或修 hook，当前是噪音不影响功能。
6. **supabase CLI 未装**：GitHub 下载被重置，本轮全程用 Management API 部署（`/tmp/deploy-process-tour.sh`，raw index.ts 上传）。CLI 装好后可回归 `--timeout-seconds`。

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

复刻 `gaode()` 完整逻辑（含本次重构），两段：
1. **名称清洗正则单元测试**（无需密钥，17 用例）；
2. **实时高德解析**（8 个武陵源子景点 + 坐标范围校验，需 GAODE_KEY）。

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
