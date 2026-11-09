// 结构台 · v1.16 完成判据单测（node --test）
// 判据是域上「什么算落地」的一条可检验的话：默认 ''、trim ≤300、可清空、进 rev、进域录不进简报。
// 旧板兼容与工具出口用临时目录跑真盘。

import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyOps, derived, newBoard, normalizeBoard, revOf } from '../lib/core.js'
import { buildBrief, buildRegister } from '../lib/brief.js'
import { mutate, readState } from '../lib/store.js'
import { registerTools } from '../lib/tools.js'

const tempRoots = []
// 工具层会记「最近项目」，指到临时家目录，别碰真的 ~/.dsh
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'sd-home-'))

/** 建一个临时项目目录（不写盘）。 */
function tempProject() {
  const root = mkdtempSync(join(tmpdir(), 'sd-criteria-'))
  tempRoots.push(root)
  return root
}

after(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true })
})

/** 拿一份注册好的工具定义（假 ctx：只提供 tools.register）。 */
function captureTool() {
  let definition
  registerTools({
    get(key) {
      if (key === 'tools') return { register: (def) => ((definition = def), () => {}) }
      return undefined
    },
  })
  return definition
}

test('normalizeBoard：旧板没有 criteria 补空串，format 不升级（G5）', () => {
  const board = normalizeBoard({
    format: 'structure-desk/1',
    project: { path: 'D:\\demo', name: 'demo' },
    domains: [{ id: 'D1', title: '老域', statement: '读源码', status: 'solid', tags: [], note: '', author: 'human' }],
    blocks: [],
    links: [],
    notes: [],
  }, 'D:\\demo')
  assert.equal(board.format, 'structure-desk/1')
  assert.equal(board.domains[0].criteria, '')
})

test('normalizeBoard：criteria trim 且超长截断到 300 字', () => {
  const board = normalizeBoard({
    ...newBoard('D:\\demo', 'demo'),
    domains: [
      { id: 'D1', title: '带空白', criteria: '  写清楚为什么算完成  ', author: 'human' },
      { id: 'D2', title: '超长', criteria: 'x'.repeat(420), author: 'human' },
    ],
  }, 'D:\\demo')
  assert.equal(board.domains[0].criteria, '写清楚为什么算完成')
  assert.equal(board.domains[1].criteria.length, 300)
})

test('applyOps：add_domain／update_domain 读写 criteria，空串清空，别的 op 不收该字段', () => {
  const added = applyOps(newBoard('D:\\demo'), [
    { op: 'add_domain', title: '限流', criteria: '  登录接口 429 且日志里能查  ' },
    { op: 'add_domain', title: '超长', criteria: 'y'.repeat(420) },
  ])
  assert.deepEqual(added.errors, [])
  const limit = added.board.domains.find((d) => d.title === '限流')
  assert.equal(limit.criteria, '登录接口 429 且日志里能查')
  assert.equal(added.board.domains.find((d) => d.title === '超长').criteria.length, 300)

  const changed = applyOps(added.board, [{ op: 'update_domain', id: limit.id, criteria: '新判据：端到端跑通' }])
  assert.deepEqual(changed.errors, [])
  assert.equal(changed.board.domains.find((d) => d.id === limit.id).criteria, '新判据：端到端跑通')

  const cleared = applyOps(changed.board, [{ op: 'update_domain', id: limit.id, criteria: '   ' }])
  assert.equal(cleared.board.domains.find((d) => d.id === limit.id).criteria, '')

  // 块不接受 criteria（契约 §2.1：其它 op 不接受该字段）
  const withBlock = applyOps(cleared.board, [{ op: 'add_block', path: 'src/a.js', criteria: '不该落在块上' }])
  assert.equal(withBlock.errors.length, 0)
  assert.equal('criteria' in withBlock.board.blocks[0], false)
})

