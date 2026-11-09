// 结构台 · scan.js 单测（node --test）
// 夹具都建在 os.tmpdir()，不写仓库。

import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { diffScan, scanProject } from '../lib/scan.js'

const tempRoots = []

/** 建一个临时项目夹具：files 的键是相对路径，值是 string 或 Buffer。 */
async function makeProject(files) {
  const root = await mkdtemp(join(tmpdir(), 'sd-scan-'))
  tempRoots.push(root)
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, ...rel.split('/'))
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, content)
  }
  return root
}

after(async () => {
  for (const root of tempRoots) {
    await rm(root, { recursive: true, force: true }).catch(() => {})
  }
})

const sha8 = (content) => createHash('sha256').update(content).digest('hex').slice(0, 8)
const byPath = (files) => new Map(files.map((file) => [file.path, file]))

/** 默认夹具：处处有该跳过的与该收的。 */
function baseFixture() {
  return {
    'README.md': '# 示例\n第二行\n',
    'big.txt': 'x'.repeat(400),
    'empty.txt': '',
    'src/a.js': 'export const a = 1;\n',
    'src/notes.md': 'note\n',
    'src/deep/b.ts': 'export const b: number = 2;\n',
    'node_modules/pkg/index.js': 'module.exports = 1\n',
    '.git/config': '[core]\n',
    '.dsh-tmp/scratch.md': '# tmp\n',
    'dist/out.js': 'dist\n',
    '结构蓝图/board.json': '{}\n',
    'assets/logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00]),
    'data/blob.custom': Buffer.from([1, 2, 0, 3]), // 扩展名不常见，靠 NUL 嗅探认出二进制
  }
}

test('scanProject：收文本文件、跳目录与二进制，路径用正斜杠', async () => {
  const root = await makeProject(baseFixture())
  const result = await scanProject(root)

  assert.deepEqual(
    result.files.map((file) => file.path),
    ['README.md', 'big.txt', 'empty.txt', 'src/a.js', 'src/notes.md', 'src/deep/b.ts'],
  )
  for (const file of result.files) {
    assert.ok(!file.path.includes('\\'), `路径应为正斜杠：${file.path}`)
    assert.match(file.sha, /^[0-9a-f]{8}$/)
  }

  const map = byPath(result.files)
  const readme = map.get('README.md')
  assert.equal(readme.lang, 'md')
  assert.equal(readme.bytes, Buffer.byteLength('# 示例\n第二行\n'))
  assert.equal(readme.lines, 2)
  assert.equal(readme.sha, sha8('# 示例\n第二行\n'))

  const empty = map.get('empty.txt')
  assert.equal(empty.bytes, 0)
  assert.equal(empty.lines, 0)
  assert.equal(empty.sha, sha8(''))

  assert.equal(map.get('src/a.js').lang, 'js')
  assert.equal(map.get('src/deep/b.ts').lang, 'ts')

  // 不该出现的：依赖目录、点开头目录、dist、数据目录、二进制
  for (const skip of ['node_modules/', '.git/', '.dsh-tmp/', 'dist/', '结构蓝图/']) {
    assert.ok(!result.files.some((file) => file.path.startsWith(skip)), `应跳过 ${skip}`)
  }

  assert.equal(result.skipped, 2, '两个二进制文件被跳过')
  assert.deepEqual(result.skippedReasons, { dirs: 5, big: 0, binary: 2 })
  assert.equal(result.truncated, false)
  assert.equal(result.truncatedCount, 0)
  assert.equal(result.counts.files, 6)
  assert.equal(result.counts.total, 6)
  assert.equal(result.counts.bytes, result.files.reduce((sum, file) => sum + file.bytes, 0))
})

test('scanProject：超 maxFileBytes 的不收，记 big 原因', async () => {
  const root = await makeProject(baseFixture())
  const result = await scanProject(root, { maxFileBytes: 100 })

  assert.ok(!result.files.some((file) => file.path === 'big.txt'))
  assert.equal(result.skippedReasons.big, 1)
  assert.equal(result.skippedReasons.binary, 2)
  assert.equal(result.skipped, 3)
})

test('scanProject：root 限子目录，返回路径仍相对项目根', async () => {
  const root = await makeProject(baseFixture())
  const result = await scanProject(root, { root: 'src' })

  assert.deepEqual(result.files.map((file) => file.path), ['src/a.js', 'src/notes.md', 'src/deep/b.ts'])
  for (const file of result.files) assert.ok(file.path.startsWith('src/'))
  assert.equal(result.skippedReasons.dirs, 0)
})

test('scanProject：limit 截断时浅路径优先、同深度代码文件优先', async () => {
  const root = await makeProject({
    'zeta.md': '# z\n',
    'notes.txt': 'n\n',
    'alpha.js': 'export {}\n',
    'src/main.py': 'print(1)\n',
  })
  const result = await scanProject(root, { limit: 2 })

  assert.deepEqual(result.files.map((file) => file.path), ['alpha.js', 'notes.txt'])
  assert.equal(result.truncated, true)
  assert.equal(result.truncatedCount, 2)
  assert.equal(result.counts.total, 4)
  assert.equal(result.counts.files, 2)

  const all = await scanProject(root, { limit: 10 })
  assert.equal(all.files.length, 4)
  assert.equal(all.truncated, false)
})

