#requires -Version 7.0
[CmdletBinding()]
param(
    [ValidateRange(1, 65535)][int]$Port = 8765,
    [string]$DataDirectory,
    [switch]$NoBrowser,
    [switch]$Rebuild,
    [switch]$Stop,
    [switch]$Menu
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

if ($Host.Name -eq 'ConsoleHost') {
    try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
}
$OutputEncoding = [System.Text.Encoding]::UTF8

$isWin = $IsWindows -or ($env:OS -like '*Windows*')
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $DataDirectory) { $DataDirectory = Join-Path $projectRoot 'data' }
if (-not [IO.Path]::IsPathRooted($DataDirectory)) { $DataDirectory = Join-Path $projectRoot $DataDirectory }
$workspaceRoot = [IO.Path]::TrimEndingDirectorySeparator([IO.Path]::GetFullPath($DataDirectory))
$runtime = Join-Path $projectRoot '.runtime'
$python = if ($isWin) {
    Join-Path $projectRoot 'backend/.venv/Scripts/python.exe'
} else {
    Join-Path $projectRoot 'backend/.venv/bin/python'
}
$ports = if ($PSBoundParameters.ContainsKey('Port')) { @($Port) } else { @(8765..8774) }
$explicitPort = $PSBoundParameters.ContainsKey('Port')
$interactive = [Environment]::UserInteractive -and -not [Console]::IsInputRedirected

function Get-WorkspaceId {
    $active = $workspaceRoot
    $pointer = Join-Path $workspaceRoot 'active-workspace.json'
    if (Test-Path -LiteralPath $pointer) {
        $candidate = [IO.Path]::GetFullPath((Get-Content -LiteralPath $pointer -Raw | ConvertFrom-Json).path)
        $restorePrefix = (Join-Path $workspaceRoot 'restored') + [IO.Path]::DirectorySeparatorChar
        if ($candidate.StartsWith($restorePrefix, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $candidate -PathType Container)) { $active = $candidate }
    }
    $identity = Join-Path $active 'workspace-id.json'
    if (Test-Path -LiteralPath $identity) { return (Get-Content -LiteralPath $identity -Raw | ConvertFrom-Json).id }
    return $null
}

function Get-Health([int]$ServerPort) {
    try { return Invoke-RestMethod -Uri "http://127.0.0.1:$ServerPort/api/v1/health" -TimeoutSec 1 -NoProxy }
    catch { return $null }
}

function Read-Receipt([string]$Path) {
    if (Test-Path -LiteralPath $Path) {
        try { return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json } catch { }
    }
    return $null
}

