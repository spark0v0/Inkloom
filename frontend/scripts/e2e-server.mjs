import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const data = resolve(root, '.tmp', 'e2e-' + randomUUID())
mkdirSync(data, { recursive: true })
const python = resolve(root, process.platform === 'win32' ? 'backend/.venv/Scripts/python.exe' : 'backend/.venv/bin/python')
const child = spawn(python, ['-X', 'utf8', '-m', 'app', '--port', '9876', '--data-dir', data], { cwd: resolve(root, 'backend'), stdio: 'inherit', windowsHide: true })
process.on('SIGTERM', () => child.kill())
process.on('SIGINT', () => child.kill())
child.on('exit', code => process.exit(code ?? 0))
