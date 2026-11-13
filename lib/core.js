// 结构台 · 板子的语义层（纯函数，不碰盘）
// 一句话：域装说法、块记事实、连接说关系；落差是算出来的，不是填出来的。

import { createHash } from 'node:crypto'

export const FORMAT = 'structure-desk/1'
export const LAYOUT_FORMAT = 'structure-desk-layout/1'

/** 域的四档状态。solid 实 / thin 薄 / rift 裂 / open 空。 */
export const DOMAIN_STATUS = ['solid', 'thin', 'rift', 'open']

/** 完成判据最长多少字（v1.16：域上「什么算落地」的一条可检验的话）。 */
const CRITERIA_MAX = 300

// ── v1.19 说法层 ───────────────────────────────────────────────────
/** 层的归属方。 */
export const LAYER_OWNERS = ['human', 'agent', 'program']
/** 默认三层 id 固定为 human/agent/program：兼容 v1.16 的层名、旧验收脚本与 localStorage 键。 */
const DEFAULT_LAYER_IDS = ['human', 'agent', 'program']
const LAYER_COLORS = { human: '#4a7dff', agent: '#9a6bff', program: '#8a8f98' }
const LAYER_NAMES = { human: '人', agent: 'agent', program: '程序' }

/** 默认三层（builtin）：不可删、不可改归属；自定义层从 S1 起。 */
function defaultLayers(at) {
  return DEFAULT_LAYER_IDS.map((id) => ({
    id,
    name: LAYER_NAMES[id],
    owner: id,
    color: LAYER_COLORS[id],
    builtin: true,
    createdAt: at || now(),
  }))
}

/** 按作者取默认层 id（旧板缺 layer 时回填、新件默认落自己方的默认层）。 */
export function defaultLayerIdOf(author) {
  return author === 'agent' ? 'agent' : author === 'program' ? 'program' : 'human'
}

/** 层色：只认 #rgb/#rrggbb（#rrggbbaa 也放行），否则按归属给默认色。 */
function colorOf(v, owner) {
  const text = typeof v === 'string' ? v.trim() : ''
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(text) ? text : LAYER_COLORS[owner] || LAYER_COLORS.human
}

/** 九型连接：名字、中文、两端允许的件、线型。 */
export const LINK_TYPES = {
  covers: { label: '覆盖', from: ['domain'], to: ['domain', 'block'], style: 'solid' },
  refines: { label: '细化', from: ['domain'], to: ['domain'], style: 'dashed' },
  contradicts: { label: '矛盾', from: ['domain', 'block'], to: ['domain', 'block'], style: 'conflict' },
  depends: { label: '依赖', from: ['block'], to: ['block'], style: 'solid' },
  calls: { label: '调用', from: ['block'], to: ['block'], style: 'dotted' },
  plans: { label: '计划', from: ['domain'], to: ['block'], style: 'plan' },
  grounds: { label: '落地', from: ['block'], to: ['block'], style: 'ground' },
  relates: { label: '关联', from: ['domain', 'block'], to: ['domain', 'block'], style: 'thin' },
}

/** 一处写法错了，带上是第几条 op。 */
export class OpError extends Error {
  constructor(index, message) {
    super(message)
    this.name = 'OpError'
    this.index = index
  }
}

const now = () => new Date().toISOString()

/** 稳定序列化：键排序、无坐标，用来算 rev。 */
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
}

/** 板子语义内容的指纹（layout 不进 rev）。 */
export function revOf(board) {
  return createHash('sha1').update(canonical(board)).digest('hex').slice(0, 12)
}

/** 一个空板子。 */
export function newBoard(projectPath, name) {
  const at = now()
  return {
    format: FORMAT,
    project: { path: projectPath, name: name || projectPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'project' },
    title: `${name || 'project'} · 结构蓝图`,
    createdAt: at,
    updatedAt: at,
    seq: { D: 0, B: 0, L: 0, N: 0, S: 0 },
    layers: defaultLayers(at),
    domains: [],
    blocks: [],
    links: [],
    notes: [],
  }
}

/** 空布局。 */
export function newLayout() {
  return { format: LAYOUT_FORMAT, pos: {}, size: {}, collapsed: [], view: { x: 0, y: 0, zoom: 1 } }
}

