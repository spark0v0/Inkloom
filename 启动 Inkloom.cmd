@echo off
chcp 65001 >nul
setlocal EnableExtensions DisableDelayedExpansion
title Inkloom

set "INKLOOM_PWSH="
for %%I in (pwsh.exe) do set "INKLOOM_PWSH=%%~$PATH:I"
if not defined INKLOOM_PWSH if exist "%ProgramFiles%\PowerShell\7\pwsh.exe" set "INKLOOM_PWSH=%ProgramFiles%\PowerShell\7\pwsh.exe"
if not defined INKLOOM_PWSH if exist "%ProgramW6432%\PowerShell\7\pwsh.exe" set "INKLOOM_PWSH=%ProgramW6432%\PowerShell\7\pwsh.exe"
if not defined INKLOOM_PWSH if exist "%LOCALAPPDATA%\Programs\PowerShell\7\pwsh.exe" set "INKLOOM_PWSH=%LOCALAPPDATA%\Programs\PowerShell\7\pwsh.exe"
if not defined INKLOOM_PWSH if exist "%LOCALAPPDATA%\Microsoft\PowerShell\7\pwsh.exe" set "INKLOOM_PWSH=%LOCALAPPDATA%\Microsoft\PowerShell\7\pwsh.exe"

if not defined INKLOOM_PWSH (
    echo [提示] 启动 Inkloom 需要 PowerShell 7+。
    echo.
    echo 推荐安装方式（二选一）：
    echo   1. 在命令行中运行：winget install Microsoft.PowerShell
    echo   2. 访问 GitHub 下载：https://github.com/PowerShell/PowerShell/releases
    echo.
    echo 安装完成后，请重新双击运行本脚本。
    pause
    exit /b 1
)

"%INKLOOM_PWSH%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch.ps1" %*
set "INKLOOM_EXIT=%ERRORLEVEL%"
if not "%INKLOOM_EXIT%"=="0" (
    echo.
    echo Inkloom 启动已退出（退出码 %INKLOOM_EXIT%）。详情请查看上方提示或诊断日志。
    pause
)
exit /b %INKLOOM_EXIT%
