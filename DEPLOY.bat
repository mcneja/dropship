@echo off
setlocal ENABLEEXTENSIONS ENABLEDELAYEDEXPANSION

:: Usage:
::   DEPLOY.bat "commit message" [pages-subdir]
:: Examples:
::   DEPLOY.bat "deploy" dropship
::   DEPLOY.bat "deploy" /

:: Configurable defaults (can also be set as environment variables)
if not defined DEPLOY_PAGES_REPO set "DEPLOY_PAGES_REPO=..\spillz.github.io"
if not defined DEPLOY_PAGES_SUBDIR set "DEPLOY_PAGES_SUBDIR=dropship"

:: Check if commit message is provided
if "%~1"=="" (
    echo Usage: DEPLOY.bat "commit message" [pages-subdir]
    exit /b 1
)

set "COMMIT_MSG=%~1"
set "PAGES_SUBDIR=%~2"
if not defined PAGES_SUBDIR set "PAGES_SUBDIR=%DEPLOY_PAGES_SUBDIR%"
if /I "%PAGES_SUBDIR%"=="root" set "PAGES_SUBDIR=/"
if not "%PAGES_SUBDIR%"=="/" (
    if "%PAGES_SUBDIR:~0,1%"=="/" set "PAGES_SUBDIR=%PAGES_SUBDIR:~1%"
    if "%PAGES_SUBDIR:~-1%"=="/" set "PAGES_SUBDIR=%PAGES_SUBDIR:~0,-1%"
)

if "%PAGES_SUBDIR%"=="/" (
    set "PAGES_DEST=%DEPLOY_PAGES_REPO%"
    set "VITE_PUBLIC_BASE=/"
) else (
    set "PAGES_DEST=%DEPLOY_PAGES_REPO%\%PAGES_SUBDIR%"
    set "VITE_PUBLIC_BASE=/%PAGES_SUBDIR%/"
)

echo Deploy destination: %PAGES_DEST%
echo Vite public base: %VITE_PUBLIC_BASE%

:: Clear the build folder (if present)
if exist dist rd /s /q dist

:: Run build process
call npm run build || exit /b 1

:: Ensure deployment directory exists
if not exist "%PAGES_DEST%" mkdir "%PAGES_DEST%" || exit /b 1

:: Copy build output to deployment directory
xcopy /e /i /y "dist\*" "%PAGES_DEST%\" >nul || exit /b 1

:: Change to deployment directory
pushd "%PAGES_DEST%" || exit /b 1

:: Commit and push changes
git add .
git diff --cached --quiet
if errorlevel 1 (
    git commit -m "%COMMIT_MSG%" || exit /b 1
    git push || exit /b 1
) else (
    echo No changes to commit.
)

:: Return to original directory
popd

endlocal
