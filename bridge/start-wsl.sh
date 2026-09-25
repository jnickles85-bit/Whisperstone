#!/bin/bash
# Starts the WoW AI bridge from inside WSL.
#
# Why this exists: bridge.js is a Windows program - it spawns `powershell.exe`
# (capture.ps1) and `taskkill` by bare name. WSL's PATH does not include the
# Windows system directories, so a plain `npm start` inside WSL dies with
# `Error: spawn powershell.exe ENOENT` and the supervisor crash-loops.
# Adding the Windows dirs to PATH makes interop resolve both binaries.
#
# Usage:  bash bridge/start-wsl.sh          (Ctrl+C to stop)
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="$PATH:/mnt/c/Windows/System32:/mnt/c/Windows:/mnt/c/Windows/System32/WindowsPowerShell/v1.0:/mnt/c/Windows/System32/Wbem"

echo "PATH check:"
command -v powershell.exe || { echo "FATAL: powershell.exe still not resolvable"; exit 1; }
command -v taskkill.exe   || { echo "FATAL: taskkill.exe still not resolvable"; exit 1; }
echo

exec node bridge/supervisor.js
