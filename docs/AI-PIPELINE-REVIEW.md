# AI 自动处理管线 — 系统性审查报告

> 日期：2026-08-06 ・ 审查对象：`supabase/functions/process-tour/index.ts`（v69，847 行全量）+ 触发器/前端轮询链路
> 方法：全量代码阅读 + 嵩山失败场景高德侧本地复现（`scripts/debug-songshan.mjs`）

---

## 一、结论摘要

管线整体架构（确定性规划 + 外部校验层）是对的，v10-v69 的修复方向也对。但仍有 **3 个会直接导致"AI 处理失败"的硬伤**、**1 个导致"卡住死等"的硬伤**，以及若干结果质量问题。嵩山导览失败的根因已用真实高德数据实锤（见 §2.1）。

| # | 严重度 | 问题 | 证据 |
|---|--------|------|------|
| P0-1 | 🔴 | `regionMatch` 从不比对 **district（县级市/区县）**：用户地区填"河南登封/河南省登封市/登封市"时，全部地点被误判"不在目标地区" → `locs=0` → throw → `status=error` | index.ts:390-424, 548-551；复现见 §2.1 |
| P0-2 | 🔴 | `deepseek()` 对 **HTTP 错误（429/5xx/超时）不重试**，只对 JSON 解析失败重试；高峰期 6-7 路并发 DeepSeek 调用，任一 429 即全链路崩 | index.ts:437-457 |
| P0-3 | 🔴 | 内容生成 `CONTENT_CHUNK=8` × 每层 150-250 字，单 chunk 输出逼近 `max_tokens=8192` → 截断 JSON → 解析重试 3 次大概率仍截断 → throw 全链路崩 | index.ts:442, 717-731 |
| P0-4 | 🔴 | **失败原因不落库**：catch 只把 `e.message` 返回给 pg_net 触发器（被丢弃），前端只能显示"服务器端出错" | index.ts:836-840 |
| P1-1 | 🟠 | **卡死无出口**：GAODE_KEY 缺失/Tour not found 早退不置 error；worker 被平台硬杀也不置 error → `status` 永远 processing，前端无超时，无限转圈 | index.ts:482-487；ProcessingPhase.jsx 无总超时 |
| P1-2 | 🟠 | 内容层缺失：DeepSeek 返回的 `id` 与 loc 对不上（改名/漏点）时**静默丢内容**，无按名兜底、无完整性检查、无补生成 | index.ts:730, 798-802 |
| P1-3 | 🟠 | 地区合并对大城市召回不加景点过滤，会把"二七广场/方特/动物王国"类并入导览；且上游 AI 提议不确定 → 路线组成逐次漂移（青城山 2日 day-2 抽到都江堰即此因） | index.ts:587-638；复现 §2.2 |
| P2 | 🟡 | 路线/提取用 temperature=0.7 全量不确定；`mainPool` 距离过滤全有或全无；路线 stops 顺序无确定性地理排序；提取文本截断 6000 字 | 见 §4 |

### 测试中追加发现的问题（dry-run A/B 实测，均已纳入 v70）

| # | 问题 | 实测证据 |
|---|------|---------|
| P1-5 | **锚点泛化**：`isScenicAnchor` 对 destName 只做子串匹配 → "中国嵩山卢崖瀑布/嵩山世界地质公园科普广场/青城山索道"全成锚点，景区归属被打碎，**corePool 只剩 1 点 → 1日精华游只有 1 站** | 嵩山 v70 首轮实测（加 gaode 兜底后暴露） |
| P1-6 | 地区合并把**目的地自身/别名**（"嵩山国家重点风景名胜区"）并入当"地区景点"混进主题游 | 嵩山实测 |
| P1-7 | `pruneFarPoints` 中位数离群剔除**误杀合法远景区簇**：天门山+天门洞（距武陵源 35km，2 点簇）被当幻觉点剔除 | 张家界 v70 首轮实测 |
| P1-8 | 高德 **CUQPS 限流**在并发下 2×300ms 重试不够 → 天子山/袁家界等**随机丢点**（同一输入两次运行结果不同） | 张家界 v70 首轮 7/14 通过 vs 修后 13/14 |
| P1-9 | AI 提议点无过滤 → "老院子饭庄（永定大道）""普光禅寺（公交站）"直接并入导览 | 张家界 v70 首轮实测 |
| P1-10 | 地区合并正向字符过滤（初版 P1-3 方案）**误杀无景点特征字的真名胜**：都江堰/灌县古城/街子古镇 → 改为负向过滤（AMUSE/JUNK/FACILITY） | 青城山 v70 首轮实测 |