function Stop-InkloomService([int]$TargetPort) {
    $receipt = Join-Path $runtime "server-$TargetPort.json"
    $record = Read-Receipt $receipt
    $health = Get-Health $TargetPort
    $expected = Get-WorkspaceId
    if (-not (Test-Path -LiteralPath $receipt) -and -not $health) {
        $listeners = [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
        if (-not ($listeners | Where-Object { $_.Port -eq $TargetPort })) {
            Write-Host "端口 $TargetPort 的 Inkloom 已停止。" -ForegroundColor Gray
            return
        }
    }
    if (-not $record -or $record.port -ne $TargetPort -or $record.pid -isnot [long] -and $record.pid -isnot [int] -or $record.pid -le 0) {
        throw "端口 $TargetPort 缺少有效的启动记录，无法安全停止。请在原启动窗口按 Ctrl+C。"
    }
    $proc = Get-Process -Id $record.pid -ErrorAction SilentlyContinue
    if (-not $proc) {
        if ($health) { throw "端口 $TargetPort 的启动记录已过期，未停止该端口的其他服务。" }
        Remove-Item -LiteralPath $receipt -Force
        Write-Host "端口 $TargetPort 的 Inkloom 已停止。" -ForegroundColor Gray
        return
    }
    # PID alone may have been reused. New receipts bind the executable, exact
    # process start time and workspace root; old receipts also need a live match.
    # A Unix virtualenv's python may be a symlink; retain the OS-reported path.
    $launchedExecutable = if ($record.executable_path) { $record.executable_path } else { $python }
    $sameExecutable = [string]::Equals($proc.Path, $launchedExecutable, $(if ($isWin) { [StringComparison]::OrdinalIgnoreCase } else { [StringComparison]::Ordinal }))
    $sameWorkspace = $record.workspace_root -and [string]::Equals($record.workspace_root, $workspaceRoot, $(if ($isWin) { [StringComparison]::OrdinalIgnoreCase } else { [StringComparison]::Ordinal }))
    $sameStart = $record.process_started_at -and $proc.StartTime.ToUniversalTime().Ticks -eq ([DateTimeOffset]$record.process_started_at).UtcDateTime.Ticks
    $liveMatch = $expected -and $health.status -eq 'ok' -and $health.workspace_id -eq $expected
    $verified = $sameExecutable -and $sameWorkspace -and $sameStart
    if (-not $record.process_started_at -and -not $record.workspace_root -and $isWin -and $liveMatch -and $sameExecutable) {
        $owner = Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $proc.Id }
        $verified = [bool]$owner
    }
    if (-not $verified) { throw "端口 $TargetPort 的进程与本工作区启动记录不符，已拒绝停止。" }
    if ($health -and -not $liveMatch) { throw "端口 $TargetPort 当前属于其他工作区，已拒绝停止。" }
    Write-Host "正在停止 Inkloom（端口 $TargetPort）…" -ForegroundColor Cyan
    $record | Add-Member -NotePropertyName stopping -NotePropertyValue $true -Force
    $record | ConvertTo-Json | Set-Content -LiteralPath $receipt -Encoding utf8
    $proc.Kill($true)
    if (-not $proc.WaitForExit(5000)) { throw "服务尚未退出，请稍后重新检查。" }
    $current = Read-Receipt $receipt
    if ($current.pid -eq $record.pid -and $current.started_at -eq $record.started_at) {
        Remove-Item -LiteralPath $receipt -Force
    }
    Write-Host 'Inkloom 已停止。' -ForegroundColor Green
}

function Stop-RecordedServices {
    $found = $false
    $expected = Get-WorkspaceId
    foreach ($file in (Get-ChildItem -LiteralPath $runtime -Filter 'server-*.json' -File -ErrorAction SilentlyContinue)) {
        $record = Read-Receipt $file.FullName
        if ($record.port -ge 1 -and $record.port -le 65535 -and ($record.workspace_root -eq $workspaceRoot -or (-not $record.workspace_root -and $expected -and $record.workspace_id -eq $expected))) {
            Stop-InkloomService ([int]$record.port)
            $found = $true
        }
    }
    if (-not $found) { Write-Host '未发现本工作区的启动记录；若使用开发模式，请在原窗口按 Ctrl+C。' -ForegroundColor Yellow }
}

function Find-InkloomService {
    $expected = Get-WorkspaceId
    $freePort = $null
    # Reuse this workspace even when a previous launch selected another port.
    $recordedPorts = @()
    if (Test-Path -LiteralPath $runtime) {
        foreach ($receipt in (Get-ChildItem -LiteralPath $runtime -Filter 'server-*.json' -File)) {
            try {
                $record = Get-Content -LiteralPath $receipt.FullName -Raw | ConvertFrom-Json
                if ($record.port -is [long] -or $record.port -is [int]) {
                    if ($record.port -ge 1 -and $record.port -le 65535) { $recordedPorts += [int]$record.port }
                }
            } catch { } # Stale/corrupt receipts are not proof that a service is running.
        }
    }
    $candidatePorts = @($ports) + @(8765..8774) + $recordedPorts | Select-Object -Unique
    foreach ($candidatePort in $candidatePorts) {
        $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $candidatePort)
        try {
            $listener.Start()
            if ($null -eq $freePort -and $candidatePort -in $ports) { $freePort = $candidatePort }
        } catch [Net.Sockets.SocketException] {
            $health = Get-Health $candidatePort
            if ($expected -and $health.status -eq 'ok' -and $health.workspace_id -eq $expected) {
                return @{ Port = $candidatePort; Existing = $true }
            }
        } finally { $listener.Stop() }
    }
    if ($null -eq $freePort) { throw "端口 $($ports -join '、') 已被其他服务占用。请用 -Port 指定空闲端口；启动器不会关闭其他程序。" }
    return @{ Port = $freePort; Existing = $false }
}

