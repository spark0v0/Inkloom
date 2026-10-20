import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import openapiTS, { astToString } from 'openapi-typescript'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const python = process.platform === 'win32'
  ? resolve(root, 'backend/.venv/Scripts/python.exe') : resolve(root, 'backend/.venv/bin/python')
const schema = JSON.parse(execFileSync(python, ['-m', 'app.export_schema'], {
  cwd: resolve(root, 'backend'), encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' },
}))
const ast = await openapiTS(schema)
const output = resolve(root, 'frontend/src/generated/api.d.ts')
mkdirSync(dirname(output), { recursive: true })
const source = astToString(ast)
if (process.argv.includes('--check')) {
  if (readFileSync(output, 'utf8') !== source) throw new Error('API contract changed. Run npm run generate:api.')
  console.log('API declarations match the backend OpenAPI contract')
} else {
  writeFileSync(output, source)
  console.log('Generated frontend/src/generated/api.d.ts from the backend OpenAPI contract')
}
