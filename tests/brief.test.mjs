// 结构台 · brief.js 单测（node --test）
// 纯函数：不起盘、不联网；板子夹具直接写在内存里。

import test from 'node:test'
import assert from 'node:assert/strict'
import { buildBrief, buildRegister } from '../lib/brief.js'

const NOW = '2026-11-06T13:20:00.000Z'

/** 一块有代表性的板子：一实块被覆盖、一实块没标注、一计划块未落地、一域是空承诺、一处矛盾。 */
function sampleBoard() {
  return {
    format: 'structure-desk/1',
    project: { path: 'D:\\demo', name: 'demo' },
    title: 'demo · 结构蓝图',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: NOW,
    seq: { D: 3, B: 3, L: 5, N: 1 },
    domains: [
      {
        id: 'D1',
        title: '解析',
        statement: '把源码读成块。',
        parent: null,
        status: 'solid',
        tags: ['核心'],
        note: '先这样',
        author: 'human',
      },
      { id: 'D2', title: '词法', statement: '', parent: 'D1', status: 'thin', tags: [], note: '', author: 'agent' },
      { id: 'D3', title: '输出 | 渲染', statement: '写出去。', parent: null, status: 'open', tags: [], note: '', author: 'human' },
    ],
    blocks: [
      {
        id: 'B1',
        path: 'src/parse.py',
        symbol: null,
        kind: 'file',
        lang: 'py',
        bytes: 1234,
        lines: 56,
        sha: 'ab12cd34',
        address: 'src/parse.py',
        planned: false,
        ground: null,
        stale: false,
        note: '',
        author: 'program',
      },
      {
        id: 'B2',
        path: 'README.md',
        symbol: null,
        kind: 'file',
        lang: 'md',
        bytes: 2048,
        lines: 40,
        sha: '11223344',
        address: 'README.md',
        planned: false,
        ground: null,
        stale: false,
        note: '',
        author: 'program',
      },
      {
        id: 'B3',
        path: 'future/output.md',
        symbol: null,
        kind: 'plan',
        lang: null,
        bytes: null,
        lines: null,
        sha: null,
        address: 'future/output.md',
        planned: true,
        ground: null,
        stale: false,
        note: '',
        author: 'human',
      },
    ],
    links: [
      { id: 'L1', from: 'D1', to: 'B1', type: 'covers', note: '', author: 'human' },
      { id: 'L2', from: 'D1', to: 'D2', type: 'refines', note: '', author: 'human' },
      { id: 'L3', from: 'D3', to: 'B3', type: 'plans', note: '', author: 'human' },
      { id: 'L4', from: 'B1', to: 'B2', type: 'depends', note: '', author: 'human' },
      { id: 'L5', from: 'D1', to: 'D3', type: 'contradicts', note: '', author: 'human' },
    ],
    notes: [{ id: 'N1', text: '这里先不动', ref: 'B1', color: 'amber', author: 'human' }],
  }
}

function sampleGaps() {
  return { unannotated: ['B2'], ungrounded: ['D2'], planOpen: ['B3'], conflicts: ['L5'], stale: [] }
}

function sampleStats() {
  return {
    domains: 3,
    blocks: 3,
    realBlocks: 2,
    planBlocks: 1,
    links: 5,
    notes: 1,
    covered: 1,
    unannotated: 1,
    ungrounded: 1,
    planOpen: 1,
    conflicts: 1,
    stale: 0,
    bytes: 3282,
    byType: { covers: 1, refines: 1, plans: 1, depends: 1, contradicts: 1 },
  }
}

function linesOf(text) {
  return text.split('\n').length
}

/** 深冻结：拿来确认两个函数只读入参。 */
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value)) deepFreeze(value[key])
  }
  return value
}

test('buildBrief：标题、时刻、结论、规模', () => {
  const text = buildBrief(sampleBoard(), sampleGaps(), sampleStats(), { now: NOW })

  assert.ok(text.startsWith('# 结构台简报 · demo'))
  assert.ok(text.includes(`> 生成于 ${NOW} · format structure-desk/1`))
  assert.ok(text.includes('## 先看'))
  assert.ok(text.includes('- 实块 2 个：1 个已被说法覆盖，1 个还没人管。'))
  assert.ok(text.includes('- 域 3 个：1 个是空承诺（只有说法，没有块也没有子域）。'))
  assert.ok(text.includes('- 计划块 1 个：1 个还没落地。'))
  assert.ok(text.includes('- 矛盾 1 处；失联 0 块。'))
  assert.ok(text.includes('## 规模'))
  assert.ok(text.includes('域 3 · 块 3（实 2／计划 1）· 连接 5 · 笔记 1 · 覆盖 1/2 · 体积 3.2 KB · 失联 0'))
  assert.ok(linesOf(text) <= 200)
})

