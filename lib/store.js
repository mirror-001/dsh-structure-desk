// 结构台 · 落盘层
// 一条规矩：板子只有一个写入口（这里），写完发 journal。可重生的（layout／简报／域录）与
// 不可重生的（board／journal）分开放——丢了要知道丢的是什么。

import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { applyOps, derived, newBoard, newLayout, normalizeBoard, revOf, canonical, suggestGrounds, summaryOfBatch } from './core.js'

export const DEFAULT_DATA_DIR = '结构蓝图'
const RECENT_LIMIT = 12
// v1.14「看见改动」：一批写入 = 一颗珠子。快照保 50 批 / 16 MB，谁先到头按时间清。
const HISTORY_FORMAT = 'structure-desk-history/1'
const HISTORY_LIMIT = 50
const HISTORY_MAX_BYTES = 16 * 1024 * 1024
const HISTORY_LABEL_CAP = 240
// v1.17 A3：index 瘦身——最近 20 批留 diff、最近 10 批留 labels，更老只留 counts（快照不动）
export const HISTORY_DIFF_KEEP = 20
export const HISTORY_LABEL_KEEP = 10

// 同一项目的写排队：一个人点得快，也不许两条写撞在一起。
const queues = new Map()

function enqueue(key, task) {
  const prev = queues.get(key) || Promise.resolve()
  const next = prev.then(task, task)
  // 队列尾巴不吞错：失败也要放行后面的写
  queues.set(key, next.catch(() => {}))
  return next
}

/** DSH 的家目录。 */
export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function recentFile() {
  return join(dshHome(), 'storages', 'structure-desk', 'recent.json')
}

/** 项目里那个数据目录。 */
export function boardDir(projectPath, dataDir = DEFAULT_DATA_DIR) {
  return join(projectPath, dataDir || DEFAULT_DATA_DIR)
}

/** 一个项目里我们认的四个文件。 */
export function boardFiles(projectPath, dataDir) {
  const dir = boardDir(projectPath, dataDir)
  return {
    dir,
    board: join(dir, 'board.json'),
    layout: join(dir, 'layout.json'),
    journal: join(dir, 'journal.jsonl'),
    brief: join(dir, '简报.md'),
    register: join(dir, '域录.md'),
    historyDir: join(dir, 'history'),
    historyIndex: join(dir, 'history', 'index.json'),
  }
}

/** 一批写入的 id：时间可读 + 4 位随机，文件名安全。 */
export function newBatchId(at = new Date()) {
  const iso = (at instanceof Date ? at : new Date(at)).toISOString()
  const stamp = `${iso.slice(0, 10).replace(/-/gu, '')}-${iso.slice(11, 19).replace(/:/gu, '')}`
  return `b${stamp}-${randomBytes(2).toString('hex')}`
}

/** 校验并规整路径：必须是存在的目录，返回真实路径。 */
export async function resolveProject(input) {
  if (typeof input !== 'string' || !input.trim()) throw httpError(400, 'project 要是一个绝对目录路径')
  const full = resolve(input.trim())
  let info
  try {
    info = await stat(full)
  } catch {
    throw httpError(404, `目录不存在：${full}`)
  }
  if (!info.isDirectory()) throw httpError(400, `不是目录：${full}`)
  return full
}

/** 带 HTTP 状态码的错，路由层直接拿去回。 */
export function httpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if (error && error.code === 'ENOENT') return undefined
    throw httpError(500, `${file} 读不动：${error.message}`)
  }
}

/** 原子写：先写同目录临时件再改名，断电不会留半个 JSON。 */
async function writeAtomic(file, text) {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
  await writeFile(tmp, text, 'utf8')
  await rename(tmp, file)
}

// ── 读缓存（v1.17 A4）────────────────────────────────────────────
// /state 与 /rev 是热路径：board/layout 没变就不重读、不重算 derived。
// 校验键用 mtimeMs+size（外部手改也逃不掉）；写路径再主动 drop，避免同毫秒同大小撞键。

const stateCache = new Map() // projectPath -> { stamp, core }
const historyCache = new Map() // index.json 绝对路径 -> { stamp, index }
const cacheCounters = { stateHits: 0, stateMisses: 0, historyHits: 0, historyMisses: 0 }

/** 缓存命中计数（测试／验收用；累计值，取前后差即可）。 */
export function cacheStats() {
  return {
    state: { hits: cacheCounters.stateHits, misses: cacheCounters.stateMisses },
    history: { hits: cacheCounters.historyHits, misses: cacheCounters.historyMisses },
  }
}

