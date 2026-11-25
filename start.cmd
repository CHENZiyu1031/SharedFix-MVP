@echo off
setlocal
cd /d "%~dp0"
title SharedFix Classroom Demo
set "SF_NODE="
if exist "%~dp0runtime\node.exe" set "SF_NODE=%~dp0runtime\node.exe"
if not defined SF_NODE for /f "delims=" %%N in ('where node.exe 2^>nul') do if not defined SF_NODE set "SF_NODE=%%N"
if not defined SF_NODE for /d %%D in ("%ProgramFiles%\WindowsApps\OpenAI.CodexPrimaryRuntime.*") do if exist "%%D\dependencies\node\bin\node.exe" set "SF_NODE=%%D\dependencies\node\bin\node.exe"
if not defined SF_NODE (
  echo Node.js 20 or newer is needed to start the demo.
  pause
  exit /b 1
)
if not exist "%~dp0node_modules\ganache\package.json" (
  echo The demo dependencies are missing. See docs for the installation command.
  pause
  exit /b 1
)
"%SF_NODE%" "%~dp0server.cjs" --open
if errorlevel 1 pause
