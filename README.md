# 文学巡礼 (Literary Tour)

带着小说去旅行，在每一处山崖找到书中的江湖。

## 简介

文学巡礼是一个基于 React 的文学/文化旅游导览 Web 应用。用户创建导览 → 提供小说文本或历史资料 → AI 自动提取地点、查找坐标、生成四层内容（文学意境 / 历史掌故 / 民间传说 / 地域文化）→ 规划真实徒步路线 → 生成可交互的高德地图导览。

## 快速开始

```bash
npm install
npm run dev        # http://localhost:5173
```

## 技术栈

| 层   | 技术                                              |
| ---- | ------------------------------------------------- |
| 前端 | React 19 + Vite + Tailwind CSS 4                  |
| 地图 | 高德 JS API v2.0 (GCJ-02)                         |
| 后端 | Supabase (PostgreSQL + Auth)                      |
| AI   | DeepSeek API + Supabase Edge Function（自动处理） |

## 部署

| 环境           | 地址                            | 说明                                                      |
| -------------- | ------------------------------- | --------------------------------------------------------- |
| **生产（主）** | **https://tour.xifengxx.vip**   | EdgeOne Pages 国际站，自定义域名，免备案，国内免 VPN 直连 |
| 旧部署（备用） | https://tour-app-pro.vercel.app | Vercel 托管，国内需 VPN（`*.vercel.app` 被 GFW 阻断）     |

EdgeOne Pages 接入 GitHub 仓库自动部署（push 即构建）。构建设置：命令 `npm run build`、输出目录 **`dist`**；SPA 路由兜底由根目录 [`edgeone.json`](./edgeone.json) 配置（`/.*` → `/index.html`）。EdgeOne 构建环境需配置 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` 两个环境变量。

## 项目结构

```
tour-app/
├── src/
│   ├── pages/          # 页面组件
│   │   ├── Home.jsx        # 首页（导览列表）
│   │   ├── TourView.jsx    # 导览浏览（地图+内容卡片）
│   │   ├── TourEdit.jsx    # 导览创建/编辑（AI 辅助向导）
│   │   └── Login.jsx       # 登录/注册
│   ├── components/     # 可复用组件
│   ├── contexts/        # AuthContext
│   ├── hooks/           # useTourData
│   └── lib/             # Supabase、地图、静态数据和错误处理工具
├── supabase/functions/process-tour/
│   ├── index.ts         # Edge Function 流程编排
│   ├── ai.ts            # DeepSeek 请求与并发控制
│   ├── gaode-search.ts  # 高德文本和地区景点查询
│   ├── gaode-scan.ts    # 周边景点扫描和名称清洗
│   ├── anchors.ts       # 景区锚点和子景点归属
│   └── routes.ts        # 确定性路线规划
├── public/data/         # 静态导览 JSON（衡山、华山）
├── scripts/             # 数据导入脚本
│   └── insert-tour.mjs      # 标准化 Supabase 写入脚本
├── APP-DOCS.md          # 开发文档（完整流程、密钥、故障排查）
├── DESIGN.md            # 设计规范（Claude/Anthropic 风格：羊皮纸+陶土+衬线）
└── supabase-migration.sql
```

## 开发文档

详细流程见 **[APP-DOCS.md](./APP-DOCS.md)**，包括：

- 密钥配置
- 新增导览（自动化流程）
- AI 自动处理架构：**[docs/AI-AUTO-PROCESSING.md](./docs/AI-AUTO-PROCESSING.md)**
- 数据写入方法对比
- 常见问题与解决方案
- 本次优化记录：**[docs/OPTIMIZATION-2026-09.md](./docs/OPTIMIZATION-2026-09.md)**
- 安全与已接受风险：**[SECURITY.md](./SECURITY.md)**
- 设计规范（Claude 风格）：**[DESIGN.md](./DESIGN.md)**
