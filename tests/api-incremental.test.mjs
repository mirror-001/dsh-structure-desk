// 结构台 · v1.17 宿主 A 组接口单测（node --test）
// move-only 增量／GET /rev 轻量／/state?parts／/history?since|batch／索引瘦身 20/10／读缓存 mtime 失效
// ／gzip 传输（A 组修订：>1KB 且 accept-encoding 含 gzip 才压缩）。
// 不起端口：直接 import createApi 的 handler，用 mock req/res 走一遍 HTTP 语义。

import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { API_PREFIX, createApi } from '../lib/api.js'
import { summaryOfBatch } from '../lib/core.js'
import { HISTORY_DIFF_KEEP, HISTORY_LABEL_KEEP, cacheStats, readState } from '../lib/store.js'

const tempRoots = []
// 「最近项目」写临时家目录，别碰真的 ~/.dsh
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'sd-home-'))

const api = createApi()

function tempProject() {
  const root = mkdtempSync(join(tmpdir(), 'sd-api-'))
  tempRoots.push(root)
  return root
}

after(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true })
})

/**
 * 调一次 handler：mock req/res。
 * 返回 {status, headers, json, text, wireBytes, rawBytes}：
 *   wireBytes＝实际传输字节（gzip 时是压缩后）；rawBytes＝未压缩 JSON 字节（gzip 时读 x-sd-raw-bytes）。
 * 传 headers 可模拟 accept-encoding；gzip 回包在这里解压后再解析，拿到的 JSON 与明文等价。
 */
function call(method, pathname, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const bodyText = body === undefined ? '' : JSON.stringify(body)
    const req = {
      method,
      url: pathname,
      headers: { host: 'localhost', 'content-type': 'application/json', ...headers },
      on(event, listener) {
        if (event === 'data') {
          if (bodyText) listener(Buffer.from(bodyText))
        } else if (event === 'end') {
          listener()
        }
      },
    }
    const chunks = []
    const res = {
      status: 0,
      headers: {},
      writeHead(status, responseHeaders) {
        this.status = status
        this.headers = responseHeaders || {}
      },
      end(chunk) {
        if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
        const wire = Buffer.concat(chunks)
        const text = this.headers['content-encoding'] === 'gzip' ? gunzipSync(wire).toString('utf8') : wire.toString('utf8')
        let json = null
        try {
          json = JSON.parse(text)
        } catch {
          json = null
        }
        const rawHeader = this.headers['x-sd-raw-bytes']
        resolve({
          status: this.status,
          headers: this.headers,
          json,
          text,
          wireBytes: wire.length,
          rawBytes: rawHeader === undefined ? wire.length : Number(rawHeader),
        })
      },
    }
    api(req, res).catch(reject)
  })
}

function query(path, params) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== undefined) search.set(key, value)
  return `${API_PREFIX}${path}?${search}`
}

const stateUrl = (project, extra = {}) => query('/state', { project, ...extra })
const revUrl = (project) => query('/rev', { project })
const historyUrl = (project, extra = {}) => query('/history', { project, ...extra })

/** 走 API 写一批，返回回包。 */
async function seed(project, ops, extra = {}) {
  const response = await call('POST', `${API_PREFIX}/ops`, { project, author: 'human', ops, ...extra })
  assert.equal(response.status, 200, `写失败：${response.text}`)
  return response
}

/**
 * 300 块合成夹具（40 域／300 块（270 实+30 计划）／799 连接／30 便签），
 * 给 gzip 传输字节断言用。直接写 board.json + layout.json 到临时项目，不进产品目录。
 */
