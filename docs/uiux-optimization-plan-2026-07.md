# NanoSparks UI/UX 优化方案

> 日期：2026-07-25 · 范围：`src/app` + `src/components`（53 个 tsx / 7,149 行）
> 方法：逐文件阅读 + 对编译产物 `.next/static/chunks/*.css` 做类名存在性验证
> 所有结论均有 `file:line` 证据，无推测项

---

## 0. 一句话结论

**当前不是"设计不够好看"的问题，是"有一半的样式根本没被编译出来"的问题。**

产品在从「YouTube 频道 → 交互思维地图」转向「贴链接 → 读播客」的过程中，长出了第二套设计语言（`zinc` + `accent` + 精确 px），但**第一套（`gray` + `primary` + shadcn token）没有被迁移，也没有被删除**——它引用的 CSS 变量从来没有在 `globals.css` 里定义过，所以那些类在生产构建里**一条规则都不存在**。

结果：**整个"研究/图谱/搜索"半边产品的主按钮是透明的**（白字 + 无背景）。

优化顺序因此不是「先做视觉」，而是：**止血 → 建地基 → 重构阅读器 → 补 IA 和 A11y**。

---

## 1. 体检硬数据

| 指标 | 数值 | 判读 |
|---|---|---|
| 引用了**不存在**的 `primary-*` 类 | **34 处 / 15 个文件** | P0，按钮不可见 |
| 引用了**不存在**的 shadcn token（`muted-foreground` / `destructive` / `bg-background` / `ring-ring` / `border-input`） | **18 处** | P0 |
| 引用了**不存在**的 `bg-zinc-150` | 1 处 | P2 |
| **死类总计** | **53 处** | — |
| `gray-*` 用量 vs `zinc-*` 用量 | 293 : 273 | 两套中性色并存 |
| 不同字号 | **19 种**（11 种 `text-[Npx]` + 8 种 Tailwind 命名） | 无字阶 |
| 不同圆角 | **7 种 / 210 次** | 无半径阶 |
| 不同内容列宽 `max-w-*` | **12 种** | 无栅格 |
| 响应式断点前缀（`sm:` `md:` `lg:` `xl:`） | **全站 15 处** | 基本无响应式 |
| `dark:` 变体 | **0** | 但阅读器有暗色开关 |
| `aria-*` 属性 | **5**（4 个 `aria-label` + 1 个 `aria-expanded`） | — |
| `role=` 属性 | **0** | — |
| `focus-visible` | **1**（且在死文件里） | 键盘不可用 |
| App Router 的 `loading.tsx` / `error.tsx` / `not-found.tsx` | **0** | 无路由级加载/错误边界 |
| `next/image` 使用 | **0**（3 个裸 `<img>`） | 封面图不优化 |
| 组件里硬编码中文字面量 | **190 条** | i18n 层形同虚设 |
| 使用 `useTranslation` 的文件 | 18 / 53 | 34% |
| 死组件 | `button.tsx`、`error-boundary.tsx`、`ErrorState.tsx`、`progress-bar.tsx` | 引用数 = 0 |

---

## 2. 三个系统性断层

### 断层一：两代设计系统并存，旧的那代编译不出来（P0）

代码库里有两批页面，视觉语言完全不同：

**Gen-1（旧）** — `corpora/*`、`playlists/*`、`person/*`、`visualization/*`、`share/*`、`ChannelForm`、`SearchModeSelector`
`bg-gray-50` · `text-2xl font-bold` · `rounded-lg` · `bg-primary-600` · `text-muted-foreground`

**Gen-2（新）** — `page.tsx`、`submit`、`dashboard`、`ReaderShell`、`SubmitBox`、`Navbar`
`bg-[#fafaf9]` · `text-[20px] font-semibold tracking-tight` · `rounded-xl` · `bg-accent-600` · `text-zinc-*`

问题在于 `globals.css` 只定义了 `--color-accent-*`：

```css
/* src/app/globals.css:3-24 —— 全部的设计 token */
@theme {
  --color-accent-50 … --color-accent-900;   /* indigo */
  --color-surface / -card / -dark;
  --font-sans / --font-mono;
}
```

Tailwind v4 里**没有内置 `primary` 色板**，也没有 shadcn 的 `background` / `muted-foreground` / `destructive` / `ring` / `input` 语义 token。对编译产物做验证：

```
.text-accent-600  → PRESENT   .text-accent-600{color:var(--color-accent-600)}
.bg-primary-600   → MISSING
.text-primary-600 → MISSING
.border-primary   → MISSING
.text-muted-foreground → MISSING
.text-destructive → MISSING
.bg-zinc-150      → MISSING
```

**受影响的可见控件（全部是"白字 + 透明背景" = 肉眼看不见）：**

