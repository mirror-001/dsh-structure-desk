// 结构台 · 给智能体的那一个工具
// 一个 action ＋ 一批 op：分域要能一口气建几个域、盖几十条覆盖，而不是一次一个。

import { buildBrief, buildRegister } from './brief.js'
import { DEFAULT_DATA_DIR, listRecent, mutate, readState, rememberRecent, resolveProject, scanInto, writeExports } from './store.js'

const OP_NAMES = [
  'add_domain',
  'update_domain',
  'add_block',
  'update_block',
  'add_link',
  'update_link',
  'remove',
  'add_note',
  'update_note',
]

const DESCRIPTION = `Read and edit the project's structure board — the same board the human sees in the 结构台 (Structure Desk) panel. Domains are what people say; blocks are what exists; links say how they relate. Every cell carries its author, so mark your work as yours instead of overwriting the human's words.

Vocabulary
- domain (域): a claim or idea — what a part of the project is FOR. Fields: title, statement (the claim), criteria (one testable line: what counts as done; trimmed to ≤300 chars), status solid|thin|rift|open, tags, note, parent (nest a domain inside another).
- block (块): a fact. Real blocks are project files (path, lang, bytes, sha) created by \`scan\`; planned blocks (planned:true, kind:plan) are things you intend to build.
- link (连接), eight types: covers 域→块 (this domain owns that block), refines 域→域, contradicts any (two claims fight), depends 块→块, calls 块→块, plans 域→计划块, grounds 计划块→实块, relates any (weak).
- Layer (层): comes from author — human (the panel), agent (you), program (the scanned fact base). Domains and planned blocks are statements/plans owned by a layer: you can rewrite only your own (agent) layer's. Another layer's claim is read-only and the op fails with code 'layer-readonly' — do not overwrite it; propose instead: add your own domain or planned block and link it with relates/contradicts, and let the human merge. Real blocks, links and notes carry no layer guard.
- Four gaps are COMPUTED, never stored: unannotated (real blocks no domain covers), ungrounded (domains that claim nothing and nest nothing), planOpen (planned blocks not grounded), conflicts (contradicts links). They are neutral facts, not errors — never "fix" them by inventing content. gaps.byLayer splits them by layer (human/agent: ungrounded + planOpen; program: unannotated) for dividing work between human and agent.

Actions
- read: compact board (stats, gaps, domains, blocks, links, notes). \`focus\` limits it to one node's 1-hop neighbourhood. Domains include criteria.
- gaps: the four gap groups with human-readable labels, plus byLayer counts.
- brief: one-page Markdown brief of the board (conclusions first, ≤200 lines).
- write: apply a batch of ops in ONE call. Failed ops are reported individually and do not abort the batch.
- scan: walk the project files and add/update blocks (added/changed/lost). Returns suggestions (up to 5) of planned blocks that may now be grounded, each {plannedId, realId, score, reason}; they are advisory and not saved — add a grounds link once you believe it. It never touches domains or links.
- export: write 简报.md and 域录.md into <project>/结构蓝图/.

Write ops
add_domain{title, statement?, criteria?, parent?, status?, tags?, note?} · update_domain{id, title?, statement?, criteria?, parent?, status?, tags?, note?} ·
add_block{path, symbol?, planned?, kind?, note?} · update_block{id, path?, note?, planned?, ground?, stale?} ·
add_link{from, to, type, note?} · update_link{id, type?, note?} · remove{id} · add_note{text, ref?, color?} · update_note{id, text?, ref?, color?}
criteria is trimmed to ≤300 chars; pass '' to clear it. Nodes can be referenced by id ("D3"), by block path ("src/app.ts" or "src/app.ts:main"), or by domain title.
The human edits the same board, so writes are guarded by the board revision: a stale write fails with an explicit message — re-read, then retry.`

const objectSchema = { type: 'object', additionalProperties: true }

function textResult(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 1) }]
}

function labelDomain(domain) {
  return `${domain.id}「${domain.title}」`
}

function labelBlock(block) {
  const mark = block.planned ? '（计划）' : block.stale ? '（失联）' : ''
  return `${block.id} ${block.address}${mark}`
}

/** 按层落差只给计数（v1.16）：不把 id 列表整份塞给模型。 */
function byLayerCounts(byLayer) {
  const counts = byLayer && typeof byLayer === 'object' ? byLayer : {}
  const group = (layer, keys) => {
    const row = counts[layer] && typeof counts[layer] === 'object' ? counts[layer] : {}
    const out = {}
    for (const key of keys) out[key] = Array.isArray(row[key]) ? row[key].length : 0
    return out
  }
  return {
    human: group('human', ['ungrounded', 'planOpen']),
    agent: group('agent', ['ungrounded', 'planOpen']),
    program: group('program', ['unannotated']),
  }
}