function bigProject() {
  const project = tempProject()
  mkdirSync(join(project, '结构蓝图'), { recursive: true })
  const at = '2026-11-09T00:00:00.000Z'
  const domains = []
  for (let index = 1; index <= 40; index += 1) {
    domains.push({
      id: `D${index}`,
      title: `域 ${index}`,
      statement: `第 ${index} 个域的说法：负责一块能力边界与验收口径。`,
      criteria: index % 3 === 0 ? `判据 ${index}：相关测试通过且日志可查` : '',
      parent: null,
      status: 'solid',
      tags: [],
      note: '',
      author: index % 5 === 0 ? 'agent' : 'human',
      createdAt: at,
      updatedAt: at,
    })
  }
  const blocks = []
  for (let index = 1; index <= 300; index += 1) {
    const planned = index > 270
    const path = planned ? `future/plan-${index}.js` : `src/module-${index}/file-${index}.js`
    blocks.push({
      id: `B${index}`,
      path,
      symbol: null,
      kind: planned ? 'plan' : 'file',
      lang: 'js',
      bytes: planned ? 0 : 1100 + index,
      lines: planned ? 0 : 40,
      sha: planned ? null : 'abcd1234',
      address: path,
      planned,
      ground: null,
      stale: false,
      note: '',
      author: planned ? (index % 2 ? 'agent' : 'human') : 'program',
      createdAt: at,
      updatedAt: at,
    })
  }
  const links = []
  const link = (from, to, type) => links.push({ id: `L${links.length + 1}`, from, to, type, note: '', author: 'human', createdAt: at })
  for (let index = 1; index <= 270; index += 1) link(`D${(index % 40) + 1}`, `B${index}`, 'covers')
  for (let index = 271; index <= 300; index += 1) link(`D${(index % 40) + 1}`, `B${index}`, 'plans')
  for (let index = 271; index <= 300; index += 1) link(`B${index}`, `B${index - 270}`, 'grounds')
  let cursor = 1
  while (links.length < 799) {
    link(`B${cursor}`, `B${cursor + 1}`, 'depends')
    cursor = (cursor % 269) + 1
  }
  const notes = []
  for (let index = 1; index <= 30; index += 1) {
    notes.push({ id: `N${index}`, text: `第 ${index} 条便签：记录一个待办。`, ref: `B${index * 3}`, color: 'amber', author: 'human', createdAt: at, updatedAt: at })
  }
  const board = {
    format: 'structure-desk/1',
    project: { path: project, name: 'perf300' },
    title: 'perf300 · 结构蓝图',
    createdAt: at,
    updatedAt: at,
    seq: { D: 40, B: 300, L: 799, N: 30 },
    domains,
    blocks,
    links,
    notes,
  }
  writeFileSync(join(project, '结构蓝图', 'board.json'), `${JSON.stringify(board, null, 2)}\n`, 'utf8')
  const pos = {}
  for (let index = 1; index <= 40; index += 1) pos[`D${index}`] = { x: index * 30, y: index * 20 }
  for (let index = 1; index <= 300; index += 1) pos[`B${index}`] = { x: (index % 20) * 60, y: Math.floor(index / 20) * 40 }
  writeFileSync(
    join(project, '结构蓝图', 'layout.json'),
    `${JSON.stringify({ format: 'structure-desk-layout/1', pos, size: {}, collapsed: [], view: { x: 0, y: 0, zoom: 1 } }, null, 2)}\n`,
    'utf8',
  )
  return project
}