/** 文件指纹：mtimeMs+size；文件不在给 '-'。 */
async function stampOf(file) {
  try {
    const info = await stat(file)
    return `${info.mtimeMs}:${info.size}`
  } catch {
    return '-'
  }
}

/** 写路径主动失效（v1.17 A4）：板子／坐标／历史一改，下一次读就重读。 */
export function dropCache(projectPath, opts = {}) {
  stateCache.delete(projectPath)
  historyCache.delete(boardFiles(projectPath, opts.dataDir).historyIndex)
}

/**
 * 板子本体（board/layout/stats/gaps/coverage/rev）——读缓存的核心。
 * 只缓存盘上真有 board.json 的项目：空板子的 createdAt 每次都是新的，缓存它没意义。
 */
async function readBoardCore(projectPath, opts = {}) {
  const files = boardFiles(projectPath, opts.dataDir)
  const stamp = `${opts.dataDir || DEFAULT_DATA_DIR}|${await stampOf(files.board)}|${await stampOf(files.layout)}`
  const cached = stateCache.get(projectPath)
  if (cached && cached.stamp === stamp) {
    cacheCounters.stateHits += 1
    return cached.core
  }
  cacheCounters.stateMisses += 1
  const rawBoard = await readJson(files.board)
  const rawLayout = await readJson(files.layout)
  const board = rawBoard ? normalizeBoard(rawBoard, projectPath) : newBoard(projectPath, opts.name)
  const layout = normalizeLayout(rawLayout)
  const { stats, gaps, coverage } = derived(board)
  const core = {
    project: { path: projectPath, name: board.project?.name || '' },
    board,
    layout,
    // 还没有板子时不发 rev：空板子的 createdAt 每次都是新的，拿它当修订号会自相矛盾
    rev: rawBoard ? revOf(board) : null,
    stats,
    gaps,
    coverage,
    exists: Boolean(rawBoard),
  }
  if (rawBoard) stateCache.set(projectPath, { stamp, core })
  return core
}

/**
 * 读一整个项目的状态。没有板子就给个空板子（还不写盘）。
 * opts.parts 给定时只读／只回那几段（board/layout/stats/gaps/coverage/history/journal），
 * project/rev 恒带（v1.17 A2）。
 */
export async function readState(projectPath, opts = {}) {
  const parts = opts.parts instanceof Set ? opts.parts : Array.isArray(opts.parts) ? new Set(opts.parts) : null
  const want = (key) => !parts || parts.has(key)
  const core = await readBoardCore(projectPath, opts)
  const state = {}
  if (want('board')) state.board = core.board
  if (want('layout')) state.layout = core.layout
  if (want('stats')) state.stats = core.stats
  if (want('gaps')) state.gaps = core.gaps
  if (want('coverage')) state.coverage = core.coverage
  state.project = core.project
  state.rev = core.rev
  if (!parts) state.exists = core.exists
  if (want('journal')) state.journalTail = await readJournalTail(projectPath, opts)
  if (want('history')) state.history = await readHistorySummaries(projectPath, opts)
  return state
}

/** v1.17 A2：轮询用的轻量状态（≤2KB），走读缓存；没有板子时 rev=null、lastBatch=null。 */
const REV_STATS_KEYS = ['domains', 'blocks', 'realBlocks', 'planBlocks', 'links', 'notes', 'unannotated', 'ungrounded', 'planOpen', 'conflicts', 'stale']

export async function readRev(projectPath, opts = {}) {
  const core = await readBoardCore(projectPath, opts)
  const files = boardFiles(projectPath, opts.dataDir)
  const index = await readHistoryIndex(files)
  const last = index.batches.length ? index.batches[index.batches.length - 1] : null
  const stats = {}
  for (const key of REV_STATS_KEYS) stats[key] = core.stats && typeof core.stats[key] === 'number' ? core.stats[key] : 0
  return {
    project: core.project,
    rev: core.rev,
    stats,
    historyCount: index.batches.length,
    lastBatch: last ? { batch: last.batch, at: last.at, op: last.op, counts: last.counts, revAfter: last.revAfter } : null,
  }
}

function normalizeLayout(raw) {
  const layout = raw && typeof raw === 'object' ? raw : {}
  const base = newLayout()
  return {
    format: base.format,
    pos: layout.pos && typeof layout.pos === 'object' ? layout.pos : {},
    size: layout.size && typeof layout.size === 'object' ? layout.size : {},
    collapsed: Array.isArray(layout.collapsed) ? layout.collapsed.filter((x) => typeof x === 'string') : [],
    view: layout.view && typeof layout.view === 'object' ? layout.view : base.view,
  }
}