test('rev：criteria 进语义指纹，只改判据 rev 也变', () => {
  const board = normalizeBoard({ ...newBoard('D:\\demo', 'demo'), domains: [{ id: 'D1', title: 'A', author: 'human' }] }, 'D:\\demo')
  const same = structuredClone(board)
  const changed = structuredClone(board)
  changed.domains[0].criteria = '做到 X 就算完成'
  assert.equal(revOf(same), revOf(board))
  assert.notEqual(revOf(changed), revOf(board))
})

test('buildRegister：非空判据多一行「- 判据：…」；buildBrief 不带（G3）', () => {
  const board = normalizeBoard({
    ...newBoard('D:\\demo', 'demo'),
    domains: [
      { id: 'D1', title: '限流', statement: '做限流', criteria: '登录接口 429 且日志里能查', author: 'human' },
      { id: 'D2', title: '别的域', statement: '没写判据', author: 'human' },
    ],
  }, 'D:\\demo')
  const { gaps, stats } = derived(board)
  const register = buildRegister(board, gaps, stats)
  assert.ok(register.includes('### D1 限流'))
  assert.ok(register.includes('- 判据：登录接口 429 且日志里能查'))
  assert.equal(register.match(/- 判据：/gu).length, 1, '空判据的域不出判据行')

  const brief = buildBrief(board, gaps, stats, { now: '2026-11-09T00:00:00.000Z' })
  assert.ok(!brief.includes('- 判据：'), '简报不带判据行（G3）')
  assert.ok(!brief.includes('登录接口 429'))
})

test('旧板（board.json 无 criteria）能读，写回后判据可存可读', async () => {
  const project = tempProject()
  const files = join(project, '结构蓝图')
  mkdirSync(files, { recursive: true })
  writeFileSync(
    join(files, 'board.json'),
    JSON.stringify({
      format: 'structure-desk/1',
      project: { path: project, name: '旧板' },
      title: '旧板 · 结构蓝图',
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
      seq: { D: 1, B: 0, L: 0, N: 0 },
      domains: [
        {
          id: 'D1',
          title: '老域',
          statement: '旧板里的说法',
          parent: null,
          status: 'solid',
          tags: [],
          note: '',
          author: 'human',
          createdAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-01T00:00:00.000Z',
        },
      ],
      blocks: [],
      links: [],
      notes: [],
    }),
    'utf8',
  )

  const before = await readState(project)
  assert.equal(before.board.domains[0].criteria, '', '旧板读入补空串')

  const next = await mutate(project, [{ op: 'update_domain', id: 'D1', criteria: '文件里有 20 个测试通过' }], { author: 'human' })
  assert.deepEqual(next.changed.errors, [])
  const reread = await readState(project)
  assert.equal(reread.board.domains[0].criteria, '文件里有 20 个测试通过')
})

test('工具 read 的 domain 带 criteria；read／gaps 的落差摘要带 byLayer 计数', async () => {
  const project = tempProject()
  const { errors } = (
    await mutate(
      project,
      [
        { op: 'add_domain', title: '人域', criteria: '人写的判据', author: 'human' },
        { op: 'add_domain', title: 'agent 域', criteria: 'agent 判据', author: 'agent' },
        { op: 'add_block', path: 'future/a.js', planned: true, author: 'agent' },
        { op: 'add_block', path: 'src/a.js', author: 'program' },
      ],
      { author: 'human' },
    )
  ).changed
  assert.deepEqual(errors, [])

  const tool = captureTool()
  const view = await tool.execute({ action: 'read', project }, {})
  assert.equal(view.domains.find((d) => d.title === '人域').criteria, '人写的判据')
  assert.deepEqual(view.gaps.byLayer, {
    human: { ungrounded: 1, planOpen: 0 },
    agent: { ungrounded: 1, planOpen: 1 },
    program: { unannotated: 1 },
  })

  const gapsView = await tool.execute({ action: 'gaps', project }, {})
  assert.deepEqual(gapsView.gaps.byLayer.agent, { ungrounded: 1, planOpen: 1 })
  assert.deepEqual(gapsView.gaps.byLayer.program, { unannotated: 1 })
})