| 控件 | 位置 |
|---|---|
| 语料库空态 CTA「立即分析」 | `src/app/corpora/page.tsx:33` |
| 语料库搜索「搜索」主按钮 | `src/app/corpora/[corpusId]/page.tsx:149` |
| Ask 页「提问」主按钮 | `src/app/corpora/[corpusId]/ask/page.tsx:162` |
| 播单页「新建播单」 | `src/app/playlists/page.tsx:25` |
| 新建播单表单提交 | `src/app/playlists/new/page.tsx:85` |
| 频道表单提交 | `src/components/ui/ChannelForm.tsx:121` |
| 可视化页「返回控制台」 | `src/app/visualization/[episodeId]/page.tsx:40` |
| 搜索模式选中态高亮 | `src/components/search/SearchModeSelector.tsx:42` |
| Ask 页引用角标 | `src/app/corpora/[corpusId]/ask/page.tsx:131` |
| 全部输入框的 focus ring（`focus:ring-primary-500`） | 5 处 |
| `LoadingSpinner` 的圈色 + 文案色 | `src/components/loading-spinner.tsx:11-12` |

`src/components/ui/button.tsx` 整个文件（`bg-primary` / `text-primary-foreground` / `ring-ring` / `border-input` / `bg-destructive`）**没有任何一个类是有效的**，而且**全站 0 处 import**。`error-boundary.tsx` import 了它，但 `ErrorBoundary` 本身也 0 处使用。

---

### 断层二：i18n 层描述的是**上一个产品**

`src/lib/i18n/translations.ts`（346 行 / 293 条 key）里写的是：

> `'Turn podcasts into'` / `' interactive idea maps'` / `'Analyze a Channel'` / `'Auto-Ingest'`
> `'控制面板'` / `'总剧集数'` / `'分析频道'` / `'播放列表'` / `'我的播放列表'` / `'跨集图谱'`

而当前产品的定位是（`src/app/layout.tsx:13`）：

> 「贴一条播客链接，10分钟内变成可读、可信、可再创作的图文」

**整套 i18n 文案库指向的是已经废弃的产品叙事**。这就是为什么新页面全部绕开它、直接硬编码中文（190 条）——翻译层里根本没有它们需要的词。

由此派生出的具体 bug：

- **`Navbar` import 了 `useTranslation`、给每个导航项定义了 `key`，但渲染的是硬编码的 `item.label`**：
  ```tsx
  // src/components/ui/Navbar.tsx:12-16, 47
  const NAV_ITEMS = [{ href:'/submit', key:'nav.analyze', label:'读' }, …]
  …
  {item.label}          // ← key 从未被用；切英文导航栏仍是中文
  ```
- `LangToggle` 切到 EN 后，Gen-2 的所有页面（首页 / 提交 / 阅读器 / Dashboard 大部分）**一个字都不会变**。
- 同一状态有**两套互相冲突的词表**：`StatusBadge`（全英文 `Pending`/`Downloading`/`Completed`，大写 enum key）vs `dashboard/page.tsx:20-28`（全中文 `排队中`/`转写中`/`已就绪`，小写字符串 key）。
- 图谱页四象限标题在中文页面里是硬编码英文：`'Top Claims'` / `'Objections'` / `'Open Questions'` / `'Decisions'`（`graph/page.tsx:109-114`）。
- `EmptyState` / `ErrorState` 的默认文案是英文（`'No data yet'` / `'Something went wrong'` / `'Try Again'`）。
- 术语在页面间漂移：读 / 分析 / 转写 指同一动作；语料 / corpus / 图谱 / 播单 指互相重叠的概念（翻译文件里甚至直接留着 `'在 corpus 的所有对话中搜索'` 这种中英夹杂）。

---

### 断层三：没有任何设计基元，7,149 行全是一次性 Tailwind

全站 70 个 `<button>`，**没有一个共享组件**。每个按钮都是一串独立手写的类。后果：

```tsx
// ReaderShell.tsx:411 —— 同一个元素上重复且互相覆盖的类
className="px-3 py-1 rounded-full rounded-md bg-accent-600 px-3 py-1 text-[12px] …"
//         ^^^^^^^^^ ^^^^^^^^^^^^ ^^^^^^^^^^                ^^^^^^^^^ 重复
```

同一角色（次级按钮）在不同文件里是 `rounded`、`rounded-md`、`rounded-lg`、`rounded-full` 四种；同一角色（元信息文字）是 `text-[11px]`、`text-[12px]`、`text-xs` 三种；同一角色（卡片边框）是 `border-zinc-200`、`border-zinc-200/60`、`border-gray-200`、`border-gray-100` 四种。

---

## 3. P0 缺陷清单（按用户影响排序）