---

## 二、实锤复现

### 2.1 嵩山失败根因（P0-1）— 已复现

`node scripts/debug-songshan.mjs` 用真实高德 API 模拟 12 个嵩山典型景点（少林寺/塔林/三皇寨/中岳庙/嵩阳书院/峻极峰/卢崖瀑布/观星台/会善寺/永泰寺/太室山/少室山）：

| 用户填写的"地区" | 通过 | 被拒 | 结果 |
|---|---|---|---|
| 河南省郑州市 / 郑州市 / 河南 | 12 | 0 | ✅ 正常 |
| **河南登封 / 河南省登封市 / 登封市** | **0** | **12** | 🔴 locs=0 → throw → status=error |

regeo 对少林寺返回 `province=河南省, city=郑州市, district=登封市`。`regionMatch` 只拿 `city`（郑州市）去比对用户输入的"登封"，永不命中 → 12 个点全部"不在目标地区"被拒 → 触发 index.ts:550 的防御性 throw。**用户看到的只是"服务器端出错"，真实原因是地区写法无法匹配。**

修复：regeo 已返回 `district`，`regionMatch` 的 cityPart 比对候选加入 `district` 即可（同时覆盖"省+县级市"、"裸县级市"写法）。

### 2.2 地区合并质量（P1-3）— 已复现

`regionScenics("郑州市")` 召回 30 个：二七广场、银基动物王国、方特、郑州站西广场、电影小镇、海洋馆…… 地区合并只做 `>5km / ≤60km` 距离过滤，**无景点性质过滤**。嵩山导览会并入伏羲山/始祖山/神仙洞/巩义石窟寺等（≤60km），locs 膨胀到 30+ → 内容 chunk 数增加 → 加剧 P0-3 截断风险，且主题游混入无关点。

---

## 三、失败链路逐项分析（为什么会 status=error）

主流程 try/catch 是**全有或全无**粒度：任何一处 throw → catch → `setStatus(error)`。可 throw 的点：

1. **提取 DeepSeek 失败**（:508）— HTTP 错误不重试（P0-2）
2. **locs=0 防御性 throw**（:550）— 地区写法不匹配（P0-1，嵩山实锤）；或 AI 幻觉名单全被拒
3. **内容 chunk DeepSeek 失败**（:723-729 在 Promise.all 内）— 截断/429，一个 chunk 炸全链路炸（P0-2/P0-3）
4. **路线 DeepSeek 失败**（:737）— 同上
5. **写库失败**（:806-816）— postRows/deleteRows 对 4xx/5xx throw

以及**不会置 error 但更糟**的：
6. :482/:487 早退 return（GAODE_KEY 缺失、Tour not found）→ status 永远 processing
7. worker 被平台资源限制硬杀（实测 58-65s，逼近上限；单路 DeepSeek 超时设了 120s，超过 worker 预算）→ status 永远 processing，前端无总超时 → **无限转圈**

---

## 四、修改建议（按优先级）

### P0 — 修"经常失败"（本次必须）

**P0-1 `regionMatch` 支持 district**（index.ts:390）
```ts
function regionMatch(geo: { province: string; city: string | string[]; district?: string }, targetRegion: string): boolean {
  // ...
  const gDistrict = String(geo.district || "");
  if (cityPart) {
    const tCityCands = [cityPart, stripSuffix(cityPart)];
    // 县级市/区县写法（"河南省登封市"、"登封市"、"河南登封"）：regeo 的 city 是上级市（郑州市），
    // 必须同时拿 district（登封市）做候选
    return tCityCands.some(tc => tc && (
      gCityCand.includes(tc) || tc.includes(stripSuffix(gCityCand)) ||
      gDistrict.includes(tc) || tc.includes(stripSuffix(gDistrict))
    ));
  }
  // 裸名路径同样加 district 候选
```
同步更新 `scripts/test-gaode.mjs` 镜像与单测（"河南登封↔郑州市登封市 → 匹配"）。

**P0-2 `deepseek()` 全类型错误重试 + 退避**（index.ts:437）
- HTTP !ok（429/5xx）、空内容、超时、网络错误 → 与 JSON 解析失败同等重试，指数退避 1s/3s/8s
- 单路超时 120s → 60s（Edge worker 预算内）
- 并发降到 3（`mapLimit(chunks, 3)`），避免自我触发 429
- temperature 参数化：提取/路线 0.2（要稳定），内容 0.7（要文采）

