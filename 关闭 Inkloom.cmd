@echo off
chcp 65001 >nul
setlocal EnableExtensions DisableDelayedExpansion
title 关闭 Inkloom

set "INKLOOM_PWSH="
for %%I in (pwsh.exe) do set "INKLOOM_PWSH=%%~$PATH:I"
if not defined INKLOOM_PWSH if exist "%ProgramFiles%\PowerShell\7\pwsh.exe" set "INKLOOM_PWSH=%ProgramFiles%\PowerShell\7\pwsh.exe"
if not defined INKLOOM_PWSH if exist "%ProgramW6432%\PowerShell\7\pwsh.exe" set "INKLOOM_PWSH=%ProgramW6432%\PowerShell\7\pwsh.exe"
if not defined INKLOOM_PWSH if exist "%LOCALAPPDATA%\Programs\PowerShell\7\pwsh.exe" set "INKLOOM_PWSH=%LOCALAPPDATA%\Programs\PowerShell\7\pwsh.exe"
if not defined INKLOOM_PWSH if exist "%LOCALAPPDATA%\Microsoft\PowerShell\7\pwsh.exe" set "INKLOOM_PWSH=%LOCALAPPDATA%\Microsoft\PowerShell\7\pwsh.exe"

if not defined INKLOOM_PWSH (
    echo [提示] 关闭 Inkloom 需要 PowerShell 7+。
    pause
    exit /b 1
)

"%INKLOOM_PWSH%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop.ps1" %*
echo.
pause