| # | 缺陷 | 证据 | 用户感受 |
|---|---|---|---|
| **P0-1** | 34 处 `primary-*` + 18 处 shadcn token 不存在 → 主按钮透明 | 见 §2 表 | 搜索/Ask/播单/图谱页**点不到按钮** |
| **P0-2** | 暗色模式只作用在最外层 `div`，全站 `dark:` 变体 = 0 | `ReaderShell.tsx:342` 设 `bg-zinc-950`，但 `:344` header 是 `bg-white`、`:578` 每个段落卡片是 `bg-white`、`:683` 播放器是 `bg-white/90` | 开暗色后**白底黑字的卡片浮在黑背景上**，比不开更难读 |
| **P0-3** | 阅读器里 **4 个 `sticky top-0` 同时存在**，全部钉在同一条像素线上 | `ReaderShell.tsx:406`(z-20 续读条) `:454`(z-10 章节条) `:496`(z-10 双语切换) `:531`(z-10 字号条) | 它们**互相遮挡**而非依次堆叠：滚动后只有 z 值最高/绘制最晚的那条可见，章节导航和双语切换会被字号条盖住。三者都是半透明 `backdrop-blur`，叠加处糊成一片 |
| **P0-4** | 阅读进度定位查的 DOM id 不存在 | `ReaderShell.tsx:757` 查 `turn-${turns[0].id}`；实际渲染的是 `:578` 的 `turn-anchor-${turnIndex}` | `baseTop` 恒为 0 → **续读位置永远算错**，"上次读到第 N 句"是假的 |
| **P0-5** | 固定底部播放器 84px 高，正文只有 `pb-12`(48px) | `ReaderShell.tsx:683` vs `:632` | **正文最后两行被播放器永久遮住**，导出链接点不到 |
| **P0-6** | 阅读偏好用 `useState(() => loadPrefs())` 在 client component 里初始化 | `ReaderShell.tsx:108` + `reader-prefs.ts:38` | 服务端渲染默认值、客户端渲染 localStorage 值 → **水合不匹配 + 每次进页面暗色闪白** |
| **P0-7** | 无路由级 `loading.tsx`/`error.tsx`；页面级 loading/error 直接**替换整页** | `graph/page.tsx:86-87`: `if (loadingDisplay) return <LoadingSpinner/>; if (error) return <div className="p-8 text-red-500">{error}</div>` | 加载时**导航栏消失**、报错时只有一行红字**没有重试按钮**、也回不去 |
| **P0-8** | 转写正文无虚拟化，一次 200 条、`加载更多` 无限追加 | `ReaderShell.tsx:619-629`，`TURN_PAGE=200` | 2 小时播客约 2,000–4,000 段 → 手动点 10–20 次，DOM 涨到万级节点，**中端手机滚动掉帧** |
| **P0-9** | 提交后 SSE 进度**不可恢复**：刷新/切后台/断流即丢失 | `SubmitBox.tsx:87-122`，进度只存在组件 state | 10 分钟等待期间**误刷新就再也看不到进度**，只能去 dashboard 猜 |
| **P0-10** | 阅读页无 Navbar，出口只有 footer 里 4 个文字链接 | `read/[conversationId]/page.tsx` 未引 `Navbar`；`ReaderShell.tsx:344` 是自建 `<header>` | 读完一集**无路可走**，回不到控制台/搜索/首页，漏斗在最后一步断掉 |
| **P0-11** | 全站元信息文字对比度不达 WCAG AA | `text-zinc-400` (#a1a1aa) on #fafaf9 = **2.45:1**；`text-gray-400` (#9ca3af) on #fff = **2.54:1**（AA 要求 4.5:1，本人按 WCAG 相对亮度公式实算） | 时间戳、说话人、统计数字、hint 文字在正常光线下就已吃力，户外/老花基本不可读 |

---

## 4. 优化方案（分阶段）

### 阶段 0 · 止血（1 天，纯机械替换，零设计决策）

**目标：让已经写好的界面真的显示出来。**

**0.1 补齐缺失的 token**（不改任何组件，53 处死类立刻复活）

在 `src/app/globals.css` 的 `@theme` 里补：

```css
@theme {
  /* ── 现有 accent 保留 ── */

  /* 让 Gen-1 的 primary-* 直接映射到 accent，视觉自动收敛 */
  --color-primary-50:  var(--color-accent-50);
  --color-primary-100: var(--color-accent-100);
  --color-primary-200: var(--color-accent-200);
  --color-primary-300: var(--color-accent-300);
  --color-primary-400: var(--color-accent-400);
  --color-primary-500: var(--color-accent-500);
  --color-primary-600: var(--color-accent-600);
  --color-primary-700: var(--color-accent-700);
  --color-primary-800: var(--color-accent-800);
  --color-primary-900: var(--color-accent-900);
}
```

> 这是**桥接层**，不是终态。阶段 1 把 `primary-*` 全量改成 `accent-*` 后删掉。
> `bg-zinc-150`（`ReaderShell.tsx:381`）直接改成 `bg-zinc-200`。

**0.2 删死代码**（4 个文件，引用数均为 0）
`src/components/ui/button.tsx`、`src/components/error-boundary.tsx`、`src/components/ui/ErrorState.tsx`、`src/components/progress-bar.tsx`
（`button.tsx` 会在阶段 1 用新的实现替换，先删避免误用）

**0.3 修 3 个一行 bug**
- `ReaderShell.tsx:411` 删掉重复类 → `className="rounded-md bg-accent-600 px-3 py-1 text-[12px] font-medium text-white hover:bg-accent-700"`
- `ReaderShell.tsx:435` `<span className="…rounded-full bg-accent-500">•</span>` —— 圆点 span 里又放了个 `•` 字符，删掉字符
- `Navbar.tsx:47` `{item.label}` → `{t(item.key)}`（并在阶段 3 补齐 key）

**验收**：`npm run build` 后 grep 编译产物，`.bg-primary-600` 必须 PRESENT；手动过一遍 `/corpora`、`/playlists`、`/corpora/[id]/ask`，主按钮可见。

---

### 阶段 1 · 设计系统地基（3–5 天）

**目标：把 19 种字号 / 7 种圆角 / 12 种列宽 / 2 套中性色收敛成一套，并落成可复用基元。**

**1.1 定义完整 token（`globals.css`）**

```css
@theme {
  /* ── 色彩：单一中性色阶，全站统一用 zinc，废弃 gray ── */
  --color-accent-50 … --color-accent-900;      /* 现有 indigo，保留 */

  /* ── 语义色（暗色模式靠覆写这一层，组件不写 dark:） ── */
  --color-bg:          #fafaf9;
  --color-bg-elevated: #ffffff;
  --color-bg-subtle:   #f4f4f5;   /* zinc-100 */
  --color-border:      #e4e4e7;   /* zinc-200 */
  --color-border-soft: #f4f4f5;
  --color-fg:          #18181b;   /* zinc-900 */
  --color-fg-muted:    #71717a;   /* zinc-500 —— 4.63:1，可过 AA */
  --color-fg-subtle:   #52525b;   /* zinc-600，用于 11-12px 小字 */

  /* ── 字阶：8 级，覆盖现有全部 19 种用法 ── */
  --text-2xs:  0.6875rem;  /* 11px — 时间戳、单位 */
  --text-xs:   0.75rem;    /* 12px — 元信息（移动端下限） */
  --text-sm:   0.8125rem;  /* 13px — 次级 UI、按钮 */
  --text-base: 0.9375rem;  /* 15px — 正文（= BASE_BODY_FONT_PX） */
  --text-lg:   1.0625rem;  /* 17px — 卡片标题 */
  --text-xl:   1.25rem;    /* 20px — 页面 h1 */
  --text-2xl:  1.5rem;     /* 24px — 提交页 h1 */
  --text-3xl:  2rem;       /* 32px — 首页 hero */

  /* ── 半径：3 级 ── */
  --radius-sm: 0.375rem;   /* 控件：按钮、输入框、tag */
  --radius-md: 0.75rem;    /* 容器：卡片、面板 */
  --radius-full: 9999px;   /* 药丸：状态徽章、分段控件 */

  /* ── 内容列宽：3 档，替换现有 12 种 ── */
  --width-reading: 42rem;  /* 680px — 阅读器 */
  --width-form:    36rem;  /* 580px — 提交/表单 */
  --width-app:     69rem;  /* 1100px — 列表/看板 */
}

/* 暗色：只覆写语义层，组件代码零改动 */
:root[data-theme="dark"] {
  --color-bg:          #09090b;
  --color-bg-elevated: #18181b;
  --color-bg-subtle:   #27272a;
  --color-border:      #27272a;
  --color-border-soft: #1f1f23;
  --color-fg:          #fafafa;
  --color-fg-muted:    #a1a1aa;
  --color-fg-subtle:   #d4d4d8;
}
```

**1.2 建 5 个基元**（`src/components/ui/`，替换 70 处手写按钮）

```
Button.tsx    variant: primary | secondary | ghost | danger
              size: sm | md   —— 内建 min-h-[44px] 触控区 + focus-visible ring
Card.tsx      统一 bg-elevated / border / radius-md
Field.tsx     label + input + error + aria-describedby 绑定（现在 SubmitBox 只有 placeholder）
SegmentedControl.tsx   role="radiogroup" + aria-checked —— 复用于双语切换 / 字号 / 行距 / 搜索模式 / colorBy
Toast.tsx     全站唯一的瞬时反馈通道（现在是散落的 fixed div）
```

> `SegmentedControl` 一个组件同时修掉 5 处 a11y 缺陷 + 5 处视觉不一致，性价比最高，优先做。

**1.3 全量替换**
- `gray-*` → `zinc-*` / 语义 token（293 处，可脚本化）
- `primary-*` → `accent-*`（34 处），然后从 `@theme` 删掉阶段 0 的桥接
- `text-[Npx]` / `text-xs` / `text-sm` → 字阶 token（约 220 处）
- **所有 `text-zinc-400` / `text-gray-400` 作为正文/元信息时 → `text-fg-muted`（zinc-500）**

  > 对比度实测：`#a1a1aa` on `#fafaf9` = **2.45:1**，`#9ca3af` on `#ffffff` = **2.54:1** —— WCAG AA 要求 4.5:1，**当前全站元信息文字全部不达标**。`#71717a` on `#fafaf9` = **4.63:1**，达标。

**验收**：字号种类 ≤ 8、圆角 ≤ 3、`gray-*` 用量 = 0、`primary-*` 用量 = 0、手写 `<button className=` ≤ 5。

---

### 阶段 2 · 阅读器重构（5–8 天，产品核心）

`ReaderShell.tsx` 802 行、承载 4 个 sticky、1 个 fixed、6 组 state、3 个副作用监听。这是产品的生命线，也是缺陷密度最高的文件。

**2.1 拆一个统一的 sticky 工具栏**（修 P0-3）

现状 4 条独立 sticky 竞争 `top-0`。改成**单条工具栏 + 收纳**：

```
┌─────────────────────────────────────────────┐
│  ‹ 章节 ▾ │  原文 译文 对照 │        Aa  ⏻  │   ← 唯一 sticky，48px
└─────────────────────────────────────────────┘
```

- 章节 → 下拉（现在是横向滚动条，移动端手感差且占一整行）
- 双语切换 → 只在 `hasTranslation` 时出现在中段
- `Aa` → 点开是浮层面板（字号 / 行距 / 暗色），不是行内展开挤压布局
- 续读提示改成**一次性 toast**，不是常驻 sticky 条

**2.2 修暗色**（P0-2）
删掉 `ReaderShell.tsx:342` 的三元判断，改为在 `<html>` 上打 `data-theme`，全部 `bg-white` → `bg-bg-elevated`、`text-zinc-900` → `text-fg`、`border-zinc-200` → `border-border`。同时给 `layout.tsx` 加**阻塞式内联脚本**在首帧前读 localStorage 打 `data-theme`（修 P0-6 的闪白 + 水合不匹配）：

```tsx
// src/app/layout.tsx <head> 内，next/script 无法覆盖首帧，必须内联
<script dangerouslySetInnerHTML={{ __html:
  `try{var p=JSON.parse(localStorage.getItem('nanosparks:readerPrefs')||'{}');
   if(p.darkMode)document.documentElement.dataset.theme='dark'}catch(e){}` }} />
```

**2.3 修阅读进度**（P0-4）
`nearestTurnIndex` 改用 `IntersectionObserver` 记录当前可视段落的 `turnIndex`，替换掉 `getElementById('turn-…')` + `getBoundingClientRect` 的错误估算。顺带修掉 P0-8 的一半：滚动事件不再强制同步布局。

```tsx
// 替换 ReaderShell.tsx:218-228 + 755-762
const visibleIdx = useRef(0);
useEffect(() => {
  const io = new IntersectionObserver(
    (entries) => {
      const top = entries.filter(e => e.isIntersecting)
        .sort((a,b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (top) visibleIdx.current = Number(top.target.id.replace('turn-anchor-',''));
    },
    { rootMargin: '-20% 0px -70% 0px' },
  );
  document.querySelectorAll('[id^="turn-anchor-"]').forEach(el => io.observe(el));
  return () => io.disconnect();
}, [paragraphs.length]);
```

**2.4 正文虚拟化 + 自动加载**（P0-8）
- 用 `content-visibility: auto` + `contain-intrinsic-size` 给每个段落卡片（一行 CSS，零依赖，先做）
- `加载更多` 按钮换成 `IntersectionObserver` 触底自动加载（保留按钮作为降级）
- 若实测 3,000+ 段仍卡，再上 `@tanstack/react-virtual`

> ponytail：先上 `content-visibility`，这一条通常就够；虚拟化等实测掉帧再加。

**2.5 修播放器遮挡**（P0-5）
`main` 的 `pb-12` → `pb-[calc(88px+env(safe-area-inset-bottom))]`；播放器容器加 `pb-[env(safe-area-inset-bottom)]`（iOS 全面屏 home indicator）。

**2.6 内容列对齐**
`read/[conversationId]/page.tsx:139` 的 `PublishPanel` 包在 `max-w-2xl px-4`（672/16px），而 ReaderShell 是 `max-w-[680px] px-5`（680/20px）——**左右各差 4px，肉眼可见的错位**，且 PublishPanel 出现在阅读器 footer *下方*。改成移进 `ReaderShell` 内、footer 之前，共用 `--width-reading`。

**2.7 划句高亮修复**
- `ReaderShell.tsx:670` 渲染期读 `window.innerWidth` → 改用 `useLayoutEffect` 或 CSS `clamp()`
- 只监听 `mouseup`，移动端长按选词不触发 → 补 `selectionchange` + `touchend`
- 滚动时浮动按钮位置失效 → 滚动时关闭，或用 `position: absolute` 挂到文档流

**验收**：iPhone SE (375×667) 上正文可视高度 ≥ 60% 视口；暗色无白闪；2h 播客滚动 60fps；续读位置误差 ≤ 1 段。

---

### 阶段 3 · 信息架构 + 等待体验（3–4 天）

**3.1 导航覆盖**

**最严重的一处：阅读页根本没有 Navbar。** `ReaderShell.tsx:344` 用的是自己的 `<header>`，不含任何导航；`read/[conversationId]/page.tsx` 也没引 `Navbar`。用户读完一集之后，唯一的出口是 footer 里的 4 个文字链接（`ReaderShell.tsx:634-661`）——**读完即断路**，回不到控制台、搜索、首页。这是留存漏斗上最贵的一个洞。

其次，14 条路由导航栏只暴露 3 条。`/playlists`、`/person/[id]`、`/visualization/[id]`、`/p/[slug]`、`/share/[id]` **从任何页面都点不到**。方案：
- 导航栏保留 3 项（读 / 控制台 / 搜索）不变——这是对的，别加
- **阅读页加回 Navbar**（或至少一个左上角返回 + 右上角"再读一条"），并在读到底部时给一张「下一步」卡片：相关集 / 加入合集 / 看图谱 / 贴新链接
- 其余页面同样**必须有返回路径**：图谱页、Ask 页、Person 页顶部加面包屑（`合集 › {名称} › 图谱`）
- Dashboard 补「播单」入口卡片
- `⌘K` 现在**零处可发现**：在导航栏搜索项旁加 `⌘K` 提示；移动端加一个搜索图标按钮触发同一面板

**3.2 概念收敛**
`corpora` / `playlists` / `person` / `visualization` / `graph` 五个概念在用户心智里高度重叠，且 `corpus`（语料）这个词在翻译文件里都没统一。建议对外只保留三层：

```
一集（read）  →  一个节目/合集（corpus，对外叫「书架」或「合集」）  →  一个人（person）
```

`playlists` 与 `corpora` 功能重叠，建议合并或明确差异后再暴露；`visualization/[episodeId]` 与 `corpora/[id]/graph` 重复，保留后者。

**3.3 设计那 10 分钟**（P0-9，**这是留存的关键**）

现在提交后是一个 6 阶段的 checklist + spinner。10 分钟盯着 checklist 是空耗。改成**渐进式交付**：

| 时间 | 现在 | 改后 |
|---|---|---|
| 0s | 排队中 ⏳ | 立刻跳进 `/read/[id]`，显示封面 + 节目信息 + 骨架屏 |
| ~30s | 下载音频 ⬇️ | 元信息就位（时长、嘉宾、show notes） |
| ~2min | 语音转写 🎙️ | **首段转写文字开始流式出现**（已有 `turnCount`，只是没展示） |
| ~6min | 生成导读 ✨ | TL;DR 逐条浮现 |
| ~10min | 完成 ✅ | 金句墙 + 章节 + 图谱入口 |

同时修**进度不可恢复**：`/read/[id]` 页面在 `!ready` 时自己订阅 SSE（现在这段逻辑只在 `SubmitBox` 里），刷新/切后台/换设备都能续上。`ReaderShell.tsx:383-400` 已经有 `statusToStage` 的进度条骨架，把 SSE 接上即可。

**3.4 补路由级状态**（P0-7）
```
src/app/loading.tsx          全局骨架（保留 Navbar）
src/app/error.tsx            全局错误 + 重试（保留 Navbar）
src/app/not-found.tsx        404 + 回首页
src/app/read/[conversationId]/loading.tsx   阅读器专用骨架
src/app/corpora/[corpusId]/loading.tsx
```
把 `graph/page.tsx:86-87` 那种「整页替换成一行红字」全部删掉。

**3.5 统一反馈通道**
现在有：`ReaderShell` 的 `已加入高亮库` fixed div、`SubmitBox` 的行内 error box、`corpora` 的 red panel、`ErrorState`（死的）、`EmptyState`（英文默认文案）。全部收进阶段 1 的 `Toast` + `Card` 基元。

---

### 阶段 4 · 可访问性 + 移动端（3–4 天）

**当前基线：0 个 `role=`、5 个 `aria-*`、1 个 `focus-visible`（在死文件里）。** 这不是"优化"，是从零开始。

**4.1 必修项**

| 项 | 现状 | 修法 |
|---|---|---|
| 分段控件 | 5 组纯 `<button>`（双语/字号/行距/搜索模式/colorBy），选中态只有颜色 | 用阶段 1 的 `SegmentedControl`，`role="radiogroup"` + `aria-checked` |
| 图标按钮无名 | `Navbar.tsx:56` 齿轮只有 `title`、`ReaderShell.tsx:537` 的 `Aa`、`LangToggle` | 补 `aria-label` |
| 表单无 label | `SubmitBox.tsx:272` 只有 placeholder | `<label>` + `aria-describedby` 关联错误文案 |
| 键盘焦点 | 全站 1 处 `focus-visible` | 基元内建 `focus-visible:ring-2 ring-accent-500 ring-offset-2` |
| 命令面板 | 无 `role="dialog"`、无 `aria-modal`、无 focus trap、无 scroll lock；`Enter` 用 `window.location.href` 触发**整页刷新** | 补 dialog 语义 + focus trap；`window.location.href` → `router.push`（`CommandPalette.tsx:98`） |
| 异步进度无播报 | SSE 阶段更新、批量进度、高亮 toast 全部静默 | 加 `aria-live="polite"` |
| 对比度 | 元信息文字 2.45:1 / 2.54:1，**全部不达标** | 见阶段 1.3 |
| 字号下限 | `text-[10px]` 13 处、`text-[11px]` 39 处 | 移动端最小 12px |
| 触控区 | 70 个按钮里 67 处用 `py-0.5`/`py-1`（约 22–28px 高） | 基元内建 `min-h-[44px]`（视觉可用 `-my-*` 抵消） |
| 动效 | 4 处 `animate-spin` + `animate-pulse` + 3D 力导向图，无 `prefers-reduced-motion` | `@media (prefers-reduced-motion: reduce) { *{animation:none!important} }` + 3D 图降级为 2D |
| `<html lang>` | `layout.tsx:25` 按 cookie 设 `zh-CN`/`en`，但 Gen-2 页面内容恒为中文 | i18n 补齐前，`lang` 固定 `zh-CN`；补齐后再联动 |
| Canvas 可视化 | 3D 图谱 / deck.gl / sigma 全部无文本替代 | 每个图旁提供等价的列表视图（图谱页四象限已经是，把它标为 `aria-describedby` 目标） |

**4.2 移动端**

全站 15 处响应式前缀，等于**没有做移动端**。而目标用户（中文播客听众）主要在手机上读。必修：

- `layout.tsx` 补 `export const viewport = { width:'device-width', initialScale:1, themeColor:[…] }`（现在完全没有）
- `dashboard/page.tsx:62` `grid-cols-4` 无断点 → 手机上 4 个统计卡挤成一列窄条，改 `grid-cols-2 sm:grid-cols-4`
- `ReaderShell.tsx:779` 双语对照 `grid-cols-2` 无断点 → 375px 屏上每列 ~160px，中文一行 5–6 字，不可读。改成移动端上下堆叠
- `graph/page.tsx` `max-w-7xl` + 四象限网格在手机上横向溢出
- `hover:` 独占的交互（`hover:underline` 显示、`title=` 提示）在触屏上不存在 → 改为常显或长按
- 3D 图谱（three.js + 3d-force-graph）在中端 Android 上是性能杀手 → 加 `matchMedia('(pointer:coarse)')` 检测，移动端默认走 2D/列表，提供「切到 3D」按钮
- 封面图用 `next/image`（现在 3 处裸 `<img>`，`next.config.ts` 也没配 `images.remotePatterns`）

---

### 阶段 5 · i18n 重建（2–3 天）

**不要修补 `translations.ts`，重写它。** 现有 293 条 key 描述的是废弃产品。

1. 以当前 UI 为准，把 190 条硬编码中文抽成 key（按页面分文件，不要一个 346 行的大文件）
2. 删掉所有 `Analyze a Channel` / `interactive idea maps` / `控制面板` / `总剧集数` 系列
3. 统一术语表（先定中文，再翻英文）：

   | 概念 | 统一用词 | 废弃 |
   |---|---|---|
   | 把链接变成文字 | **读** | 分析 / 转写 / ingest |
   | 一集的产出页 | **阅读页** | 可视化 / visualization |
   | 一组集合 | **合集** | corpus / 语料 / 播单 / playlist |
   | 知识图谱 | **图谱** | 思维地图 / idea map |
   | 状态词表 | 排队中 / 下载中 / 转写中 / 分析中 / 已就绪 / 失败 | `StatusBadge` 的英文词表（删） |

4. `StatusBadge` 与 `dashboard/STATUS_LABELS` 合并成一个 `src/lib/status.ts`
5. 图谱四象限标题、`EmptyState`/`ErrorState` 默认文案接入 i18n
6. Emoji 状态符（`⏳`/`✅`/`❌`，12 处）保留视觉但补 `aria-label`，或换成阶段 1 的 `StatusBadge` 基元

---

## 5. 执行顺序与工作量

| 阶段 | 内容 | 工作量 | 前置 | 风险 |
|---|---|---|---|---|
| **0** | 止血：补 token、删死码、修 3 个一行 bug | **1 天** | — | 极低（纯加法） |
| **1** | 设计系统：token + 5 个基元 + 全量替换 | **3–5 天** | 0 | 中（改动面广，需回归） |
| **2** | 阅读器重构 | **5–8 天** | 1 | 中高（核心路径） |
| **3** | IA + 等待体验 + 路由状态 | **3–4 天** | 1 | 中 |
| **4** | A11y + 移动端 | **3–4 天** | 1, 2 | 低 |
| **5** | i18n 重建 | **2–3 天** | 3（术语表） | 低 |
| | **合计** | **17–25 天** | | |

**并行建议**：阶段 0 完成后，阶段 1（设计系统）与阶段 3.3（等待体验，主要是后端 SSE 接线）可并行；阶段 4 与 5 可并行。

**最小可交付切片**（若只有 1 周）：阶段 0 + 阶段 1.1/1.2（token + Button/Card/SegmentedControl）+ 阶段 2.1/2.2/2.5（sticky 合并、暗色、播放器遮挡）。这三块覆盖了 P0-1/2/3/5，是可感知收益最大的组合。

---

## 6. 验收标准

**可自动化检查（建议做成 CI gate）**

```bash
# 死类检测：构建后校验关键类存在
npm run build && node scripts/assert-css-classes.mjs

# 设计系统收敛
grep -ro "gray-[0-9]" --include="*.tsx" src/ | wc -l          # 目标 0（现 293）
grep -ro "primary-[0-9]" --include="*.tsx" src/ | wc -l       # 目标 0（现 34）
grep -rho "text-\[[0-9]*px\]" --include="*.tsx" src/ | sort -u | wc -l   # 目标 0（现 11 种）
grep -rc "<button className=" --include="*.tsx" src/ | wc -l  # 目标 ≤5（现 70）

# A11y
grep -ro "role=" --include="*.tsx" src/ | wc -l               # 目标 ≥30（现 0）
grep -ro "aria-" --include="*.tsx" src/ | wc -l               # 目标 ≥60（现 5）
npx @axe-core/cli http://localhost:7557/read/<id>             # 0 critical / 0 serious
```

**人工验收**

- [ ] `/corpora`、`/playlists`、`/corpora/[id]/ask` 的主按钮**肉眼可见**且可点
- [ ] 阅读器暗色模式：所有卡片、header、播放器同步变暗；刷新无白闪
- [ ] iPhone SE (375×667)：阅读器正文可视区 ≥ 60% 视口；播放器不遮正文
- [ ] 2 小时播客（约 3,000 段）：滚动 60fps；续读位置误差 ≤ 1 段
- [ ] 提交后刷新页面，进度**继续可见**
- [ ] 仅用键盘完成：提交链接 → 等待 → 阅读 → 切换双语 → 调字号 → 导出
- [ ] 切换 EN，导航栏 + 首页 + 阅读器**全部**变成英文
- [ ] Lighthouse：Accessibility ≥ 95，Performance（移动端）≥ 80

---

## 7. 附：阶段 0 可立即执行的 diff 清单

| 文件 | 行 | 改动 |
|---|---|---|
| `src/app/globals.css` | `@theme` 内 | 追加 10 条 `--color-primary-*: var(--color-accent-*)` |
| `src/components/reader/ReaderShell.tsx` | 381 | `bg-zinc-150` → `bg-zinc-200` |
| `src/components/reader/ReaderShell.tsx` | 411 | 删重复类 → `rounded-md bg-accent-600 px-3 py-1 text-[12px] font-medium text-white hover:bg-accent-700` |
| `src/components/reader/ReaderShell.tsx` | 435 | 删 span 内的 `•` 字符 |
| `src/components/reader/ReaderShell.tsx` | 632 | `pb-12` → `pb-[calc(88px+env(safe-area-inset-bottom))]` |
| `src/components/ui/Navbar.tsx` | 47 | `{item.label}` → `{t(item.key)}` |
| `src/components/ui/Navbar.tsx` | 56-65 | 齿轮 `<Link>` 补 `aria-label="设置"` |
| `src/components/search/CommandPalette.tsx` | 98 | `window.location.href = sel.href` → `router.push(sel.href)` |
| 删除 | — | `src/components/ui/button.tsx`、`src/components/error-boundary.tsx`、`src/components/ui/ErrorState.tsx`、`src/components/progress-bar.tsx` |