/** 追加 journal，顺手读回尾巴。 */
async function appendJournal(files, entries) {
  if (!entries.length) return
  await mkdir(files.dir, { recursive: true })
  await appendFile(files.journal, entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8')
}

/** 最近若干条 journal（新的在后）。读不到就当没有。 */
export async function readJournalTail(projectPath, opts = {}) {
  const limit = opts.journalLimit ?? 40
  const files = boardFiles(projectPath, opts.dataDir)
  let text
  try {
    text = await readFile(files.journal, 'utf8')
  } catch {
    return []
  }
  const lines = text.split('\n').filter(Boolean)
  return lines.slice(-limit).flatMap((line) => {
    try {
      return [JSON.parse(line)]
    } catch {
      return []
    }
  })
}

// ── 历史（v1.14「看见改动」）────────────────────────────────────
// 每批写板：动手前拍一张快照（board + layout）放进 结构蓝图/history/<batch>.json，
// 再往 history/index.json 追加一条摘要。上限 50 批 / 16 MB，两头都按时间清最老的。

function normalizeBatchEntry(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.batch !== 'string' || !raw.batch) return null
  const ids = (value) => (Array.isArray(value) ? value.filter((id) => typeof id === 'string') : [])
  const diff = raw.diff && typeof raw.diff === 'object' ? raw.diff : {}
  const added = ids(diff.added).slice(0, 500)
  const updated = ids(diff.updated).slice(0, 500)
  const removed = ids(diff.removed).slice(0, 500)
  return {
    batch: raw.batch,
    at: typeof raw.at === 'string' ? raw.at : '',
    author: raw.author === 'agent' || raw.author === 'program' ? raw.author : 'human',
    op: typeof raw.op === 'string' ? raw.op : 'ops',
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    reverted: typeof raw.reverted === 'string' ? raw.reverted : null,
    revBefore: typeof raw.revBefore === 'string' ? raw.revBefore : null,
    revAfter: typeof raw.revAfter === 'string' ? raw.revAfter : null,
    diff: { added, updated, removed },
    counts: { added: added.length, updated: updated.length, removed: removed.length },
    labels: raw.labels && typeof raw.labels === 'object' && !Array.isArray(raw.labels) ? raw.labels : {},
    bytes: typeof raw.bytes === 'number' && Number.isFinite(raw.bytes) ? raw.bytes : 0,
  }
}

async function readHistoryIndex(files) {
  const empty = { format: HISTORY_FORMAT, batches: [] }
  const stamp = await stampOf(files.historyIndex)
  const cached = historyCache.get(files.historyIndex)
  if (cached && cached.stamp === stamp) {
    cacheCounters.historyHits += 1
    return cached.index
  }
  cacheCounters.historyMisses += 1
  let index
  try {
    const raw = await readJson(files.historyIndex)
    index = raw && Array.isArray(raw.batches)
      ? { format: HISTORY_FORMAT, batches: raw.batches.map(normalizeBatchEntry).filter(Boolean).slice(-HISTORY_LIMIT) }
      : empty
  } catch {
    // 历史读不动不该毁掉板子：当它没有
    index = empty
  }
  historyCache.set(files.historyIndex, { stamp, index })
  return index
}

/** 最近若干批（旧→新，带索引里保留的 diff/labels）。给 /history 无参与旧客户端用。 */
export async function readHistory(projectPath, opts = {}) {
  const files = boardFiles(projectPath, opts.dataDir)
  const index = await readHistoryIndex(files)
  return index.batches
}

/** v1.17 A3：只要摘要（/state 与 /rev 用），不带 diff/labels。 */
export async function readHistorySummaries(projectPath, opts = {}) {
  const files = boardFiles(projectPath, opts.dataDir)
  const index = await readHistoryIndex(files)
  return index.batches.map(summaryOfBatch)
}

/**
 * v1.17 A2：since 之后的新批摘要（旧→新）。
 * since 未知就退回全部摘要（客户端会重拉一次 state 兜底）；没有新批返回 []。
 */
export async function readHistorySince(projectPath, sinceBatch, opts = {}) {
  const files = boardFiles(projectPath, opts.dataDir)
  const index = await readHistoryIndex(files)
  const at = typeof sinceBatch === 'string' && sinceBatch ? index.batches.findIndex((item) => item.batch === sinceBatch) : -1
  const rest = at >= 0 ? index.batches.slice(at + 1) : index.batches
  return rest.map(summaryOfBatch)
}

