# 更新记录

## 0.3.0 — 2026-11-13（v1.19 自定义说法层 · 层板＋）

宿主＋浏览器两边都改；**契约增量**（`layers`／件 `layer`／四个层 op／`gaps.byLayer` 按层 id 计）。

- **层是数据**：新增 `board.layers[]`（默认三层 id 固定 `human`／`agent`／`program`，builtin；自定义层 `S1` 起，`seq.S` 水位）；域与计划块带 `layer`，实块固定程序层（不存），连接/便签不入层；`author ≠ layer`。
- **旧板兼容**：无 `layers` 读入补默认三层、无 `layer` 按 `author` 回填；读不写盘，下次写板才落盘；`format` 仍 `structure-desk/1`。
- **guard 改按 `layer.owner`**：只动自己方；`assign_layer` 只能换到自己方的层；默认层/程序层不可删、有件层拒绝删除、归属建后不可改。
- **工具**：`read` 回 `layers` 摘要、件带 `layer`；`write` 只收 `assign_layer`（层增删改回 `rejected`＋`tool-op-not-allowed`）；**`write`／`scan`／`export` 必须显式传 `project`**（不再猜会话目录——修「空板掉在错目录」）。
- **面板**：层板「＋新建层」（名称/归属/颜色）、自定义层 ⋯ 改名改色删除、检视器「所在层」下拉换层、计划视图按层计数、层板/包络/节点按层 id（默认层保留原配色）、可见性 localStorage 按层 id 存（旧键兼容）。
- **D17 修**：连线端点收到节点边界外（`linkEnds`，gap=6 世界坐标，三处 `d` 复用），箭头不再压在域/块/便签下面。
- **验收**：宿主单测 **64/64**、host-check-v119 **32/0**（沙箱内）；浏览器 stage **v29 8/0**（真机：外部 Edge 157 headless + CDP attach，宿主已重载）；回归链 **v29→v11 全绿，合计 201/0**（2026-11-13 干净 Edge 复跑：v28 **19/0**、78 档拖动 **48.5fps**；前一次 17–21fps 判为环境退化）。文档：`概念·工作台.md` §六、`设计·结构台.md` §3.1/§6.2/§7/§9.1/§10/§11、`使用.md`、`施工·v1.19.md`。

## 0.2.0 — 2026-11-13（v1.18 渲染与物理 B/C 组）

浏览器半边改动，**宿主接口不变**。

- **节点定位**：`.sd-node` 由 `left/top` 改 `transform: translate3d(x,y,0)`（`left/top:0`、`will-change:transform`），四处写点收敛到 `setNodeXY`（域拖动 `scale(1.04)` 拼进内联 transform）。
- **停止规则**：帧循环会停——没在拖 + alpha≤0.05 + 本帧最大速度≤0.08 连续 24 帧，或 alpha 见底后 4s 兜底 → 停：不跑物理、不写 DOM、不落盘（坐标只同步内存），底栏 `物理 · 静止`；拖拽/重排/外部改板重新点着，外部改板 500ms 节流合并。受挫图（连线互相顶住永不收敛）由兜底定格，不会常驻烧 CPU。
- **批量线层**：连线 >220 条时线层按类型合成一条 `<path class="line sd-link-batch">`（每帧每型 1 次 `d` 写），强调线单独叠层；悬停/点击改「指针到线段距离」解析命中（12px 阈值、只认可见端点）。小板（≤220）维持逐线 DOM。
- **C 组热路径**：`physicsStep` SoA（Float64Array）＋去 `Math.hypot`/重复除法、弹簧索引预编译；`autoLayout` SoA（逐位一致）；`resolveOverlaps` 逐 pass 按 x 扫掠。800 块 physics p50 21.8→5.0ms、autoLayout 3.7→2.6s、拥挤板分离 69→31ms。
- **仪表**：`__sdPerf().domWritesByPerFrame` 按 nodes/links/labels/hulls 拆写；`__sdPhysDbg()` 带 `stopReason`（quiet|hard）/`idleMs`/`paintWritesBy`。
- **修复（v1.17 遗留）**：9s 轮询定时器不再依赖 `store.rev`/`desk` 重挂——否则开板物理落盘每 30 帧一次、十几秒不发一次 `/rev`（外部改动等不到）；纯 move 回包 rev 跳变时立即补拉 `/state`——否则外部改板期间客户端把 rev 抬新却没换 board，轮询误判已同步、画布停在旧结构。
- **验收（2026-11-11，Edge 157 headless）**：stage v28 **19/0**；回归链 v28→v11 合计 **193/0**；78 档 warm 33→60fps、拖动 28.6→55.5fps（p95 20.1ms）、停止态 0 写/60fps；300 档 warm 4.7→40fps、DOM 写 956→204/帧、停止态 0 写/60fps。宿主单测 58/58。

## 0.1.0 — 2026-11-09（Alpha）

首个独立发布：结构台（Structure Desk）DSH 插件包。

- **宿主半边**：`board.json`／`layout.json`／`journal.jsonl`／`history/` 落盘与回滚；HTTP API（`state`／`ops`／`scan`／`history`／`revert`／`export`／`brief`）；v1.16 完成判据 `criteria` 与说法层只读守卫；v1.17 增量接口（`/rev`、`/state?parts`、`/history?since|batch`、move-only 回包、读缓存、gzip）。
- **浏览器半边**：一整页画布（热力场物理、层板、计划视图、域内视图、时间轴、桌边消息、历史撤销），`__sdPerf()` 只读性能仪表。
- **智能体工具** `structure_desk`；58 项 `node:test` 单测；MIT 许可。
- **CI**：GitHub Actions（Node 22/24）跑 `npm test`，用测试运行器默认隔离（Node 22 不认 `--test-isolation`）。
- **修复**：同一秒内连续写多批时 batch id 随机碰撞（55 批约 2%），会让快照互相覆盖；改为进程内递增序号＋2 字节随机。
- **状态**：宿主侧已验证（单测 58/58、宿主 HTTP 验收 42/42）；浏览器验收已跑通（2026-11-10：v26 23/0、v27 15/0、回归链 v27→v11 共 174/0；Edge 157 headless），按 **Alpha** 对待。
- **发布记录（2026-11-10）**：v0.1.0 Release 附件与仓库一致（167,456 B / sha256 `bf7775e3…`）；GitHub 仓库已公开。
