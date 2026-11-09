// 结构台 · 浏览器半边
// 一整页：顶栏 · 左栏（概览／落差／域树／便签／动静）· 画布 · 右栏检视器 · 底栏。
// 板和坐标都住盘上；这里只负责画、点、拖，以及把改动排成 op 发给宿主。

window.__ModuleLoader__.load({
  id: 'dsh-structure-desk',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const PANEL_ID = 'structure-desk'
    const API = '/structure-desk/api'
    const LS_PROJECT = 'sd.project'
    const LS_VIEW = 'sd.view.'
    // v1.14：角标基线＝「上次看到哪一版」；只在这个项目第一次打开时初始化，之后靠「标记已读」推进。
    const LS_SEEN = 'sd.seen.'
    // v1.16：层显隐按项目记在本地（人/agent/程序 三层的眼睛开关）。
    const LS_LAYERS = 'sd.layers.'
    const LABEL = '结构台'
    // 底栏显示的客户端版本：页面里不是这个版本，说明载入的是旧 bundle（浏览器缓存了旧 URL），
    // 需要 Ctrl+Shift+R 硬刷新或重启 DSH 才能换掉。
    const BUILD = 'v1.17 · 2026-11-09'
    try {
      window.__sdBuild = BUILD
    } catch {
      // 没有 window 就算了（理论上不会）
    }

    // ── v1.17 F 组：轻量帧仪表（非用户可见；默认常开，只记数字，无 DOM/网络开销）──
    // 环形缓冲最近 ~240 帧；window.__sdPerf() 只读汇总，window.__sdPerfReset() 清空。
    // 三段口径（A 组不拆渲染架构，故 DOM 段记「写入次数」而不是 ms）：
    //   physicsMsPerFrame ＝ physicsStep 耗时；
    //   deriveMsPerFrame   ＝ paintSim 段（一帧的几何派生 + DOM 提交，暂未拆开）；
    //   domWritesPerFrame  ＝ paintSim 里实际写 style/attribute 的次数（sim.paintWrites 增量）。
    // BUILD 不因这个测量件变化（仍 v1.17）。
    const PERF_SAMPLES = 240
    const perfNow = () => {
      try {
        if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') return performance.now()
      } catch {
        // 没有 performance 就退回 Date.now
      }
      return Date.now()
    }
    const perf = {
      frameMs: [],
      physicsMs: [],
      deriveMs: [],
      domWrites: [],
      longTasks: [],
      rafFrames: 0,
      idle: true,
      nodes: 0,
      edges: 0,
      lastPaintWrites: 0,
      lastFrameAt: 0,
    }
    function perfPush(list, value) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return
      list.push(value)
      if (list.length > PERF_SAMPLES) list.splice(0, list.length - PERF_SAMPLES)
    }
    function percentileOf(list, p) {
      if (!Array.isArray(list) || !list.length) return 0
      const sorted = list.slice().sort((a, b) => a - b)
      const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
      return Math.round(sorted[index] * 1000) / 1000
    }
    function perfSummary() {
      return {
        build: BUILD,
        nodes: perf.nodes,
        edges: perf.edges,
        frameMs: { p50: percentileOf(perf.frameMs, 50), p95: percentileOf(perf.frameMs, 95), samples: perf.frameMs.length },
        longTasks: perf.longTasks.slice(-20).map((item) => ({ start: Math.round(item.start), dur: Math.round(item.dur * 100) / 100 })),
        physicsMsPerFrame: { p50: percentileOf(perf.physicsMs, 50), p95: percentileOf(perf.physicsMs, 95) },
        deriveMsPerFrame: { p50: percentileOf(perf.deriveMs, 50), p95: percentileOf(perf.deriveMs, 95) },
        domWritesPerFrame: { p50: percentileOf(perf.domWrites, 50), p95: percentileOf(perf.domWrites, 95) },
        rafFrames: perf.rafFrames,
        idle: perf.idle,
      }
    }
    function perfReset() {
      for (const key of ['frameMs', 'physicsMs', 'deriveMs', 'domWrites', 'longTasks']) perf[key].length = 0
      perf.rafFrames = 0
      perf.lastPaintWrites = 0
      perf.lastFrameAt = 0
      return true
    }
    try {
      window.__sdPerf = perfSummary
      window.__sdPerfReset = perfReset
    } catch {
      // 没有 window 就算了（Node 自检环境）
    }
    // longtask：浏览器有 PerformanceObserver 才记；不可用就空数组，不影响其它指标
    try {
      if (typeof PerformanceObserver === 'function') {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) perf.longTasks.push({ start: entry.startTime, dur: entry.duration })
          if (perf.longTasks.length > 20) perf.longTasks.splice(0, perf.longTasks.length - 20)
        })
        observer.observe({ entryTypes: ['longtask'] })
      }
    } catch {
      // 有的环境不支持 longtask，忽略
    }

    // ── 词汇表 ──────────────────────────────────────────────────────
    const LINK_META = {
      covers: { label: '覆盖', color: 'var(--sd-cover)', dash: '' },
      refines: { label: '细化', color: 'var(--sd-refine)', dash: '6 4' },
      contradicts: { label: '矛盾', color: 'var(--sd-conflict)', dash: '5 4' },
      depends: { label: '依赖', color: 'var(--sd-dep)', dash: '' },
      calls: { label: '调用', color: 'var(--sd-call)', dash: '2 4' },
      plans: { label: '计划', color: 'var(--sd-plan)', dash: '6 4' },
      grounds: { label: '落地', color: 'var(--sd-ground)', dash: '2 4' },
      relates: { label: '关联', color: 'var(--sd-weak)', dash: '' },
    }
    const LINK_ORDER = ['covers', 'plans', 'grounds', 'refines', 'depends', 'calls', 'contradicts', 'relates']
    // 八型连接两端允许的件类型：与宿主 core.js 的 LINK_TYPES 保持一致。
    // 客户端只用它过滤「连哪种」菜单、在点端点时给中文提示；最终校验仍在宿主。
    const LINK_ENDS = {
      covers: { from: ['domain'], to: ['domain', 'block'] },
      refines: { from: ['domain'], to: ['domain'] },
      contradicts: { from: ['domain', 'block'], to: ['domain', 'block'] },
      depends: { from: ['block'], to: ['block'] },
      calls: { from: ['block'], to: ['block'] },
      plans: { from: ['domain'], to: ['block'] },
      grounds: { from: ['block'], to: ['block'] },
      relates: { from: ['domain', 'block'], to: ['domain', 'block'] },
    }
    const KIND_LABEL = { domain: '域', block: '块', note: '便签', link: '连接' }
    const STATUS_META = {
      solid: { label: '实', hint: '说法站得住' },
      thin: { label: '薄', hint: '只说得住一半' },
      rift: { label: '裂', hint: '两处说法打架' },
      open: { label: '空', hint: '先说了，还没落地' },
    }
    const AUTHOR_META = {
      human: { label: '人', mark: '●' },
      agent: { label: '智能体', mark: '◆' },
      program: { label: '程序', mark: '▪' },
    }
    // v1.16：层＝说法归属（人层／agent 层是说法层，程序层是事实底盘）。
    // 色点沿用契约口径：人=青、agent=紫、程序=灰；层板与画布描边都取这里。
    const LAYER_META = {
      human: { label: '人', color: 'var(--sd-layer-human)', hint: '人的说法与计划（面板当前编辑层）' },
      agent: { label: 'agent', color: 'var(--sd-layer-agent)', hint: 'agent 的说法与计划；面板里只读，用「提一份我的说法」提案' },
      program: { label: '程序', color: 'var(--sd-layer-program)', hint: '扫描出的事实底盘（实块与批次），不当作可编辑说法层' },
    }
    const LAYER_ORDER = ['human', 'agent', 'program']
    // 面板固定以人层为当前编辑层（agent 只从工具写）。
    const CURRENT_LAYER = 'human'

    /** 件的层（不新增字段，由 author 导出；和宿主 core.js 的 layerOf 同口径）。 */
    function layerOf(item) {
      if (!item) return 'program'
      if (item.author === 'agent') return 'agent'
      if (item.author === 'program') return 'program'
      return 'human'
    }

    /** 只读守卫只作用于「说法/计划」两类件：域与计划块；实块（程序层）维持现状。 */
    function isGuardedItem(entry) {
      if (!entry || !entry.item) return false
      if (entry.kind === 'domain') return true
      if (entry.kind === 'block' && entry.item.planned) return true
      return false
    }

    /** 这个件是不是「别人层的说法/计划」（人层/agent 层且不是当前编辑层）→ 检视器只读。 */
    function guardInfoOf(entry) {
      if (!isGuardedItem(entry)) return { readonly: false, layer: null }
      const layer = layerOf(entry.item)
      return { readonly: (layer === 'agent' || layer === 'human') && layer !== CURRENT_LAYER, layer }
    }
    const GAP_META = [
      { key: 'unannotated', label: '未标注', hint: '块还没人管（中性）' },
      { key: 'ungrounded', label: '空承诺', hint: '域还没盖住什么（中性）' },
      { key: 'planOpen', label: '未落地', hint: '蓝图块还没实现' },
      { key: 'conflicts', label: '矛盾', hint: '两处说法打架' },
    ]
    const BLOCK_W = 172
    const BLOCK_H = 64
    const NOTE_W = 200
    const DOMAIN_H = 34
    const MARGIN = 80

    // ── 小工具 ──────────────────────────────────────────────────────
    const cx = (...xs) => xs.filter(Boolean).join(' ')

    /** 某域往下所有子域 id（不含自己）。 */
    function descendantsOf(board, id) {
      const out = new Set()
      const walk = (parent) => {
        for (const domain of board.domains) {
          if (domain.parent !== parent || out.has(domain.id)) continue
          out.add(domain.id)
          walk(domain.id)
        }
      }
      walk(id)
      return out
    }

    /**
     * v1.12：一个件的「1 跳」邻域。
     * 节点＝自己 ＋ 连着它的件（双向）＋ 装域的父/子域 ＋ 挂在自己身上的便签；
     * 连接＝自己 ＋ 两端。传入的 id 已经不在板子上时返回 null（别把整张图全淡掉）。
     */
    function oneHopIds(board, id) {
      if (!board || !id) return null
      const set = new Set([id])
      if (String(id).startsWith('L')) {
        const link = board.links.find((l) => l.id === id)
        if (!link) return null
        set.add(link.from)
        set.add(link.to)
        return set
      }
      const known = board.domains.some((d) => d.id === id) || board.blocks.some((b) => b.id === id) || board.notes.some((n) => n.id === id)
      if (!known) return null
      for (const link of board.links) {
        if (link.from === id) set.add(link.to)
        else if (link.to === id) set.add(link.from)
      }
      const domain = board.domains.find((d) => d.id === id)
      if (domain) {
        if (domain.parent) set.add(domain.parent)
        for (const child of board.domains) if (child.parent === id) set.add(child.id)
      }
      for (const note of board.notes) if (note.ref === id) set.add(note.id)
      return set
    }

    // ── 桌边消息（v1.15）───────────────────────────────────────────
    // P0 探针结论：DSH 页面里现成有客户端会话服务 `sessions`，官方聊天输入框走的就是
    // `sessions.using(id, {source}) → binding.session.prompt([{type:'text',text}], 'queue')`。
    // 宿主没有「当前会话」概念，所以 session id 在页面这边取（三级回退）。
    const LOCAL_BAR_COMMANDS = [
      { cmd: '/scan', hint: '扫描项目，把文件收成块' },
      { cmd: '/fit', hint: '适应视口' },
      { cmd: '/export', hint: '导出 简报.md / 域录.md' },
      { cmd: '/focus', hint: '1 跳聚焦：/focus B12 或 /focus 画布与热力场' },
      { cmd: '/filter', hint: '只看某型连接：/filter 矛盾；/filter 全部' },
      { cmd: '/changes', hint: '看最近改动：角标、时间轴、变更抽屉' },
      { cmd: '/help', hint: '快捷键与词汇表' },
    ]
    const FILTER_ALIAS = { 覆盖: 'covers', 细化: 'refines', 矛盾: 'contradicts', 依赖: 'depends', 调用: 'calls', 计划: 'plans', 落地: 'grounds', 关联: 'relates' }

    function newRequestId() {
      try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
      } catch {
        // 老浏览器没有 randomUUID 就走下面
      }
      return `sd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    }

    /** 当前会话：uiSession（内部服务）→ sessions.list 的 mainView 约定 → uiWorkspace 记忆。 */
    function deskSession(ctx) {
      const out = { id: null, via: null, title: '', running: false, service: null }
      let sessions = null
      try {
        sessions = ctx && typeof ctx.get === 'function' ? ctx.get('sessions') : null
      } catch {
        sessions = null
      }
      out.service = sessions || null
      try {
        const ui = ctx && typeof ctx.get === 'function' ? ctx.get('uiSession') : null
        const snapshot = ui && ui.current && typeof ui.current.getSnapshot === 'function' ? ui.current.getSnapshot() : null
        if (snapshot && snapshot.key) {
          out.id = snapshot.key
          out.via = 'uiSession'
        }
      } catch {
        // 内部服务没拿到就退下一级
      }
      if (!out.id && sessions && sessions.list && typeof sessions.list.getSnapshot === 'function') {
        try {
          const list = sessions.list.getSnapshot()
          const rows = Object.values((list && list.byId) || {})
          const hit = rows.find((row) => row && (((row.retainedBy && row.retainedBy.mainView) || 0) > 0))
          if (hit) {
            out.id = hit.id || hit.sessionId
            out.via = 'mainView'
          }
        } catch {
          // 列表还没来
        }
      }
      if (!out.id && ctx && typeof ctx.get === 'function') {
        try {
          const workspace = ctx.get('uiWorkspace')
          const selection = workspace && workspace.selection && typeof workspace.selection.getSnapshot === 'function' ? workspace.selection.getSnapshot() : null
          if (selection && selection.sessionId) {
            out.id = selection.sessionId
            out.via = 'uiWorkspace'
          }
        } catch {
          // 可选服务
        }
      }
      if (out.id && sessions && sessions.list && typeof sessions.list.getSnapshot === 'function') {
        try {
          const row = sessions.list.getSnapshot().byId[out.id]
          if (row) {
            out.title = row.displayTitle || row.title || ''
            out.running = Boolean(row.running)
          }
        } catch {
          // 标题拿不到不影响发
        }
      }
      return out
    }

    /** 把选中件拍成一段模型能直接读的中文上下文；prompt 不收路径附件，只能文本化。 */
    function packDeskContext({ question, store, selectedItems, focusId, typeFilter }) {
      const board = store && store.board
      const stats = store && store.stats
      const lines = [String(question || '').trim(), '', '—— 结构台上下文（面板底部消息条发送）——']
      if (store && store.project) lines.push(`项目：${store.project.path}`)
      if (stats) lines.push(`板子：rev ${(store && store.rev) || '（空板）'} · 域 ${stats.domains} / 块 ${stats.blocks} / 连接 ${stats.links} / 便签 ${stats.notes}`)
      if (focusId) lines.push(`当前聚焦：${focusId}`)
      if (typeFilter) lines.push(`连接筛选：只看「${(LINK_META[typeFilter] || {}).label || typeFilter}」（其余淡出）`)
      const items = Array.isArray(selectedItems) ? selectedItems : []
      if (items.length) {
        lines.push(`选中 ${items.length} 件：`)
        for (const entry of items.slice(0, 20)) {
          const item = entry.item || {}
          if (entry.kind === 'domain') {
            const status = (STATUS_META[item.status] || {}).label
            const statement = item.statement ? `｜${String(item.statement).replace(/\s+/g, ' ').slice(0, 120)}` : ''
            lines.push(`- 域 ${item.id}「${item.title}」${status ? ` · ${status}` : ''}${statement}`)
          } else if (entry.kind === 'block') {
            const marks = `${item.planned ? '（计划）' : ''}${item.stale ? '（失联）' : ''}`
            const note = item.note ? `｜${String(item.note).replace(/\s+/g, ' ').slice(0, 120)}` : ''
            lines.push(`- 块 ${item.id} ${item.address}${marks}${note}`)
          } else if (entry.kind === 'note') {
            lines.push(`- 便签 ${item.id}${item.ref ? `（挂 ${item.ref}）` : ''}｜${String(item.text || '').replace(/\s+/g, ' ').slice(0, 120)}`)
          } else if (entry.kind === 'link') {
            const meta = LINK_META[item.type] || { label: item.type }
            lines.push(`- 连接 ${item.id}：${item.from} —「${meta.label}」→ ${item.to}${item.note ? `｜${item.note}` : ''}`)
          }
        }
        if (items.length > 20) lines.push(`（另有 ${items.length - 20} 件没列出）`)
      }
      if (board) lines.push(`（板子文件：${(store.project && store.project.path) || '项目'}/结构蓝图/board.json；用 structure_desk 工具读写，改完这桌会自己同步。）`)
      return lines.join('\n')
    }

    /** 发到当前会话：就是官方聊天输入框那条路（sessions.using → session.prompt）。 */
    async function sendToDshSession(ctx, text) {
      const info = deskSession(ctx)
      if (!info.service || typeof info.service.using !== 'function') {
        return { ok: false, code: 'no-service', message: '这个 DSH 组合没加载会话服务（sessions），先升级 DSH' }
      }
      if (!info.id) return { ok: false, code: 'no-session', message: '没找到当前会话：先在主界面打开一个对话' }
      try {
        return await info.service.using(info.id, { source: 'structureDesk' }, async (reference) => {
          await reference.ready
          const session = reference.binding.session
          const echo = typeof session.beginSubmission === 'function' ? session.beginSubmission({ mode: 'queue', text, attachments: [] }) : null
          const requestId = echo ? echo.requestId : newRequestId()
          const result = await session.prompt([{ type: 'text', text }], 'queue', undefined, requestId)
          if (!result || result.ok !== true) {
            if (echo) {
              try {
                echo.abandon()
              } catch {
                // 已经退休也无妨
              }
            }
            const error = result && result.error ? result.error : {}
            const failure = new Error(error.message || '发送失败')
            failure.code = error.code || 'send-failed'
            throw failure
          }
          return { ok: true, sessionId: info.id, via: info.via, title: info.title, requestId }
        })
      } catch (error) {
        return { ok: false, code: (error && error.code) || 'send-failed', message: (error && error.message) || String(error) }
      }
    }

    /** 底部 chips 的短标签。 */
    function chipLabel(kind, item) {
      if (kind === 'domain') return item.title || item.id
      if (kind === 'block') return item.address || item.id
      if (kind === 'note') return String(item.text || '').replace(/\s+/g, ' ').slice(0, 18) || item.id
      if (kind === 'link') return `${item.from}→${item.to}`
      return item.id
    }

    // ── 看见改动（v1.14）──────────────────────────────────────────
    // 一次写板 = 一批。角标只看「自上次已读」之后的批；时间轴显示全部（含人和智能体）；
    // 点一颗珠＝该批切片；撤销最近一批走宿主 /revert（整板+坐标回到那批动手之前）。
    const CHANGE_META = {
      added: { label: '新', mark: '+', cls: 'new' },
      updated: { label: '改', mark: '~', cls: 'changed' },
      removed: { label: '删', mark: '−', cls: 'removed' },
    }
    const CHANGE_KIND_ORDER = ['added', 'updated', 'removed']
    const BATCH_OP_LABEL = { scan: '扫描', replace: '整板替换', revert: '回滚', batch: '批量', ops: '改动' }
    const BEAD_GAP = 58
    const BEAD_PAD = 120

    function changeKindOfItem(id) {
      if (String(id).startsWith('D')) return 'domain'
      if (String(id).startsWith('B')) return 'block'
      if (String(id).startsWith('L')) return 'link'
      if (String(id).startsWith('N')) return 'note'
      return 'other'
    }

    /** 一批里改了几件（给珠子上的三个数字）。
     * v1.17（A3）：/state 的历史只剩摘要，数字优先读摘要里的 counts；旧宿主摘要带 diff 时仍可用。 */
    function batchBeadCounts(batch) {
      const counts = batch && batch.counts
      if (counts && typeof counts === 'object') {
        return {
          added: Number(counts.added) || 0,
          changed: Number(counts.updated) || 0,
          removed: Number(counts.removed) || 0,
        }
      }
      const diff = (batch && batch.diff) || {}
      return {
        added: (diff.added || []).length,
        changed: (diff.updated || []).length,
        removed: (diff.removed || []).length,
      }
    }

    /** 角标最多 3 个：新/改/删 + 冲突 !（同一类多次只显示一个，次数进 title）。 */
    function badgeMarksOf(marks, conflict) {
      const out = []
      if (marks && marks.added) out.push({ key: 'new', text: '+', label: `新 ${marks.added} 次` })
      if (marks && marks.updated) out.push({ key: 'changed', text: '~', label: `改 ${marks.updated} 次` })
      if (marks && marks.removed) out.push({ key: 'removed', text: '−', label: `删 ${marks.removed} 次` })
      if (conflict) out.push({ key: 'conflict', text: '!', label: '有「矛盾」连接' })
      return out.slice(0, 3)
    }

    function batchTime(at) {
      if (!at) return ''
      const date = new Date(at)
      if (Number.isNaN(date.getTime())) return String(at).slice(11, 19)
      const pad = (n) => String(n).padStart(2, '0')
      return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    }

    function batchHeading(batch) {
      const op = (batch && batch.op) || 'ops'
      const kind = BATCH_OP_LABEL[op] || op
      return `${batchTime(batch && batch.at)} · ${kind}${batch && batch.reverted ? '（回退一批）' : ''}`
    }

    function textWidth(text, size = 13) {
      let w = 0
      for (const ch of String(text || '')) w += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? size : size * 0.56
      return w
    }
    function domainSize(domain) {
      const w = Math.max(96, Math.min(300, textWidth(domain.title, 13) + 46))
      return { w, h: DOMAIN_H }
    }
    function nodeBox(kind, item, sizes) {
      if (kind === 'domain') return domainSize(item)
      if (kind === 'note') {
        const size = sizes && sizes[item.id]
        return { w: size ? size.w : NOTE_W, h: size ? size.h : NOTE_MIN_H }
      }
      return { w: BLOCK_W, h: BLOCK_H }
    }
    const NOTE_MIN_H = 84

    /**
     * v1.16 域内视图的输入/输出桩几何：从界内的盒子边缘朝界外节点方向伸出一小截虚线。
     * b 是界外节点盒子（没画时给 null，按 +x 方向画）。
     */
    function stubGeometry(a, b) {
      const ax = a.x + a.w / 2
      const ay = a.y + a.h / 2
      let dx = 1
      let dy = 0
      if (b) {
        const bx = b.x + b.w / 2
        const by = b.y + b.h / 2
        const len = Math.hypot(bx - ax, by - ay)
        if (len > 1) {
          dx = (bx - ax) / len
          dy = (by - ay) / len
        }
      }
      const sx = ax + dx * (a.w / 2 + 6)
      const sy = ay + dy * (a.h / 2 + 6)
      const ex = Math.round(sx + dx * 30)
      const ey = Math.round(sy + dy * 30)
      return {
        d: `M${Math.round(sx)},${Math.round(sy)} L${ex},${ey}`,
        ex,
        ey,
        transform: `translate(${ex} ${ey})`,
      }
    }

    async function apiGet(route, params) {
      const query = new URLSearchParams(params || {}).toString()
      const response = await fetch(`${API}${route}${query ? `?${query}` : ''}`, { cache: 'no-store' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw Object.assign(new Error(body.error || `HTTP ${response.status}`), { status: response.status, body })
      return body
    }
    async function apiPost(route, payload) {
      const response = await fetch(`${API}${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload || {}),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw Object.assign(new Error(body.error || `HTTP ${response.status}`), { status: response.status, body })
      return body
    }

    /** 路径的上一级目录名（项目 chip 上显示，省地方）。 */
    function parentName(fullPath) {
      if (typeof fullPath !== 'string') return ''
      const parts = fullPath.replace(/[\\/]+$/, '').split(/[\\/]/)
      return parts.length >= 2 ? parts[parts.length - 2] : ''
    }

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value))
    }

    /** 板子 → 坐标（缺的先用自动布局补）。 */
    function mergePositions(board, layout) {
      const stored = (layout && layout.pos) || {}
      const out = {}
      const missing = []
      for (const item of [...board.domains, ...board.blocks, ...board.notes]) {
        const pos = stored[item.id]
        if (pos && Number.isFinite(pos.x)) out[item.id] = { x: pos.x, y: pos.y }
        else missing.push(item)
      }
      return { positions: out, missing }
    }

    /** 力导向：确定性初值（圆周）＋ 弹簧／斥力／向心。 */
    function autoLayout(board) {
      const nodes = []
      for (const domain of board.domains) nodes.push({ id: domain.id, ...domainSize(domain) })
      for (const block of board.blocks) nodes.push({ id: block.id, w: BLOCK_W, h: BLOCK_H })
      if (!nodes.length) return {}
      const index = new Map(nodes.map((node, i) => [node.id, i]))
      const radius = Math.max(180, nodes.length * 14)
      const pos = nodes.map((node, i) => ({
        x: Math.cos((i / nodes.length) * Math.PI * 2) * radius,
        y: Math.sin((i / nodes.length) * Math.PI * 2) * radius,
      }))
      const links = board.links
        .map((link) => ({ a: index.get(link.from), b: index.get(link.to), type: link.type }))
        .filter((link) => link.a !== undefined && link.b !== undefined)
      const target = { covers: 180, plans: 150, grounds: 150, refines: 190, depends: 140, calls: 140, contradicts: 270, relates: 210 }
      for (let step = 0; step < 240; step++) {
        const force = pos.map(() => ({ x: 0, y: 0 }))
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            let dx = pos[i].x - pos[j].x
            let dy = pos[i].y - pos[j].y
            let dist = Math.hypot(dx, dy)
            if (dist < 1) {
              dx = (i % 3) - 1
              dy = (j % 3) - 1
              dist = 1
            }
            const min = (nodes[i].w + nodes[j].w) / 2 + 40
            const strength = 24000 / (dist * dist) + (dist < min ? (min - dist) * 0.7 : 0)
            const fx = (dx / dist) * strength
            const fy = (dy / dist) * strength
            force[i].x += fx
            force[i].y += fy
            force[j].x -= fx
            force[j].y -= fy
          }
        }
        for (const link of links) {
          const a = pos[link.a]
          const b = pos[link.b]
          const dx = b.x - a.x
          const dy = b.y - a.y
          const dist = Math.hypot(dx, dy) || 1
          const goal = target[link.type] || 180
          const strength = (dist - goal) * 0.055
          const fx = (dx / dist) * strength
          const fy = (dy / dist) * strength
          force[link.a].x += fx
          force[link.a].y += fy
          force[link.b].x -= fx
          force[link.b].y -= fy
        }
        for (let i = 0; i < nodes.length; i++) {
          force[i].x -= pos[i].x * 0.006
          force[i].y -= pos[i].y * 0.006
          pos[i].x += force[i].x * 0.9
          pos[i].y += force[i].y * 0.9
        }
      }
      let minX = Infinity
      let minY = Infinity
      for (let i = 0; i < nodes.length; i++) {
        pos[i].x -= nodes[i].w / 2
        pos[i].y -= nodes[i].h / 2
        minX = Math.min(minX, pos[i].x)
        minY = Math.min(minY, pos[i].y)
      }
      const out = {}
      nodes.forEach((node, i) => {
        out[node.id] = { x: Math.round(pos[i].x - minX + MARGIN), y: Math.round(pos[i].y - minY + MARGIN) }
      })
      return out
    }

    // ── 物理：让图自己站开，省掉手动整理 ──────────────────────────
    // 节点＝软圆（半径按盒子大小取），连接＝弹簧，装域＝更强的短弹簧，
    // 再加很轻的向心力和盒子分离；阻尼到静止就收工，不空转。
    // 物理形式参考 17-结构账本 原型画布（UI场景·画布·真账本·域示例.html）：
    // 全局 alpha 热度 + 软边界椭圆 + 斥力/弹簧/向心，逐帧常驻，
    // 任何交互（拖、加件、改名、抖一抖……）把 alpha 重新加热，图就明显地动起来；
    // alpha 衰减到地板后还剩一点「温度」，所以图永远不会完全死掉。
    const PHYS = {
      repulsion: 900, // 原型 250/d*0.55，按卡片尺寸放大
      maxRepel: 3.2,
      linkStiff: 0.06,
      linkRest: { covers: 245, refines: 220, depends: 190, calls: 190, plans: 210, grounds: 210, contradicts: 330, relates: 255 },
      childStiff: 0.09,
      childRest: 150,
      noteStiff: 0.06,
      noteRest: 175,
      gravity: 0.018, // 向心（原型 0.02）
      damping: 0.86,
      maxSpeed: 4.2,
      forceScale: 0.018, // vx += fx * forceScale * (0.15 + alpha)
      alphaFloor: 0.03,
      alphaDecay: 0.995,
      tempNoise: 2.0, // 地板温度：见底后仍有一点漂移，图一直「活着」
      collide: 1.0,
      gap: 10,
      boundary: { unit: 132, rx: 1.42, ry: 0.92 }, // 软边界椭圆
      persistAt: 0.12, // alpha 降到这以下、且有改动 → 落盘一次坐标快照
      heat: { add: 1, drag: 0.65, shake: 1, arrange: 1, toggle: 0.6 },
      // v1.7 性能：渲染量化 + 空闲降频（物理仍一直活着，只是省着画）
      quantum: 0.5, // 位置量化到 0.5px；量化值没变就不写 style / SVG d
      idleAlpha: 0.05, // alpha 降到这里且没在拖动 → 空闲模式，30fps
      idleFrameGap: 1000 / 30 - 4, // 两帧间隔小于它就先不跑（rAF 60fps 时等于隔一帧）
    }

    /**
     * 一步「热力场」物理（参照 17-结构账本 原型画布的物理形式）：
     * 全局 alpha 热度 + 软边界椭圆 + 两两斥力/盒子分离 + 连接弹簧 + 向心，
     * 逐帧跑、从不「收工」；交互把 alpha 加热，图就明显地动起来。
     * 返回本帧最大速度。
     */
    function physicsStep(sim) {
      const { arr, springs, index } = sim
      const n = arr.length
      if (!n) return 0
      const factor = PHYS.forceScale * (0.15 + (sim.alpha || 0))
      // 软边界椭圆：质心与尺寸跟节点数平滑变化（原型 updateBoundary）
      let cx = 0
      let cy = 0
      for (const node of arr) {
        cx += node.x + node.w / 2
        cy += node.y + node.h / 2
      }
      cx /= n
      cy /= n
      const R = PHYS.boundary.unit * Math.sqrt(n / Math.PI)
      const rx = R * PHYS.boundary.rx
      const ry = R * PHYS.boundary.ry
      if (sim.bx === undefined) {
        sim.bx = cx
        sim.by = cy
      }
      sim.bx += (cx - sim.bx) * 0.06
      sim.by += (cy - sim.by) * 0.06
      for (const node of arr) {
        node.fx = 0
        node.fy = 0
      }
      // 两两：斥力 + 盒子交叠推开
      for (let i = 0; i < n; i++) {
        const a = arr[i]
        for (let j = i + 1; j < n; j++) {
          const b = arr[j]
          let dx = b.x + b.w / 2 - (a.x + a.w / 2)
          let dy = b.y + b.h / 2 - (a.y + a.h / 2)
          let d = Math.hypot(dx, dy)
          if (d < 1) {
            dx = (i % 7) - 3
            dy = (j % 5) - 2
            d = Math.hypot(dx, dy) || 1
          }
          const ux = dx / d
          const uy = dy / d
          const f = Math.min(PHYS.maxRepel, (PHYS.repulsion / d) * 0.55)
          a.fx -= ux * f
          a.fy -= uy * f
          b.fx += ux * f
          b.fy += uy * f
          const ox = Math.min(a.x + a.w, b.x + b.w) + PHYS.gap - Math.max(a.x, b.x)
          if (ox <= 0) continue
          const oy = Math.min(a.y + a.h, b.y + b.h) + PHYS.gap - Math.max(a.y, b.y)
          if (oy <= 0) continue
          const push = Math.min(ox, oy) * PHYS.collide
          if (ox < oy) {
            const s = ux < 0 ? -1 : 1
            a.fx -= s * push
            b.fx += s * push
          } else {
            const s = uy < 0 ? -1 : 1
            a.fy -= s * push
            b.fy += s * push
          }
        }
      }
      // 连接／装域／便签＝弹簧
      for (const spring of springs) {
        const ia = index.get(spring.from)
        const ib = index.get(spring.to)
        if (ia === undefined || ib === undefined) continue
        const a = arr[ia]
        const b = arr[ib]
        const dx = b.x + b.w / 2 - (a.x + a.w / 2)
        const dy = b.y + b.h / 2 - (a.y + a.h / 2)
        const d = Math.hypot(dx, dy) || 1
        const f = (d - spring.rest) * spring.stiff
        const ux = dx / d
        const uy = dy / d
        a.fx += ux * f
        a.fy += uy * f
        b.fx -= ux * f
        b.fy -= uy * f
      }
      // 向心 + 软边界 + 积分
      let maxSpeed = 0
      for (let i = 0; i < n; i++) {
        const node = arr[i]
        if (node.held) {
          node.vx = 0
          node.vy = 0
          continue
        }
        node.fx += (sim.bx - (node.x + node.w / 2)) * PHYS.gravity
        node.fy += (sim.by - (node.y + node.h / 2)) * PHYS.gravity
        const bnx = (node.x + node.w / 2 - sim.bx) / rx
        const bny = (node.y + node.h / 2 - sim.by) / ry
        const bnd = Math.hypot(bnx, bny) || 0.001
        if (bnd > 0.95) {
          const over = bnd - 0.95
          node.fx -= (bnx / bnd) * over * rx * 0.05
          node.fy -= (bny / bnd) * over * ry * 0.05
        }
        // 地板温度：热度见底后仍有一点漂移，图不会死
        node.fx += (Math.random() - 0.5) * PHYS.tempNoise
        node.fy += (Math.random() - 0.5) * PHYS.tempNoise
        node.vx = (node.vx + node.fx * factor) * PHYS.damping
        node.vy = (node.vy + node.fy * factor) * PHYS.damping
        let speed = Math.hypot(node.vx, node.vy)
        if (speed > PHYS.maxSpeed) {
          node.vx = (node.vx / speed) * PHYS.maxSpeed
          node.vy = (node.vy / speed) * PHYS.maxSpeed
          speed = PHYS.maxSpeed
        }
        node.x += node.vx
        node.y += node.vy
        if (speed > maxSpeed) maxSpeed = speed
      }
      sim.alpha = Math.max(PHYS.alphaFloor, (sim.alpha || 0) * PHYS.alphaDecay)
      sim.lastTravel = maxSpeed
      return maxSpeed
    }

    /**
     * 收尾分离：只按盒子把重叠推开，不掺弹簧（弹簧会让它弹回去）。
     * 用「沿中心连线径向推」而不是换轴推——三件互相压着时换轴推会来回弹，
     * 径向推总能收敛；推开量取 max(ox, oy)，保证至少一个轴上分得开。
     */
    function resolveOverlaps(arr, gap = 16, passes = 240) {
      for (let pass = 0; pass < passes; pass++) {
        let moved = false
        for (let i = 0; i < arr.length; i++) {
          for (let j = i + 1; j < arr.length; j++) {
            const a = arr[i]
            const b = arr[j]
            // 左上角坐标：按真实盒子相交量判重叠，宽度不等时也不会漏（D10）
            const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
            if (ox <= 0) continue
            const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
            if (oy <= 0) continue
            moved = true
            let dx = b.x + b.w / 2 - (a.x + a.w / 2)
            let dy = b.y + b.h / 2 - (a.y + a.h / 2)
            let dist = Math.hypot(dx, dy)
            if (dist < 0.001) {
              const angle = (pass + i * 7 + j * 13) * 0.7
              dx = Math.cos(angle)
              dy = Math.sin(angle)
              dist = 1
            }
            const ux = dx / dist
            const uy = dy / dist
            // 推开量把边距一起带上：分开后读得清，不会刚好贴住
            const push = (Math.max(ox, oy) + gap) / 2
            a.x -= ux * push
            a.y -= uy * push
            b.x += ux * push
            b.y += uy * push
          }
        }
        if (!moved) break
      }
    }

    /** 某域的所有后代域 id（包括自己）。 */
    function descendantDomainIds(board, id) {
      const out = new Set([id])
      const walk = (parent) => {
        for (const domain of board.domains) {
          if (domain.parent !== parent || out.has(domain.id)) continue
          out.add(domain.id)
          walk(domain.id)
        }
      }
      walk(id)
      return out
    }

    /** 由世界坐标直接算「适应视口」的视口参数；不依赖 DOM 渲染时序。 */
    function fitViewFor(positions, board, sizes, canvas) {
      if (!canvas || !board) return null
      const width = canvas.clientWidth || canvas.getBoundingClientRect().width
      const height = canvas.clientHeight || canvas.getBoundingClientRect().height
      if (!width || !height) return null
      const boxes = collectBoxes(board, positions, sizes)
      if (!boxes.length) return null
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const box of boxes) {
        minX = Math.min(minX, box.x)
        minY = Math.min(minY, box.y)
        maxX = Math.max(maxX, box.x + box.w)
        maxY = Math.max(maxY, box.y + box.h)
      }
      const pad = 60
      const zoom = clamp(Math.min((width - pad * 2) / (maxX - minX || 1), (height - pad * 2) / (maxY - minY || 1)), 0.22, 1.6)
      return {
        zoom,
        x: width / 2 - ((minX + maxX) / 2) * zoom,
        y: height / 2 - ((minY + maxY) / 2) * zoom,
      }
    }

    /** 找一个空位放新件：从视口中心往外螺旋找。 */
    function freeSpot(positions, board, view, canvas) {
      const worldX = (canvas.width / 2 - view.x) / view.zoom
      const worldY = (canvas.height / 2 - view.y) / view.zoom
      const boxes = collectBoxes(board, positions)
      for (let ring = 0; ring < 40; ring++) {
        const r = ring * 56
        const count = ring === 0 ? 1 : Math.max(6, ring * 6)
        for (let i = 0; i < count; i++) {
          const angle = (i / count) * Math.PI * 2 + ring
          const x = Math.round(worldX + Math.cos(angle) * r)
          const y = Math.round(worldY + Math.sin(angle) * r)
          if (!boxes.some((box) => Math.abs(box.x - x) < 90 && Math.abs(box.y - y) < 46)) return { x, y }
        }
      }
      return { x: Math.round(worldX), y: Math.round(worldY) }
    }

    /** 每个件的世界坐标盒子。 */
    function collectBoxes(board, positions, sizes) {
      const boxes = []
      for (const domain of board.domains) {
        const size = domainSize(domain)
        const pos = positions[domain.id]
        if (pos) boxes.push({ id: domain.id, kind: 'domain', x: pos.x, y: pos.y, w: size.w, h: size.h })
      }
      for (const block of board.blocks) {
        const pos = positions[block.id]
        if (pos) boxes.push({ id: block.id, kind: 'block', x: pos.x, y: pos.y, w: BLOCK_W, h: BLOCK_H })
      }
      for (const note of board.notes) {
        const pos = positions[note.id]
        const size = nodeBox('note', note, sizes)
        if (pos) boxes.push({ id: note.id, kind: 'note', x: pos.x, y: pos.y, w: size.w, h: size.h })
      }
      return boxes
    }

    // ── 样式 ────────────────────────────────────────────────────────
    const CSS = `
.sd-root{position:relative;display:flex;flex-direction:column;height:100%;width:100%;min-height:0;overflow:hidden;
  background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);
  font-size:13px;line-height:1.5;
  --sd-cover:#4d6bfe;
  --sd-refine:#8b7cf6;--sd-conflict:var(--dsw-alias-state-error-primary);
  --sd-dep:#5b8def;--sd-call:#14b8a6;--sd-plan:#7aa2ff;--sd-ground:#3fb98a;
  --sd-weak:var(--dsw-alias-label-secondary);
  /* v1.16 层色：人=青、agent=紫、程序=灰 */
  --sd-layer-human:#22b8cf;
  --sd-layer-agent:#a78bfa;
  --sd-layer-program:#94a3b8;
  --sd-line:var(--dsw-alias-border-l1);--sd-line-strong:var(--dsw-alias-border-l2);
  --sd-node:var(--dsw-alias-bg-layer-2);--sd-panel:var(--dsw-alias-bg-layer-1);
  --sd-hover:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent);
  --sd-selected:color-mix(in srgb,var(--dsw-alias-brand-primary) 22%,transparent);
  --sd-radius:var(--dsw-radius-md,8px);
  font-family:var(--ds-font-family-text,system-ui,sans-serif);
  -webkit-font-smoothing:antialiased;
}
.sd-root *{box-sizing:border-box}
.sd-root button{font:inherit;color:inherit;background:none;border:none;cursor:pointer}
.sd-root input,.sd-root textarea,.sd-root select{font:inherit;color:inherit}
.sd-root ::-webkit-scrollbar{width:9px;height:9px}
.sd-root ::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,var(--sd-line-strong));border-radius:6px;border:2px solid transparent;background-clip:content-box}
.sd-root ::-webkit-scrollbar-track{background:transparent}

/* 顶栏 */
.sd-top{flex:none;display:flex;align-items:center;gap:10px;height:50px;padding:0 14px 0 16px;border-bottom:1px solid var(--sd-line);background:var(--sd-panel)}
.sd-brand{display:flex;align-items:center;gap:8px;font-weight:600;letter-spacing:.02em;font-size:14px;flex:none;white-space:nowrap}
.sd-tools{flex:none;white-space:nowrap}
.sd-top{container-type:inline-size}
@container (max-width: 1000px){
  .sd-search{width:120px}
  .sd-btn .lbl{display:none}
  .sd-chip span{display:none}
}
@container (max-width: 780px){
  .sd-search{display:none}
  .sd-export-lbl{display:none}
}
.sd-brand svg{color:var(--sd-cover)}
.sd-proj{display:flex;align-items:center;gap:6px;min-width:0}
.sd-chip{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border:1px solid var(--sd-line);border-radius:999px;
  background:var(--sd-node);font-size:12px;cursor:pointer;max-width:340px;transition:background .12s,border-color .12s}
.sd-chip:hover{background:var(--sd-hover);border-color:var(--sd-line-strong)}
.sd-chip b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sd-chip span{color:var(--dsw-alias-label-secondary);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left}
.sd-spacer{flex:1}
.sd-tools{display:flex;align-items:center;gap:4px}
.sd-btn{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 9px;border-radius:var(--dsw-radius-sm,6px);font-size:12px;
  color:var(--dsw-alias-label-secondary);white-space:nowrap;transition:background .12s,color .12s}
.sd-btn:hover{background:var(--sd-hover);color:var(--dsw-alias-label-primary)}
.sd-btn[data-on=true]{background:var(--sd-selected);color:var(--dsw-alias-label-primary)}
.sd-btn:disabled{opacity:.4;cursor:default}
.sd-btn.primary{background:var(--sd-cover);color:#fff}
.sd-btn.primary:hover{filter:brightness(1.08)}
.sd-sep{width:1px;height:18px;background:var(--sd-line);margin:0 4px}
.sd-search{display:flex;align-items:center;gap:6px;height:28px;padding:0 9px;border-radius:999px;border:1px solid var(--sd-line);background:var(--sd-node);width:170px}
.sd-search input{flex:1;min-width:0;border:none;outline:none;background:none;font-size:12px}
.sd-search input::placeholder{color:var(--dsw-alias-label-secondary)}

/* 身体 */
.sd-body{flex:1;display:flex;min-height:0}
.sd-rail{flex:none;width:252px;display:flex;flex-direction:column;border-right:1px solid var(--sd-line);background:var(--sd-panel);min-height:0}
.sd-rail-scroll{flex:1;overflow:auto;padding:10px 10px 24px;display:flex;flex-direction:column;gap:12px}
.sd-sec{display:flex;flex-direction:column;gap:6px}
.sd-sec-head{display:flex;align-items:center;gap:6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);padding:0 2px;user-select:none;cursor:pointer}
.sd-sec-head:hover{color:var(--dsw-alias-label-primary)}
.sd-sec-head .sd-count{margin-left:auto;font-variant-numeric:tabular-nums;letter-spacing:0}
.sd-stats{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.sd-stat{background:var(--sd-node);border:1px solid var(--sd-line);border-radius:var(--sd-radius);padding:6px 8px}
.sd-stat b{display:block;font-size:16px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.2}
.sd-stat span{font-size:11px;color:var(--dsw-alias-label-secondary)}
.sd-bar{height:4px;border-radius:2px;background:var(--sd-line);overflow:hidden}
.sd-bar i{display:block;height:100%;background:var(--sd-cover)}
.sd-gap{border:1px solid var(--sd-line);border-radius:var(--sd-radius);overflow:hidden;background:var(--sd-node)}
.sd-gap-head{display:flex;align-items:center;gap:7px;padding:6px 8px;font-size:12px;cursor:pointer;user-select:none}
.sd-gap-head:hover{background:var(--sd-hover)}
.sd-gap-head .sd-count{margin-left:auto;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);font-size:11px}
.sd-gap-dot{width:7px;height:7px;border-radius:50%;flex:none}
.sd-gap-dot.unannotated{background:var(--dsw-alias-state-warn-primary)}
.sd-gap-dot.ungrounded{background:var(--dsw-alias-state-idle-primary)}
.sd-gap-dot.planOpen{background:var(--sd-plan)}
.sd-gap-dot.conflicts{background:var(--sd-conflict)}
.sd-gap-list{max-height:180px;overflow:auto;padding:0 6px 6px}
.sd-row{display:flex;align-items:center;gap:6px;padding:3px 6px;border-radius:5px;font-size:12px;cursor:pointer;color:var(--dsw-alias-label-secondary)}
.sd-row:hover{background:var(--sd-hover);color:var(--dsw-alias-label-primary)}
.sd-row code{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sd-empty{padding:6px 8px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.sd-tree{display:flex;flex-direction:column;gap:1px}
.sd-tree-row{display:flex;align-items:center;gap:5px;padding:4px 6px;border-radius:5px;cursor:pointer;font-size:12px;min-width:0;user-select:none}
.sd-tree-row:hover{background:var(--sd-hover)}
.sd-tree-row[data-sel=true]{background:var(--sd-selected)}
.sd-tree-row .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.sd-tree-item{position:relative}
.sd-tree-more{flex:none;width:18px;height:18px;border-radius:4px;display:grid;place-items:center;font-size:12px;
  color:var(--dsw-alias-label-secondary);opacity:0;transition:opacity .1s}
.sd-tree-row:hover .sd-tree-more,.sd-tree-more:focus-visible{opacity:1}
.sd-tree-more:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 14%,transparent);color:var(--dsw-alias-label-primary)}
.sd-tree-input{flex:1;min-width:0;border:1px solid var(--sd-cover);border-radius:4px;background:var(--sd-node);
  padding:1px 5px;font-size:12px;outline:none;user-select:text}
/* v1.8：左栏多选后的批量操作条（状态/装入/标签/删除） */
.sd-batch{margin:4px 2px 6px;padding:6px 7px;border:1px solid var(--sd-line);border-radius:8px;
  background:color-mix(in srgb,var(--sd-node) 90%,var(--sd-cover) 10%);display:flex;flex-direction:column;gap:5px}
.sd-batch-head{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.sd-batch-head b{font-size:11.5px;font-weight:600;color:var(--dsw-alias-label-primary)}
.sd-batch-head .x{margin-left:auto;width:18px;height:18px;border-radius:4px;display:grid;place-items:center;
  color:var(--dsw-alias-label-secondary)}
.sd-batch-head .x:hover{background:var(--sd-hover);color:var(--dsw-alias-label-primary)}
.sd-batch-actions{display:flex;flex-wrap:wrap;gap:4px}
.sd-batch-btn{height:22px;padding:0 7px;border-radius:5px;border:1px solid var(--sd-line);background:var(--sd-node);
  font-size:11px;display:inline-flex;align-items:center;gap:3px;color:var(--dsw-alias-label-primary);white-space:nowrap}
.sd-batch-btn:hover{background:var(--sd-hover)}
.sd-batch-btn[data-on=true]{background:var(--sd-hover);border-color:var(--sd-line-strong)}
.sd-batch-btn.danger{color:var(--dsw-alias-state-error-primary);
  border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,var(--sd-line))}
.sd-batch-panel{border-top:1px dashed var(--sd-line);padding-top:5px;display:flex;flex-direction:column;gap:5px}
.sd-batch-chips{display:flex;flex-wrap:wrap;gap:4px}
.sd-batch-row{display:flex;gap:4px;align-items:center}
.sd-batch-input{flex:1;min-width:0;height:22px;border:1px solid var(--sd-line);border-radius:5px;
  background:var(--sd-node);font-size:11px;padding:0 6px;color:var(--dsw-alias-label-primary);outline:none}
.sd-batch-input:focus{border-color:var(--sd-cover)}
.sd-batch-list{display:flex;flex-direction:column;gap:2px;max-height:150px;overflow:auto}
.sd-batch-item{text-align:left;font-size:11px;padding:3px 6px;border-radius:4px;color:var(--dsw-alias-label-primary)}
.sd-batch-item:hover{background:var(--sd-hover)}
.sd-batch-hint{font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.sd-tree-edit{padding:2px 6px 6px 28px}
.sd-tree-edit textarea{width:100%;min-height:46px;border:1px solid var(--sd-line);border-radius:6px;background:var(--sd-node);
  padding:5px 7px;font-size:11.5px;line-height:1.45;resize:vertical;outline:none}
.sd-tree-edit textarea:focus{border-color:var(--sd-cover)}
.sd-pop{position:fixed;z-index:120;min-width:176px;max-height:min(70vh,420px);overflow:auto;padding:5px;border-radius:10px;
  background:var(--dsw-alias-bg-overlay);border:1px solid var(--sd-line-strong);box-shadow:0 12px 32px #0005;display:flex;flex-direction:column;gap:1px}
.sd-pop-item{text-align:left;padding:5px 9px;border-radius:6px;font-size:12px;white-space:nowrap}
.sd-pop-item:hover{background:var(--sd-hover)}
.sd-pop-item.danger:hover{background:color-mix(in srgb,var(--sd-conflict) 16%,transparent);color:var(--sd-conflict)}
.sd-pop-item.dim{color:var(--dsw-alias-label-secondary)}
.sd-pop-head{font-size:10px;letter-spacing:.08em;color:var(--dsw-alias-label-secondary);padding:3px 9px 2px;text-transform:uppercase}
.sd-pop-sep{height:1px;background:var(--sd-line);margin:4px 6px}
.sd-pop-seg{display:flex;gap:3px;padding:2px 6px 4px}
.sd-pop-segbtn{flex:1;height:24px;border:1px solid var(--sd-line);border-radius:5px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.sd-pop-segbtn:hover{background:var(--sd-hover)}
.sd-pop-segbtn[data-on=true]{background:var(--sd-selected);border-color:var(--sd-cover);color:var(--dsw-alias-label-primary)}
.sd-twisty{width:12px;flex:none;text-align:center;color:var(--dsw-alias-label-secondary);font-size:9px}
.sd-author{font-size:9px;flex:none;opacity:.8}
.sd-author.human{color:var(--sd-layer-human)}
.sd-author.agent{color:var(--sd-layer-agent)}
.sd-author.program{color:var(--sd-layer-program)}
.sd-dot{width:6px;height:6px;border-radius:2px;flex:none}
.sd-dot.solid{background:var(--dsw-alias-state-success-primary)}
.sd-dot.thin{background:var(--dsw-alias-state-warn-primary)}
.sd-dot.rift{background:var(--dsw-alias-state-error-primary)}
.sd-dot.open{background:var(--dsw-alias-state-idle-primary)}
.sd-log{display:flex;flex-direction:column;gap:3px}
.sd-log-row{display:flex;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.35}
.sd-log-row time{flex:none;color:var(--dsw-alias-state-idle-primary);font-variant-numeric:tabular-nums}
.sd-log-row span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sd-filter{display:flex;gap:4px;flex-wrap:wrap}
.sd-fchip{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 8px;border-radius:999px;border:1px solid var(--sd-line);font-size:11px;color:var(--dsw-alias-label-secondary)}
.sd-fchip[data-on=true]{background:var(--sd-hover);color:var(--dsw-alias-label-primary);border-color:var(--sd-line-strong)}

/* 画布 */
.sd-canvas{position:relative;flex:1;min-width:0;min-height:0;overflow:hidden;cursor:default;background:
  radial-gradient(circle at 1px 1px,color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent) 1px,transparent 0) 0 0/22px 22px,var(--dsw-alias-bg-base)}
.sd-canvas[data-pan=true]{cursor:grabbing}
.sd-canvas[data-tool=domain],.sd-canvas[data-tool=block],.sd-canvas[data-tool=note]{cursor:crosshair}
.sd-canvas[data-tool=link]{cursor:alias}
.sd-world{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}
.sd-links{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}
/* v1.13：类型标签单独一层，画在节点之上；位置由物理帧跟着线走 */
.sd-links-labels{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}
.sd-links path.hit{pointer-events:stroke;cursor:pointer}
.sd-links path.hit:hover+.line{stroke-width:2.8}
.sd-link-label{font-size:10px;fill:var(--dsw-alias-label-secondary);pointer-events:none;user-select:none}
.sd-link-lbg{fill:var(--dsw-alias-bg-base);stroke:var(--sd-line);stroke-width:1}
.sd-hull{position:absolute;border:1px dashed color-mix(in srgb,var(--dsw-alias-label-secondary) 55%,transparent);border-radius:18px;
  background:color-mix(in srgb,var(--dsw-alias-label-primary) 2.5%,transparent);pointer-events:none}
.sd-hull-label{position:absolute;left:12px;top:-9px;padding:0 6px;font-size:10px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-base)}
.sd-node{position:absolute;user-select:none;cursor:grab;transition:box-shadow .12s,border-color .12s}
.sd-node:active{cursor:grabbing}
.sd-node[data-sel=true]{box-shadow:0 0 0 2px var(--sd-cover),0 6px 20px #0003}
/* v1.12：悬停一个件＝亮起它的线；1 跳聚焦＝选中件实线、邻居虚线 */
.sd-node[data-hover=true]{outline:2px solid color-mix(in srgb,var(--sd-cover) 60%,transparent);outline-offset:2px}
.sd-node[data-hop=true]{outline:1px dashed color-mix(in srgb,var(--sd-cover) 45%,transparent);outline-offset:2px}
.sd-node[data-focus=true]{outline:2px solid color-mix(in srgb,var(--sd-plan) 75%,transparent);outline-offset:3px}
.sd-domain[data-drop=true]{border-color:var(--sd-plan);border-style:solid;box-shadow:0 0 0 2px color-mix(in srgb,var(--sd-plan) 70%,transparent),0 8px 24px #0004;transform:scale(1.04)}
.sd-twisty-node{flex:none;width:13px;height:13px;display:grid;place-items:center;border-radius:3px;font-size:9px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.sd-twisty-node:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 14%,transparent);color:var(--dsw-alias-label-primary)}
.sd-domain{display:flex;align-items:center;gap:7px;height:34px;padding:0 14px;border-radius:999px;flex:none;
  background:color-mix(in srgb,var(--sd-node) 78%,var(--sd-cover) 22%);border:1px solid color-mix(in srgb,var(--sd-cover) 52%,var(--sd-line));
  box-shadow:0 1px 2px #0002;white-space:nowrap}
/* v1.16：域按层描边（背景保持域胶囊的蓝调，层色通过描边/作者点/包络表达） */
.sd-domain[data-layer=human]{border-color:color-mix(in srgb,var(--sd-layer-human) 62%,var(--sd-line))}
.sd-domain[data-layer=agent]{border-color:color-mix(in srgb,var(--sd-layer-agent) 72%,var(--sd-line))}
.sd-domain[data-layer=program]{border-color:color-mix(in srgb,var(--sd-layer-program) 60%,var(--sd-line))}
.sd-domain[data-status=thin]{border-style:dashed}
.sd-domain[data-status=rift]{border-color:var(--sd-conflict);background:color-mix(in srgb,var(--sd-node) 82%,var(--sd-conflict) 18%)}
.sd-domain[data-status=open]{border-style:dotted;opacity:.92}
.sd-domain b{font-weight:600;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;max-width:230px}
.sd-domain .n{font-size:10px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.sd-block{width:172px;height:64px;padding:7px 9px;border-radius:10px;background:var(--sd-node);border:1px solid var(--sd-line);
  display:flex;flex-direction:column;justify-content:center;gap:2px;box-shadow:0 1px 2px #0002;overflow:visible}
/* v1.16：块按层着色（人=青、agent=紫、程序=灰）；[data-planned] 等后续规则仍会盖回计划色 */
.sd-block[data-layer=human]{background:color-mix(in srgb,var(--sd-node) 90%,var(--sd-layer-human) 10%);border-color:color-mix(in srgb,var(--sd-layer-human) 42%,var(--sd-line))}
.sd-block[data-layer=agent]{background:color-mix(in srgb,var(--sd-node) 88%,var(--sd-layer-agent) 12%);border-color:color-mix(in srgb,var(--sd-layer-agent) 55%,var(--sd-line))}
.sd-block[data-layer=program]{background:color-mix(in srgb,var(--sd-node) 94%,var(--sd-layer-program) 6%);border-color:color-mix(in srgb,var(--sd-layer-program) 38%,var(--sd-line))}
/* 定高 flex 列里子项默认会收缩，行高被压小后 overflow:hidden 会把字切掉一半——
   这里一律 flex:none + 显式行高。 */
.sd-block>*{flex:none}
.sd-block b{font-size:12px;font-weight:600;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sd-block .p{font-size:10px;line-height:13px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left}
.sd-block .meta{display:flex;align-items:center;gap:4px;line-height:14px;margin-top:0}
.sd-block .meta>*{line-height:14px}
.sd-tag{font-size:9px;padding:0 4px;border-radius:3px;background:var(--sd-hover);color:var(--dsw-alias-label-secondary);line-height:14px;flex:none}
.sd-tag.plan{background:color-mix(in srgb,var(--sd-plan) 22%,transparent);color:var(--sd-plan)}
.sd-tag.stale{background:color-mix(in srgb,var(--sd-conflict) 20%,transparent);color:var(--sd-conflict)}
.sd-tag.cov{background:color-mix(in srgb,var(--sd-cover) 18%,transparent);color:var(--sd-cover)}
.sd-block[data-planned=true]{border-style:dashed;border-color:color-mix(in srgb,var(--sd-plan) 60%,var(--sd-line));background:color-mix(in srgb,var(--sd-node) 88%,var(--sd-plan) 12%)}
.sd-block[data-stale=true]{opacity:.62}
.sd-block[data-unannotated=true]{border-left:2px solid var(--dsw-alias-state-warn-primary)}
.sd-note{width:200px;padding:8px 9px;border-radius:10px;display:flex;flex-direction:column;gap:4px;
  background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,var(--sd-node));border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 40%,var(--sd-line));
  box-shadow:0 2px 8px #0002}
.sd-note[data-color=blue]{background:color-mix(in srgb,var(--sd-plan) 14%,var(--sd-node));border-color:color-mix(in srgb,var(--sd-plan) 40%,var(--sd-line))}
.sd-note[data-color=green]{background:color-mix(in srgb,var(--sd-ground) 14%,var(--sd-node));border-color:color-mix(in srgb,var(--sd-ground) 40%,var(--sd-line))}
/* v1.16：便签按层在左缘点一条层色（便签不设层守卫，只是展示归属） */
.sd-note[data-layer=human]{border-left:3px solid var(--sd-layer-human)}
.sd-note[data-layer=agent]{border-left:3px solid var(--sd-layer-agent)}
.sd-note[data-layer=program]{border-left:3px solid var(--sd-layer-program)}
.sd-note textarea{width:100%;min-height:56px;flex:none;resize:vertical;border:none;outline:none;background:none;font-size:12px;line-height:1.45;display:block}
.sd-note .ref{font-size:10px;color:var(--dsw-alias-label-secondary);cursor:pointer;display:flex;align-items:center;gap:4px}
.sd-note .ref:hover{color:var(--dsw-alias-label-primary)}
.sd-zoom{position:absolute;right:12px;bottom:12px;display:flex;align-items:center;gap:2px;padding:3px;border-radius:999px;
  background:var(--sd-panel);border:1px solid var(--sd-line);box-shadow:0 4px 16px #0003}
.sd-zoom button{width:26px;height:26px;border-radius:999px;display:grid;place-items:center;color:var(--dsw-alias-label-secondary)}
.sd-zoom button:hover{background:var(--sd-hover);color:var(--dsw-alias-label-primary)}
.sd-zoom span{min-width:44px;text-align:center;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.sd-marquee{position:absolute;border:1px solid var(--sd-cover);background:color-mix(in srgb,var(--sd-cover) 12%,transparent);pointer-events:none;border-radius:2px}
.sd-canvas-hint{position:absolute;left:12px;bottom:12px;font-size:11px;color:var(--dsw-alias-label-secondary);pointer-events:none;max-width:60%}
.sd-empty-canvas{position:absolute;inset:0;display:grid;place-items:center;text-align:center;pointer-events:none}
.sd-empty-canvas div{pointer-events:auto;max-width:420px;display:flex;flex-direction:column;gap:10px;align-items:center;color:var(--dsw-alias-label-secondary)}
.sd-empty-canvas b{font-size:15px;color:var(--dsw-alias-label-primary)}

/* 右栏 */
.sd-insp{flex:none;width:296px;border-left:1px solid var(--sd-line);background:var(--sd-panel);display:flex;flex-direction:column;min-height:0}
.sd-insp-scroll{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:12px}
.sd-insp-head{display:flex;align-items:center;gap:8px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.sd-field{display:flex;flex-direction:column;gap:4px}
.sd-field label{font-size:11px;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:6px}
.sd-field input,.sd-field textarea,.sd-field select{width:100%;border:1px solid var(--sd-line);border-radius:6px;background:var(--sd-node);
  padding:6px 8px;font-size:12px;outline:none;resize:vertical}
.sd-field input:focus,.sd-field textarea:focus,.sd-field select:focus{border-color:var(--sd-cover)}
.sd-field textarea{min-height:58px;line-height:1.45}
.sd-seg{display:flex;gap:3px}
.sd-seg button{flex:1;height:26px;border:1px solid var(--sd-line);border-radius:6px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.sd-seg button[data-on=true]{background:var(--sd-selected);color:var(--dsw-alias-label-primary);border-color:var(--sd-cover)}
.sd-actions{display:flex;flex-wrap:wrap;gap:5px}
.sd-action{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 9px;border:1px solid var(--sd-line);border-radius:6px;font-size:11.5px}
.sd-action:hover{background:var(--sd-hover)}
.sd-action.danger:hover{background:color-mix(in srgb,var(--sd-conflict) 16%,transparent);border-color:var(--sd-conflict)}
.sd-box{background:var(--sd-node);border:1px solid var(--sd-line);border-radius:var(--sd-radius);padding:8px;display:flex;flex-direction:column;gap:6px}
.sd-box h4{margin:0;font-size:11px;font-weight:500;letter-spacing:.06em;color:var(--dsw-alias-label-secondary);text-transform:uppercase}
.sd-link-list{display:flex;flex-direction:column;gap:3px}
.sd-link-row{display:flex;align-items:center;gap:6px;font-size:11.5px;padding:3px 5px;border-radius:5px;cursor:pointer;color:var(--dsw-alias-label-secondary)}
.sd-link-row:hover{background:var(--sd-hover);color:var(--dsw-alias-label-primary)}
.sd-link-row i{width:14px;height:2px;border-radius:1px;flex:none}
.sd-hint{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.5}
.sd-kv{display:flex;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.sd-kv b{color:var(--dsw-alias-label-primary);font-weight:500}

/* 底栏 */
.sd-bottom{flex:none;height:30px;display:flex;align-items:center;gap:12px;padding:0 14px;border-top:1px solid var(--sd-line);
  background:var(--sd-panel);font-size:11px;color:var(--dsw-alias-label-secondary)}
.sd-legend{display:flex;align-items:center;gap:2px;min-width:0;overflow:hidden}
.sd-legend button{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 6px;border-radius:999px;color:inherit;opacity:.8;white-space:nowrap}
.sd-legend button:hover{background:var(--sd-hover);opacity:1}
.sd-legend button[data-on=true]{background:var(--sd-hover);opacity:1;color:var(--dsw-alias-label-primary);box-shadow:inset 0 0 0 1px var(--sd-line-strong)}
.sd-legend i{width:12px;height:2px;border-radius:1px;display:inline-block}
.sd-sync{display:inline-flex;align-items:center;gap:5px;margin-left:auto}
.sd-phys{display:inline-flex;align-items:center;gap:5px;margin-left:8px}
.sd-phys i{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}
.sd-phys[data-on=true] i{background:var(--sd-cover)}
.sd-build{opacity:.7;font-variant-numeric:tabular-nums}
.sd-phys[data-on=true] i{animation:sd-breathe 2.2s ease-in-out infinite}
@keyframes sd-breathe{50%{opacity:.45}}
.sd-sync i{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary)}
.sd-sync[data-busy=true] i{background:var(--dsw-alias-state-warn-primary);animation:sd-pulse 1s infinite}
@keyframes sd-pulse{50%{opacity:.35}}

/* 桌边消息（v1.15） */
.sd-deskbar{flex:none;display:flex;flex-direction:column;gap:5px;padding:6px 12px 5px;border-top:1px solid var(--sd-line);background:var(--sd-panel)}
.sd-deskbar-collapsed{flex:none;border-top:1px solid var(--sd-line);background:var(--sd-panel);padding:4px 12px}
.sd-deskbar-toggle{display:flex;align-items:center;gap:6px;width:100%;padding:2px 0;font-size:11px;color:var(--dsw-alias-label-secondary)}
.sd-deskbar-toggle:hover{color:var(--dsw-alias-label-primary)}
.sd-deskbar-count{margin-left:4px;padding:0 6px;height:16px;line-height:16px;border-radius:999px;background:var(--sd-selected);color:var(--dsw-alias-label-primary);font-size:10px}
.sd-deskbar-hint{margin-left:auto;opacity:.65;font-size:10px}
.sd-deskbar-chips{display:flex;align-items:center;gap:4px;min-height:20px;min-width:0;overflow-x:auto;scrollbar-width:none}
.sd-deskbar-chips::-webkit-scrollbar{display:none}
.sd-deskbar-empty{font-size:11px;color:var(--dsw-alias-label-secondary);opacity:.8;white-space:nowrap}
.sd-deskchip{display:inline-flex;align-items:center;gap:4px;flex:none;max-width:210px;height:20px;padding:0 6px;border-radius:999px;
  border:1px solid var(--sd-line);background:var(--sd-node);font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.sd-deskchip:hover{border-color:var(--sd-line-strong);color:var(--dsw-alias-label-primary)}
.sd-deskchip-kind{font-size:9.5px;opacity:.7;flex:none}
.sd-deskchip-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sd-deskchip-x{padding:0 1px;opacity:.5;flex:none}
.sd-deskchip-x:hover{opacity:1;color:var(--sd-conflict)}
.sd-deskbar-more{font-size:10px;color:var(--dsw-alias-label-secondary);flex:none}
.sd-deskbar-row{display:flex;align-items:center;gap:6px}
.sd-deskbar-input{flex:1;min-width:0;height:28px;border:1px solid var(--sd-line);border-radius:7px;background:var(--sd-node);padding:0 9px;font-size:12px;outline:none}
.sd-deskbar-input:focus{border-color:var(--sd-cover)}
.sd-deskbar-send{display:inline-flex;align-items:center;gap:4px;flex:none;height:28px;padding:0 10px;border-radius:7px;
  border:1px solid var(--sd-line);background:var(--sd-node);font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.sd-deskbar-send:hover:not(:disabled){border-color:var(--sd-cover);color:var(--dsw-alias-label-primary)}
.sd-deskbar-send:disabled{opacity:.45;cursor:default}
.sd-deskbar-fold{width:22px;height:22px;flex:none;border-radius:6px;color:var(--dsw-alias-label-secondary);font-size:11px}
.sd-deskbar-fold:hover{background:var(--sd-hover);color:var(--dsw-alias-label-primary)}
.sd-deskbar-status{display:flex;align-items:center;gap:5px;min-height:14px;font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.sd-deskbar-dot{width:6px;height:6px;flex:none;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}
.sd-deskbar-status[data-phase=accepted] .sd-deskbar-dot{background:var(--dsw-alias-state-success-primary)}
.sd-deskbar-status[data-phase=sending] .sd-deskbar-dot{background:var(--dsw-alias-state-warn-primary);animation:sd-pulse 1s infinite}
.sd-deskbar-status[data-phase=error] .sd-deskbar-dot{background:var(--dsw-alias-state-error-primary)}
.sd-deskbar-status-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sd-deskbar-status[data-phase=error] .sd-deskbar-status-text{color:var(--dsw-alias-state-error-primary)}
.sd-deskbar-cmds{margin-left:auto;display:flex;align-items:center;gap:2px;flex:none}
.sd-deskbar-cmd{height:16px;padding:0 4px;border-radius:4px;font-size:10px;font-family:var(--ds-font-family-code,monospace);color:var(--dsw-alias-label-secondary);opacity:.75}
.sd-deskbar-cmd:hover{background:var(--sd-hover);opacity:1;color:var(--dsw-alias-label-primary)}

/* 看见改动（v1.14） */
.sd-badges{position:absolute;top:-7px;right:6px;display:flex;gap:2px;z-index:3;pointer-events:none}
.sd-domain .sd-badges{top:-8px;right:10px}
.sd-badge{display:inline-grid;place-items:center;min-width:14px;height:14px;padding:0 3px;border-radius:4px;font-size:9.5px;font-weight:600;line-height:1;
  border:1px solid transparent;background:var(--sd-node);color:var(--dsw-alias-label-secondary)}
.sd-badge.new{background:var(--sd-cover);color:#fff;border-color:var(--sd-cover)}
.sd-badge.changed{background:var(--dsw-alias-state-warn-primary);color:#1c2733;border-color:var(--dsw-alias-state-warn-primary)}
.sd-badge.removed{background:var(--sd-conflict);color:#fff;border-color:var(--sd-conflict)}
.sd-badge.conflict{background:var(--dsw-alias-bg-base);color:var(--sd-conflict);border-color:var(--sd-conflict);font-weight:700}
.sd-node[data-slice]{outline:2px solid var(--sd-cover);outline-offset:2px}
.sd-node[data-slice=changed]{outline-color:var(--dsw-alias-state-warn-primary)}
.sd-node[data-slice=removed]{outline-color:var(--sd-conflict)}
.sd-links path.line[data-slice=true]{stroke-width:2.8}
.sd-time{flex:none;height:74px;border-top:1px solid var(--sd-line);background:var(--sd-panel);display:flex;flex-direction:column}
.sd-time-head{flex:none;display:flex;align-items:center;gap:8px;height:24px;padding:0 12px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.sd-time-head b{font-size:11px;font-weight:600;color:var(--dsw-alias-label-primary);letter-spacing:.04em}
.sd-time-count{font-variant-numeric:tabular-nums;opacity:.8}
.sd-time-unseen{display:inline-flex;align-items:center;gap:3px;height:16px;padding:0 6px;border-radius:999px;background:var(--sd-selected);color:var(--dsw-alias-label-primary);font-size:10px;white-space:nowrap}
.sd-time-actions{margin-left:auto;display:flex;align-items:center;gap:4px}
.sd-time-btn{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 7px;border-radius:6px;border:1px solid var(--sd-line);
  background:var(--sd-node);font-size:10.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.sd-time-btn:hover:not(:disabled){border-color:var(--sd-line-strong);color:var(--dsw-alias-label-primary)}
.sd-time-btn:disabled{opacity:.45;cursor:default}
.sd-time-btn[data-on=true]{background:var(--sd-selected);border-color:var(--sd-cover);color:var(--dsw-alias-label-primary)}
.sd-time-btn.danger:hover:not(:disabled){border-color:var(--sd-conflict);color:var(--sd-conflict)}
.sd-time-btn.armed{background:color-mix(in srgb,var(--sd-conflict) 18%,transparent);border-color:var(--sd-conflict);color:var(--sd-conflict)}
.sd-axis{position:relative;flex:1;min-height:0;overflow:hidden;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none}
.sd-axis.dragging{cursor:grabbing}
.sd-axis-rail{position:absolute;left:24px;right:24px;top:19px;height:2px;border-radius:2px;background:var(--sd-line)}
.sd-beads{position:absolute;left:50%;top:0;height:100%;width:0}
.sd-bead{position:absolute;left:0;top:0;width:56px;margin-left:-28px;height:100%;display:flex;flex-direction:column;align-items:center;
  padding-top:4px;cursor:pointer;will-change:transform;color:var(--dsw-alias-label-secondary)}
.sd-bead-nums{display:flex;flex-direction:column;align-items:center;gap:1px;font:600 9.5px/1.05 var(--ds-font-family-code,ui-monospace,monospace);min-height:14px}
.sd-bead-nums .a{color:var(--sd-cover)}
.sd-bead-nums .c{color:var(--dsw-alias-state-warn-primary)}
.sd-bead-nums .r{color:var(--sd-conflict)}
.sd-bead-dot{width:11px;height:11px;border-radius:50%;background:var(--sd-node);border:2px solid var(--sd-line-strong);margin-top:2px;
  transition:border-color .12s,background .12s,box-shadow .12s}
.sd-bead:hover .sd-bead-dot{border-color:var(--sd-cover)}
.sd-bead[data-on=true] .sd-bead-dot{background:var(--sd-cover);border-color:var(--sd-cover);box-shadow:0 0 0 4px color-mix(in srgb,var(--sd-cover) 18%,transparent)}
.sd-bead[data-kind=revert] .sd-bead-dot{border-style:dashed}
.sd-bead-ix{margin-top:5px;font:9.5px/1 var(--ds-font-family-code,ui-monospace,monospace);color:var(--dsw-alias-state-idle-primary)}
.sd-bead[data-on=true] .sd-bead-ix{color:var(--sd-cover)}
.sd-bead-tip{position:absolute;bottom:2px;left:50%;transform:translateX(-50%);max-width:240px;padding:2px 7px;border-radius:5px;
  background:var(--dsw-alias-bg-overlay);border:1px solid var(--sd-line-strong);font-size:10px;color:var(--dsw-alias-label-primary);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:0;pointer-events:none;transition:opacity .12s}
.sd-bead:hover .sd-bead-tip{opacity:1}
.sd-time-empty{position:absolute;inset:0;display:grid;place-items:center;font-size:10.5px;color:var(--dsw-alias-label-secondary);opacity:.75;pointer-events:none}
.sd-changes{position:absolute;top:0;right:0;bottom:0;width:392px;max-width:88%;z-index:34;display:flex;flex-direction:column;
  background:var(--sd-panel);border-left:1px solid var(--sd-line-strong);box-shadow:-18px 0 48px #0004}
.sd-changes-head{flex:none;display:flex;align-items:center;gap:8px;height:44px;padding:0 12px;border-bottom:1px solid var(--sd-line);font-weight:600;font-size:13px}
.sd-changes-head .sub{font-size:10.5px;font-weight:400;color:var(--dsw-alias-label-secondary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sd-changes-body{flex:1;overflow:auto;padding:10px 12px 20px;display:flex;flex-direction:column;gap:12px}
.sd-change-group{display:flex;flex-direction:column;gap:2px}
.sd-change-group>h5{margin:0 0 2px;font-size:10.5px;font-weight:500;letter-spacing:.06em;color:var(--dsw-alias-label-secondary);text-transform:uppercase}
.sd-change-row{display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:6px;font-size:11.5px;cursor:pointer;
  color:var(--dsw-alias-label-primary);min-width:0}
.sd-change-row:hover{background:var(--sd-hover)}
.sd-change-row .id{flex:none;font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:10px;color:var(--dsw-alias-label-secondary);width:26px}
.sd-change-row .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sd-change-row .bt{flex:none;font-size:9.5px;color:var(--dsw-alias-state-idle-primary);font-variant-numeric:tabular-nums}
.sd-change-row .cp{flex:none;width:20px;height:18px;border-radius:4px;display:grid;place-items:center;opacity:0;font-size:10px;color:var(--dsw-alias-label-secondary)}
.sd-change-row:hover .cp{opacity:1}
.sd-change-row .cp:hover{background:var(--sd-hover);color:var(--dsw-alias-label-primary)}
.sd-change-empty{padding:18px 8px;text-align:center;font-size:11.5px;color:var(--dsw-alias-label-secondary);line-height:1.7}
.sd-change-note{padding:6px 8px;border-radius:6px;font-size:10.5px;line-height:1.5;
  border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 42%,var(--sd-line));
  background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 8%,var(--sd-node));
  color:var(--dsw-alias-label-secondary)}
.sd-changes-foot{flex:none;padding:8px 12px;border-top:1px solid var(--sd-line);font-size:10.5px;color:var(--dsw-alias-label-secondary)}

/* 通用浮层 */
.sd-overlay{position:absolute;inset:0;background:#0006;display:grid;place-items:center;z-index:40}
.sd-modal{width:min(620px,calc(100% - 40px));max-height:min(76vh,760px);display:flex;flex-direction:column;border-radius:12px;
  background:var(--dsw-alias-bg-overlay);border:1px solid var(--sd-line-strong);box-shadow:0 24px 60px #0005;overflow:hidden}
.sd-modal header{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--sd-line);font-weight:600}
.sd-modal .body{padding:14px;overflow:auto;display:flex;flex-direction:column;gap:12px}
.sd-modal footer{display:flex;justify-content:flex-end;gap:8px;padding:10px 14px;border-top:1px solid var(--sd-line)}
.sd-modal pre{margin:0;white-space:pre-wrap;word-break:break-word;font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:11.5px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.sd-menu{position:absolute;z-index:50;min-width:170px;padding:5px;border-radius:10px;background:var(--dsw-alias-bg-overlay);
  border:1px solid var(--sd-line-strong);box-shadow:0 12px 32px #0005;display:flex;flex-direction:column;gap:1px}
.sd-menu button{display:flex;align-items:center;gap:8px;padding:6px 9px;border-radius:6px;font-size:12px;text-align:left}
.sd-menu button:hover{background:var(--sd-hover)}
.sd-menu i{width:16px;height:2px;border-radius:1px;flex:none}
.sd-menu small{color:var(--dsw-alias-label-secondary);margin-left:auto;font-size:10px}
.sd-toast{position:absolute;left:50%;bottom:44px;transform:translateX(-50%);z-index:60;max-width:78%;padding:8px 14px;border-radius:999px;
  background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base);font-size:12px;box-shadow:0 8px 24px #0004;pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sd-toast[data-kind=error]{background:var(--dsw-alias-state-error-primary);color:#fff}

/* v1.16 层板 / 层包络 / 计划视图 / 落地建议 / 域内视图 / 只读提案 */
.sd-layer-hull{position:absolute;border:1px dashed;border-radius:22px;pointer-events:none;z-index:0;transition:opacity .15s}
.sd-layer-hull[data-layer=human]{background:color-mix(in srgb,var(--sd-layer-human) 5%,transparent);border-color:color-mix(in srgb,var(--sd-layer-human) 34%,transparent)}
.sd-layer-hull[data-layer=agent]{background:color-mix(in srgb,var(--sd-layer-agent) 6%,transparent);border-color:color-mix(in srgb,var(--sd-layer-agent) 36%,transparent)}
.sd-layer-hull[data-layer=program]{background:color-mix(in srgb,var(--sd-layer-program) 4%,transparent);border-color:color-mix(in srgb,var(--sd-layer-program) 30%,transparent)}
.sd-layer-hull-label{position:absolute;left:12px;top:-9px;padding:0 6px;font-size:9.5px;letter-spacing:.04em;border-radius:4px;
  background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary)}
.sd-layer-hull[data-layer=human] .sd-layer-hull-label{color:var(--sd-layer-human)}
.sd-layer-hull[data-layer=agent] .sd-layer-hull-label{color:var(--sd-layer-agent)}
.sd-layer-hull[data-layer=program] .sd-layer-hull-label{color:var(--sd-layer-program)}
.sd-layers{display:flex;flex-direction:column;gap:3px}
.sd-layer-row{display:flex;align-items:center;gap:7px;padding:4px 7px;border:1px solid var(--sd-line);border-radius:7px;
  background:var(--sd-node);font-size:12px;color:var(--dsw-alias-label-primary)}
.sd-layer-row:hover{background:var(--sd-hover)}
.sd-layer-row[data-on=false]{opacity:.5}
.sd-layer-row[data-on=false] .t{text-decoration:line-through}
.sd-layer-dot{width:8px;height:8px;border-radius:50%;flex:none;box-shadow:0 0 0 2px color-mix(in srgb,currentColor 0%,transparent)}
.sd-layer-row .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sd-layer-row .n{font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.sd-layer-eye{flex:none;width:22px;height:18px;border-radius:5px;display:grid;place-items:center;font-size:11px;
  color:var(--dsw-alias-label-secondary)}
.sd-layer-eye:hover{background:var(--sd-hover);color:var(--dsw-alias-label-primary)}
.sd-layer-row[data-on=true] .sd-layer-eye{color:var(--dsw-alias-label-primary)}
.sd-layer-current{display:flex;align-items:center;gap:6px;padding:5px 8px;border:1px dashed var(--sd-line-strong);border-radius:7px;
  font-size:11px;color:var(--dsw-alias-label-secondary)}
.sd-layer-current b{display:inline-flex;align-items:center;gap:5px;font-weight:600;color:var(--dsw-alias-label-primary)}
.sd-layer-current .sd-layer-dot{width:7px;height:7px}
.sd-layer-current .l{color:var(--sd-layer-human);font-size:10px}
.sd-tabs{display:flex;gap:3px;padding:1px 0 3px}
.sd-tab{height:22px;padding:0 8px;border-radius:6px;font-size:11px;color:var(--dsw-alias-label-secondary);
  border:1px solid transparent}
.sd-tab:hover{background:var(--sd-hover);color:var(--dsw-alias-label-primary)}
.sd-tab[data-on=true]{background:var(--sd-selected);border-color:color-mix(in srgb,var(--sd-cover) 40%,var(--sd-line));color:var(--dsw-alias-label-primary)}
.sd-plan-list{display:flex;flex-direction:column;gap:6px}
.sd-plan-group{border:1px solid var(--sd-line);border-radius:var(--sd-radius);background:var(--sd-node);overflow:hidden}
.sd-plan-head{display:flex;align-items:center;gap:6px;padding:6px 8px;font-size:12px;cursor:pointer;user-select:none}
.sd-plan-head:hover{background:var(--sd-hover)}
.sd-plan-counts{margin-left:auto;display:flex;align-items:center;gap:5px;font-size:10px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.sd-plan-count{display:inline-flex;align-items:center;gap:3px}
.sd-plan-rows{max-height:210px;overflow:auto;padding:0 5px 5px}
.sd-plan-row{display:flex;align-items:center;gap:6px;padding:3px 6px;border-radius:5px;font-size:11.5px;cursor:pointer;
  color:var(--dsw-alias-label-secondary);min-width:0}
.sd-plan-row:hover{background:var(--sd-hover);color:var(--dsw-alias-label-primary)}
.sd-plan-row code{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:10.5px;flex:none;opacity:.8}
.sd-plan-row .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sd-plan-row .crit{flex:none;max-width:38%;font-size:10px;opacity:.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  padding:0 4px;border-radius:3px;background:var(--sd-hover)}
.sd-suggest{position:absolute;left:50%;top:10px;transform:translateX(-50%);z-index:26;display:flex;flex-direction:column;gap:4px;
  max-width:min(720px,86%);pointer-events:none}
.sd-suggest-head{font-size:10.5px;color:var(--dsw-alias-label-secondary);text-align:center;text-shadow:0 1px 2px var(--dsw-alias-bg-base)}
.sd-suggest-row{display:flex;align-items:center;gap:7px;padding:5px 10px;border-radius:999px;pointer-events:auto;
  background:var(--dsw-alias-bg-overlay);border:1px solid var(--sd-line-strong);box-shadow:0 8px 24px #0004;font-size:11.5px;white-space:nowrap}
.sd-suggest-row b{font-weight:600}
.sd-suggest-row .why{font-size:10px;color:var(--dsw-alias-label-secondary)}
.sd-suggest-act{flex:none;height:20px;padding:0 7px;border-radius:5px;border:1px solid var(--sd-line);font-size:10.5px;
  color:var(--dsw-alias-label-primary);background:var(--sd-node);pointer-events:auto}
.sd-suggest-act:hover{border-color:var(--sd-cover)}
.sd-suggest-act.dim{color:var(--dsw-alias-label-secondary)}
.sd-suggest-act.done{background:var(--sd-selected);border-color:var(--sd-cover)}
.sd-domainview-bar{position:absolute;left:50%;top:10px;transform:translateX(-50%);z-index:27;display:flex;align-items:center;gap:8px;
  padding:5px 10px;border-radius:999px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--sd-line-strong);
  box-shadow:0 8px 24px #0004;font-size:11.5px;white-space:nowrap}
.sd-domainview-bar b{font-weight:600}
.sd-domainview-bar .hint{color:var(--dsw-alias-label-secondary);font-size:10.5px}
.sd-domainview-bar button{height:20px;padding:0 8px;border-radius:999px;border:1px solid var(--sd-line);font-size:10.5px}
.sd-domainview-bar button:hover{border-color:var(--sd-cover);background:var(--sd-hover)}
.sd-stub-line{pointer-events:none}
.sd-stub-label{font-size:9.5px;fill:var(--dsw-alias-label-secondary);pointer-events:none;user-select:none}
.sd-stub-dot{pointer-events:none}
.sd-readonly{display:flex;flex-direction:column;gap:5px;padding:8px 9px;border-radius:8px;
  border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 46%,var(--sd-line));
  background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 9%,var(--sd-node))}
.sd-readonly b{font-size:11.5px;font-weight:600;color:var(--dsw-alias-state-warn-primary)}
.sd-readonly .sd-hint{font-size:10.5px}
.sd-readonly-value{border:1px dashed var(--sd-line-strong);border-radius:6px;padding:6px 8px;font-size:12px;line-height:1.5;
  color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word;min-height:26px}
.sd-readonly-value.empty{color:var(--dsw-alias-label-secondary);font-style:italic}
.sd-layer-tag{flex:none;font-size:10px;padding:1px 6px;border-radius:999px;border:1px solid currentColor;opacity:.85;white-space:nowrap}
.sd-action:disabled{opacity:.45;cursor:default}
.sd-field input[readonly],.sd-field textarea[readonly]{border-style:dashed;color:var(--dsw-alias-label-secondary);cursor:default}
.sd-field select:disabled{cursor:default;opacity:.7}
.sd-modal .body textarea{width:100%;min-height:120px;border:1px solid var(--sd-line);border-radius:6px;background:var(--sd-node);
  padding:7px 9px;font-size:12px;line-height:1.5;outline:none;resize:vertical;font-family:var(--ds-font-family-code,ui-monospace,monospace)}
.sd-modal .body textarea:focus{border-color:var(--sd-cover)}
.sd-modal .body input{width:100%;height:28px;border:1px solid var(--sd-line);border-radius:6px;background:var(--sd-node);
  padding:0 9px;font-size:12px;outline:none}
.sd-modal .body input:focus{border-color:var(--sd-cover)}
.sd-modal-note{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.55}

/* 欢迎页 */
.sd-welcome{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:40px;overflow:auto}
.sd-welcome h1{margin:0;font-size:26px;font-weight:600;letter-spacing:.02em;display:flex;align-items:center;gap:12px}
.sd-welcome p{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;max-width:560px;text-align:center;line-height:1.7}
.sd-welcome .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;width:min(680px,100%)}
.sd-card{display:flex;flex-direction:column;gap:4px;padding:12px;border-radius:var(--sd-radius);border:1px solid var(--sd-line);background:var(--sd-node);text-align:left}
.sd-card:hover{border-color:var(--sd-line-strong);background:var(--sd-hover)}
.sd-card b{font-size:13px}
.sd-card span{font-size:11px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left}
.sd-welcome .go{display:flex;gap:8px;align-items:center}
.sd-kbd{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;border-radius:4px;
  border:1px solid var(--sd-line-strong);background:var(--sd-node);font-size:10px;font-family:var(--ds-font-family-code,monospace);color:var(--dsw-alias-label-secondary)}
@media (max-width:1180px){.sd-insp{width:260px}.sd-rail{width:228px}}
@media (max-width:960px){.sd-insp{display:none}.sd-rail{width:200px}}
`

    // ── 图标 ────────────────────────────────────────────────────────
    function Glyph({ size = 18 }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true },
        h('rect', { x: 3, y: 3.5, width: 9.5, height: 8, rx: 2, strokeDasharray: '2 2' }),
        h('ellipse', { cx: 7.6, cy: 7.5, rx: 3, ry: 2.2, fill: 'currentColor', fillOpacity: 0.25 }),
        h('rect', { x: 12, y: 13.5, width: 9, height: 7, rx: 1.8 }),
        h('path', { d: 'M10.5 11.5c-2 2.4-1.2 4.6 1 6.2' }),
        h('circle', { cx: 12, cy: 18, r: 1.1, fill: 'currentColor' }),
      )
    }

    function Icon({ name, size = 14 }) {
      const paths = {
        scan: h('path', { d: 'M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M7.5 12h9' }),
        domain: h('ellipse', { cx: 12, cy: 12, rx: 8, ry: 5.5 }),
        block: h('rect', { x: 4.5, y: 6.5, width: 15, height: 11, rx: 2.5 }),
        note: h('path', { d: 'M5 5.5h14v9l-4 4H5zM15 18.5v-4h4' }),
        link: h('path', { d: 'M8.5 12h7M9 8.5 6 12l3 3.5M15 8.5l3 3.5-3 3.5' }),
        undo: h('path', { d: 'M8 8H5v3M5.5 10.5A6.5 6.5 0 1 1 7 17' }),
        redo: h('path', { d: 'M16 8h3v3M18.5 10.5A6.5 6.5 0 1 0 17 17' }),
        fit: h('path', { d: 'M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15' }),
        arrange: h('path', { d: 'M4 6h6M4 12h10M4 18h6M14 6h6M18 12h2M14 18h6' }),
        export: h('path', { d: 'M12 4v10M8 10l4 4 4-4M5 18h14' }),
        doc: h('path', { d: 'M6 4h8l4 4v12H6zM14 4v4h4M9 12h6M9 15.5h6' }),
        help: h('path', { d: 'M12 17h.01M12 14c0-2 2.5-2.2 2.5-4.2A2.6 2.6 0 0 0 9 9.4M4 12a8 8 0 1 0 16 0 8 8 0 0 0-16 0Z' }),
        refresh: h('path', { d: 'M19 8.5A7.5 7.5 0 1 0 19.5 14M19 4v5h-5' }),
        folder: h('path', { d: 'M3.5 7A1.5 1.5 0 0 1 5 5.5h4l2 2h8A1.5 1.5 0 0 1 20.5 9v7.5A1.5 1.5 0 0 1 19 18H5a1.5 1.5 0 0 1-1.5-1.5z' }),
        close: h('path', { d: 'M6 6l12 12M18 6L6 18' }),
        search: h('path', { d: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM16 16l4 4' }),
        atom: h('path', { d: 'M12 12h.01M7.5 7.5a6.4 6.4 0 1 1 0 9M16.5 7.5a6.4 6.4 0 0 1 0 9M12 5.6a6.4 6.4 0 1 0 0 12.8' }),
        spark: h('path', { d: 'M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6zM18 16l.8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8z' }),
        wave: h('path', { d: 'M3 9c2-3 4-3 6 0s4 3 6 0 4-3 6 0M3 15c2-3 4-3 6 0s4 3 6 0 4-3 6 0' }),
        pin: h('path', { d: 'M9 4h6l-1 6 3 3H7l3-3-1-6zM12 13v7' }),
        plus: h('path', { d: 'M12 5v14M5 12h14' }),
        send: h('path', { d: 'M4.5 11.5 20 4l-5.5 16-3-6.5zM11.5 13.5 20 4' }),
        more: h('path', { d: 'M6 12h.01M12 12h.01M18 12h.01' }),
        history: h('path', { d: 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 8.5V4M4.5 8.5H9M12 8.5v4l2.8 1.8' }),
        list: h('path', { d: 'M5 7h14M5 12h14M5 17h9' }),
      }
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        paths[name] || paths.help,
      )
    }

    // ── 数据层 ──────────────────────────────────────────────────────
    // 一份 state 同时镜像到 ref：一串动作里后一个 op 要拿到前一个刚写出的 rev，
    // 不能等 React 下次渲染（否则第二次写必然撞 409）。
    const EMPTY_LAYOUT = { pos: {}, size: {}, collapsed: [], view: { x: 0, y: 0, zoom: 1 } }

    function useDesk(ctx) {
      const initial = {
        status: 'boot',
        error: null,
        project: null,
        recent: [],
        board: null,
        layout: EMPTY_LAYOUT,
        rev: null,
        stats: null,
        gaps: null,
        coverage: null,
        journalTail: [],
        history: [],
        syncing: false,
        // v1.16：最近一次 scan 回包里的「落地建议」（不落盘，只在本页显示）
        scanSuggestions: [],
      }
      const ref = useRef(initial)
      const [store, setStore] = useState(initial)
      const set = useCallback((next) => {
        const value = typeof next === 'function' ? next(ref.current) : { ...ref.current, ...next }
        ref.current = value
        setStore(value)
        return value
      }, [])
      const [toast, setToast] = useState(null)
      const toastTimer = useRef(null)
      const say = useCallback((text, kind = 'ok') => {
        setToast({ text, kind, id: Date.now() })
        clearTimeout(toastTimer.current)
        toastTimer.current = setTimeout(() => setToast(null), kind === 'error' ? 5200 : 3400)
      }, [])
      useEffect(() => () => clearTimeout(toastTimer.current), [])

      const applyState = useCallback(
        (data) => {
          if (!data) return ref.current
          // v1.17（A2）：/state 可能带 parts——只换回包里真给了的字段，缺省保留当前值；全量回包行为不变。
          const next = set((prev) => {
            const merged = { ...prev, status: 'ready', error: null }
            if (data.project) merged.project = data.project
            if (data.board !== undefined) merged.board = data.board
            if (data.layout !== undefined) merged.layout = data.layout
            if (data.rev !== undefined) merged.rev = data.rev
            if (data.stats !== undefined) merged.stats = data.stats
            if (data.gaps !== undefined) merged.gaps = data.gaps
            if (data.coverage !== undefined) merged.coverage = data.coverage
            if (data.journalTail !== undefined) merged.journalTail = data.journalTail
            if (Array.isArray(data.history)) merged.history = data.history
            return merged
          })
          if (data.project && data.project.path) {
            try {
              localStorage.setItem(LS_PROJECT, JSON.stringify(data.project))
            } catch {
              // 存不住也不影响用
            }
          }
          return next
        },
        [set],
      )

      /**
       * v1.17（A1）：纯 move 的增量回包只带回 {rev, layout, changed, layoutOnly}。
       * 只更新 layout/rev，**不替换 board、不碰 stats/gaps/coverage/history/journalTail**——
       * 图的「结构」对象（board）引用不变，React 不会重建整图。
       * layout 仍要进 store：否则暂停物理/切层时 mergePositions 会用旧坐标把刚拖过的件弹回去。
       */
      const applyLayoutOnly = useCallback(
        (data) => {
          if (!data) return ref.current
          return set((prev) => {
            const merged = { ...prev, status: 'ready', error: null }
            if (data.layout !== undefined) merged.layout = data.layout
            if (data.rev !== undefined) merged.rev = data.rev
            return merged
          })
        },
        [set],
      )

      const openProject = useCallback(
        async (path) => {
          set({ status: 'loading', error: null, scanSuggestions: [] })
          try {
            await apiPost('/bind', { project: path })
            const data = await apiGet('/state', { project: path })
            return applyState(data)
          } catch (error) {
            set({ status: 'ready', error: error.message })
            say(error.message, 'error')
            return null
          }
        },
        [applyState, say, set],
      )

      const boot = useCallback(async () => {
        set({ status: 'boot' })
        let recent = []
        try {
          recent = (await apiGet('/recent')).projects || []
        } catch (error) {
          set({ status: 'error', error: `连不上结构台宿主：${error.message}` })
          return
        }
        set({ recent })
        let saved = null
        try {
          saved = JSON.parse(localStorage.getItem(LS_PROJECT) || 'null')
        } catch {
          saved = null
        }
        const target = saved && saved.path ? saved.path : recent.length ? recent[0].path : null
        if (!target) {
          set({ status: 'welcome' })
          return
        }
        const data = await openProject(target)
        if (!data) set({ status: 'welcome' })
      }, [openProject, set])

      useEffect(() => {
        boot()
      }, [boot])

      const fail = useCallback(
        async (error, message) => {
          if (error && error.status === 409) {
            try {
              const fresh = await apiGet('/state', { project: ref.current.project.path })
              applyState(fresh)
            } catch {
              // 载不回来就只提示
            }
            say(message || '这块板刚被人改过，已载入最新；刚才那步没落地', 'error')
          } else {
            say(error.message, 'error')
          }
          return null
        },
        [applyState, say],
      )

      const sendOps = useCallback(
        async (ops, options = {}) => {
          const current = ref.current
          if (!current.project) return null
          // v1.17：纯 move（物理落盘/拖动落盘）不亮「写入中」、不 setStore——配合 layoutOnly 做到不回渲染整图。
          // 只含 move 的请求宿主一律回增量；带任何非 move 的照旧全量。
          const pureMove = Array.isArray(ops) && ops.length > 0 && ops.every((op) => op && op.op === 'move')
          if (!pureMove) set({ syncing: true })
          try {
            const body = { project: current.project.path, baseRev: options.baseRev || current.rev, ops, author: 'human' }
            if (options.replace) body.replace = options.replace
            if (options.summary) body.summary = options.summary
            const data = await apiPost('/ops', body)
            if (data && data.layoutOnly === true) applyLayoutOnly(data)
            else applyState(data)
            const errors = (data.changed && data.changed.errors) || []
            if (errors.length) {
              // v1.16：宿主的层只读错误带 code='layer-readonly'，把中文口径说清楚
              const first = errors[0] || {}
              if (first.code === 'layer-readonly') {
                const layer = AUTHOR_META[first.layer] ? AUTHOR_META[first.layer].label : '别的'
                say(`${layer}层的说法/计划只读：用「提一份我的说法」建自己层的新说法，不改写原文`, 'error')
              } else {
                say(`有 ${errors.length} 条没成：${first.message || '未知原因'}`, 'error')
              }
            }
            return data
          } catch (error) {
            return fail(error)
          } finally {
            if (!pureMove) set({ syncing: false })
          }
        },
        [applyLayoutOnly, applyState, fail, say, set],
      )

      const runScan = useCallback(
        async (options = {}) => {
          const current = ref.current
          if (!current.project) return null
          set({ syncing: true })
          try {
            const data = await apiPost('/scan', {
              project: current.project.path,
              baseRev: current.rev,
              root: options.root || '',
              limit: options.limit,
            })
            applyState(data)
            const scan = data.scan || {}
            set({ scanSuggestions: Array.isArray(scan.suggestions) ? scan.suggestions : [] })
            say(`扫描 ${scan.files} 个文件：新增 ${scan.added}／变化 ${scan.changed}／失联 ${scan.removed}${Array.isArray(scan.suggestions) && scan.suggestions.length ? `；落地建议 ${scan.suggestions.length} 条` : ''}`)
            return data
          } catch (error) {
            return fail(error, '板子刚变过，已载入最新；再点一次扫描')
          } finally {
            set({ syncing: false })
          }
        },
        [applyState, fail, say, set],
      )

      const exportFiles = useCallback(async () => {
        const current = ref.current
        if (!current.project) return null
        try {
          const data = await apiPost('/export', { project: current.project.path })
          say(`已写出 ${data.files.map((file) => file.path.split(/[\\/]/).pop()).join(' · ')}`)
          return data
        } catch (error) {
          say(error.message, 'error')
          return null
        }
      }, [say])

      const readBrief = useCallback(async () => {
        const current = ref.current
        if (!current.project) return null
        try {
          return await apiGet('/brief', { project: current.project.path })
        } catch (error) {
          say(error.message, 'error')
          return null
        }
      }, [say])

      const current = useCallback(() => ref.current, [])

      /** 整板替换（撤销／重做）：修订号取内部那份最新的，别用渲染时的旧值。 */
      const restore = useCallback(
        async (snapshot, summary) => {
          const current = ref.current
          if (!current.project || !snapshot) return null
          set({ syncing: true })
          try {
            const data = await apiPost('/ops', {
              project: current.project.path,
              baseRev: current.rev,
              replace: snapshot,
              summary,
            })
            return applyState(data)
          } catch (error) {
            return fail(error, '板子刚变过，撤销作废（避免覆盖别人的改动）')
          } finally {
            set({ syncing: false })
          }
        },
        [applyState, fail, set],
      )

      /** v1.14：回滚最近一批（宿主 /revert 整板 + 坐标回到那批动手之前）。 */
      const undoBatch = useCallback(
        async (batchId) => {
          const current = ref.current
          if (!current.project || !batchId) return null
          set({ syncing: true })
          try {
            const data = await apiPost('/revert', {
              project: current.project.path,
              baseRev: current.rev,
              batch: batchId,
            })
            applyState(data)
            const changed = data.changed || {}
            const count = (changed.added || []).length + (changed.updated || []).length + (changed.removed || []).length
            say(`已回滚最近一批：${count} 件回到动手之前（这次回滚也记成一批）`)
            return data
          } catch (error) {
            return fail(error, '板子刚变过，回滚作废（避免盖掉别人的改动）')
          } finally {
            set({ syncing: false })
          }
        },
        [applyState, fail, say, set],
      )

      const pickDirectory = useCallback(async () => {        try {
          const uiWorkspace = ctx.get('uiWorkspace')
          if (uiWorkspace && typeof uiWorkspace.pickDirectory === 'function') {
            const picked = await uiWorkspace.pickDirectory()
            if (picked) await openProject(picked)
            return
          }
        } catch {
          // 落到手输
        }
        const typed = window.prompt('项目目录（绝对路径）')
        if (typed) await openProject(typed)
      }, [ctx, openProject])

      // v1.17 验收调试口（和 __sdPhysDbg 一样只读）：读内存镜像。
      // stage v27 用它做引用比较——纯 move 回 layoutOnly 后 board 对象必须还是同一个，没被替换。
      useEffect(() => {
        window.__sdStoreDbg = () => {
          const current = ref.current
          return {
            project: current.project ? current.project.path : null,
            rev: current.rev,
            status: current.status,
            board: current.board,
            layout: current.layout,
            history: current.history,
            stats: current.stats,
          }
        }
        return () => {
          delete window.__sdStoreDbg
        }
      }, [])

      return useMemo(
        () => ({ store, current, patch: set, toast, say, boot, openProject, sendOps, runScan, exportFiles, readBrief, restore, undoBatch, pickDirectory, applyState }),
        [store, current, set, toast, say, boot, openProject, sendOps, runScan, exportFiles, readBrief, restore, undoBatch, pickDirectory, applyState],
      )
    }

    // ── 主组件 ──────────────────────────────────────────────────────
    function Panel({ ctx }) {
      const desk = useDesk(ctx)
      const { store } = desk
      const [selection, setSelection] = useState([])
      const [hover, setHover] = useState(null)
      const [typeFilter, setTypeFilter] = useState(null) // 只看某一型连接（点底栏图例；null＝全部）
      const [focusId, setFocusId] = useState(null) // 1 跳聚焦（落差/左栏定位后；点空白或 Esc 退）
      const [tool, setTool] = useState('select')
      const [positions, setPositions] = useState({})
      const [view, setView] = useState({ x: 0, y: 0, zoom: 1 })
      const [search, setSearch] = useState('')
      const [modal, setModal] = useState(null)
      const [collapsed, setCollapsed] = useState([])
      const [filters, setFilters] = useState({ human: true, agent: true, program: true, planned: true })
      // v1.16：层显隐就用 filters 的 human/agent/program（唯一真源，层板与图例都走它）；
      // planned 仍是「计划块显不显示」的显示筛选。域内视图是范围查询，与层显隐叠加。
      const [domainViewId, setDomainViewId] = useState(null)
      const [ignoredSuggestions, setIgnoredSuggestions] = useState({})
      const [marquee, setMarquee] = useState(null)
      const [menu, setMenu] = useState(null)
      const [dropTarget, setDropTarget] = useState(undefined)
      const [history, setHistory] = useState({ past: [], future: [] })
      // v1.15 桌边消息：底部命令条（可收起；收不收起记在 localStorage）
      const [barOpen, setBarOpen] = useState(() => {
        try {
          return localStorage.getItem('sd.bar') !== '0'
        } catch {
          return true
        }
      })
      const [barText, setBarText] = useState('')
      const [barState, setBarState] = useState({ phase: 'idle' })
      const [sessionsTick, setSessionsTick] = useState(0)
      // v1.14 看见改动：切片（点珠）、变更抽屉、角标基线
      const [sliceBatch, setSliceBatch] = useState(null)
      const [changesOpen, setChangesOpen] = useState(false)
      const [seenRev, setSeenRev] = useState(null)
      // v1.17（A2/A3）：/state 的 history 只剩摘要；diff/labels 按批懒取，batch -> {…摘要, diff, labels, detailTrimmed, keptBatches}
      const [historyDetails, setHistoryDetails] = useState({})
      const historyDetailRef = useRef({})
      const historyFetching = useRef(new Set())
      const sliceTrimNoted = useRef('')
      const seenInit = useRef(false)
      const canvasRef = useRef(null)
      const worldRef = useRef(null)
      const viewRef = useRef(view)
      const posRef = useRef(positions)
      const interaction = useRef(null)
      const dragFrame = useRef(0)
      const skipRestoreView = useRef(false)
      const searchRef = useRef(null)
      // v1.17 验收调试口：轮询确实先走 /rev、只在 rev 变了才拉 /state（stage v27 网络断言的辅助）
      const pollRef = useRef({ revPolls: 0, stateFetches: 0, lastRev: null, lastStateRev: null, lastAt: 0 })

      const board = store.board
      const layout = store.layout
      const projectPath = store.project ? store.project.path : null
      /**
       * v1.17（A2/A3）历史懒取：摘要里没有 diff/labels 时，按批问 GET /history?batch=，取到就缓存。
       * 同一批并发只发一次；旧宿主摘要自带 diff 的由调用方直接跳过，不会走到这里。
       * 超出保留 → {detailTrimmed:true, keptBatches:N}，调用方显示「详情已超出保留」。
       */
      const ensureBatchDetails = useCallback(
        async (batchId) => {
          if (!batchId || !projectPath) return null
          const cached = historyDetailRef.current[batchId]
          if (cached) return cached
          if (historyFetching.current.has(batchId)) return null
          historyFetching.current.add(batchId)
          try {
            const data = await apiGet('/history', { project: projectPath, batch: batchId })
            const summary = data && data.batch && typeof data.batch === 'object' ? data.batch : null
            const detail = summary
              ? { ...summary, batch: summary.batch || batchId, detailTrimmed: Boolean(data.detailTrimmed), keptBatches: data && Number(data.keptBatches) }
              : { batch: batchId, detailTrimmed: true, keptBatches: data && Number(data.keptBatches) }
            if (data && data.detailTrimmed) {
              detail.diff = null
              detail.labels = null
            }
            historyDetailRef.current = { ...historyDetailRef.current, [batchId]: detail }
            setHistoryDetails((prev) => ({ ...prev, [batchId]: detail }))
            return detail
          } catch {
            return null
          } finally {
            historyFetching.current.delete(batchId)
          }
        },
        [projectPath],
      )

      /** v1.17（A2）：打开抽屉时用 /history?since= 补摘要（新批摘要通常已随 /state 回来，这里是兜底）。 */
      const refreshHistoryIndex = useCallback(async () => {
        if (!projectPath || !desk.current) return
        const current = desk.current()
        const list = Array.isArray(current.history) ? current.history : []
        const since = list.length ? list[list.length - 1].batch : ''
        try {
          const data = await apiGet('/history', { project: projectPath, since })
          const fresh = Array.isArray(data && data.batches) ? data.batches : []
          if (!fresh.length) return
          desk.patch((prev) => {
            const known = new Set((prev.history || []).map((batch) => batch && batch.batch))
            const add = fresh.filter((batch) => batch && batch.batch && !known.has(batch.batch))
            if (!add.length) return prev
            return { ...prev, history: [...(prev.history || []), ...add] }
          })
        } catch {
          // 静默：抽屉照旧用已有摘要
        }
      }, [desk, projectPath])
      const boxes = useMemo(() => (board ? collectBoxes(board, positions, layout.size) : []), [board, positions, layout.size])
      const boxMap = useMemo(() => new Map(boxes.map((box) => [box.id, box])), [boxes])
      const domainIds = useMemo(() => new Set(board ? board.domains.map((d) => d.id) : []), [board])
      const coveredMap = useMemo(() => {
        const map = {}
        if (board) for (const link of board.links) if (link.type === 'covers') (map[link.to] ||= []).push(link.from)
        return map
      }, [board])
      const coveredByCount = useMemo(() => {
        const map = {}
        if (board) for (const link of board.links) if (link.type === 'covers') map[link.from] = (map[link.from] || 0) + 1
        return map
      }, [board])
      const selected = useMemo(() => new Set(selection), [selection])
      // 件类型表（domain/block/note/link）：连线按钮、端点判断、类型菜单过滤都用它
      const itemKinds = useMemo(() => {
        const map = new Map()
        if (!board) return map
        for (const domain of board.domains) map.set(domain.id, 'domain')
        for (const block of board.blocks) map.set(block.id, 'block')
        for (const note of board.notes) map.set(note.id, 'note')
        for (const link of board.links) map.set(link.id, 'link')
        return map
      }, [board])
      const selectedKind = selection.length === 1 ? itemKinds.get(selection[0]) : null
      const selectionMode = selection.length === 0 ? 'none' : selection.length === 1 ? 'one' : 'many'
      // 收起的域：它底下的件在画布上不画（折叠只改显示，不动模型）
      const hiddenByCollapse = useMemo(() => {
        const hidden = new Set()
        if (!board) return hidden
        const walk = (id) => {
          for (const domain of board.domains) {
            if (domain.parent !== id) continue
            hidden.add(domain.id)
            walk(domain.id)
          }
        }
        for (const id of collapsed) walk(id)
        return hidden
      }, [board, collapsed])

      // ── v1.16 层与可见性（契约 §2.5）──────────────────────────────
      // 件的层：由 author 导出，不新增字段。
      const itemById = useMemo(() => {
        const map = new Map()
        if (!board) return map
        for (const item of [...board.domains, ...board.blocks, ...board.notes]) map.set(item.id, item)
        return map
      }, [board])
      const layerById = useMemo(() => {
        const map = new Map()
        for (const [id, item] of itemById) map.set(id, layerOf(item))
        return map
      }, [itemById])

      // 域内视图：只画该域覆盖的块 + 直接子域 + plans 连到的计划块（便签不在范围内，保持范围口径干净）。
      const domainViewDomain = useMemo(
        () => (board && domainViewId ? board.domains.find((domain) => domain.id === domainViewId) || null : null),
        [board, domainViewId],
      )
      const domainViewSet = useMemo(() => {
        if (!board || !domainViewId) return null
        const set = new Set([domainViewId])
        for (const domain of board.domains) if (domain.parent === domainViewId) set.add(domain.id)
        for (const link of board.links) {
          if (link.type === 'covers' && link.from === domainViewId) set.add(link.to)
          if (link.type === 'plans' && link.from === domainViewId && !set.has(link.to)) set.add(link.to)
        }
        return set
      }, [board, domainViewId])

      /**
       * 可见（画不画）＝层显隐 ∧ 域内视图范围；折叠与「计划块」开关是既有的显示筛选，一并算硬过滤。
       * 硬过滤只有这两种（层、范围）。类型筛选／搜索／1 跳聚焦／切片都属强调，只调透明度、不改变可见性。
       * 层隐藏高于一切：搜索/聚焦/切片/类型筛选都不能把该层拉回来。
       */
      const visibleNodeIds = useMemo(() => {
        const set = new Set()
        if (!board) return set
        for (const item of [...board.domains, ...board.blocks, ...board.notes]) {
          if (hiddenByCollapse.has(item.id)) continue
          if (filters[layerOf(item)] === false) continue
          if (item.planned && filters.planned === false) continue
          if (domainViewSet && !domainViewSet.has(item.id)) continue
          set.add(item.id)
        }
        return set
      }, [board, hiddenByCollapse, filters, domainViewSet])
      const isVisibleNode = useCallback((id) => visibleNodeIds.has(id), [visibleNodeIds])

      // 域内视图里跨边界的连接：不画外部节点，只画从界内节点伸出去的一截虚线 + 类型标签（输入/输出桩）。
      const domainViewStubs = useMemo(() => {
        if (!board || !domainViewSet) return []
        const out = []
        for (const link of board.links) {
          const fromIn = domainViewSet.has(link.from)
          const toIn = domainViewSet.has(link.to)
          if (fromIn === toIn) continue
          const insideId = fromIn ? link.from : link.to
          const outsideId = fromIn ? link.to : link.from
          // 界内那端不可见（层隐藏/计划块被筛/折叠）时，这条边不画，桩也不画
          if (!visibleNodeIds.has(insideId)) continue
          const outside = itemById.get(outsideId)
          // 层隐藏高于一切：外部端所在层被隐藏时，这条边连桩都不画
          if (outside && filters[layerOf(outside)] === false) continue
          out.push({
            link,
            dir: fromIn ? 'out' : 'in', // in＝外部指向域内（输入桩）；out＝域内指向外部（输出桩）
            insideId,
            outsideId,
          })
        }
        return out
      }, [board, domainViewSet, filters, itemById, visibleNodeIds])

      /** 当前真实坐标的盒子（物理运行中 boxes 还是旧值，命中测试要用这个）。 */
      const liveBoxes = useCallback(() => {
        if (!board) return []
        const out = []
        const push = (id, size) => {
          if (!visibleNodeIds.has(id)) return
          const pos = livePos.current[id] || posRef.current[id]
          if (!pos) return
          out.push({ id, x: pos.x, y: pos.y, w: size.w, h: size.h })
        }
        for (const domain of board.domains) push(domain.id, domainSize(domain))
        for (const block of board.blocks) push(block.id, { w: BLOCK_W, h: BLOCK_H })
        for (const note of board.notes) push(note.id, nodeBox('note', note, layout.size))
        return out
      }, [board, layout.size, visibleNodeIds])

      const liveBoxMap = useCallback(() => new Map(liveBoxes().map((box) => [box.id, box])), [liveBoxes])

      // ── 物理运行态 ────────────────────────────────────────────
      // React 只画结构，left/top 由这里直接写到 DOM：拖动和物理都不走 re-render，
      // 拖一个件时邻件会实时被挤开——不用再手动整理。
      const [physicsOn, setPhysicsOn] = useState(true)
      // 'idle'＝暂停，'running'＝场在跑（v1.5 起物理是常驻的，不再有「静止」）
      const [simPhase, setSimPhase] = useState('idle')
      const physicsOnRef = useRef(true)
      const nodeEls = useRef(new Map())
      const linkEls = useRef(new Map())
      // v1.13：连接类型标签单独一层（画在节点之上）；这里存 g 元素好让它每帧跟着线走
      const labelEls = useRef(new Map())
      const hullEls = useRef(new Map())
      // v1.16：层包络与域内视图的输入/输出桩——每帧由 paintSim 贴回坐标
      const layerHullEls = useRef(new Map())
      const stubEls = useRef(new Map())
      const livePos = useRef({})
      // v1.7：上一帧实际画到的坐标（量化后）；没越过 0.5px 就不重写 DOM
      const paintRef = useRef(new Map())
      const simRef = useRef({ arr: [], nodes: new Map(), index: new Map(), springs: [], alpha: 0, frames: 0, dirty: false, paintWrites: 0, idleMode: false, lastStepAt: 0 })
      const rafRef = useRef(0)
      const runningRef = useRef(false)
      const tickRef = useRef(() => {})
      const lastWakeKey = useRef('')

      /** 节点元素登记：立刻摆到它当前的坐标（之后由物理／拖动直接写 style）。 */
      const registerNodeEl = useCallback((el, id) => {
        if (!el) {
          nodeEls.current.delete(id)
          return
        }
        nodeEls.current.set(id, el)
        const pos = livePos.current[id] || posRef.current[id]
        if (pos) {
          el.style.left = `${pos.x}px`
          el.style.top = `${pos.y}px`
        }
      }, [])

      const buildSim = useCallback(() => {
        if (!board) return null
        const sim = simRef.current
        const items = new Map([...board.domains, ...board.blocks, ...board.notes].map((item) => [item.id, item]))
        const kinds = new Map()
        const sizes = new Map()
        for (const domain of board.domains) {
          kinds.set(domain.id, 'domain')
          sizes.set(domain.id, domainSize(domain))
        }
        for (const block of board.blocks) {
          kinds.set(block.id, 'block')
          sizes.set(block.id, { w: BLOCK_W, h: BLOCK_H })
        }
        for (const note of board.notes) {
          kinds.set(note.id, 'note')
          sizes.set(note.id, nodeBox('note', note, layout.size))
        }
        const arr = []
        for (const [id, kind] of kinds) {
          const item = items.get(id)
          if (!item) continue
          if (hiddenByCollapse.has(id)) continue
          if (kind === 'block' && item.planned && !filters.planned) continue
          if (filters[layerOf(item)] === false) continue
          if (domainViewSet && !domainViewSet.has(id)) continue
          const pos = livePos.current[id] || posRef.current[id]
          if (!pos) continue
          const estimate = sizes.get(id)
          const el = nodeEls.current.get(id)
          const size = el && el.offsetWidth ? { w: el.offsetWidth, h: el.offsetHeight } : estimate
          arr.push({
            id,
            kind,
            layer: layerOf(item),
            x: pos.x,
            y: pos.y,
            w: size.w,
            h: size.h,
            r: (size.w + size.h) / 4,
            vx: 0,
            vy: 0,
            held: false,
          })
        }
        const index = new Map(arr.map((node, i) => [node.id, i]))
        const ids = new Set(arr.map((node) => node.id))
        const springs = []
        let linkEdges = 0
        for (const link of board.links) {
          if (!ids.has(link.from) || !ids.has(link.to)) continue
          springs.push({ from: link.from, to: link.to, rest: PHYS.linkRest[link.type] || 220, stiff: PHYS.linkStiff })
          linkEdges += 1
        }
        for (const domain of board.domains) {
          if (!domain.parent || !ids.has(domain.id) || !ids.has(domain.parent)) continue
          springs.push({ from: domain.parent, to: domain.id, rest: PHYS.childRest, stiff: PHYS.childStiff })
        }
        for (const note of board.notes) {
          if (!note.ref || !ids.has(note.id) || !ids.has(note.ref)) continue
          springs.push({ from: note.ref, to: note.id, rest: PHYS.noteRest, stiff: PHYS.noteStiff })
        }
        sim.arr = arr
        sim.nodes = new Map(arr.map((node) => [node.id, node]))
        sim.index = index
        sim.springs = springs
        for (const node of arr) {
          node.fx = 0
          node.fy = 0
        }
        // F 组仪表：当前在场节点/边（只记数字）
        perf.nodes = arr.length
        perf.edges = linkEdges
        return sim
      }, [board, hiddenByCollapse, filters, layout.size, domainViewSet])

      const paintSim = useCallback(() => {
        const sim = simRef.current
        const quantum = PHYS.quantum
        const q = (v) => Math.round(v / quantum) * quantum
        const painted = paintRef.current
        for (const node of sim.arr) {
          const el = nodeEls.current.get(node.id)
          const left = q(node.x)
          const top = q(node.y)
          if (el) {
            const last = painted.get(node.id)
            // v1.7：位置量化到 0.5px，量化值没变就不写 DOM——
            // 这是空闲时省 style recalc / paint 的主要来源，视觉上仍是连续漂移。
            if (!last || last.x !== left || last.y !== top) {
              el.style.left = `${left}px`
              el.style.top = `${top}px`
              painted.set(node.id, { x: left, y: top })
              sim.paintWrites += 1
            }
          }
          livePos.current[node.id] = { x: node.x, y: node.y }
        }
        const labelBoxes = []
        if (labelEls.current.size) {
          for (const node of sim.arr) labelBoxes.push({ id: node.id, x: node.x, y: node.y, w: node.w, h: node.h })
        }
        for (const [linkId, els] of linkEls.current) {
          const a = sim.nodes.get(els.from)
          const b = sim.nodes.get(els.to)
          if (!a || !b) continue
          const x1 = q(a.x + a.w / 2)
          const y1 = q(a.y + a.h / 2)
          const x2 = q(b.x + b.w / 2)
          const y2 = q(b.y + b.h / 2)
          const d = `M${x1},${y1} L${x2},${y2}`
          if (els.lastD !== d) {
            els.line.setAttribute('d', d)
            els.hit.setAttribute('d', d)
            els.lastD = d
            sim.paintWrites += 1
          }
          const labelEl = labelEls.current.get(linkId)
          if (labelEl) {
            // v1.13：类型标签贴着线走（以前只有 React 重渲染才更新，物理一动就漂离线、还会被卡片盖住）。
            // 先放中点；若会压在别的件上，就沿线的 0.42/0.58/0.34… 找一处空位。
            const free = (px, py) => labelBoxes.every((box) => {
              if (box.id === els.from || box.id === els.to) return true
              return !(px + 26 > box.x && px - 26 < box.x + box.w && py + 9 > box.y && py - 9 < box.y + box.h)
            })
            let lx = (x1 + x2) / 2
            let ly = (y1 + y2) / 2
            if (!free(lx, ly)) {
              for (const t of [0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82]) {
                const px = q(x1 + (x2 - x1) * t)
                const py = q(y1 + (y2 - y1) * t)
                if (free(px, py)) {
                  lx = px
                  ly = py
                  break
                }
              }
            }
            const transform = `translate(${q(lx)} ${q(ly)})`
            if (labelEl.getAttribute('transform') !== transform) {
              labelEl.setAttribute('transform', transform)
              sim.paintWrites += 1
            }
          }
        }
        for (const [domainId, el] of hullEls.current) {
          if (!board) continue
          const descendants = descendantDomainIds(board, domainId)
          let minX = Infinity
          let minY = Infinity
          let maxX = -Infinity
          let maxY = -Infinity
          for (const childId of descendants) {
            if (childId === domainId) continue
            const node = sim.nodes.get(childId)
            if (!node) continue
            minX = Math.min(minX, node.x)
            minY = Math.min(minY, node.y)
            maxX = Math.max(maxX, node.x + node.w)
            maxY = Math.max(maxY, node.y + node.h)
          }
          if (!Number.isFinite(minX)) continue
          const box = { left: q(minX - 22), top: q(minY - 30), width: q(maxX - minX + 44), height: q(maxY - minY + 50) }
          const last = el.__sdBox
          if (!last || last.left !== box.left || last.top !== box.top || last.width !== box.width || last.height !== box.height) {
            el.style.left = `${box.left}px`
            el.style.top = `${box.top}px`
            el.style.width = `${box.width}px`
            el.style.height = `${box.height}px`
            el.__sdBox = box
            sim.paintWrites += 1
          }
        }
        // v1.16：层包络——按层把该层当前可见节点框起来（每帧跟着物理走；没有节点就藏起来）
        for (const [layer, el] of layerHullEls.current) {
          let minX = Infinity
          let minY = Infinity
          let maxX = -Infinity
          let maxY = -Infinity
          for (const node of sim.arr) {
            if (node.layer !== layer) continue
            minX = Math.min(minX, node.x)
            minY = Math.min(minY, node.y)
            maxX = Math.max(maxX, node.x + node.w)
            maxY = Math.max(maxY, node.y + node.h)
          }
          if (!Number.isFinite(minX)) {
            if (el.style.display !== 'none') el.style.display = 'none'
            continue
          }
          if (el.style.display === 'none') el.style.display = ''
          const box = { left: q(minX - 26), top: q(minY - 34), width: q(maxX - minX + 52), height: q(maxY - minY + 60) }
          const last = el.__sdBox
          if (!last || last.left !== box.left || last.top !== box.top || last.width !== box.width || last.height !== box.height) {
            el.style.left = `${box.left}px`
            el.style.top = `${box.top}px`
            el.style.width = `${box.width}px`
            el.style.height = `${box.height}px`
            el.__sdBox = box
            sim.paintWrites += 1
          }
        }
        // v1.16：域内视图的输入/输出桩——从界内节点朝界外节点伸一小截，每帧跟手
        for (const entry of stubEls.current.values()) {
          const a = sim.nodes.get(entry.insideId)
          if (!a) continue
          // 外部节点不进模拟（域内视图不画它），方向用渲染时留下的盒子算
          const geo = stubGeometry(a, entry.outsideBox || null)
          if (entry.path && entry.path.getAttribute('d') !== geo.d) entry.path.setAttribute('d', geo.d)
          if (entry.label && entry.label.getAttribute('transform') !== geo.transform) entry.label.setAttribute('transform', geo.transform)
        }
      }, [board])

      /** 把当前坐标拍一张快照落盘；stop=顺便把场停下来（暂停/关物理时用）。 */
      const persistSim = useCallback(
        (options = {}) => {
          const sim = simRef.current
          if (!sim.arr.length) return
          if (options.separate !== false) resolveOverlaps(sim.arr)
          paintSim()
          const next = { ...posRef.current }
          const moves = {}
          let changed = 0
          for (const node of sim.arr) {
            const pos = { x: Math.round(node.x), y: Math.round(node.y) }
            const old = next[node.id]
            if (!old || old.x !== pos.x || old.y !== pos.y) changed += 1
            next[node.id] = pos
            moves[node.id] = pos
          }
          posRef.current = next
          setPositions(next)
          sim.dirty = false
          // 一点没动就不写盘：结构变了但不用挪的唤醒（比如只改说法）不该改板子
          if (changed) desk.sendOps([{ op: 'move', positions: moves }])
          const reason = sim.reason || ''
          sim.reason = ''
          if (changed && reason === 'auto') desk.say(`物理：自动整理了 ${changed} 个件`)
          if (options.stop) {
            runningRef.current = false
            setSimPhase('idle')
          }
        },
        [desk, paintSim],
      )

      const requestSim = useCallback(() => {
        if (rafRef.current) return
        rafRef.current = requestAnimationFrame(() => tickRef.current())
      }, [])

      /** 把场加热到至少 heat（0..1）并确保循环在跑：结构变了、拖了、抖一抖都走这里。 */
      const wakeSim = useCallback(
        (options = {}) => {
          if (!board) return
          // v1.9：物理关着＝一律不许点着场。唯一例外是开关自己（打开时先翻 physicsOnRef，再走这里）。
          // 之前「重排」漏判这条，暂停状态下点一下就把常驻场重新点着了，而 UI 仍显示「暂停」。
          if (!physicsOnRef.current) return
          buildSim()
          const sim = simRef.current
          if (!sim.arr.length) return
          if (options.impulse) {
            // 冲量可以是 true（抖一抖，26）或一个更轻的数（开关打开时给一点，让「物理开了」看得见）
            const strength = typeof options.impulse === 'number' ? options.impulse : 26
            for (const node of sim.arr) {
              if (node.held) continue
              node.vx += (Math.random() - 0.5) * strength
              node.vy += (Math.random() - 0.5) * strength
            }
          }
          const heat = options.heat === undefined ? 1 : options.heat
          sim.alpha = Math.max(sim.alpha || 0, heat)
          sim.dirty = true
          sim.reason = options.reason || 'manual'
          sim.frames = 0
          runningRef.current = true
          // F 组：重新开跑时清掉上一段的「帧间隔」基准，别把暂停时长算成一帧
          perf.lastFrameAt = 0
          setSimPhase('running')
          requestSim()
        },
        [board, buildSim, requestSim],
      )

      // 调试口：面板里能看到物理到底在干什么（自动化验收和用户排查都用得上）
      useEffect(() => {
        window.__sdPhysDbg = () => ({
          running: runningRef.current,
          phase: simPhase,
          physicsOn: physicsOnRef.current,
          nodes: simRef.current.arr.length,
          alpha: Math.round((simRef.current.alpha || 0) * 1000) / 1000,
          dirty: simRef.current.dirty === true,
          speed: Math.round((simRef.current.lastTravel || 0) * 100) / 100,
          idle: simRef.current.idleMode === true,
          frames: simRef.current.frames || 0,
          paintWrites: simRef.current.paintWrites || 0,
        })
        return () => {
          delete window.__sdPhysDbg
        }
      }, [simPhase])

      // 热力场常驻：没有「收工」，只有暂停；alpha 降到地板、有改动时拍一张落盘快照。
      // v1.7：空闲（到地板且没在拖）时 60fps→30fps；一加热／一拖动立刻回 60fps。
      // v1.17 F 组：这里用 performance.now() 量物理步 / paintSim 段 / DOM 写入次数，环形缓冲只记数字。
      useEffect(() => {
        tickRef.current = () => {
          rafRef.current = 0
          const frameAt = perfNow()
          if (perf.lastFrameAt) perfPush(perf.frameMs, frameAt - perf.lastFrameAt)
          perf.lastFrameAt = frameAt
          if (!runningRef.current) {
            perf.idle = true
            return
          }
          const sim = simRef.current
          if (!sim.arr.length) {
            runningRef.current = false
            perf.idle = true
            return
          }
          const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
          const dragging = Boolean(interaction.current && interaction.current.kind === 'drag')
          sim.idleMode = !dragging && (sim.alpha || 0) <= PHYS.idleAlpha
          if (sim.idleMode && sim.lastStepAt && now - sim.lastStepAt < PHYS.idleFrameGap) {
            // 空闲降帧：这一帧不跑物理，只把 idle 状态记下来
            perf.idle = true
            rafRef.current = requestAnimationFrame(() => tickRef.current())
            return
          }
          sim.lastStepAt = now
          const physicsStart = perfNow()
          physicsStep(sim)
          const physicsMs = perfNow() - physicsStart
          const deriveStart = perfNow()
          paintSim()
          const deriveMs = perfNow() - deriveStart
          const writes = sim.paintWrites || 0
          const writeDelta = writes >= perf.lastPaintWrites ? writes - perf.lastPaintWrites : 0
          perf.lastPaintWrites = writes
          perfPush(perf.physicsMs, physicsMs)
          perfPush(perf.deriveMs, deriveMs)
          perfPush(perf.domWrites, writeDelta)
          perf.rafFrames += 1
          perf.idle = Boolean(sim.idleMode)
          sim.frames = (sim.frames || 0) + 1
          if (sim.dirty && sim.alpha <= PHYS.persistAt && sim.frames % 30 === 0) persistSim()
          rafRef.current = requestAnimationFrame(() => tickRef.current())
        }
      }, [paintSim, persistSim])

      // 页面隐藏（切标签页／最小化）时不烧帧：停循环，回来接着跑。
      useEffect(() => {
        const onVisibility = () => {
          if (document.hidden) {
            cancelAnimationFrame(rafRef.current)
            rafRef.current = 0
            runningRef.current = false
            perf.lastFrameAt = 0
            perf.idle = true
            setSimPhase('idle')
            return
          }
          if (!physicsOnRef.current) return
          const sim = simRef.current
          if (!sim.arr.length) return
          runningRef.current = true
          setSimPhase('running')
          requestSim()
        }
        document.addEventListener('visibilitychange', onVisibility)
        return () => document.removeEventListener('visibilitychange', onVisibility)
      }, [requestSim])

      // 物理什么时候自己跑（不用鼠标）：可见件／装域／连接／域宽变了，
      // 或者物理重新打开——只要「该上画的件都有坐标」就唤醒一趟。
      // 新加的件也在这一趟里被收进模拟（以前等鼠标拖才动，就是因为唤醒时它还没坐标）。
      const visibleIds = useMemo(() => {
        if (!board) return []
        const out = []
        for (const domain of board.domains) {
          if (hiddenByCollapse.has(domain.id)) continue
          if (filters[layerOf(domain)] === false) continue
          if (domainViewSet && !domainViewSet.has(domain.id)) continue
          out.push(domain.id)
        }
        for (const block of board.blocks) {
          if (hiddenByCollapse.has(block.id)) continue
          if (filters[layerOf(block)] === false) continue
          if (domainViewSet && !domainViewSet.has(block.id)) continue
          if (block.planned && !filters.planned) continue
          out.push(block.id)
        }
        for (const note of board.notes) {
          if (hiddenByCollapse.has(note.id)) continue
          if (filters[layerOf(note)] === false) continue
          if (domainViewSet && !domainViewSet.has(note.id)) continue
          out.push(note.id)
        }
        return out
      }, [board, hiddenByCollapse, filters, domainViewSet])
      const physicsSig = useMemo(() => {
        if (!board || !visibleIds.length) return ''
        // 尺寸只取「会挂到画布上、且随内容变」的部分：域宽度、便签挂靠
        const sized = []
        for (const domain of board.domains) sized.push(`${domain.id}:${domainSize(domain).w}`)
        for (const note of board.notes) sized.push(`${note.id}:${note.ref || ''}`)
        return [
          visibleIds.join(','),
          sized.join(','),
          board.domains.map((domain) => `${domain.id}:${domain.parent || ''}`).join(','),
          board.links.map((link) => `${link.id}:${link.type}:${link.from}:${link.to}`).join(','),
        ].join('|')
      }, [board, visibleIds])
      useEffect(() => {
        if (!physicsOn) {
          // 关着的时候结构还在变，重新打开时必须补跑一次
          lastWakeKey.current = ''
          return
        }
        if (!board || !physicsSig || !Object.keys(positions).length) return
        // 新件还没坐标：先让 mergePositions 摆好，下一次渲染再连它一起收
        if (!visibleIds.every((id) => positions[id])) return
        if (lastWakeKey.current === physicsSig) return
        lastWakeKey.current = physicsSig
        wakeSim({ heat: PHYS.heat.add, reason: 'auto' })
      }, [physicsSig, visibleIds, physicsOn, board, positions, wakeSim])

      useEffect(
        () => () => {
          // 常驻场没有「静止」时刻：卸下时把当前坐标落一次盘
          try {
            const sim = simRef.current
            if (runningRef.current && sim.arr.length) {
              const moves = {}
              for (const node of sim.arr) moves[node.id] = { x: Math.round(node.x), y: Math.round(node.y) }
              if (Object.keys(moves).length) desk.sendOps([{ op: 'move', positions: moves }])
            }
          } catch {
            // 面板已经卸了就算了
          }
          runningRef.current = false
          cancelAnimationFrame(rafRef.current)
          rafRef.current = 0
        },
        [],
      )

      // positions 是「已落盘」的坐标：载入／撤销／远端改时把它摆回 DOM。
      // 物理跑着的时候不要抢，否则每帧被旧坐标打回去。
      useEffect(() => {
        if (runningRef.current) return
        livePos.current = { ...positions }
        for (const [id, el] of nodeEls.current) {
          const pos = positions[id]
          if (!pos) continue
          el.style.left = `${pos.x}px`
          el.style.top = `${pos.y}px`
        }
      }, [positions])

      // 位置与折叠跟板子同步；拖拽中不动。物理常驻时（running）只补缺的坐标、不抢已有坐标。
      useEffect(() => {
        if (!board) return
        if (interaction.current && interaction.current.kind === 'drag') return
        const running = runningRef.current
        const merged = mergePositions(board, layout)
        if (merged.missing.length) {
          const auto = autoLayout(board)
          const next = { ...merged.positions }
          const moves = {}
          // 便签不进力导向：排到整张图的右边、竖向错开，别压在块和域上
          let rightEdge = 0
          let topEdge = Infinity
          for (const item of merged.missing) {
            const spot = auto[item.id]
            if (!spot) continue
            rightEdge = Math.max(rightEdge, spot.x + 260)
            topEdge = Math.min(topEdge, spot.y)
          }
          if (!Number.isFinite(topEdge)) topEdge = MARGIN
          let fallback = 0
          for (const item of merged.missing) {
            const spot = auto[item.id] || { x: (rightEdge || MARGIN) + 140, y: topEdge + 160 * fallback++ }
            next[item.id] = spot
            moves[item.id] = spot
          }
          setPositions(next)
          posRef.current = next
          // 首次自动排坐标：直接按算出来的世界坐标定视口，
          // 不等 DOM、不靠后续渲染（早先「等 DOM 再 fit」会输给紧接着的 re-render）。
          if (Object.keys(merged.positions).length === 0) {
            const fitted = fitViewFor(next, board, layout.size, canvasRef.current)
            if (fitted) {
              // 这一屏的视口由 fit 定；稍后的「恢复上次视口」不许再盖回去
              skipRestoreView.current = true
              setView(fitted)
            }
          }
          if (Object.keys(moves).length) desk.sendOps([{ op: 'move', positions: moves }])
          if (running) {
            // 新件补好坐标后直接并进场里，加热一下让它自己归位
            buildSim()
            const sim = simRef.current
            sim.alpha = Math.max(sim.alpha || 0, PHYS.heat.add)
            sim.dirty = true
          }
        } else if (!running) {
          setPositions(merged.positions)
          posRef.current = merged.positions
        }
        setCollapsed(Array.isArray(layout.collapsed) ? layout.collapsed : [])
      }, [board, layout, physicsOn, buildSim])

      // 视口：按项目记在本地
      useEffect(() => {
        viewRef.current = view
        if (worldRef.current) worldRef.current.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`
      }, [view])

      useEffect(() => {
        if (!projectPath) return
        // 刚给新板子做过首次 fit 的话，这一轮别用本地记的旧视口盖掉它
        if (skipRestoreView.current) {
          skipRestoreView.current = false
          return
        }
        try {
          const saved = JSON.parse(localStorage.getItem(LS_VIEW + projectPath) || 'null')
          if (saved && Number.isFinite(saved.zoom)) setView(saved)
        } catch {
          // 没有就用默认
        }
      }, [projectPath])

      // 视口持久化（节流）
      const viewTimer = useRef(null)
      useEffect(() => {
        if (!projectPath) return
        clearTimeout(viewTimer.current)
        viewTimer.current = setTimeout(() => {
          try {
            localStorage.setItem(LS_VIEW + projectPath, JSON.stringify(view))
          } catch {
            // 存不住就算了
          }
        }, 400)
        return () => clearTimeout(viewTimer.current)
      }, [view, projectPath])

      // 静默同步（v1.17 A2/G5）：每 9 秒先问 GET /rev（≤2KB）；rev 未变什么都不做；
      // 变了才拉 /state?parts=… 并走现有同步逻辑。页面隐藏/拖拽中照旧不跑；错误静默重试。
      useEffect(() => {
        if (!store.project || store.status !== 'ready') return
        let alive = true
        const timer = setInterval(async () => {
          if (!alive || document.hidden) return
          if (interaction.current) return
          try {
            const head = await apiGet('/rev', { project: store.project.path })
            if (!alive) return
            const nextRev = head && head.rev
            pollRef.current = { ...pollRef.current, revPolls: pollRef.current.revPolls + 1, lastRev: nextRev, lastAt: Date.now() }
            if (!nextRev || nextRev === store.rev) return
            // 变了才拉：board 大、其余小；gaps/coverage 一起带，请不起额外派生也能保持落差/计划视图正确
            const data = await apiGet('/state', { project: store.project.path, parts: 'board,layout,stats,gaps,coverage,history,journal' })
            if (!alive) return
            pollRef.current = { ...pollRef.current, stateFetches: pollRef.current.stateFetches + 1, lastStateRev: data && data.rev }
            if (data.rev && data.rev !== store.rev) {
              desk.applyState(data)
              desk.say('已载入新的改动')
            }
          } catch {
            // 静默重试
          }
        }, 9000)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [store.project, store.status, store.rev, desk])
      // v1.17 验收调试口（只读）：stage v27 用它断言「轮询先走 /rev、未变不拉 /state」，不用猜网络事件时序
      useEffect(() => {
        window.__sdPollDbg = () => ({ ...pollRef.current })
        return () => {
          delete window.__sdPollDbg
        }
      }, [])

      // 世界坐标换算
      const toWorld = useCallback((clientX, clientY) => {
        const rect = canvasRef.current.getBoundingClientRect()
        const v = viewRef.current
        return { x: (clientX - rect.left - v.x) / v.zoom, y: (clientY - rect.top - v.y) / v.zoom }
      }, [])

      // v1.7：拖拽起点取「物理实时坐标」，不再用上次落盘的 posRef——
      // 否则板子跑一会儿后抓件，第一次移动会把件弹回旧位置（长按偏移的来源）。
      // v1.10：优先用 livePos（画面实际坐标）而不是 sim.nodes——物理暂停后 sim 不再更新，
      // 重排／撤销／外部改板之后 sim.nodes 还是旧的；点一下（带 1px 抖动）会被按旧坐标写回，看起来像弹回原位。
      const grabOrigins = useCallback((ids) => {
        const sim = simRef.current
        const origins = {}
        for (const id of ids) {
          const node = sim.nodes.get(id)
          const point = livePos.current[id] || (node ? { x: node.x, y: node.y } : posRef.current[id])
          if (point) origins[id] = { x: point.x, y: point.y }
        }
        return origins
      }, [])

      const zoomAt = useCallback((factor, clientX, clientY) => {
        const rect = canvasRef.current.getBoundingClientRect()
        const v = viewRef.current
        const zoom = clamp(v.zoom * factor, 0.22, 2.4)
        const px = clientX === undefined ? rect.width / 2 : clientX - rect.left
        const py = clientY === undefined ? rect.height / 2 : clientY - rect.top
        const wx = (px - v.x) / v.zoom
        const wy = (py - v.y) / v.zoom
        setView({ zoom, x: px - wx * zoom, y: py - wy * zoom })
      }, [])

      const fitView = useCallback(() => {
        const source = liveBoxes()
        const list = source.length ? source : boxes
        if (!canvasRef.current || !list.length) {
          setView({ x: 0, y: 0, zoom: 1 })
          return
        }
        const rect = canvasRef.current.getBoundingClientRect()
        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        for (const box of list) {
          minX = Math.min(minX, box.x)
          minY = Math.min(minY, box.y)
          maxX = Math.max(maxX, box.x + box.w)
          maxY = Math.max(maxY, box.y + box.h)
        }
        const pad = 60
        const zoom = clamp(Math.min((rect.width - pad * 2) / (maxX - minX || 1), (rect.height - pad * 2) / (maxY - minY || 1)), 0.22, 1.6)
        setView({
          zoom,
          x: rect.width / 2 - ((minX + maxX) / 2) * zoom,
          y: rect.height / 2 - ((minY + maxY) / 2) * zoom,
        })
      }, [boxes, liveBoxes])

      const centerOn = useCallback(
        (id) => {
          const box = livePos.current[id]
            ? { ...(liveBoxMap().get(id) || { w: 0, h: 0 }), ...livePos.current[id] }
            : boxMap.get(id)
          const rect = canvasRef.current && canvasRef.current.getBoundingClientRect()
          if (!box || !rect) return
          const zoom = viewRef.current.zoom
          const w = box.w || 0
          const h = box.h || 0
          setView({ zoom, x: rect.width / 2 - (box.x + w / 2) * zoom, y: rect.height / 2 - (box.y + h / 2) * zoom })
        },
        [boxMap, liveBoxMap],
      )

      // ── 改板子的动作 ────────────────────────────────────────────
      const remember = useCallback(() => {
        const now = desk.current ? desk.current() : store
        if (!now.board) return
        setHistory((prev) => ({ past: [...prev.past.slice(-40), { board: now.board, rev: now.rev }], future: [] }))
      }, [desk, store])

      const commitLayout = useCallback(
        (next) => {
          setPositions(next)
          posRef.current = next
        },
        [],
      )

      const moveTo = useCallback(
        async (moves) => {
          const ids = Object.keys(moves)
          if (!ids.length) return
          const next = { ...posRef.current }
          for (const [id, pos] of Object.entries(moves)) next[id] = pos
          commitLayout(next)
          await desk.sendOps([{ op: 'move', positions: moves }])
        },
        [commitLayout, desk],
      )

      // 建域：选了块就顺手盖住（先建域拿到 id，再连覆盖）
      const newDomain = useCallback(
        async ({ at, coverFromSelection = true, parent = null } = {}) => {
          if (!store.board) return
          remember()
          const ids = coverFromSelection ? selection.filter((id) => !domainIds.has(id)) : []
          const parentPos = parent ? posRef.current[parent] : null
          const spot =
            at ||
            (parentPos
              ? { x: parentPos.x + 60, y: parentPos.y + 70 }
              : freeSpot(livePos.current, store.board, viewRef.current, {
                  width: canvasRef.current ? canvasRef.current.clientWidth : 800,
                  height: canvasRef.current ? canvasRef.current.clientHeight : 600,
                }))
          const created = await desk.sendOps([{ op: 'add_domain', title: '新域', statement: '', parent: parent || null }])
          if (!created) return
          const added = created.changed && created.changed.added ? created.changed.added : []
          const domainId = added.find((id) => String(id).startsWith('D'))
          if (domainId) {
            await moveTo({ [domainId]: spot })
            setSelection([domainId])
            if (ids.length) {
              await desk.sendOps(ids.map((id) => ({ op: 'add_link', from: domainId, to: id, type: 'covers' })))
            }
          }
        },
        [desk, domainIds, remember, selection, store.board, moveTo],
      )

      const newBlock = useCallback(
        async ({ at } = {}) => {
          if (!store.board) return
          remember()
          const spot =
            at ||
            freeSpot(livePos.current, store.board, viewRef.current, {
              width: canvasRef.current ? canvasRef.current.clientWidth : 800,
              height: canvasRef.current ? canvasRef.current.clientHeight : 600,
            })
          const taken = new Set(store.board.blocks.map((b) => b.path))
          let suggestion = '新计划'
          for (let n = 2; taken.has(suggestion); n++) suggestion = `新计划 ${n}`
          // Electron 里没有 window.prompt：先建再在右栏改名，比弹框顺手
          const created = await desk.sendOps([{ op: 'add_block', path: suggestion, kind: 'plan', planned: true, note: '' }])
          if (!created) return
          const added = (created.changed && created.changed.added) || []
          const blockId = added.find((id) => String(id).startsWith('B'))
          if (blockId) {
            await moveTo({ [blockId]: spot })
            setSelection([blockId])
            desk.say('计划块画出来了：右栏改地址，实现后在「落地为」里接上实块')
          }
        },
        [desk, remember, store.board, moveTo],
      )

      const newNote = useCallback(
        async ({ at } = {}) => {
          if (!store.board) return
          remember()
          const spot =
            at ||
            freeSpot(livePos.current, store.board, viewRef.current, {
              width: canvasRef.current ? canvasRef.current.clientWidth : 800,
              height: canvasRef.current ? canvasRef.current.clientHeight : 600,
            })
          const created = await desk.sendOps([{ op: 'add_note', text: '随手记', ref: selection.length === 1 ? selection[0] : null }])
          if (!created) return
          const added = (created.changed && created.changed.added) || []
          const noteId = added.find((id) => String(id).startsWith('N'))
          if (noteId) {
            await moveTo({ [noteId]: spot })
            setSelection([noteId])
          }
        },
        [desk, remember, selection, store.board, moveTo],
      )

      const toggleCollapse = useCallback(
        (id) => {
          const next = collapsed.includes(id) ? collapsed.filter((x) => x !== id) : [...collapsed, id]
          setCollapsed(next)
          desk.sendOps([{ op: 'move', collapsed: next }])
        },
        [collapsed, desk],
      )

      const removeNode = useCallback(
        async (id) => {
          remember()
          await desk.sendOps([{ op: 'remove', id }])
          setSelection((prev) => prev.filter((x) => x !== id))
        },
        [desk, remember],
      )

      const removeSelection = useCallback(async () => {
        if (!selection.length) return
        remember()
        const ops = selection.map((id) => ({ op: 'remove', id }))
        await desk.sendOps(ops)
        setSelection([])
      }, [desk, remember, selection])

      const makeLink = useCallback(
        async (from, to, type) => {
          remember()
          const data = await desk.sendOps([{ op: 'add_link', from, to, type }])
          if (data) desk.say(`连线：${LINK_META[type].label}`)
        },
        [desk, remember],
      )

      const updateItem = useCallback(
        (id, fields) => {
          if (String(id).startsWith('D')) {
            if (fields.title !== undefined || fields.statement !== undefined || fields.status !== undefined || fields.note !== undefined || fields.parent !== undefined || fields.tags !== undefined || fields.criteria !== undefined) {
              remember()
              return desk.sendOps([{ op: 'update_domain', id, ...fields }])
            }
            return null
          }
          if (String(id).startsWith('B')) {
            remember()
            return desk.sendOps([{ op: 'update_block', id, ...fields }])
          }
          if (String(id).startsWith('N')) {
            remember()
            return desk.sendOps([{ op: 'update_note', id, ...fields }])
          }
          if (String(id).startsWith('L')) {
            remember()
            return desk.sendOps([{ op: 'update_link', id, ...fields }])
          }
          return null
        },
        [desk, remember],
      )

      // ── v1.16：层显隐 / 域内视图 / 拆计划块 / 跨层提案 / 落地建议 ──
      /** 层板的眼睛：切该层显隐，并按项目记进 localStorage['sd.layers.'+项目]。 */
      const toggleLayer = useCallback(
        (layer) => {
          setFilters((cur) => {
            const next = { ...cur, [layer]: cur[layer] === false }
            if (projectPath) {
              try {
                localStorage.setItem(
                  LS_LAYERS + projectPath,
                  JSON.stringify({ human: next.human !== false, agent: next.agent !== false, program: next.program !== false }),
                )
              } catch {
                // 存不住不影响用
              }
            }
            return next
          })
          const meta = LAYER_META[layer]
          const willShow = filters[layer] === false
          desk.say(willShow ? `显示${meta ? meta.label : layer}层` : `隐藏${meta ? meta.label : layer}层（搜索/聚焦也拉不回来）`)
        },
        [desk, filters, projectPath],
      )

      const enterDomainView = useCallback(
        (id) => {
          if (!id || !board || !board.domains.some((domain) => domain.id === id)) return
          setDomainViewId(id)
          setFocusId(null)
          setTypeFilter(null)
          setTool('select')
          setChangesOpen(false)
          setSelection([id])
          const domain = board.domains.find((item) => item.id === id)
          desk.say(`进入域内视图：${domain ? domain.title : id}（Esc 退出）`)
          setTimeout(() => centerOn(id), 40)
        },
        [board, centerOn, desk],
      )
      const exitDomainView = useCallback(() => {
        if (!domainViewId) return
        setDomainViewId(null)
        desk.say('退出域内视图')
      }, [desk, domainViewId])

      /** 域检视器「拆计划块」：一行一个；先批量 add_block，再按拿到的 id 批量 add_link plans。 */
      const splitPlannedBlocks = useCallback(
        async (domainId, text) => {
          const lines = String(text || '')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
          if (!lines.length) {
            desk.say('一行写一个计划块（路径或标题），别空着', 'error')
            return null
          }
          if (lines.length > 30) {
            desk.say('一次最多拆 30 个计划块', 'error')
            return null
          }
          remember()
          const created = await desk.sendOps(lines.map((line) => ({ op: 'add_block', path: line, planned: true, kind: 'plan' })))
          if (!created) return null
          const added = ((created.changed && created.changed.added) || []).filter((id) => String(id).startsWith('B'))
          const now = desk.current ? desk.current() : store
          const nowBoard = now.board
          const idByPath = new Map()
          for (const id of added) {
            const block = nowBoard && nowBoard.blocks.find((item) => item.id === id)
            if (block) idByPath.set(block.path, id)
          }
          const ops = []
          lines.forEach((line, index) => {
            const blockId = idByPath.get(line) || added[index]
            if (blockId) ops.push({ op: 'add_link', from: domainId, to: blockId, type: 'plans' })
          })
          if (ops.length) await desk.sendOps(ops)
          desk.say(`从域拆出 ${ops.length} 个计划块（plans 连接已连）`)
          return created
        },
        [desk, remember, store],
      )

      /** 跨层提案：在自己层新建一条说法，用 relates/contradicts 指向对方；不碰原文。 */
      const createProposal = useCallback(
        async ({ targetId, title, statement, relation }) => {
          if (!targetId) return null
          const cleanTitle = String(title || '').trim()
          if (!cleanTitle) {
            desk.say('给这条说法起个标题', 'error')
            return null
          }
          const linkType = relation === 'contradicts' ? 'contradicts' : 'relates'
          remember()
          const created = await desk.sendOps([{ op: 'add_domain', title: cleanTitle, statement: String(statement || '').trim() }])
          if (!created) return null
          const added = (created.changed && created.changed.added) || []
          const domainId = added.find((id) => String(id).startsWith('D'))
          if (!domainId) {
            desk.say('提案建好了，但没拿到新域 id；到左栏域树里手动连一下', 'error')
            return created
          }
          await desk.sendOps([{ op: 'add_link', from: domainId, to: targetId, type: linkType }])
          const targetPos = posRef.current[targetId]
          if (targetPos) await moveTo({ [domainId]: { x: targetPos.x + 30, y: targetPos.y + 86 } })
          setSelection([domainId])
          desk.say(`已提一份我的说法（${LINK_META[linkType].label}原说法）；原说法没被改写`)
          return created
        },
        [desk, moveTo, remember],
      )

      const settleSuggestion = useCallback(
        async (row) => {
          if (!row) return null
          remember()
          const data = await desk.sendOps([{ op: 'add_link', from: row.planned.id, to: row.real.id, type: 'grounds' }])
          if (data) {
            setIgnoredSuggestions((prev) => ({ ...prev, [row.key]: 'done' }))
            desk.say(`已落地：${row.planned.id} → ${row.real.id}（grounds 已写入）`)
          }
          return data
        },
        [desk, remember],
      )
      const ignoreSuggestion = useCallback((row) => {
        if (!row) return
        setIgnoredSuggestions((prev) => ({ ...prev, [row.key]: 'ignored' }))
        desk.say(`先忽略这条落地建议（本页记着，刷新后 scan 还会再算）`)
      }, [desk])

      // v1.8：左栏多选后的批量操作。一次 sendOps＝一次请求、一次原子写盘（journal 仍按 op 各记一条）。
      const batchUpdateDomains = useCallback(
        async (ids, fields, summary) => {
          if (!ids.length) return null
          remember()
          const ops = ids.map((id) => ({ op: 'update_domain', id, ...fields }))
          const data = await desk.sendOps(ops)
          if (summary) desk.say(summary)
          return data
        },
        [desk, remember],
      )

      const batchSetStatus = useCallback(
        (ids, status) => batchUpdateDomains(ids, { status }, `批量：${ids.length} 个域 → ${STATUS_META[status].label}`),
        [batchUpdateDomains],
      )

      const batchSetParent = useCallback(
        (ids, parentId) => {
          if (!board) return null
          const all = board.domains
          const ok = ids.filter((id) => {
            if (parentId === null) return true
            if (parentId === id) return false
            return !isDescendantOf(all, parentId, id)
          })
          if (!ok.length) return null
          const parent = all.find((domain) => domain.id === parentId)
          const summary = parentId === null
            ? `批量：${ok.length} 个域升为根域`
            : `批量：${ok.length} 个域装进「${(parent && parent.title) || parentId}」`
          return batchUpdateDomains(ok, { parent: parentId }, summary)
        },
        [batchUpdateDomains, board],
      )

      const batchSetTags = useCallback(
        (ids, action) => {
          if (!board || !ids.length) return null
          const tag = action && action.add ? String(action.add).trim() : ''
          const ops = []
          for (const id of ids) {
            const domain = board.domains.find((item) => item.id === id)
            if (!domain) continue
            const tags = domain.tags || []
            if (action.clear) {
              if (tags.length) ops.push({ op: 'update_domain', id, tags: [] })
            } else if (tag && !tags.includes(tag)) {
              ops.push({ op: 'update_domain', id, tags: [...tags, tag] })
            }
          }
          if (!ops.length) return null
          remember()
          const data = desk.sendOps(ops)
          desk.say(action.clear ? `批量：清空 ${ops.length} 个域的标签` : `批量：给 ${ops.length} 个域加标签「${tag}」`)
          return data
        },
        [board, desk, remember],
      )

      const batchRemoveDomains = useCallback(
        async (ids) => {
          if (!ids.length) return null
          remember()
          const data = await desk.sendOps(ids.map((id) => ({ op: 'remove', id })))
          setSelection((prev) => prev.filter((id) => !ids.includes(id)))
          desk.say(`批量：删了 ${ids.length} 个域（Ctrl+Z 撤销）`)
          return data
        },
        [desk, remember],
      )

      const undo = useCallback(async () => {
        if (!history.past.length) return
        const now = desk.current ? desk.current() : store
        if (!now.board) return
        const previous = history.past[history.past.length - 1]
        setHistory({ past: history.past.slice(0, -1), future: [...history.future, { board: now.board, rev: now.rev }] })
        await desk.restore(previous.board, '撤销一步')
      }, [desk, history, store])

      const redo = useCallback(async () => {
        if (!history.future.length) return
        const now = desk.current ? desk.current() : store
        if (!now.board) return
        const next = history.future[history.future.length - 1]
        setHistory({ past: [...history.past, { board: now.board, rev: now.rev }], future: history.future.slice(0, -1) })
        await desk.restore(next.board, '重做一步')
      }, [desk, history, store])

      const arrange = useCallback(async () => {
        if (!store.board) return
        remember()
        const next = autoLayout(store.board)
        const keepNotes = { ...next }
        for (const note of store.board.notes) if (posRef.current[note.id]) keepNotes[note.id] = posRef.current[note.id]
        commitLayout(keepNotes)
        await desk.sendOps([{ op: 'move', positions: next }])
        if (physicsOnRef.current) {
          wakeSim({ heat: PHYS.heat.arrange, reason: 'arrange' })
        } else {
          // v1.9：物理关着时「重排」只把力导向算出的新布局静态摆上并落盘，不点着场。
          // 这时画布立刻停在新布局上；之后打开物理会从这里起跑。
          desk.say('重排：已重排（物理关着，不跑）')
        }
        setTimeout(fitView, 30)
      }, [commitLayout, desk, fitView, remember, store.board, wakeSim])

      // ── 指针交互 ────────────────────────────────────────────────
      // 拖节点时：开了物理就把它钉在指针上、其余节点实时让开；没开就只挪自己。
      useEffect(() => {
        function onMove(event) {
          const current = interaction.current
          if (!current) return
          if (current.kind === 'pan') {
            setView({ ...current.startView, x: current.startView.x + (event.clientX - current.startX), y: current.startView.y + (event.clientY - current.startY) })
            return
          }
          if (current.kind === 'drag') {
            const world = toWorld(event.clientX, event.clientY)
            const dx = world.x - current.startWorld.x
            const dy = world.y - current.startWorld.y
            if (!current.moved && Math.hypot(dx, dy) * viewRef.current.zoom > 3) current.moved = true
            if (physicsOn) {
              if (!runningRef.current) buildSim()
              const sim = simRef.current
              // 拖 = 加热：邻件会明显地让开（原型 pointerdown/pointermove 里 alpha=max(alpha,0.5)）
              sim.alpha = Math.max(sim.alpha || 0, PHYS.heat.drag)
              sim.dirty = true
              setSimPhase('running')
              for (const [id, origin] of Object.entries(current.origins)) {
                const node = sim.nodes.get(id)
                if (!node) continue
                node.x = origin.x + dx
                node.y = origin.y + dy
                node.vx = 0
                node.vy = 0
                node.held = true
                livePos.current[id] = { x: node.x, y: node.y }
                const el = nodeEls.current.get(id)
                if (el) {
                  el.style.left = `${node.x}px`
                  el.style.top = `${node.y}px`
                }
              }
              if (!runningRef.current) {
                sim.reason = 'drag'
                runningRef.current = true
                setSimPhase('running')
                requestSim()
              } else {
                // 拖动的一瞬间也让邻件与线跟上，不等下一帧
                paintSim()
              }
            } else {
              // v1.10：暂停时没过拖拽阈值（3px）一律不算拖——点击/手抖不再把件挪几像素。
              // 旧实现每收到一次 pointermove 就按 origin+dx 写位置，点一下会白挪 3~5px（还不落盘）；
              // 重排/撤销之后起点若取自过期的 sim.nodes，更会整件弹回旧位置。
              if (!current.moved) return
              const next = { ...livePos.current }
              for (const [id, origin] of Object.entries(current.origins)) {
                next[id] = { x: Math.round(origin.x + dx), y: Math.round(origin.y + dy) }
              }
              posRef.current = next
              livePos.current = next
              cancelAnimationFrame(dragFrame.current)
              dragFrame.current = requestAnimationFrame(() => setPositions(next))
            }
            // 拖着域压到另一个域上＝准备装进去
            const single = Object.keys(current.origins)
            if (single.length === 1 && board && board.domains.some((d) => d.id === single[0])) {
              const dragged = single[0]
              const now = liveBoxMap()
              const over = board.domains.find((domain) => {
                if (domain.id === dragged) return false
                if (descendantsOf(board, dragged).has(domain.id)) return false
                const box = now.get(domain.id)
                return box && world.x >= box.x && world.x <= box.x + box.w && world.y >= box.y && world.y <= box.y + box.h
              })
              setDropTarget(over ? over.id : event.altKey ? null : undefined)
            }
            return
          }
          if (current.kind === 'marquee') {
            const rect = canvasRef.current.getBoundingClientRect()
            const x1 = Math.min(current.startX, event.clientX - rect.left)
            const y1 = Math.min(current.startY, event.clientY - rect.top)
            const x2 = Math.max(current.startX, event.clientX - rect.left)
            const y2 = Math.max(current.startY, event.clientY - rect.top)
            setMarquee({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 })
            current.rect = { x1, y1, x2, y2 }
          }
        }
        function onUp(event) {
          const current = interaction.current
          if (!current) return
          interaction.current = null
          if (current.kind === 'drag') {
            const ids = Object.keys(current.origins)
            // 松手：先放开按住标记（held 在 pointerdown 就设，物理不会把被按住的件带走）
            for (const node of simRef.current.arr) node.held = false
            const ops = []
            const draggedDomain = ids.length === 1 && board ? board.domains.find((d) => d.id === ids[0]) : null
            if (draggedDomain && current.moved) {
              const world = toWorld(event.clientX, event.clientY)
              const now = liveBoxMap()
              const target = board.domains.find((domain) => {
                if (domain.id === draggedDomain.id) return false
                if (descendantsOf(board, draggedDomain.id).has(domain.id)) return false
                const box = now.get(domain.id)
                return box && world.x >= box.x && world.x <= box.x + box.w && world.y >= box.y && world.y <= box.y + box.h
              })
              if (target) {
                ops.push({ op: 'update_domain', id: draggedDomain.id, parent: target.id })
                desk.say(`装进「${target.title}」`)
              } else if (event.altKey && draggedDomain.parent) {
                ops.push({ op: 'update_domain', id: draggedDomain.id, parent: null })
                desk.say('升成根域')
              }
            }
            setDropTarget(undefined)
            const sim = simRef.current
            if (physicsOn) {
              if (current.moved) {
                sim.alpha = Math.max(sim.alpha || 0, PHYS.heat.drag)
                for (const id of ids) {
                  const node = sim.nodes.get(id)
                  if (node) {
                    node.vx = 0
                    node.vy = 0
                  }
                }
                // 连续场里没有「静止」那一刻，松手先拍一张快照落盘
                persistSim()
                sim.dirty = true
                if (!runningRef.current) {
                  runningRef.current = true
                  setSimPhase('running')
                  requestSim()
                }
              }
            } else if (current.moved) {
              const moves = {}
              for (const id of ids) if (livePos.current[id]) moves[id] = livePos.current[id]
              if (Object.keys(moves).length) ops.unshift({ op: 'move', positions: moves })
            }
            if (ops.length) {
              remember()
              desk.sendOps(ops)
            }
            return
          }
          if (current.kind === 'marquee') {
            const rect = current.rect
            setMarquee(null)
            if (rect && (rect.x2 - rect.x1 > 6 || rect.y2 - rect.y1 > 6)) {
              const v = viewRef.current
              const wx1 = (rect.x1 - v.x) / v.zoom
              const wy1 = (rect.y1 - v.y) / v.zoom
              const wx2 = (rect.x2 - v.x) / v.zoom
              const wy2 = (rect.y2 - v.y) / v.zoom
              const hits = liveBoxes()
                .filter((box) => box.x < wx2 && box.x + box.w > wx1 && box.y < wy2 && box.y + box.h > wy1)
                .map((box) => box.id)
              setSelection((prev) => (event.shiftKey ? Array.from(new Set([...prev, ...hits])) : hits))
            }
          }
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        return () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
        }
      }, [board, desk, liveBoxMap, liveBoxes, paintSim, persistSim, physicsOn, remember, requestSim, toWorld])

      // 滚轮：原生监听（React 的 onWheel 是 passive，preventDefault 不生效）
      useEffect(() => {
        const el = canvasRef.current
        if (!el) return
        function onWheel(event) {
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault()
            zoomAt(event.deltaY > 0 ? 0.9 : 1.1, event.clientX, event.clientY)
            return
          }
          if (event.shiftKey || event.deltaMode !== 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY) * 0.6) {
            event.preventDefault()
            setView((v) => ({ ...v, x: v.x - event.deltaX - (event.shiftKey ? event.deltaY : 0), y: v.y - (event.shiftKey ? 0 : event.deltaY) }))
            return
          }
          event.preventDefault()
          zoomAt(event.deltaY > 0 ? 0.92 : 1.08, event.clientX, event.clientY)
        }
        el.addEventListener('wheel', onWheel, { passive: false })
        return () => el.removeEventListener('wheel', onWheel)
      }, [zoomAt, store.status])

      const onCanvasPointerDown = useCallback(
        (event) => {
          if (event.button === 1 || (event.button === 0 && (event.altKey || event.metaKey || event.ctrlKey))) {
            interaction.current = { kind: 'pan', startX: event.clientX, startY: event.clientY, startView: viewRef.current }
            event.preventDefault()
            return
          }
          if (event.button !== 0) return
          const world = toWorld(event.clientX, event.clientY)
          const target = event.target
          const nodeEl = target instanceof Element ? target.closest('[data-node-id]') : null
          if (nodeEl) {
            const id = nodeEl.getAttribute('data-node-id')
            if (tool === 'link') {
              const fromKind = selection.length === 1 ? itemKinds.get(selection[0]) : null
              const toKind = itemKinds.get(id)
              // 便签不是连接端点：直接说清楚用「挂住」，别让它弹出一个必然被宿主拒的菜单
              if (toKind === 'note' || fromKind === 'note') {
                setSelection([id])
                setTool('select')
                desk.say('便签不参与连线：用右栏「挂住」把它挂到某个域/块上', 'error')
                return
              }
              if (selection.length === 1 && selection[0] !== id) {
                setMenu({ x: event.clientX, y: event.clientY, from: selection[0], to: id })
                setTool('select')
                return
              }
            }
            const base = event.shiftKey ? (selected.has(id) ? selection.filter((x) => x !== id) : [...selection, id]) : selected.has(id) ? selection : [id]
            setSelection(base)
            if (event.shiftKey) return
            const origins = grabOrigins(base)
            if (!Object.keys(origins).length) return
            // 按下即按住：拖动期间物理不再把件从指针下带走（长按不漂、首次移动不跳）
            for (const grabbedId of Object.keys(origins)) {
              const node = simRef.current.nodes.get(grabbedId)
              if (node) {
                node.held = true
                node.vx = 0
                node.vy = 0
              }
            }
            interaction.current = { kind: 'drag', startWorld: world, origins, moved: false }
            return
          }
          if (tool === 'domain') {
            newDomain({ at: { x: Math.round(world.x - 40), y: Math.round(world.y - 16) }, coverFromSelection: true })
            setTool('select')
            return
          }
          if (tool === 'block') {
            newBlock({ at: { x: Math.round(world.x - BLOCK_W / 2), y: Math.round(world.y - BLOCK_H / 2) } })
            setTool('select')
            return
          }
          if (tool === 'note') {
            newNote({ at: { x: Math.round(world.x - NOTE_W / 2), y: Math.round(world.y - 20) } })
            setTool('select')
            return
          }
          if (tool === 'link') {
            setTool('select')
            desk.say('连线：先点起点，再点终点', 'error')
          }
          setFocusId(null) // 点空白＝退出 1 跳聚焦
          const rect = canvasRef.current.getBoundingClientRect()
          interaction.current = {
            kind: 'marquee',
            startX: event.clientX - rect.left,
            startY: event.clientY - rect.top,
            additive: event.shiftKey,
          }
          if (!event.shiftKey) setSelection([])
        },
        [desk, grabOrigins, itemKinds, newBlock, newDomain, newNote, selected, selection, tool, toWorld],
      )

      // ── 键盘 ────────────────────────────────────────────────────
      useEffect(() => {
        function onKey(event) {
          const tag = event.target && event.target.tagName
          const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (event.target && event.target.isContentEditable)
          if (event.key === 'Escape') {
            if (modal) setModal(null)
            else if (menu) setMenu(null)
            else if (changesOpen) setChangesOpen(false)
            else if (sliceBatch) setSliceBatch(null)
            else if (tool !== 'select') setTool('select')
            else if (domainViewId) setDomainViewId(null)
            else if (focusId || typeFilter) {
              setFocusId(null)
              setTypeFilter(null)
            } else {
              setSelection([])
              setSearch('')
            }
            return
          }
          if (typing) {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) event.target.blur()
            return
          }
          const meta = event.metaKey || event.ctrlKey
          if (meta && event.key.toLowerCase() === 'z') {
            event.preventDefault()
            if (event.shiftKey) redo()
            else undo()
            return
          }
          if (meta && event.key.toLowerCase() === 's') {
            event.preventDefault()
            desk.exportFiles()
            return
          }
          if (event.key === '/') {
            event.preventDefault()
            if (searchRef.current) searchRef.current.focus()
            return
          }
          if (event.key === '?') {
            setModal({ type: 'help' })
            return
          }
          if (event.key === 'Delete' || event.key === 'Backspace') {
            if (selection.length) {
              event.preventDefault()
              removeSelection()
            }
            return
          }
          const key = event.key.toLowerCase()
          if (key === 'v') setTool('select')
          if (key === 'd') {
            event.preventDefault()
            newDomain({ coverFromSelection: true })
          }
          if (key === 'b') {
            event.preventDefault()
            newBlock()
          }
          if (key === 'n') {
            event.preventDefault()
            newNote()
          }
          if (key === 'l') {
            if (selection.length === 1 && itemKinds.get(selection[0]) === 'note') {
              desk.say('便签不参与连线：用右栏「挂住」把它挂到某个域/块上', 'error')
            } else if (selection.length === 1) {
              setTool('link')
              desk.say('连线：再点一个件当终点')
            } else {
              desk.say('先选中一个件，再按 L 连线', 'error')
            }
          }
          if (key === 'f') fitView()
          if (key === '0') setView({ x: 0, y: 0, zoom: 1 })
          if (key === '=' || key === '+') zoomAt(1.15)
          if (key === '-') zoomAt(0.87)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [changesOpen, desk, domainViewId, fitView, focusId, itemKinds, menu, modal, newBlock, newDomain, newNote, redo, removeSelection, selection, sliceBatch, tool, typeFilter, undo, zoomAt])

      // v1.15：会话列表一变（切会话/开始跑/跑完）就重画一次命令条的目标与状态。
      useEffect(() => {
        let sessions = null
        try {
          sessions = ctx.get('sessions')
        } catch {
          sessions = null
        }
        if (!sessions || !sessions.list || typeof sessions.list.subscribe !== 'function') return undefined
        return sessions.list.subscribe(() => setSessionsTick((value) => value + 1))
      }, [ctx])

      // v1.15：命令条收不收起记在 localStorage（和项目/视口记忆一致）。
      useEffect(() => {
        try {
          localStorage.setItem('sd.bar', barOpen ? '1' : '0')
        } catch {
          // 存不住不影响用
        }
      }, [barOpen])

      // ── 渲染数据 ────────────────────────────────────────────────
      const domainTree = useMemo(() => {
        if (!board) return []
        const build = (parent) => board.domains.filter((d) => d.parent === parent).map((d) => ({ ...d, children: build(d.id) }))
        return build(null)
      }, [board])
      const gapItems = useMemo(() => {
        if (!board || !store.gaps) return {}
        const byId = new Map([...board.domains, ...board.blocks].map((item) => [item.id, item]))
        const out = {}
        for (const meta of GAP_META) {
          const ids = store.gaps[meta.key] || []
          out[meta.key] = ids.map((id) => {
            const item = byId.get(id)
            if (meta.key === 'conflicts') {
              const link = board.links.find((l) => l.id === id)
              if (!link) return { id, label: id }
              const nameOf = (nodeId) => {
                const node = byId.get(nodeId)
                return node ? node.title || node.address : nodeId
              }
              return { id, label: `${nameOf(link.from)} ✕ ${nameOf(link.to)}` }
            }
            if (!item) return { id, label: id }
            return { id, label: item.title ? item.title : item.address, author: item.author }
          })
        }
        return out
      }, [board, store.gaps])

      const searchHit = useMemo(() => {
        const q = search.trim().toLowerCase()
        if (!q) return null
        const hits = new Set()
        if (!board) return hits
        for (const d of board.domains) if (`${d.title} ${d.statement} ${d.tags.join(' ')}`.toLowerCase().includes(q)) hits.add(d.id)
        for (const b of board.blocks) if (`${b.address} ${b.note}`.toLowerCase().includes(q)) hits.add(b.id)
        for (const n of board.notes) if (n.text.toLowerCase().includes(q)) hits.add(n.id)
        // v1.12：连接也参与搜索——输入「矛盾」「依赖」「覆盖」等类型能直接找到线，并同时点亮两端。
        for (const link of board.links) {
          const meta = LINK_META[link.type] || {}
          if (`${meta.label || ''} ${link.type} ${link.note || ''}`.toLowerCase().includes(q)) {
            hits.add(link.id)
            hits.add(link.from)
            hits.add(link.to)
          }
        }
        return hits
      }, [board, search])

      // v1.12：悬停一个件＝局部看它连了谁；1 跳聚焦＝左栏/落差定位后把邻域以外淡出。
      const hoverNode = hover && !String(hover).startsWith('L') ? hover : null
      const hoverLinkId = hover && String(hover).startsWith('L') ? hover : null
      const hoverNeighbors = useMemo(() => (hoverNode ? oneHopIds(board, hoverNode) : null), [board, hoverNode])
      const focusSet = useMemo(() => (focusId ? oneHopIds(board, focusId) : null), [board, focusId])

      // ── v1.14 看见改动：未读批 / 角标 / 切片 / 抽屉行 ───────────────
      const batches = useMemo(() => (Array.isArray(store.history) ? store.history : []), [store.history])
      // 换项目时重置基线与切片；角标基线只在该项目第一次打开时初始化，之后靠「标记已读」推进。
      useEffect(() => {
        seenInit.current = false
        setSeenRev(null)
        setSliceBatch(null)
        setChangesOpen(false)
        // v1.16：域内视图、落地建议的页内忽略表都是「本页」状态，换项目就清
        setDomainViewId(null)
        setIgnoredSuggestions({})
        // v1.17：历史详情的懒取缓存也按项目清（batch id 可能复用）
        historyDetailRef.current = {}
        historyFetching.current = new Set()
        setHistoryDetails({})
        // v1.16：层显隐按项目记在 localStorage（缺省全显示；只认显式的 false）
        let saved = null
        try {
          saved = JSON.parse(localStorage.getItem(LS_LAYERS + projectPath) || 'null')
        } catch {
          saved = null
        }
        setFilters((cur) => ({
          ...cur,
          human: !saved || saved.human !== false,
          agent: !saved || saved.agent !== false,
          program: !saved || saved.program !== false,
        }))
      }, [projectPath])
      // v1.16：域没了（被删/被撤销/远端改了）就自动退出域内视图，别停在一个空范围里。
      useEffect(() => {
        if (!domainViewId) return
        if (!board || !board.domains.some((domain) => domain.id === domainViewId)) setDomainViewId(null)
      }, [board, domainViewId])
      useEffect(() => {
        if (!projectPath || store.status !== 'ready' || !store.rev) return
        if (seenInit.current) return
        seenInit.current = true
        let stored = null
        try {
          stored = localStorage.getItem(LS_SEEN + projectPath)
        } catch {
          stored = null
        }
        if (!stored) {
          try {
            localStorage.setItem(LS_SEEN + projectPath, store.rev)
          } catch {
            // 存不住不影响用
          }
          setSeenRev(store.rev)
        } else {
          setSeenRev(stored)
        }
      }, [projectPath, store.status, store.rev])
      // 未读＝seenRev 之后写下的批（从新往旧找到 revAfter===seenRev 为止）
      const unseen = useMemo(() => {
        if (!seenRev || !store.rev || seenRev === store.rev) return []
        const out = []
        for (let index = batches.length - 1; index >= 0; index -= 1) {
          if (batches[index].revAfter === seenRev) return out
          out.unshift(batches[index])
        }
        return out
      }, [batches, seenRev, store.rev])
      const unseenCount = useMemo(() => unseen.reduce((sum, batch) => {
        const counts = batchBeadCounts(batch)
        return sum + counts.added + counts.changed + counts.removed
      }, 0), [unseen])
      // v1.17：一批的 diff/labels 从哪来——旧宿主摘要里自带 diff 就用摘要；新宿主摘要只有 counts，
      // 走 /history?batch= 懒取（historyDetails 缓存，重复打开不重拉）。取不到（还没到/已超保留）返回 null。
      const batchDetailOf = (batch) => {
        if (!batch || !batch.batch) return null
        if (batch.diff) return batch
        return historyDetails[batch.batch] || null
      }
      const badgeMap = useMemo(() => {
        const map = new Map()
        for (const batch of unseen) {
          const detail = batchDetailOf(batch)
          for (const kind of CHANGE_KIND_ORDER) {
            for (const id of (detail && detail.diff && detail.diff[kind]) || []) {
              const marks = map.get(id) || { added: 0, updated: 0, removed: 0 }
              marks[kind] += 1
              map.set(id, marks)
            }
          }
        }
        return map
      }, [unseen, historyDetails])
      const conflictNodes = useMemo(() => {
        const set = new Set()
        if (board) {
          for (const link of board.links) {
            if (link.type !== 'contradicts') continue
            set.add(link.from)
            set.add(link.to)
          }
        }
        return set
      }, [board])
      const sliceEntry = useMemo(
        () => (sliceBatch ? batches.find((batch) => batch.batch === sliceBatch) || null : null),
        [batches, sliceBatch],
      )
      const sliceDetail = useMemo(
        () => (sliceEntry ? (sliceEntry.diff ? sliceEntry : historyDetails[sliceEntry.batch] || null) : null),
        [sliceEntry, historyDetails],
      )
      const sliceKindMap = useMemo(() => {
        if (!sliceEntry) return null
        const map = new Map()
        for (const kind of CHANGE_KIND_ORDER) {
          for (const id of (sliceDetail && sliceDetail.diff && sliceDetail.diff[kind]) || []) if (!map.has(id)) map.set(id, kind === 'added' ? 'new' : kind === 'updated' ? 'changed' : 'removed')
        }
        return map
      }, [sliceEntry, sliceDetail])
      const sliceSet = useMemo(() => (sliceKindMap ? new Set(sliceKindMap.keys()) : null), [sliceKindMap])
      // 抽屉：切片时只看这一批；有未读看未读；都读过了就看最近 10 批（按类型分组）
      const drawerBatches = useMemo(
        () => (sliceEntry ? [sliceEntry] : unseen.length ? unseen : batches.slice(-10)),
        [batches, sliceEntry, unseen],
      )
      const changeRows = useMemo(() => {
        const source = drawerBatches
        const rows = []
        for (const batch of source.slice().reverse()) {
          const detail = batchDetailOf(batch)
          if (!detail) continue // 详情还没拉到（懒取中）或已超保留；行会在拉到后补上
          for (const kind of CHANGE_KIND_ORDER) {
            for (const id of (detail.diff && detail.diff[kind]) || []) {
              rows.push({
                key: `${batch.batch}:${kind}:${id}`,
                batch: batch.batch,
                at: batch.at,
                kind,
                id,
                group: changeKindOfItem(id),
                label: (detail.labels && detail.labels[id]) || id,
                summary: batch.summary || '',
              })
            }
          }
        }
        return rows
      }, [drawerBatches, historyDetails])
      const changeGroups = useMemo(() => {
        const order = [
          { kind: 'domain', label: '域' },
          { kind: 'block', label: '块' },
          { kind: 'link', label: '连接' },
          { kind: 'note', label: '便签' },
          { kind: 'other', label: '其它' },
        ]
        return order
          .map((group) => ({ ...group, rows: changeRows.filter((row) => row.group === group.kind) }))
          .filter((group) => group.rows.length)
      }, [changeRows])
      // 切片只影响画布上还存在的件；被删的件只在抽屉与珠子里
      const sliceOf = (id) => (sliceKindMap ? sliceKindMap.get(id) || null : null)
      // 这一批被回滚/历史被清掉时，切片自己退掉
      useEffect(() => {
        if (sliceBatch && !batches.some((batch) => batch.batch === sliceBatch)) setSliceBatch(null)
      }, [batches, sliceBatch])
      // v1.17：抽屉里哪些批的详情已超出保留（懒取回 detailTrimmed 后才有；显示「已超出保留（N 批前）」）
      const detailNotes = useMemo(
        () =>
          (changesOpen ? drawerBatches : [])
            .map((batch) => {
              const detail = historyDetails[batch.batch]
              return detail && detail.detailTrimmed ? { batch: batch.batch, keptBatches: Number(detail.keptBatches) || 0 } : null
            })
            .filter(Boolean),
        [changesOpen, drawerBatches, historyDetails],
      )
      // v1.17：抽屉里的批还有详情在路上（显示「正在读取」而不是误报「没有新改动」）
      const detailPending = useMemo(() => {
        if (!changesOpen) return false
        return drawerBatches.some(
          (batch) => !batchDetailOf(batch) && !(historyDetails[batch.batch] && historyDetails[batch.batch].detailTrimmed),
        )
      }, [changesOpen, drawerBatches, historyDetails])
      // v1.17（A2/A3）：未读角标 / 切片 / 抽屉要用的 diff 按批懒取（缓存；旧宿主摘要自带 diff 的跳过）
      useEffect(() => {
        if (!projectPath) return
        const wanted = new Set()
        for (const batch of unseen) if (batch && batch.batch) wanted.add(batch.batch)
        if (sliceBatch) wanted.add(sliceBatch)
        if (changesOpen) for (const batch of drawerBatches) if (batch && batch.batch) wanted.add(batch.batch)
        for (const id of wanted) {
          if (historyDetailRef.current[id] || historyFetching.current.has(id)) continue
          const summary = batches.find((batch) => batch.batch === id)
          if (summary && summary.diff) continue
          ensureBatchDetails(id)
        }
      }, [unseen, sliceBatch, changesOpen, drawerBatches, batches, projectPath, ensureBatchDetails])
      // v1.17（A2）：抽屉打开时补一次历史摘要（/history?since=；新批通常已随 /state 回来，这是兜底）
      useEffect(() => {
        if (!changesOpen) return
        refreshHistoryIndex()
      }, [changesOpen, refreshHistoryIndex])
      // v1.17：点珠切片但该批详情已超出保留 → 明确说一声（切片只能按摘要看，不回退整页）
      useEffect(() => {
        if (!sliceBatch || sliceTrimNoted.current === sliceBatch) return
        const detail = historyDetails[sliceBatch]
        if (!detail || !detail.detailTrimmed) return
        sliceTrimNoted.current = sliceBatch
        desk.say(`这一批的详情已超出保留（${Number(detail.keptBatches) || 0} 批前），只能看摘要`, 'error')
      }, [sliceBatch, historyDetails, desk])

      const hoverIncidentCount = useMemo(() => {
        if (!hoverNode || !board) return 0
        return board.links.filter((link) => link.from === hoverNode || link.to === hoverNode).length
      }, [board, hoverNode])
      // v1.12：画布节点的三种强调——悬停自己、焦点自己、1 跳邻居；其余淡出。
      // v1.14：点珠切片时，这一批改到的件亮、其余淡出。
      // v1.16（契约 §2.5）：强调层统一成「搜索 ∪ 1 跳聚焦 ∪ 时间轴切片」——命中任一即亮，
      // 有模式开启时全不命中才淡出；层显隐是硬过滤（在 visibleNodeIds 里已经挡掉），这里只管透明度。
      const isEmphasized = useCallback(
        (id) => {
          if (sliceSet && sliceSet.has(id)) return true
          if (focusSet && focusSet.has(id)) return true
          if (searchHit && searchHit.has(id)) return true
          return false
        },
        [sliceSet, focusSet, searchHit],
      )
      const emphasisOf = (id, dim, dimOpacity = 0.14, normal = 1) => {
        const isHover = hover === id
        const isFocus = focusId === id
        const isHop = !isHover && !isFocus && Boolean(focusSet && focusSet.has(id))
        let opacity
        if (sliceSet) opacity = isEmphasized(id) ? normal : normal * 0.1
        else if (searchHit) opacity = isEmphasized(id) ? normal : normal * 0.14
        else if (hoverNeighbors) opacity = hoverNeighbors.has(id) ? normal : normal * 0.5
        else if (focusSet) opacity = isEmphasized(id) ? normal : normal * 0.3
        else if (dim) opacity = dimOpacity
        else opacity = normal
        return { opacity, hovered: isHover, hop: isHop, focused: isFocus, slice: sliceOf(id) }
      }
      /** 边的强调：任一端（或线自己）被强调即算命中（搜索/聚焦/切片都同时点亮两端）。 */
      const isEmphasizedLink = (link) => isEmphasized(link.id) || isEmphasized(link.from) || isEmphasized(link.to)

      // ── v1.16 计划视图 / 落地建议（渲染数据）─────────────────────
      // 三组：空承诺（域：无覆盖块且无子域）／未落地（计划块：未 grounds）／未标注（实块：无 covers 入边）。
      // 优先用宿主算的 gaps.byLayer；宿主是旧版时按平铺落差 + 件的 author 兜底分到层。
      const planGroups = useMemo(() => {
        if (!board || !store.gaps) return null
        const byLayer = store.gaps.byLayer || null
        const out = {}
        for (const key of ['ungrounded', 'planOpen', 'unannotated']) {
          const flat = Array.isArray(store.gaps[key]) ? store.gaps[key] : []
          out[key] = {}
          for (const layer of LAYER_ORDER) {
            const hostList = byLayer && byLayer[layer] && Array.isArray(byLayer[layer][key]) ? byLayer[layer][key] : null
            out[key][layer] = hostList
              ? hostList.slice()
              : flat.filter((id) => {
                  const item = itemById.get(id)
                  return item ? layerOf(item) === layer : false
                })
          }
        }
        return out
      }, [board, store.gaps, itemById])

      // scan 落地建议条：最多 3 条；已落地（有 grounds 边）或本页点过「忽略」的不再显示。
      const suggestionRows = useMemo(() => {
        if (!board) return []
        const listed = Array.isArray(store.scanSuggestions) ? store.scanSuggestions : []
        const groundedPairs = new Set(board.links.filter((link) => link.type === 'grounds').map((link) => `${link.from}->${link.to}`))
        const groundedFrom = new Set(board.links.filter((link) => link.type === 'grounds').map((link) => link.from))
        const rows = []
        const seen = new Set()
        for (const suggestion of listed) {
          if (!suggestion || !suggestion.plannedId || !suggestion.realId) continue
          const key = `${suggestion.plannedId}->${suggestion.realId}`
          if (seen.has(key) || ignoredSuggestions[key] || groundedPairs.has(key) || groundedFrom.has(suggestion.plannedId)) continue
          seen.add(key)
          const planned = board.blocks.find((block) => block.id === suggestion.plannedId)
          const real = board.blocks.find((block) => block.id === suggestion.realId)
          if (!planned || !planned.planned || !real || real.planned) continue
          rows.push({ key, planned, real, score: suggestion.score, reason: suggestion.reason || '' })
          if (rows.length >= 3) break
        }
        return rows
      }, [board, store.scanSuggestions, ignoredSuggestions])

      const selectedItems = useMemo(() => {
        if (!board) return []
        const all = [
          ...board.domains.map((item) => ({ kind: 'domain', item })),
          ...board.blocks.map((item) => ({ kind: 'block', item })),
          ...board.notes.map((item) => ({ kind: 'note', item })),
          ...board.links.map((item) => ({ kind: 'link', item })),
        ]
        const map = new Map(all.map((entry) => [entry.item.id, entry]))
        return selection.map((id) => map.get(id)).filter(Boolean)
      }, [board, selection])

      // ── 桌边消息：本地指令与发送（v1.15）──────────────────────────
      const barSession = useMemo(() => deskSession(ctx), [ctx, sessionsTick, store.rev])

      const runBarLocal = useCallback(
        (text) => {
          const match = /^\/([a-zA-Z]+)\s*([\s\S]*)$/.exec(text)
          if (!match) return false
          const name = match[1].toLowerCase()
          const arg = match[2].trim()
          if (name === 'scan') {
            desk.runScan()
            return true
          }
          if (name === 'fit') {
            fitView()
            return true
          }
          if (name === 'export') {
            desk.exportFiles()
            return true
          }
          if (name === 'help' || name === 'commands') {
            setModal({ type: 'help' })
            return true
          }
          if (name === 'clear') {
            setSelection([])
            desk.say('已清空选中')
            return true
          }
          if (name === 'changes' || name === 'history') {
            setSliceBatch(null)
            setChangesOpen(true)
            desk.say(unseen.length ? `最近 ${unseen.length} 批没看过` : '没有未读改动；时间轴里能翻历史')
            return true
          }
          if (name === 'focus') {
            if (!arg) {
              desk.say('用法：/focus B12 或 /focus 画布与热力场', 'error')
              return true
            }
            const lower = arg.toLowerCase()
            const hit =
              board.domains.find((item) => String(item.id).toLowerCase() === lower) ||
              board.blocks.find((item) => String(item.id).toLowerCase() === lower) ||
              board.blocks.find((item) => String(item.address || '').toLowerCase() === lower) ||
              board.domains.find((item) => String(item.title || '').toLowerCase().includes(lower)) ||
              board.blocks.find((item) => String(item.address || '').toLowerCase().includes(lower))
            if (!hit) {
              desk.say(`没找到：${arg}`, 'error')
              return true
            }
            setSelection([hit.id])
            setFocusId(hit.id)
            centerOn(hit.id)
            desk.say(`聚焦 ${hit.id}`)
            return true
          }
          if (name === 'filter') {
            if (!arg || arg === 'off' || arg === 'none' || arg === '全部' || arg === 'all') {
              setTypeFilter(null)
              desk.say('连接筛选：全部')
              return true
            }
            const type = FILTER_ALIAS[arg] || LINK_ORDER.find((item) => item === arg || (LINK_META[item] && LINK_META[item].label === arg))
            if (!type) {
              desk.say(`不认识的连接类型：${arg}`, 'error')
              return true
            }
            setTypeFilter(type)
            desk.say(`只看「${LINK_META[type].label}」连接（其余淡出）`)
            return true
          }
          return false
        },
        [board, centerOn, desk, fitView, unseen],
      )

      const sendBar = useCallback(
        async () => {
          if (barState.phase === 'sending') return
          const text = barText.trim()
          if (!text) {
            desk.say('先写一句话；或点下面的 / 指令', 'error')
            return
          }
          if (text === '/') {
            setBarState({ phase: 'local', message: `本地指令：${LOCAL_BAR_COMMANDS.map((item) => item.cmd).join(' ')}` })
            return
          }
          if (text.startsWith('/') && runBarLocal(text)) {
            setBarText('')
            setBarState({ phase: 'local', message: `已执行 ${text.split(/\s+/)[0]}` })
            return
          }
          const packed = packDeskContext({ question: text, store, selectedItems, focusId, typeFilter })
          setBarState({ phase: 'sending', message: '发送中…' })
          desk.say('发给当前会话…')
          const result = await sendToDshSession(ctx, packed)
          if (result.ok) {
            setBarText('')
            setBarState({ phase: 'accepted', at: Date.now(), title: result.title, sessionId: result.sessionId, requestId: result.requestId, message: '已收到' })
            desk.say(result.title ? `已发到「${result.title}」` : '已发到当前会话')
          } else {
            setBarState({ phase: 'error', message: result.message, code: result.code })
            desk.say(`没发出去：${result.message}`, 'error')
          }
        },
        [barState.phase, barText, ctx, desk, focusId, runBarLocal, selectedItems, store, typeFilter],
      )

      // ── v1.14：已读 / 抽屉选件 / 复制证据 / 撤销最近一批 ────────────
      const markSeen = useCallback(() => {
        const rev = store.rev
        if (!rev || !projectPath) return
        setSeenRev(rev)
        try {
          localStorage.setItem(LS_SEEN + projectPath, rev)
        } catch {
          // 存不住不影响本次会话
        }
        desk.say(`已标记已读 · ${rev}`)
      }, [desk, projectPath, store.rev])

      const pickChange = useCallback(
        (row) => {
          if (!row || !board) return
          if (changeKindOfItem(row.id) === 'link') {
            const link = board.links.find((item) => item.id === row.id)
            if (!link) {
              desk.say('这条连接已经不在了（抽屉里还留着记录）', 'error')
              return
            }
            setSliceBatch(null)
            setSelection([row.id])
            setFocusId(null)
            centerOn(link.from)
            return
          }
          if (!itemKinds.has(row.id)) {
            desk.say(`${row.id} 这件已经不在了（抽屉里还留着记录）`, 'error')
            return
          }
          setSliceBatch(null)
          setSelection([row.id])
          setFocusId(null)
          centerOn(row.id)
        },
        [board, centerOn, desk, itemKinds],
      )

      const copyChange = useCallback(
        async (row) => {
          const meta = CHANGE_META[row.kind] || { label: row.kind }
          const text = `${row.id} ${row.label} · ${meta.label} · ${batchTime(row.at)} · 批次 ${row.batch}`
          try {
            await navigator.clipboard.writeText(text)
            desk.say('改动证据已复制，可以直接贴给智能体')
          } catch {
            desk.say('复制失败，手动选一下吧', 'error')
          }
        },
        [desk],
      )

      const undoLatestBatch = useCallback(async () => {
        const latest = batches[batches.length - 1]
        if (!latest) {
          desk.say('还没有可回滚的批', 'error')
          return null
        }
        setSliceBatch(null)
        const data = await desk.undoBatch(latest.batch)
        if (data && data.rev) {
          setSeenRev(data.rev)
          try {
            localStorage.setItem(LS_SEEN + projectPath, data.rev)
          } catch {
            // 存不住不影响
          }
        }
        return data
      }, [batches, desk, projectPath])

      // ── 欢迎页 ──────────────────────────────────────────────────
      if (store.status === 'boot' || store.status === 'loading') {
        return h(
          'div',
          { className: 'sd-root' },
          h('style', null, CSS),
          h('div', { className: 'sd-welcome' }, h('div', { className: 'sd-hint' }, store.status === 'boot' ? '正在连结构台…' : '正在载入板子…')),
        )
      }
      if (store.status === 'error') {
        return h(
          'div',
          { className: 'sd-root' },
          h('style', null, CSS),
          h(
            'div',
            { className: 'sd-welcome' },
            h('h1', null, h(Glyph, { size: 26 }), '结构台'),
            h('p', null, store.error || '连不上宿主半边'),
            h('button', { className: 'sd-btn primary', onClick: desk.boot }, '重试'),
          ),
        )
      }
      if (store.status === 'welcome' || !store.board) {
        return h(Welcome, { key: 'welcome', ctx, desk, store })
      }

      // ── 主界面 ──────────────────────────────────────────────────
      const canvasSize = canvasRef.current ? { width: canvasRef.current.clientWidth, height: canvasRef.current.clientHeight } : { width: 900, height: 600 }
      // 角标跟着世界缩放会小到看不清：按缩放反向放大一点（屏幕上保持 ≈12–14px）
      const badgeScale = Math.min(2.2, Math.max(1, 1 / (view.zoom || 1)))
      const nodeViews = []
      // 包络（装域）：只框界内可见的子域/件
      const hulls = []
      for (const domain of board.domains) {
        if (!visibleNodeIds.has(domain.id)) continue
        const kids = new Set()
        const collect = (id) => {
          for (const child of board.domains) if (child.parent === id) {
            kids.add(child.id)
            collect(child.id)
          }
        }
        collect(domain.id)
        if (!kids.size || collapsed.includes(domain.id) || hiddenByCollapse.has(domain.id)) continue
        const kidBoxes = boxes.filter((box) => kids.has(box.id) && visibleNodeIds.has(box.id))
        if (!kidBoxes.length) continue
        const minX = Math.min(...kidBoxes.map((b) => b.x)) - 22
        const minY = Math.min(...kidBoxes.map((b) => b.y)) - 30
        const maxX = Math.max(...kidBoxes.map((b) => b.x + b.w)) + 22
        const maxY = Math.max(...kidBoxes.map((b) => b.y + b.h)) + 20
        hulls.push({ domain, x: minX, y: minY, w: maxX - minX, h: maxY - minY })
      }

      // v1.16：每层一个低透明软包络（画在节点下层）。隐藏层整层不画；域内视图里只框界内节点。
      const layerHulls = []
      for (const layer of LAYER_ORDER) {
        if (filters[layer] === false) continue
        const items = boxes.filter((box) => visibleNodeIds.has(box.id) && layerById.get(box.id) === layer)
        if (!items.length) continue
        const minX = Math.min(...items.map((box) => box.x)) - 26
        const minY = Math.min(...items.map((box) => box.y)) - 34
        const maxX = Math.max(...items.map((box) => box.x + box.w)) + 26
        const maxY = Math.max(...items.map((box) => box.y + box.h)) + 26
        layerHulls.push({ layer, x: minX, y: minY, w: maxX - minX, h: maxY - minY })
      }

      const nodeById = new Map([...board.domains, ...board.blocks].map((node) => [node.id, node]))
      const linkViews = board.links
        .map((link) => {
          const a = boxMap.get(link.from)
          const b = boxMap.get(link.to)
          if (!a || !b) return null
          // 契约（v1.16 修正）：硬过滤只有层显隐 ∧ 域内视图范围（已并入 visibleNodeIds）；
          // 类型筛选属强调层，只调透明度、不剔除（线仍可命中/可数）。
          if (!isVisibleNode(link.from) || !isVisibleNode(link.to)) return null
          const x1 = a.x + a.w / 2
          const y1 = a.y + a.h / 2
          const x2 = b.x + b.w / 2
          const y2 = b.y + b.h / 2
          // 直线：两端盒子中心直接连；标签落在中点
          const mx = (x1 + x2) / 2
          const my = (y1 + y2) / 2
          return {
            link,
            d: `M${x1},${y1} L${x2},${y2}`,
            mx,
            my,
          }
        })
        .filter(Boolean)
      // v1.16 域内视图：跨边界的连接收成短虚线桩（不画外部节点），标签带类型
      const stubViews = domainViewStubs
        .map((stub) => {
          const inside = boxMap.get(stub.insideId)
          if (!inside) return null
          const outside = boxMap.get(stub.outsideId) || null
          // 外部节点不画，但留它原来的盒子算方向，桩才会朝对的一侧伸
          return { ...stub, geo: stubGeometry(inside, outside), outsideBox: outside }
        })
        .filter(Boolean)
      // v1.13：标签从线层拆出来单独渲染（在节点之后画，才不会被卡片盖住）
      const linkLabels = []

      const onNodePointerDown = (event, id) => {
        event.stopPropagation()
        if (event.button !== 0) return
        setFocusId(null) // 直接在画布上点件＝不再是「定位来的」聚焦
        const world = toWorld(event.clientX, event.clientY)
        if (tool === 'link') {
          const fromKind = selection.length === 1 ? itemKinds.get(selection[0]) : null
          const toKind = itemKinds.get(id)
          // 便签不是连接端点：说清楚用「挂住」表达关系，并退出连线工具
          if (toKind === 'note' || fromKind === 'note') {
            setSelection([id])
            setTool('select')
            desk.say('便签不参与连线：用右栏「挂住」把它挂到某个域/块上', 'error')
            return
          }
          if (selection.length === 1 && selection[0] !== id) {
            setMenu({ x: event.clientX, y: event.clientY, from: selection[0], to: id })
            setTool('select')
            return
          }
          setSelection([id])
          return
        }
        const base = event.shiftKey ? (selected.has(id) ? selection.filter((x) => x !== id) : [...selection, id]) : selected.has(id) ? selection : [id]
        setSelection(base)
        if (event.shiftKey) return
        const origins = grabOrigins(base)
        if (!Object.keys(origins).length) return
        // 按下即按住：拖动期间物理不再把件从指针下带走（长按不漂、首次移动不跳）
        for (const grabbedId of Object.keys(origins)) {
          const node = simRef.current.nodes.get(grabbedId)
          if (node) {
            node.held = true
            node.vx = 0
            node.vy = 0
          }
        }
        interaction.current = { kind: 'drag', startWorld: world, origins, moved: false }
        event.preventDefault()
      }

      return h(
        'div',
        { className: 'sd-root' },
        h('style', null, CSS),

        // 顶栏
        h(
          'div',
          { className: 'sd-top' },
          h('span', { className: 'sd-brand' }, h(Glyph, { size: 18 }), LABEL),
          h(
            'div',
            { className: 'sd-proj' },
            h(
              'button',
              { className: 'sd-chip', title: store.project.path, onClick: () => setModal({ type: 'project' }) },
              h(Icon, { name: 'folder', size: 12 }),
              h('b', null, store.project.name || '项目'),
              h('span', { style: { direction: 'ltr' } }, parentName(store.project.path) ? `· ${parentName(store.project.path)}` : ''),
            ),
          ),
          h('div', { className: 'sd-spacer' }),
          h(
            'div',
            { className: 'sd-search' },
            h(Icon, { name: 'search', size: 13 }),
            h('input', {
              ref: searchRef,
              value: search,
              placeholder: '搜件或连接类型  /',
              onChange: (event) => setSearch(event.target.value),
            }),
            search && h('button', { className: 'sd-btn', style: { height: 20, padding: '0 4px' }, onClick: () => setSearch('') }, h(Icon, { name: 'close', size: 12 })),
          ),
          h(
            'div',
            { className: 'sd-tools' },
            h('button', { className: 'sd-btn', title: '扫描项目（把文件收成块）', onClick: () => desk.runScan() }, h(Icon, { name: 'scan' }), h('span', { className: 'lbl' }, '扫描')),
            h('button', { className: 'sd-btn', title: '建域（D）：选了块就直接盖住', onClick: () => newDomain({ coverFromSelection: true }) }, h(Icon, { name: 'domain' }), h('span', { className: 'lbl' }, '建域')),
            h('button', { className: 'sd-btn', title: '画一个计划块（B）', onClick: () => newBlock() }, h(Icon, { name: 'block' }), h('span', { className: 'lbl' }, '计划块')),
            h('button', { className: 'sd-btn', title: '便签（N）', onClick: () => newNote() }, h(Icon, { name: 'note' }), h('span', { className: 'lbl' }, '便签')),
            h('button', {
              className: 'sd-btn',
              'data-on': tool === 'link',
              title: selectedKind === 'note'
                ? '便签不参与连线：用右栏「挂住」把它挂到某个域/块上'
                : '连线（L）：选一个件后点另一个',
              disabled: selection.length !== 1 || selectedKind === 'note',
              onClick: () => setTool(tool === 'link' ? 'select' : 'link'),
            }, h(Icon, { name: 'link' }), h('span', { className: 'lbl' }, '连线')),
            h('span', { className: 'sd-sep' }),
            h(
              'button',
              {
                className: 'sd-btn',
                'data-on': physicsOn,
                title: physicsOn
                  ? '物理：运行中（图一直有物理在轻微动；拖一个件邻件自己让开；点一下暂停）'
                  : '物理：暂停（点一下继续）',
                onClick: () => {
                  if (physicsOn) {
                    // 暂停前先把当前坐标拍张快照落盘
                    physicsOnRef.current = false
                    if (runningRef.current) persistSim({ stop: true })
                    setPhysicsOn(false)
                    return
                  }
                  physicsOnRef.current = true
                  setPhysicsOn(true)
                  lastWakeKey.current = physicsSig
                  wakeSim({ heat: PHYS.heat.toggle, impulse: 9, reason: 'toggle' })
                },
              },
              h(Icon, { name: 'atom' }),
              h('span', { className: 'lbl' }, '物理'),
            ),
            h(
              'button',
              { className: 'sd-btn', title: '抖一抖：把挤在一起的件晃开（重新加热）', disabled: !physicsOn, onClick: () => wakeSim({ heat: PHYS.heat.shake, impulse: true, reason: 'shake' }) },
              h(Icon, { name: 'spark' }),
            ),
            h('button', { className: 'sd-btn', title: '重排（力导向开局，再交给物理收）', onClick: arrange }, h(Icon, { name: 'arrange' })),
            h('button', { className: 'sd-btn', title: '适应视口（F）', onClick: fitView }, h(Icon, { name: 'fit' })),
            h('button', { className: 'sd-btn', title: '撤销（Ctrl+Z）', disabled: !history.past.length, onClick: undo }, h(Icon, { name: 'undo' })),
            h('button', { className: 'sd-btn', title: '重做（Ctrl+Shift+Z）', disabled: !history.future.length, onClick: redo }, h(Icon, { name: 'redo' })),
            h('button', {
              className: 'sd-btn',
              'data-on': changesOpen || Boolean(sliceEntry),
              title: '变更抽屉：自上次已读改了什么（点行定位、可复制证据）',
              onClick: () => setChangesOpen((open) => !open),
            }, h(Icon, { name: 'history' }), h('span', { className: 'lbl' }, `变更${unseen.length ? ` ${unseen.length}` : ''}`)),
            h('span', { className: 'sd-sep' }),
            h('button', { className: 'sd-btn', title: '给智能体的一页简报', onClick: async () => setModal({ type: 'brief', loading: true }) }, h(Icon, { name: 'doc' }), h('span', { className: 'lbl' }, '简报')),
            h('button', { className: 'sd-btn', title: '导出 简报.md / 域录.md（Ctrl+S）', onClick: () => desk.exportFiles() }, h(Icon, { name: 'export' }), h('span', { className: 'lbl sd-export-lbl' }, '导出')),
            h('button', { className: 'sd-btn', title: '快捷键与词汇表（?）', onClick: () => setModal({ type: 'help' }) }, h(Icon, { name: 'help' })),
          ),
        ),

        // 身体
        h(
          'div',
          { className: 'sd-body' },
          h(LeftRail, {
            board,
            stats: store.stats,
            gaps: store.gaps,
            gapItems,
            planGroups,
            layers: filters,
            onToggleLayer: toggleLayer,
            onEnterDomainView: enterDomainView,
            domainTree,
            journalTail: store.journalTail,
            selection,
            selected,
            filters,
            setFilters,
            onSelect: (id) => setSelection([id]),
            onLocate: (id) => {
              setSelection([id])
              // 落差/计划视图里点到的可能是连线（矛盾）：线没有盒子，定位到它起点
              const link = String(id).startsWith('L') ? board.links.find((l) => l.id === id) : null
              // 范围外的东西：先退出域内视图，否则点了什么也看不见
              if (domainViewSet && !domainViewSet.has(id)) setDomainViewId(null)
              setFocusId(id) // v1.12：定位＝打开 1 跳聚焦，邻域亮、其余淡出
              centerOn(link ? link.from : id)
            },
            onHover: (id) => setHover(id),
            onHoverEnd: (id) => setHover((cur) => (cur === id ? null : cur)),
            onUpdate: updateItem,
            onRemove: removeNode,
            onNewChild: (parentId) => newDomain({ parent: parentId, coverFromSelection: false }),
            collapsed,
            onSelectDomains: (ids) => setSelection(ids),
            onBatchStatus: batchSetStatus,
            onBatchParent: batchSetParent,
            onBatchTags: batchSetTags,
            onBatchRemove: batchRemoveDomains,
            onClearSelection: () => setSelection([]),
          }),

          // 画布
          h(
            'div',
            {
              className: 'sd-canvas',
              ref: canvasRef,
              'data-tool': tool,
              'data-drop': dropTarget === undefined ? undefined : dropTarget === null ? 'root' : dropTarget,
              onPointerDown: onCanvasPointerDown,
              onDoubleClick: (event) => {
                if (event.target === event.currentTarget) newNote({ at: toWorld(event.clientX, event.clientY) })
              },
            },
            h(
              'div',
              { className: 'sd-world', ref: worldRef, style: { transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` } },
              h(
                'svg',
                { className: 'sd-links' },
                h(
                  'defs',
                  null,
                  Object.entries(LINK_META).map(([type, meta]) =>
                    h(
                      'marker',
                      {
                        key: type,
                        id: `sd-arrow-${type}`,
                        viewBox: '0 0 10 10',
                        refX: 9,
                        refY: 5,
                        markerWidth: 6,
                        markerHeight: 6,
                        orient: 'auto-start-reverse',
                      },
                      h('path', { d: 'M0,0 L10,5 L0,10 z', fill: meta.color }),
                    ),
                  ),
                ),
                linkViews.map(({ link, d, mx, my }) => {
                  const meta = LINK_META[link.type] || LINK_META.relates
                  const hovered = hover === link.id
                  const selDirect = selected.has(link.id)
                  // v1.12 A2：选中任一端就亮这条线（以前要两端都选中才亮）。
                  const selTouched = selDirect || selected.has(link.from) || selected.has(link.to)
                  // v1.12 A1：悬停一个件时，连着它的线亮、类型标签显形，其余线淡出。
                  const hoverIncident = Boolean(hoverNode) && (link.from === hoverNode || link.to === hoverNode)
                  // v1.16（契约修正，回归优先）：类型筛选恢复 v1.12 口径——不匹配的线淡出到 0.07、仍可见可命中；
                  // 其余强调（搜索 ∪ 1 跳聚焦 ∪ 切片）同样只调透明度。硬过滤只有层显隐与域内视图范围。
                  const typeOff = Boolean(typeFilter) && link.type !== typeFilter
                  const sliceOn = Boolean(sliceSet) && sliceSet.has(link.id)
                  const sliceTouched = Boolean(sliceSet) && (sliceSet.has(link.id) || sliceSet.has(link.from) || sliceSet.has(link.to))
                  const emphasized = isEmphasizedLink(link)
                  let opacity = 1
                  if (sliceSet) opacity = sliceTouched ? 1 : 0.07
                  else if (typeOff) opacity = 0.07
                  else if (searchHit) opacity = emphasized ? 1 : 0.1
                  else if (hoverNode) opacity = hoverIncident ? 1 : 0.12
                  else if (hoverLinkId) opacity = hoverLinkId === link.id ? 1 : 0.4
                  else if (focusSet) opacity = emphasized ? 1 : 0.12
                  const strong = hovered || hoverIncident || selDirect || sliceOn || emphasized
                  const strokeWidth = strong ? 2.6 : selTouched ? 2.2 : 1.5
                  // 标签：悬停/选中这条线必显；悬停一个件时，若它的线不多（≤8）也把类型摆出来，多了会糊。
                  const labelOn = opacity > 0.3 && !typeOff && (hovered || selDirect || (hoverIncident && hoverIncidentCount <= 8))
                  if (labelOn) linkLabels.push({ link, mx, my })
                  return h(
                    'g',
                    { key: link.id, 'data-link-id': link.id, 'data-type': link.type, opacity },
                    h('path', {
                      className: 'hit',
                      'data-link-id': link.id,
                      'data-type': link.type,
                      ref: (el) => {
                        if (!el) return
                        const entry = linkEls.current.get(link.id) || { from: link.from, to: link.to }
                        entry.hit = el
                        linkEls.current.set(link.id, entry)
                      },
                      d,
                      fill: 'none',
                      stroke: 'transparent',
                      strokeWidth: 14,
                      onPointerEnter: () => setHover(link.id),
                      onPointerLeave: () => setHover((cur) => (cur === link.id ? null : cur)),
                      onClick: (event) => {
                        event.stopPropagation()
                        setSelection([link.id])
                      },
                    }),
                    h('path', {
                      className: 'line',
                      'data-link-id': link.id,
                      'data-type': link.type,
                      'data-slice': sliceOn ? 'true' : undefined,
                      ref: (el) => {
                        if (!el) return
                        const entry = linkEls.current.get(link.id) || { from: link.from, to: link.to }
                        entry.line = el
                        linkEls.current.set(link.id, entry)
                      },
                      d,
                      fill: 'none',
                      stroke: meta.color,
                      strokeWidth,
                      strokeDasharray: meta.dash || undefined,
                      markerEnd: `url(#sd-arrow-${link.type})`,
                      markerStart: link.type === 'contradicts' ? `url(#sd-arrow-${link.type})` : undefined,
                      opacity: strong || selTouched ? 1 : 0.72,
                    }),
                  )
                }),
                // v1.16 域内视图：跨边界的连接收成输入/输出桩（短虚线 + 类型标签，不画外部节点）
                stubViews.map(({ link, dir, geo, insideId, outsideId, outsideBox }) => {
                  const meta = LINK_META[link.type] || LINK_META.relates
                  return h(
                    'g',
                    {
                      key: `stub-${link.id}`,
                      className: 'sd-stub',
                      'data-stub-id': link.id,
                      'data-dir': dir,
                      'data-type': link.type,
                      // 桩也是边：类型筛选只让它淡出（不隐藏），保持与画布上的边一致
                      opacity: typeFilter && link.type !== typeFilter ? 0.07 : 1,
                      ref: (el) => {
                        if (!el) {
                          stubEls.current.delete(link.id)
                          return
                        }
                        const entry = stubEls.current.get(link.id) || {}
                        entry.insideId = insideId
                        entry.outsideId = outsideId
                        entry.outsideBox = outsideBox || null
                        entry.path = el.querySelector('.sd-stub-line')
                        entry.label = el.querySelector('.sd-stub-label')
                        stubEls.current.set(link.id, entry)
                      },
                    },
                    h('path', {
                      className: 'sd-stub-line',
                      d: geo.d,
                      fill: 'none',
                      stroke: meta.color,
                      strokeWidth: 1.4,
                      strokeDasharray: '3 3',
                      markerEnd: `url(#sd-arrow-${link.type})`,
                    }),
                    h('circle', { className: 'sd-stub-dot', cx: geo.ex, cy: geo.ey, r: 2.4, fill: meta.color }),
                    h('text', { className: 'sd-stub-label', transform: geo.transform, x: 0, y: -7, textAnchor: 'middle' }, `${dir === 'in' ? '←' : '→'} ${meta.label}`),
                  )
                }),
              ),

              // v1.16：层包络（低透明软包络，画在节点下层；隐藏层整层不画）
              layerHulls.map(({ layer, x, y, w, h: hh }) =>
                h(
                  'div',
                  {
                    key: `layer-${layer}`,
                    className: 'sd-layer-hull',
                    'data-layer': layer,
                    ref: (el) => {
                      if (el) {
                        el.style.display = ''
                        layerHullEls.current.set(layer, el)
                      } else layerHullEls.current.delete(layer)
                    },
                    style: { left: x, top: y, width: w, height: hh },
                  },
                  h('span', { className: 'sd-layer-hull-label' }, LAYER_META[layer] ? LAYER_META[layer].label : layer),
                ),
              ),

              hulls.map(({ domain, x, y, w, h: hh }) =>
                h(
                  'div',
                  {
                    key: `hull-${domain.id}`,
                    className: 'sd-hull',
                    ref: (el) => {
                      if (el) hullEls.current.set(domain.id, el)
                      else hullEls.current.delete(domain.id)
                    },
                    style: { left: x, top: y, width: w, height: hh },
                  },
                  h('span', { className: 'sd-hull-label' }, domain.title),
                ),
              ),

              // 域
              board.domains.map((domain) => {
                if (!visibleNodeIds.has(domain.id)) return null
                const box = boxMap.get(domain.id)
                if (!box) return null
                const size = domainSize(domain)
                const emp = emphasisOf(domain.id, false)
                const covered = coveredByCount[domain.id] || 0
                const kids = board.domains.filter((d) => d.parent === domain.id).length
                const folded = collapsed.includes(domain.id)
                const marks = badgeMarksOf(badgeMap.get(domain.id), conflictNodes.has(domain.id))
                return h(
                  'div',
                  {
                    key: domain.id,
                    className: 'sd-node sd-domain',
                    'data-node-id': domain.id,
                    'data-sel': selected.has(domain.id),
                    'data-status': domain.status,
                    'data-layer': layerOf(domain),
                    'data-slice': emp.slice || undefined,
                    'data-drop': dropTarget === domain.id ? 'true' : undefined,
                    'data-hover': emp.hovered ? 'true' : undefined,
                    'data-hop': emp.hop ? 'true' : undefined,
                    'data-focus': emp.focused ? 'true' : undefined,
                    ref: (el) => registerNodeEl(el, domain.id),
                    style: { width: size.w, height: size.h, opacity: emp.opacity },
                    onPointerDown: (event) => onNodePointerDown(event, domain.id),
                    onPointerEnter: () => setHover(domain.id),
                    onPointerLeave: () => setHover((cur) => (cur === domain.id ? null : cur)),
                    title: domain.statement || '还没写说法',
                  },
                  kids
                    ? h(
                        'span',
                        {
                          className: 'sd-twisty-node',
                          title: folded ? '展开子域' : '收起子域',
                          onPointerDown: (event) => event.stopPropagation(),
                          onClick: (event) => {
                            event.stopPropagation()
                            toggleCollapse(domain.id)
                          },
                        },
                        folded ? '▸' : '▾',
                      )
                    : null,
                  h('span', { className: cx('sd-author', domain.author), title: AUTHOR_META[domain.author].label }, AUTHOR_META[domain.author].mark),
                  h('b', null, domain.title),
                  covered || kids ? h('span', { className: 'n' }, `${covered}${kids ? `/${kids}` : ''}`) : null,
                  marks.length ? h('span', { className: 'sd-badges', style: { transform: `scale(${badgeScale})`, transformOrigin: 'top right' } }, marks.map((mark) => h('i', { key: mark.key, className: `sd-badge ${mark.key}`, title: mark.label }, mark.text))) : null,
                )
              }),

              // 块
              board.blocks.map((block) => {
                if (!visibleNodeIds.has(block.id)) return null
                const box = boxMap.get(block.id)
                if (!box) return null
                const emp = emphasisOf(block.id, false, 0.14, block.stale ? 0.62 : 1)
                const covers = coveredMap[block.id] || []
                const name = block.path.split('/').pop() || block.path
                const marks = badgeMarksOf(badgeMap.get(block.id), conflictNodes.has(block.id))
                return h(
                  'div',
                  {
                    key: block.id,
                    className: 'sd-node sd-block',
                    'data-node-id': block.id,
                    'data-sel': selected.has(block.id),
                    'data-planned': block.planned,
                    'data-layer': layerOf(block),
                    'data-stale': block.stale,
                    'data-slice': emp.slice || undefined,
                    'data-unannotated': !block.planned && !covers.length,
                    'data-hover': emp.hovered ? 'true' : undefined,
                    'data-hop': emp.hop ? 'true' : undefined,
                    'data-focus': emp.focused ? 'true' : undefined,
                    ref: (el) => registerNodeEl(el, block.id),
                    style: { opacity: emp.opacity },
                    onPointerDown: (event) => onNodePointerDown(event, block.id),
                    onPointerEnter: () => setHover(block.id),
                    onPointerLeave: () => setHover((cur) => (cur === block.id ? null : cur)),
                    title: block.address,
                  },
                  h('b', null, name),
                  h('div', { className: 'p' }, block.path),
                  h(
                    'div',
                    { className: 'meta' },
                    block.lang && h('span', { className: 'sd-tag' }, block.lang),
                    block.planned && h('span', { className: 'sd-tag plan' }, '计划'),
                    block.stale && h('span', { className: 'sd-tag stale' }, '失联'),
                    covers.length ? h('span', { className: 'sd-tag cov' }, `域 ${covers.length}`) : null,
                    h('span', { className: 'sd-author ' + block.author, style: { marginLeft: 'auto' } }, AUTHOR_META[block.author].mark),
                  ),
                  marks.length ? h('span', { className: 'sd-badges', style: { transform: `scale(${badgeScale})`, transformOrigin: 'top right' } }, marks.map((mark) => h('i', { key: mark.key, className: `sd-badge ${mark.key}`, title: mark.label }, mark.text))) : null,
                )
              }),

              // 便签
              board.notes.map((note) => {
                if (!visibleNodeIds.has(note.id)) return null
                const box = boxMap.get(note.id)
                if (!box) return null
                const emp = emphasisOf(note.id, false, 0.18)
                return h(NoteCard, {
                  key: note.id,
                  note,
                  box,
                  layer: layerOf(note),
                  registerRef: registerNodeEl,
                  selected: selected.has(note.id),
                  dim: false,
                  opacity: emp.opacity,
                  hovered: emp.hovered,
                  hop: emp.hop,
                  focused: emp.focused,
                  slice: emp.slice,
                  badges: badgeMarksOf(badgeMap.get(note.id), conflictNodes.has(note.id)),
                  refTarget: note.ref ? [...board.domains, ...board.blocks].find((item) => item.id === note.ref) : null,
                  onPointerDown: (event) => onNodePointerDown(event, note.id),
                  onCommit: (text) => updateItem(note.id, { text }),
                  onColor: (color) => updateItem(note.id, { color }),
                  onFocusRef: () => {
                    if (!note.ref) return
                    setFocusId(note.ref)
                    centerOn(note.ref)
                  },
                })
              }),

              // v1.13：类型标签单独一层、画在节点之后（以前和线同层，标签会被卡片盖住；
              // 位置也只随 React 重渲染更新，物理一动就漂离线）。现在位置由 paintSim 每帧贴回线上。
              linkLabels.length
                ? h(
                    'svg',
                    { className: 'sd-links-labels' },
                    linkLabels.map(({ link, mx, my }) => {
                      const meta = LINK_META[link.type] || LINK_META.relates
                      return h(
                        'g',
                        {
                          key: link.id,
                          className: 'sd-link-label-g',
                          'data-link-id': link.id,
                          'data-type': link.type,
                          ref: (el) => {
                            if (el) labelEls.current.set(link.id, el)
                            else labelEls.current.delete(link.id)
                          },
                          transform: `translate(${mx} ${my})`,
                        },
                        h('rect', { className: 'sd-link-lbg', x: -26, y: -9, width: 52, height: 17, rx: 4 }),
                        h('text', { className: 'sd-link-label', x: 0, y: 3, textAnchor: 'middle' }, meta.label),
                      )
                    }),
                  )
                : null,
            ),

            // v1.16：scan 落地建议条（最多 3 条；落地写 grounds，忽略只在本页记）
            suggestionRows.length
              ? h(
                  'div',
                  { className: 'sd-suggest', style: { top: domainViewDomain ? 48 : 10 }, onPointerDown: (event) => event.stopPropagation() },
                  h('div', { className: 'sd-suggest-head' }, `扫描发现 ${suggestionRows.length} 条可能的落地`),
                  suggestionRows.map((row) =>
                    h(
                      'div',
                      { key: row.key, className: 'sd-suggest-row', 'data-planned': row.planned.id, 'data-real': row.real.id },
                      h('b', null, row.real.id),
                      h('span', null, '← 可能落地'),
                      h('b', null, row.planned.id),
                      row.reason ? h('span', { className: 'why' }, row.reason) : null,
                      h('button', { className: 'sd-suggest-act', 'data-action': 'settle', title: '写入 grounds 连接（计划块 → 实块）', onClick: () => settleSuggestion(row) }, '落地'),
                      h('button', { className: 'sd-suggest-act dim', 'data-action': 'ignore', title: '本页先忽略（不落盘，下次 scan 还会算）', onClick: () => ignoreSuggestion(row) }, '忽略'),
                    ),
                  ),
                  h(
                    'button',
                    {
                      className: 'sd-suggest-act dim',
                      style: { alignSelf: 'center' },
                      title: '收起这些建议（下次 scan 再出现）',
                      onClick: () => desk.patch({ scanSuggestions: [] }),
                    },
                    '收起',
                  ),
                )
              : null,

            // v1.16：域内视图面包屑（Esc 退出）
            domainViewDomain
              ? h(
                  'div',
                  { className: 'sd-domainview-bar', 'data-domain-view': domainViewDomain.id, onPointerDown: (event) => event.stopPropagation() },
                  h('b', null, `域：${domainViewDomain.title}`),
                  h('span', { className: 'hint' }, ' · 只画这一域覆盖的块 + 直接子域 + plans 计划块；跨边界的连接收成桩'),
                  h('button', { 'data-action': 'exit-domain-view', onClick: exitDomainView }, '退出（Esc）'),
                )
              : null,

            marquee && h('div', { className: 'sd-marquee', style: { left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h } }),

            // 画布空态
            !board.domains.length && !board.blocks.length &&
              h(
                'div',
                { className: 'sd-empty-canvas' },
                h(
                  'div',
                  null,
                  h('b', null, '这张桌子还是空的'),
                  h('span', null, '先点「扫描」把项目里的文件收成块，再点「建域」把块分成几块说法；也可以按 N 先记一条。'),
                  h(
                    'div',
                    { style: { display: 'flex', gap: 8, justifyContent: 'center', marginTop: 4 } },
                    h('button', { className: 'sd-btn primary', onClick: () => desk.runScan() }, '扫描项目'),
                    h('button', { className: 'sd-btn', onClick: () => newNote() }, '先记一条'),
                  ),
                ),
              ),

            h('div', { className: 'sd-zoom' },
              h('button', { title: '缩小', onClick: () => zoomAt(0.87) }, '−'),
              h('span', null, `${Math.round(view.zoom * 100)}%`),
              h('button', { title: '放大', onClick: () => zoomAt(1.15) }, '+'),
              h('button', { title: '适应视口（F）', onClick: fitView, style: { width: 26 } }, h(Icon, { name: 'fit', size: 13 })),
            ),
            h(
              'div',
              { className: 'sd-canvas-hint' },
              tool === 'link'
                ? '连线中：点终点后选类型'
                : tool === 'domain'
                  ? '点画布放一个新域'
                  : domainViewDomain
                    ? `域内视图：${domainViewDomain.title} · 只画这一域 · Esc 退出`
                    : focusId
                      ? '1 跳聚焦：邻域亮、其余淡出；点空白或按 Esc 退出'
                      : typeFilter
                        ? `只看「${LINK_META[typeFilter].label}」连接（其余淡出）：再点底栏图例或按 Esc 取消`
                        : physicsOn
                          ? '拖节点会推开邻件（物理开着）· 拖空白框选 · 滚轮缩放 · Alt/中键拖移'
                          : '拖空白框选 · 滚轮缩放 · Alt/中键拖移 · 双击空白记一条',
            ),

            // v1.14 变更抽屉：开在画布右缘，不挡顶栏、时间轴和检视器
            changesOpen && h(ChangesDrawer, {
              groups: changeGroups,
              batches: drawerBatches,
              total: changeRows.length,
              unseenCount,
              sliceEntry,
              detailNotes,
              detailPending,
              onClose: () => setChangesOpen(false),
              onPick: pickChange,
              onCopy: copyChange,
            }),
          ),

          h(Inspector, {
            board,
            selectedItems,
            selection,
            store,
            domainViewId,
            onUpdate: updateItem,
            onRemove: removeSelection,
            onSelect: (id) => setSelection([id]),
            onCenter: centerOn,
            onNewDomain: () => newDomain({ coverFromSelection: true }),
            onNewNote: () => newNote(),
            onLink: () => selection.length === 1 && setTool('link'),
            onMakeLink: makeLink,
            onFocusBlock: (id) => {
              setSelection([id])
              centerOn(id)
            },
            // v1.16：判据、拆计划块、跨层提案、域内视图进出
            onOpenSplit: (domainId) => setModal({ type: 'split', domainId }),
            onPropose: (target) => setModal({ type: 'propose', ...target }),
            onEnterDomainView: enterDomainView,
            onExitDomainView: exitDomainView,
          }),
        ),

        // v1.14 看见改动：底部珠子时间轴（点珠 = 该批切片；右端是撤销最近一批）
        h(BeadTimeline, {
          batches,
          sliceBatch,
          unseenBatches: unseen.length,
          unseenCount,
          canUndo: batches.length > 0,
          onSlice: (batch) => {
            const next = batch && batch !== sliceBatch ? batch : null
            sliceTrimNoted.current = ''
            setSliceBatch(next)
            // v1.17：详情还没缓存就立刻去拉（点珠切片要用 diff/labels）
            if (next) ensureBatchDetails(next)
          },
          onOpenDrawer: () => setChangesOpen((open) => !open),
          onMarkSeen: markSeen,
          onUndo: undoLatestBatch,
        }),

        // v1.15 桌边消息：选中件 chips + 一句话 + 发送
        h(DeskBar, {
          barOpen,
          setBarOpen,
          session: barSession,
          selectedItems,
          selection,
          onSelect: setSelection,
          text: barText,
          setText: setBarText,
          state: barState,
          onSend: sendBar,
        }),

        // 底栏
        h(
          'div',
          { className: 'sd-bottom' },
          h(
            'div',
            { className: 'sd-legend' },
            LINK_ORDER.map((type) => LINK_META[type] && { type, meta: LINK_META[type] }).filter(Boolean).map(({ type, meta }) =>
              h(
                'button',
                {
                  key: type,
                  className: 'sd-legend-btn',
                  'data-on': typeFilter === type,
                  title: `只看「${meta.label}」连接（其余淡出；再点一次或 Esc 取消）`,
                  onClick: () => setTypeFilter((cur) => (cur === type ? null : type)),
                },
                h('i', { style: { background: meta.color } }),
                meta.label,
              ),
            ),
          ),
          h(
            'span',
            {
              className: 'sd-phys',
              'data-on': physicsOn,
              title: physicsOn
                ? '物理运行中：图一直有物理在轻微动（热力场），拖动会推开邻件；点顶栏「物理」暂停'
                : '物理暂停：拖动只挪自己',
            },
            h('i'),
            physicsOn ? (simPhase === 'running' ? '物理 · 运行中' : '物理 · 启动中') : '物理 · 暂停',
          ),
          h('span', { className: 'sd-build', title: '页面里正在运行的客户端版本；不是这个版本就是旧页面，按 Ctrl+Shift+R 硬刷新' }, BUILD),
          h('div', { className: 'sd-sync', 'data-busy': store.syncing },
            h('i'),
            store.syncing ? '写入中…' : `已同步 · ${store.rev || ''}`,
          ),
        ),

        // 弹层
        modal && h(Modal, { modal, setModal, desk, board, store, selection, setSelection, makeLink, onSplitPlanned: splitPlannedBlocks, onPropose: createProposal, onEnterDomainView: enterDomainView }),
        menu && h(LinkMenu, { menu, setMenu, makeLink, kinds: itemKinds }),
        desk.toast && h('div', { className: 'sd-toast', 'data-kind': desk.toast.kind }, desk.toast.text),
      )
    }

    // ── 时间轴：底部珠子（v1.14）────────────────────────────────
    // 照 17-结构账本/UI示意·节点滑动.html：拖拽跟手、松手惯性、越界橡胶带、滚轮、点珠归中。
    // 每批一颗珠：+ 新增 / ~ 变化 / − 删除；点珠＝该批切片（变化的件亮、其余淡出）。
    function BeadTimeline({ batches, sliceBatch, unseenBatches, unseenCount, canUndo, onSlice, onOpenDrawer, onMarkSeen, onUndo }) {
      const list = Array.isArray(batches) ? batches : []
      const listSig = useMemo(() => list.map((batch) => batch.batch).join('|'), [list])
      const latest = list[list.length - 1] || null
      const axisRef = useRef(null)
      const beadEls = useRef([])
      const stateRef = useRef({ offset: 0, vel: 0, target: null, dragging: false, selected: -1, moved: false, downIndex: -1 })
      const rafRef = useRef(0)
      const [armed, setArmed] = useState(false)
      const armTimer = useRef(null)

      const half = useCallback(() => ((list.length - 1) * BEAD_GAP) / 2 + BEAD_PAD, [list.length])
      const limit = useCallback((value) => Math.max(-half(), Math.min(half(), value)), [half])
      const baseOf = useCallback((index) => (index - (list.length - 1) / 2) * BEAD_GAP, [list.length])
      // 指针监听只挂一次，处理时从 ref 里拿最新的珠子表/回调（不然每次重渲染都重挂）
      const liveRef = useRef({})
      const render = useCallback(() => {
        const state = stateRef.current
        for (let index = 0; index < beadEls.current.length; index += 1) {
          const el = beadEls.current[index]
          if (!el) continue
          el.style.transform = `translateX(${state.offset + baseOf(index)}px)`
        }
      }, [baseOf])
      liveRef.current = { list, onSlice, render, half }

      // 珠子数量变了或切片切换：切到该珠（没有切片时停在最新一颗）
      useEffect(() => {
        beadEls.current.length = list.length
        const state = stateRef.current
        const index = sliceBatch ? list.findIndex((batch) => batch.batch === sliceBatch) : -1
        state.selected = index
        state.vel = 0
        state.target = null
        if (index >= 0) state.offset = limit(-baseOf(index))
        else if (list.length) state.offset = limit(-baseOf(list.length - 1))
        render()
      }, [listSig, list.length, sliceBatch, baseOf, limit, render])

      // 松手惯性 / 点珠归中（一直挂着一帧循环，跟物理场一致）
      useEffect(() => {
        const tick = () => {
          const state = stateRef.current
          if (!state.dragging) {
            if (state.target !== null) {
              state.offset += (state.target - state.offset) * 0.16
              if (Math.abs(state.target - state.offset) < 0.4) {
                state.offset = state.target
                state.target = null
              }
              render()
            } else if (Math.abs(state.vel) > 0.03) {
              const lim = half()
              const next = state.offset + state.vel
              if (next > lim || next < -lim) {
                state.offset = Math.max(-lim, Math.min(lim, next))
                state.vel = 0
              } else {
                state.offset = next
                state.vel *= 0.92
              }
              render()
            }
          }
          rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(rafRef.current)
      }, [half, limit, render])

      // 指针 / 滚轮：拖动时不进 React，跟手
      useEffect(() => {
        const axis = axisRef.current
        if (!axis) return undefined
        const state = stateRef.current
        let startX = 0
        let startOffset = 0
        let lastMoveX = 0
        let lastMoveT = 0
        let moveVel = 0
        const clampSoft = (value) => {
          const lim = liveRef.current.half()
          if (value > lim) return lim + (value - lim) * 0.28
          if (value < -lim) return -lim + (value + lim) * 0.28
          return value
        }
        const onDown = (event) => {
          if (event.button !== undefined && event.button !== 0) return
          state.dragging = true
          state.moved = false
          state.target = null
          state.vel = 0
          startX = event.clientX
          startOffset = state.offset
          lastMoveX = event.clientX
          lastMoveT = Date.now()
          moveVel = 0
          const bead = event.target && event.target.closest ? event.target.closest('.sd-bead') : null
          state.downIndex = bead ? Number(bead.getAttribute('data-index')) : -1
          axis.classList.add('dragging')
          if (axis.setPointerCapture) axis.setPointerCapture(event.pointerId)
          event.preventDefault()
        }
        const onMove = (event) => {
          if (!state.dragging) return
          const dx = event.clientX - startX
          if (Math.abs(dx) > 3) state.moved = true
          state.offset = clampSoft(startOffset + dx)
          const now = Date.now()
          const dt = Math.max(1, now - lastMoveT)
          moveVel = ((event.clientX - lastMoveX) / dt) * 16
          lastMoveX = event.clientX
          lastMoveT = now
          liveRef.current.render()
        }
        const onUp = () => {
          if (!state.dragging) return
          state.dragging = false
          axis.classList.remove('dragging')
          if (!state.moved && state.downIndex >= 0) {
            const index = state.downIndex
            const live = liveRef.current
            const batch = live.list[index]
            if (batch) live.onSlice(batch.batch)
            const lim = live.half()
            state.target = Math.max(-lim, Math.min(lim, -((index - (live.list.length - 1) / 2) * BEAD_GAP)))
            state.vel = 0
            return
          }
          state.vel = Math.max(-18, Math.min(18, moveVel))
          state.target = null
        }
        const onCancel = () => {
          state.dragging = false
          axis.classList.remove('dragging')
        }
        const onWheel = (event) => {
          const d = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
          state.vel = Math.max(-26, Math.min(26, state.vel + d * 0.35))
          state.target = null
          event.preventDefault()
        }
        axis.addEventListener('pointerdown', onDown)
        axis.addEventListener('pointermove', onMove)
        axis.addEventListener('pointerup', onUp)
        axis.addEventListener('pointercancel', onCancel)
        axis.addEventListener('wheel', onWheel, { passive: false })
        return () => {
          axis.removeEventListener('pointerdown', onDown)
          axis.removeEventListener('pointermove', onMove)
          axis.removeEventListener('pointerup', onUp)
          axis.removeEventListener('pointercancel', onCancel)
          axis.removeEventListener('wheel', onWheel)
        }
      }, [])

      // 撤销最近一批：两下确认，避免误点
      const armUndo = () => {
        if (!canUndo) return
        if (armed) {
          clearTimeout(armTimer.current)
          setArmed(false)
          onUndo()
          return
        }
        setArmed(true)
        clearTimeout(armTimer.current)
        armTimer.current = setTimeout(() => setArmed(false), 3200)
      }
      useEffect(() => () => clearTimeout(armTimer.current), [])

      return h(
        'div',
        { className: 'sd-time' },
        h(
          'div',
          { className: 'sd-time-head' },
          h(Icon, { name: 'history', size: 12 }),
          h('b', null, '时间轴'),
          h('span', { className: 'sd-time-count' }, `${list.length} 批`),
          unseenBatches ? h('span', { className: 'sd-time-unseen' }, `未读 ${unseenBatches} 批 · ${unseenCount} 件`) : null,
          h(
            'div',
            { className: 'sd-time-actions' },
            h('button', {
              className: 'sd-time-btn',
              'data-on': Boolean(sliceBatch),
              disabled: !sliceBatch,
              title: sliceBatch ? '退出切片（Esc）' : '点一颗珠子看这一批改了什么',
              onClick: () => sliceBatch && onSlice(sliceBatch),
            }, sliceBatch ? '退出切片' : '点珠切片'),
            h('button', { className: 'sd-time-btn', title: '打开变更抽屉', onClick: onOpenDrawer }, h(Icon, { name: 'list', size: 11 }), `变更${unseenBatches ? ` ${unseenBatches} 批` : ''}`),
            unseenBatches ? h('button', { className: 'sd-time-btn', title: '把当前版本记为已读（角标清零）', onClick: onMarkSeen }, '标记已读') : null,
            h('button', {
              className: `sd-time-btn danger${armed ? ' armed' : ''}`,
              disabled: !canUndo,
              title: latest ? `回滚最近一批：${latest.summary || latest.batch}（板子+坐标回到那批动手之前）` : '还没有可回滚的批',
              onClick: armUndo,
            }, armed ? '再点一次确认回滚' : '撤销最近一批'),
          ),
        ),
        h(
          'div',
          { className: 'sd-axis', ref: axisRef },
          h('div', { className: 'sd-axis-rail' }),
          !list.length
            ? h('div', { className: 'sd-time-empty' }, '还没有批次：改一笔，或让智能体动一下板子，这里就会长出一颗珠子。')
            : null,
          h(
            'div',
            { className: 'sd-beads' },
            list.map((batch, index) => {
              const counts = batchBeadCounts(batch)
              const on = sliceBatch === batch.batch
              return h(
                'div',
                {
                  key: batch.batch,
                  className: 'sd-bead',
                  ref: (el) => {
                    if (el) beadEls.current[index] = el
                  },
                  'data-index': index,
                  'data-batch': batch.batch,
                  'data-on': on ? 'true' : undefined,
                  'data-kind': batch.op || 'ops',
                  title: `${batchHeading(batch)} · ${batch.summary || ''}`,
                },
                h(
                  'div',
                  { className: 'sd-bead-nums' },
                  counts.added ? h('b', { className: 'a' }, `+${counts.added}`) : null,
                  counts.changed ? h('b', { className: 'c' }, `~${counts.changed}`) : null,
                  counts.removed ? h('b', { className: 'r' }, `−${counts.removed}`) : null,
                ),
                h('i', { className: 'sd-bead-dot' }),
                h('span', { className: 'sd-bead-ix' }, `#${index + 1}`),
                h('span', { className: 'sd-bead-tip' }, `${batchHeading(batch)} · ${batch.summary || ''}`.slice(0, 60)),
              )
            }),
          ),
        ),
      )
    }

    // ── 变更抽屉（v1.14）────────────────────────────────────────
    function ChangesDrawer({ groups, batches, total, unseenCount, sliceEntry, detailNotes, detailPending, onClose, onPick, onCopy }) {
      const heading = sliceEntry
        ? `切片：${batchHeading(sliceEntry)}`
        : unseenCount
          ? `未读 ${unseenCount} 件（${batches.length} 批）`
          : `最近 ${batches.length} 批（都已读）`
      return h(
        'div',
        { className: 'sd-changes' },
        h(
          'div',
          { className: 'sd-changes-head' },
          h(Icon, { name: 'history', size: 14 }),
          '变更',
          h('span', { className: 'sub' }, heading),
          h('div', { style: { flex: 1 } }),
          h('button', { className: 'sd-btn', title: '关闭（Esc）', onClick: onClose }, h(Icon, { name: 'close', size: 13 })),
        ),
        h(
          'div',
          { className: 'sd-changes-body' },
          // v1.17：历史索引瘦身后，太老的批只剩摘要（diff/labels 不再保留）——抽屉里给一行明确提示
          (Array.isArray(detailNotes) ? detailNotes : []).map((note) =>
            h('div', { key: `trim-${note.batch}`, className: 'sd-change-note', 'data-batch': note.batch, 'data-trimmed': 'true' }, `「${note.batch}」详情已超出保留（${note.keptBatches} 批前），这一批只能看摘要。`),
          ),
          total
            ? groups.map((group) =>
                h(
                  'div',
                  { key: group.kind, className: 'sd-change-group' },
                  h('h5', null, `${group.label} · ${group.rows.length}`),
                  group.rows.map((row) => {
                    const meta = CHANGE_META[row.kind] || { label: row.kind, mark: '?' , cls: '' }
                    return h(
                      'div',
                      {
                        key: row.key,
                        className: 'sd-change-row',
                        title: `${row.batch} · ${row.summary}`,
                        onClick: () => onPick(row),
                      },
                      h('i', { className: `sd-badge ${meta.cls}` }, meta.mark),
                      h('span', { className: 'id' }, row.id),
                      h('span', { className: 'name' }, row.label),
                      h('span', { className: 'bt' }, batchTime(row.at)),
                      h('button', {
                        className: 'cp',
                        title: '复制这条改动证据',
                        onClick: (event) => {
                          event.stopPropagation()
                          onCopy(row)
                        },
                      }, '⧉'),
                    )
                  }),
                ),
              )
            : h(
                'div',
                { className: 'sd-change-empty' },
                detailPending
                  ? '正在读取这一批的详情…（/history?batch=，读过的会缓存）'
                  : detailNotes.length
                    ? '这些批的详情已超出保留：只能看批摘要（逐件的 新/改/删 记录不再保留）。'
                    : '自上次已读没有新改动。',
                detailPending || detailNotes.length ? null : h('br'),
                detailPending || detailNotes.length ? null : '我还改了或程序扫描过的话，这里会出现「新 / 改 / 删」和证据；时间轴能翻更早的批。',
              ),
        ),
        h('div', { className: 'sd-changes-foot' }, `点一行＝定位该件；⧉ 复制证据直接贴给智能体。角标只记「上次已读」之后的改动；点珠子按批看。`),
      )
    }

    // ── 桌边消息条（v1.15）──────────────────────────────────────
    // 收起＝一行；展开＝选中件 chips ＋ 输入框 ＋ 状态行。发送走页面里的官方会话服务。
    function DeskBar({ barOpen, setBarOpen, session, selectedItems, selection, onSelect, text, setText, state, onSend }) {
      const inputRef = useRef(null)
      const phase = state && state.phase ? state.phase : 'idle'
      const status = useMemo(() => {
        if (phase === 'sending') return '发送中…'
        if (phase === 'error') return `没发出去 · ${state.code ? `${state.code} · ` : ''}${state.message || ''}`
        if (phase === 'local') return state.message || '本地指令已执行'
        if (phase === 'accepted') {
          const title = state.title || (session && session.title) || ''
          const running = session && session.running
          return `已收到${title ? `（${title}）` : ''}${running ? ' · 我正在跑' : ' · 回主界面看回复'}`
        }
        if (session && session.id) {
          return `发给：${session.title || session.id}${session.running ? ' · 运行中' : ''}${session.via === 'uiWorkspace' ? '（记忆里的会话）' : ''}`
        }
        return '没找到当前会话：先在主界面打开一个对话'
      }, [phase, session, state])

      if (!barOpen) {
        return h(
          'div',
          { className: 'sd-deskbar-collapsed' },
          h(
            'button',
            { className: 'sd-deskbar-toggle', onClick: () => setBarOpen(true), title: '展开桌边消息（选中件会自动附上）' },
            h(Icon, { name: 'send', size: 13 }),
            '桌边消息',
            selection.length ? h('span', { className: 'sd-deskbar-count' }, `${selection.length} 件`) : null,
            h('span', { className: 'sd-deskbar-hint' }, 'Ctrl+Enter 发送'),
          ),
        )
      }

      const disabledSend = !String(text || '').trim() || phase === 'sending'
      return h(
        'div',
        { className: 'sd-deskbar' },
        h(
          'div',
          { className: 'sd-deskbar-chips' },
          selectedItems.length === 0
            ? h('span', { className: 'sd-deskbar-empty' }, '选几个件，会自动附在这句话后面')
            : selectedItems.slice(0, 20).map(({ kind, item }) =>
                h(
                  'button',
                  { key: item.id, className: 'sd-deskchip', 'data-kind': kind, title: `${KIND_LABEL[kind] || ''} ${item.id}`, onClick: () => onSelect([item.id]) },
                  h('span', { className: 'sd-deskchip-kind' }, KIND_LABEL[kind] || kind),
                  h('span', { className: 'sd-deskchip-text' }, chipLabel(kind, item)),
                  h('span', {
                    className: 'sd-deskchip-x',
                    role: 'button',
                    title: '从选中里去掉',
                    onClick: (event) => {
                      event.stopPropagation()
                      onSelect(selection.filter((id) => id !== item.id))
                    },
                  }, '×'),
                ),
              ),
          selectedItems.length > 20 ? h('span', { className: 'sd-deskbar-more' }, `另有 ${selectedItems.length - 20} 件`) : null,
        ),
        h(
          'div',
          { className: 'sd-deskbar-row' },
          h('input', {
            ref: inputRef,
            className: 'sd-deskbar-input',
            value: text,
            placeholder: '说一句，或 / 用本地指令 · Ctrl+Enter 发送',
            spellCheck: false,
            onChange: (event) => setText(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault()
                event.stopPropagation()
                onSend()
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                if (text) setText('')
                else if (inputRef.current) inputRef.current.blur()
              }
            },
          }),
          h('button', { className: 'sd-deskbar-send', disabled: disabledSend, title: '发送（Ctrl+Enter）', onClick: onSend }, h(Icon, { name: 'send', size: 13 }), '发送'),
          h('button', { className: 'sd-deskbar-fold', title: '收起命令条', onClick: () => setBarOpen(false) }, '▾'),
        ),
        h(
          'div',
          { className: 'sd-deskbar-status', 'data-phase': phase },
          h('span', { className: 'sd-deskbar-dot' }),
          h('span', { className: 'sd-deskbar-status-text' }, status),
          h(
            'span',
            { className: 'sd-deskbar-cmds' },
            LOCAL_BAR_COMMANDS.map((entry) =>
              h('button', {
                key: entry.cmd,
                type: 'button',
                className: 'sd-deskbar-cmd',
                title: entry.hint,
                onClick: () => {
                  setText(`${entry.cmd} `)
                  if (inputRef.current) inputRef.current.focus()
                },
              }, entry.cmd),
            ),
          ),
        ),
      )
    }

    // ── 欢迎页 ────────────────────────────────────────────────────
    function Welcome({ desk, store }) {
      return h(
        'div',
        { className: 'sd-root' },
        h('style', null, CSS),
        h(
          'div',
          { className: 'sd-welcome' },
          h('h1', null, h(Glyph, { size: 28 }), '结构台'),
          h('p', null, '域记你想的，块记实际有的，连接说它们怎么相关。人和智能体改的是同一份盘上的结构蓝图——画完不用导出，智能体读的就是这张桌子。'),
          h(
            'div',
            { className: 'go' },
            h('button', { className: 'sd-btn primary', style: { height: 34, padding: '0 16px' }, onClick: () => desk.pickDirectory() }, h(Icon, { name: 'folder' }), '打开一个项目'),
            h('button', { className: 'sd-btn', style: { height: 34, padding: '0 14px' }, onClick: () => desk.boot() }, h(Icon, { name: 'refresh' }), '重扫最近'),
          ),
          store.recent && store.recent.length
            ? h(
                'div',
                { style: { width: 'min(680px,100%)' } },
                h('div', { className: 'sd-hint', style: { marginBottom: 8 } }, '最近打开'),
                h(
                  'div',
                  { className: 'cards' },
                  store.recent.map((item) =>
                    h(
                      'button',
                      { key: item.path, className: 'sd-card', onClick: () => desk.openProject(item.path) },
                      h('b', null, item.name || item.path.split(/[\\/]/).pop()),
                      h('span', null, item.path),
                      h('span', { style: { direction: 'ltr', color: 'var(--dsw-alias-state-idle-primary)', fontSize: 10 } }, (item.updatedAt || '').slice(0, 16).replace('T', ' ')),
                    ),
                  ),
                ),
              )
            : h('p', { className: 'sd-hint' }, '还没有打开过项目。打开后会自动在项目里建 结构蓝图/ 目录，板子就住那儿。也可以先让智能体用 structure_desk 工具建一张，再回来这里打开。'),
        ),
        desk.toast && h('div', { className: 'sd-toast', 'data-kind': desk.toast.kind }, desk.toast.text),
      )
    }

    // ── 左栏 ──────────────────────────────────────────────────────
    function LeftRail({ board, stats, gaps, gapItems, planGroups, layers, onToggleLayer, onEnterDomainView, domainTree, journalTail, selection, selected, filters, setFilters, onSelect, onLocate, onHover, onHoverEnd, onUpdate, onRemove, onNewChild, collapsed,
      onSelectDomains, onBatchStatus, onBatchParent, onBatchTags, onBatchRemove, onClearSelection }) {
      const [openGap, setOpenGap] = useState({ unannotated: true, ungrounded: false, planOpen: false, conflicts: true })
      const [openTree, setOpenTree] = useState(true)
      // v1.16：落差／计划视图 两个 tab（默认落差，既有行为不变）
      const [gapTab, setGapTab] = useState('gaps')
      const [folded, setFolded] = useState({})
      const [menuId, setMenuId] = useState(null)
      const [batchMenu, setBatchMenu] = useState(null) // 'status' | 'parent' | 'tags'
      const [tagDraft, setTagDraft] = useState('')
      const anchorRef = useRef(null)
      // 可见树顺序（折叠的子域不展开）：Shift 范围选按它算
      const visibleOrder = useMemo(() => {
        const out = []
        const walk = (nodes) => {
          for (const node of nodes || []) {
            out.push(node.id)
            if (node.children && node.children.length && !folded[node.id]) walk(node.children)
          }
        }
        walk(domainTree)
        return out
      }, [domainTree, folded])
      const selectedDomains = useMemo(
        () => (selection || []).map((id) => board.domains.find((domain) => domain.id === id)).filter(Boolean),
        [selection, board],
      )
      const selectedIds = selectedDomains.map((domain) => domain.id)
      // 「装入」候选：不能是已选中的域，也不能是任一已选域的后代（防成环）
      const parentCandidates = useMemo(
        () => board.domains.filter((candidate) => {
          if (selectedIds.includes(candidate.id)) return false
          return !selectedIds.some((id) => isDescendantOf(board.domains, candidate.id, id))
        }),
        [board, selectedIds.join(',')],
      )
      /** 行点击：普通＝单选；Ctrl/Cmd＝加/减选；Shift＝从锚点范围选（Ctrl+Shift＝并入）。 */
      const handleRowClick = (id, event) => {
        const shift = event.shiftKey
        const mod = event.ctrlKey || event.metaKey
        const anchor = anchorRef.current
        if (shift && anchor && visibleOrder.includes(anchor)) {
          const from = visibleOrder.indexOf(anchor)
          const to = visibleOrder.indexOf(id)
          if (to >= 0) {
            const range = visibleOrder.slice(Math.min(from, to), Math.max(from, to) + 1)
            onSelectDomains(mod ? Array.from(new Set([...(selection || []), ...range])) : range)
            return
          }
        }
        anchorRef.current = id
        if (mod) {
          const next = new Set(selection || [])
          if (next.has(id)) next.delete(id)
          else next.add(id)
          onSelectDomains([...next])
          return
        }
        onSelectDomains([id])
      }
      useEffect(() => {
        if (!selectedDomains.length) setBatchMenu(null)
      }, [selectedDomains.length])
      useEffect(() => {
        if (menuId === null) return
        const close = () => setMenuId(null)
        // Esc 也关菜单；用捕获阶段吃掉，免得同一下 Esc 又去清选择
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          event.stopPropagation()
          setMenuId(null)
        }
        window.addEventListener('pointerdown', close)
        window.addEventListener('keydown', onKey, true)
        return () => {
          window.removeEventListener('pointerdown', close)
          window.removeEventListener('keydown', onKey, true)
        }
      }, [menuId])
      // v1.16 层板：每层件数（域+块+便签）与眼睛开关
      const layerCounts = useMemo(() => {
        const out = { human: 0, agent: 0, program: 0 }
        for (const item of [...board.domains, ...board.blocks, ...board.notes]) out[layerOf(item)] += 1
        return out
      }, [board])
      // v1.16 计划视图：三组（空承诺/未落地/未标注），组头按层计数；行＝id + 名称 + 层色点（空承诺域带判据截断）
      const planGroupMeta = {
        ungrounded: { label: '空承诺', hint: '域还没盖住什么（中性）', layers: ['human', 'agent'] },
        planOpen: { label: '未落地', hint: '计划块还没实现', layers: ['human', 'agent'] },
        unannotated: { label: '未标注', hint: '块还没人管（中性）', layers: ['program'] },
      }
      const planList = useMemo(
        () =>
          Object.keys(planGroupMeta).map((key) => {
            const counts = (planGroups && planGroups[key]) || {}
            const rows = []
            for (const layer of planGroupMeta[key].layers) {
              for (const id of counts[layer] || []) {
                const item = board.domains.find((domain) => domain.id === id) || board.blocks.find((block) => block.id === id) || null
                if (!item) continue
                rows.push({
                  id,
                  key,
                  layer,
                  label: item.title || item.address || item.path || id,
                  criteria: key === 'ungrounded' ? String(item.criteria || '').trim() : '',
                })
              }
            }
            return { key, counts, rows }
          }),
        [board, planGroups],
      )
      const layerCountText = (counts) =>
        LAYER_ORDER.filter((layer) => (counts[layer] || []).length > 0)
          .map((layer) => `${LAYER_META[layer].label} ${counts[layer].length}`)
          .join(' · ') || '0'
      const coverage = stats && stats.realBlocks ? Math.round((stats.covered / stats.realBlocks) * 100) : 0
      return h(
        'div',
        { className: 'sd-rail' },
        h(
          'div',
          { className: 'sd-rail-scroll' },
          // 概览
          h(
            'div',
            { className: 'sd-sec' },
            h('div', { className: 'sd-sec-head' }, '概览'),
            h(
              'div',
              { className: 'sd-stats' },
              h('div', { className: 'sd-stat' }, h('b', null, stats.domains), h('span', null, '域')),
              h('div', { className: 'sd-stat' }, h('b', null, stats.realBlocks), h('span', null, '实块')),
              h('div', { className: 'sd-stat' }, h('b', null, stats.planBlocks), h('span', null, '计划块')),
              h('div', { className: 'sd-stat' }, h('b', null, stats.links), h('span', null, '连接')),
            ),
            h(
              'div',
              { title: `覆盖 ${stats.covered}/${stats.realBlocks}` },
              h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginBottom: 3 } },
                h('span', null, '块被说法的覆盖率'),
                h('span', null, `${coverage}%`),
              ),
              h('div', { className: 'sd-bar' }, h('i', { style: { width: `${coverage}%` } })),
            ),
            h(
              'div',
              { className: 'sd-filter' },
              h(
                'button',
                { className: 'sd-fchip', 'data-on': filters.planned, title: '显示／隐藏全部计划块（层板只管层）', onClick: () => setFilters({ ...filters, planned: !filters.planned }) },
                '计划块',
              ),
              h('span', { className: 'sd-batch-hint' }, '层的显隐见下方层板'),
            ),
          ),

          // 落差 / 计划视图（v1.16：两个 tab；默认落差，既有行为不变）
          h(
            'div',
            { className: 'sd-sec' },
            h(
              'div',
              { className: 'sd-sec-head' },
              gapTab === 'plan' ? '计划视图（按层）' : '落差（算出来的）',
              h(
                'span',
                { className: 'sd-count' },
                gapTab === 'plan'
                  ? planList.reduce((sum, group) => sum + group.rows.length, 0)
                  : GAP_META.reduce((sum, meta) => sum + (((gaps && gaps[meta.key]) || []).length), 0),
              ),
            ),
            h(
              'div',
              { className: 'sd-tabs' },
              h('button', { className: 'sd-tab', 'data-on': gapTab === 'gaps', onClick: () => setGapTab('gaps') }, '落差'),
              h('button', { className: 'sd-tab', 'data-on': gapTab === 'plan', title: '每天开工的清单：空承诺／未落地／未标注，组头按层计数', onClick: () => setGapTab('plan') }, '计划视图'),
            ),
            gapTab === 'plan'
              ? h(
                  'div',
                  { className: 'sd-plan-list' },
                  planList.map(({ key, counts, rows }) =>
                    h(
                      'div',
                      {
                        key,
                        className: 'sd-plan-group',
                        'data-gap-key': key,
                        'data-label': planGroupMeta[key].label,
                        'data-count-human': (counts.human || []).length,
                        'data-count-agent': (counts.agent || []).length,
                        'data-count-program': (counts.program || []).length,
                        'data-total': rows.length,
                      },
                      h(
                        'div',
                        { className: 'sd-plan-head', title: planGroupMeta[key].hint },
                        h('span', { className: `sd-gap-dot ${key}` }),
                        planGroupMeta[key].label,
                        h('span', { className: 'sd-count' }, rows.length),
                        h(
                          'span',
                          { className: 'sd-plan-counts' },
                          planGroupMeta[key].layers.map((layer, index) =>
                            h(
                              React.Fragment,
                              { key: layer },
                              index > 0 ? h('span', { className: 'sd-plan-count' }, '·') : null,
                              h(
                                'span',
                                { className: 'sd-plan-count', 'data-layer': layer },
                                h('i', { className: 'sd-layer-dot', style: { background: LAYER_META[layer].color } }),
                                `${LAYER_META[layer].label} ${(counts[layer] || []).length}`,
                              ),
                            ),
                          ),
                        ),
                      ),
                      rows.length
                        ? h(
                            'div',
                            { className: 'sd-plan-rows' },
                            rows.map((row) =>
                              h(
                                'div',
                                {
                                  key: `${key}:${row.layer}:${row.id}`,
                                  className: 'sd-plan-row',
                                  'data-id': row.id,
                                  'data-layer': row.layer,
                                  'data-gap-key': key,
                                  title: row.criteria ? `判据：${row.criteria}` : row.label,
                                  onClick: () => onLocate(row.id),
                                  onPointerEnter: () => onHover && onHover(row.id),
                                  onPointerLeave: () => onHoverEnd && onHoverEnd(row.id),
                                },
                                h('i', { className: 'sd-layer-dot', style: { background: LAYER_META[row.layer].color } }),
                                h('code', null, row.id),
                                h('span', { className: 't' }, row.label),
                                row.criteria
                                  ? h('span', { className: 'crit', title: row.criteria }, `判据：${row.criteria.slice(0, 24)}${row.criteria.length > 24 ? '…' : ''}`)
                                  : null,
                              ),
                            ),
                          )
                        : h('div', { className: 'sd-empty' }, planGroupMeta[key].hint),
                    ),
                  ),
                )
              : GAP_META.map((meta) =>
                  h(
                    'div',
                    { key: meta.key, className: 'sd-gap' },
                    h(
                      'div',
                      { className: 'sd-gap-head', onClick: () => setOpenGap({ ...openGap, [meta.key]: !openGap[meta.key] }) },
                      h('span', { className: `sd-gap-dot ${meta.key}` }),
                      meta.label,
                      h('span', { className: 'sd-count' }, (gaps && gaps[meta.key] ? gaps[meta.key].length : 0) || '—'),
                    ),
                    openGap[meta.key] &&
                      h(
                        'div',
                        { className: 'sd-gap-list' },
                        (gapItems[meta.key] || []).length === 0
                          ? h('div', { className: 'sd-empty' }, meta.hint)
                          : gapItems[meta.key].map((item) =>
                              h(
                                'div',
                                {
                                  key: item.id,
                                  className: 'sd-row',
                                  onClick: () => onLocate(item.id),
                                  onPointerEnter: () => onHover && onHover(item.id),
                                  onPointerLeave: () => onHoverEnd && onHoverEnd(item.id),
                                  title: item.label,
                                },
                                h('code', null, item.label),
                              ),
                            ),
                      ),
                  ),
                ),
          ),

          // 层板（v1.16：放落差下面；人/agent/程序 三行，色点 + 件数 + 眼睛；当前编辑层固定人）
          h(
            'div',
            { className: 'sd-sec' },
            h('div', { className: 'sd-sec-head' }, '层板', h('span', { className: 'sd-count' }, '说法归属')),
            h(
              'div',
              { className: 'sd-layers' },
              LAYER_ORDER.map((layer) => {
                const on = layers[layer] !== false
                return h(
                  'div',
                  {
                    key: layer,
                    className: 'sd-layer-row',
                    'data-layer': layer,
                    'data-on': on,
                    'data-count': layerCounts[layer] || 0,
                    title: LAYER_META[layer].hint,
                    onClick: () => onToggleLayer(layer),
                  },
                  h('i', { className: 'sd-layer-dot', style: { background: LAYER_META[layer].color } }),
                  h('span', { className: 't' }, LAYER_META[layer].label),
                  h('span', { className: 'n' }, layerCounts[layer] || 0),
                  h(
                    'button',
                    {
                      className: 'sd-layer-eye',
                      'data-on': on,
                      'data-eye': on ? 'on' : 'off',
                      title: on ? `隐藏${LAYER_META[layer].label}层（节点/边/包络都不画）` : `显示${LAYER_META[layer].label}层`,
                      onClick: (event) => {
                        event.stopPropagation()
                        onToggleLayer(layer)
                      },
                    },
                    on ? '◉' : '○',
                  ),
                )
              }),
            ),
            h(
              'div',
              { className: 'sd-layer-current' },
              '当前编辑层：',
              h(
                'b',
                null,
                h('i', { className: 'sd-layer-dot', style: { background: LAYER_META[CURRENT_LAYER].color } }),
                LAYER_META[CURRENT_LAYER].label,
              ),
              h('span', { className: 'l' }, '面板只写人层；agent 只从工具写'),
            ),
          ),

          // 域树
          h(
            'div',
            { className: 'sd-sec' },
            h(
              'div',
              { className: 'sd-sec-head', onClick: () => setOpenTree(!openTree) },
              '域',
              h('span', { className: 'sd-count' }, stats.domains),
            ),
            openTree && selectedDomains.length > 0 &&
              h(
                'div',
                { className: 'sd-batch', 'data-batch': selectedDomains.length },
                h(
                  'div',
                  { className: 'sd-batch-head' },
                  h('b', null, `已选 ${selectedDomains.length} 个域`),
                  h('button', { className: 'x', title: '清除选择（Esc）', onClick: onClearSelection }, '✕'),
                ),
                h(
                  'div',
                  { className: 'sd-batch-actions' },
                  h('button', { className: 'sd-batch-btn', 'data-on': batchMenu === 'status', onClick: () => setBatchMenu(batchMenu === 'status' ? null : 'status') }, '状态 ▾'),
                  h('button', { className: 'sd-batch-btn', 'data-on': batchMenu === 'parent', onClick: () => setBatchMenu(batchMenu === 'parent' ? null : 'parent') }, '装入 ▾'),
                  h('button', { className: 'sd-batch-btn', 'data-on': batchMenu === 'tags', onClick: () => { setBatchMenu(batchMenu === 'tags' ? null : 'tags'); setTagDraft('') } }, '标签 ▾'),
                  h('button', { className: 'sd-batch-btn danger', title: '删除选中的域（可 Ctrl+Z 撤销）', onClick: () => { onBatchRemove(selectedIds); setBatchMenu(null) } }, '删除'),
                ),
                batchMenu === 'status' &&
                  h('div', { className: 'sd-batch-panel' },
                    h('div', { className: 'sd-batch-chips' },
                      Object.entries(STATUS_META).map(([status, meta]) =>
                        h('button', { key: status, className: 'sd-batch-btn', title: meta.hint, onClick: () => { onBatchStatus(selectedIds, status); setBatchMenu(null) } }, meta.label),
                      ),
                    ),
                  ),
                batchMenu === 'parent' &&
                  h('div', { className: 'sd-batch-panel' },
                    h('div', { className: 'sd-batch-list' },
                      h('button', { className: 'sd-batch-item', onClick: () => { onBatchParent(selectedIds, null); setBatchMenu(null) } }, '（根域）'),
                      parentCandidates.map((candidate) =>
                        h('button', { key: candidate.id, className: 'sd-batch-item', onClick: () => { onBatchParent(selectedIds, candidate.id); setBatchMenu(null) } }, candidate.title),
                      ),
                    ),
                  ),
                batchMenu === 'tags' &&
                  h('div', { className: 'sd-batch-panel' },
                    h('div', { className: 'sd-batch-row' },
                      h('input', {
                        className: 'sd-batch-input',
                        value: tagDraft,
                        placeholder: '加一个标签…',
                        onChange: (event) => setTagDraft(event.target.value),
                        onKeyDown: (event) => {
                          if (event.key === 'Enter') {
                            onBatchTags(selectedIds, { add: tagDraft })
                            setTagDraft('')
                            setBatchMenu(null)
                          }
                        },
                      }),
                      h('button', { className: 'sd-batch-btn', onClick: () => { onBatchTags(selectedIds, { add: tagDraft }); setTagDraft(''); setBatchMenu(null) } }, '加'),
                    ),
                    h('div', { className: 'sd-batch-chips' },
                      h('button', { className: 'sd-batch-btn', onClick: () => { onBatchTags(selectedIds, { clear: true }); setBatchMenu(null) } }, '清空标签'),
                      h('span', { className: 'sd-batch-hint' }, '只加／清，不动各域已有其他标签'),
                    ),
                  ),
              ),
            openTree &&
              h(
                'div',
                { className: 'sd-tree' },
                domainTree.length === 0
                  ? h('div', { className: 'sd-empty' }, '还没有域。按 D 或点「建域」')
                  : domainTree.map((domain) =>
                      h(DomainTreeItem, {
                        key: domain.id,
                        domain,
                        depth: 0,
                        ctx: {
                          folded,
                          setFolded,
                          selection,
                          onSelect,
                          onUpdate,
                          onRemove,
                          onNewChild,
                          onLocate,
                          onHover,
                          onHoverEnd,
                          onEnterDomainView,
                          allDomains: board.domains,
                          menuId,
                          setMenuId,
                          onRowClick: handleRowClick,
                        },
                      }),
                    ),
              ),
          ),

          // 便签
          (board.notes || []).length > 0 &&
            h(
              'div',
              { className: 'sd-sec' },
              h('div', { className: 'sd-sec-head' }, '便签', h('span', { className: 'sd-count' }, board.notes.length)),
              h(
                'div',
                { className: 'sd-log' },
                board.notes.map((note) =>
                  h(
                    'div',
                    {
                      key: note.id,
                      className: 'sd-row',
                      onClick: () => onSelect(note.id),
                      onPointerEnter: () => onHover && onHover(note.id),
                      onPointerLeave: () => onHoverEnd && onHoverEnd(note.id),
                      title: note.text,
                    },
                    h('code', { style: { fontFamily: 'inherit' } }, note.text.replace(/\s+/g, ' ').slice(0, 40) || '（空）'),
                  ),
                ),
              ),
            ),

          // 动静
          h(
            'div',
            { className: 'sd-sec' },
            h('div', { className: 'sd-sec-head' }, '动静', h('span', { className: 'sd-count' }, (journalTail || []).length)),
            h(
              'div',
              { className: 'sd-log' },
              (journalTail || []).length === 0
                ? h('div', { className: 'sd-empty' }, '还没有改动')
                : journalTail.slice(-8).reverse().map((entry, index) =>
                    h(
                      'div',
                      { key: index, className: 'sd-log-row', title: `${entry.summary}` },
                      h('time', null, (entry.at || '').slice(11, 16)),
                      h('span', { className: cx('sd-author', entry.author), style: { marginRight: 2 } }, AUTHOR_META[entry.author] ? AUTHOR_META[entry.author].mark : '·'),
                      h('span', null, entry.summary),
                    ),
                  ),
            ),
          ),
        ),
      )
    }

    /** 左栏一行域：双击改名、⋯ 菜单改状态/说法/装进/删除；不用去右栏也能改。 */
    function DomainTreeItem({ domain, depth, ctx }) {
      const { folded, setFolded, selection, onUpdate, onRemove, onNewChild, allDomains, menuId, setMenuId, onRowClick, onHover, onHoverEnd, onEnterDomainView } = ctx
      const [editing, setEditing] = useState(null) // {field:'title'|'statement'}
      const [draft, setDraft] = useState('')
      const [where, setWhere] = useState(null) // 菜单里的「装入…」页
      const kids = domain.children || []
      const isFolded = !!folded[domain.id]
      const open = menuId === domain.id
      const boxRef = useRef(null)
      const [menuAt, setMenuAt] = useState(null)
      // Enter 提交后输入框卸载时还会再来一次 blur；Esc 撤销后也不许 blur 补交。
      // 一次编辑只认第一下提交（以前会给 journal 写两条一样的 update_domain）。
      const commitLock = useRef(false)

      const startEdit = (field) => {
        commitLock.current = false
        setEditing({ field })
        setDraft(field === 'title' ? domain.title : domain.statement || '')
        setMenuId(null)
      }
      const commit = () => {
        if (!editing || commitLock.current) return
        commitLock.current = true
        const value = draft.trim()
        if (editing.field === 'title' && value && value !== domain.title) onUpdate(domain.id, { title: value })
        if (editing.field === 'statement' && value !== (domain.statement || '')) onUpdate(domain.id, { statement: value })
        setEditing(null)
      }
      const cancel = () => {
        commitLock.current = true
        setEditing(null)
      }

      const openMenu = (event) => {
        event.stopPropagation()
        const rect = event.currentTarget.getBoundingClientRect()
        // 下面放不下就往上翻，别把菜单顶到窗口外
        const below = window.innerHeight - rect.bottom
        const top = below > 320 ? rect.bottom + 4 : Math.max(8, Math.min(rect.top - 300, window.innerHeight - 320))
        setMenuAt({ x: rect.right - 8, y: top })
        setMenuId(open ? null : domain.id)
        setWhere(null)
      }

      const row = h(
        'div',
        {
          className: 'sd-tree-row',
          'data-domain-id': domain.id,
          'data-sel': selection.includes(domain.id),
          style: { paddingLeft: 6 + depth * 12 },
          onClick: (event) => { if (!editing) onRowClick(domain.id, event) },
          onPointerEnter: () => onHover && onHover(domain.id),
          onPointerLeave: () => onHoverEnd && onHoverEnd(domain.id),
          onDoubleClick: (event) => {
            event.stopPropagation()
            startEdit('title')
          },
          title: domain.statement ? `${domain.statement}` : '还没写说法；双击改标题',
        },
        h(
          'span',
          {
            className: 'sd-twisty',
            onClick: (event) => {
              event.stopPropagation()
              if (kids.length) setFolded({ ...folded, [domain.id]: !isFolded })
            },
          },
          kids.length ? (isFolded ? '▸' : '▾') : '',
        ),
        h('span', { className: cx('sd-dot', domain.status), title: STATUS_META[domain.status].hint }),
        editing && editing.field === 'title'
          ? h('input', {
              className: 'sd-tree-input',
              autoFocus: true,
              value: draft,
              onClick: (event) => event.stopPropagation(),
              onChange: (event) => setDraft(event.target.value),
              onBlur: commit,
              onKeyDown: (event) => {
                if (event.key === 'Enter') commit()
                if (event.key === 'Escape') cancel()
              },
            })
          : h('span', { className: 't' }, domain.title),
        h('span', { className: cx('sd-author', domain.author), style: { marginLeft: 'auto' } }, AUTHOR_META[domain.author].mark),
        h(
          'button',
          { className: 'sd-tree-more', title: '编辑这个域', onClick: openMenu },
          '⋯',
        ),
      )

      const menu = open && menuAt
        ? h(
            'div',
            {
              className: 'sd-pop',
              style: { left: Math.min(menuAt.x - 176, window.innerWidth - 190), top: menuAt.y },
              onPointerDown: (event) => event.stopPropagation(),
            },
            where === 'parent'
              ? [
                  h('div', { className: 'sd-pop-head' }, '装进…'),
                  h('button', { key: 'root', className: 'sd-pop-item', onClick: () => { onUpdate(domain.id, { parent: null }); setMenuId(null) } }, '（根域）'),
                  ...allDomains
                    .filter((candidate) => candidate.id !== domain.id && candidate.id !== domain.parent && !isDescendantOf(allDomains, candidate.id, domain.id))
                    .map((candidate) =>
                      h('button', { key: candidate.id, className: 'sd-pop-item', onClick: () => { onUpdate(domain.id, { parent: candidate.id }); setMenuId(null) } }, candidate.title),
                    ),
                  h('button', { key: 'back', className: 'sd-pop-item dim', onClick: () => setWhere(null) }, '← 返回'),
                ]
              : [
                  h('button', { key: 'rename', className: 'sd-pop-item', onClick: () => startEdit('title') }, '改名'),
                  h('button', { key: 'statement', className: 'sd-pop-item', onClick: () => startEdit('statement') }, '改说法…'),
                  h('div', { key: 'sep1', className: 'sd-pop-sep' }),
                  h('div', { key: 'statusHead', className: 'sd-pop-head' }, '状态'),
                  h(
                    'div',
                    { key: 'status', className: 'sd-pop-seg' },
                    Object.entries(STATUS_META).map(([status, meta]) =>
                      h(
                        'button',
                        {
                          key: status,
                          className: 'sd-pop-segbtn',
                          'data-on': domain.status === status,
                          title: meta.hint,
                          onClick: () => {
                            onUpdate(domain.id, { status })
                            setMenuId(null)
                          },
                        },
                        meta.label,
                      ),
                    ),
                  ),
                  h('div', { key: 'sep2', className: 'sd-pop-sep' }),
                  h('button', { key: 'child', className: 'sd-pop-item', onClick: () => { onNewChild(domain.id); setMenuId(null) } }, '新建子域'),
                  h('button', { key: 'parent', className: 'sd-pop-item', onClick: () => setWhere('parent') }, domain.parent ? '装进…（当前在别的域里）' : '装进…'),
                  domain.parent
                    ? h('button', { key: 'unyoke', className: 'sd-pop-item', onClick: () => { onUpdate(domain.id, { parent: null }); setMenuId(null) } }, '移出父域')
                    : null,
                  h('div', { key: 'sep3', className: 'sd-pop-sep' }),
                  h('button', { key: 'locate', className: 'sd-pop-item', onClick: () => { ctx.onLocate(domain.id); setMenuId(null) } }, '在画布上定位'),
                  h('button', { key: 'domainview', className: 'sd-pop-item', onClick: () => { setMenuId(null); if (onEnterDomainView) onEnterDomainView(domain.id) } }, '进入域内视图'),
                  h('button', { key: 'remove', className: 'sd-pop-item danger', onClick: () => { onRemove(domain.id); setMenuId(null) } }, '删除这个域'),
                ],
          )
        : null

      const statementEditor = editing && editing.field === 'statement'
        ? h(
            'div',
            { className: 'sd-tree-edit' },
            h('textarea', {
              autoFocus: true,
              value: draft,
              placeholder: '这一域负责什么？一句话。',
              onChange: (event) => setDraft(event.target.value),
              onBlur: commit,
              onKeyDown: (event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  commit()
                }
                if (event.key === 'Escape') cancel()
              },
            }),
          )
        : null

      return h(
        'div',
        { key: domain.id, ref: boxRef, className: 'sd-tree-item' },
        row,
        menu,
        statementEditor,
        !isFolded && kids.length
          ? h(
              'div',
              null,
              kids.map((kid) =>
                h(DomainTreeItem, {
                  key: kid.id,
                  domain: kid,
                  depth: depth + 1,
                  ctx,
                }),
              ),
            )
          : null,
      )
    }

    /** candidate 是不是 ancestor 的后代（防成环）。 */
    function isDescendantOf(domains, candidateId, ancestorId) {
      let current = domains.find((domain) => domain.id === candidateId)
      const guard = new Set()
      while (current && current.parent) {
        if (guard.has(current.id)) return false
        guard.add(current.id)
        if (current.parent === ancestorId) return true
        current = domains.find((domain) => domain.id === current.parent)
      }
      return false
    }

    // ── 便签卡 ────────────────────────────────────────────────────
    function NoteCard({ note, box, layer, selected, dim, opacity, hovered, hop, focused, slice, badges, badgeScale = 1, refTarget, onPointerDown, onCommit, onColor, onFocusRef, registerRef }) {
      const [text, setText] = useState(note.text)
      useEffect(() => {
        setText(note.text)
      }, [note.text, note.id])
      const marks = Array.isArray(badges) ? badges : []
      return h(
        'div',
        {
          className: 'sd-node sd-note',
          'data-node-id': note.id,
          'data-sel': selected,
          'data-color': note.color,
          'data-layer': layer || layerOf(note),
          'data-slice': slice || undefined,
          'data-hover': hovered ? 'true' : undefined,
          'data-hop': hop ? 'true' : undefined,
          'data-focus': focused ? 'true' : undefined,
          ref: (el) => registerRef(el, note.id),
          style: { width: box.w, minHeight: box.h, opacity: opacity == null ? (dim ? 0.18 : 1) : opacity },
          onPointerDown,
        },
        h('textarea', {
          value: text,
          placeholder: '记点什么…',
          onChange: (event) => setText(event.target.value),
          onBlur: () => text !== note.text && onCommit(text),
          onKeyDown: (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              event.target.blur()
            }
          },
        }),
        h(
          'div',
          { className: 'ref', style: { display: 'flex', gap: 6 } },
          refTarget ? h('span', { onClick: onFocusRef, title: '定位到挂住的那件' }, `↳ ${refTarget.title || refTarget.address}`) : h('span', null, '自由便签'),
          h(
            'span',
            {
              style: { marginLeft: 'auto', cursor: 'pointer' },
              title: '换颜色',
              onClick: (event) => {
                event.stopPropagation()
                const next = note.color === 'amber' ? 'blue' : note.color === 'blue' ? 'green' : 'amber'
                onColor(next)
              },
            },
            '●',
          ),
        ),
        marks.length ? h('span', { className: 'sd-badges', style: { transform: `scale(${badgeScale})`, transformOrigin: 'top right' } }, marks.map((mark) => h('i', { key: mark.key, className: `sd-badge ${mark.key}`, title: mark.label }, mark.text))) : null,
      )
    }

    // ── 检视器 ────────────────────────────────────────────────────
    function Inspector({ board, selectedItems, selection, store, domainViewId, onUpdate, onRemove, onSelect, onCenter, onNewDomain, onNewNote, onLink, onMakeLink, onFocusBlock, onOpenSplit, onPropose, onEnterDomainView, onExitDomainView }) {
      if (!selectedItems.length) {
        return h(
          'div',
          { className: 'sd-insp' },
          h(
            'div',
            { className: 'sd-insp-scroll' },
            h('div', { className: 'sd-insp-head' }, '检视器'),
            h('div', { className: 'sd-hint' }, '点一个件看它的说法；框选几个块再按 D，就建一个盖住它们的域。'),
            h(
              'div',
              { className: 'sd-box' },
              h('h4', null, '这张桌子'),
              h('div', { className: 'sd-kv' }, h('span', null, '项目'), h('b', null, store.project.name)),
              h('div', { className: 'sd-kv' }, h('span', null, '板子'), h('b', null, `${store.stats.domains} 域 · ${store.stats.blocks} 块 · ${store.stats.links} 连接`)),
              h('div', { className: 'sd-kv' }, h('span', null, '落差'), h('b', null, `${store.gaps.unannotated.length} 未标注 · ${store.gaps.ungrounded.length} 空承诺 · ${store.gaps.planOpen.length} 未落地`)),
              h('div', { className: 'sd-kv' }, h('span', null, '修订'), h('b', null, store.rev)),
            ),
            h(
              'div',
              { className: 'sd-box' },
              h('h4', null, '智能体'),
              h('div', { className: 'sd-hint' }, '它用 structure_desk 工具读改同一张板子：让它「把这个项目分成五个域」「给每个域写一句说法」，页面会自己跟上。'),
              h('div', { className: 'sd-hint' }, '想让它接手，就在对话里说：用 structure_desk 看看这个项目，先读板子再动手。'),
            ),
          ),
        )
      }

      if (selectedItems.length > 1) {
        const blocks = selectedItems.filter((entry) => entry.kind === 'block').map((entry) => entry.item)
        return h(
          'div',
          { className: 'sd-insp' },
          h(
            'div',
            { className: 'sd-insp-scroll' },
            h('div', { className: 'sd-insp-head' }, `选中 ${selectedItems.length} 件`),
            h(
              'div',
              { className: 'sd-box' },
              h('h4', null, '一起做'),
              blocks.length
                ? h(
                    'button',
                    { className: 'sd-action', onClick: onNewDomain },
                    h(Icon, { name: 'domain' }),
                    `建一个域盖住这 ${blocks.length} 块`,
                  )
                : null,
              h('button', { className: 'sd-action danger', onClick: onRemove }, '删除所选'),
            ),
            h(
              'div',
              { className: 'sd-box' },
              h('h4', null, '选了这些'),
              h(
                'div',
                { className: 'sd-link-list' },
                selectedItems.map((entry) =>
                  h('div', { key: entry.item.id, className: 'sd-link-row', onClick: () => onCenter(entry.item.id) },
                    h('span', null, entry.item.title || entry.item.address || entry.item.text || entry.item.id),
                  ),
                ),
              ),
            ),
          ),
        )
      }

      const entry = selectedItems[0]
      const item = entry.item
      if (entry.kind === 'domain') {
        const blocks = board.links.filter((l) => l.type === 'covers' && l.from === item.id).map((l) => board.blocks.find((b) => b.id === l.to)).filter(Boolean)
        const children = board.domains.filter((d) => d.parent === item.id)
        const outgoing = board.links.filter((l) => l.from === item.id)
        const layer = layerOf(item)
        const guard = guardInfoOf(entry)
        const foreign = guard.readonly
        return h(
          'div',
          { className: 'sd-insp' },
          h(
            'div',
            { className: 'sd-insp-scroll' },
            h(
              'div',
              { className: 'sd-insp-head' },
              h('span', { className: 'sd-dot ' + item.status }),
              '域 ',
              h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, item.id),
              h(
                'span',
                { className: 'sd-layer-tag', 'data-layer': layer, style: { marginLeft: 'auto', color: LAYER_META[layer].color } },
                `${LAYER_META[layer].label} 层${foreign ? ' · 只读' : ''}`,
              ),
            ),
            foreign
              ? h(
                  'div',
                  { className: 'sd-readonly', 'data-role': 'readonly' },
                  h('b', null, `这是 ${LAYER_META[layer].label} 层的说法，只读`),
                  h('div', { className: 'sd-hint' }, '默认只动自己层；跨层不是覆盖，而是提案——在你层新建一条说法，用 relates／contradicts 指向它，之后你正常编辑自己的说法即视为采纳／合并。'),
                  h(
                    'button',
                    {
                      className: 'sd-action',
                      'data-action': 'propose',
                      onClick: () => onPropose({ targetId: item.id, targetTitle: item.title, targetKind: 'domain' }),
                    },
                    '提一份我的说法',
                  ),
                )
              : null,
            h(Field, { label: '标题', field: 'title', value: item.title, readOnly: foreign, onCommit: (value) => onUpdate(item.id, { title: value }) }),
            h(Field, { label: '说法（这一域负责什么）', field: 'statement', value: item.statement, multiline: true, readOnly: foreign, placeholder: '一句话说清它管什么；空着就是「空承诺」', onCommit: (value) => onUpdate(item.id, { statement: value }) }),
            h(
              'div',
              { className: 'sd-field' },
              h('label', null, '状态'),
              h(
                'div',
                { className: 'sd-seg' },
                Object.entries(STATUS_META).map(([status, meta]) =>
                  h('button', { key: status, 'data-on': item.status === status, disabled: foreign, title: foreign ? '只读' : meta.hint, onClick: () => onUpdate(item.id, { status }) }, meta.label),
                ),
              ),
            ),
            h(Field, {
              label: '完成判据（什么算这个域落地）',
              field: 'criteria',
              value: item.criteria || '',
              multiline: true,
              readOnly: foreign,
              placeholder: '一条可检验的话，例：登录接口有 429 限流，且有单测覆盖',
              onCommit: (value) => onUpdate(item.id, { criteria: String(value || '').slice(0, 300) }),
            }),
            h(
              'div',
              { className: 'sd-hint' },
              foreign ? '判据由该层作者填写；你可以提一份自己层的说法，并写上你的判据。' : '空着＝还没定「什么算落地」（≤300 字，超长会截断）。',
            ),
            h(Field, { label: '标签（逗号分隔）', value: (item.tags || []).join(', '), readOnly: foreign, onCommit: (value) => onUpdate(item.id, { tags: value.split(',').map((x) => x.trim()).filter(Boolean) }) }),
            h(Field, { label: '批注', value: item.note, multiline: true, readOnly: foreign, placeholder: '给自己的一句话', onCommit: (value) => onUpdate(item.id, { note: value }) }),
            h(
              'div',
              { className: 'sd-field' },
              h('label', null, '装在'),
              h(
                'select',
                {
                  value: item.parent || '',
                  disabled: foreign,
                  onChange: (event) => onUpdate(item.id, { parent: event.target.value || null }),
                },
                h('option', { value: '' }, '（根域）'),
                board.domains
                  .filter((d) => d.id !== item.id)
                  .map((d) => h('option', { key: d.id, value: d.id }, d.title)),
              ),
            ),
            h(
              'div',
              { className: 'sd-box' },
              h('h4', null, `盖住的块（${blocks.length}）`),
              blocks.length
                ? h(
                    'div',
                    { className: 'sd-link-list' },
                    blocks.slice(0, 12).map((block) =>
                      h('div', { key: block.id, className: 'sd-link-row', onClick: () => onFocusBlock(block.id) },
                        h('span', null, block.address),
                      ),
                    ),
                  )
                : h('div', { className: 'sd-hint' }, '还没盖住任何块——选几块再按 D，或把块拖进来。'),
              children.length
                ? h('div', { className: 'sd-hint' }, `子域 ${children.length}：${children.map((d) => d.title).join(' · ')}`)
                : null,
            ),
            outgoing.length
              ? h(
                  'div',
                  { className: 'sd-box' },
                  h('h4', null, `出边（${outgoing.length}）`),
                  h(
                    'div',
                    { className: 'sd-link-list' },
                    outgoing.map((link) =>
                      h('div', { key: link.id, className: 'sd-link-row', onClick: () => onSelect(link.id) },
                        h('i', { style: { background: LINK_META[link.type].color } }),
                        LINK_META[link.type].label,
                        h('span', { style: { marginLeft: 'auto', opacity: 0.7 } }, link.to),
                      ),
                    ),
                  ),
                )
              : null,
            h(
              'div',
              { className: 'sd-actions' },
              h('button', { className: 'sd-action', onClick: onNewNote }, h(Icon, { name: 'note' }), '挂个便签'),
              foreign ? null : h('button', { className: 'sd-action', onClick: onNewDomain }, h(Icon, { name: 'domain' }), '建子域'),
              foreign ? null : h('button', { className: 'sd-action', onClick: onLink }, h(Icon, { name: 'link' }), '连线（按 L 再点目标）'),
              foreign ? null : h('button', { className: 'sd-action', title: '把这个域拆成几个计划块（一行一个路径/标题）', 'data-action': 'split-planned', onClick: () => onOpenSplit(item.id) }, '拆计划块'),
              domainViewId === item.id
                ? h('button', { className: 'sd-action', 'data-action': 'exit-domain-view', onClick: onExitDomainView }, '退出域内视图（Esc）')
                : h('button', { className: 'sd-action', 'data-action': 'enter-domain-view', onClick: () => onEnterDomainView(item.id) }, '进入域内视图'),
              foreign ? null : h('button', { className: 'sd-action danger', onClick: onRemove }, '删除'),
            ),
          ),
        )
      }

      if (entry.kind === 'block') {
        const covers = board.links.filter((l) => l.type === 'covers' && l.to === item.id).map((l) => board.domains.find((d) => d.id === l.from)).filter(Boolean)
        const realBlocks = board.blocks.filter((b) => !b.planned && b.id !== item.id)
        const layer = layerOf(item)
        const guard = guardInfoOf(entry)
        const foreign = guard.readonly
        return h(
          'div',
          { className: 'sd-insp' },
          h(
            'div',
            { className: 'sd-insp-scroll' },
            h(
              'div',
              { className: 'sd-insp-head' },
              h('span', { className: 'sd-author ' + item.author }, AUTHOR_META[item.author].mark),
              item.planned ? '计划块 ' : '块 ',
              h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, item.id),
              h(
                'span',
                { className: 'sd-layer-tag', 'data-layer': layer, style: { marginLeft: 'auto', color: LAYER_META[layer].color } },
                `${LAYER_META[layer].label} 层${foreign ? ' · 只读' : ''}`,
              ),
            ),
            foreign
              ? h(
                  'div',
                  { className: 'sd-readonly', 'data-role': 'readonly' },
                  h('b', null, `这是 ${LAYER_META[layer].label} 层的说法，只读`),
                  h('div', { className: 'sd-hint' }, '默认只动自己层；跨层不是覆盖，而是提案——在你层新建一条说法，用 relates／contradicts 指向它。'),
                  h(
                    'button',
                    {
                      className: 'sd-action',
                      'data-action': 'propose',
                      onClick: () => onPropose({ targetId: item.id, targetTitle: item.address, targetKind: 'block' }),
                    },
                    '提一份我的说法',
                  ),
                )
              : null,
            h(Field, { label: '地址', value: item.address, readOnly: foreign, onCommit: (value) => onUpdate(item.id, { path: value.split(':')[0], symbol: value.includes(':') ? value.split(':').slice(1).join(':') : null }) }),
            h(
              'div',
              { className: 'sd-kv' },
              h('span', null, item.kind),
              item.lang ? h('span', null, `· ${item.lang}`) : null,
              item.bytes ? h('span', null, `· ${(item.bytes / 1024).toFixed(1)} KB`) : null,
              item.sha ? h('span', null, `· ${item.sha}`) : null,
            ),
            h(Field, { label: '批注', value: item.note, multiline: true, readOnly: foreign, placeholder: '这块是干什么的／为什么先不动', onCommit: (value) => onUpdate(item.id, { note: value }) }),
            item.planned
              ? h(
                  'div',
                  { className: 'sd-field' },
                  h('label', null, '落地为'),
                  h(
                    'select',
                    { value: item.ground || '', disabled: foreign, onChange: (event) => onUpdate(item.id, { ground: event.target.value || null }) },
                    h('option', { value: '' }, '（还没落地）'),
                    realBlocks.map((block) => h('option', { key: block.id, value: block.id }, block.address)),
                  ),
                )
              : null,
            h(
              'div',
              { className: 'sd-box' },
              h('h4', null, `被这些域盖住（${covers.length}）`),
              covers.length
                ? h(
                    'div',
                    { className: 'sd-link-list' },
                    covers.map((domain) =>
                      h('div', { key: domain.id, className: 'sd-link-row', onClick: () => onSelect(domain.id) },
                        h('span', { className: 'sd-dot ' + domain.status }),
                        h('span', null, domain.title),
                      ),
                    ),
                  )
                : h('div', { className: 'sd-hint' }, item.planned ? '计划块还没计划归属' : '还没人管它——这是一条「未标注」'),
            ),
            h(
              'div',
              { className: 'sd-actions' },
              foreign ? null : h('button', { className: 'sd-action', onClick: onNewDomain }, h(Icon, { name: 'domain' }), '建域盖住它'),
              h('button', { className: 'sd-action', onClick: onNewNote }, h(Icon, { name: 'note' }), '挂便签'),
              foreign ? null : h('button', { className: 'sd-action danger', onClick: onRemove }, '删除'),
            ),
          ),
        )
      }

      if (entry.kind === 'note') {
        return h(
          'div',
          { className: 'sd-insp' },
          h(
            'div',
            { className: 'sd-insp-scroll' },
            h('div', { className: 'sd-insp-head' }, '便签 ', h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, item.id)),
            h(Field, { label: '内容', value: item.text, multiline: true, onCommit: (value) => onUpdate(item.id, { text: value }) }),
            h(
              'div',
              { className: 'sd-field' },
              h('label', null, '挂住'),
              h(
                'select',
                { value: item.ref || '', onChange: (event) => onUpdate(item.id, { ref: event.target.value || null }) },
                h('option', { value: '' }, '（自由便签）'),
                [...board.domains.map((d) => ({ id: d.id, label: `域 · ${d.title}` })), ...board.blocks.map((b) => ({ id: b.id, label: `块 · ${b.address}` }))].map((option) =>
                  h('option', { key: option.id, value: option.id }, option.label),
                ),
              ),
            ),
            h('div', { className: 'sd-hint' }, '便签不参与连线：用上面的「挂住」把它挂到某个域或块上。'),
            h('div', { className: 'sd-actions' }, h('button', { className: 'sd-action danger', onClick: onRemove }, '删除便签')),
          ),
        )
      }

      // 连接
      const fromItem = [...board.domains, ...board.blocks].find((x) => x.id === item.from)
      const toItem = [...board.domains, ...board.blocks].find((x) => x.id === item.to)
      return h(
        'div',
        { className: 'sd-insp' },
        h(
          'div',
          { className: 'sd-insp-scroll' },
          h('div', { className: 'sd-insp-head' }, '连接 ', h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, item.id)),
          h(
            'div',
            { className: 'sd-box' },
            h('div', { className: 'sd-link-row', onClick: () => onSelect(item.from) },
              h('i', { style: { background: LINK_META[item.type].color } }),
              h('span', null, fromItem ? fromItem.title || fromItem.address : item.from),
            ),
            h('div', { className: 'sd-hint', style: { paddingLeft: 20 } }, `↓ ${LINK_META[item.type].label}`),
            h('div', { className: 'sd-link-row', onClick: () => onSelect(item.to) },
              h('i', { style: { background: LINK_META[item.type].color } }),
              h('span', null, toItem ? toItem.title || toItem.address : item.to),
            ),
          ),
          h(
            'div',
            { className: 'sd-field' },
            h('label', null, '类型'),
            h(
              'select',
              { value: item.type, onChange: (event) => onUpdate(item.id, { type: event.target.value }) },
              LINK_ORDER.map((type) => h('option', { key: type, value: type }, `${LINK_META[type].label}（${type}）`)),
            ),
          ),
          h(Field, { label: '批注', value: item.note, multiline: true, placeholder: '为什么这样连', onCommit: (value) => onUpdate(item.id, { note: value }) }),
          h('div', { className: 'sd-actions' }, h('button', { className: 'sd-action danger', onClick: onRemove }, '删除连接')),
        ),
      )
    }

    function Field({ label, value, onCommit, multiline, placeholder, readOnly, field }) {
      const [text, setText] = useState(value || '')
      useEffect(() => {
        setText(value || '')
      }, [value])
      const commit = () => {
        if (readOnly) return
        if (text !== (value || '')) onCommit(text)
      }
      return h(
        'div',
        { className: 'sd-field', 'data-field': field },
        h('label', null, label),
        multiline
          ? h('textarea', {
              value: text,
              placeholder,
              readOnly: Boolean(readOnly),
              onChange: (event) => setText(event.target.value),
              onBlur: commit,
              rows: 2,
            })
          : h('input', {
              value: text,
              placeholder,
              readOnly: Boolean(readOnly),
              onChange: (event) => setText(event.target.value),
              onBlur: commit,
              onKeyDown: (event) => {
                if (event.key === 'Enter') event.target.blur()
              },
            }),
      )
    }

    // ── 连线类型菜单 ──────────────────────────────────────────────
    function LinkMenu({ menu, setMenu, makeLink, kinds }) {
      const style = { left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 320) }
      const fromKind = kinds ? kinds.get(menu.from) : null
      const toKind = kinds ? kinds.get(menu.to) : null
      // 只列这一对端点真正合法的类型（宿主 core.js 的 LINK_TYPES 是最终权威，这里只是不让人白点）
      const types = LINK_ORDER.filter((type) => {
        const ends = LINK_ENDS[type]
        return ends && ends.from.includes(fromKind) && ends.to.includes(toKind)
      })
      return h(
        'div',
        { className: 'sd-menu', style },
        h('div', { className: 'sd-hint', style: { padding: '2px 8px 4px' } }, types.length ? '连哪种？' : `${KIND_LABEL[fromKind] || fromKind} → ${KIND_LABEL[toKind] || toKind}：没有合适的类型`),
        types.map((type) =>
          h(
            'button',
            {
              key: type,
              onClick: () => {
                setMenu(null)
                makeLink(menu.from, menu.to, type)
              },
            },
            h('i', { style: { background: LINK_META[type].color } }),
            LINK_META[type].label,
            h('small', null, type),
          ),
        ),
      )
    }

    // ── 弹层 ──────────────────────────────────────────────────────
    function Modal({ modal, setModal, desk, board, store, selection, setSelection, makeLink, onSplitPlanned, onPropose, onEnterDomainView }) {
      const [brief, setBrief] = useState(null)
      useEffect(() => {
        if (modal.type === 'brief' && brief === null) {
          desk.readBrief().then((data) => setBrief(data))
        }
      }, [modal.type, brief, desk])
      // v1.16：拆计划块 / 提一份我的说法 的表单草稿（按弹层目标重置）
      const [draft, setDraft] = useState({ title: '', statement: '', relation: 'relates', lines: '' })
      useEffect(() => {
        if (modal.type === 'propose') {
          setDraft({ title: `关于：${modal.targetTitle || modal.targetId || ''}`, statement: '', relation: 'relates', lines: '' })
        } else if (modal.type === 'split') {
          setDraft({ title: '', statement: '', relation: 'relates', lines: '' })
        }
      }, [modal.type, modal.targetId, modal.domainId])
      const close = () => setModal(null)
      let title = ''
      let body = null
      let footer = null
      if (modal.type === 'project') {
        title = '项目'
        body = h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          h('div', { className: 'sd-hint' }, `当前：${store.project.path}`),
          h('div', { className: 'sd-hint' }, `板子住在：${store.project.path}\\结构蓝图\\`),
          h(
            'div',
            { className: 'sd-actions' },
            h('button', { className: 'sd-action', onClick: () => desk.pickDirectory() }, h(Icon, { name: 'folder' }), '打开另一个目录'),
            h('button', { className: 'sd-action', onClick: () => { close(); desk.boot() } }, h(Icon, { name: 'refresh' }), '重扫最近'),
          ),
          store.recent && store.recent.length
            ? h(
                'div',
                { className: 'sd-link-list' },
                store.recent.map((item) =>
                  h(
                    'div',
                    {
                      key: item.path,
                      className: 'sd-link-row',
                      style: { padding: '6px 8px' },
                      onClick: async () => {
                        close()
                        await desk.openProject(item.path)
                      },
                    },
                    h('b', { style: { fontWeight: 500 } }, item.name || item.path),
                    h('span', { style: { marginLeft: 'auto', opacity: 0.6, fontSize: 10 } }, (item.updatedAt || '').slice(0, 10)),
                  ),
                ),
              )
            : null,
        )
      } else if (modal.type === 'brief') {
        title = '给智能体的一页简报'
        body = brief
          ? h('pre', null, brief.markdown)
          : h('div', { className: 'sd-hint' }, '正在生成…')
        footer = h(
          React.Fragment,
          null,
          h(
            'button',
            {
              className: 'sd-action',
              onClick: async () => {
                try {
                  await navigator.clipboard.writeText(brief ? brief.markdown : '')
                  desk.say('简报已复制')
                } catch {
                  desk.say('复制失败，请手动选', 'error')
                }
              },
            },
            '复制',
          ),
          h('button', { className: 'sd-action', onClick: () => desk.exportFiles() }, '写进项目'),
        )
      } else if (modal.type === 'split') {
        title = '拆计划块'
        const domain = board && board.domains.find((item) => item.id === modal.domainId)
        const splitLines = String(draft.lines || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
        body = h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          h('div', { className: 'sd-modal-note' }, `从域「${(domain && domain.title) || modal.domainId}」拆计划块：一行一个（路径或标题）。会批量加 planned 块，并自动连「计划」（plans）到该域。`),
          h(
            'div',
            { className: 'sd-field' },
            h('label', null, `计划块（一行一个，已填 ${splitLines.length} 行）`),
            h('textarea', {
              rows: 8,
              'data-field': 'planned-lines',
              value: draft.lines,
              placeholder: '例：\nsrc/auth/login.js\nsrc/auth/rate-limit.js\n登录限流单测',
              onChange: (event) => setDraft((cur) => ({ ...cur, lines: event.target.value })),
            }),
          ),
        )
        footer = h(
          React.Fragment,
          null,
          h('button', { className: 'sd-action', onClick: close }, '取消'),
          h(
            'button',
            {
              className: 'sd-action',
              'data-action': 'split-submit',
              disabled: !splitLines.length,
              onClick: () => {
                if (!splitLines.length) {
                  desk.say('一行写一个计划块（路径或标题）', 'error')
                  return
                }
                close()
                onSplitPlanned(modal.domainId, draft.lines)
              },
            },
            `拆出 ${splitLines.length} 个计划块`,
          ),
        )
      } else if (modal.type === 'propose') {
        title = '提一份我的说法'
        const target = modal.targetId && board ? [...board.domains, ...board.blocks].find((item) => item.id === modal.targetId) : null
        const targetLayer = target ? layerOf(target) : 'agent'
        body = h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          h('div', { className: 'sd-modal-note' }, `目标 ${modal.targetId}「${modal.targetTitle || ''}」在 ${LAYER_META[targetLayer] ? LAYER_META[targetLayer].label : targetLayer} 层。提案只是在你层新建一条说法，再用 relates／contradicts 指向它；原说法不会被改写。`),
          h(
            'div',
            { className: 'sd-field' },
            h('label', null, '标题'),
            h('input', { value: draft.title, 'data-field': 'title', placeholder: '起个标题', onChange: (event) => setDraft((cur) => ({ ...cur, title: event.target.value })) }),
          ),
          h(
            'div',
            { className: 'sd-field' },
            h('label', null, '你的说法（负责什么／你怎么看）'),
            h('textarea', {
              rows: 4,
              'data-field': 'statement',
              value: draft.statement,
              placeholder: '一句话说清你的说法；你之后正常编辑自己的说法，就视为采纳／合并',
              onChange: (event) => setDraft((cur) => ({ ...cur, statement: event.target.value })),
            }),
          ),
          h(
            'div',
            { className: 'sd-field' },
            h('label', null, '关系'),
            h(
              'div',
              { className: 'sd-seg' },
              h('button', { 'data-on': draft.relation === 'relates', 'data-relation': 'relates', onClick: () => setDraft((cur) => ({ ...cur, relation: 'relates' })) }, '关联 relates'),
              h('button', { 'data-on': draft.relation === 'contradicts', 'data-relation': 'contradicts', onClick: () => setDraft((cur) => ({ ...cur, relation: 'contradicts' })) }, '矛盾 contradicts'),
            ),
          ),
        )
        footer = h(
          React.Fragment,
          null,
          h('button', { className: 'sd-action', onClick: close }, '取消'),
          h(
            'button',
            {
              className: 'sd-action',
              'data-action': 'propose-submit',
              onClick: () => {
                const cleanTitle = String(draft.title || '').trim()
                if (!cleanTitle) {
                  desk.say('给这条说法起个标题', 'error')
                  return
                }
                close()
                onPropose({ targetId: modal.targetId, title: cleanTitle, statement: draft.statement, relation: draft.relation })
              },
            },
            '提这份说法',
          ),
        )
      } else if (modal.type === 'help') {
        title = '快捷键与词汇'
        body = h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
          h(
            'div',
            { className: 'sd-box' },
            h('h4', null, '三个基本件'),
            h('div', { className: 'sd-hint' }, '域：说的（概念／说法）。块：有的（文件／计划块）。连接：怎么相关（只在域/块之间）。便签不参与连线，用「挂住」挂到任一件上；落差是算出来的，不是填出来的。'),
          ),
          h(
            'div',
            { className: 'sd-box' },
            h('h4', null, '八种连接'),
            h(
              'div',
              { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 } },
              LINK_ORDER.map((type) =>
                h('div', { key: type, className: 'sd-kv' }, h('i', { style: { background: LINK_META[type].color, width: 12, height: 2, alignSelf: 'center', borderRadius: 1 } }), h('span', null, `${LINK_META[type].label} ${type}`)),
              ),
            ),
          ),
          h(
            'div',
            { className: 'sd-box' },
            h('h4', null, '看见关系'),
            h('div', { className: 'sd-hint' }, '悬停一个件：亮起它连出去的线并标出类型；点底栏的类型图例：只看这一型连接、其余淡出（再点或 Esc 取消）；左栏落差或域里点一条：1 跳聚焦，邻域亮、其余淡出（点空白或 Esc 退出）；搜索也认「矛盾」「依赖」等连接类型。'),
          ),
          h(
            'div',
            { className: 'sd-box' },
            h('h4', null, '看见改动'),
            h('div', { className: 'sd-hint' }, '一次写板在底部时间轴留一颗珠（+ 新增 / ~ 变化 / − 删除，拖动/滚轮翻，点珠＝这一批切片：改到的件亮、其余淡出）。自上次「标记已读」之后的改动在件右上角挂角标（新/改/删；有「矛盾」连接挂 !），每件最多 3 个。顶栏「变更」或时间轴「变更」打开抽屉：按 域/块/连接/便签 分组，点行定位该件，⧉ 复制证据。「撤销最近一批」把板子和坐标退回那批动手之前（回滚本身也记一批，可再退）。'),
          ),
          h(
            'div',
            { className: 'sd-box' },
            h('h4', null, '桌边消息'),
            h('div', { className: 'sd-hint' }, '底部消息条：选中件自动成 chips，写一句话 Ctrl+Enter 发到当前 DSH 会话（不离开面板）；/ 开头是本地指令（/scan /fit /export /focus /filter /help），不认识的指令原样转发。回执：已收到 → 回主界面看回复；没发出去会把会话错误码贴出来。'),
          ),
          h(
            'div',
            { className: 'sd-box' },
            h('h4', null, '计划与图层（v1.16）'),
            h('div', { className: 'sd-hint' }, '层板：左栏「落差」下面的三行。层＝说法归属（人／agent／程序），眼睛决定这一层画不画；隐藏层的节点、边、包络都不画，搜索/聚焦/切片也拉不回来；当前编辑层固定为人，agent 只从工具写。'),
            h('div', { className: 'sd-hint' }, '计划视图：落差旁边的 tab，三组「空承诺／未落地／未标注」，组头带每层计数；点一条＝画布定位并 1 跳聚焦，是每天开工的清单。'),
            h('div', { className: 'sd-hint' }, '完成判据：域检视器里的一条可检验的话（什么算这个域落地），空着＝还没定。'),
            h('div', { className: 'sd-hint' }, '拆计划块：域检视器按钮，一行一个计划块（路径/标题），会批量建 planned 块并连 plans 到该域。'),
            h('div', { className: 'sd-hint' }, '落地建议：扫描出新增实块后，画布上方出建议条「B10 ← 可能落地 B9」，点「落地」写 grounds，「忽略」只在本页记。'),
            h('div', { className: 'sd-hint' }, '跨层提案：选中 agent 层的域/计划块时检视器只读，点「提一份我的说法」在你层新建一条说法，用 relates／contradicts 指过去——不改写原文。'),
            h('div', { className: 'sd-hint' }, '域内视图：域检视器或域树「⋯」里「进入域内视图」；只画该域覆盖的块 + 直接子域 + plans 计划块，跨边界连接收成输入/输出桩；Esc 退出。可与层显隐叠加。'),
          ),
          h(
            'div',
            { className: 'sd-box' },
            h('h4', null, '快捷键'),
            h(
              'div',
              { style: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 10px', fontSize: 11.5 } },
              [['D', '建域（选中块＝直接盖住）'], ['B', '画计划块'], ['N', '便签'], ['L', '连线'], ['V', '选择'], ['Delete', '删除所选'], ['Ctrl+Z / Ctrl+Shift+Z', '撤销／重做'], ['/', '搜索'], ['Ctrl+Enter', '桌边消息条里发送'], ['F', '适应视口'], ['0', '复位缩放'], ['Ctrl+S', '导出两页 md'], ['?', '本页'], ['Esc', '取消']].map(([key, label]) =>
                h('div', { key, style: { display: 'contents' } }, h('span', { className: 'sd-kbd' }, key), h('span', null, label)),
              ),
            ),
          ),
          h('div', { className: 'sd-hint' }, '板子文件：项目/结构蓝图/board.json（事实源）· layout.json（可删）· journal.jsonl（只追加，每条带批次）· history/（最近 50 批快照，回滚用）· 简报.md / 域录.md（导出）。'),
        )
      }
      return h(
        'div',
        { className: 'sd-overlay', onPointerDown: (event) => event.target === event.currentTarget && close() },
        h(
          'div',
          { className: 'sd-modal', 'data-modal': modal.type },
          h('header', null, title, h('div', { style: { flex: 1 } }), h('button', { className: 'sd-btn', onClick: close }, h(Icon, { name: 'close' }))),
          h('div', { className: 'body' }, body),
          footer ? h('footer', null, footer) : null,
        ),
      )
    }

    // ── 出口 ──────────────────────────────────────────────────────
    function apply(ctx) {
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 7, label: () => LABEL }, Glyph),
      )
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, () => h(Panel, { ctx })))
    }

    return { inject: ['slots'], apply }
  },
})
