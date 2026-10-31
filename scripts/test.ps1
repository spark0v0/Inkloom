#requires -Version 7.0
param([switch]$Browser)
$ErrorActionPreference = 'Stop'

if ($Host.Name -eq 'ConsoleHost') {
    try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
}
$OutputEncoding = [System.Text.Encoding]::UTF8

$isWin = $IsWindows -or ($env:OS -like '*Windows*')
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$temporaryParent = [IO.Path]::GetFullPath((Join-Path $projectRoot '.tmp'))
if (-not $temporaryParent.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw '测试目录不在项目内。' }
New-Item -ItemType Directory -Path $temporaryParent -Force | Out-Null
$testRoot = Join-Path $temporaryParent ('pytest-' + [Guid]::NewGuid().ToString('N'))
$python = if ($isWin) {
    Join-Path $projectRoot 'backend/.venv/Scripts/python.exe'
} else {
    Join-Path $projectRoot 'backend/.venv/bin/python'
}
$ruff = if ($isWin) {
    Join-Path $projectRoot 'backend/.venv/Scripts/ruff.exe'
} else {
    Join-Path $projectRoot 'backend/.venv/bin/ruff'
}
Push-Location $projectRoot
try {
    & $ruff check backend/app backend/tests
    if ($LASTEXITCODE -ne 0) { throw '后端静态检查失败。' }
    Push-Location (Join-Path $projectRoot 'backend')
    try { & $python -X utf8 -m pytest -q --tb=short --basetemp $testRoot }
    finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw '后端测试失败。' }
    & npm --prefix frontend run check:api
    if ($LASTEXITCODE -ne 0) { throw '接口声明需要重新生成。' }
    & npm --prefix frontend test
    if ($LASTEXITCODE -ne 0) { throw '前端契约测试失败。' }
    & npm --prefix frontend run build
    if ($LASTEXITCODE -ne 0) { throw '类型检查或构建失败。' }
    if ($Browser) {
        & npm --prefix frontend run test:e2e
        if ($LASTEXITCODE -ne 0) { throw '浏览器测试失败。' }
    }
} finally { Pop-Location }