test('scanProject：include / exclude 支持 ** * ? 与裸文件名', async () => {
  const root = await makeProject(baseFixture())

  const inSrc = await scanProject(root, { include: ['src/**'], exclude: ['**/*.ts'] })
  assert.deepEqual(inSrc.files.map((file) => file.path), ['src/a.js', 'src/notes.md'])

  const noMd = await scanProject(root, { exclude: ['*.md'] })
  assert.ok(!noMd.files.some((file) => file.path.endsWith('.md')))

  const noPy = await scanProject(root, { include: ['*.py'] })
  assert.equal(noPy.files.length, 0)

  const onlyOne = await scanProject(root, { include: ['src/?.js'] })
  assert.deepEqual(onlyOne.files.map((file) => file.path), ['src/a.js'])
})

test('scanProject：行数口径（末尾无换行也算一行）与中文/空格路径', async () => {
  const root = await makeProject({
    'one.txt': 'abc',
    'two.txt': 'a\nb',
    'three.txt': 'a\nb\n',
    'zero.txt': '',
    '文档/说明 文件.md': '# 说明\n',
  })
  const map = byPath((await scanProject(root)).files)
  assert.equal(map.get('one.txt').lines, 1)
  assert.equal(map.get('two.txt').lines, 2)
  assert.equal(map.get('three.txt').lines, 2)
  assert.equal(map.get('zero.txt').lines, 0)
  assert.equal(map.get('文档/说明 文件.md').lines, 1)
})

test('scanProject：点开头的文件照收，点开头的目录跳过', async () => {
  const root = await makeProject({
    '.env': 'SECRET=1\n',
    '.github/workflows/ci.yml': 'name: ci\n',
  })
  const result = await scanProject(root)
  assert.deepEqual(result.files.map((file) => file.path), ['.env'])
  assert.equal(result.skippedReasons.dirs, 1)
})

test('scanProject：坏路径报 ENOENT，root 不许跳出项目', async () => {
  await assert.rejects(() => scanProject(join(tmpdir(), 'sd-definitely-missing-目录')), /项目路径不存在/)
  await assert.rejects(() => scanProject(join(tmpdir(), 'sd-missing', 'x'), {}), (err) => err.code === 'ENOENT')

  const root = await makeProject({ 'a.txt': 'a\n' })
  await assert.rejects(() => scanProject(root, { root: '../outside' }), /不能跳出项目/)
  await assert.rejects(() => scanProject(root, { root: '/abs/path' }), /相对路径/)
  await assert.rejects(() => scanProject(root, { root: 'nope' }), (err) => err.code === 'ENOENT')
})

test('diffScan：按 (path, symbol) 对账，回 added/changed/removed/same', async () => {
  const root = await makeProject(baseFixture())
  const scan = await scanProject(root)
  const map = byPath(scan.files)
  const readme = map.get('README.md')
  const ajs = map.get('src/a.js')

  const blocks = [
    { id: 'B1', path: 'README.md', symbol: null, planned: false, bytes: readme.bytes, sha: readme.sha, stale: false },
    { id: 'B2', path: 'src/a.js', symbol: null, planned: false, bytes: 999, sha: 'deadbeef', stale: false },
    { id: 'B3', path: 'gone.md', symbol: null, planned: false, bytes: 10, sha: '00000000', stale: false },
    { id: 'B4', path: 'old.md', symbol: null, planned: false, bytes: 10, sha: '11111111', stale: true },
    { id: 'B5', path: 'future/x.md', symbol: null, planned: true, bytes: null, sha: null, stale: false },
    { id: 'B6', path: 'src/deep/b.ts', symbol: 'b', planned: false, bytes: 5, sha: '22222222', stale: false },
  ]

  const diff = diffScan(blocks, scan.files)
  assert.deepEqual(diff.added.map((file) => file.path), ['big.txt', 'empty.txt', 'src/deep/b.ts', 'src/notes.md'])
  assert.equal(diff.changed.length, 1)
  assert.equal(diff.changed[0].block.id, 'B2')
  assert.equal(diff.changed[0].file.path, 'src/a.js')
  assert.equal(diff.same.length, 1)
  assert.equal(diff.same[0].block.id, 'B1')
  assert.equal(diff.same[0].file.sha, readme.sha)
  // B3 失联；B4 已 stale 不重复报；B5 是计划块；B6 是符号块但文件还在
  assert.deepEqual(diff.removed.map((block) => block.id), ['B3'])
})

test('diffScan：顺序稳定、入参不改、空输入安全', async () => {
  const root = await makeProject(baseFixture())
  const scan = await scanProject(root)
  const reversed = [...scan.files].reverse()
  const empty = diffScan(undefined, undefined)
  assert.deepEqual(empty, { added: [], changed: [], removed: [], same: [] })

  const diff = diffScan([], reversed)
  const paths = diff.added.map((file) => file.path)
  assert.deepEqual(paths, [...paths].sort())
  assert.equal(paths.length, 6)
  // 入参没被改
  assert.deepEqual(scan.files.map((file) => file.path).slice(0, 3), ['README.md', 'big.txt', 'empty.txt'])
})

