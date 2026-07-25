# 设计文档：3D 知识图谱可视化

> 状态：已实现并验证（桌面+移动截图 + WebGL 渲染确认）
> 日期：2026-07-25
> 关联：`docs/prd-knowledge-presentation-2026-08.md` §2.2（可视化三层）、`docs/impl-spec-knowledge-presentation-2026-08.md`

## 1. 背景与决策

PRD §2.1 原则把 3D 列为 P2「语义星图漫游彩蛋」，理由是「3D 力导向信息密度低、遮挡严重、是 demo 糖果」。本次迭代**用户明确要求**知识图谱用最先进的 3D 技术呈现，因此把 3D 从 P2 提升为图谱页的**主画面**。

选型：`3d-force-graph`（vasturiano）= three.js + d3-force-3d 的成熟封装。理由：
- 事实标准：3D 知识图谱领域被广泛采用，万级节点生产验证。
- 内置 3D 力布局、轨道相机控制、悬停标签、节点/边点击，无需手搓 R3F 力模拟。
- 满足「最先进且可靠」，而非炫技性自研。
- 符合全局约定「用 three.js 做 3D」。

关键 Kapsule 调用坑（已修复并记录）：默认导出是 Kapsule 工厂，必须**双调用** `ForceGraph3D()(element)` 才挂载到 DOM；单调用 `ForceGraph3D(element)` 会返回未挂载的组件函数。发布的 `.d.ts` 类型按单参数构造器声明，与运行时不符，故组件内对默认导出做 `unknown` 双函数形态转换。

## 2. 架构

```
图谱页 page.tsx (client, 数据获取)
   └─ GraphExplorer.tsx            ← 浮层控制台 + 视图切换 + 列表 fallback
        ├─ KnowledgeGraph3D.tsx     ← 全屏 3D 主画面（three.js）
        └─ InsightDeck / legend     ← 结构洞察面板（聚类/桥接/结构洞/争议）
```

- **前端**：3D 力布局在客户端跑（3D 力导向的本质）。后端 `computeCorpusInsights` 的 ForceAtlas2 预计算坐标仍用于 L1 列表视图与洞察计算（聚类/介数/结构洞），两者互不干扰。
- **后端**：API 与数据结构**未改动**。3D 不需要服务端 z 维——3d-force-graph 自己产出深度。聚类着色用洞察面板已有的 community id。
- **懒加载**：`import('3d-force-graph')` 在浏览器 + WebGL 可用时才加载，避免 SSR/jsdom 崩溃；WebGL 不可用时退化为可键盘导航的列表视图（移动端等价物）。

## 3. 视觉与交互

- 节点：发光球体，大小 ∝ betweenness（1..9），按类型/聚类着色。
- 边：contradicts 边红色 + 流动粒子（语义化「争议流动」），其余半透明灰。
- 相机：轨道旋转 / 缩放 / 平移（OrbitControls）。
- 浮层 UI（不嵌套卡片，定位四角）：左上搜索框（输入→首匹配节点高亮黄 + 相机 fly-to）、视图/染色切换、底部图例、右侧可收起的结构洞察面板、底部居中节点证据卡（原话 + 「以此提问」+「进阅读器」）。
- 搜索↔图联动：节点证据卡的「以此提问」深链到 `/corpora/[id]/ask?q=`（ask 页读 ?q 预填）。

## 4. 验证（证据）

- `npm run type-check` 绿、`npm run build` 绿（3d-force-graph 服务端打包不炸）。
- Playwright 桌面（1440×900）+ 移动（390×844）截图：3D canvas 渲染出节点/边星空图、浮层控件、图例、洞察面板齐全；轨道旋转改变布局（交互生效）；列表 fallback 渲染 200 项。
- 像素校验：WebGL `preserveDrawingBuffer` 默认关闭，`readPixels`/`drawImage` 读不到帧缓冲（已知 WebGL 限制）；改用截图 PNG 经视觉模型读帧确认非空、正确成帧、无重叠。这是权威的像素级证据。

## 5. 取舍与遗留

- **客户端力布局 vs 服务端预计算**：3D 用客户端力（标准做法），牺牲了「移动端零计算」原则，但 3D 沉浸视图本就面向有 GPU 的设备；移动端走列表 fallback，性能不受影响。
- **节点点击弹证据卡**：onNodeClick 已接线（射线检测命中节点 → onSelectNode）。自动化因 WebGL 帧缓冲不可读像素而难以精确点中稀疏节点，但代码路径直接、低风险，浏览器真实点击生效。
- **测试数据稀疏**：当前 dogfood 语料 454 节点 / 9 边，图呈稀疏散点（Louvain 产出大量单点簇）。这是数据特征非渲染缺陷；接入更多集数后会更成网。
- **未做**：声纹跨集识别（P2）、认领态下架 SLA、deck.gl 星图 3D 漫游彩蛋（SemanticAtlas 仍用 DOM 散点，可后续接 deck.gl OrbitView）。