/**
 * v1.17 A3：单批详情。最近 20 批有 diff、最近 10 批有 labels；
 * 更老或已不在索引里只回摘要并标 detailTrimmed（快照文件另在，回滚不靠它）。
 */
export async function readHistoryBatch(projectPath, batchId, opts = {}) {
  const files = boardFiles(projectPath, opts.dataDir)
  const index = await readHistoryIndex(files)
  const keptBatches = index.batches.length
  const at = typeof batchId === 'string' ? index.batches.findIndex((item) => item.batch === batchId) : -1
  if (at < 0) return { batch: null, detailTrimmed: true, keptBatches }
  const entry = index.batches[at]
  const fromEnd = keptBatches - 1 - at
  if (fromEnd >= HISTORY_DIFF_KEEP) return { batch: summaryOfBatch(entry), detailTrimmed: true, keptBatches }
  return {
    batch: {
      ...summaryOfBatch(entry),
      diff: entry.diff,
      labels: fromEnd < HISTORY_LABEL_KEEP ? entry.labels : {},
    },
  }
}

/** 件的一句话名字，历史摘要里仍能认出已删的件。 */
function itemLabelOf(item) {
  if (!item || typeof item !== 'object') return ''
  if (typeof item.title === 'string' && item.title) return item.title
  if (typeof item.address === 'string' && item.address) return item.address
  if (typeof item.text === 'string' && item.text) return item.text.replace(/\s+/gu, ' ').slice(0, 40)
  if (typeof item.from === 'string' && typeof item.to === 'string') return `${item.from}→${item.to}`
  return typeof item.id === 'string' ? item.id : ''
}

function labelsFor(preBoard, postBoard, changed) {
  const out = {}
  const findIn = (board, id) => {
    for (const key of ['domains', 'blocks', 'links', 'notes']) {
      const hit = (board[key] || []).find((item) => item.id === id)
      if (hit) return hit
    }
    return undefined
  }
  const ids = [...(changed.added || []), ...(changed.updated || []), ...(changed.removed || [])]
  for (const id of ids.slice(0, HISTORY_LABEL_CAP)) {
    const label = itemLabelOf(findIn(postBoard, id) || findIn(preBoard, id))
    if (label) out[id] = label
  }
  return out
}

function describeJournal(journal) {
  const list = Array.isArray(journal) ? journal : []
  if (!list.length) return '一次改动'
  if (list.length === 1) return list[0].summary || '一次改动'
  const head = list.slice(0, 2).map((entry) => entry.summary).filter(Boolean).join('；')
  return `一批 ${list.length} 件${head ? `：${head}` : ''}${list.length > 2 ? ' …' : ''}`
}

function itemSig(item) {
  const { createdAt, updatedAt, ...rest } = item || {}
  return canonical(rest)
}

/** 两张板子按 id 对差：新增／变化／删除。撤销与回滚的 diff 都用它。 */
export function diffBoards(before, after) {
  const index = (board) => {
    const map = new Map()
    for (const key of ['domains', 'blocks', 'links', 'notes']) {
      for (const item of board[key] || []) map.set(item.id, item)
    }
    return map
  }
  const a = index(before)
  const b = index(after)
  const added = []
  const updated = []
  const removed = []
  for (const [id, item] of b) {
    const old = a.get(id)
    if (!old) added.push(id)
    else if (itemSig(old) !== itemSig(item)) updated.push(id)
  }
  for (const id of a.keys()) if (!b.has(id)) removed.push(id)
  return { added, updated, removed }
}

/**
 * v1.17 A3：写 index 前瘦身。最近 HISTORY_LABEL_KEEP 批留 diff+labels，
 * 最近 HISTORY_DIFF_KEEP 批只留 diff，更老删掉两者只留 counts（快照文件不动）。
 */
function trimIndexEntries(batches) {
  const total = batches.length
  return batches.map((item, index) => {
    const fromEnd = total - 1 - index
    if (fromEnd < HISTORY_LABEL_KEEP) return item
    const { labels, ...withoutLabels } = item
    if (fromEnd < HISTORY_DIFF_KEEP) return withoutLabels
    const { diff, ...bare } = withoutLabels
    return bare
  })
}

/**
 * 记一批历史：写快照 → 追加 index → 清孤儿与超限。
 * 历史是旁路：写失败只告警，不毁掉这次改动。
 */
