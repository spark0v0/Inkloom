#requires -Version 7.0
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$python = Join-Path $projectRoot 'backend/.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $python)) { throw '请先运行 scripts/setup.ps1。' }
foreach ($port in @(8765, 5173)) {
    $client = [Net.Sockets.TcpClient]::new()
    try { $client.Connect('127.0.0.1', $port); throw "端口 $port 已被占用，请先结束已有服务。" }
    catch [Net.Sockets.SocketException] { }
    finally { $client.Dispose() }
}
$runtime = Join-Path $projectRoot '.runtime'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
$process = Start-Process -FilePath $python -ArgumentList @('-X','utf8','-m','app','--port','8765') -WorkingDirectory (Join-Path $projectRoot 'backend') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtime 'backend.out.log') -RedirectStandardError (Join-Path $runtime 'backend.err.log')
try {
    $ready = $false
    for ($i = 0; $i -lt 50; $i++) {
        if ($process.HasExited) { throw '后端启动失败，请查看 .runtime/backend.err.log。' }
        try { $response = Invoke-RestMethod 'http://127.0.0.1:8765/api/v1/health' -TimeoutSec 1; $ready = $response.status -eq 'ok'; if ($ready) { break } } catch { }
        Start-Sleep -Milliseconds 200
    }
    if (-not $ready) { throw '后端未能在预期时间内启动。' }
    Write-Host '开发网页：http://127.0.0.1:5173；按 Ctrl+C 关闭本次启动的服务。' -ForegroundColor Green
    Push-Location (Join-Path $projectRoot 'frontend')
    try { & npm run dev } finally { Pop-Location }
} finally {
    if (-not $process.HasExited) { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue }
}
