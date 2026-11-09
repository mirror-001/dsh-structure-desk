// 结构台 · 两页 Markdown（纯函数，不碰盘、不 import 包外文件）
// 简报：给智能体读的一页，结论优先，≤200 行；域录：给人读的域／块／连接全录。
// 数据形状见《设计·结构台》§三 §五；stats/gaps 由宿主 core.js 的 derived(board) 算好传来，缺键就自己补。

const FORMAT = 'structure-desk/1'

/** 连接类型与中文名（契约表里是八条；文档标题写「九型」，按实际类型表来）。 */
const LINK_TYPES = [
  { type: 'covers', zh: '覆盖' },
  { type: 'refines', zh: '细化' },
  { type: 'contradicts', zh: '矛盾' },
  { type: 'depends', zh: '依赖' },
  { type: 'calls', zh: '调用' },
  { type: 'plans', zh: '计划' },
  { type: 'grounds', zh: '落地' },
  { type: 'relates', zh: '关联' },
]

const LINK_ZH = new Map(LINK_TYPES.map((item) => [item.type, item.zh]))

// ── 两种语言的文案 ─────────────────────────────────────────────────

const TEXT = {
  zh: {
    briefBrand: '结构台简报',
    registerBrand: '域录',
    generated: (iso) => `生成于 ${iso} · format ${FORMAT}`,
    registerUpdated: (iso) => `板子更新于 ${iso} · format ${FORMAT}`,
    glance: '## 先看',
    glanceReal: (real, covered, unannotated) =>
      `实块 ${real} 个：${covered} 个已被说法覆盖，${unannotated} 个还没人管。`,
    glanceDomain: (domains, ungrounded) =>
      `域 ${domains} 个：${ungrounded} 个是空承诺（只有说法，没有块也没有子域）。`,
    glancePlan: (plan, open) => `计划块 ${plan} 个：${open} 个还没落地。`,
    glanceRest: (conflicts, stale) => `矛盾 ${conflicts} 处；失联 ${stale} 块。`,
    scaleHead: '## 规模',
    scale: (s) =>
      `域 ${s.domains} · 块 ${s.blocks}（实 ${s.realBlocks}／计划 ${s.planBlocks}）· 连接 ${s.links} · 笔记 ${s.notes} · 覆盖 ${s.covered}/${s.realBlocks} · 体积 ${s.bytesText} · 失联 ${s.stale}`,
    gapsHead: '## 落差',
    gapNames: { unannotated: '未标注', ungrounded: '空承诺', planOpen: '未落地', conflicts: '矛盾' },
    gapNone: '无。',
    gapMore: (n) => `…其余 ${n} 条见域录。`,
    ungroundedMark: '（空承诺）',
    treeHead: '## 域树',
    noDomains: '还没有域。',
    uncoveredHead: (shown, total) => (total > shown ? `## 未覆盖块（${shown}/${total}）` : `## 未覆盖块（${total}）`),
    uncoveredNone: '所有实块都已有说法覆盖。',
    linkHead: '## 连接统计',
    linkTotal: (n) => `共 ${n} 条连接。`,
    clipped: (max) => `> 已截断到 ${max} 行；完整内容见域录。`,
    footer: '未覆盖是一等状态，不是错误。落差只陈述事实，不给分数与建议。',
    untitled: '（未命名）',
    none: '—',
    domainsHead: '## 域',
    blocksHead: '## 块录',
    linksHead: '## 连接录',
    notesHead: '## 笔记',
    statement: '说法',
    criteria: '判据',
    children: '子域',
    covers: '覆盖块',
    outLinks: '出边',
    tags: '标签',
    note: '批注',
    emptyPromise: '空承诺：没有覆盖块、没有子域、没有计划',
    tblBlock: ['id', '地址', '语言', '字节', '状态', '归属域'],
    tblLink: ['id', '从', '到', '类型', '备注'],
    status: { solid: '实', thin: '薄', rift: '裂', open: '空' },
    state: { real: '实', plan: '计划', stale: '失联', planStale: '计划·失联' },
    author: { human: '人', agent: '智能体', program: '程序' },
    listSep: '、',
    sentenceSep: '；',
    arrow: '↔',
  },
  en: {
    briefBrand: 'Structure Desk brief',
    registerBrand: 'register',
    generated: (iso) => `Generated ${iso} · format ${FORMAT}`,
    registerUpdated: (iso) => `Board updated ${iso} · format ${FORMAT}`,
    glance: '## At a glance',
    glanceReal: (real, covered, unannotated) =>
      `${real} real blocks: ${covered} covered by a statement, ${unannotated} unannotated.`,
    glanceDomain: (domains, ungrounded) =>
      `${domains} domains: ${ungrounded} empty promises (a statement with no blocks, child domains, or plans).`,
    glancePlan: (plan, open) => `${plan} plan blocks: ${open} not grounded yet.`,
    glanceRest: (conflicts, stale) => `${conflicts} conflicts; ${stale} stale blocks.`,
    scaleHead: '## Scale',
    scale: (s) =>
      `domains ${s.domains} · blocks ${s.blocks} (real ${s.realBlocks} / plan ${s.planBlocks}) · links ${s.links} · notes ${s.notes} · covered ${s.covered}/${s.realBlocks} · bytes ${s.bytesText} · stale ${s.stale}`,
    gapsHead: '## Gaps',
    gapNames: {
      unannotated: 'Unannotated',
      ungrounded: 'Empty promise',
      planOpen: 'Plan open',
      conflicts: 'Conflicts',
    },
    gapNone: 'None.',
    gapMore: (n) => `… ${n} more in the register.`,
    ungroundedMark: ' (empty promise)',
    treeHead: '## Domain tree',
    noDomains: 'No domains yet.',
    uncoveredHead: (shown, total) => (total > shown ? `## Uncovered blocks (${shown}/${total})` : `## Uncovered blocks (${total})`),
    uncoveredNone: 'Every real block has a covering statement.',
    linkHead: '## Link types',
    linkTotal: (n) => `${n} links.`,
    clipped: (max) => `> Truncated to ${max} lines; see the register for the full record.`,
    footer: 'Unannotated is a first-class state, not an error. Gaps only state facts; no scores, no advice.',
    untitled: '(untitled)',
    none: '—',
    domainsHead: '## Domains',
    blocksHead: '## Blocks',
    linksHead: '## Links',
    notesHead: '## Notes',
    statement: 'Statement',
    criteria: 'Criteria',
    children: 'Children',
    covers: 'Covered blocks',
    outLinks: 'Outgoing links',
    tags: 'Tags',
    note: 'Note',
    emptyPromise: 'Empty promise: no covered blocks, no child domains, no plans',
    tblBlock: ['id', 'Address', 'Lang', 'Bytes', 'State', 'Domains'],
    tblLink: ['id', 'From', 'To', 'Type', 'Note'],
    status: { solid: 'solid', thin: 'thin', rift: 'rift', open: 'open' },
    state: { real: 'real', plan: 'plan', stale: 'stale', planStale: 'plan · stale' },
    author: { human: 'human', agent: 'agent', program: 'program' },
    listSep: ', ',
    sentenceSep: '; ',
    arrow: '↔',
  },
}