/** 把域／块／连接收成一份紧凑的人可读摘要。 */
function digest(board, gaps, stats) {
  return {
    stats,
    gaps: {
      unannotated: gaps.unannotated.map((id) => labelBlock(board.blocks.find((b) => b.id === id))).filter(Boolean),
      ungrounded: gaps.ungrounded.map((id) => labelDomain(board.domains.find((d) => d.id === id))).filter(Boolean),
      planOpen: gaps.planOpen.map((id) => labelBlock(board.blocks.find((b) => b.id === id))).filter(Boolean),
      conflicts: gaps.conflicts,
      byLayer: byLayerCounts(gaps.byLayer),
    },
  }
}

/** read：紧凑板子。focus 时只给 1 跳邻域。 */
function readView(board, gaps, stats, options = {}) {
  const focus = options.focus
  const includeDomains = options.scope !== 'blocks'
  const includeBlocks = options.scope !== 'domains'
  let domains = board.domains
  let blocks = board.blocks
  let links = board.links
  let notes = board.notes

  if (focus) {
    const hit = board.domains.find((d) => d.id === focus || d.title === focus) || board.blocks.find((b) => b.id === focus || b.address === focus || b.path === focus)
    if (!hit) return { error: `focus 没找到：${focus}` }
    const near = new Set([hit.id])
    for (const link of board.links) {
      if (link.from === hit.id) near.add(link.to)
      if (link.to === hit.id) near.add(link.from)
    }
    if (hit.parent) near.add(hit.parent)
    for (const domain of board.domains) if (domain.parent === hit.id) near.add(domain.id)
    domains = board.domains.filter((d) => near.has(d.id))
    blocks = board.blocks.filter((b) => near.has(b.id))
    links = board.links.filter((l) => near.has(l.from) || near.has(l.to))
    notes = board.notes.filter((n) => !n.ref || near.has(n.ref))
  }

  const coveredBy = (id) => board.links.filter((l) => l.type === 'covers' && l.to === id).map((l) => l.from)
  const covers = (id) => board.links.filter((l) => l.type === 'covers' && l.from === id).map((l) => l.to)
  // 大项目别把整块板子倒给模型：截断并明确说截了
  const domainCap = 80
  const blockCap = 200
  const linkCap = 320
  const shownDomains = domains.slice(0, domainCap)
  const shownBlocks = blocks.slice(0, blockCap)
  const shownLinks = links.filter((l) => (!includeDomains || shownDomains.some((d) => d.id === l.from) || shownBlocks.some((b) => b.id === l.from)) && (!includeBlocks || shownDomains.some((d) => d.id === l.to) || shownBlocks.some((b) => b.id === l.to))).slice(0, linkCap)
  const view = {
    rev: options.rev,
    project: board.project,
    focus: focus || null,
    stats,
    gaps: {
      unannotated: gaps.unannotated.length,
      ungrounded: gaps.ungrounded.length,
      planOpen: gaps.planOpen.length,
      conflicts: conflictsOf(board),
      stale: gaps.stale.length,
      byLayer: byLayerCounts(gaps.byLayer),
    },
    domains: includeDomains ? shownDomains.map((d) => ({
          id: d.id,
          title: d.title,
          statement: d.statement,
          criteria: d.criteria,
          parent: d.parent,
          status: d.status,
          author: d.author,
          tags: d.tags,
          note: d.note,
          covers: covers(d.id),
          children: board.domains.filter((x) => x.parent === d.id).map((x) => x.id),
        })) : undefined,
    blocks: includeBlocks ? shownBlocks.map((b) => ({
          id: b.id,
          address: b.address,
          kind: b.kind,
          lang: b.lang,
          planned: b.planned,
          stale: b.stale,
          ground: b.ground,
          note: b.note,
          author: b.author,
          coveredBy: coveredBy(b.id),
        })) : undefined,
    links: shownLinks.map((l) => ({ id: l.id, from: l.from, to: l.to, type: l.type, note: l.note })),
    notes: notes.slice(0, 60).map((n) => ({ id: n.id, text: n.text, ref: n.ref, author: n.author })),
    truncated: {
      domains: domains.length > shownDomains.length,
      blocks: blocks.length > shownBlocks.length,
      links: links.length > shownLinks.length,
      notes: notes.length > 60,
    },
    domainsTotal: board.domains.length,
    blocksTotal: board.blocks.length,
  }
  // 无损 JSON：undefined 不能过线
  for (const key of Object.keys(view)) if (view[key] === undefined) delete view[key]
  return view
}

function conflictsOf(board) {
  return board.links.filter((l) => l.type === 'contradicts').map((l) => `${l.id} ${l.from}✕${l.to}`)
}

