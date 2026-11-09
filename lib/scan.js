// 结构台 · 扫描（块是跑出来的）
// 只读项目文件，不写盘；只用 node: 内置模块。
// 口径见《设计·结构台》§八：跳过规则、sha 前 8 位、按浅路径与代码文件优先截断。
// 注意：扫描不改域与连接；「既有实块失联」只在 diffScan 里回报 removed，标 stale 由调用方决定。

import { createHash } from 'node:crypto'
import { open, readFile, readdir, stat } from 'node:fs/promises'
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path'

export const DEFAULT_LIMIT = 320
export const DEFAULT_MAX_FILE_BYTES = 512 * 1024

/** 一律跳过的目录名（另有：所有点开头的目录）。 */
const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  'dist',
  'build',
  '.next',
  'target',
  'coverage',
  '.git',
])

/** 结构台自己的数据目录默认名；扫描时绕开，免得把自己的板子收成块。 */
const DEFAULT_DATA_DIR = '结构蓝图'

/** 常见二进制扩展名：不读内容也能先挡掉。 */
const BINARY_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'tif', 'tiff', 'avif', 'heic',
  'pdf', 'zip', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'tar', 'jar', 'war', 'zst',
  'exe', 'dll', 'so', 'dylib', 'bin', 'dat', 'class', 'pyc', 'pyd', 'o', 'a', 'lib', 'obj',
  'woff', 'woff2', 'ttf', 'otf', 'eot', 'ttc',
  'mp3', 'mp4', 'm4a', 'mov', 'avi', 'webm', 'mkv', 'wav', 'ogg', 'flac', 'wmv', 'flv',
  'psd', 'ai', 'sketch', 'fig', 'blend', 'ttf2',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp',
  'db', 'sqlite', 'sqlite3', 'mdb', 'wasm', 'node',
])

/** 扩展名归一：少数写法统一，其余直接照扩展名。 */
const LANG_ALIAS = {
  mjs: 'js', cjs: 'js', mts: 'ts', cts: 'ts',
  htm: 'html', yml: 'yaml', markdown: 'md',
}

/** 代码文件集合：截断时同深度内排前面。 */
const CODE_LANGS = new Set([
  'js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'c', 'h',
  'cc', 'cpp', 'cxx', 'hpp', 'hh', 'cs', 'php', 'swift', 'm', 'mm', 'scala', 'lua',
  'sh', 'bash', 'zsh', 'ps1', 'psm1', 'sql', 'vue', 'svelte', 'astro', 'dart', 'ex',
  'exs', 'erl', 'hs', 'clj', 'jl', 'pl', 'r', 'groovy', 'v', 'zig', 'nim',
])

// ── 小工具 ─────────────────────────────────────────────────────────

/** 取相对正斜杠路径里的扩展名小写（不带点）；没有扩展名返回空串。 */
function extOf(rel) {
  const base = rel.slice(rel.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot + 1).toLowerCase()
}

/** 语言名：按扩展名归一。 */
function langOf(rel) {
  const ext = extOf(rel)
  if (!ext) return null
  return LANG_ALIAS[ext] || ext
}

/** 路径扩展名是不是常见二进制。 */
function isBinaryPath(rel) {
  return BINARY_EXTS.has(extOf(rel))
}

/** 是否代码文件。 */
function isCodeLang(lang) {
  return Boolean(lang) && CODE_LANGS.has(lang)
}

/** sha256 前 8 位。 */
function sha8(buf) {
  return createHash('sha256').update(buf).digest('hex').slice(0, 8)
}

/** 按 \n 数行：末尾无换行也算一行；空文件 0 行。 */
function countLines(buf) {
  if (!buf.length) return 0
  let lines = 0
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) lines += 1
  }
  if (buf[buf.length - 1] !== 0x0a) lines += 1
  return lines
}

/** 正斜杠相对路径。 */
function toPosix(p) {
  return p.split(sep).join('/')
}

/** 有限正整数，带下限与兜底。 */
function intOpt(value, fallback, min) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.floor(n))
}

// ── include / exclude 的极简 glob ─────────────────────────────────