test('/ops：只有 move 时回增量（layoutOnly、无 board/history/journal、batch:null）', async () => {
  const project = tempProject()
  await seed(project, [
    { op: 'add_domain', title: '限流' },
    { op: 'add_block', path: 'src/a.js' },
    { op: 'add_block', path: 'src/b.js' },
  ])
  const journalFile = join(project, '结构蓝图', 'journal.jsonl')
  const journalBefore = readFileSync(journalFile, 'utf8')
  const before = await call('GET', revUrl(project))

  const move = await call('POST', `${API_PREFIX}/ops`, {
    project,
    ops: [
      { op: 'move', positions: { D1: { x: 12, y: 34 } }, sizes: { B1: { w: 180, h: 60 } } },
      { op: 'move', positions: { B2: { x: 56, y: 78 } } },
    ],
  })
  assert.equal(move.status, 200)
  assert.deepEqual(Object.keys(move.json).sort(), ['batch', 'changed', 'layout', 'layoutOnly', 'project', 'rev'])
  assert.equal(move.json.layoutOnly, true)
  assert.equal(move.json.batch, null)
  assert.equal(move.json.rev, before.json.rev, 'move 只动坐标，不动 rev')
  assert.deepEqual(move.json.changed, { added: [], updated: [], removed: [], errors: [] })
  assert.deepEqual(move.json.layout.pos.D1, { x: 12, y: 34 })
  assert.deepEqual(move.json.layout.pos.B2, { x: 56, y: 78 })
  assert.deepEqual(move.json.layout.size.B1, { w: 180, h: 60 })
  assert.equal(readFileSync(journalFile, 'utf8'), journalBefore, 'move 不记 journal／batch')

  // 坐标落盘：全量 /state 读得到
  const state = await call('GET', stateUrl(project))
  assert.deepEqual(state.json.layout.pos.D1, { x: 12, y: 34 })

  // full:true → 强制全量
  const forced = await call('POST', `${API_PREFIX}/ops`, {
    project,
    full: true,
    ops: [{ op: 'move', positions: { D2: { x: 1, y: 2 } } }],
  })
  assert.equal(forced.json.layoutOnly, undefined)
  assert.ok(forced.json.board && forced.json.stats && forced.json.history)
  assert.deepEqual(forced.json.layout.pos.D2, { x: 1, y: 2 })

  // 含任一非 move op → 全量
  const mixed = await call('POST', `${API_PREFIX}/ops`, {
    project,
    ops: [{ op: 'move', positions: { D1: { x: 0, y: 0 } } }, { op: 'add_note', text: '混着来' }],
  })
  assert.equal(mixed.json.layoutOnly, undefined)
  assert.ok(mixed.json.board)
  assert.equal(mixed.json.changed.added.length, 1)
})

test('/rev：轻量回包（≤2KB、无 diff/labels），第二次走读缓存', async () => {
  const project = tempProject()
  await seed(project, [{ op: 'add_domain', title: '限流' }])
  const first = await call('GET', revUrl(project))
  assert.equal(first.status, 200)
  assert.ok(first.wireBytes <= 2048, `/rev 应 ≤2KB，实际 ${first.wireBytes}`)
  assert.deepEqual(Object.keys(first.json).sort(), ['historyCount', 'lastBatch', 'project', 'rev', 'stats'])
  assert.equal(typeof first.json.rev, 'string')
  assert.equal(first.json.project.path, project)
  for (const key of ['domains', 'blocks', 'realBlocks', 'planBlocks', 'links', 'notes', 'unannotated', 'ungrounded', 'planOpen', 'conflicts', 'stale']) {
    assert.equal(typeof first.json.stats[key], 'number', `stats.${key} 应为数字`)
  }
  assert.equal(first.json.historyCount, 1)
  assert.equal(first.json.lastBatch.op, 'ops')
  assert.deepEqual(Object.keys(first.json.lastBatch).sort(), ['at', 'batch', 'counts', 'op', 'revAfter'])

  const before = cacheStats()
  const second = await call('GET', revUrl(project))
  const after = cacheStats()
  assert.equal(second.json.rev, first.json.rev)
  assert.equal(after.state.hits - before.state.hits, 1, '第二次 /rev 命中 board 缓存')
  assert.equal(after.state.misses - before.state.misses, 0, '第二次 /rev 不重读 board')
  assert.equal(after.history.hits - before.history.hits, 1, '历史索引也命中缓存')
})

test('/rev：还没有板子时 rev／lastBatch 为 null', async () => {
  const project = tempProject()
  const response = await call('GET', revUrl(project))
  assert.equal(response.status, 200)
  assert.equal(response.json.rev, null)
  assert.equal(response.json.lastBatch, null)
  assert.equal(response.json.historyCount, 0)
  assert.equal(response.json.stats.domains, 0)
})