/** 读进来的板子补默认值；坏字段就地纠正，不抛。 */
export function normalizeBoard(raw, projectPath) {
  const board = raw && typeof raw === 'object' ? raw : newBoard(projectPath)
  const fallback = newBoard(projectPath)
  board.format = FORMAT
  board.project = board.project && typeof board.project === 'object' ? board.project : fallback.project
  if (projectPath) board.project.path = projectPath
  if (!board.project.name) board.project.name = fallback.project.name
  if (!board.title) board.title = `${board.project.name} · 结构蓝图`
  if (!board.createdAt) board.createdAt = fallback.createdAt
  if (!board.updatedAt) board.updatedAt = board.createdAt
  const seq = board.seq && typeof board.seq === 'object' ? board.seq : {}
  board.seq = { D: num(seq.D), B: num(seq.B), L: num(seq.L), N: num(seq.N), S: num(seq.S) }
  // v1.19：层归一化——旧板（无 layers）补默认三层；默认三层固定排在列表头上（builtin，不可删）
  const rawLayers = arr(board.layers).map((l) => normalizeLayer(l)).filter(Boolean)
  const rawLayerById = new Map(rawLayers.map((l) => [l.id, l]))
  const defaults = defaultLayers(board.createdAt || now()).map((def) => {
    const hit = rawLayerById.get(def.id)
    return hit
      ? { ...hit, id: def.id, owner: def.id, builtin: true, name: (typeof hit.name === 'string' && hit.name.trim()) || def.name }
      : def
  })
  board.layers = [...defaults, ...rawLayers.filter((l) => !DEFAULT_LAYER_IDS.includes(l.id))]
  board.domains = arr(board.domains).map((d) => normalizeDomain(d)).filter(Boolean)
  board.blocks = arr(board.blocks).map((b) => normalizeBlock(b)).filter(Boolean)
  board.notes = arr(board.notes).map((n) => normalizeNote(n)).filter(Boolean)
  board.links = arr(board.links).map((l) => normalizeLink(l)).filter(Boolean)
  // id 去重：后出现的同 id 丢弃
  for (const key of ['domains', 'blocks', 'links', 'notes']) {
    const seen = new Set()
    board[key] = board[key].filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)))
    board.seq = syncSeq(board.seq, board[key])
  }
  board.seq = syncSeq(board.seq, board.layers)
  // 件归档（v1.19）：域与计划块带存在的层，缺了按 author 回填；实块、连接、便签不存层
  const layerIds = new Set(board.layers.map((l) => l.id))
  for (const domain of board.domains) domain.layer = layerIds.has(domain.layer) ? domain.layer : defaultLayerIdOf(domain.author)
  for (const block of board.blocks) {
    if (block.planned) block.layer = layerIds.has(block.layer) ? block.layer : defaultLayerIdOf(block.author)
    else delete block.layer
  }
  // 悬挂引用：指向不存在节点的边与父域，降级成无主而不是坏数据
  const ids = new Set([...board.domains, ...board.blocks].map((x) => x.id))
  board.links = board.links.filter((l) => ids.has(l.from) && ids.has(l.to))
  board.domains = board.domains.map((d) => (d.parent && !board.domains.some((x) => x.id === d.parent) ? { ...d, parent: null } : d))
  for (const d of board.domains) d.parent = nearestLegalParent(board, d)
  return board
}

function normalizeDomain(d) {
  if (!d || typeof d !== 'object' || typeof d.id !== 'string') return null
  return {
    id: d.id,
    title: typeof d.title === 'string' && d.title.trim() ? d.title.trim() : d.id,
    layer: typeof d.layer === 'string' ? d.layer : null,
    statement: typeof d.statement === 'string' ? d.statement : '',
    // v1.16：旧板没有 criteria，读进来补 ''，不升级 format（G5）
    criteria: criteriaOf(d.criteria),
    parent: typeof d.parent === 'string' ? d.parent : null,
    status: DOMAIN_STATUS.includes(d.status) ? d.status : 'solid',
    tags: arr(d.tags).filter((t) => typeof t === 'string'),
    note: typeof d.note === 'string' ? d.note : '',
    author: authorOf(d.author),
    createdAt: d.createdAt || now(),
    updatedAt: d.updatedAt || d.createdAt || now(),
  }
}

