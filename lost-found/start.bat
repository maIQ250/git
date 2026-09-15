@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动校园失物招领系统...
echo 启动后请在浏览器打开: http://localhost:3000
echo 关闭本窗口即可停止服务。
echo.
node server.js
echo.
echo 服务已停止。按任意键关闭窗口。
pause >nul
