#requires -Version 7.0
param([int]$Port = 8765, [string]$DataDirectory, [switch]$Build)
$ErrorActionPreference = 'Stop'

if ($Host.Name -eq 'ConsoleHost') {
    try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
}
$OutputEncoding = [System.Text.Encoding]::UTF8

$isWin = $IsWindows -or ($env:OS -like '*Windows*')
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$python = if ($isWin) {
    Join-Path $projectRoot 'backend/.venv/Scripts/python.exe'
} else {
    Join-Path $projectRoot 'backend/.venv/bin/python'
}
if (-not (Test-Path -LiteralPath $python)) { throw '缺少后端环境，请先运行 scripts/setup.ps1。' }
if (-not $DataDirectory) { $DataDirectory = Join-Path $projectRoot 'data' }
$workspaceRoot = [IO.Path]::GetFullPath($DataDirectory)
Push-Location $projectRoot
try {
    if ($Build) {
        & npm --prefix frontend run build
        if ($LASTEXITCODE -ne 0) { throw '前端构建失败，未启动服务。' }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'frontend/dist/index.html'))) { throw '缺少网页构建，请先运行 scripts/setup.ps1 或使用 -Build。' }
    Write-Host "Inkloom：http://127.0.0.1:$Port" -ForegroundColor Green
    Write-Host '按 Ctrl+C 停止。作品保存在本机，服务仅监听回环地址。'
    Push-Location (Join-Path $projectRoot 'backend')
    try { & $python -X utf8 -m app --port $Port --data-dir $workspaceRoot }
    finally { Pop-Location }
} finally { Pop-Location }