**P0-3 内容 chunk 防截断**
- `CONTENT_CHUNK` 8 → 5
- 检查 `choices[0].finish_reason === "length"` → 该 chunk 自动拆半重试
- 或 prompt 收紧："每层 120-180 字"（字数上限降下来，8192 token 足够 8 点，但 5 点更稳）

**P0-4 失败原因与告警落库**
```sql
ALTER TABLE tours ADD COLUMN IF NOT EXISTS process_error TEXT;
ALTER TABLE tours ADD COLUMN IF NOT EXISTS process_report JSONB;
```
- catch 里 `setStatus(error)` 同时写 `process_error = e.message`
- 成功时写 `process_report = { locations, routes, warnings, rejected, deduped }`
- 前端 ProcessingPhase 失败页展示真实原因（如"地区「登封市」无法匹配任何地点，请改为「河南省郑州市」"）；审核页展示 warnings（哪些点被拒/去重/补齐）

### P1 — 修"结果质量 + 卡死"

**P1-1 卡死出口**：所有早退路径置 error；前端 ProcessingPhase 加 4 分钟总超时 → 提示"处理超时，请重试"；可选 DB 侧 cron 把 >10 分钟的 processing 置 error。

**P1-2 内容完整性兜底**（index.ts:716-802）
- chunk 结果按 id 匹配不上时，再按 **name 精确/包含** 兜底匹配
- 全部 chunk 完成后统计"无内容 locs"→ 单点重试补生成（最多 1 轮）；仍无 → 记 warning，**不阻断**
- 内容生成改用 `Promise.allSettled` 语义：单 chunk 失败 → 该 chunk 8 点记 warning 并单点重试，不再全链路崩

**P1-3 地区合并过滤**
- `regionScenics` 召回套用 `gaodeAroundScenics` 同款 ATTRACTION 正向过滤 + JUNK 负向过滤（杀 二七广场/方特/海洋馆/车站）
- AI 提议名单与 regionScenics 合并后按"距核心 ≤30km"优先、30-60km 次优排序，cap 收紧到 12
- 地区合并并入点 importance 4 → 3（不该压过核心点）

### P2 — 路线与一致性增强

- **planRoutes `mainPool` 距离过滤改为逐点过滤**（:306）：`mainPool = mainPool.filter(nearCore 25000)`，一个远点不再团灭整个后山池
- **stops 顺序确定性**：allow 路线在 AI 排序基础上做最近邻重排（从距入口/核心质心最远端起步），AI 乱序不再传导到地图
- **narrative 错位防护**（:750）：day_label 匹配失败且下标回退的 narrative 若与 plan.allow 站点名重合度 <50% → 弃用该 narrative 重生成，避免"2日 narrative 讲着都江堰"
- **routes 空结果处理**：plans 全部 stops=0（corePool 为空）时记 warning 并置 error（"有效地点不足以规划路线"），不静默成功
- **提取下限**：`locs.length < 3` 也走 error（同 P0-1 的提示），避免"成功但只有 1 个点"
- **提取/参考文本**：`src.slice(0, 6000)` → 12000（DeepSeek 上下文足够），内容参考 4000 → 6000
- **核心景区子景点扫描**：`scanAnchors` 目前跳过核心锚点（:645），嵩山这类"核心即全部"的导览，子点全靠 AI 提取；建议核心锚点也扫描（cap 内），与 AI 提取并集
- **文学巡礼线**：自由选点全无法 resolve 时路线被静默丢弃（:782），应记 warning

---

## 五、测试方案（修复后 A/B 对比）

**前置**：备份目标导览当前 `locations`/`routes`（公开导览 anon key 可读）→ 部署 v70 → 触发重新处理 → diff 新旧数据。

| 导览 | 选它的理由 | 对比点 |
|---|---|---|
| **嵩山**（当前 error） | P0-1 实锤案例 | 修复前必然失败；修复后应产出 12+ 地点、四层内容齐、1日/2日路线合理 |
| **青城山** | 已知遗留：2日 day-2 抽到都江堰/灌县古城 | P2 mainPool 逐点过滤 + P1-3 后，day-2 应为青城后山/五龙沟/白云万佛洞 |
| **张家界** | 最复杂景区（伞形锚点+子景点扫描+地区合并） | 回归测试：武陵源 8 大子景点不丢、七星山/黄龙洞不混入 2日、四层内容齐 |
| **泰山或黄山**（单景区） | 单景区导览未回归过 | corePool 单一、无地区合并时路线不空、内容不截断 |

