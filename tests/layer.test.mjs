// 结构台 · 层与落地建议单测（node --test）
// v1.16：层由 author 导出；v1.19：层是独立数据（layers[]，默认三层 id＝human/agent/program），
// 作者 ≠ 层、守卫按 layer.owner 判、assign_layer 换层、旧板补默认层；连接／便签不设层。
// suggestGrounds 是纯函数；scanInto 把建议只放进回包、不落盘。

import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyOps, derived, findLayer, layerIdOf, layerOf, newBoard, normalizeBoard, revOf, suggestGrounds } from '../lib/core.js'
import { mutate, readState, scanInto } from '../lib/store.js'
import { registerTools } from '../lib/tools.js'

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

test('derived：gaps.byLayer 按层 id 拆分，stats.byLayer 带 owner 与计数', () => {
  const { gaps, stats } = derived(layerBoard())
  assert.deepEqual(gaps.byLayer.human, { owner: 'human', ungrounded: ['D1'], planOpen: ['B3'], unannotated: [] })
  assert.deepEqual(gaps.byLayer.agent, { owner: 'agent', ungrounded: ['D2'], planOpen: ['B4'], unannotated: [] })
  assert.deepEqual(gaps.byLayer.program, { owner: 'program', ungrounded: [], planOpen: [], unannotated: ['B2'] })
  assert.deepEqual(stats.byLayer, {
    human: { owner: 'human', ungrounded: 1, planOpen: 1, unannotated: 0 },
    agent: { owner: 'agent', ungrounded: 1, planOpen: 1, unannotated: 0 },
    program: { owner: 'program', ungrounded: 0, planOpen: 0, unannotated: 1 },
  })
  // 口径不变：顶层落差照旧，按层只是拆开
  assert.deepEqual(gaps.ungrounded, ['D1', 'D2'])
  assert.deepEqual(gaps.planOpen, ['B3', 'B4'])
  assert.deepEqual(gaps.unannotated, ['B2'])
})