function Open-Inkloom([string]$Url) {
    if ($NoBrowser) { return }
    try {
        if ($isWin) {
            Start-Process $Url
        } elseif ($IsMacOS) {
            & open $Url
        } else {
            & xdg-open $Url
        }
    }
    catch { Write-Host "无法自动打开浏览器，请手动访问：$Url" -ForegroundColor Yellow }
}

function Get-Fingerprint([IO.FileInfo[]]$Files) {
    $lines = foreach ($file in ($Files | Sort-Object FullName -Unique)) {
        [IO.Path]::GetRelativePath($projectRoot, $file.FullName) + ':' + (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
    }
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { return [Convert]::ToBase64String($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes(($lines -join "`n")))) }
    finally { $hasher.Dispose() }
}

function Invoke-Checked([string]$Command, [string[]]$Arguments, [string]$Failure) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Failure（退出码 $LASTEXITCODE）" }
}

function Require-Command([string]$Name, [string]$Hint) {
    $candidates = if ($isWin) {
        @($Name, "$Name.exe", "$Name.cmd", "$Name.bat", "$Name.ps1") | Select-Object -Unique
    } else {
        @($Name)
    }
    foreach ($candidate in $candidates) {
        $command = Get-Command $candidate -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($command -and $command.Source) { return $command.Source }
    }
    foreach ($candidate in $candidates) {
        $command = Get-Command $candidate -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($command -and $command.Source) { return $command.Source }
    }
    throw $Hint
}

