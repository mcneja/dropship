@echo off
setlocal ENABLEDELAYEDEXPANSION

:: Check if commit message is provided
if %1=="" (
    echo Usage: deploy.bat "commit message"
    exit /b 1
)

:: Clear the build folder
rd /s /q dist

:: Run build process
cmd /c "npm run build || exit /b 1"

:: Copy build output to deployment directory
cmd /c "xcopy /e /i /y dist ..\spillz.github.io\7drl-2026-dropship-concept || exit /b 1"

:: Change to deployment directory
pushd ..\spillz.github.io\7drl-2026-dropship-concept

:: Commit and push changes
git add .
git commit -m %1
git push

:: Return to original directory
popd

endlocal