const { spawn } = require('node:child_process')
const { join } = require('node:path')
const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env

const cli = join(__dirname, '..', 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  env,
  stdio: 'inherit'
})

child.on('exit', (code) => {
  process.exit(code ?? 1)
})
