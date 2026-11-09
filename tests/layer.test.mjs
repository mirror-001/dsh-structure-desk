// 结构台 · v1.16 层与落地建议单测（node --test）
// 层由 author 导出；域与计划块只许本层改（layer-readonly，不中止整批）；实块／连接／便签不设守卫。
// suggestGrounds 是纯函数；scanInto 把建议只放进回包、不落盘。

import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyOps, derived, layerOf, newBoard, normalizeBoard, suggestGrounds } from '../lib/core.js'
import { mutate, scanInto } from '../lib/store.js'

const tempRoots = []
// 记「最近项目」用临时家目录，别碰真的 ~/.dsh
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'sd-home-'))

function tempProject() {
  const root = mkdtempSync(join(tmpdir(), 'sd-layer-'))
  tempRoots.push(root)
  return root
}

after(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true })
})

/** 一块三层都有的板子：人层域／agent 域、人层计划块／agent 计划块、程序实块。 */
function layerBoard() {
  return normalizeBoard({
    ...newBoard('D:\\demo', 'demo'),
    domains: [
      { id: 'D1', title: '人说话', author: 'human' },
      { id: 'D2', title: 'agent 说话', author: 'agent' },
      { id: 'D3', title: '人已覆盖', author: 'human' },
    ],
    blocks: [
      { id: 'B1', path: 'src/a.js', author: 'program' },
      { id: 'B2', path: 'src/b.js', author: 'program' },
      { id: 'B3', path: 'future/a.js', planned: true, author: 'human' },
      { id: 'B4', path: 'future/b.js', planned: true, author: 'agent' },
      { id: 'B5', path: 'future/c.js', planned: true, author: 'human', ground: 'B2' },
    ],
    links: [
      { id: 'L1', from: 'D3', to: 'B1', type: 'covers', author: 'human' },
      { id: 'L2', from: 'B5', to: 'B2', type: 'grounds', author: 'human' },
    ],
  }, 'D:\\demo')
}

test('layerOf：层由 author 导出，缺省人层', () => {
  assert.equal(layerOf({ author: 'human' }), 'human')
  assert.equal(layerOf({ author: 'agent' }), 'agent')
  assert.equal(layerOf({ author: 'program' }), 'program')
  assert.equal(layerOf({ author: 'other' }), 'human')
  assert.equal(layerOf({}), 'human')
  assert.equal(layerOf(null), 'human')
})

test('derived：gaps.byLayer 按层拆分，stats.byLayer 只给计数', () => {
  const { gaps, stats } = derived(layerBoard())
  assert.deepEqual(gaps.byLayer.human, { ungrounded: ['D1'], planOpen: ['B3'] })
  assert.deepEqual(gaps.byLayer.agent, { ungrounded: ['D2'], planOpen: ['B4'] })
  assert.deepEqual(gaps.byLayer.program, { unannotated: ['B2'] })
  assert.deepEqual(stats.byLayer, {
    human: { ungrounded: 1, planOpen: 1 },
    agent: { ungrounded: 1, planOpen: 1 },
    program: { unannotated: 1 },
  })
  // 口径不变：顶层落差照旧，按层只是拆开
  assert.deepEqual(gaps.ungrounded, ['D1', 'D2'])
  assert.deepEqual(gaps.planOpen, ['B3', 'B4'])
  assert.deepEqual(gaps.unannotated, ['B2'])
})

test('derived：空板子 byLayer 全空、计数为 0', () => {
  const { gaps, stats } = derived(normalizeBoard(newBoard('D:\\demo', 'demo'), 'D:\\demo'))
  assert.deepEqual(gaps.byLayer, {
    human: { ungrounded: [], planOpen: [] },
    agent: { ungrounded: [], planOpen: [] },
    program: { unannotated: [] },
  })
  assert.deepEqual(stats.byLayer, {
    human: { ungrounded: 0, planOpen: 0 },
    agent: { ungrounded: 0, planOpen: 0 },
    program: { unannotated: 0 },
  })
})

