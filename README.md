# 结构台 · Structure Desk

A DeepSeek Harness plugin: **domains, blocks and links on one desk.** Take notes, annotate code, divide a project into domains, sketch a blueprint and ground it later — the human in a canvas panel and the agent through the `structure_desk` tool edit **the same board on disk**.

> 本仓库是**插件包本体**（宿主半边＋浏览器半边＋智能体工具）。结构台项目的工作区文档、示例项目、自扫描板、验收工具与截图不随本仓库发布。
> 版本：`package.json` 0.1.0（对应结构台项目 v1.17 实现）；宿主侧单测 57/57、宿主 HTTP 验收 42/42 已验；浏览器 stage v27 待外部环境跑。

承 `17-结构账本` 的定性：**块是跑出来的，域是说出来的**；一份事实源、多种渲染；未覆盖是一等状态，不标红、不打分。

## 三个基本件

| 件 | 是什么 | 谁产生 |
|---|---|---|
| **域** domain | 概念、说法：这一块负责什么 | 人写 · 智能体写 |
| **块** block | 实际存在：文件；或还没实现的**计划块** | 扫描跑出来 · 人／智能体点出来 |
| **连接** link | 八型：覆盖·细化·矛盾·依赖·调用·计划·落地·关联 | 人／智能体 |
| 便签 note | 随手记，可挂到任一件上 | 人／智能体 |

四种**落差**是算出来的，从不存进板子：`unannotated` 未标注 · `ungrounded` 空承诺 · `planOpen` 未落地 · `conflicts` 矛盾。

## 两个入口，一份板子

- **人**：左侧栏「结构台」→ 一整页画布（域树／落差／便签／检视器／撤销栈／主题跟随 DSH）。画布有**物理**：参考 `17-结构账本` 原型画布的「热力场」——alpha 热度＋软边界椭圆，逐帧常驻，不碰鼠标图也一直轻轻在漂；拖件＝加热，**按下即按住、松手才放开**（v1.7 起点取实时坐标，长按/久置后抓取不再回跳），松手后交回物理继续（v1.6 起不再钉住，无「固定」）；顶栏「物理」暂停/继续；增删件、改名、拉连接、装域、外部改板子都会**自动整理并提示「物理：自动整理了 N 个件」**。左栏「域」可双击改名、⋯ 菜单单行编辑；**v1.8 起可多选**（`Ctrl/Cmd` 加选、`Shift` 范围选，与画布高亮同步），选中后出「已选 N 个域」批量条，整批改状态／装入·移出父域／加清标签／删除。v1.7 起空闲自动降到 30fps 并按 0.5px 粒度重画，页面隐藏时暂停。**v1.9 起物理关＝真关**：暂停后任何入口（含「重排」）都不会把场重新点着；重排只把力导向新布局静态摆上并落盘，再打开物理从新布局起跑。**v1.10 起暂停下点一下不挪件**：没过 3px 拖拽阈值不算拖（点击/手抖不再把件挪几像素），拖拽起点取画面实际坐标，重排/撤销后再点也不会弹回旧位置。**v1.11 起便签不参与连线的 UI 收口**：选中便签时「连线」置灰并提示用「挂住」，连线菜单只列当前端点合法的类型，便签当端点时中文提示、不弹菜单。**v1.12 起「看得见关系」**：悬停一个件亮起它连的线并标类型（其余淡出），选中任一端也亮线；底栏八型图例可点只看一型（再点/Esc 取消）；搜索认连接类型；落差/左栏定位后 1 跳聚焦（邻域亮、其余淡出，点空白/Esc 退）；左栏行悬停联动画布。**v1.13 修连线标签**：类型标签单独一层画在节点之上，位置由物理帧每帧贴回自己的线（中点被卡片挡住时沿线找空位），不再漂到别处或被遮挡。**v1.15 起「桌边消息」**：底栏命令条把「选中件＋一句话」发到当前 DSH 会话（官方客户端会话层直发，宿主契约未动）：选中件自动成 chips，`Ctrl+Enter` 发送，`/` 本地指令（scan/fit/export/focus/filter/help），回执显示已收到／运行中／错误码。**v1.14 起「看见改动」**：每次写板宿主记一批（journal 每条带 `batch`、`history/` 存动手前快照），底栏上方一条珠子时间轴（每批一颗，`+新增 / ~变化 / −删除`，点珠＝该批切片），未读角标（新/改/删 + 冲突 `!`，自「标记已读」，每件最多 3 个），变更抽屉（按 域/块/连接/便签 分组、行内复制证据），「撤销最近一批」走 `/revert` 把板子+坐标退回那批动手之前（回滚本身也记一批）。**v1.16 起「计划与图层」**：域补**完成判据** `criteria`（一句可检验的「什么算落地」，进域录）；计划块可**一键拆**（一个域 → N 个计划块，自动 `plans`）；`scan` 后给「计划块 × 新实块」的**落地建议**（一键 `grounds`）；左栏**计划视图**按层列 空承诺／未落地／未标注（每层计数）；**层板**＝人／agent／程序（色点·件数·显隐；程序层是事实底盘），**统一可见性优先级**（层显隐硬过滤，搜索／聚焦／切片只调透明度）；改他层的域／计划块只读（`layer-readonly`），「提一份我的说法」＝自己层新说法＋`relates`／`contradicts` **提案**；**域内视图**（范围查询＋输入/输出桩）。**v1.17 起「性能 A 组：载荷与接口」**：面板轮询先 `GET /rev`（300 块 331B 恒定，原来每 9 秒拉 224KB 全量）；`/ops` 纯 move 只回 `{rev,layout,changed,layoutOnly}`（wire 1.6KB、客户端不重渲染整图）；`GET /state?parts=` 分段；`GET /history?since|batch=` 增量摘要与单批详情（`/state` 历史只带摘要，历史详情懒取；index 最近 20 批留 diff、10 批留 labels）；宿主读缓存（`board.json` mtime+size 校验、写路径失效）；大 JSON 响应按 `accept-encoding` 走 gzip（`/state` wire 20.0KB、改一块 20.4KB）。`structure_desk` 工具行为不变。
- **智能体**：工具 `structure_desk`（`read` / `gaps` / `brief` / `write` / `scan` / `export`），一次能写一批 op，分域可以一口气建几个域盖几十块；v1.16 起 read 带 `criteria`／`gaps.byLayer`、scan 回 `suggestions`，改人的说法会被层守卫拒绝（改用提案）。