/** glob → 正则：支持 ** * ?；不含 / 的模式同时按文件名匹配。 */
function globToRegExp(pattern) {
  let src = String(pattern).replace(/\\/g, '/').replace(/^\.\//, '')
  let re = '^'
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (ch === '*') {
      if (src[i + 1] === '*') {
        i += 1
        if (src[i + 1] === '/') {
          i += 1
          re += '(?:.*/)?' // **/ 可以匹配零层目录
        } else {
          re += '.*'
        }
      } else {
        re += '[^/]*'
      }
    } else if (ch === '?') {
      re += '[^/]'
    } else if ('\\^$+.()|{}[]'.includes(ch)) {
      re += `\\${ch}`
    } else {
      re += ch
    }
  }
  return new RegExp(`${re}$`)
}

/** 预编译模式表。 */
function compilePatterns(list) {
  return (Array.isArray(list) ? list : [])
    .filter((x) => typeof x === 'string' && x.trim())
    .map((raw) => {
      const clean = raw.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
      return { raw: clean, re: globToRegExp(clean) }
    })
}

/** 路径命中任一模式。 */
function matchAny(patterns, rel) {
  if (!patterns.length) return false
  if (patterns.some((p) => p.re.test(rel))) return true
  const base = rel.slice(rel.lastIndexOf('/') + 1)
  return patterns.some((p) => !p.raw.includes('/') && p.re.test(base))
}

// ── 目录规整 ──────────────────────────────────────────────────────

/** 把 opts.root 规整成项目内相对路径；空或 '.' 表示项目根。 */
function normalizeRoot(root) {
  if (root == null) return ''
  const text = String(root).trim()
  if (!text || text === '.') return ''
  if (isAbsolute(text) || /^[A-Za-z]:/.test(text) || text.startsWith('/')) {
    const err = new Error(`root 必须是项目内的相对路径：${text}`)
    err.code = 'EINVALID'
    throw err
  }
  const norm = posix.normalize(text.replace(/\\/g, '/'))
  if (norm === '.') return ''
  if (norm.startsWith('../') || norm === '..') {
    const err = new Error(`root 不能跳出项目：${text}`)
    err.code = 'EINVALID'
    throw err
  }
  return norm.replace(/\/+$/, '')
}

// ── 文件树 ────────────────────────────────────────────────────────

/** 目录要不要跳过。 */
function shouldSkipDir(name, opts) {
  if (name.startsWith('.')) return true // 所有点开头的目录
  if (SKIP_DIR_NAMES.has(name)) return true
  const dataDir = opts.dataDir || DEFAULT_DATA_DIR
  if (name === dataDir) return true
  if (opts.skipDirs.includes(name)) return true
  return false
}

/** 读文件头几 KB，见到 NUL 就当二进制。 */
async function hasNulByte(abs, size) {
  const len = Math.min(4096, size)
  if (len <= 0) return false
  const handle = await open(abs, 'r')
  try {
    const buf = Buffer.alloc(len)
    const { bytesRead } = await handle.read(buf, 0, len, 0)
    return buf.subarray(0, bytesRead).includes(0)
  } finally {
    await handle.close().catch(() => {})
  }
}

/** 单个文件：过规则后进候选表。 */
async function considerFile(ctx, abs, rel) {
  const opts = ctx.opts
  if (opts.include.length && !matchAny(opts.include, rel)) {
    ctx.skipped += 1
    return
  }
  if (opts.exclude.length && matchAny(opts.exclude, rel)) {
    ctx.skipped += 1
    return
  }
  let info
  try {
    info = await stat(abs)
  } catch {
    ctx.skipped += 1
    return
  }
  if (!info.isFile()) return
  if (info.size > opts.maxFileBytes) {
    ctx.skipped += 1
    ctx.reasons.big += 1
    return
  }
  if (isBinaryPath(rel)) {
    ctx.skipped += 1
    ctx.reasons.binary += 1
    return
  }
  try {
    if (await hasNulByte(abs, info.size)) {
      ctx.skipped += 1
      ctx.reasons.binary += 1
      return
    }
  } catch {
    ctx.skipped += 1
    return
  }
  ctx.candidates.push({
    abs,
    path: rel,
    bytes: info.size,
    lang: langOf(rel),
    depth: rel.split('/').length - 1,
  })
}

