#!/bin/bash
# 坦克大战 - 启动脚本

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HTTP_IP="10.12.150.64"
WS_IP="0.0.0.0"
HTTP_PORT=8000
WS_PORT=8080

# 使用 asdf 的 npm（如果存在）
if [ -d "$HOME/.asdf/shims" ]; then
    export PATH="$HOME/.asdf/shims:$PATH"
fi

cd "$SCRIPT_DIR"

# 检查并安装服务器依赖
if [ ! -d "server/node_modules" ]; then
    echo "正在安装服务器依赖..."
    cd server && npm install && cd ..
fi

echo "正在启动坦克大战..."
echo "HTTP 服务器: http://$HTTP_IP:$HTTP_PORT"
echo "WebSocket 服务器: ws://$WS_IP:$WS_PORT"

# 启动 WebSocket 服务器（后台运行）
node server/server.js &
WS_PID=$!
sleep 1

# 启动 HTTP 服务器（后台运行）
python3 -m http.server $HTTP_PORT &
HTTP_PID=$!
sleep 1

echo ""
echo "============================================"
echo "  坦克大战已启动！"
echo ""
echo "  HTTP: http://$HTTP_IP:$HTTP_PORT"
echo "  WS:   ws://$WS_IP:$WS_PORT"
echo "  PID:  HTTP=$HTTP_PID  WS=$WS_PID"
echo "============================================"
echo ""
echo "按 Ctrl+C 停止所有服务器"

echo "请手动打开浏览器访问 http://$HTTP_IP:$HTTP_PORT"

# 捕获Ctrl+C，清理所有进程
trap "echo '正在停止服务器...'; kill $HTTP_PID $WS_PID 2>/dev/null; exit" SIGINT SIGTERM

# 等待服务器
wait $HTTP_PID