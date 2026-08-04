# 文学巡礼 · 设计规范（DESIGN.md）

> 全站视觉风格：**Claude/Anthropic 风格**（羊皮纸 + 陶土色 + 衬线标题，书卷气 / 新中式文艺）。
> 参考 `/Users/mac/Claude_projects/design/claude/DESIGN.md`，2026-08 全站由暗紫红主题重构而来。

---

## 1. 视觉定位

亮色为主、暖调、编辑式排版。像一本旧书 / 一张羊皮纸地图，克制留白，低饱和大地色系。
- **不**做暗色模式（地图页也用亮色，与高德 normal 亮底图一致）
- 强调色只有陶土，避免多色冲突（尤其地图标记）

## 2. 色板（`src/index.css` @theme 实际值）

| Token | 值 | 用途 |
|-------|-----|------|
| `--color-background` | `#f5f4ed` | 页面底 · 羊皮纸 |
| `--color-foreground` | `#141413` | 正文 · 暖近黑 |
| `--color-card` | `#faf9f5` | 卡片 · 象牙 |
| `--color-card-foreground` | `#141413` | 卡片文字 |
| `--color-primary` | `#c96442` | 主按钮 / 选中 / 强调 · 陶土 |
| `--color-primary-foreground` | `#ffffff` | 主按钮文字 |
| `--color-secondary` | `#e8e6dc` | 次级底 · 暖沙 |
| `--color-secondary-foreground` | `#141413` | |
| `--color-muted` | `#eeece3` | 弱底 |
| `--color-muted-foreground` | `#6f6d63` | 次要文字 · 暖灰 |
| `--color-accent` | `#e8e6dc` | |
| `--color-accent-foreground` | `#141413` | |
| `--color-destructive` | `#b53333` | 错误 |
| `--color-border` | `#e0ddd2` | 边框 · 暖 |
| `--color-input` | `#e0ddd2` | 输入框 |
| `--color-ring` | `#c96442` | 焦点环 |
| `--radius` | `0.5rem` | 圆角（收敛，编辑感） |

**语义色**（非 token，Tailwind 命名）：
- 成功 / 已发布：`green-600` 系（文字在亮底用 `text-green-700`）
- 引文 / 反思块：`yellow-600` 左描边 + `bg-yellow-600/5`；引文文字 `text-[#7a6a4f]`（暖墨）
- 信息提示：`blue-700`（亮底）

## 3. 字体（`src/index.css` @theme）

| Token | 值 | 用途 |
|-------|-----|------|
| `--font-sans` | `-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif` | 正文 |
| `--font-serif` | `Georgia, "Songti SC", STSong, "Noto Serif SC", serif` | **标题（衬线）** |

**规则**：衬线只用于标题——首页导览卡标题、地点名（ContentCard）、导航栏标题、页面主标题；正文一律 sans。加 `font-serif` 类到标题即可。

## 4. 组件约定

| 组件 | 样式 |
|------|------|
| 按钮（主） | `bg-primary text-white`，圆角 `rounded-xl`，hover `bg-primary/90` |
| 卡片 | `bg-card border border-border rounded-2xl`，无重阴影（`shadow-xl` 封顶） |
| 导航栏 | `bg-card/95 backdrop-blur border-b border-border`（象牙玻璃）；标题衬线 |
| 输入框 | `bg-background text-foreground border border-border focus:border-primary` |
| 标签/徽标 | `bg-black/5 text-muted-foreground rounded-full`（亮底上不要用 `bg-white/5`，看不见） |
| 底部信息行 | 目的地 · 省市 · 🗺路线 · **X 地点**（`gap-2`，地名与省市用 `·` 分隔） |

## 5. 地图标记色（`src/pages/TourView.jsx` JS 常量）

| 状态 | 值 | 样式 |
|------|-----|------|
| 未选中 | `#b3ae9e`（暖灰） | 26px 图钉 |
| **选中** | `#c96442`（陶土） | 36px + 白色描边 + zIndex 500 置顶 |
| 聚合气泡 | `rgba(201,100,66,.9)` | 红色数字气泡 |

**原则**：地图上只有"灰 vs 陶土"两态，绝不引入第三色——之前按重要性配色导致橙色与选中琥珀金冲突、用户分不清选中态（踩过坑）。

## 6. 旧暗色 → 新 token 映射（重构时用过，维护参考）

| 旧值 | 新值 |
|------|------|
| `bg-[#0f0f1a]` | `bg-background` |
| `bg-[#1c1c32]` | `bg-card` |
| `bg-[#242444]` | `bg-secondary` |
| `bg-red-600` / `text-red-400` | `bg-primary` / `text-primary` |
| `text-gray-400/500/300` | `text-muted-foreground` |
| `bg-white/5` / `border-white/5` | `bg-black/5` / `border-border` |
| `text-green-400` / `text-blue-400` | `text-green-700` / `text-blue-700` |
| 亮底 `text-white` | `text-foreground`（按钮上保留） |

## 7. 卡片布局规则（我的导览）

右上角「已发布/私密」状态徽标 + `⋮` 操作菜单为**绝对定位集群**（`top-3 right-3`）。
- 标题行必须留 `pr-28` 右侧空间，避免长标题钻进徽标区
- **X 地点计数放底部信息行**，不与右上角徽标区重叠（曾踩过重叠坑）

## 8. Do's / Don'ts

**Do**：标题用衬线、正文用 sans；强调色只用陶土；亮底次要文字用暖灰 token；地图标记只两态；留白充足。
**Don't**：不要引入暗色块（全站亮色）；不要加多余强调色；亮底上不要用 `bg-white/*` / `text-white`（看不见）；不要给卡片加多重阴影。