test('层守卫：agent 改人层域被拦（layer-readonly），同批其它 op 照常落地', () => {
  const board = layerBoard()
  const { board: next, errors, changed } = applyOps(
    board,
    [
      { op: 'update_domain', id: 'D1', title: '被改了' },
      { op: 'add_note', text: '照常记一条' },
    ],
    { author: 'agent' },
  )
  assert.equal(errors.length, 1, '只拦那一条')
  assert.equal(errors[0].index, 0)
  assert.equal(errors[0].op, 'update_domain')
  assert.equal(errors[0].code, 'layer-readonly')
  assert.equal(errors[0].layer, 'human')
  assert.match(errors[0].message, /只读/u)
  assert.match(errors[0].message, /relates\/contradicts 提案/u)
  assert.equal(next.domains.find((d) => d.id === 'D1').title, '人说话', '失败的 op 不改板子')
  assert.equal(next.notes.length, 1, '整批不中止')
  assert.deepEqual(changed.updated, [])
  assert.equal(changed.added.length, 1)
})

test('层守卫：人改 agent 域与计划块被拦；改人层与 program 实块照旧', () => {
  const board = layerBoard()
  const denied = applyOps(
    board,
    [
      { op: 'update_domain', id: 'D2', note: '想改 agent 的域' },
      { op: 'update_block', id: 'B4', note: '想改 agent 的计划块' },
      { op: 'remove', id: 'D2' },
      { op: 'remove', id: 'B4' },
    ],
    { author: 'human' },
  )
  assert.equal(denied.errors.length, 4)
  for (const error of denied.errors) {
    assert.equal(error.code, 'layer-readonly')
    assert.equal(error.layer, 'agent')
    assert.match(error.message, /这是 agent 层的/u)
  }
  assert.deepEqual(
    denied.board.domains.map((d) => d.id),
    board.domains.map((d) => d.id),
    '失败不改板子',
  )
  assert.deepEqual(
    denied.board.blocks.map((b) => b.id),
    board.blocks.map((b) => b.id),
  )
  assert.equal(denied.changed.added.length + denied.changed.updated.length + denied.changed.removed.length, 0)

  const allowed = applyOps(
    board,
    [
      { op: 'update_domain', id: 'D1', note: '自己的域' },
      { op: 'update_block', id: 'B3', note: '自己的计划块' },
      { op: 'update_block', id: 'B1', note: '实块可改（program 层不设守卫）' },
      { op: 'remove', id: 'B2' },
      { op: 'remove', id: 'B3' },
    ],
    { author: 'human' },
  )
  assert.deepEqual(allowed.errors, [])
  assert.equal(allowed.board.domains.find((d) => d.id === 'D1').note, '自己的域')
  assert.equal(allowed.board.blocks.some((b) => b.id === 'B2'), false)
  assert.equal(allowed.board.blocks.some((b) => b.id === 'B3'), false)
})

test('层守卫：agent 改／删自己层的域与计划块放行', () => {
  const { board, errors } = applyOps(
    layerBoard(),
    [
      { op: 'update_domain', id: 'D2', criteria: 'agent 自定判据' },
      { op: 'update_block', id: 'B4', note: 'agent 改自己的计划' },
      { op: 'remove', id: 'B4' },
    ],
    { author: 'agent' },
  )
  assert.deepEqual(errors, [])
  assert.equal(board.domains.find((d) => d.id === 'D2').criteria, 'agent 自定判据')
  assert.equal(board.blocks.some((b) => b.id === 'B4'), false)
})

test('层守卫：连接与便签不设守卫（author 只作展示）', () => {
  const board = layerBoard()
  board.links.push({ id: 'L9', from: 'D2', to: 'D1', type: 'relates', note: '', author: 'agent' })
  board.notes.push({ id: 'N9', text: 'agent 便签', ref: null, color: 'amber', author: 'agent' })
  const { board: next, errors } = applyOps(
    board,
    [
      { op: 'remove', id: 'L9' },
      { op: 'update_note', id: 'N9', text: '人改 agent 的便签' },
    ],
    { author: 'human' },
  )
  assert.deepEqual(errors, [])
  assert.equal(next.links.some((l) => l.id === 'L9'), false)
  assert.equal(next.notes.find((n) => n.id === 'N9').text, '人改 agent 的便签')
})

