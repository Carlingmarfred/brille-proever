@echo off
powershell -ExecutionPolicy Bypass -File "%~dp0server.ps1" -Port 5185 -OpenBrowser
