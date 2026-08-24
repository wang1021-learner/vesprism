/**
 * Vite 8 / Rolldown 需要 Node >= 20.12（util.styleText）。
 * 全局可以继续用 Node 18：本脚本只把这次命令的 PATH 指到本机已装的 20+。
 */
'use strict'

const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const MIN = [20, 12]

function parseVer(s) {
  const m = String(s).match(/v?(\d+)\.(\d+)\.(\d+)/)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function cmp(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

function nvmRoots() {
  const home = os.homedir()
  const out = []
  const seen = new Set()
  for (const d of [
    process.env.NVM_HOME,
    process.env.NVM_DIR,
    path.join(home, 'AppData', 'Local', 'nvm'),
    path.join(home, 'AppData', 'Roaming', 'nvm'),
    path.join(home, '.nvm'),
  ]) {
    if (!d) continue
    const resolved = path.resolve(d)
    if (seen.has(resolved) || !fs.existsSync(resolved)) continue
    seen.add(resolved)
    out.push(resolved)
  }
  return out
}

function nodeBinIn(dir) {
  if (process.platform === 'win32') {
    const exe = path.join(dir, 'node.exe')
    if (fs.existsSync(exe)) return { bin: exe, bindir: dir }
  } else {
    const bin = path.join(dir, 'bin', 'node')
    if (fs.existsSync(bin)) return { bin, bindir: path.join(dir, 'bin') }
    const plain = path.join(dir, 'node')
    if (fs.existsSync(plain)) return { bin: plain, bindir: dir }
  }
  return null
}

function collect() {
  const found = []
  for (const root of nvmRoots()) {
    let ents
    try {
      ents = fs.readdirSync(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of ents) {
      if (!e.isDirectory()) continue
      const ver = parseVer(e.name)
      if (!ver || cmp(ver, MIN) < 0) continue
      const hit = nodeBinIn(path.join(root, e.name))
      if (hit) found.push({ ver, ...hit })
    }
  }
  return found
}

function pick(cands) {
  const v22 = cands.filter((c) => c.ver[0] === 22)
  const pool = v22.length ? v22 : cands
  pool.sort((a, b) => cmp(b.ver, a.ver))
  return pool[0] || null
}

function fail() {
  const cur = process.versions.node
  console.error(
    `Vite 8 需要 Node >= 20.12，当前是 v${cur}。\n` +
      '全局不必改：安装一份 22 即可（nvm install 22）。本脚本只会给这条命令用它。',
  )
  process.exit(1)
}

/** Windows 环境变量是 Path，写成 PATH 会另开一份，cargo 就丢了。 */
function pathKey(env) {
  return Object.keys(env).find((k) => k.toLowerCase() === 'path') || (process.platform === 'win32' ? 'Path' : 'PATH')
}

function readPath(env) {
  return env[pathKey(env)] || ''
}

function writePath(env, value) {
  const key = pathKey(env)
  for (const k of Object.keys(env)) {
    if (k.toLowerCase() === 'path') delete env[k]
  }
  env[key] = value
}

const argv = process.argv.slice(2)
if (!argv.length) {
  console.error('用法: node scripts/with-node.cjs <命令> [参数…]')
  process.exit(1)
}

const env = { ...process.env }
const pathBits = []
const current = parseVer(process.versions.node)
if (!current || cmp(current, MIN) < 0) {
  const chosen = pick(collect())
  if (!chosen) fail()
  pathBits.push(chosen.bindir)
  console.log(
    `[vesprism] Node v${process.versions.node} 跑不了 Vite 8，这条命令改用 v${chosen.ver.join('.')}（全局仍是 ${process.version}）`,
  )
}
const localBin = path.join(__dirname, '..', 'node_modules', '.bin')
if (fs.existsSync(localBin)) pathBits.push(localBin)
const cargoBin = path.join(os.homedir(), '.cargo', 'bin')
const currentPath = readPath(env)
if (fs.existsSync(cargoBin) && !currentPath.split(path.delimiter).includes(cargoBin)) {
  pathBits.push(cargoBin)
}
if (pathBits.length) {
  writePath(env, pathBits.join(path.delimiter) + path.delimiter + currentPath)
}

const child = spawn(argv[0], argv.slice(1), {
  env,
  cwd: process.cwd(),
  stdio: 'inherit',
  shell: true,
  windowsHide: false,
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (!child.killed) child.kill(sig)
  })
}

child.on('exit', (code, signal) => {
  if (signal) process.exit(1)
  process.exit(code ?? 1)
})