宿主是唯一写入点：客户端发 op，宿主校验并落盘、写 journal、回新状态；两边靠修订号（`rev`）防互相覆盖。

## 盘上

```
<项目>/结构蓝图/
├── board.json     语义资产
├── layout.json    坐标（可删）
├── journal.jsonl  逐次改动（只追加，每条带 batch）
├── history/       最近 50 批动手前快照 + index.json（可删）
├── 简报.md        给智能体的一页
└── 域录.md        给人读的全录
```

## 装

```text
# 把本仓库克隆/解压到任意目录后，把目录路径交给 plugin_manager：
plugin_manager { action: "install_bundle", target: "<绝对路径>/dsh-structure-desk" }
```

（在结构台项目工作区里，它是 `18-结构台/dsh-structure-desk`；本仓库即该目录的独立发布。）

已安装后再改宿主半边代码，需要重载插件行（`include:structure-desk`）或重启 DSH；浏览器半边改完刷新页面即可。

## 调试口（只读，不影响数据）

```js
window.__sdPerf()        // 帧间隔 / 物理 / 派生 / DOM 写入 的 p50/p95、longTasks、nodes/edges、rafFrames（F 组仪表）
window.__sdPerfReset()   // 清空采样缓冲
window.__sdPhysDbg()     // 物理内部状态（v1.17）
window.__sdStoreDbg()    // board / layout / rev 引用（v1.17）
window.__sdPollDbg()     // 轮询计数：revPolls / stateFetches / lastRev（v1.17）
```

## 结构

| 文件 | 角色 |
|---|---|
| `lib/index.js` | 宿主入口：挂 HTTP 口子 ＋ 注册工具 |
| `lib/core.js` | 板子语义层（纯函数）：op 应用、八型连接校验、四种落差、层守卫、scan 落地建议 |
| `lib/store.js` | 落盘：读写／原子写／journal（batch）／历史快照与回滚／最近项目／扫描对账；v1.17 加读缓存（mtime+size 校验）、`/rev` 轻量状态、历史 since/batch 与索引瘦身 |
| `lib/api.js` | `/structure-desk/api`：state·ops·scan·export·brief·history·revert；v1.17 加 `/rev`、`/state?parts`、`/history?since|batch`、move-only 回包、gzip |
| `lib/scan.js` | 项目扫描（文件级，跳过依赖与二进制） |
| `lib/brief.js` | 两页 Markdown（简报／域录；域录带完成判据），纯函数 |
| `lib/tools.js` | 智能体工具 `structure_desk` |
| `lib/client.js` | 浏览器半边：一整页画布 UI |
| `tests/` | scan／brief／history／criteria／layer／api-incremental 单测（node --test，57 项） |

## 测试

```powershell
node --test --test-isolation=none                          # 全部单测（57 项，Node >= 22）
node --test --test-isolation=none tests/history.test.mjs   # 单个文件（不 spawn 子进程）
```

宿主 HTTP 验收脚本（`host-check-v116/v117`）与浏览器验收（stage v26/v27）在结构台项目工作区的 `18-结构台/tools/` 下，不随本仓库发布。