test('derived：空板子 byLayer 三层全空、计数为 0', () => {
  const { gaps, stats } = derived(normalizeBoard(newBoard('D:\\demo', 'demo'), 'D:\\demo'))
  assert.deepEqual(gaps.byLayer, {
    human: { owner: 'human', ungrounded: [], planOpen: [], unannotated: [] },
    agent: { owner: 'agent', ungrounded: [], planOpen: [], unannotated: [] },
    program: { owner: 'program', ungrounded: [], planOpen: [], unannotated: [] },
  })
  assert.deepEqual(stats.byLayer, {
    human: { owner: 'human', ungrounded: 0, planOpen: 0, unannotated: 0 },
    agent: { owner: 'agent', ungrounded: 0, planOpen: 0, unannotated: 0 },
    program: { owner: 'program', ungrounded: 0, planOpen: 0, unannotated: 0 },
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
  assert.deepEqual(state.gaps.byLayer.program, { owner: 'program', ungrounded: [], planOpen: [], unannotated: ['B2'] })
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

// ── v1.19 自定义说法层 ──────────────────────────────────────────────

test('normalizeBoard：旧板补默认三层、件按 author 回填、实块不存层、归一化幂等', () => {
  const raw = {
    format: 'structure-desk/1',
    project: { path: 'D:\\demo', name: 'demo' },
    seq: { D: 2, B: 3, L: 0, N: 0 },
    domains: [
      { id: 'D1', title: '人', author: 'human' },
      { id: 'D2', title: 'agent', author: 'agent' },
    ],
    blocks: [
      { id: 'B1', path: 'a.js', author: 'program' },
      { id: 'B2', path: 'f.js', planned: true, author: 'agent' },
    ],
    links: [],
    notes: [],
  }
  const board = normalizeBoard(raw, 'D:\\demo')
  assert.deepEqual(board.layers.map((l) => [l.id, l.owner, l.builtin]), [
    ['human', 'human', true],
    ['agent', 'agent', true],
    ['program', 'program', true],
  ])
  assert.equal(board.domains.find((d) => d.id === 'D1').layer, 'human')
  assert.equal(board.domains.find((d) => d.id === 'D2').layer, 'agent')
  assert.equal(board.blocks.find((b) => b.id === 'B1').layer, undefined, '实块不存层')
  assert.equal(board.blocks.find((b) => b.id === 'B2').layer, 'agent')
  assert.equal(layerIdOf(board, board.domains[0]), 'human')
  assert.equal(findLayer(board, 'program').owner, 'program')
  // 归一化幂等：再读一遍 rev 不变（读不写盘的口径）
  assert.equal(revOf(normalizeBoard(board, 'D:\\demo')), revOf(board))
})

test('层 op：新建（S 前缀、拒程序层）、改名改色、归属不可改、删空层、默认层与有件层拒删', () => {
  const board = layerBoard()
  const created = applyOps(board, [{ op: 'add_layer', name: '阶段', owner: 'human', color: '#112233' }], { author: 'human' })
  assert.deepEqual(created.errors, [])
  const layer = created.board.layers.find((l) => l.name === '阶段')
  assert.equal(layer.id, 'S1')
  assert.equal(layer.owner, 'human')
  assert.equal(layer.builtin, false)
  assert.equal(layer.color, '#112233')

  const program = applyOps(created.board, [{ op: 'add_layer', name: 'x', owner: 'program' }], { author: 'human' })
  assert.match(program.errors[0].message, /程序层不可新建/u)

  const renamed = applyOps(created.board, [{ op: 'update_layer', id: 'S1', name: '阶段2', color: '#445566' }], { author: 'human' })
  assert.deepEqual(renamed.errors, [])
  assert.equal(renamed.board.layers.find((l) => l.id === 'S1').name, '阶段2')
  assert.equal(renamed.board.layers.find((l) => l.id === 'S1').color, '#445566')

  const ownerChange = applyOps(created.board, [{ op: 'update_layer', id: 'S1', owner: 'agent' }], { author: 'human' })
  assert.match(ownerChange.errors[0].message, /归属建后不可改/u)

  const delEmpty = applyOps(created.board, [{ op: 'remove_layer', id: 'S1' }], { author: 'human' })
  assert.deepEqual(delEmpty.errors, [])
  assert.equal(delEmpty.board.layers.some((l) => l.id === 'S1'), false)

  const delBuiltin = applyOps(created.board, [{ op: 'remove_layer', id: 'human' }], { author: 'human' })
  assert.match(delBuiltin.errors[0].message, /默认层不可删/u)

  // 有件层：把人层域换进 S1 后再删 → 拒
  const moved = applyOps(created.board, [{ op: 'assign_layer', id: 'D1', layer: 'S1' }], { author: 'human' })
  assert.deepEqual(moved.errors, [])
  const delUsed = applyOps(moved.board, [{ op: 'remove_layer', id: 'S1' }], { author: 'human' })
  assert.match(delUsed.errors[0].message, /层里还有件/u)
})

test('assign_layer：同方换层生效、进 rev 与 journal；跨方目标、他层件、实块均拒绝', () => {
  const board = layerBoard()
  const created = applyOps(board, [{ op: 'add_layer', name: '阶段', owner: 'human' }], { author: 'human' })
  const layerId = created.board.layers.find((l) => l.name === '阶段').id
  const revBefore = revOf(created.board)
  const moved = applyOps(created.board, [{ op: 'assign_layer', id: 'D1', layer: layerId }], { author: 'human' })
  assert.deepEqual(moved.errors, [])
  assert.equal(moved.board.domains.find((d) => d.id === 'D1').layer, layerId)
  assert.notEqual(revOf(moved.board), revBefore, '换层进 rev')
  assert.equal(moved.journal[0].op, 'assign_layer')
  assert.match(moved.journal[0].summary, /换层/u)

  const cross = applyOps(created.board, [{ op: 'assign_layer', id: 'D1', layer: 'agent' }], { author: 'human' })
  assert.match(cross.errors[0].message, /只能换到自己方/u)

  const foreign = applyOps(created.board, [{ op: 'assign_layer', id: 'B4', layer: layerId }], { author: 'human' })
  assert.equal(foreign.errors[0].code, 'layer-readonly')

  const real = applyOps(created.board, [{ op: 'assign_layer', id: 'B1', layer: layerId }], { author: 'human' })
  assert.match(real.errors[0].message, /只有域与计划块/u)
})

test('derived：自定义层的落差按层 id 归组，不并进默认层', () => {
  const board = layerBoard()
  const created = applyOps(board, [{ op: 'add_layer', name: '阶段', owner: 'human' }], { author: 'human' })
  const layerId = created.board.layers.find((l) => l.name === '阶段').id
  const moved = applyOps(created.board, [{ op: 'assign_layer', id: 'D1', layer: layerId }], { author: 'human' })
  const { gaps, stats } = derived(moved.board)
  assert.deepEqual(gaps.byLayer[layerId].ungrounded, ['D1'])
  assert.deepEqual(gaps.byLayer.human.ungrounded, [])
  assert.equal(stats.byLayer[layerId].owner, 'human')
})

test('store：旧板读入补默认层但不落盘；写一次后才把 layers 落进 board.json', async () => {
  const project = tempProject()
  mkdirSync(join(project, '结构蓝图'), { recursive: true })
  writeFileSync(
    join(project, '结构蓝图', 'board.json'),
    JSON.stringify({
      format: 'structure-desk/1',
      project: { path: project, name: 'demo' },
      title: 'demo · 结构蓝图',
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
      seq: { D: 0, B: 0, L: 0, N: 0 },
      domains: [],
      blocks: [],
      links: [],
      notes: [],
    }),
    'utf8',
  )
  const state = await readState(project)
  assert.equal(state.board.layers.length, 3)
  const diskAfterRead = JSON.parse(readFileSync(join(project, '结构蓝图', 'board.json'), 'utf8'))
  assert.equal(diskAfterRead.layers, undefined, '只读不落盘')

  const written = await mutate(project, [{ op: 'add_domain', title: '迁移后', author: 'human' }], { author: 'human' })
  assert.deepEqual(written.changed.errors, [])
  const diskAfterWrite = JSON.parse(readFileSync(join(project, '结构蓝图', 'board.json'), 'utf8'))
  assert.equal(diskAfterWrite.layers.length, 3)
  assert.equal(diskAfterWrite.domains[0].layer, 'human')
})

test('工具：read 带 layers／assign_layer；面板专属层 op 回 rejected；写类 action 必须显式 project', async () => {
  let definition
  registerTools({
    get(key) {
      if (key === 'tools') return { register: (def) => ((definition = def), () => {}) }
      return undefined
    },
  })
  const project = tempProject()
  await mutate(project, [{ op: 'add_domain', title: '人域', author: 'human' }], { author: 'human' })

  const view = await definition.execute({ action: 'read', project }, {})
  assert.equal(view.layers.length, 3)
  assert.equal(view.domains[0].layer, 'human')

  const write = await definition.execute(
    {
      action: 'write',
      project,
      ops: [
        { op: 'add_layer', name: '阶段', owner: 'human' },
        { op: 'add_note', text: '照常记一条' },
      ],
    },
    {},
  )
  assert.equal(write.rejected.length, 1)
  assert.equal(write.rejected[0].code, 'tool-op-not-allowed')
  assert.equal(write.applied, 1, '面板专属 op 被剔除，其余照常落盘')

  await assert.rejects(
    () => definition.execute({ action: 'write', ops: [{ op: 'add_note', text: 'x' }] }, {}),
    /必须显式传 project/u,
  )
})