/** 工具没给项目时：先用会话工作目录，再退到最近一个开过的项目。 */
async function projectFor(ctx, args, exec) {
  if (typeof args.project === 'string' && args.project.trim()) return resolveProject(args.project)
  const agent = exec && exec.agent
  const session = agent && agent.session
  const workingDirectory = ctx.get('workingDirectory')
  if (session && workingDirectory && typeof workingDirectory.get === 'function') {
    try {
      const dir = workingDirectory.get(session)
      if (typeof dir === 'string' && dir) return resolveProject(dir)
    } catch {
      // 没有工作目录就往下退
    }
  }
  const recent = await listRecent()
  if (recent.length === 1) return resolveProject(recent[0].path)
  throw new Error(
    recent.length === 0
      ? '还没定项目：传 project（绝对路径），或先在结构台面板里打开一个项目'
      : `有多个最近项目，请传 project：${recent.map((r) => r.path).join(' · ')}`,
  )
}

/** 注册智能体工具。 */
export function registerTools(ctx, options = {}) {
  const tools = ctx.get('tools')
  if (!tools) return () => {}
  const dataDir = () => options.dataDir?.() || DEFAULT_DATA_DIR

  const dispose = tools.register({
    name: 'structure_desk',
    description: DESCRIPTION,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['read', 'gaps', 'brief', 'write', 'scan', 'export'],
          description: 'read the board, list gaps, get the brief, write a batch of ops, scan project files into blocks, or export Markdown.',
        },
        project: {
          type: 'string',
          description: 'Absolute project directory. Defaults to this session\'s working directory, then to the only recent project.',
        },
        focus: {
          type: 'string',
          description: 'read: node id, block path, or domain title — returns only its 1-hop neighbourhood.',
        },
        scope: {
          type: 'string',
          enum: ['all', 'domains', 'blocks'],
          description: 'read: which sections to return. Default all.',
        },
        ops: {
          type: 'array',
          description: 'write: batch of ops, applied in one transaction.',
          items: {
            type: 'object',
            additionalProperties: true,
            required: ['op'],
            properties: { op: { type: 'string', enum: OP_NAMES } },
          },
        },
        root: { type: 'string', description: 'scan: subdirectory relative to the project root.' },
        limit: { type: 'number', description: 'scan: maximum blocks to collect in one pass (default 320).' },
        baseRev: { type: 'string', description: 'Optional revision guard: refuse the write if the board changed since this rev.' },
      },
    },
    output: { schema: { ...objectSchema }, render: textResult },
    async execute(args, exec) {
      const action = args && args.action
      const project = await projectFor(ctx, args || {}, exec)
      const dir = dataDir()

      if (action === 'read' || action === 'gaps') {
        const state = await readState(project, { dataDir: dir })
        await rememberRecent(project, state.project.name)
        const view = readView(state.board, state.gaps, state.stats, { focus: args.focus, scope: args.scope, rev: state.rev })
        return action === 'gaps' ? { project: state.project, ...digest(state.board, state.gaps, state.stats) } : view
      }

      if (action === 'brief') {
        const state = await readState(project, { dataDir: dir })
        return {
          project: state.project,
          rev: state.rev,
          markdown: buildBrief(state.board, state.gaps, state.stats, { locale: 'zh' }),
        }
      }

      if (action === 'write') {
        const ops = Array.isArray(args.ops) ? args.ops : []
        if (!ops.length) throw new Error('write 要带 ops；先 read 再写')
        const state = await mutate(project, ops, { dataDir: dir, author: 'agent', baseRev: args.baseRev })
        const { changed } = state
        return {
          project: state.project,
          rev: state.rev,
          applied: changed.added.length + changed.updated.length + changed.removed.length,
          added: changed.added,
          updated: changed.updated,
          removed: changed.removed,
          errors: changed.errors,
          stats: state.stats,
          gaps: digest(state.board, state.gaps, state.stats).gaps,
        }
      }

      if (action === 'scan') {
        const { state, scan, summary } = await scanInto(project, {
          dataDir: dir,
          baseRev: args.baseRev,
          root: typeof args.root === 'string' ? args.root : '',
          limit: Number.isFinite(args.limit) ? args.limit : undefined,
        })
        return { project: state.project, rev: state.rev, summary, scan, stats: state.stats }
      }

      if (action === 'export') {
        const state = await readState(project, { dataDir: dir })
        const brief = buildBrief(state.board, state.gaps, state.stats, { locale: 'zh' })
        const register = buildRegister(state.board, state.gaps, state.stats)
        const files = await writeExports(project, { brief, register }, { dataDir: dir })
        return { project: state.project, rev: state.rev, files }
      }

      throw new Error(`不认的 action：${action}`)
    },
  })
  return dispose
}
