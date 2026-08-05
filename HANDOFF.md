# HANDOFF — 工作交接（2026-08-05）

> 原 Claude Code 会话 9d6c4422 因上下文超限无法恢复（见文末「会话丢失说明」）。本文件是当前进度的权威来源，由新会话无缝续接。
> 开工前先跑：`git status` 和 `git diff` 确认未提交改动仍在。

---

## 一句话当前状态

正在实现 **「2日全景游覆盖主景区著名子景点」的确定性关键词方案**：让袁家界 / 金鞭溪 / 十里画廊 / 百龙天梯这类被高德归为「非风景名胜」类型的子景点，能稳定查到坐标并进入路线。
**改动已写好、未提交**（`supabase/functions/process-tour/index.ts`，+16/-6）。

## Git 状态

最近提交（已落盘，按新→旧）：

| 提交 | 说明 |
|---|---|
| `c56b24d` | fix: DeepSeek/高德 fetch 加超时(120s/30s) 防挂死 + 2日主景区覆盖子景点 |
| `8ded175` | feat: 地区合并 AI提议+高德校验 + 2日主景区覆盖著名子景点 |
| `001850b` | feat: 地区景点改用「AI提议知名景点 + 高德校验坐标」合并 |
| `d51fd6a` | feat: 地区并入确定化 — AI只提核心 + 高德锚点周边并入 + 杂点过滤 + 上限20 |
| `6b5e009` | feat: 地区并入上限 6→10 + 地区点互去重 5km→2km |

**未提交改动**：`supabase/functions/process-tour/index.ts` — `gaode()` 函数加了两级兜底：

1. **类型放宽**：先用 `types=风景名胜|旅游景点` 严格查；查不到（袁家界/金鞭溪/十里画廊等被高德归为其他类型）→ 去掉 types 全类型重查。
2. **名称清洗**：`袁家界游客基地/社区` → `袁家界`；`百龙天梯上站` → `百龙天梯`；`十里画廊观光电车售票处` → `十里画廊`。
   清洗正则：`/社区|游客基地|游客中心|观光电车售票处|售票处|上站|下站|集邮点|入口$/`

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

## 下一步（原待决策点）

是否采用**确定性关键词补充**让知名子景点稳定出现 —— 方案已基本实现（即未提交改动）：AI 用知识列出著名子景点（袁家界/金鞭溪/十里画廊/百龙天梯/天子山/黄石寨/杨家界/水绕四门…）→ 高德逐个校验坐标 → 确定性进路线，不靠 AI 编坐标。

待办：
1. **验证未提交改动**：重点测袁家界、金鞭溪、十里画廊、百龙天梯 4 点，确认「严格→放宽」两级查询都返回正确坐标、名称清洗干净（无"游客基地/上站/售票处"等后缀）。
2. 验证通过后 `git commit`。
3. 评估：是否给 `gaodeAroundScenics` 加一份**确定性关键词白名单**（不依赖 AI 提议），确保知名子景点每次都出现。

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