test('/state?parts：只回请求段（project/rev 恒带），history 只带摘要', async () => {
  const project = tempProject()
  await seed(project, [{ op: 'add_domain', title: '限流' }])
  const rev = (await call('GET', revUrl(project))).json.rev

  const boardOnly = await call('GET', stateUrl(project, { parts: 'board' }))
  assert.equal(boardOnly.status, 200)
  assert.deepEqual(Object.keys(boardOnly.json).sort(), ['board', 'project', 'rev'])
  assert.equal(boardOnly.json.rev, rev)
  assert.equal(boardOnly.json.board.domains[0].title, '限流')

  const subset = await call('GET', stateUrl(project, { parts: 'stats,history' }))
  assert.deepEqual(Object.keys(subset.json).sort(), ['history', 'project', 'rev', 'stats'])
  assert.equal('board' in subset.json, false)
  assert.equal('journalTail' in subset.json, false)
  assert.equal(subset.json.history.length, 1)
  for (const key of ['diff', 'labels', 'bytes']) assert.equal(key in subset.json.history[0], false, `history 摘要不该带 ${key}`)
  assert.ok(subset.json.history[0].counts)

  const journalOnly = await call('GET', stateUrl(project, { parts: 'journal' }))
  assert.deepEqual(Object.keys(journalOnly.json).sort(), ['journalTail', 'project', 'rev'])
  assert.ok(Array.isArray(journalOnly.json.journalTail))

  const unknown = await call('GET', stateUrl(project, { parts: 'nope' }))
  assert.deepEqual(Object.keys(unknown.json).sort(), ['project', 'rev'])

  // 缺省仍全量（旧客户端能用）
  const full = await call('GET', stateUrl(project))
  assert.deepEqual(
    Object.keys(full.json).sort(),
    ['board', 'coverage', 'exists', 'gaps', 'history', 'journalTail', 'layout', 'project', 'rev', 'stats'],
  )
})

test('readState(parts)：存储层也只取请求段', async () => {
  const project = tempProject()
  await seed(project, [{ op: 'add_domain', title: '限流' }])
  const onlyBoard = await readState(project, { parts: new Set(['board']) })
  assert.deepEqual(Object.keys(onlyBoard).sort(), ['board', 'project', 'rev'])
  const onlyHistory = await readState(project, { parts: new Set(['history']) })
  assert.deepEqual(Object.keys(onlyHistory).sort(), ['history', 'project', 'rev'])
  assert.equal(onlyHistory.history.length, 1)
})

test('/history?since=：只回之后的新批摘要；无新批 []；since 未知回全部', async () => {
  const project = tempProject()
  const batches = []
  for (const title of ['一', '二', '三']) {
    const response = await seed(project, [{ op: 'add_domain', title }])
    batches.push(response.json.changed.batch)
  }
  const partial = await call('GET', historyUrl(project, { since: batches[0] }))
  assert.equal(partial.status, 200)
  assert.deepEqual(partial.json.batches.map((item) => item.batch), [batches[1], batches[2]])
  for (const entry of partial.json.batches) {
    assert.equal('diff' in entry, false, 'since 增量只带摘要')
    assert.equal('labels' in entry, false)
    assert.ok(entry.counts)
  }

  const none = await call('GET', historyUrl(project, { since: batches[2] }))
  assert.deepEqual(none.json.batches, [])

  const unknown = await call('GET', historyUrl(project, { since: 'b-不知道' }))
  assert.equal(unknown.json.batches.length, 3, 'since 未知退全部摘要')

  // 无参维持现状：索引里保留的 diff 还在
  const all = await call('GET', historyUrl(project))
  assert.equal(all.json.batches.length, 3)
  assert.ok(all.json.batches[2].diff && typeof all.json.batches[2].labels === 'object')
})