/** 递归走目录树。 */
async function walk(ctx, dirAbs, relDir) {
  let entries
  try {
    entries = await readdir(dirAbs, { withFileTypes: true })
  } catch {
    ctx.skipped += 1
    return
  }
  // 名字排序，保证同一次扫描顺序稳定
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const entry of entries) {
    const name = entry.name
    const rel = relDir ? `${relDir}/${name}` : name
    if (entry.isDirectory()) {
      if (shouldSkipDir(name, ctx.opts)) {
        ctx.reasons.dirs += 1
        continue
      }
      await walk(ctx, join(dirAbs, name), rel)
      continue
    }
    if (entry.isSymbolicLink()) continue // 不追链接，防环
    if (!entry.isFile()) continue
    await considerFile(ctx, join(dirAbs, name), rel)
  }
}

/** 截断排序：浅路径优先，同深度代码文件优先，再按路径字典序。 */
function compareCandidates(a, b) {
  if (a.depth !== b.depth) return a.depth - b.depth
  const ac = isCodeLang(a.lang) ? 0 : 1
  const bc = isCodeLang(b.lang) ? 0 : 1
  if (ac !== bc) return ac - bc
  if (a.path < b.path) return -1
  if (a.path > b.path) return 1
  return 0
}

// ── 对外：扫描 ────────────────────────────────────────────────────

/**
 * 走项目文件树，收「块」（文件级）。
 *
 * @param {string} projectPath 项目根，绝对或相对
 * @param {object} [opts]
 * @param {string} [opts.root=''] 只扫项目内某个子目录（相对项目根，返回路径仍相对项目根）
 * @param {number} [opts.limit=320] 最多收多少个文件
 * @param {number} [opts.maxFileBytes=524288] 超过就不收
 * @param {string[]} [opts.include=[]] 只收命中的路径（支持 ** * ?；不含 / 的模式按文件名匹配）
 * @param {string[]} [opts.exclude=[]] 命中的路径跳过
 * @param {string} [opts.dataDir='结构蓝图'] 额外跳过的数据目录名
 * @param {string[]} [opts.skipDirs=[]] 额外跳过的目录名
 * @returns {Promise<{files:Array<{path:string,bytes:number,lines:number,lang:string|null,sha:string}>,
 *   skipped:number, truncated:boolean, truncatedCount:number,
 *   counts:{files:number,bytes:number,total:number},
 *   skippedReasons:{dirs:number,big:number,binary:number}}>}
 *   counts.total＝截断前可收文件数；truncatedCount＝因上限没收回来的文件数；truncated 是它是否大于 0。
 */
export async function scanProject(projectPath, opts = {}) {
  if (typeof projectPath !== 'string' || !projectPath.trim()) {
    const err = new TypeError('projectPath 必须是非空字符串')
    err.code = 'EINVALID'
    throw err
  }
  const projectRoot = resolve(projectPath)
  const options = {
    root: normalizeRoot(opts.root),
    limit: intOpt(opts.limit, DEFAULT_LIMIT, 0),
    maxFileBytes: intOpt(opts.maxFileBytes, DEFAULT_MAX_FILE_BYTES, 1),
    include: compilePatterns(opts.include),
    exclude: compilePatterns(opts.exclude),
    dataDir: typeof opts.dataDir === 'string' && opts.dataDir.trim() ? opts.dataDir.trim() : DEFAULT_DATA_DIR,
    skipDirs: Array.isArray(opts.skipDirs) ? opts.skipDirs.filter((x) => typeof x === 'string') : [],
  }

  // 项目根必须存在且是目录
  let rootInfo
  try {
    rootInfo = await stat(projectRoot)
  } catch {
    const err = new Error(`项目路径不存在：${projectRoot}`)
    err.code = 'ENOENT'
    throw err
  }
  if (!rootInfo.isDirectory()) {
    const err = new Error(`项目路径不是目录：${projectRoot}`)
    err.code = 'ENOTDIR'
    throw err
  }

  const scanAbs = options.root ? resolve(projectRoot, options.root) : projectRoot
  let scanInfo
  try {
    scanInfo = await stat(scanAbs)
  } catch {
    const err = new Error(`扫描根不存在：${scanAbs}`)
    err.code = 'ENOENT'
    throw err
  }

  const ctx = {
    opts: options,
    candidates: [],
    skipped: 0,
    reasons: { dirs: 0, big: 0, binary: 0 },
  }

  if (scanInfo.isDirectory()) {
    await walk(ctx, scanAbs, options.root)
  } else {
    // root 指到单个文件：照单文件规则收
    await considerFile(ctx, scanAbs, toPosix(relative(projectRoot, scanAbs)))
  }

  ctx.candidates.sort(compareCandidates)
  const total = ctx.candidates.length

  // 按排名顺序读到上限为止；读到上限后不再读，省 I/O
  const files = []
  let bytes = 0
  for (const cand of ctx.candidates) {
    if (files.length >= options.limit) break
    try {
      const buf = await readFile(cand.abs)
      // 头部没嗅到、后面才出现 NUL 的，也当二进制
      if (buf.includes(0)) {
        ctx.skipped += 1
        ctx.reasons.binary += 1
        continue
      }
      const entry = {
        path: cand.path,
        bytes: buf.length,
        lines: countLines(buf),
        lang: cand.lang,
        sha: sha8(buf),
      }
      files.push(entry)
      bytes += entry.bytes
    } catch {
      ctx.skipped += 1
    }
  }

  // 被上限挡掉的文件数；truncated 用布尔，给宿主直接当标志位
  const truncatedCount = Math.max(0, total - files.length)
  return {
    files,
    skipped: ctx.skipped,
    truncated: truncatedCount > 0,
    truncatedCount,
    counts: { files: files.length, bytes, total },
    skippedReasons: { ...ctx.reasons },
  }
}