/** 语言选择：zh 为默认，其余当英文。 */
function localeOf(locale) {
  return String(locale || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh'
}

// ── 小工具 ─────────────────────────────────────────────────────────

const arr = (value) => (Array.isArray(value) ? value : [])

/** 有限整数，带下限与兜底。 */
function intOpt(value, fallback, min) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.floor(n))
}

/** 板子四件套，缺就当空数组。 */
function partsOf(board) {
  const b = board && typeof board === 'object' ? board : {}
  return { domains: arr(b.domains), blocks: arr(b.blocks), links: arr(b.links), notes: arr(b.notes) }
}

/** 人读地址。 */
function addrOf(block) {
  if (!block || typeof block !== 'object') return ''
  if (typeof block.address === 'string' && block.address) return block.address
  if (typeof block.path === 'string' && block.path) {
    return block.symbol ? `${block.path}:${block.symbol}` : block.path
  }
  return typeof block.id === 'string' ? block.id : ''
}

/** 表格单元：压成一行、转义竖线、超长截断。 */
function cell(value, max = 160) {
  const text = String(value ?? '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim()
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1))}…`
}

/** 反引号代码单元（路径用）：同样转义竖线，去掉反引号本身。 */
function codeCell(value, max = 120) {
  const text = String(value ?? '').replace(/`/g, "'").replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
  const cut = text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`
  return `\`${cut}\``
}