async function recordBatch(files, info, preBoard, preLayout) {
  try {
    const dir = files.historyDir
    await mkdir(dir, { recursive: true })
    const entry = normalizeBatchEntry({
      ...info,
      diff: info.diff || { added: [], updated: [], removed: [] },
    })
    if (!entry) return
    const snapshotFile = join(dir, `${entry.batch}.json`)
    const snapshot = {
      format: HISTORY_FORMAT,
      kind: 'snapshot',
      batch: entry.batch,
      at: entry.at,
      author: entry.author,
      op: entry.op,
      summary: entry.summary,
      reverted: entry.reverted,
      revBefore: entry.revBefore,
      board: preBoard,
      layout: preLayout,
    }
    await writeAtomic(snapshotFile, `${JSON.stringify(snapshot, null, 2)}\n`)
    entry.bytes = (await stat(snapshotFile)).size

    const current = await readHistoryIndex(files)
    const all = [...current.batches, entry]
    // 孤儿快照（index 里没有的）先清掉
    let names = []
    try {
      names = await readdir(dir)
    } catch {
      names = []
    }
    const referenced = new Set(all.map((item) => `${item.batch}.json`))
    for (const name of names) {
      if (name === 'index.json' || !name.endsWith('.json') || referenced.has(name)) continue
      await unlink(join(dir, name)).catch(() => {})
    }
    // 上限：批数与字节
    let kept = all
    while (kept.length > HISTORY_LIMIT) kept = kept.slice(1)
    let total = kept.reduce((sum, item) => sum + (item.bytes || 0), 0)
    while (total > HISTORY_MAX_BYTES && kept.length > 1) {
      total -= kept[0].bytes || 0
      kept = kept.slice(1)
    }
    const keptIds = new Set(kept.map((item) => item.batch))
    for (const item of all) {
      if (keptIds.has(item.batch)) continue
      await unlink(join(dir, `${item.batch}.json`)).catch(() => {})
    }
    await writeAtomic(files.historyIndex, `${JSON.stringify({ format: HISTORY_FORMAT, batches: trimIndexEntries(kept) }, null, 2)}\n`)
  } catch (error) {
    console.warn(`[structure-desk] 这一批的历史没记上（不影响改动本身）：${error.message}`)
  }
}

/**
 * 唯一的写入口：读 → 校验 baseRev → 打 op → 落盘 → 写 journal → 回新状态。
 * @param {string} projectPath 已规整的绝对路径
 * @param {Array} ops 语义 op 列表（move 请走 applyLayout）
 */
export function mutate(projectPath, ops, opts = {}) {
  return enqueue(projectPath, async () => {
    const files = boardFiles(projectPath, opts.dataDir)
    const rawBoard = await readJson(files.board)
    const board = rawBoard ? normalizeBoard(rawBoard, projectPath) : newBoard(projectPath, opts.name)
    const rev = revOf(board)
    // 板子还不存在时没有可冲突的旧版本（客户端手里的空板子 rev 是算出来的，不作数）
    if (rawBoard && opts.baseRev && opts.baseRev !== rev) {
      const error = httpError(409, `板子已经变过（${rev}），请重新载入再改`)
      error.rev = rev
      throw error
    }
    const at = opts.at || new Date().toISOString()
    // 快照要的是「这一批动手之前」的坐标：/ops 里的 move 在这之后才写 layout，
    // 所以这里先读，回滚时才能把这一批挪过的件也一起退回去。
    const preLayout = normalizeLayout(await readJson(files.layout))
    const { board: next, changed, journal, errors, results } = applyOps(board, ops, {
      author: opts.author || 'human',
      at,
    })
    // v1.14：一次 mutate = 一批（同一 batch id，同一时间戳）。
    const batch = newBatchId(new Date(at))
    // 扫描这类一次动上百个件的，把逐条 journal 合成一条，别把日志刷满
    const entries = (opts.summary
      ? [
          {
            at,
            author: opts.author || 'program',
            op: opts.summaryOp || 'batch',
            target: null,
            summary: opts.summary,
            diff: { added: changed.added, updated: changed.updated, removed: changed.removed },
          },
        ]
      : journal
    ).map((entry) => ({ ...entry, batch }))
    const touched = changed.added.length + changed.updated.length + changed.removed.length > 0
    if (touched) {
      await writeAtomic(files.board, `${JSON.stringify(next, null, 2)}\n`)
      await appendJournal(files, entries)
      await recordBatch(
        files,
        {
          batch,
          at,
          author: opts.author || (opts.summary ? 'program' : 'human'),
          op: opts.summary ? opts.summaryOp || 'batch' : 'ops',
          summary: opts.summary || describeJournal(journal),
          revBefore: rev,
          revAfter: revOf(next),
          diff: changed,
          labels: labelsFor(board, next, changed),
        },
        board,
        preLayout,
      )
      // v1.17 A4：板子与历史索引刚写过，读缓存立刻失效
      dropCache(projectPath, opts)
    }
    const { stats, gaps, coverage } = derived(next)
    return {
      project: { path: projectPath, name: next.project.name },
      board: next,
      layout: preLayout,
      rev: revOf(next),
      stats,
      gaps,
      coverage,
      journalTail: await readJournalTail(projectPath, opts),
      history: await readHistorySummaries(projectPath, opts),
      changed: { ...changed, journal, errors, results, batch: touched ? batch : null },
      exists: true,
    }
  })
}

