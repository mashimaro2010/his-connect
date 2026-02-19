@echo off
setlocal enabledelayedexpansion

:: --- 1. การตั้งค่าเวอร์ชัน ---
set NEW_VERSION=3.9.8
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set datetime=%%I
set TODAY=%datetime:~0,4%.%datetime:~4,2%.%datetime:~6,2%
set NEW_SUBVERSION=%TODAY%-1

echo ===========================================
echo [1/3] Updating package.json to v%NEW_VERSION%
echo ===========================================

powershell -Command ^
    "$json = Get-Content 'package.json' | ConvertFrom-Json;" ^
    "$json.version = '%NEW_VERSION%';" ^
    "$json.subVersion = '%NEW_SUBVERSION%';" ^
    "$json | ConvertTo-Json -Depth 100 | Set-Content 'package.json' -Encoding UTF8"

if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to update package.json
    pause
    exit /b %ERRORLEVEL%
)

:: --- 2. ติดตั้ง Dependencies ---
echo.
echo ===========================================
echo [2/3] Running: npm install
echo ===========================================
call npm install

if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] npm install failed
    pause
    exit /b %ERRORLEVEL%
)

:: --- 3. Compile TypeScript ---
echo.
echo ===========================================
echo [3/3] Running: npx tsc (Building...)
echo ===========================================
call npx tsc

if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] TypeScript compilation failed
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ===========================================
echo [SUCCESS] All tasks completed successfully!
echo Version: %NEW_VERSION%
echo SubVersion: %NEW_SUBVERSION%
echo ===========================================
pause