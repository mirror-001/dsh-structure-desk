// 结构台 · 历史层单测（node --test）
// 覆盖 v1.14：一次写板=一批（journal 带 batch）、快照、/revert 语义、保留上限。
// 用临时目录跑真盘（不碰示例项目）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyLayout,
  boardFiles,
  mutate,
  readHistory,
  readState,
  replaceBoard,
  revertBatch,
} from '../lib/store.js'

function tempProject() {
  return mkdtempSync(join(tmpdir(), 'sd-history-'))
}

async function firstMutations(project) {
  const s1 = await mutate(project, [
    { op: 'add_domain', title: '解析' },
    { op: 'add_block', path: 'src/a.js', lang: 'js', bytes: 10, lines: 1 },
  ])
  const domain = s1.board.domains[0]
  const block = s1.board.blocks[0]
  await applyLayout(project, { positions: { [domain.id]: { x: 100, y: 200 } } })
  const s2 = await mutate(project, [
    { op: 'update_block', id: block.id, note: '改了一句批注' },
    { op: 'add_note', text: '随手记' },
  ])
  return { s1, s2, domain, block }
}

test('一次 mutate 记一批：journal 每行带 batch，index 与快照都落盘', async () => {
  const project = tempProject()
  try {
    const { s1 } = await firstMutations(project)
    const files = boardFiles(project)
    const batches = await readHistory(project)
    assert.equal(batches.length, 2)
    assert.equal(batches[0].batch, s1.changed.batch)
    assert.equal(batches[0].counts.added, 2)
    assert.deepEqual(batches[0].diff.added.sort(), ['B1', 'D1'])
    assert.ok(batches[0].labels.B1)
    assert.match(batches[0].revBefore, /^[0-9a-f]{12}$/u) // 空板子算出来的修订号（不作链锚）
    assert.equal(batches[0].revAfter, s1.rev)

    const journal = readFileSync(files.journal, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    for (const entry of journal.slice(0, 2)) assert.equal(entry.batch, batches[0].batch)
    for (const entry of journal.slice(2)) assert.equal(entry.batch, batches[1].batch)

    const names = readdirSync(files.historyDir)
    assert.ok(names.includes(`${batches[0].batch}.json`))
    assert.ok(names.includes('index.json'))
    const snapshot = JSON.parse(readFileSync(join(files.historyDir, `${batches[1].batch}.json`), 'utf8'))
    assert.equal(snapshot.format, 'structure-desk-history/1')
    assert.equal(snapshot.board.domains.length, 1)
    assert.equal(snapshot.board.blocks[0].note, '')
    assert.equal(snapshot.layout.pos.D1.x, 100)
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('revert 一批：板子与坐标回到动手之前，回滚本身再记一批', async () => {
  const project = tempProject()
  try {
    const { s2, block } = await firstMutations(project)
    const batches = await readHistory(project)
    const target = batches[1]
    const reverted = await revertBatch(project, target.batch, { baseRev: s2.rev })

    assert.equal(reverted.board.blocks[0].note, '')
    assert.equal(reverted.board.notes.length, 0)
    assert.equal(reverted.layout.pos.D1.x, 100)
    assert.equal(reverted.reverted, target.batch)
    assert.equal(reverted.changed.removed.length, 1) // 那批记的便签被退掉
    assert.equal(reverted.changed.updated.includes(block.id), true)

    const after = await readHistory(project)
    assert.equal(after.length, 3)
    assert.equal(after[2].op, 'revert')
    assert.equal(after[2].reverted, target.batch)
    assert.equal(after[2].revAfter, reverted.rev)
    assert.ok(after[2].summary.includes('回滚'))
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('revert 的 baseRev 不对就 409，不动盘上的板子', async () => {
  const project = tempProject()
  try {
    const { s2 } = await firstMutations(project)
    const batches = await readHistory(project)
    await assert.rejects(
      () => revertBatch(project, batches[1].batch, { baseRev: 'deadbeef0000' }),
      (error) => {
        assert.equal(error.status, 409)
        assert.equal(error.rev, s2.rev)
        return true
      },
    )
    const state = await readState(project)
    assert.equal(state.board.blocks[0].note, '改了一句批注')
    assert.equal((await readHistory(project)).length, 2)
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('历史只留最近 50 批，旧快照文件一起清掉', async () => {
  const project = tempProject()
  try {
    await mutate(project, [{ op: 'add_domain', title: '起' }])
    for (let index = 0; index < 54; index += 1) {
      await mutate(project, [{ op: 'add_note', text: `第 ${index} 条` }])
    }
    const batches = await readHistory(project)
    assert.equal(batches.length, 50)
    const files = readdirSync(boardFiles(project).historyDir)
    const snapshots = files.filter((name) => name !== 'index.json')
    assert.equal(snapshots.length, 50)
    const kept = new Set(batches.map((item) => `${item.batch}.json`))
    for (const name of snapshots) assert.ok(kept.has(name), `多余快照：${name}`)
    const index = JSON.parse(readFileSync(boardFiles(project).historyIndex, 'utf8'))
    assert.equal(index.format, 'structure-desk-history/1')
    assert.equal(index.batches.length, 50)
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('整板替换（本地撤销/重做）也记一批，diff 对得上', async () => {
  const project = tempProject()
  try {
    const { s1, s2 } = await firstMutations(project)
    const restored = await replaceBoard(project, s1.board, { baseRev: s2.rev, summary: '撤销一步' })
    const batches = await readHistory(project)
    assert.equal(batches.length, 3)
    assert.equal(batches[2].op, 'replace')
    assert.equal(batches[2].summary, '撤销一步')
    assert.equal(batches[2].diff.removed.length, 1) // 第二次加的便签被撤掉
    assert.equal(batches[2].diff.updated.length, 1) // 块批注退回
    assert.equal(restored.board.blocks[0].note, '')
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('历史文件坏了也不影响读板子', async () => {
  const project = tempProject()
  try {
    await firstMutations(project)
    const files = boardFiles(project)
    writeFileSync(files.historyIndex, '{ 坏掉的 JSON', 'utf8')
    const state = await readState(project)
    assert.equal(state.board.domains.length, 1)
    assert.deepEqual(state.history, [])
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})
