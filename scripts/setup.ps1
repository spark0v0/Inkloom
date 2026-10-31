#requires -Version 7.0
$ErrorActionPreference = 'Stop'

if ($Host.Name -eq 'ConsoleHost') {
    try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
}
$OutputEncoding = [System.Text.Encoding]::UTF8

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location $projectRoot
try {
    if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { throw '请先安装 uv 和 Python 3.13+。' }
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw '请先安装 Node.js 22.12+（推荐当前 LTS）。' }
    & uv sync --project backend --frozen --link-mode copy
    if ($LASTEXITCODE -ne 0) { throw '后端依赖安装失败。' }
    & npm --prefix frontend ci
    if ($LASTEXITCODE -ne 0) { throw '前端依赖安装失败。' }
    & npm --prefix frontend run generate:api
    if ($LASTEXITCODE -ne 0) { throw '接口类型生成失败。' }
    & npm --prefix frontend run build
    if ($LASTEXITCODE -ne 0) { throw '前端构建失败。' }
    Write-Host '准备完成。运行：pwsh -File .\scripts\start.ps1' -ForegroundColor Green
} finally { Pop-Location }