/**
 * 整板替换：撤销／重做用。也要 baseRev 校验——期间智能体改过就不许覆盖。
 */
export function replaceBoard(projectPath, nextBoard, opts = {}) {
  return enqueue(projectPath, async () => {
    const files = boardFiles(projectPath, opts.dataDir)
    const rawBoard = await readJson(files.board)
    const current = rawBoard ? normalizeBoard(rawBoard, projectPath) : newBoard(projectPath, opts.name)
    const rev = revOf(current)
    if (rawBoard && opts.baseRev && opts.baseRev !== rev) {
      const error = httpError(409, `板子已经变过（${rev}），撤销需要先重新载入`)
      error.rev = rev
      throw error
    }
    const preLayout = normalizeLayout(await readJson(files.layout))
    const board = normalizeBoard({ ...nextBoard, project: current.project, format: current.format }, projectPath)
    board.updatedAt = new Date().toISOString()
    const batch = newBatchId()
    const diff = diffBoards(current, board)
    const summary = opts.summary || '整板替换（撤销／重做）'
    await writeAtomic(files.board, `${JSON.stringify(board, null, 2)}\n`)
    await appendJournal(files, [
      {
        at: board.updatedAt,
        author: opts.author || 'human',
        op: 'replace',
        batch,
        target: null,
        summary,
        diff,
      },
    ])
    await recordBatch(
      files,
      {
        batch,
        at: board.updatedAt,
        author: opts.author || 'human',
        op: 'replace',
        summary,
        revBefore: rev,
        revAfter: revOf(board),
        diff,
        labels: labelsFor(current, board, diff),
      },
      current,
      preLayout,
    )
    // v1.17 A4：板子与历史索引刚写过，读缓存立刻失效
    dropCache(projectPath, opts)
    const { stats, gaps, coverage } = derived(board)
    return {
      project: { path: projectPath, name: board.project.name },
      board,
      layout: preLayout,
      rev: revOf(board),
      stats,
      gaps,
      coverage,
      journalTail: await readJournalTail(projectPath, opts),
      history: await readHistorySummaries(projectPath, opts),
      changed: { ...diff, journal: [], errors: [], results: [], batch },
      exists: true,
    }
  })
}

/**
 * 回滚一批（v1.14）：拿这一批动手前的快照整板恢复（board + layout）。
 * 回滚本身也记一批 journal + 历史，所以时间轴上看得见「退了一次」。
 * 只许退最近一批由客户端把关；API 侧只认 baseRev——防止盖掉别人刚写的。
 */