/** 字节数变人话。 */
function fmtBytes(n) {
  if (n === null || n === undefined || n === '') return TEXT.zh.none
  const num = Number(n)
  if (!Number.isFinite(num) || num < 0) return TEXT.zh.none
  if (num < 1024) return `${Math.round(num)} B`
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`
  return `${(num / (1024 * 1024)).toFixed(1)} MB`
}

/** 时间戳：opts.now 可传字符串/Date/毫秒，测试用；缺省取当前时刻。 */
function nowText(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? new Date().toISOString() : value.toISOString()
  if (typeof value === 'string' && value) return value
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString()
  return new Date().toISOString()
}

/** 域/块引用的人读名。 */
function refName(id, byDomain, byBlock) {
  if (byDomain.has(id)) {
    const d = byDomain.get(id)
    return `${d.id} ${d.title || ''}`.trim()
  }
  if (byBlock.has(id)) {
    const b = byBlock.get(id)
    return `${b.id} ${addrOf(b)}`.trim()
  }
  return String(id ?? '')
}

// ── 落差与规模：stats / gaps 缺多少自己补多少 ─────────────────────

/** 从板子补算四落差 + 失联。gaps 里已有的数组优先。 */
function resolveGaps(board, gaps) {
  const { domains, blocks, links } = partsOf(board)
  const coversFrom = new Set()
  const coversTo = new Set()
  const plansFrom = new Set()
  const groundsTo = new Set()
  const conflicts = []
  for (const link of links) {
    if (!link || typeof link.type !== 'string') continue
    if (link.type === 'covers') {
      coversFrom.add(link.from)
      coversTo.add(link.to)
    } else if (link.type === 'plans') {
      plansFrom.add(link.from)
    } else if (link.type === 'grounds') {
      groundsTo.add(link.to)
    } else if (link.type === 'contradicts') {
      conflicts.push(link.id)
    }
  }
  const real = blocks.filter((b) => !b.planned)
  const planned = blocks.filter((b) => b.planned)
  const computed = {
    unannotated: real.filter((b) => !coversTo.has(b.id)).map((b) => b.id),
    ungrounded: domains
      .filter((d) => !coversFrom.has(d.id) && !domains.some((child) => child.parent === d.id) && !plansFrom.has(d.id))
      .map((d) => d.id),
    planOpen: planned.filter((b) => !groundsTo.has(b.id) && !b.ground).map((b) => b.id),
    conflicts,
    stale: blocks.filter((b) => b.stale).map((b) => b.id),
  }
  const given = gaps && typeof gaps === 'object' ? gaps : {}
  const out = {}
  for (const key of Object.keys(computed)) {
    out[key] = Array.isArray(given[key]) ? given[key] : computed[key]
  }
  return out
}

/** 规模：stats 里的数字优先，缺了就从板子算。 */
function resolveStats(board, gapsResolved, stats) {
  const { domains, blocks, links, notes } = partsOf(board)
  const real = blocks.filter((b) => !b.planned)
  const planned = blocks.filter((b) => b.planned)
  const byType = {}
  for (const link of links) {
    if (!link || typeof link.type !== 'string') continue
    byType[link.type] = (byType[link.type] || 0) + 1
  }
  const s = stats && typeof stats === 'object' ? stats : {}
  const num = (key, fallback) => (typeof s[key] === 'number' && Number.isFinite(s[key]) ? s[key] : fallback)
  const result = {
    domains: num('domains', domains.length),
    blocks: num('blocks', blocks.length),
    realBlocks: num('realBlocks', real.length),
    planBlocks: num('planBlocks', planned.length),
    links: num('links', links.length),
    notes: num('notes', notes.length),
    covered: num('covered', real.length - gapsResolved.unannotated.length),
    unannotated: num('unannotated', gapsResolved.unannotated.length),
    ungrounded: num('ungrounded', gapsResolved.ungrounded.length),
    planOpen: num('planOpen', gapsResolved.planOpen.length),
    conflicts: num('conflicts', gapsResolved.conflicts.length),
    stale: num('stale', gapsResolved.stale.length),
    bytes: num('bytes', real.reduce((sum, b) => sum + (Number(b.bytes) || 0), 0)),
    byType: s.byType && typeof s.byType === 'object' ? { ...byType, ...s.byType } : byType,
  }
  result.bytesText = fmtBytes(result.bytes)
  return result
}

/** 域树（防环）：返回每行一个根到叶的有序列表。 */
function treeRows(board, t, ungroundedIds) {
  const { domains } = partsOf(board)
  const byId = new Map(domains.filter((d) => d && d.id).map((d) => [d.id, d]))
  const kids = new Map()
  for (const d of domains) {
    if (!d || !d.id) continue
    const parent = d.parent && byId.has(d.parent) ? d.parent : null
    if (!kids.has(parent)) kids.set(parent, [])
    kids.get(parent).push(d)
  }
  const rows = []
  const seen = new Set()
  const walk = (parent, depth) => {
    for (const d of kids.get(parent) || []) {
      if (seen.has(d.id)) continue // 环保护
      seen.add(d.id)
      const status = d.status ? ` · ${d.status}` : ''
      const mark = ungroundedIds.has(d.id) ? t.ungroundedMark : ''
      rows.push(`${'  '.repeat(depth)}- ${d.id} ${d.title || t.untitled}${status}${mark}`)
      walk(d.id, depth + 1)
    }
  }
  walk(null, 0)
  // 落在环里的域也列出来，不能悄悄丢
  for (const d of domains) {
    if (!d || !d.id || seen.has(d.id)) continue
    rows.push(`- ${d.id} ${d.title || t.untitled}`)
  }
  return rows
}

/** 连接统计一行。 */
function linkStatLine(t, byType) {
  const known = new Set(LINK_TYPES.map((item) => item.type))
  const parts = LINK_TYPES.map(({ type, zh }) => {
    const count = byType[type] || 0
    const label = t === TEXT.zh ? zh : type
    return `${type} ${label} ${count}`
  })
  for (const [type, count] of Object.entries(byType)) {
    if (known.has(type)) continue
    parts.push(`${type} ${count}`) // 契约外的新类型也照实报
  }
  const total = Object.values(byType).reduce((sum, n) => sum + (Number(n) || 0), 0)
  return `${t.linkTotal(total)} ${parts.join(' · ')}`
}

// ── 对外：简报 ────────────────────────────────────────────────────

/**
 * 给智能体读的一页 Markdown。纯函数。
 *
 * @param {object} board 板子（§3.1）
 * @param {object} [gaps] {unannotated, ungrounded, planOpen, conflicts, stale?}（id 数组）
 * @param {object} [stats] derived(board).stats；缺键自动补
 * @param {object} [opts] {maxLines=200, locale='zh', now?, topUncovered=12, maxPerGap=12}
 * @returns {string}
 */
export function buildBrief(board, gaps, stats, opts = {}) {
  const options = opts && typeof opts === 'object' ? opts : {}
  const t = TEXT[localeOf(options.locale)]
  const maxLines = intOpt(options.maxLines, 200, 1)
  const topUncovered = intOpt(options.topUncovered, 12, 1)
  const maxPerGap = intOpt(options.maxPerGap, 12, 1)

  const { domains, blocks, links } = partsOf(board)
  const g = resolveGaps(board, gaps)
  const s = resolveStats(board, g, stats)
  const byDomain = new Map(domains.filter((d) => d && d.id).map((d) => [d.id, d]))
  const byBlock = new Map(blocks.filter((b) => b && b.id).map((b) => [b.id, b]))
  const byLink = new Map(links.filter((l) => l && l.id).map((l) => [l.id, l]))
  const projectName = board?.project?.name || board?.title || 'project'
  const lines = []

  // 标题 + 时刻
  lines.push(`# ${t.briefBrand} · ${projectName}`)
  lines.push('')
  lines.push(`> ${t.generated(nowText(options.now))}`)
  lines.push('')

  // 先看：结论放最前
  lines.push(t.glance)
  lines.push('')
  lines.push(`- ${t.glanceReal(s.realBlocks, s.covered, s.unannotated)}`)
  lines.push(`- ${t.glanceDomain(s.domains, s.ungrounded)}`)
  lines.push(`- ${t.glancePlan(s.planBlocks, s.planOpen)}`)
  lines.push(`- ${t.glanceRest(s.conflicts, s.stale)}`)
  lines.push('')

  // 规模一行
  lines.push(t.scaleHead)
  lines.push('')
  lines.push(t.scale(s))
  lines.push('')

  // 落差四组：每组列 id + 地址/标题，可截断
  const gapDescriber = (kind, id) => {
    if (kind === 'unannotated' || kind === 'planOpen') {
      const b = byBlock.get(id)
      if (!b) return String(id)
      const tail = kind === 'unannotated' ? ` · ${fmtBytes(b.bytes)}` : ''
      return `${b.id} ${codeCell(addrOf(b))}${tail}`
    }
    if (kind === 'ungrounded') {
      const d = byDomain.get(id)
      if (!d) return String(id)
      return `${d.id} ${d.title || t.untitled} · ${d.status || t.none}`
    }
    const l = byLink.get(id)
    if (!l) return String(id)
    return `${l.id} ${refName(l.from, byDomain, byBlock)} ${t.arrow} ${refName(l.to, byDomain, byBlock)}`
  }
  lines.push(t.gapsHead)
  lines.push('')
  for (const kind of ['unannotated', 'ungrounded', 'planOpen', 'conflicts']) {
    const ids = g[kind]
    lines.push(`### ${t.gapNames[kind]} ${ids.length}`)
    if (!ids.length) {
      lines.push(t.gapNone)
    } else {
      for (const id of ids.slice(0, maxPerGap)) lines.push(`- ${gapDescriber(kind, id)}`)
      if (ids.length > maxPerGap) lines.push(t.gapMore(ids.length - maxPerGap))
    }
    lines.push('')
  }

  // 域树
  lines.push(t.treeHead)
  lines.push('')
  const ungroundedIds = new Set(g.ungrounded)
  const tree = treeRows(board, t, ungroundedIds)
  if (tree.length) lines.push(...tree)
  else lines.push(`- ${t.noDomains}`)
  lines.push('')

  // 未覆盖块 top N（按体积从大到小，最容易先看大的）
  const uncovered = g.unannotated
    .map((id) => byBlock.get(id))
    .filter(Boolean)
    .sort((a, b) => (Number(b.bytes) || 0) - (Number(a.bytes) || 0) || String(a.path || '').localeCompare(String(b.path || '')))
  const shown = uncovered.slice(0, topUncovered)
  lines.push(t.uncoveredHead(shown.length, uncovered.length))
  lines.push('')
  if (shown.length) {
    for (const b of shown) {
      lines.push(`- ${b.id} ${codeCell(addrOf(b))} · ${b.lang || t.none} · ${fmtBytes(b.bytes)}`)
    }
    if (uncovered.length > shown.length) lines.push(t.gapMore(uncovered.length - shown.length))
  } else {
    lines.push(`- ${t.uncoveredNone}`)
  }
  lines.push('')

  // 连接统计
  lines.push(t.linkHead)
  lines.push('')
  lines.push(`- ${linkStatLine(t, s.byType)}`)
  lines.push('')
  lines.push('---')
  lines.push(t.footer)

  // 行数上限：不够就截断，最后一行说明去哪看全量
  if (lines.length > maxLines) {
    if (maxLines === 1) return lines[0]
    const kept = lines.slice(0, maxLines - 1)
    kept.push(t.clipped(maxLines))
    return kept.join('\n')
  }
  return lines.join('\n')
}