test('suggestGrounds：同名文件最高分「文件名相同」，相近名「文件名相近」，阈值外不报', () => {
  const board = normalizeBoard({
    ...newBoard('D:\\demo', 'demo'),
    blocks: [
      { id: 'B10', path: 'future/limiter.js', planned: true, author: 'human' },
      { id: 'B13', path: 'future/auth-service.js', planned: true, author: 'human' },
      { id: 'B11', path: 'future/done.js', planned: true, author: 'agent', ground: 'B20' },
      { id: 'B12', path: 'future/stale.js', planned: true, author: 'human', stale: true },
      { id: 'B20', path: 'src/limiter.js', author: 'program' },
      { id: 'B24', path: 'src/service.js', author: 'program' },
      { id: 'B22', path: 'src/limiter-old.js', author: 'program' },
      { id: 'B23', path: 'docs/readme.md', author: 'program' },
    ],
  }, 'D:\\demo')
  const snapshot = JSON.stringify(board)
  const got = suggestGrounds(board, ['B20', 'B24', 'B23'])
  assert.equal(JSON.stringify(board), snapshot, '纯函数不改入参')

  const sameName = got.find((item) => item.plannedId === 'B10' && item.realId === 'B20')
  assert.ok(sameName)
  assert.equal(sameName.reason, '文件名相同')
  assert.equal(sameName.score, 0.75)

  const closeName = got.find((item) => item.plannedId === 'B13' && item.realId === 'B24')
  assert.ok(closeName)
  assert.equal(closeName.reason, '文件名相近')

  // 已落地／已失联的计划块不是候选；没在本次新增里的实块不是候选；无关路径不报
  assert.ok(!got.some((item) => item.plannedId === 'B11' || item.plannedId === 'B12'))
  assert.ok(!got.some((item) => item.realId === 'B22'))
  assert.ok(!got.some((item) => item.realId === 'B23'))
  assert.deepEqual(suggestGrounds(board, []), [], '没有新实块就没有建议')
  assert.deepEqual(suggestGrounds(null, ['B20']), [], '空板子安全')
})

test('suggestGrounds：按分降序、每对一条、最多 5 对', () => {
  const blocks = []
  for (let index = 1; index <= 6; index += 1) blocks.push({ id: `B${index}`, path: 'future/limiter.js', planned: true, author: 'human' })
  blocks.push({ id: 'B100', path: 'src/limiter.js', author: 'program' })
  const board = normalizeBoard({ ...newBoard('D:\\demo', 'demo'), blocks }, 'D:\\demo')
  const got = suggestGrounds(board, ['B100'])
  assert.equal(got.length, 5)
  assert.deepEqual(
    got.map((item) => item.plannedId),
    ['B1', 'B2', 'B3', 'B4', 'B5'],
    '同分按 id 稳定排序',
  )
  assert.equal(got[0].score, 0.75)
  for (let index = 1; index < got.length; index += 1) assert.ok(got[index - 1].score >= got[index].score)
})

test('scanInto：新收实块触发落地建议，只进 scan 回包，不落盘', async () => {
  const project = tempProject()
  mkdirSync(join(project, 'src'), { recursive: true })
  writeFileSync(join(project, 'src', 'limiter.js'), 'export const limit = 1\n', 'utf8')
  const setup = await mutate(
    project,
    [
      { op: 'add_domain', title: '限流', author: 'human' },
      { op: 'add_block', path: 'future/limiter.js', planned: true, author: 'human' },
    ],
    { author: 'human' },
  )
  assert.deepEqual(setup.changed.errors, [])

  const { state, scan } = await scanInto(project)
  assert.equal(scan.added, 1)
  assert.equal(scan.suggestions.length, 1)
  // mutate 回包也透传 byLayer（新实块让 program 未标注 +1）
  assert.deepEqual(state.gaps.byLayer.program, { unannotated: ['B2'] })
  assert.equal(state.stats.byLayer.program.unannotated, 1)
  const [suggestion] = scan.suggestions
  assert.equal(state.board.blocks.find((b) => b.id === suggestion.plannedId).planned, true)
  const real = state.board.blocks.find((b) => b.id === suggestion.realId)
  assert.equal(real.planned, false)
  assert.equal(real.path, 'src/limiter.js')
  assert.equal(suggestion.reason, '文件名相同')

  // 建议不落盘：board.json 里没有 suggestions
  const onDisk = JSON.parse(readFileSync(join(project, '结构蓝图', 'board.json'), 'utf8'))
  assert.equal(onDisk.suggestions, undefined)

  // 没有新实块的第二次 scan 返回空数组
  const again = await scanInto(project)
  assert.deepEqual(again.scan.suggestions, [])
})