test('/history?batch=：最近批给 diff/labels；未知批 detailTrimmed', async () => {
  const project = tempProject()
  const first = await seed(project, [{ op: 'add_domain', title: '限流' }])
  const batch = first.json.changed.batch

  const detail = await call('GET', historyUrl(project, { batch }))
  assert.equal(detail.status, 200)
  assert.equal(detail.json.batch.batch, batch)
  assert.equal(detail.json.batch.op, 'ops')
  assert.deepEqual(detail.json.batch.counts, { added: 1, updated: 0, removed: 0 })
  assert.deepEqual(detail.json.batch.diff.added, ['D1'])
  assert.equal(detail.json.batch.labels.D1, '限流')
  assert.equal(detail.json.detailTrimmed, undefined)

  const missing = await call('GET', historyUrl(project, { batch: 'b-不存在' }))
  assert.equal(missing.json.detailTrimmed, true)
  assert.equal(missing.json.batch, null)
  assert.equal(missing.json.keptBatches, 1)
})

test('A3 索引瘦身：最近 20 批留 diff、最近 10 批留 labels，更老只留 counts；快照不动', async () => {
  const project = tempProject()
  const batches = []
  for (let index = 0; index < 22; index += 1) {
    const response = await seed(project, [{ op: 'add_note', text: `第 ${index} 条` }])
    batches.push(response.json.changed.batch)
  }
  const indexFile = JSON.parse(readFileSync(join(project, '结构蓝图', 'history', 'index.json'), 'utf8'))
  assert.equal(indexFile.batches.length, 22)
  const at = (fromEnd) => indexFile.batches[indexFile.batches.length - 1 - fromEnd]

  assert.equal('diff' in at(0), true)
  assert.equal('labels' in at(0), true)
  assert.equal('diff' in at(HISTORY_LABEL_KEEP), true, `第 ${HISTORY_LABEL_KEEP + 1} 新的一批仍有 diff`)
  assert.equal('labels' in at(HISTORY_LABEL_KEEP), false, `第 ${HISTORY_LABEL_KEEP + 1} 新的一批不再留 labels`)
  assert.equal('diff' in at(HISTORY_DIFF_KEEP), false, `第 ${HISTORY_DIFF_KEEP + 1} 新的一批 diff 也删了`)
  assert.equal('labels' in at(HISTORY_DIFF_KEEP), false)
  assert.deepEqual(at(HISTORY_DIFF_KEEP).counts, { added: 1, updated: 0, removed: 0 }, '更老只留 counts')

  // 快照文件不瘦身：22 批都在，回滚语义不变
  const snapshots = readdirSync(join(project, '结构蓝图', 'history')).filter((name) => name !== 'index.json')
  assert.equal(snapshots.length, 22)

  // 超出保留的批：详情只剩摘要
  const old = await call('GET', historyUrl(project, { batch: batches[0] }))
  assert.equal(old.json.detailTrimmed, true)
  assert.equal(old.json.keptBatches, 22)
  assert.equal(old.json.batch.batch, batches[0])
  const recent = await call('GET', historyUrl(project, { batch: batches[21] }))
  assert.equal(recent.json.detailTrimmed, undefined)
  assert.ok(recent.json.batch.diff)
})

test('A4 读缓存：命中不重读，写路径失效，外部手改 mtime 变化必须重读', async () => {
  const project = tempProject()
  await seed(project, [{ op: 'add_domain', title: '限流' }])

  const before = cacheStats()
  const first = await call('GET', stateUrl(project))
  const afterFirst = cacheStats()
  const second = await call('GET', stateUrl(project))
  const afterSecond = cacheStats()
  assert.equal(afterFirst.state.misses - before.state.misses, 1, '首次要读盘')
  assert.equal(afterSecond.state.misses - afterFirst.state.misses, 0, '第二次不该重读 board')
  assert.ok(afterSecond.state.hits - afterFirst.state.hits >= 1, '第二次应命中缓存')
  assert.deepEqual(second.json.board, first.json.board)

  // 写路径主动失效：mutate 之后下一次 /state 必须重读
  await seed(project, [{ op: 'add_note', text: '改了一条' }])
  const beforeWriteRead = cacheStats()
  const afterWrite = await call('GET', stateUrl(project))
  const afterWriteRead = cacheStats()
  assert.equal(afterWriteRead.state.misses - beforeWriteRead.state.misses, 1, '写路径应失效缓存')
  assert.equal(afterWrite.json.stats.notes, 1)

  // 外部手改 board.json：mtime+size 变了 → 重读，不能回旧值
  const boardFile = join(project, '结构蓝图', 'board.json')
  const raw = JSON.parse(readFileSync(boardFile, 'utf8'))
  raw.title = '外部改过的标题'
  raw.domains[0].title = '外部改的域'
  writeFileSync(boardFile, `${JSON.stringify(raw, null, 2)}\n`, 'utf8')
  const external = await call('GET', stateUrl(project))
  assert.equal(external.json.board.title, '外部改过的标题')
  assert.equal(external.json.board.domains[0].title, '外部改的域')
})