// ── 对外：对账 ────────────────────────────────────────────────────

/** 匹配键：path ＋ symbol（文件级 symbol 视为 null）。 */
function keyOf(path, symbol) {
  return `${path}\u0000${symbol ?? ''}`
}

/** 稳定排序：先 path 字典序，再 id。 */
function compareByPath(a, b) {
  const ap = a.path ?? ''
  const bp = b.path ?? ''
  if (ap !== bp) return ap < bp ? -1 : 1
  const ai = a.id ?? ''
  const bi = b.id ?? ''
  if (ai === bi) return 0
  return ai < bi ? -1 : 1
}

/**
 * 把扫描结果和既有块对账（纯函数，不改入参、不标 stale）。
 *
 * @param {Array} existingBlocks 板子上的 blocks（§3.1 形状）
 * @param {Array} scanFiles scanProject().files（文件级，symbol 视为 null）
 * @returns {{added:Array, changed:Array<{block:object,file:object}>,
 *   removed:Array<object>, same:Array<{block:object,file:object}>}}
 *   added＝扫描到但还没有对应块的文件对象；
 *   changed＝同键但 bytes 或 sha 变了；
 *   removed＝既有实块本次没见到的块对象（已 stale 的不重复报；符号块只要文件还在就不算失联）；
 *   same＝没变的配对。四个数组都按 path 字典序。
 */
export function diffScan(existingBlocks, scanFiles) {
  const blocks = (Array.isArray(existingBlocks) ? existingBlocks : []).filter(
    (b) => b && typeof b.path === 'string' && !b.planned,
  )
  // 扫描只到文件级：符号块不参与键匹配，但文件没了照样报失联
  const fileBlocks = blocks.filter((b) => !b.symbol)
  const blockByKey = new Map()
  for (const block of fileBlocks) blockByKey.set(keyOf(block.path, null), block)

  const fileByKey = new Map()
  for (const file of Array.isArray(scanFiles) ? scanFiles : []) {
    if (!file || typeof file.path !== 'string') continue
    fileByKey.set(keyOf(file.path, null), file)
  }

  const added = []
  const changed = []
  const same = []
  const seenKeys = new Set()
  for (const file of fileByKey.values()) {
    const key = keyOf(file.path, null)
    const block = blockByKey.get(key)
    if (!block) {
      added.push(file)
      continue
    }
    seenKeys.add(key)
    // 没变＝bytes 与 sha 都没变
    if (block.bytes !== file.bytes || block.sha !== file.sha) {
      changed.push({ block, file })
    } else {
      same.push({ block, file })
    }
  }

  const seenPaths = new Set()
  for (const file of fileByKey.values()) seenPaths.add(file.path)

  const removed = []
  for (const block of blocks) {
    if (seenKeys.has(keyOf(block.path, null))) continue
    if (block.stale === true) continue // 已经标过失联，不重复报
    if (block.symbol && seenPaths.has(block.path)) continue // 文件还在，符号级不归扫描管
    removed.push(block)
  }

  added.sort(compareByPath)
  removed.sort(compareByPath)
  changed.sort((a, b) => compareByPath(a.block, b.block))
  same.sort((a, b) => compareByPath(a.block, b.block))
  return { added, changed, removed, same }
}
