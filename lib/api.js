// 结构台 · 浏览器半边与宿主半边之间的 HTTP 口子
// 只有同源页面能进；只认项目目录里的 `结构蓝图/` 一个写入点。

import { gzipSync } from 'node:zlib'
import { buildBrief, buildRegister } from './brief.js'
import { derived } from './core.js'
import {
  DEFAULT_DATA_DIR,
  applyLayout,
  forgetLayout,
  httpError,
  listRecent,
  mutate,
  readHistory,
  readHistoryBatch,
  readHistorySince,
  readRev,
  readState,
  rememberRecent,
  replaceBoard,
  resolveProject,
  revertBatch,
  scanInto,
  writeExports,
} from './store.js'

export const API_PREFIX = '/structure-desk/api'
const MAX_BODY = 8 * 1024 * 1024
// v1.17 A 组修订：大响应按 accept-encoding 走 gzip；1KB 以下不值当，保持明文
const GZIP_MIN_BYTES = 1024

/**
 * 统一响应出口。大包且请求方接受 gzip 时压缩，并带 x-sd-raw-bytes 供验收／调试；
 * 小包、没带 accept-encoding 的旧客户端与 curl 照旧拿明文。JSON 字段与语义不变。
 */
function sendJson(req, res, status, body) {
  const raw = Buffer.from(JSON.stringify(body), 'utf8')
  const acceptEncoding = (req && req.headers && req.headers['accept-encoding']) || ''
  if (raw.length > GZIP_MIN_BYTES && /gzip/iu.test(acceptEncoding)) {
    const packed = gzipSync(raw)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-encoding': 'gzip',
      vary: 'accept-encoding',
      'content-length': packed.length,
      'x-sd-raw-bytes': raw.length,
    })
    res.end(packed)
    return
  }
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': raw.length,
  })
  res.end(raw)
}

/** 只收同源 JSON 的 POST。 */
function readJson(req) {
  return new Promise((resolve, reject) => {
    if (req.method !== 'POST') return reject(Object.assign(httpError(405, '只接 POST'), { status: 405 }))
    const type = req.headers['content-type'] || ''
    if (!/^application\/json\b/.test(type)) return reject(httpError(415, '要 application/json'))
    const origin = req.headers.origin
    if (origin) {
      const host = req.headers.host
      try {
        if (new URL(origin).host !== host) return reject(httpError(403, '跨源请求不收'))
      } catch {
        return reject(httpError(403, '来源看不懂'))
      }
    }
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        req.destroy()
        reject(httpError(413, '请求太大'))
      } else {
        chunks.push(chunk)
      }
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve(text ? JSON.parse(text) : {})
      } catch {
        reject(httpError(400, 'JSON 解析不了'))
      }
    })
    req.on('error', reject)
  })
}

/** /state?parts= 支持的状态段；journal 段回包字段沿用 journalTail。 */
const STATE_PARTS = new Map([
  ['board', 'board'],
  ['layout', 'layout'],
  ['stats', 'stats'],
  ['gaps', 'gaps'],
  ['coverage', 'coverage'],
  ['history', 'history'],
  ['journal', 'journal'],
  ['journalTail', 'journal'],
])

/**
 * 解析 ?parts=：缺省／空 → null（全量）；未知段忽略（v1.17 A2）。
 * @returns {Set<string>|null}
 */
function parseParts(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const picked = new Set()
  for (const item of raw.split(',')) {
    const name = STATE_PARTS.get(item.trim())
    if (name) picked.add(name)
  }
  return picked
}

/**
 * 状态回包里只带界面要用的东西。parts 给定时只回请求的段，project／rev 恒带（v1.17 A2）；
 * 未请求的字段不出现。
 */
function payload(state, extra = {}, parts = null) {
  if (parts) {
    const out = { project: state.project, rev: state.rev }
    for (const part of parts) {
      const key = part === 'journal' ? 'journalTail' : part
      out[key] = state[key]
    }
    return { ...out, ...extra }
  }
  return {
    project: state.project,
    board: state.board,
    layout: state.layout,
    rev: state.rev,
    stats: state.stats,
    gaps: state.gaps,
    coverage: state.coverage,
    journalTail: state.journalTail,
    history: Array.isArray(state.history) ? state.history : [],
    exists: state.exists,
    ...extra,
  }
}

