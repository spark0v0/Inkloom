@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Inkloom
set "INKLOOM_PWSH="
for %%I in (pwsh.exe) do set "INKLOOM_PWSH=%%~$PATH:I"
if not defined INKLOOM_PWSH if exist "%ProgramFiles%\PowerShell\7\pwsh.exe" set "INKLOOM_PWSH=%ProgramFiles%\PowerShell\7\pwsh.exe"
if not defined INKLOOM_PWSH if exist "%ProgramW6432%\PowerShell\7\pwsh.exe" set "INKLOOM_PWSH=%ProgramW6432%\PowerShell\7\pwsh.exe"
if not defined INKLOOM_PWSH (
    echo PowerShell 7 is required. Install it, then run this launcher again.
    pause
    exit /b 1
)
"%INKLOOM_PWSH%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch.ps1" %*
set "INKLOOM_EXIT=%ERRORLEVEL%"
if not "%INKLOOM_EXIT%"=="0" (
    echo.
    echo Inkloom stopped with exit code %INKLOOM_EXIT%. See the messages above.
    pause
)
exit /b %INKLOOM_EXIT%