export function revertBatch(projectPath, batchId, opts = {}) {
  return enqueue(projectPath, async () => {
    if (typeof batchId !== 'string' || !batchId) throw httpError(400, 'batch 要是一个 id')
    const files = boardFiles(projectPath, opts.dataDir)
    const history = await readHistoryIndex(files)
    const target = history.batches.find((item) => item.batch === batchId)
    if (!target) throw httpError(404, `历史里没有这一批：${batchId}（可能已超出保留的 ${HISTORY_LIMIT} 批）`)
    const snapshot = await readJson(join(files.historyDir, `${batchId}.json`))
    if (!snapshot || !snapshot.board) throw httpError(410, `这一批的快照丢了：${batchId}`)

    const rawBoard = await readJson(files.board)
    const current = rawBoard ? normalizeBoard(rawBoard, projectPath) : newBoard(projectPath, opts.name)
    const rev = revOf(current)
    if (rawBoard && opts.baseRev && opts.baseRev !== rev) {
      const error = httpError(409, `板子已经变过（${rev}），回滚要先重新载入`)
      error.rev = rev
      throw error
    }
    const preLayout = normalizeLayout(await readJson(files.layout))
    const restored = normalizeBoard(snapshot.board, projectPath)
    const restoredLayout = normalizeLayout(snapshot.layout)
    const at = new Date().toISOString()
    const batch = newBatchId()
    restored.updatedAt = at
    await writeAtomic(files.board, `${JSON.stringify(restored, null, 2)}\n`)
    await writeAtomic(files.layout, `${JSON.stringify(restoredLayout, null, 2)}\n`)
    const diff = diffBoards(current, restored)
    const summary = `回滚到「${target.summary || target.batch}」之前`
    await appendJournal(files, [
      {
        at,
        author: opts.author || 'human',
        op: 'revert',
        batch,
        target: null,
        summary,
        reverted: batchId,
        diff,
      },
    ])
    await recordBatch(
      files,
      {
        batch,
        at,
        author: opts.author || 'human',
        op: 'revert',
        summary,
        reverted: batchId,
        revBefore: rev,
        revAfter: revOf(restored),
        diff,
        labels: labelsFor(current, restored, diff),
      },
      current,
      preLayout,
    )
    // v1.17 A4：板子／坐标／历史索引刚写过，读缓存立刻失效
    dropCache(projectPath, opts)
    const { stats, gaps, coverage } = derived(restored)
    return {
      project: { path: projectPath, name: restored.project.name },
      board: restored,
      layout: restoredLayout,
      rev: revOf(restored),
      stats,
      gaps,
      coverage,
      journalTail: await readJournalTail(projectPath, opts),
      history: await readHistorySummaries(projectPath, opts),
      changed: { ...diff, journal: [], errors: [], results: [], batch, reverted: batchId },
      reverted: batchId,
      exists: true,
    }
  })
}

/** 只动 layout：坐标／尺寸／折叠／视口。不碰 board，不进 rev，不进 journal。 */
export function applyLayout(projectPath, patch, opts = {}) {
  return enqueue(projectPath, async () => {
    const files = boardFiles(projectPath, opts.dataDir)
    const layout = normalizeLayout(await readJson(files.layout))
    if (patch && typeof patch === 'object') {
      if (patch.positions && typeof patch.positions === 'object') {
        for (const [id, pos] of Object.entries(patch.positions)) {
          if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') continue
          layout.pos[id] = { x: Math.round(pos.x), y: Math.round(pos.y) }
        }
      }
      if (patch.sizes && typeof patch.sizes === 'object') {
        for (const [id, size] of Object.entries(patch.sizes)) {
          if (!size || typeof size.w !== 'number' || typeof size.h !== 'number') continue
          layout.size[id] = { w: Math.round(size.w), h: Math.round(size.h) }
        }
      }
      if (Array.isArray(patch.collapsed)) layout.collapsed = patch.collapsed.filter((x) => typeof x === 'string')
      if (patch.view && typeof patch.view === 'object') {
        layout.view = {
          x: Number(patch.view.x) || 0,
          y: Number(patch.view.y) || 0,
          zoom: Number(patch.view.zoom) || 1,
        }
      }
    }
    await writeAtomic(files.layout, `${JSON.stringify(layout, null, 2)}\n`)
    // v1.17 A4：坐标写过，含 layout 的读缓存立刻失效
    dropCache(projectPath, opts)
    return layout
  })
}

/** 删掉一个节点的坐标（删节点时顺手清）。 */
export async function forgetLayout(projectPath, ids, opts = {}) {
  if (!ids || !ids.length) return
  return enqueue(projectPath, async () => {
    const files = boardFiles(projectPath, opts.dataDir)
    const layout = normalizeLayout(await readJson(files.layout))
    for (const id of ids) {
      delete layout.pos[id]
      delete layout.size[id]
      layout.collapsed = layout.collapsed.filter((x) => x !== id)
    }
    await writeAtomic(files.layout, `${JSON.stringify(layout, null, 2)}\n`)
    dropCache(projectPath, opts)
    return layout
  })
}

// ── 最近项目 ──────────────────────────────────────────────────────