$lock = $null
$server = $null
$serverPort = $null
$exitCode = 0
Push-Location $projectRoot
try {
    if ($Menu -and $interactive -and -not ($NoBrowser -or $Stop -or $Rebuild)) {
        Write-Host "`nInkloom" -ForegroundColor Cyan
        Write-Host '  [Enter] 启动 / 打开工作台'
        Write-Host '  [S]     停止服务'
        Write-Host '  [R]     重新构建并启动'
        Write-Host '  [Q]     退出此窗口'
        Write-Host '停止前请确认正文已保存；正在进行的生成会被中断。' -ForegroundColor Yellow
        do { $choice = (Read-Host '请选择（默认 Enter）').Trim().ToUpperInvariant() } while ($choice -notin @('', 'S', 'R', 'Q'))
        if ($choice -eq 'Q') { return }
        $Stop = $choice -eq 'S'
        $Rebuild = $choice -eq 'R'
    }

    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    try { $lock = [IO.File]::Open((Join-Path $runtime 'launcher.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
    catch [IO.IOException] { throw '另一个窗口正在启动或停止 Inkloom，请等待该窗口完成。' }
    if ($Stop) {
        if ($explicitPort) { Stop-InkloomService $Port } else { Stop-RecordedServices }
        return
    }

    $service = Find-InkloomService
    if ($service.Existing) {
        $url = "http://127.0.0.1:$($service.Port)"
        Write-Host "Inkloom 当前已在运行：$url" -ForegroundColor Green
        if ($Rebuild) {
            Write-Host '检测到 -Rebuild 参数，正在停止旧服务以便重新构建...' -ForegroundColor Cyan
            Stop-InkloomService $service.Port
        } else {
            Open-Inkloom $url
            return
        }
    }

    $statePath = Join-Path $runtime 'launcher-state.json'
    $state = @{}
    if (Test-Path -LiteralPath $statePath) {
        try {
            $saved = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json -AsHashtable
            if ($saved -is [System.Collections.IDictionary]) { $state = $saved }
        } catch { Write-Host '启动缓存无法读取，将重新检查依赖。' -ForegroundColor Yellow }
    }
    $backendHash = Get-Fingerprint (Get-Item -LiteralPath 'backend/pyproject.toml', 'backend/uv.lock')
    $frontendHash = Get-Fingerprint (Get-Item -LiteralPath 'frontend/package.json', 'frontend/package-lock.json')
    $sourceFiles = @(Get-ChildItem -LiteralPath 'frontend/src', 'frontend/public' -File -Recurse -ErrorAction SilentlyContinue)
    $sourceFiles += @(Get-ChildItem -LiteralPath 'frontend' -File | Where-Object { $_.Extension -in '.ts', '.js', '.mjs', '.mts', '.json', '.html', '.css' })
    $buildHash = Get-Fingerprint $sourceFiles
    $needBackend = -not (Test-Path -LiteralPath $python) -or $state.backend -ne $backendHash
    $needFrontend = -not (Test-Path -LiteralPath 'frontend/node_modules/.package-lock.json') -or $state.frontend -ne $frontendHash
    $needBuild = $Rebuild -or $needFrontend -or -not (Test-Path -LiteralPath 'frontend/dist/index.html') -or $state.build -ne $buildHash

    # Check prerequisites before starting either installation.
    if ($needBackend) { $uv = Require-Command 'uv' '缺少 uv。请安装 uv 并加入 PATH，然后重新双击启动入口。' }
    if ($needFrontend -or $needBuild) {
        $node = Require-Command 'node' '缺少 Node.js。请安装 Node.js 22.12+ 并重新打开启动器。'
        $npm = Require-Command 'npm' '缺少 npm，请修复 Node.js 安装后重新打开启动器。'
        $nodeVersionRaw = & $node --version
        $nodeVersionClean = (($nodeVersionRaw -split "`r?`n" | Where-Object { $_ -match '^\s*v?\d+\.' } | Select-Object -First 1) -replace '^\s*v', '').Trim()
        if ($LASTEXITCODE -ne 0 -or -not $nodeVersionClean -or [version]$nodeVersionClean -lt [version]'22.12.0') {
            throw "需要 Node.js 22.12+（检测到：$($nodeVersionRaw.Trim())），请升级后重新启动。"
        }
    }
    if ($needBackend) {
        Write-Host '正在准备 Python 与后端依赖，首次运行可能需要下载…' -ForegroundColor Cyan
        Invoke-Checked $uv @('sync', '--project', 'backend', '--frozen', '--link-mode', 'copy') '后端依赖安装失败，请检查上方错误和网络后重试'
        $state.backend = $backendHash
        $state | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
    }
    if ($needFrontend) {
        Write-Host '正在安装前端依赖…' -ForegroundColor Cyan
        Invoke-Checked $npm @('--prefix', 'frontend', 'ci') '前端依赖安装失败，请检查上方错误和网络后重试'
        $state.frontend = $frontendHash
        $state | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
    }
    if ($needBuild) {
        Write-Host '正在构建网页…' -ForegroundColor Cyan
        Invoke-Checked $npm @('--prefix', 'frontend', 'run', 'build') '网页构建失败，尚未启动服务'
        $state.build = $buildHash
        $state | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
    }

    $service = Find-InkloomService
    if ($service.Existing) {
        $url = "http://127.0.0.1:$($service.Port)"
        Write-Host "Inkloom 已在运行：$url" -ForegroundColor Green
        Open-Inkloom $url
        return
    }
    $serverPort = $service.Port
    $url = "http://127.0.0.1:$serverPort"
    $logPrefix = Join-Path $runtime ("launch-$serverPort-" + [Guid]::NewGuid().ToString('N'))
    $outLog = $logPrefix + '.out.log'
    $errLog = $logPrefix + '.err.log'
    Write-Host "正在启动 Inkloom：$url" -ForegroundColor Cyan
    $dataArgument = '"' + ($workspaceRoot -replace '(\\+)$', '$1$1') + '"'
    $startOptions = @{
        FilePath = $python
        ArgumentList = @('-X', 'utf8', '-m', 'app', '--port', "$serverPort", '--data-dir', $dataArgument)
        WorkingDirectory = Join-Path $projectRoot 'backend'
        PassThru = $true
        RedirectStandardOutput = $outLog
        RedirectStandardError = $errLog
    }
    if ($isWin) { $startOptions.WindowStyle = 'Hidden' }
    $server = Start-Process @startOptions
    $ready = $false
    $watch = [Diagnostics.Stopwatch]::StartNew()
    while ($watch.Elapsed.TotalSeconds -lt 30) {
        if ($server.HasExited) { break }
        $health = Get-Health $serverPort
        $identity = Get-WorkspaceId
        if ($identity -and $health.status -eq 'ok' -and $health.workspace_id -eq $identity) { $ready = $true; break }
        Start-Sleep -Milliseconds 200
    }
    if (-not $ready) {
        if (Test-Path -LiteralPath $errLog) { Get-Content -LiteralPath $errLog -Tail 25 | Write-Host }
        throw "服务未能就绪。诊断日志：$errLog"
    }
    @{
        port = $serverPort
        pid = $server.Id
        workspace_id = $identity
        workspace_root = $workspaceRoot
        executable_path = $server.Path
        process_started_at = $server.StartTime.ToUniversalTime().ToString('o')
        started_at = (Get-Date).ToString("o")
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtime "server-$serverPort.json") -Encoding utf8
    $lock.Dispose(); $lock = $null
    Write-Host "Inkloom 已启动：$url" -ForegroundColor Green
    Write-Host '保留此窗口；按 Q 或 Ctrl+C 停止本次服务，按 Enter 重新打开网页。' -ForegroundColor Yellow
    Write-Host '也可再次打开 Inkloom.cmd，选择 S 停止。' -ForegroundColor Gray
    Write-Host "运行日志：$errLog"
    Open-Inkloom $url
    while (-not $server.WaitForExit(200)) {
        if ($interactive -and [Console]::KeyAvailable) {
            $key = [Console]::ReadKey($true)
            if ($key.Key -eq [ConsoleKey]::Q) { break }
            if ($key.Key -eq [ConsoleKey]::Enter) { Open-Inkloom $url }
        }
    }
    if (-not $server.HasExited) { return }
    Start-Sleep -Milliseconds 100
    $receiptPath = Join-Path $runtime "server-$serverPort.json"
    $currentReceipt = Read-Receipt $receiptPath
    $wasStoppedExternally = -not $currentReceipt -or $currentReceipt.stopping -or $currentReceipt.pid -ne $server.Id
    if ($server.ExitCode -ne 0 -and -not $wasStoppedExternally) {
        if (Test-Path -LiteralPath $errLog) { Get-Content -LiteralPath $errLog -Tail 25 | Write-Host }
        throw "服务异常退出（$($server.ExitCode)）。诊断日志：$errLog"
    } else {
        Write-Host 'Inkloom 服务已退出。' -ForegroundColor Gray
    }
} catch {
    Write-Host "操作未完成：$($_.Exception.Message)" -ForegroundColor Red
    $exitCode = 1
} finally {
    # Only this invocation's process tree is owned here. Reused services are untouched.
    if ($null -ne $server -and -not $server.HasExited) { $server.Kill($true); $server.WaitForExit() }
    if ($null -ne $serverPort) {
        $receipt = Join-Path $runtime "server-$serverPort.json"
        try {
            $current = Read-Receipt $receipt
            if ($current.pid -eq $server.Id -and $current.process_started_at -and ([DateTimeOffset]$current.process_started_at).UtcDateTime.Ticks -eq $server.StartTime.ToUniversalTime().Ticks) { [IO.File]::Delete($receipt) }
        } catch { }
    }
    if ($null -ne $lock) { $lock.Dispose() }
    Pop-Location
}
exit $exitCode
