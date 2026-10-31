#requires -Version 7.0
[CmdletBinding()]
param(
    [ValidateRange(1, 65535)][int]$Port,
    [switch]$All
)

$ErrorActionPreference = 'Stop'
if ($Host.Name -eq 'ConsoleHost') {
    try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
}
$OutputEncoding = [System.Text.Encoding]::UTF8

$isWin = $IsWindows -or ($env:OS -like '*Windows*')
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtime = Join-Path $projectRoot '.runtime'

function Get-ListeningPorts {
    try {
        $listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
        return @($listeners | ForEach-Object { $_.Port })
    } catch {
        return @()
    }
}

function Get-Health([int]$ServerPort) {
    try { return Invoke-RestMethod -Uri "http://127.0.0.1:$ServerPort/api/v1/health" -TimeoutSec 1 -NoProxy }
    catch { return $null }
}

function Stop-InkloomPort([int]$TargetPort, [bool]$IsPortListening) {
    $receipt = Join-Path $runtime "server-$TargetPort.json"
    if (-not $IsPortListening) {
        if (Test-Path -LiteralPath $receipt) { Remove-Item -LiteralPath $receipt -Force -ErrorAction SilentlyContinue }
        return $false
    }

    $proc = $null
    $recordedPid = $null

    # 1. Read receipt if present
    if (Test-Path -LiteralPath $receipt) {
        try {
            $record = Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json
            if ($record.pid -and $record.pid -gt 0) { $recordedPid = [int]$record.pid }
        } catch { }
    }

    if ($recordedPid) {
        $candidateProc = Get-Process -Id $recordedPid -ErrorAction SilentlyContinue
        if ($candidateProc -and -not $candidateProc.HasExited) { $proc = $candidateProc }
    }

    # 2. Port connection lookup if not found via receipt
    if (-not $proc -and $isWin) {
        $conn = Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($conn -and $conn.OwningProcess -gt 0) {
            $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
        }
    } elseif (-not $proc -and -not $isWin) {
        try {
            $lsofPid = & lsof -ti ":$TargetPort" 2>$null | Select-Object -First 1
            if ($lsofPid) { $proc = Get-Process -Id [int]$lsofPid -ErrorAction SilentlyContinue }
        } catch { }
    }

    $health = Get-Health $TargetPort
    if (-not $proc) {
        if ($health -and $health.status -eq 'ok') {
            Write-Host "检测到端口 $TargetPort 有响应，但未能获取具体进程句柄。" -ForegroundColor Yellow
        }
        if (Test-Path -LiteralPath $receipt) { Remove-Item -LiteralPath $receipt -Force -ErrorAction SilentlyContinue }
        return $false
    }

    # Safety verification: ensure process is python/node/uvicorn or verified by health endpoint
    $procName = $proc.ProcessName.ToLowerInvariant()
    $isInkloomProcess = ($procName -match 'python|uvicorn|node') -or ($health -and $health.status -eq 'ok')
    if (-not $isInkloomProcess) {
        Write-Host "安全保护：端口 $TargetPort 上的进程 ($($proc.ProcessName)) 无法确认为 Inkloom 实例，已跳过终止。" -ForegroundColor Red
        return $false
    }

    Write-Host "正在停止 Inkloom 服务 (端口: $TargetPort, PID: $($proc.Id), 进程: $($proc.ProcessName))..." -ForegroundColor Cyan
    try {
        $proc.Kill($true)
        $proc.WaitForExit(3000)
    } catch {
        Write-Host "终止进程时遇到提示：$($_.Exception.Message)" -ForegroundColor Yellow
    }

    # Clean up receipt and release any stale launcher locks
    if (Test-Path -LiteralPath $receipt) { Remove-Item -LiteralPath $receipt -Force -ErrorAction SilentlyContinue }
    $lockFile = Join-Path $runtime 'launcher.lock'
    if (Test-Path -LiteralPath $lockFile) {
        try {
            $stream = [IO.File]::Open($lockFile, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
            $stream.Dispose()
            Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
        } catch { }
    }

    Write-Host "已成功停止端口 $TargetPort 的 Inkloom 服务。" -ForegroundColor Green
    return $true
}

# Determine ports to inspect
$targetPorts = @()
if ($PSBoundParameters.ContainsKey('Port')) {
    $targetPorts += $Port
} else {
    # Check runtime receipts first
    if (Test-Path -LiteralPath $runtime) {
        foreach ($item in (Get-ChildItem -LiteralPath $runtime -Filter 'server-*.json' -File)) {
            if ($item.BaseName -match '^server-(\d+)$') { $targetPorts += [int]$Matches[1] }
        }
    }
    # Check default port range
    $targetPorts += @(8765..8774)
}
$targetPorts = $targetPorts | Select-Object -Unique

$listeningPorts = Get-ListeningPorts
$stoppedCount = 0
foreach ($p in $targetPorts) {
    $isListening = ($p -in $listeningPorts)
    $hasReceipt = Test-Path -LiteralPath (Join-Path $runtime "server-$p.json")
    if ($isListening -or $hasReceipt) {
        $stopped = Stop-InkloomPort -TargetPort $p -IsPortListening $isListening
        if ($stopped) { $stoppedCount++ }
    }
}

if ($stoppedCount -eq 0) {
    Write-Host "未发现处于运行状态的 Inkloom 服务。" -ForegroundColor Yellow
} else {
    Write-Host "共关闭了 $stoppedCount 个 Inkloom 服务实例。" -ForegroundColor Green
}