test('buildBrief：落差四组各列 id + 地址/标题', () => {
  const text = buildBrief(sampleBoard(), sampleGaps(), sampleStats(), { now: NOW })

  assert.ok(text.includes('## 落差'))
  assert.ok(text.includes('### 未标注 1'))
  assert.ok(text.includes('- B2 `README.md` · 2.0 KB'))
  assert.ok(text.includes('### 空承诺 1'))
  assert.ok(text.includes('- D2 词法 · thin'))
  assert.ok(text.includes('### 未落地 1'))
  assert.ok(text.includes('- B3 `future/output.md`'))
  assert.ok(text.includes('### 矛盾 1'))
  assert.ok(text.includes('- L5 D1 解析 ↔ D3 输出 | 渲染'))
})

test('buildBrief：域树、未覆盖块、连接统计、页脚', () => {
  const text = buildBrief(sampleBoard(), sampleGaps(), sampleStats(), { now: NOW })

  assert.ok(text.includes('## 域树'))
  assert.ok(text.includes('- D1 解析 · solid'))
  assert.ok(text.includes('  - D2 词法 · thin（空承诺）'))
  assert.ok(text.includes('- D3 输出 | 渲染 · open'))
  assert.ok(text.includes('## 未覆盖块（1）'))
  assert.ok(text.includes('- B2 `README.md` · md · 2.0 KB'))
  assert.ok(text.includes('## 连接统计'))
  assert.ok(text.includes('共 5 条连接。 covers 覆盖 1 · refines 细化 1 · contradicts 矛盾 1'))
  assert.ok(text.includes('depends 依赖 1 · calls 调用 0 · plans 计划 1 · grounds 落地 0 · relates 关联 0'))
  assert.ok(text.includes('未覆盖是一等状态，不是错误。'))
})

test('buildBrief：行数上限生效，maxLines=1 也不炸', () => {
  const board = sampleBoard()
  const gaps = sampleGaps()
  const stats = sampleStats()

  const clipped = buildBrief(board, gaps, stats, { now: NOW, maxLines: 20 })
  assert.equal(linesOf(clipped), 20)
  assert.ok(clipped.includes('已截断到 20 行'))

  const one = buildBrief(board, gaps, stats, { now: NOW, maxLines: 1 })
  assert.equal(linesOf(one), 1)
  assert.ok(one.startsWith('# 结构台简报'))
})

test('buildBrief：可截断每组落差与未覆盖 top N', () => {
  const board = sampleBoard()
  const extra = ['B2']
  board.blocks.push(
    { id: 'B4', path: 'docs/a.md', kind: 'file', lang: 'md', bytes: 300, address: 'docs/a.md', planned: false },
    { id: 'B5', path: 'docs/b.md', kind: 'file', lang: 'md', bytes: 100, address: 'docs/b.md', planned: false },
    { id: 'B6', path: 'docs/c.md', kind: 'file', lang: 'md', bytes: 50, address: 'docs/c.md', planned: false },
  )
  extra.push('B4', 'B5', 'B6')
  const gaps = { unannotated: extra, ungrounded: ['D2'], planOpen: ['B3'], conflicts: [] }

  const text = buildBrief(board, gaps, sampleStats(), { now: NOW, maxPerGap: 2, topUncovered: 2 })
  assert.ok(text.includes('### 未标注 4'))
  assert.ok(text.includes('…其余 2 条见域录。'))
  // 未覆盖按体积从大到小，页面前 2 个是 README.md 与 docs/a.md
  assert.ok(text.includes('## 未覆盖块（2/4）'))
  assert.ok(text.indexOf('README.md') < text.indexOf('docs/a.md'))
})

test('buildBrief：stats/gaps 缺省时自己从板子补算', () => {
  const withStats = buildBrief(sampleBoard(), sampleGaps(), sampleStats(), { now: NOW })
  const withoutStats = buildBrief(sampleBoard(), undefined, undefined, { now: NOW })

  assert.ok(withoutStats.includes('- 实块 2 个：1 个已被说法覆盖，1 个还没人管。'))
  assert.ok(withoutStats.includes('### 未标注 1'))
  assert.ok(withoutStats.includes('### 空承诺 1'))
  assert.ok(withoutStats.includes('### 未落地 1'))
  assert.ok(withoutStats.includes('### 矛盾 1'))
  assert.ok(withoutStats.includes('covers 覆盖 1'))
  // 有 stats 与没 stats 的板子结论一致（只有 byType/规模同源）
  assert.equal(linesOf(withStats), linesOf(withoutStats))
})

