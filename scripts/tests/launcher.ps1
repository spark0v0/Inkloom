#requires -Version 7.0
# Uses real local processes and a fresh workspace; never opens the author's data/.
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$launch = Join-Path $projectRoot 'scripts/launch.ps1'
$pwsh = (Get-Process -Id $PID).Path
$python = Join-Path $projectRoot 'backend/.venv/Scripts/python.exe'
if (-not $IsWindows) { throw '此集成检查针对 Windows 入口，请在 Windows PowerShell 7 中运行。' }
$testRoot = Join-Path $projectRoot ('.tmp/launcher-' + [Guid]::NewGuid().ToString('N'))
$dataDirectory = Join-Path $testRoot '中文 工作区'
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$children = [Collections.Generic.List[Diagnostics.Process]]::new()
$receipts = [Collections.Generic.List[string]]::new()
$checks = 0

function Assert([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
    $script:checks++
    Write-Host "PASS $Message"
}

function Free-Port {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    try { $listener.Start(); return $listener.LocalEndpoint.Port } finally { $listener.Stop() }
}

function Health([int]$Port) {
    try { return Invoke-RestMethod "http://127.0.0.1:$Port/api/v1/health" -TimeoutSec 1 -NoProxy } catch { return $null }
}

function Invoke-Launcher([string[]]$Options, [int]$ExpectedExit = 0) {
    & $pwsh -NoLogo -NoProfile -File $launch @Options | ForEach-Object { Write-Host $_ }
    Assert ($LASTEXITCODE -eq $ExpectedExit) "启动器退出码为 $ExpectedExit"
}

function Start-Launcher([int]$Port, [switch]$Rebuild) {
    $suffix = [Guid]::NewGuid().ToString('N')
    $arguments = @('-NoLogo', '-NoProfile', '-File', ('"' + $launch + '"'), '-NoBrowser', '-Port', "$Port", '-DataDirectory', ('"' + $dataDirectory + '"'))
    if ($Rebuild) { $arguments += '-Rebuild' }
    $proc = Start-Process $pwsh -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $testRoot "$suffix.out.log") -RedirectStandardError (Join-Path $testRoot "$suffix.err.log")
    $children.Add($proc)
    return $proc
}

function Wait-Ready([int]$Port, [Diagnostics.Process]$Launcher, [int]$OldServerId = 0) {
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $receiptPath = Join-Path $projectRoot ".runtime/server-$Port.json"
    while ($watch.Elapsed.TotalSeconds -lt 120) {
        if ($Launcher.HasExited) { throw "启动器提前退出：$testRoot" }
        try {
            $record = Get-Content -LiteralPath $receiptPath -Raw -ErrorAction Stop | ConvertFrom-Json
            if ($record.pid -ne $OldServerId -and (Health $Port).status -eq 'ok') { return $record }
        } catch { }
        Start-Sleep -Milliseconds 200
    }
    throw "服务未就绪，日志：$testRoot"
}

try {
    $port = Free-Port
    $receiptPath = Join-Path $projectRoot ".runtime/server-$port.json"
    Assert (-not (Test-Path -LiteralPath $receiptPath)) '测试端口没有已有启动记录'
    $receipts.Add($receiptPath)
    $launcher = Start-Launcher $port
    $record = Wait-Ready $port $launcher
    Assert ($record.workspace_root -eq $dataDirectory -and $record.process_started_at) '中文及空格目录启动，保存进程身份'
    Assert ((Invoke-WebRequest "http://127.0.0.1:$port/" -NoProxy).StatusCode -eq 200) '网页可访问'

    Push-Location $projectRoot
    try {
        & $env:ComSpec /d /c ('Inkloom.cmd -NoBrowser -Port ' + $port + ' -DataDirectory "' + $dataDirectory + '"')
        Assert ($LASTEXITCODE -eq 0) 'CMD 统一入口正常转发参数'
    } finally { Pop-Location }
    $same = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
    Assert ($same.pid -eq $record.pid -and -not $launcher.HasExited) '重复打开复用原服务'
    Invoke-Launcher @('-Stop', '-Port', "$port", '-DataDirectory', (Join-Path $testRoot '其他工作区')) 1
    Assert ((Health $port).status -eq 'ok') '拒绝停止其他工作区'

    $otherPort = Free-Port
    $foreign = Start-Process $python -ArgumentList @('-m', 'http.server', "$otherPort", '--bind', '127.0.0.1', '--directory', ('"' + $testRoot + '"')) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $testRoot 'foreign.out.log') -RedirectStandardError (Join-Path $testRoot 'foreign.err.log')
    $children.Add($foreign)
    Start-Sleep -Milliseconds 500
    Assert (-not $foreign.HasExited) '无关 Python 服务已启动'
    $foreignReceipt = Join-Path $projectRoot ".runtime/server-$otherPort.json"
    Assert (-not (Test-Path -LiteralPath $foreignReceipt)) '无关端口没有已有启动记录'
    $receipts.Add($foreignReceipt)
    '{broken' | Set-Content -LiteralPath $foreignReceipt
    Invoke-Launcher @('-Stop', '-Port', "$otherPort", '-DataDirectory', $dataDirectory) 1
    Assert (-not $foreign.HasExited) '损坏记录不能终止无关服务'
    @{ port = $otherPort; pid = $foreign.Id; workspace_root = $dataDirectory; process_started_at = '2000-01-01T00:00:00.0000000Z' } | ConvertTo-Json | Set-Content -LiteralPath $foreignReceipt
    Invoke-Launcher @('-Stop', '-Port', "$otherPort", '-DataDirectory', $dataDirectory) 1
    Assert (-not $foreign.HasExited) '过期进程身份不能终止无关 Python 服务'
    Remove-Item -LiteralPath $foreignReceipt

    $restarted = Start-Launcher $port -Rebuild
    $newRecord = Wait-Ready $port $restarted $record.pid
    Assert ($launcher.WaitForExit(5000) -and $launcher.ExitCode -eq 0) '重建停止旧服务，原窗口正常退出'
    Assert ($newRecord.pid -ne $record.pid -and (Health $port).status -eq 'ok') '重建后新服务就绪'
    Start-Sleep -Milliseconds 300
    Assert ((Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json).pid -eq $newRecord.pid) '旧窗口清理不删除新服务记录'

    Invoke-Launcher @('-Stop', '-DataDirectory', ($dataDirectory + [IO.Path]::DirectorySeparatorChar))
    Assert ($restarted.WaitForExit(5000) -and $restarted.ExitCode -eq 0) '统一停止自动找到非默认端口并正常退出'
    Assert (-not (Health $port) -and -not (Test-Path -LiteralPath $receiptPath)) '停止后端口和启动记录已释放'
    Invoke-Launcher @('-Stop', '-Port', "$port", '-DataDirectory', $dataDirectory)
    Invoke-Launcher @('-Stop', '-DataDirectory', $dataDirectory)
    Assert (-not $foreign.HasExited) '重复停止不影响无关服务'
    Write-Host "共 $checks 项检查通过；临时日志：$testRoot"
} finally {
    # Only exact process handles and exact receipt paths created by this test.
    foreach ($child in $children) {
        if (-not $child.HasExited) { $child.Kill($true); $null = $child.WaitForExit(5000) }
    }
    foreach ($receipt in $receipts) {
        if (Test-Path -LiteralPath $receipt) { Remove-Item -LiteralPath $receipt }
    }
}