// ── 对外：域录 ────────────────────────────────────────────────────

/**
 * 给人读的全录 Markdown：域一节一节，再块录表、连接录表。纯函数。
 *
 * @param {object} board 板子（§3.1）
 * @param {object} [gaps] 同 buildBrief
 * @param {object} [stats] derived(board).stats；缺键自动补
 * @returns {string}
 */
export function buildRegister(board, gaps, stats) {
  const t = TEXT.zh // 域录固定中文：给人读的全录
  const { domains, blocks, links, notes } = partsOf(board)
  const g = resolveGaps(board, gaps)
  const s = resolveStats(board, g, stats)
  const byDomain = new Map(domains.filter((d) => d && d.id).map((d) => [d.id, d]))
  const byBlock = new Map(blocks.filter((b) => b && b.id).map((b) => [b.id, b]))
  const projectName = board?.project?.name || board?.title || 'project'
  const lines = []

  // 标题与来源
  lines.push(`# ${projectName} · ${t.registerBrand}`)
  lines.push('')
  const updatedAt = typeof board?.updatedAt === 'string' && board.updatedAt ? board.updatedAt : nowText(undefined)
  lines.push(`> ${t.registerUpdated(updatedAt)}`)
  lines.push('')
  lines.push(t.scale(s))
  lines.push('')

  // 一块一块域：说法、子域、覆盖、出边、批注
  lines.push(t.domainsHead)
  lines.push('')
  if (!domains.length) {
    lines.push(t.noDomains)
    lines.push('')
  }
  const ungrounded = new Set(g.ungrounded)
  for (const d of domains) {
    if (!d || !d.id) continue
    const status = t.status[d.status] || d.status || t.none
    const author = t.author[d.author] || d.author || t.none
    lines.push(`### ${d.id} ${d.title || t.untitled} · ${status} · ${author}`)
    lines.push('')
    lines.push(`- ${t.statement}：${d.statement ? cell(d.statement) : t.none}`)
    // v1.16：域录带完成判据（简报不带，保持 ≤200 行压缩视图——契约 G3）
    if (typeof d.criteria === 'string' && d.criteria.trim()) lines.push(`- ${t.criteria}：${cell(d.criteria.trim(), 300)}`)
    const children = domains.filter((c) => c && c.parent === d.id).map((c) => `${c.id} ${c.title || t.untitled}`)
    lines.push(`- ${t.children}：${children.length ? children.join(t.listSep) : t.none}`)
    const covered = links
      .filter((l) => l && l.type === 'covers' && l.from === d.id)
      .map((l) => byBlock.get(l.to))
      .filter(Boolean)
    const coveredText = covered.length ? covered.map((b) => `${b.id} ${codeCell(addrOf(b))}`).join(t.listSep) : t.none
    lines.push(`- ${t.covers}（${covered.length}）：${coveredText}`)
    const outgoing = links.filter((l) => l && l.from === d.id)
    const outText = outgoing.length
      ? outgoing
          .map((l) => `${l.id} ${linkLabel(t, l.type)} → ${refName(l.to, byDomain, byBlock)}`)
          .join(t.sentenceSep)
      : t.none
    lines.push(`- ${t.outLinks}（${outgoing.length}）：${outText}`)
    if (arr(d.tags).length) lines.push(`- ${t.tags}：${arr(d.tags).join(t.listSep)}`)
    if (d.note) lines.push(`- ${t.note}：${cell(d.note)}`)
    if (ungrounded.has(d.id)) lines.push(`- ${t.emptyPromise}`)
    lines.push('')
  }

  // 块录：id／地址／语言／字节／状态／归属域
  lines.push(t.blocksHead)
  lines.push('')
  if (!blocks.length) {
    lines.push(t.none)
    lines.push('')
  } else {
    lines.push(`| ${t.tblBlock.join(' | ')} |`)
    lines.push(`|${t.tblBlock.map(() => '---').join('|')}|`)
    for (const b of blocks) {
      if (!b || !b.id) continue
      const owners = links
        .filter((l) => l && l.type === 'covers' && l.to === b.id)
        .map((l) => byDomain.get(l.from))
        .filter(Boolean)
        .map((d) => `${d.id} ${d.title || t.untitled}`)
      const state = b.planned
        ? b.stale
          ? t.state.planStale
          : t.state.plan
        : b.stale
          ? t.state.stale
          : t.state.real
      lines.push(
        `| ${b.id} | ${codeCell(addrOf(b))} | ${b.lang || t.none} | ${fmtBytes(b.bytes)} | ${state} | ${owners.length ? owners.join(t.listSep) : t.none} |`,
      )
    }
    lines.push('')
  }

  // 连接录
  lines.push(t.linksHead)
  lines.push('')
  if (!links.length) {
    lines.push(t.none)
    lines.push('')
  } else {
    lines.push(`| ${t.tblLink.join(' | ')} |`)
    lines.push(`|${t.tblLink.map(() => '---').join('|')}|`)
    for (const l of links) {
      if (!l || !l.id) continue
      lines.push(
        `| ${l.id} | ${cell(refName(l.from, byDomain, byBlock), 80)} | ${cell(refName(l.to, byDomain, byBlock), 80)} | ${cell(linkLabel(t, l.type), 40)} | ${l.note ? cell(l.note, 60) : t.none} |`,
      )
    }
    lines.push('')
  }

  // 笔记：有才写，全录里也留一笔
  if (notes.length) {
    lines.push(t.notesHead)
    lines.push('')
    for (const n of notes) {
      if (!n || !n.id) continue
      const ref = n.ref ? ` → ${refName(n.ref, byDomain, byBlock)}` : ''
      lines.push(`- ${n.id}${n.color ? ` · ${n.color}` : ''}「${cell(n.text, 120)}」${ref}`)
    }
    lines.push('')
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

/** 连接类型的人读名（未知类型照原样）。 */
function linkLabel(t, type) {
  if (t === TEXT.zh) {
    const zh = LINK_ZH.get(type)
    return zh ? `${type} ${zh}` : String(type)
  }
  return String(type)
}