test('applyLayout 也失效缓存：move 之后 /state 的坐标是新的', async () => {
  const project = tempProject()
  await seed(project, [{ op: 'add_domain', title: '限流' }])
  await call('GET', stateUrl(project)) // 先把缓存焐热
  await call('POST', `${API_PREFIX}/ops`, { project, ops: [{ op: 'move', positions: { D1: { x: 7, y: 8 } } }] })
  const state = await call('GET', stateUrl(project))
  assert.deepEqual(state.json.layout.pos.D1, { x: 7, y: 8 })
})

test('gzip 传输：大包压缩且 JSON 等价；不带 accept-encoding / <1KB 保持明文', async () => {
  const project = tempProject()
  await seed(project, [
    { op: 'add_domain', title: '限流' },
    { op: 'add_block', path: 'src/a.js' },
    { op: 'add_note', text: '一条便签' },
  ])

  const plain = await call('GET', stateUrl(project))
  assert.ok(plain.wireBytes > 1024, `夹具 /state 应大于 1KB，实际 ${plain.wireBytes}`)
  assert.equal(plain.headers['content-encoding'], undefined, '不带头就是明文')
  assert.equal(plain.headers['x-sd-raw-bytes'], undefined)

  const packed = await call('GET', stateUrl(project), undefined, { 'accept-encoding': 'gzip, deflate, br' })
  assert.equal(packed.status, 200)
  assert.equal(packed.headers['content-encoding'], 'gzip')
  assert.equal(packed.headers.vary, 'accept-encoding')
  assert.equal(Number(packed.headers['content-length']), packed.wireBytes, 'content-length=压缩后长度')
  assert.equal(Number(packed.headers['x-sd-raw-bytes']), plain.wireBytes, 'x-sd-raw-bytes=未压缩字节')
  assert.equal(packed.rawBytes, Buffer.byteLength(packed.text), 'x-sd-raw-bytes 与解压后字节一致')
  assert.deepEqual(packed.json, plain.json, 'gzip 包的 JSON 与明文等价')
  assert.ok(packed.wireBytes < plain.wireBytes, '压缩后应更小')

  // 只接受 br 不认 gzip → 不压缩
  const noGzip = await call('GET', stateUrl(project), undefined, { 'accept-encoding': 'br' })
  assert.equal(noGzip.headers['content-encoding'], undefined)
  assert.deepEqual(noGzip.json, plain.json)

  // <1KB 的响应（/ping 与错误）即使要 gzip 也保持明文
  const ping = await call('GET', `${API_PREFIX}/ping`, undefined, { 'accept-encoding': 'gzip' })
  assert.equal(ping.status, 200)
  assert.ok(ping.wireBytes < 1024)
  assert.equal(ping.headers['content-encoding'], undefined)
  const bad = await call('GET', `${API_PREFIX}/state?project=`, undefined, { 'accept-encoding': 'gzip' })
  assert.equal(bad.status, 400)
  assert.equal(bad.headers['content-encoding'], undefined)
  assert.equal(bad.headers['x-sd-raw-bytes'], undefined)
})

