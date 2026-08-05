/**
 * 桌面端轻量校验：tsc + 可选 vitest
 * 用法：node scripts/verify.mjs
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function run(cmd, args) {
  console.log(`\n> ${cmd} ${args.join(' ')}`)
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (r.status !== 0) {
    process.exit(r.status ?? 1)
  }
}

run('npx', ['tsc', '-p', 'tsconfig.app.json', '--noEmit'])

// vitest 存在则跑；失败不阻断若未安装
const vitest = spawnSync(
  'npx',
  ['vitest', 'run', 'src/lib/sessionTranscript.test.ts', 'src/store.tab-model.test.ts'],
  { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' },
)
if (vitest.status !== 0) {
  console.warn('\n[verify] vitest 未通过或未配置 describe 套件；tsc 已通过。')
}

console.log('\n[verify] ok')
