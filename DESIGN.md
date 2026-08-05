# 文学巡礼 · 设计规范（DESIGN.md）

> 全站视觉风格：**「纸上山河」**（古籍装帧 × 编辑排版：宣纸底、墨色字、朱砂印、黛青辅）。
> 2026-08 由「Claude/Anthropic 羊皮纸 + 陶土」重构而来。品牌签名元素：**朱砂印章**（logo / 状态戳 / 收藏盖印）。

---

## 改版进度

| 阶段 | 范围 | 状态 |
|------|------|------|
| Phase 0 地基 | index.css token + Noto Serif SC + 纸纹/印章/竖排工具类 | ✅ 完成 |
| Phase 1 门面 | NavBar（朱印 logo）+ Home（hero + 书页卡）+ Login | ✅ 完成 |
| Phase 2 核心 | TourView（RouteBar / ContentCard / 底部手卷 / DetailModal）+ 路线国画五色 | ✅ 完成 |
| Phase 3 收尾 | TourEdit/Review、其余弹窗、研墨展卷等待动画 | ✅ 完成 |

> Phase 3 已落地：ProcessingPhase「研墨展卷」等待动画（朱印呼吸 + 墨线流动 + 竖排装饰）；步骤指示器改壹贰叁篆刻；saveMsg 类型化（去 ✅❌ emoji 判断）；海报/二维码/地图搜索弹窗色值同步新色板；全站 emoji 图标清零（内容数据中的 layer icon 除外）。触摸目标基线 36-44px 沿旧布局保留。

> Phase 2 已落地：路线五色与标记色统一为国画色系（`src/lib/routeColors.js` 共享常量）、底图换 `amap://styles/whitesmoke`、底部卡片手卷化（卷轴杆拉手 + 壹贰叁编号地点条 + 卷首语楷体 narrative）、ContentCard/DetailModal 批注式排版（朱色章节小标 + 藤黄「」楷体引文）、ContentCard 暗色残留修复、DetailModal 补上扁平 layers 兼容（旧 bug）。

## 1. 视觉定位

亮色、暖调、编辑式排版。像一册正在展开的游记手卷：宣纸纹理、克制留白、低饱和国画色系。
- **不**做暗色模式（地图页也用亮色，与高德 normal 亮底图一致）
- 强调色以朱砂为主、黛青为辅，避免多色冲突（尤其地图标记）
- UI 图标一律 lucide SVG，**不用 emoji**

## 2. 色板（`src/index.css` @theme 实际值）

| Token | 值 | 用途 |
|-------|-----|------|
| `--color-background` | `#f7f3ea` | 页面底 · 宣纸 |
| `--color-foreground` | `#1c1a16` | 正文 · 墨色 |
| `--color-card` | `#fbf8f0` | 卡片 · 笺纸 |
| `--color-card-foreground` | `#1c1a16` | 卡片文字 |
| `--color-primary` | `#c2402a` | 朱砂 · 主按钮 / 选中 / 印章 |
| `--color-primary-foreground` | `#fdf9f0` | 主按钮文字 |
| `--color-secondary` | `#ede7d7` | 次级底 · 暖沙 |
| `--color-secondary-foreground` | `#1c1a16` | |
| `--color-muted` | `#f0ebdd` | 弱底 |
| `--color-muted-foreground` | `#6b655a` | 次要文字 · 暖灰 |
| `--color-accent` | `#ede7d7` | |
| `--color-accent-foreground` | `#1c1a16` | |
| `--color-destructive` | `#a83226` | 错误 |
| `--color-border` | `#ddd4c0` | 边框 · 暖 |
| `--color-input` | `#d5cbb4` | 输入框 |
| `--color-ring` | `#c2402a` | 焦点环 |
| `--radius` | `0.5rem` | 圆角（收敛，编辑感） |

**国画辅色**（Tailwind 类 `*-dai` / `*-ochre` / `*-pine` / `*-gamboge`）：

| Token | 值 | 用途 |
|-------|-----|------|
| `--color-dai` | `#2f4f4a` | 黛青 · 链接/信息/第二强调 |
| `--color-ochre` | `#9c6b3c` | 赭石 · 路线色 |
| `--color-pine` | `#5b7a5e` | 苍绿 · 路线色/成功态 |
| `--color-gamboge` | `#c9973f` | 藤黄 · 路线色 |

**路线五色**（Phase 2 替换 TourView/RouteBar 的 `ROUTE_COLORS`）：朱砂 `#c2402a` / 黛青 `#2f4f4a` / 赭石 `#9c6b3c` / 苍绿 `#5b7a5e` / 藤黄 `#c9973f`——与全站同源，替代旧彩虹五色。