function normalizeBlock(b) {
  if (!b || typeof b !== 'object' || typeof b.id !== 'string' || typeof b.path !== 'string') return null
  const planned = b.planned === true || b.kind === 'plan'
  return {
    id: b.id,
    path: b.path.replace(/\\/g, '/').replace(/^\.\//, ''),
    symbol: typeof b.symbol === 'string' && b.symbol ? b.symbol : null,
    kind: planned ? 'plan' : b.kind === 'symbol' ? 'symbol' : b.kind === 'dir' ? 'dir' : 'file',
    lang: typeof b.lang === 'string' ? b.lang : '',
    bytes: num(b.bytes),
    lines: num(b.lines),
    sha: typeof b.sha === 'string' ? b.sha : null,
    address: typeof b.address === 'string' && b.address ? b.address : b.path,
    planned,
    ...(planned ? { layer: typeof b.layer === 'string' ? b.layer : null } : {}),
    ground: typeof b.ground === 'string' ? b.ground : null,
    stale: b.stale === true,
    note: typeof b.note === 'string' ? b.note : '',
    author: authorOf(b.author),
    createdAt: b.createdAt || now(),
    updatedAt: b.updatedAt || b.createdAt || now(),
  }
}

function normalizeLink(l) {
  if (!l || typeof l !== 'object' || typeof l.id !== 'string') return null
  if (!LINK_TYPES[l.type]) return null
  return {
    id: l.id,
    from: l.from,
    to: l.to,
    type: l.type,
    note: typeof l.note === 'string' ? l.note : '',
    author: authorOf(l.author),
    createdAt: l.createdAt || now(),
  }
}

function normalizeNote(n) {
  if (!n || typeof n !== 'object' || typeof n.id !== 'string') return null
  return {
    id: n.id,
    text: typeof n.text === 'string' ? n.text : '',
    ref: typeof n.ref === 'string' ? n.ref : null,
    color: typeof n.color === 'string' && n.color ? n.color : 'amber',
    author: authorOf(n.author),
    createdAt: n.createdAt || now(),
    updatedAt: n.updatedAt || n.createdAt || now(),
  }
}

/** v1.19：层归一化；默认层 id 固定，自定义层 id 只认 S 前缀。 */
function normalizeLayer(l) {
  if (!l || typeof l !== 'object' || typeof l.id !== 'string' || !l.id) return null
  const isDefault = DEFAULT_LAYER_IDS.includes(l.id)
  if (!isDefault && !/^S\d+$/.test(l.id)) return null
  const owner = isDefault ? l.id : LAYER_OWNERS.includes(l.owner) && l.owner !== 'program' ? l.owner : 'human'
  return {
    id: l.id,
    name: typeof l.name === 'string' && l.name.trim() ? l.name.trim() : LAYER_NAMES[owner] || owner,
    owner,
    color: colorOf(l.color, owner),
    builtin: isDefault,
    createdAt: l.createdAt || now(),
  }
}

function authorOf(v) {
  return v === 'agent' || v === 'program' ? v : 'human'
}
function arr(v) {
  return Array.isArray(v) ? v : []
}
function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}
/** 编号水位要不低于现有最大号，免得删了再加时撞号。 */
function syncSeq(seq, items) {
  const out = { ...seq }
  for (const item of items) {
    const m = /^([DBLNS])(\d+)$/.exec(item.id)
    if (!m) continue
    out[m[1]] = Math.max(out[m[1]] || 0, Number(m[2]))
  }
  return out
}

/** 取下一个号，不复用。 */
function nextId(board, prefix) {
  const key = prefix === 'domain' ? 'D' : prefix === 'block' ? 'B' : prefix === 'link' ? 'L' : prefix === 'layer' ? 'S' : 'N'
  board.seq[key] = (board.seq[key] || 0) + 1
  return `${key}${board.seq[key]}`
}

// ── 找件 ───────────────────────────────────────────────────────────

/** 按 id 找件，返回 {kind, item}。 */
export function findAny(board, id) {
  if (typeof id !== 'string' || !id) return undefined
  const domain = board.domains.find((d) => d.id === id)
  if (domain) return { kind: 'domain', item: domain }
  const block = board.blocks.find((b) => b.id === id)
  if (block) return { kind: 'block', item: block }
  const link = board.links.find((l) => l.id === id)
  if (link) return { kind: 'link', item: link }
  const note = board.notes.find((n) => n.id === id)
  if (note) return { kind: 'note', item: note }
  return undefined
}