/** 多条 move 合成一次 layout 写。 */
function mergeMoves(moves) {
  const patch = { positions: {}, sizes: {}, collapsed: undefined }
  for (const move of moves) {
    if (move.positions && typeof move.positions === 'object') Object.assign(patch.positions, move.positions)
    if (move.sizes && typeof move.sizes === 'object') Object.assign(patch.sizes, move.sizes)
    if (Array.isArray(move.collapsed)) patch.collapsed = move.collapsed
  }
  return patch
}

/**
 * 造一个 handler，交给 ctx.webServer.register({ kind: 'prefix', ... })。
 * @param {{dataDir?: () => string}} options
 */
export function createApi(options = {}) {
  const dataDir = () => options.dataDir?.() || DEFAULT_DATA_DIR

  return async function handle(req, res) {
    // 所有出口都从这里走：sendJson 需要看 accept-encoding 决定是否 gzip
    const reply = (status, body) => sendJson(req, res, status, body)
    let url
    try {
      url = new URL(req.url || '/', 'http://localhost')
    } catch {
      return reply(400, { error: '地址看不懂' })
    }
    const route = url.pathname.startsWith(API_PREFIX) ? url.pathname.slice(API_PREFIX.length) : url.pathname
    try {
      if (route === '/ping') return reply(200, { ok: true, name: 'structure-desk', dataDir: dataDir() })

      if (route === '/recent') {
        if (req.method !== 'GET') return reply(405, { error: '只接 GET' })
        return reply(200, { projects: await listRecent() })
      }

      if (route === '/bind') {
        const body = await readJson(req)
        const project = await resolveProject(body.project)
        const state = await readState(project, { dataDir: dataDir() })
        await rememberRecent(project, state.project.name)
        return reply(200, { project: state.project, exists: state.exists })
      }

      if (route === '/state') {
        if (req.method !== 'GET') return reply(405, { error: '只接 GET' })
        const project = await resolveProject(url.searchParams.get('project'))
        const parts = parseParts(url.searchParams.get('parts'))
        // v1.17 A2：parts 允许只取某几段；缺省仍是全量（旧客户端能用）
        const state = await readState(project, { dataDir: dataDir(), parts })
        await rememberRecent(project, state.project.name)
        return reply(200, payload(state, {}, parts))
      }

      // v1.17 A2：9 秒轮询先问 /rev（≤2KB、走读缓存），rev 没变就不拉 /state
      if (route === '/rev') {
        if (req.method !== 'GET') return reply(405, { error: '只接 GET' })
        const project = await resolveProject(url.searchParams.get('project'))
        return reply(200, await readRev(project, { dataDir: dataDir() }))
      }

      // v1.14：历史摘要；v1.17 A2/A3 追加 ?since= 增量与 ?batch= 单批详情
      if (route === '/history') {
        if (req.method !== 'GET') return reply(405, { error: '只接 GET' })
        const project = await resolveProject(url.searchParams.get('project'))
        const batchId = url.searchParams.get('batch')
        if (batchId) return reply(200, await readHistoryBatch(project, batchId, { dataDir: dataDir() }))
        const since = url.searchParams.get('since')
        if (since) return reply(200, { batches: await readHistorySince(project, since, { dataDir: dataDir() }) })
        const batches = await readHistory(project, { dataDir: dataDir() })
        return reply(200, { batches })
      }

      // v1.14：回滚到某一批动手之前（整板 + 坐标）；回滚本身也记一批
      if (route === '/revert') {
        const body = await readJson(req)
        const project = await resolveProject(body.project)
        if (typeof body.batch !== 'string' || !body.batch) throw httpError(400, 'batch 要是一个 id')
        const state = await revertBatch(project, body.batch, {
          baseRev: body.baseRev,
          dataDir: dataDir(),
          author: body.author === 'agent' ? 'agent' : 'human',
        })
        await rememberRecent(project, state.project.name)
        return reply(200, payload(state, { changed: state.changed, reverted: state.reverted }))
      }

      if (route === '/brief') {
        if (req.method !== 'GET') return reply(405, { error: '只接 GET' })
        const project = await resolveProject(url.searchParams.get('project'))
        const state = await readState(project, { dataDir: dataDir() })
        return reply(200, {
          markdown: buildBrief(state.board, state.gaps, state.stats, { locale: 'zh' }),
          register: buildRegister(state.board, state.gaps, state.stats),
          rev: state.rev,
        })
      }

      if (route === '/ops') {
        const body = await readJson(req)
        const project = await resolveProject(body.project)
        const author = body.author === 'agent' ? 'agent' : 'human'
        const ops = Array.isArray(body.ops) ? body.ops : []
        const moves = ops.filter((op) => op && op.op === 'move')
        const semantic = ops.filter((op) => op && op.op !== 'move')
        // v1.17 A1：只有 move 时回增量（layoutOnly），不搬 board／stats／gaps／history／journal。
        // body.full === true 强制全量（调试／旧调用）。
        if (!body.replace && body.full !== true && moves.length > 0 && semantic.length === 0) {
          const head = await readRev(project, { dataDir: dataDir() })
          const layout = await applyLayout(project, mergeMoves(moves), { dataDir: dataDir() })
          await rememberRecent(project, head.project.name)
          return reply(200, {
            project: head.project,
            rev: head.rev,
            layout,
            changed: { added: [], updated: [], removed: [], errors: [] },
            layoutOnly: true,
            batch: null,
          })
        }
        let state
        if (body.replace && typeof body.replace === 'object') {
          state = await replaceBoard(project, body.replace, {
            baseRev: body.baseRev,
            dataDir: dataDir(),
            author,
            summary: typeof body.summary === 'string' ? body.summary : undefined,
          })
        } else if (semantic.length) {
          state = await mutate(project, semantic, { baseRev: body.baseRev, dataDir: dataDir(), author })
        } else {
          state = await readState(project, { dataDir: dataDir() })
        }
        if (moves.length) {
          state.layout = await applyLayout(project, mergeMoves(moves), { dataDir: dataDir() })
        }
        const removed = state.changed && Array.isArray(state.changed.removed) ? state.changed.removed : []
        if (removed.length) await forgetLayout(project, removed, { dataDir: dataDir() })
        await rememberRecent(project, state.project.name)
        return reply(200, payload(state, { changed: state.changed }))
      }

      if (route === '/scan') {
        const body = await readJson(req)
        const project = await resolveProject(body.project)
        const limit = Number.isFinite(body.limit) ? Math.max(1, Math.min(4000, body.limit)) : undefined
        // v1.16：scan 对象里带 suggestions（落地建议，不落盘），这里原样透传；changed.errors 也带 code
        const { state, scan: scanInfo } = await scanInto(project, {
          baseRev: body.baseRev,
          dataDir: dataDir(),
          root: typeof body.root === 'string' ? body.root : '',
          limit,
        })
        return reply(200, payload(state, { scan: scanInfo, changed: state.changed }))
      }

      if (route === '/export') {
        const body = await readJson(req)
        const project = await resolveProject(body.project)
        const state = await readState(project, { dataDir: dataDir() })
        const brief = buildBrief(state.board, state.gaps, state.stats, { locale: 'zh' })
        const register = buildRegister(state.board, state.gaps, state.stats)
        const files = await writeExports(project, { brief, register }, { dataDir: dataDir() })
        return reply(200, { files, brief, rev: state.rev })
      }

      return reply(404, { error: `没有这个口子：${route}` })
    } catch (error) {
      const status = error && error.status ? error.status : 500
      const message = error instanceof Error ? error.message : String(error)
      if (status === 409) {
        // 409 带上当前 rev（store 抛错时挂在 error.rev 上），客户端好重新载入
        return reply(409, { error: message, rev: error && error.rev ? error.rev : undefined })
      }
      return reply(status, { error: message })
    }
  }
}

export { API_PREFIX as prefix, derived as derive }