**离线单测**（不需要 DeepSeek key）：扩充 `scripts/test-gaode.mjs` / `debug-songshan.mjs`：regionMatch district 矩阵、planRoutes 嵩山/泰山 mock、normalizeLayers 数组场景。

**线上对比需要的前置条件**：DeepSeek key 只在 Edge Function secrets 里，本地无法跑完整管线 → A/B 只能走"部署 → 重新处理"路径（用户已授权对已发布导览测试，但仍建议先备份数据再操作）。

---

## 六、A/B 测试结果（dry-run 双模式管线，`scripts/dry-run-pipeline.mjs`）

> 方法：完整镜像 Edge Function 主流程（真实 DeepSeek + 高德调用，不写库），v69=线上逻辑镜像 / v70=修复版，同输入对比。
> 报告 JSON 存于 `scripts/out/*.json`。

### 嵩山（用户报告的失败导览场景）

| 运行 | 输入 | 结果 |
|------|------|------|
| v69 | 地区=**河南登封** | 🔴 **复现线上失败**：AI 提取 14 候选 → regionMatch 全拒（12 个"位于河南省郑州市登封市，不在河南登封"）→ locs=0 → throw → status=error |
| v69 | 地区=河南省郑州市（"规范"填法基线） | ✅ 但质量差：1日仅 6 站且首站是"嵩山国家重点风景名胜区"（伞形别名当站点）；**中岳庙/太室山/峻极峰缺失**；2日 day-2 混入前山的嵩阳书院；主题游含"港中旅嵩山景区"商业 POI |
| v70 | 地区=**河南登封**（同样输入） | ✅ **22 地点 / 3 路线 / 四层内容 22/22**：1日=嵩阳书院→中岳庙→嵩岳寺塔→太室山→峻极峰→少室山→少林寺→会善寺（8 站合理动线）；2日 day-2=少室山侧；达摩洞被正确识别为洛阳偃师错点拒绝 |

### 青城山（已知 2日 day-2 错误案例）

| 运行 | 结果 |
|------|------|
| v69 | 2日 day-2 = 建福宫/索道/**都江堰/灌县古城/普照寺/街子古镇**（用户已知问题复现）；"青城山索道"成锚点致建福宫归属错误跌出 1日 |
| v70 | 2日 day-2 = **泰安古镇/五龙沟（真后山）**；主题游正确含都江堰；建福宫回归 1日首站；四层内容 12/12 |

### 张家界（最复杂景区回归）

| 运行 | 结果 |
|------|------|
| v70 首轮 | 暴露 P1-7/8/9：天子山/袁家界限流丢点、天门山被离群剔除、饭庄/公交站混入 |
| v70 终版 | ✅ 21-22 地点 / 3 路线 / 四层内容 21/21：武陵源全子景点齐（金鞭溪/水绕四门/百龙天梯/袁家界/杨家界/鹞子寨），**天门山+天门洞被簇感知恢复**，2日=金鞭溪→水绕四门→百龙天梯→袁家界→杨家界→天子山经典环线；大峡谷孤立远点剔除（规则内） |

### 结论

- 嵩山失败根因（P0-1 district）100% 复现且 v70 同输入修复；v70 在"规范填法"下质量也显著优于 v69。
- 所有 v69 能成功的场景，v70 结果质量持平或显著更好；v69 失败的场景，v70 成功。
- 单测：`scripts/test-gaode.mjs` 60+ 断言全过（含新增 district/锚点收严用例）。

## 七、v70 已实施的改动清单（待部署）

- `supabase/functions/process-tour/index.ts`：本报告 P0-1~P0-4、P1-1~P1-10、P2（mainPool 逐点过滤、温度分层、文本上限）全部落地
- `src/components/ProcessingPhase.jsx`：失败页展示 `process_error` 真实原因；4 分钟总超时防无限死等；列缺失时降级轮询
- `supabase/ai-triggers.sql`：新增 `process_error TEXT` / `process_report JSONB` 列（**部署前需先在 SQL Editor 执行**）
- `scripts/test-gaode.mjs` / `scripts/dry-run-pipeline.mjs` / `scripts/debug-songshan.mjs`：镜像与测试工具
- 部署后验证路径：备份嵩山/青城山/张家界当前数据 → 重新处理 → diff 新旧 locations/routes