test('buildBrief：空板子安全', () => {
  const text = buildBrief({}, {}, {}, { now: NOW })
  assert.ok(text.startsWith('# 结构台简报 · project'))
  assert.ok(text.includes('- 实块 0 个：0 个已被说法覆盖，0 个还没人管。'))
  assert.ok(text.includes('还没有域。'))
  assert.ok(text.includes('所有实块都已有说法覆盖。'))
  assert.ok(text.includes('共 0 条连接。'))
})

test('buildBrief：locale=en 出英文骨架', () => {
  const text = buildBrief(sampleBoard(), sampleGaps(), sampleStats(), { now: NOW, locale: 'en' })
  assert.ok(text.startsWith('# Structure Desk brief · demo'))
  assert.ok(text.includes('## At a glance'))
  assert.ok(text.includes('### Unannotated 1'))
  assert.ok(text.includes('## Domain tree'))
  assert.ok(text.includes('Unannotated is a first-class state, not an error.'))
})

test('buildRegister：每域一节（状态·作者·说法·覆盖·出边）', () => {
  const text = buildRegister(sampleBoard(), sampleGaps(), sampleStats())

  assert.ok(text.startsWith('# demo · 域录'))
  assert.ok(text.includes(`> 板子更新于 ${NOW} · format structure-desk/1`))
  assert.ok(text.includes('## 域'))
  assert.ok(text.includes('### D1 解析 · 实 · 人'))
  assert.ok(text.includes('- 说法：把源码读成块。'))
  assert.ok(text.includes('- 子域：D2 词法'))
  assert.ok(text.includes('- 覆盖块（1）：B1 `src/parse.py`'))
  assert.ok(text.includes('- 出边（3）：L1 covers 覆盖 → B1 src/parse.py；L2 refines 细化 → D2 词法'))
  assert.ok(text.includes('- 标签：核心'))
  assert.ok(text.includes('- 批注：先这样'))
  assert.ok(text.includes('### D2 词法 · 薄 · 智能体'))
  assert.ok(text.includes('- 空承诺：没有覆盖块、没有子域、没有计划'))
})

test('buildRegister：块录表、连接录表、笔记、竖线转义', () => {
  const text = buildRegister(sampleBoard(), sampleGaps(), sampleStats())

  assert.ok(text.includes('## 块录'))
  assert.ok(text.includes('| id | 地址 | 语言 | 字节 | 状态 | 归属域 |'))
  assert.ok(text.includes('| B1 | `src/parse.py` | py | 1.2 KB | 实 | D1 解析 |'))
  assert.ok(text.includes('| B2 | `README.md` | md | 2.0 KB | 实 | — |'))
  assert.ok(text.includes('| B3 | `future/output.md` | — | — | 计划 | — |'))
  assert.ok(text.includes('## 连接录'))
  assert.ok(text.includes('| id | 从 | 到 | 类型 | 备注 |'))
  assert.ok(text.includes('| L5 | D1 解析 | D3 输出 \\| 渲染 | contradicts 矛盾 | — |'))
  assert.ok(text.includes('## 笔记'))
  assert.ok(text.includes('- N1 · amber「这里先不动」'))
  // 标题里的竖线在表格单元里要转义
  assert.ok(text.includes('\\|'))
})

test('buildRegister：空板子安全、结果稳定、入参只读', () => {
  const empty = buildRegister({}, {}, {})
  assert.ok(empty.startsWith('# project · 域录'))
  assert.ok(empty.includes('还没有域。'))
  assert.ok(empty.includes('## 块录'))
  assert.ok(empty.includes('## 连接录'))

  const board = deepFreeze(sampleBoard())
  const gaps = deepFreeze(sampleGaps())
  const stats = deepFreeze(sampleStats())
  const first = buildBrief(board, gaps, stats, { now: NOW })
  const second = buildBrief(board, gaps, stats, { now: NOW })
  assert.equal(first, second)
  assert.equal(buildRegister(board, gaps, stats), buildRegister(board, gaps, stats))
  assert.ok(first.includes('## 先看'))
})
