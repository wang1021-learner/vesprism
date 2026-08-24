'use strict'

const { spawnSync } = require('child_process')

function run(cmd, args) {
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (r.status) process.exit(r.status)
}

run('tsc', ['-b'])
run('vite', ['build'])
