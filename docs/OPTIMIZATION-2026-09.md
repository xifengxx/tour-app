# 2026-09 优化变更总结

本文记录本次代码结构、稳定性、性能和测试方面的优化。变更均已在本地完成验证，尚未部署到生产环境。

## 这次解决了什么问题

- 修复异步操作失败后仍更新界面、错误信息不清晰的问题。
- 减少地图脚本对首屏的影响，并增加地图加载失败提示和重试能力。
- 统一静态导览配置，避免首页、数据层各自维护一份列表。
- 拆分 `process-tour` Edge Function，降低入口文件复杂度。
- 将路线站点规划从 AI 输出中独立出来，路线组成由确定性代码控制。
- 使用路由级懒加载降低首屏 JavaScript 负载。
- 将账户菜单从公共导航包中延迟加载。
- 增加错误信息、坐标计算和路线规划的自动化测试。

## 前端变更

### 统一静态导览配置

新增 `src/lib/staticTours.js`，集中维护静态导览的 ID、JSON 文件和首页卡片信息。

以下模块改为使用统一配置：

- `src/pages/Home.jsx`
- `src/hooks/useTourData.js`
- `src/lib/data.js`

这样新增或调整静态导览时只需要修改一个配置源。

### 地图脚本改为按需加载

新增 `src/lib/amap.js`，负责：

- 动态加载高德 JS API。
- 复用同一个加载 Promise，避免重复插入脚本。
- 支持 `VITE_AMAP_KEY` 和 `VITE_AMAP_SECURITY_CODE` 环境变量。
- 加载超时后清理状态，允许用户再次重试。

地图页面和地图搜索弹窗都使用这个加载器。`index.html` 不再直接写入高德脚本和安全码。

### 页面路由懒加载

`src/App.jsx` 使用 `lazy` 和 `Suspense` 按路由加载：

- 首页
- 导览详情
- 导览编辑
- 登录页

构建结果从单个约 672KB 的主 JS 包变为约 441KB 主包，并生成页面级独立 chunk。

导航栏中的账户下拉菜单进一步拆到 `src/components/UserMenu.jsx`，只在登录用户打开导航时加载。`NavBar` chunk 约 34KB，账户菜单和 Radix 下拉菜单依赖单独加载。

### 字体样式异步加载

思源宋体 500/700 两个字重的 `@font-face` 声明（按 unicode-range 分片后约 98 组）原本内联在主样式表中，导致主 CSS 达约 290KB。

现拆分为独立的 `src/fonts.css`，由 `src/main.jsx` 动态导入，Vite 构建为异步加载的独立 chunk：

- 主 CSS：约 290KB → 约 47KB（gzip 约 117KB → 约 9KB），首屏渲染不再被字体声明阻塞。
- 字体 CSS（约 243KB，gzip 约 108KB）与页面渲染并行加载，浏览器仍按 unicode-range 只下载实际用到的字体切片。

### 交互和错误处理

- 新增 `src/lib/errorMessage.js`，统一提取 Supabase 和普通 Error 的可读错误信息。
- 评论、分享、编辑、删除等操作只有在请求成功后才更新界面。
- 修正部分 Hook 依赖和定时器清理。
- 地图增加加载失败状态、超时提示和容器尺寸修复。
- 移动端路线栏增加横向滚动提示。
- Noto Serif SC 字体权重从 500/600/700/900 收敛为 500/700。
- 评论、分享和地图搜索弹窗补充 `role="dialog"`、`aria-modal`、标题关联和输入标签。

## Edge Function 结构变更

`supabase/functions/process-tour/index.ts` 现在主要负责流程编排。辅助职责分布如下：