/** 记住一个项目，供面板首屏「最近」用。 */
export async function rememberRecent(projectPath, name) {
  try {
    const file = recentFile()
    const raw = await readJson(file)
    const list = Array.isArray(raw?.projects) ? raw.projects : []
    const rest = list.filter((item) => item && item.path !== projectPath)
    rest.unshift({ path: projectPath, name: name || '', updatedAt: new Date().toISOString() })
    await writeAtomic(file, `${JSON.stringify({ projects: rest.slice(0, RECENT_LIMIT) }, null, 2)}\n`)
  } catch {
    // 记不住最近项目不该毁掉一次正常写入
  }
}

/** 最近项目清单。 */
export async function listRecent() {
  const raw = await readJson(recentFile()).catch(() => undefined)
  const list = Array.isArray(raw?.projects) ? raw.projects : []
  return list
    .filter((item) => item && typeof item.path === 'string' && existsSync(item.path))
    .slice(0, RECENT_LIMIT)
}

// ── 导出 ──────────────────────────────────────────────────────────

/** 把两页 Markdown 写到数据目录里，返回写成功的文件清单。 */
export async function writeExports(projectPath, texts, opts = {}) {
  const files = boardFiles(projectPath, opts.dataDir)
  const written = []
  for (const [target, text] of [
    [files.brief, texts.brief],
    [files.register, texts.register],
  ]) {
    if (typeof text !== 'string') continue
    await writeAtomic(target, text.endsWith('\n') ? text : `${text}\n`)
    const info = await stat(target)
    written.push({ path: target, bytes: info.size })
  }
  // v1.17 A4：导出的两页走板子内容，写路径统一失效缓存
  dropCache(projectPath, opts)
  return written
}

/** 板子内容指纹，工具层回报时带一句。 */
export function fingerprint(board) {
  return createHash('sha1').update(canonical(board)).digest('hex').slice(0, 12)
}

/**
 * 扫描被分析项目，把「块」对进板子：新增／变化／失联，一次一条 journal。
 * 不动域与连接——人写的说法说了算。
 * @returns {Promise<{state:object, scan:object}>}
 */
export async function scanInto(projectPath, opts = {}) {
  const before = await readState(projectPath, { dataDir: opts.dataDir, journalLimit: opts.journalLimit })
  if (opts.baseRev && opts.baseRev !== before.rev) {
    const error = httpError(409, `板子已经变过（${before.rev}），请重新载入再扫描`)
    error.rev = before.rev
    throw error
  }
  const { scanProject, diffScan } = await import('./scan.js')
  const scan = await scanProject(projectPath, {
    root: typeof opts.root === 'string' ? opts.root : '',
    limit: opts.limit,
    dataDir: opts.dataDir,
  })
  const diff = diffScan(before.board.blocks, scan.files)
  const ops = []
  for (const file of diff.added) {
    ops.push({ op: 'add_block', path: file.path, lang: file.lang, bytes: file.bytes, lines: file.lines, sha: file.sha })
  }
  for (const pair of diff.changed) {
    ops.push({
      op: 'update_block',
      id: pair.block.id,
      bytes: pair.file.bytes,
      lines: pair.file.lines,
      sha: pair.file.sha,
      lang: pair.file.lang,
      stale: false,
    })
  }
  for (const pair of diff.same) {
    if (pair.block.stale) ops.push({ op: 'update_block', id: pair.block.id, stale: false })
  }
  for (const block of diff.removed) {
    ops.push({ op: 'update_block', id: block.id, stale: true })
  }
  const scanInfo = {
    added: diff.added.length,
    changed: diff.changed.length,
    removed: diff.removed.length,
    same: diff.same.length,
    skipped: scan.skipped || 0,
    truncated: scan.truncated === true,
    files: scan.counts?.files || scan.files?.length || 0,
  }
  const summary = `扫描 ${scanInfo.files} 个文件：新增 ${scanInfo.added}／变化 ${scanInfo.changed}／失联 ${scanInfo.removed}`
  const state = ops.length
    ? await mutate(projectPath, ops, {
        baseRev: opts.baseRev,
        dataDir: opts.dataDir,
        author: 'program',
        summary,
        summaryOp: 'scan',
        journalLimit: opts.journalLimit,
      })
    : { ...before, changed: { added: [], updated: [], removed: [], journal: [], errors: [] } }
  // v1.16：新收的实块可能让计划块落地——给一条启发式建议，只随回包走，不落盘（契约 G1）
  const addedIds = state.changed && Array.isArray(state.changed.added) ? state.changed.added : []
  scanInfo.suggestions = suggestGrounds(state.board, addedIds)
  await rememberRecent(projectPath, state.project.name)
  return { state, scan: scanInfo, summary }
}
