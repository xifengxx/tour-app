# HANDOFF — 工作交接（2026-08-05 更新）

> 原 Claude Code 会话 9d6c4422 因上下文超限无法恢复（见文末「会话丢失说明」）。本文件是当前进度的权威来源，由新会话无缝续接。
> 开工前先跑：`git status` 确认工作区状态。

---

## 一句话当前状态

**「2日全景游覆盖主景区著名子景点」方案已完成并提交**：`gaode()` 坐标查询重构（名称重叠过滤 + 无匹配才放宽兜底 + 限流重试 + 名称多轮清洗），实测 8 个核心子景点全部解析成功。**下一个开放项：端到端实测真实 2 日路线，确认 AI 提议覆盖率**（决定是否接线 `gaodeAroundScenics` 兜底）。

## Git 状态

最近提交（已落盘，按新→旧）：

| 提交 | 说明 |
|---|---|
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

1. **端到端实测**（最重要）：部署 `process-tour` 到 Supabase（`npx supabase functions deploy process-tour --project-ref qxunedraoviaonjdanag --no-verify-jwt`），建一条真实 2 日导览跑一遍，确认：
   - AI 是否稳定提议全部著名子景点（袁家界/金鞭溪/十里画廊/百龙天梯/天子山/黄石寨/杨家界/水绕四门）→ 决定是否接线 `gaodeAroundScenics` 兜底。
   - 武陵源不再出现「同坐标重复」（此前实测武陵源风景名胜区与张家界国家森林公园同坐标）。
2. **`gaodeAroundScenics` 接线（按需）**：如 AI 偶发漏列子景点，把现有死代码 `gaodeAroundScenics(lng,lat)`（index.ts:85，高德周边扫描，目的地无关）接为主景区锚点确定性补全。**不做硬编码白名单**（不通用）。
3. **环境问题**：AuraKit build-verify hook 每次编辑都报缺 `tsc@2.0.3`（`npx canceled due to missing packages`）—— 需要装 tsc 或修 hook，当前是噪音不影响功能。

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