test('gzip wire 字节目标（300 块）：/state≤120KB、/ops 改一块≤64KB、纯 move≤8KB；/rev≤2KB', async (t) => {
  const project = bigProject()
  const gzip = { 'accept-encoding': 'gzip' }

  const statePlain = await call('GET', stateUrl(project))
  const state = await call('GET', stateUrl(project), undefined, gzip)
  assert.equal(state.headers['content-encoding'], 'gzip')
  assert.deepEqual(state.json, statePlain.json)
  assert.equal(state.rawBytes, statePlain.wireBytes, 'raw 字节应与明文一致')
  assert.ok(state.wireBytes <= 120 * 1024, `/state gzip ${state.wireBytes}B 应 ≤120KB（raw ${state.rawBytes}B）`)

  const oneOp = await call(
    'POST',
    `${API_PREFIX}/ops`,
    { project, author: 'human', ops: [{ op: 'update_block', id: 'B1', note: '改一句批注' }] },
    gzip,
  )
  assert.equal(oneOp.status, 200)
  assert.equal(oneOp.headers['content-encoding'], 'gzip')
  assert.ok(oneOp.wireBytes <= 64 * 1024, `/ops 改一块 gzip ${oneOp.wireBytes}B 应 ≤64KB（raw ${oneOp.rawBytes}B）`)

  const move = await call('POST', `${API_PREFIX}/ops`, { project, ops: [{ op: 'move', positions: { B1: { x: 1, y: 2 } } }] }, gzip)
  assert.equal(move.status, 200)
  assert.equal(move.json.layoutOnly, true)
  assert.ok(move.wireBytes <= 8 * 1024, `纯 move gzip ${move.wireBytes}B 应 ≤8KB（raw ${move.rawBytes}B）`)

  // /rev 本来 <1KB，带 gzip 也不压；明文字节 ≤2KB
  const rev = await call('GET', revUrl(project), undefined, gzip)
  assert.ok(rev.wireBytes <= 2048, `/rev ${rev.wireBytes}B 应 ≤2KB`)
  assert.equal(rev.headers['content-encoding'], undefined)

  // /history?since 增量同样走 gzip 通道
  const since = await call('GET', historyUrl(project), undefined, gzip)
  assert.ok(since.wireBytes <= 32 * 1024)

  t.diagnostic(
    `300 块 gzip wire：/state ${state.wireBytes}B（raw ${state.rawBytes}B）· /ops 改一块 ${oneOp.wireBytes}B（raw ${oneOp.rawBytes}B）· ` +
      `纯 move ${move.wireBytes}B（raw ${move.rawBytes}B）· /rev ${rev.wireBytes}B · /history 全量 ${since.wireBytes}B`,
  )
})

test('summaryOfBatch：纯函数只留摘要字段，入参不改', () => {
  const entry = {
    batch: 'b1',
    at: '2026-11-09T00:00:00.000Z',
    author: 'agent',
    op: 'scan',
    summary: '扫描',
    reverted: null,
    revBefore: 'aaaaaaaaaaaa',
    revAfter: 'bbbbbbbbbbbb',
    counts: { added: 2, updated: 1, removed: 0 },
    diff: { added: ['B1', 'B2'], updated: ['B3'], removed: [] },
    labels: { B1: 'src/a.js' },
    bytes: 123,
  }
  const snapshot = JSON.stringify(entry)
  assert.deepEqual(summaryOfBatch(entry), {
    batch: 'b1',
    at: '2026-11-09T00:00:00.000Z',
    author: 'agent',
    op: 'scan',
    summary: '扫描',
    reverted: null,
    revBefore: 'aaaaaaaaaaaa',
    revAfter: 'bbbbbbbbbbbb',
    counts: { added: 2, updated: 1, removed: 0 },
  })
  assert.equal(JSON.stringify(entry), snapshot, '纯函数不改入参')
  assert.deepEqual(summaryOfBatch(null), {
    batch: '',
    at: '',
    author: 'human',
    op: 'ops',
    summary: '',
    reverted: null,
    revBefore: null,
    revAfter: null,
    counts: { added: 0, updated: 0, removed: 0 },
  })
})
