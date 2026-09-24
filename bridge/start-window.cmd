@echo off
cd /d "%~dp0"
start "WoW AI bridge" cmd /k node supervisor.js