| 文件                  | 职责                                      |
| --------------------- | ----------------------------------------- |
| `config.ts`           | 环境变量和 Supabase 请求头                |
| `http.ts`             | CORS、JSON 响应、状态写入、批量数据库操作 |
| `ai.ts`               | DeepSeek 请求、重试、截断处理、有界并发   |
| `gaode-search.ts`     | 高德文本搜索和地区景点查询                |
| `gaode-scan.ts`       | 地点名称清洗和周边景点扫描                |
| `gaode-validation.ts` | 高德逆地理编码坐标校验                    |
| `geo.ts`              | `haversineM` 坐标距离计算                 |
| `routes.ts`           | 确定性路线站点规划                        |
| `anchors.ts`          | 景点锚点、子景点和景区归属处理            |

### 行为保持不变的部分

本次模块拆分没有改变以下业务规则：

- 高德城市偏置和裸省名处理。
- 高德限流重试和地点名称匹配规则。
- 子景点过滤、距离去重和锚点合并阈值。
- 1 日、2 日、主题游的路线组成规则。
- DeepSeek 的提示词、模型、重试次数和超时策略。

### 路线规划规则

路线站点组成由 `routes.ts` 确定性计算：

- 1 日精华游：核心景区高重要性地点，最多 8 个。
- 2 日全景游：核心景区加主景区/后山地点，并按距离过滤。
- 主题游：核心热门地点加地区景点聚类代表。
- 文学巡礼线：保留 AI 自由组织能力。

AI 仍然负责路线文案和站内排序，但不能随意增加或删除代码确定的站点集合。

## 测试和构建结果

本次本地验证结果：

- `npm test -- --run`：12 个测试文件，51 个测试全部通过（含高德限流重试/耗尽、数据库写入失败、状态写入容错等异常路径测试）。
- `npm run build`：构建通过。
- `npm run lint`：通过，仅保留已有警告。
- `git diff --check`：通过。

已通过 `brew install deno` 安装 Deno 2.9.6，`deno check supabase/functions/process-tour/index.ts` 通过。该检查发现并修复了 7 个类型错误：

- 补齐 `GAODE_KEY`、`cors` 两处缺失导入（`cors` 改为从 `http.ts` 导出）。
- 省份匹配函数返回值类型修正（避免 `string | boolean`）。
- 路线站点映射处 3 处 `filter(Boolean)` 改为类型谓词过滤，消除 `string | undefined` 泄漏。
- 移除 `plans.map((plan: any, ...)` 的多余 `any` 标注，恢复路线类型推断。

本地 production preview 已确认 `/` 和 `/tour/demo` 均返回 200，SPA 深链接兜底正常。

### 生产部署（已完成）

本机 Supabase CLI 的 npm 安装损坏（平台二进制缺失），改用 Homebrew 安装 CLI 2.116.0 后完成部署：

- 前端：推送 GitHub 后 EdgeOne Pages 自动构建，线上已确认加载新构建产物，`/tour/demo` 返回 200。
- Edge Function：`supabase functions deploy process-tour` 部署成功（版本 77，9 个模块全部上传），线上冒烟测试返回预期的 `{"error":"Missing tourId"}` 400 响应。

## 仍需处理的事项

1. ~~在 Deno 环境中执行 Edge Function 类型检查。~~（已完成，`deno check` 通过）
2. ~~为高德限流、DeepSeek 非法 JSON、地图加载失败和创建失败补充更完整的集成测试。~~（单元级异常路径测试已完成；涉及真实外部服务的端到端集成测试仍待线上环境验证）
3. ~~对 `NavBar` 等公共 chunk 继续分析，确认是否存在可延迟加载的图标或地图依赖。~~（已拆分 UserMenu；图标与地图依赖已确认不在公共 chunk 中）
4. 用黄山、泰山、三清山等非张家界样例做一次线上前后结果对比。
5. ~~完成部署前的 Supabase Edge Function 和生产站点验证。~~（已完成部署并通过线上冒烟测试）

## 相关文件

- [项目开发文档](../APP-DOCS.md)
- [AI 自动处理文档](./AI-AUTO-PROCESSING.md)
- [AI 管线审查报告](./AI-PIPELINE-REVIEW.md)
- [设计规范](../DESIGN.md)