**语义色**：成功/已发布优先 `pine` 系；引文/反思块沿用 `gamboge` 系左描边 + 暖墨文字 `#7a6a4f`。

## 3. 字体（`src/index.css` @theme）

| Token | 值 | 用途 |
|-------|-----|------|
| `--font-sans` | 系统栈（PingFang SC 等） | 正文 |
| `--font-serif` | `"Noto Serif SC", "Songti SC", STSong, Georgia, serif` | **标题/地点名/引文** |
| `--font-kai` | `"Kaiti SC", STKaiti, KaiTi, "Noto Serif SC", serif` | 批注/副标语（手账感） |

- Noto Serif SC 通过 `@fontsource/noto-serif-sc` 本地打包（500/600/700/900），unicode-range 分片，浏览器只下载用到的切片；**不走 Google Fonts CDN**（国内不稳定）。
- 规则不变：衬线只用于标题与引文，正文一律 sans。

## 4. 装饰语言（`src/index.css` 全局类）

| 类 | 效果 |
|----|------|
| `.seal` | 实心朱印（logo）：朱砂方印 + 白字 + 微旋转 -2° + 内描边 |
| `.seal-outline` | 线框印戳（如「已发布」）：1.5px 朱色描边 + 旋转 -3° |
| `.vertical-rl` | 竖排文字（`writing-mode` + 字距 0.35em）：首页副标、侧签 |
| `.double-frame` | 古籍双线框（border + outline offset 3px） |
| `.anim-rise` | 交错浮现（配合 `animationDelay` 做 stagger） |
| `.anim-stamp` | 盖印动效（收藏 ❤ 盖章感） |

另：`body::before` 全局 4.5% 纸纹噪点（SVG feTurbulence data-URI），`pointer-events:none` 不影响交互。尊重 `prefers-reduced-motion`。

## 5. 组件约定（Phase 1 后）

| 组件 | 样式 |
|------|------|
| 按钮（主） | `bg-primary text-primary-foreground rounded-lg`，hover `bg-primary/90` |
| 导览卡（书页卡） | `bg-card border border-border rounded-lg` + 左侧 3px 朱砂书脊线 + hover 上浮/朱色描边 |
| 状态徽标 | `.seal-outline` 印戳：已发布=朱色、私密=暖灰 |
| 导航栏 | `bg-card/90 backdrop-blur border-b`；首页左侧朱印 logo，子页居中衬线标题 |
| Tab | 编辑式下划线 tab（不用胶囊）：active 朱砂字 + 2px 朱砂下划线 |
| 输入框 | `bg-card border-border rounded-lg focus:border-primary` |
| 标签/徽标 | `bg-black/[0.04] border border-border/60 rounded-full` |
| 空状态 | 圆形线框图标（lucide）+ 说明文字 + 下一步引导 |

## 6. 地图标记色（`src/pages/TourView.jsx` JS 常量）

| 状态 | 值 | 样式 |
|------|-----|------|
| 未选中 | `#a39d8c`（暖灰） | 26px 图钉 |
| **选中** | `#c2402a`（朱砂） | 36px + 白色描边 + zIndex 500 置顶 |
| 聚合气泡 | `rgba(194,64,42,.9)` | 朱色数字气泡 |
| 底图 | `amap://styles/whitesmoke` | 与宣纸色系同源 |
| 路线五色 | `src/lib/routeColors.js` | 朱砂/黛青/赭石/苍绿/藤黄，选中 5px/80% 未选中 2px/15% |

**原则不变**：地图上只有"灰 vs 朱砂"两态，绝不引入第三色。

## 7. 卡片布局规则（我的导览）

右上角「已发布/私密」印戳 + `⋮` 操作菜单为**绝对定位集群**（`top-3 right-3`）。
- 标题行必须留 `pr-28` 右侧空间，避免长标题钻进徽标区
- **X 地点计数放底部信息行**，不与右上角徽标区重叠

## 8. Do's / Don'ts

**Do**：标题用衬线、正文用 sans、批注用楷体；强调色朱砂为主黛青为辅；图标用 lucide SVG；地图标记只两态；装饰用印章/竖排/双线框；留白充足；动效用 rise/stamp 并尊重 reduced-motion。

**Don't**：不要引入暗色块（全站亮色）；不要用 emoji 当 UI 图标；亮底上不要用 `bg-white/*` / `text-white`（看不见）；不要给卡片加多重阴影；不要引入彩虹色（路线用国画五色）。