/** 块可以用 id／相对路径／地址（path 或 path:symbol）指认。 */
export function findBlock(board, ref) {
  if (typeof ref !== 'string' || !ref) return undefined
  const byId = board.blocks.find((b) => b.id === ref)
  if (byId) return byId
  const norm = ref.replace(/\\/g, '/').replace(/^\.\//, '')
  return board.blocks.find((b) => b.address === norm || b.path === norm || (b.symbol && `${b.path}:${b.symbol}` === norm))
}

/** 域可以用 id 或标题指认；标题不唯一时取第一个。 */
export function findDomain(board, ref) {
  if (typeof ref !== 'string' || !ref) return undefined
  return board.domains.find((d) => d.id === ref) || board.domains.find((d) => d.title === ref)
}

/** 一段引用可能指块也可能指域，先 id 后标题后路径。 */
export function resolveRef(board, ref) {
  const any = findAny(board, ref)
  if (any) return any
  const domain = findDomain(board, ref)
  if (domain) return { kind: 'domain', item: domain }
  const block = findBlock(board, ref)
  if (block) return { kind: 'block', item: block }
  return undefined
}

/** 子域。 */
export function childrenOf(board, id) {
  return board.domains.filter((d) => d.parent === id)
}

/** 从某域往下所有域 id（含自己）。 */
export function subtreeIds(board, id) {
  const out = new Set()
  const walk = (cur) => {
    if (out.has(cur)) return
    out.add(cur)
    for (const d of board.domains) if (d.parent === cur) walk(d.id)
  }
  walk(id)
  return out
}

/** 父域只能落在自己子树之外，否则成环。 */
function nearestLegalParent(board, domain) {
  let parent = domain.parent
  const seen = new Set([domain.id])
  while (parent) {
    if (seen.has(parent)) return null
    seen.add(parent)
    const next = board.domains.find((d) => d.id === parent)
    if (!next) return null
    parent = next.parent
  }
  return domain.parent
}

// ── 落差与规模 ─────────────────────────────────────────────────────

/**
 * 兼容口径：件的归属方（v1.16 由 author 导出；v1.19 起层的 owner 才是权威，
 * 新代码请用 layerIdOf／layerOwnerOf，按板子取层再判归属）。
 */
export function layerOf(item) {
  const author = item && item.author
  return author === 'agent' ? 'agent' : author === 'program' ? 'program' : 'human'
}

/** v1.19：按 id（或名字）找层。 */
export function findLayer(board, ref) {
  if (typeof ref !== 'string' || !ref) return undefined
  const layers = (board && board.layers) || []
  return layers.find((l) => l.id === ref) || layers.find((l) => l.name === ref)
}

/** v1.19：件的层 id——域/计划块读 `layer`，实块归程序层，缺省按 author 兜底。 */
export function layerIdOf(board, item) {
  if (!item) return 'program'
  if (item.kind === 'block' && item.planned !== true) return 'program'
  const layers = (board && board.layers) || []
  if (typeof item.layer === 'string' && layers.some((l) => l.id === item.layer)) return item.layer
  return defaultLayerIdOf(item.author)
}

/** v1.19：层归属方；层不存在时按默认层兜底。 */
export function layerOwnerOf(board, layerId) {
  const layer = findLayer(board, layerId)
  if (layer) return layer.owner
  return DEFAULT_LAYER_IDS.includes(layerId) ? layerId : 'human'
}

/**
 * 算四种落差与规模。
 * 未标注＝实块没人 cover；空承诺＝域没 cover 没子域没 plans；未落地＝计划块没 grounds；矛盾＝contradicts 边。
 */
export function derived(board) {
  const coversIn = new Map()
  const coversOut = new Map()
  const groundsOut = new Set()
  const plansOut = new Set()
  const conflicts = []
  for (const link of board.links) {
    if (link.type === 'covers') {
      if (!coversOut.has(link.from)) coversOut.set(link.from, [])
      coversOut.get(link.from).push(link.to)
      if (!coversIn.has(link.to)) coversIn.set(link.to, [])
      coversIn.get(link.to).push(link.from)
    } else if (link.type === 'grounds') {
      // 落地：计划块 → 实块，所以「落地了」看的是计划块的出边
      groundsOut.add(link.from)
    } else if (link.type === 'plans') {
      plansOut.add(link.from)
    } else if (link.type === 'contradicts') {
      conflicts.push(link.id)
    }
  }
  const real = board.blocks.filter((b) => !b.planned)
  const planned = board.blocks.filter((b) => b.planned)
  const unannotated = real.filter((b) => !coversIn.has(b.id)).map((b) => b.id)
  const planOpen = planned.filter((b) => !groundsOut.has(b.id) && !b.ground).map((b) => b.id)
  const ungrounded = board.domains
    .filter((d) => !(coversOut.get(d.id) || []).length && !childrenOf(board, d.id).length && !plansOut.has(d.id))
    .map((d) => d.id)
  const stale = board.blocks.filter((b) => b.stale).map((b) => b.id)
  // v1.16：同一份落差分层再算一份；v1.19 起按**层 id** 计（含自定义层，程序层收未标注）
  const domainById = new Map(board.domains.map((d) => [d.id, d]))
  const blockById = new Map(board.blocks.map((b) => [b.id, b]))
  const byLayer = {}
  for (const layer of board.layers || []) byLayer[layer.id] = { owner: layer.owner, ungrounded: [], planOpen: [], unannotated: [] }
  for (const id of ungrounded) {
    const lane = layerIdOf(board, domainById.get(id))
    if (byLayer[lane]) byLayer[lane].ungrounded.push(id)
  }
  for (const id of planOpen) {
    const lane = layerIdOf(board, blockById.get(id))
    if (byLayer[lane]) byLayer[lane].planOpen.push(id)
  }
  if (byLayer.program) byLayer.program.unannotated = [...unannotated]
  const byLayerStats = {}
  for (const layer of board.layers || []) {
    byLayerStats[layer.id] = {
      owner: layer.owner,
      ungrounded: byLayer[layer.id].ungrounded.length,
      planOpen: byLayer[layer.id].planOpen.length,
      unannotated: byLayer[layer.id].unannotated.length,
    }
  }
  const byAxis = {}
  for (const link of board.links) byAxis[link.type] = (byAxis[link.type] || 0) + 1
  const stats = {
    domains: board.domains.length,
    blocks: board.blocks.length,
    realBlocks: real.length,
    planBlocks: planned.length,
    links: board.links.length,
    notes: board.notes.length,
    covered: real.length - unannotated.length,
    unannotated: unannotated.length,
    ungrounded: ungrounded.length,
    planOpen: planOpen.length,
    conflicts: conflicts.length,
    stale: stale.length,
    byLayer: byLayerStats,
    bytes: real.reduce((sum, b) => sum + (b.bytes || 0), 0),
    byType: byAxis,
  }
  const coverage = { byBlock: {}, byDomain: {} }
  for (const link of board.links) {
    if (link.type !== 'covers') continue
    ;(coverage.byDomain[link.from] ||= []).push(link.to)
    ;(coverage.byBlock[link.to] ||= []).push(link.from)
  }
  return {
    stats,
    gaps: { unannotated, ungrounded, planOpen, conflicts, stale, byLayer },
    coverage,
  }
}

// ── scan 落地建议（v1.16，契约 G1）────────────────────────────────

const SUGGEST_MIN_SCORE = 0.34
const SUGGEST_LIMIT = 5

/** 路径词元：小写，非字母数字与汉字都当分隔，太短的不算。 */
function tokensOf(value) {
  return String(value ?? '')
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .filter((token) => token.length >= 2)
}

/** 词元集合的 Jaccard 相似度。 */
function jaccardOf(left, right) {
  const a = new Set(left)
  const b = new Set(right)
  if (!a.size || !b.size) return 0
  let both = 0
  for (const token of a) if (b.has(token)) both += 1
  return both / (a.size + b.size - both)
}

/** 路径尾部的文件名。 */
function baseOf(path) {
  const parts = String(path ?? '').split('/')
  return parts[parts.length - 1] || ''
}

/**
 * scan 落地建议：计划块 × 本次 scan 新增的实块，按「路径词元 + 文件名」启发式打分，Top 5。
 * 纯函数：不改板子、不进 rev；结果只随 /scan 与工具 scan 的回包走，不落盘。
 * @param {object} board 板子
 * @param {string[]} addedIds 本次 scan 新增的块 id
 * @returns {Array<{plannedId:string, realId:string, score:number, reason:string}>}
 */
export function suggestGrounds(board, addedIds) {
  const added = new Set(arr(addedIds).filter((id) => typeof id === 'string'))
  if (!added.size) return []
  const blocks = arr(board && board.blocks)
  const planned = blocks.filter((b) => b.planned === true && !b.ground && !b.stale)
  const reals = blocks.filter((b) => !b.planned && added.has(b.id))
  if (!planned.length || !reals.length) return []
  const pairs = []
  for (const plan of planned) {
    const plannedTokens = tokensOf(`${plan.path || ''} ${plan.symbol || ''}`)
    const plannedBase = baseOf(plan.path)
    for (const real of reals) {
      if (real.id === plan.id) continue
      let score = jaccardOf(plannedTokens, tokensOf(real.path))
      const realBase = baseOf(real.path)
      let reason = '路径相近'
      if (plannedBase && realBase && plannedBase === realBase) {
        score += 0.25
        reason = '文件名相同'
      } else if (plannedBase && realBase && (plannedBase.includes(realBase) || realBase.includes(plannedBase))) {
        score += 0.15
        reason = '文件名相近'
      }
      if (score < SUGGEST_MIN_SCORE) continue
      pairs.push({ plannedId: plan.id, realId: real.id, score: Math.round(score * 100) / 100, reason })
    }
  }
  pairs.sort((a, b) => b.score - a.score || a.plannedId.localeCompare(b.plannedId) || a.realId.localeCompare(b.realId))
  return pairs.slice(0, SUGGEST_LIMIT)
}

/** 域树：根域带 children 递归，给左栏与简报用。 */
export function domainTree(board) {
  const build = (parent) =>
    board.domains.filter((d) => d.parent === parent).map((d) => ({ ...d, children: build(d.id) }))
  return build(null)
}

// ── 改板子 ─────────────────────────────────────────────────────────

const SUMMARY = {
  add_domain: (d) => `建域「${d.title}」`,
  update_domain: (d) => `改域「${d.title}」`,
  add_block: (b) => (b.planned ? `画计划块 ${b.address}` : `收块 ${b.address}`),
  update_block: (b) => `改块 ${b.address}`,
  add_link: (l) => `连线 ${LINK_TYPES[l.type].label}`,
  update_link: (l) => `改连线 ${LINK_TYPES[l.type].label}`,
  remove: (item, kind) => `删${kind === 'domain' ? '域' : kind === 'block' ? '块' : kind === 'link' ? '连线' : '便签'} ${item.title || item.address || item.text || item.id}`,
  add_note: (n) => `记一条便签`,
  update_note: () => `改便签`,
  add_layer: (l) => `建层「${l.name}」`,
  update_layer: (l) => `改层「${l.name}」`,
  remove_layer: (l) => `删层「${l.name}」`,
  assign_layer: (item) => `换层 ${item.title || item.address || item.id}`,
}

/**
 * 把一批 op 打到板子上。纯函数：返回新板子，不改入参。
 * 单条 op 出错只记 errors，不牵连其它条。
 * @returns {{board, changed:{added,updated,removed}, journal:Array, errors:Array, results:Array}}
 */
export function applyOps(input, ops, opts = {}) {
  const board = structuredClone(input)
  const defaultAuthor = authorOf(opts.author)
  const at = opts.at || now()
  const changed = { added: [], updated: [], removed: [] }
  const journal = []
  const errors = []
  const results = []
  const list = arr(ops)
  list.forEach((op, index) => {
    try {
      const result = applyOne(board, op, defaultAuthor, at, changed)
      results.push(result)
      const summary = SUMMARY[op.op]?.(result.item || {}, result.kind, result.item) || op.op
      journal.push({
        at,
        author: defaultAuthor,
        op: op.op,
        target: result.item && result.item.id ? result.item.id : null,
        summary,
        diff: { added: [...result.added], updated: [...result.updated], removed: [...result.removed] },
      })
    } catch (error) {
      const entry = { index, op: op && op.op ? op.op : '?', message: error.message }
      // v1.16：层守卫的错带 code／layer，客户端好按类型提示
      if (error && error.code) entry.code = error.code
      if (error && error.layer) entry.layer = error.layer
      errors.push(entry)
    }
  })
  // 板子头时间戳只在真有改动时动
  if (changed.added.length || changed.updated.length || changed.removed.length) {
    board.updatedAt = at
    board.seq = syncSeq(board.seq, [...board.domains, ...board.blocks, ...board.links, ...board.notes, ...(board.layers || [])])
  }
  return { board, changed, journal, errors, results }
}

function applyOne(board, op, author, at, changed) {
  if (!op || typeof op !== 'object' || typeof op.op !== 'string') throw new Error('op 形状不对')
  const done = { added: [], updated: [], removed: [] }
  const touch = (item) => {
    item.updatedAt = at
  }
  let out
  switch (op.op) {
    case 'add_domain': {
      const title = str(op.title)
      if (!title) throw new Error('域要有标题')
      const parent = op.parent ? findDomain(board, op.parent) : null
      if (op.parent && !parent) throw new Error(`父域不存在：${op.parent}`)
      const writer = authorOf(op.author || author)
      const domain = {
        id: nextId(board, 'domain'),
        title,
        layer: defaultLayerIdOf(writer),
        statement: str(op.statement),
        criteria: criteriaOf(op.criteria),
        parent: parent ? parent.id : null,
        status: DOMAIN_STATUS.includes(op.status) ? op.status : 'solid',
        tags: arr(op.tags).filter((t) => typeof t === 'string'),
        note: str(op.note),
        author: writer,
        createdAt: at,
        updatedAt: at,
      }
      board.domains.push(domain)
      done.added.push(domain.id)
      out = { kind: 'domain', item: domain, ...done }
      break
    }
    case 'update_domain': {
      const domain = findDomain(board, op.id)
      if (!domain) throw new Error(`域不存在：${op.id}`)
      guardLayer(board, 'domain', domain, author)
      if (op.title !== undefined) domain.title = str(op.title) || domain.title
      if (op.statement !== undefined) domain.statement = str(op.statement)
      if (op.criteria !== undefined) domain.criteria = criteriaOf(op.criteria)
      if (op.note !== undefined) domain.note = str(op.note)
      if (op.status !== undefined) {
        if (!DOMAIN_STATUS.includes(op.status)) throw new Error(`状态不认：${op.status}`)
        domain.status = op.status
      }
      if (op.tags !== undefined) domain.tags = arr(op.tags).filter((t) => typeof t === 'string')
      if (op.parent !== undefined) {
        const parent = op.parent ? findDomain(board, op.parent) : null
        if (op.parent && !parent) throw new Error(`父域不存在：${op.parent}`)
        if (parent && (parent.id === domain.id || subtreeIds(board, domain.id).has(parent.id))) {
          throw new Error('不能装进自己的子域')
        }
        domain.parent = parent ? parent.id : null
      }
      touch(domain)
      done.updated.push(domain.id)
      out = { kind: 'domain', item: domain, ...done }
      break
    }
    case 'add_block': {
      const path = normPath(op.path)
      if (!path) throw new Error('块要有相对路径')
      const symbol = op.symbol ? str(op.symbol) : null
      const existing = board.blocks.find((b) => b.path === path && (b.symbol || null) === symbol)
      if (existing) {
        if (op.note !== undefined) existing.note = str(op.note)
        out = { kind: 'block', item: existing, ...done }
        break
      }
      const planned = op.planned === true || op.kind === 'plan'
      const writer = authorOf(op.author || author)
      const block = {
        id: nextId(board, 'block'),
        path,
        symbol,
        kind: planned ? 'plan' : symbol ? 'symbol' : op.kind === 'dir' ? 'dir' : 'file',
        lang: str(op.lang),
        bytes: num(op.bytes),
        lines: num(op.lines),
        sha: typeof op.sha === 'string' ? op.sha : null,
        address: symbol ? `${path}:${symbol}` : path,
        planned,
        ...(planned ? { layer: defaultLayerIdOf(writer) } : {}),
        ground: null,
        stale: false,
        note: str(op.note),
        author: writer,
        createdAt: at,
        updatedAt: at,
      }
      board.blocks.push(block)
      done.added.push(block.id)
      out = { kind: 'block', item: block, ...done }
      break
    }
    case 'update_block': {
      const block = findBlock(board, op.id)
      if (!block) throw new Error(`块不存在：${op.id}`)
      guardLayer(board, 'block', block, author)
      if (op.path !== undefined) {
        const path = normPath(op.path)
        if (!path) throw new Error('块路径不能空')
        block.path = path
      }
      if (op.symbol !== undefined) block.symbol = op.symbol ? str(op.symbol) : null
      if (op.note !== undefined) block.note = str(op.note)
      if (op.stale !== undefined) block.stale = op.stale === true
      if (op.lang !== undefined) block.lang = str(op.lang)
      if (op.bytes !== undefined) block.bytes = num(op.bytes)
      if (op.lines !== undefined) block.lines = num(op.lines)
      if (op.sha !== undefined) block.sha = typeof op.sha === 'string' ? op.sha : null
      if (op.planned !== undefined) {
        block.planned = op.planned === true
        block.kind = block.planned ? 'plan' : block.symbol ? 'symbol' : 'file'
        if (block.planned) block.layer = block.layer || defaultLayerIdOf(authorOf(block.author))
        else delete block.layer
      }
      if (op.ground !== undefined) {
        const target = op.ground ? findBlock(board, op.ground) : null
        if (op.ground && !target) throw new Error(`落地目标不存在：${op.ground}`)
        block.ground = target ? target.id : null
      }
      block.address = block.symbol ? `${block.path}:${block.symbol}` : block.path
      touch(block)
      done.updated.push(block.id)
      out = { kind: 'block', item: block, ...done }
      break
    }
    case 'add_link': {
      const from = resolveRef(board, op.from)
      const to = resolveRef(board, op.to)
      if (!from) throw new Error(`起点不存在：${op.from}`)
      if (!to) throw new Error(`终点不存在：${op.to}`)
      const type = op.type
      const spec = LINK_TYPES[type]
      if (!spec) throw new Error(`连接类型不认：${type}`)
      if (!spec.from.includes(from.kind)) throw new Error(`${spec.label}的起点只能是${spec.from.join('/')}`)
      if (!spec.to.includes(to.kind)) throw new Error(`${spec.label}的终点只能是${spec.to.join('/')}`)
      if (from.item.id === to.item.id) throw new Error('不能连自己')
      const existing = board.links.find((l) => l.from === from.item.id && l.to === to.item.id && l.type === type)
      if (existing) {
        out = { kind: 'link', item: existing, ...done }
        break
      }
      const link = {
        id: nextId(board, 'link'),
        from: from.item.id,
        to: to.item.id,
        type,
        note: str(op.note),
        author: authorOf(op.author || author),
        createdAt: at,
      }
      board.links.push(link)
      done.added.push(link.id)
      out = { kind: 'link', item: link, ...done }
      break
    }
    case 'update_link': {
      const link = board.links.find((l) => l.id === op.id)
      if (!link) throw new Error(`连线不存在：${op.id}`)
      if (op.type !== undefined) {
        if (!LINK_TYPES[op.type]) throw new Error(`连接类型不认：${op.type}`)
        link.type = op.type
      }
      if (op.note !== undefined) link.note = str(op.note)
      done.updated.push(link.id)
      out = { kind: 'link', item: link, ...done }
      break
    }
    case 'remove': {
      const found = findAny(board, op.id)
      if (!found) throw new Error(`件不存在：${op.id}`)
      const { kind, item } = found
      // 只读守卫只作用在域与计划块（实块／连接／便签不设守卫，契约 §2.2）
      guardLayer(board, kind, item, author)
      if (kind === 'domain') {
        board.domains = board.domains.filter((d) => d.id !== item.id)
        board.domains = board.domains.map((d) => (d.parent === item.id ? { ...d, parent: null } : d))
        board.links = board.links.filter((l) => l.from !== item.id && l.to !== item.id)
        board.notes = board.notes.map((n) => (n.ref === item.id ? { ...n, ref: null } : n))
      } else if (kind === 'block') {
        board.blocks = board.blocks.filter((b) => b.id !== item.id)
        board.links = board.links.filter((l) => l.from !== item.id && l.to !== item.id)
        board.notes = board.notes.map((n) => (n.ref === item.id ? { ...n, ref: null } : n))
        board.blocks = board.blocks.map((b) => (b.ground === item.id ? { ...b, ground: null } : b))
      } else if (kind === 'link') {
        board.links = board.links.filter((l) => l.id !== item.id)
      } else {
        board.notes = board.notes.filter((n) => n.id !== item.id)
      }
      done.removed.push(item.id)
      out = { kind, item, ...done }
      break
    }
    case 'add_note': {
      const text = str(op.text)
      if (!text) throw new Error('便签不能空')
      const note = {
        id: nextId(board, 'note'),
        text,
        ref: op.ref ? (resolveRef(board, op.ref)?.item.id ?? null) : null,
        color: str(op.color) || 'amber',
        author: authorOf(op.author || author),
        createdAt: at,
        updatedAt: at,
      }
      board.notes.push(note)
      done.added.push(note.id)
      out = { kind: 'note', item: note, ...done }
      break
    }
    case 'update_note': {
      const note = board.notes.find((n) => n.id === op.id)
      if (!note) throw new Error(`便签不存在：${op.id}`)
      if (op.text !== undefined) note.text = str(op.text)
      if (op.color !== undefined) note.color = str(op.color) || note.color
      if (op.ref !== undefined) note.ref = op.ref ? (resolveRef(board, op.ref)?.item.id ?? null) : null
      touch(note)
      done.updated.push(note.id)
      out = { kind: 'note', item: note, ...done }
      break
    }
    case 'add_layer': {
      const name = str(op.name)
      if (!name) throw new Error('层要有名称')
      const owner = LAYER_OWNERS.includes(op.owner) ? op.owner : 'human'
      if (owner === 'program') throw new Error('程序层不可新建')
      if ((board.layers || []).length >= 24) throw new Error('层太多了（上限 24）')
      const layer = {
        id: nextId(board, 'layer'),
        name,
        owner,
        color: colorOf(op.color, owner),
        builtin: false,
        createdAt: at,
      }
      board.layers.push(layer)
      done.added.push(layer.id)
      out = { kind: 'layer', item: layer, ...done }
      break
    }
    case 'update_layer': {
      const layer = findLayer(board, op.id)
      if (!layer) throw new Error(`层不存在：${op.id}`)
      if (op.owner !== undefined && op.owner !== layer.owner) throw new Error('层归属建后不可改')
      if (op.name !== undefined) layer.name = str(op.name) || layer.name
      if (op.color !== undefined) layer.color = colorOf(op.color, layer.owner)
      done.updated.push(layer.id)
      out = { kind: 'layer', item: layer, ...done }
      break
    }
    case 'remove_layer': {
      const layer = findLayer(board, op.id)
      if (!layer) throw new Error(`层不存在：${op.id}`)
      if (layer.builtin) throw new Error('默认层不可删')
      const inUse = board.domains.some((d) => d.layer === layer.id) || board.blocks.some((b) => b.planned === true && b.layer === layer.id)
      if (inUse) throw new Error('层里还有件：先把件移到别的层再删')
      board.layers = board.layers.filter((l) => l.id !== layer.id)
      done.removed.push(layer.id)
      out = { kind: 'layer', item: layer, ...done }
      break
    }
    case 'assign_layer': {
      const found = findAny(board, op.id)
      if (!found) throw new Error(`件不存在：${op.id}`)
      const { kind, item } = found
      if (!(kind === 'domain' || (kind === 'block' && item.planned === true))) throw new Error('只有域与计划块能换层')
      guardLayer(board, kind, item, author)
      const target = findLayer(board, op.layer)
      if (!target) throw new Error(`层不存在：${op.layer}`)
      if (target.owner !== author) throw new Error('只能换到自己方的层')
      if (layerIdOf(board, item) !== target.id) {
        item.layer = target.id
        touch(item)
        done.updated.push(item.id)
      }
      out = { kind, item, ...done }
      break
    }
    default:
      throw new Error(`不认的 op：${op.op}`)
  }
  changed.added.push(...done.added)
  changed.updated.push(...done.updated)
  changed.removed.push(...done.removed)
  return out
}

function str(v) {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''
}

/** 完成判据：trim 后最多 300 字，超长截断；空串表示未填。 */
function criteriaOf(v) {
  const text = typeof v === 'string' ? v.trim() : ''
  return text.length > CRITERIA_MAX ? text.slice(0, CRITERIA_MAX) : text
}

/**
 * 层只读守卫（v1.19）：域与计划块按**所在层的 owner** 判，只许同方改写；
 * 实块（程序层）与连接／便签不设守卫——它们是事实底盘与公共注记。
 */
function guardLayer(board, kind, item, writer) {
  const guarded = kind === 'domain' || (kind === 'block' && item.planned === true)
  if (!guarded) return
  const lane = layerIdOf(board, item)
  const owner = layerOwnerOf(board, lane)
  if (owner === 'program' || owner === writer) return
  const layer = findLayer(board, lane)
  const label = kind === 'domain' ? '说法' : '计划'
  const name = layer ? layer.name : lane
  const error = new Error(`这是 ${name} 层的${label}，只读；请新增自己层的说法/计划，用 relates/contradicts 提案`)
  error.code = 'layer-readonly'
  error.layer = lane
  throw error
}

// ── 历史摘要（v1.17 A3）──────────────────────────────────────────

/**
 * 一批历史只留摘要字段（v1.17 A3）：时间轴珠子、未读批判断、「撤销最近一批」都够用；
 * diff／labels 挪到 GET /history?batch= 按批取。纯函数，入参不改。
 */
export function summaryOfBatch(entry) {
  const e = entry && typeof entry === 'object' ? entry : {}
  const counts = e.counts && typeof e.counts === 'object' ? e.counts : {}
  return {
    batch: typeof e.batch === 'string' ? e.batch : '',
    at: typeof e.at === 'string' ? e.at : '',
    author: e.author === 'agent' || e.author === 'program' ? e.author : 'human',
    op: typeof e.op === 'string' ? e.op : 'ops',
    summary: typeof e.summary === 'string' ? e.summary : '',
    reverted: typeof e.reverted === 'string' ? e.reverted : null,
    revBefore: typeof e.revBefore === 'string' ? e.revBefore : null,
    revAfter: typeof e.revAfter === 'string' ? e.revAfter : null,
    counts: { added: num(counts.added), updated: num(counts.updated), removed: num(counts.removed) },
  }
}

/** 相对路径校验：不许绝对、不许 ..、统一正斜杠。 */
export function normPath(v) {
  const raw = str(v).replace(/\\/g, '/').replace(/^\.\//, '')
  if (!raw || raw.startsWith('/') || /^[A-Za-z]:/.test(raw) || raw.split('/').includes('..')) return ''
  return raw
}
