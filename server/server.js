/**
 * 坦克大战网络联机服务器
 * 
 * 功能：
 * - 房间管理：创建房间、加入房间、离开房间
 * - 游戏引擎集成：服务器端运行完整游戏逻辑
 * - 状态同步：服务器计算游戏状态，广播给所有客户端
 * - 输入转发：客户端发送按键输入到服务器
 * - 断线处理：玩家断线时通知另一方
 * 
 * 架构设计：
 * - 每个房间独立运行一个 GameEngine 实例
 * - 60FPS 的游戏 tick 循环
 * - 每 2 帧同步一次游戏状态到客户端
 * - 支持双人联机，主机创建房间，客户端加入
 */

const { WebSocketServer } = require('ws');
const { GameEngine, GAME_CONFIG, MAP_INDEX, DIRECTIONS } = require('./game-engine');
const { SERVER_TICK_RATE, SERVER_TICK_INTERVAL, STATE_SYNC_INTERVAL } = require('./constants');

const PORT = 8080;
const ROOM_CODE_LENGTH = 4;

/**
 * 生成4位数字房间码
 * @returns {string} 4位数字字符串
 */
function generateRoomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

// 房间状态
const rooms = new Map();

// WebSocket 服务器
const wss = new WebSocketServer({ port: PORT });

console.log(`WebSocket 服务器运行在 ws://localhost:${PORT}`);

/**
 * 处理新的 WebSocket 连接
 */
// 处理新连接
wss.on('connection', (ws) => {
    console.log('新客户端连接');

    // 为每个连接分配一个唯一 ID
    ws.playerId = 'player_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    ws.roomCode = null;
    ws.role = null; // 'host' 或 'client'
    ws.playerNumber = null; // 1 或 2

    // 发送连接成功消息，附带游戏配置
    sendTo(ws, {
        type: 'connected',
        playerId: ws.playerId,
        config: { ...GAME_CONFIG, maps: MAP_INDEX }
    });

    // 处理消息
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            handleMessage(ws, message);
        } catch (e) {
            console.error('消息解析错误:', e);
            sendTo(ws, {
                type: 'error',
                message: '无效的消息格式'
            });
        }
    });

    // 处理断开连接
    ws.on('close', () => {
        console.log(`玩家 ${ws.playerId} 断开连接`);
        handleDisconnect(ws);
    });

    // 处理错误
    ws.on('error', (err) => {
        console.error(`玩家 ${ws.playerId} 连接错误:`, err);
        handleDisconnect(ws);
    });
});

/**
 * 处理收到的消息（消息路由）
 * @param {WebSocket} ws - WebSocket 连接对象
 * @param {Object} message - 解析后的消息对象
 */
function handleMessage(ws, message) {
    switch (message.type) {
        case 'create_room':
            handleCreateRoom(ws, message);
            break;
        case 'join_room':
            handleJoinRoom(ws, message);
            break;
        case 'leave_room':
            handleLeaveRoom(ws, message);
            break;
        case 'input':
            handleInput(ws, message);
            break;
        case 'game_start':
            handleGameStart(ws, message);
            break;
        case 'game_pause':
            handleGamePause(ws, message);
            break;
        case 'heartbeat':
            break;
        default:
            console.warn('未知消息类型:', message.type);
    }
}

/**
 * 创建房间（主机）
 */
function handleCreateRoom(ws, message) {
    let roomCode = generateRoomCode();

    // 确保房间码唯一
    while (rooms.has(roomCode)) {
        roomCode = generateRoomCode();
    }

    const room = {
        code: roomCode,
        host: ws,
        client: null,
        gameState: 'waiting', // 'waiting', 'playing', 'paused', 'ended'
        level: message.level || 1,
        gameEngine: null,
        tickInterval: null,
        syncCounter: 0
    };

    rooms.set(roomCode, room);
    ws.roomCode = roomCode;
    ws.role = 'host';
    ws.playerNumber = 1;

    console.log(`玩家 ${ws.playerId} 创建房间 ${roomCode}`);

    sendTo(ws, {
        type: 'room_created',
        roomCode: roomCode,
        role: 'host',
        playerNumber: 1,
        level: room.level
    });

    // 发送初始玩家列表（只有主机）
    broadcastPlayerList(room);
}

/**
 * 加入房间（客户端）
 */
function handleJoinRoom(ws, message) {
    const { roomCode } = message;
    const room = rooms.get(roomCode);

    if (!room) {
        sendTo(ws, {
            type: 'join_failed',
            message: '房间不存在'
        });
        return;
    }

    if (room.client) {
        sendTo(ws, {
            type: 'join_failed',
            message: '房间已满'
        });
        return;
    }

    if (room.gameState !== 'waiting') {
        sendTo(ws, {
            type: 'join_failed',
            message: '游戏已开始，无法加入'
        });
        return;
    }

    room.client = ws;
    ws.roomCode = roomCode;
    ws.role = 'client';
    ws.playerNumber = 2;

    console.log(`玩家 ${ws.playerId} 加入房间 ${roomCode}`);

    // 通知加入者成功
    sendTo(ws, {
        type: 'room_joined',
        roomCode: roomCode,
        role: 'client',
        playerNumber: 2,
        level: room.level
    });

    // 通知主机有人加入
    sendTo(room.host, {
        type: 'player_joined',
        playerNumber: 2
    });

    // 发送更新后的玩家列表
    broadcastPlayerList(room);
}

/**
 * 离开房间
 */
function handleLeaveRoom(ws, message) {
    if (!ws.roomCode) return;

    const room = rooms.get(ws.roomCode);
    if (!room) return;

    if (ws.role === 'host') {
        // 主机离开 = 关闭房间
        stopGame(room);
        if (room.client) {
            sendTo(room.client, {
                type: 'host_disconnected',
                message: '主机已关闭房间'
            });
            room.client.roomCode = null;
            room.client.role = null;
            room.client.playerNumber = null;
        }
        rooms.delete(ws.roomCode);
        console.log(`房间 ${ws.roomCode} 已关闭（主机离开）`);
    } else {
        // 客户端离开
        if (room.host) {
            sendTo(room.host, {
                type: 'client_disconnected',
                message: '玩家2已离开房间'
            });
            if (room.gameEngine) {
                room.gameEngine.isTwoPlayer = false;
                if (room.gameEngine.player2) {
                    room.gameEngine.player2 = null;
                }
            }
        }
        room.client = null;
        ws.roomCode = null;
        ws.role = null;
        ws.playerNumber = null;
        console.log(`房间 ${room.code} 客户端已离开`);

        // 通知离开者成功
        sendTo(ws, { type: 'left_room' });

        // 发送更新后的玩家列表
        broadcastPlayerList(room);
    }
}

/**
 * 开始游戏
 */
function handleGameStart(ws, message) {
    const room = getRoom(ws);
    if (!room) return;

    if (ws.role !== 'host') {
        sendTo(ws, { type: 'error', message: '只有主机可以开始游戏' });
        return;
    }

    if (room.gameState !== 'waiting') {
        sendTo(ws, { type: 'error', message: '游戏已经在运行中' });
        return;
    }

    // 创建游戏引擎实例
    room.gameEngine = new GameEngine(room.level, null, (newState) => {
        // 游戏状态变更回调
        if (newState.gameState === 'gameover') {
            broadcastToRoom(room, {
                type: 'game_over',
                state: newState
            });
            stopGame(room);
            // 游戏结束后重置为等待状态，允许同一房间重新开始
            room.gameState = 'waiting';
            broadcastToRoom(room, {
                type: 'game_restarted'
            });
        }
    });

    // 初始化游戏
    room.gameEngine.generateMap();
    room.gameEngine.isTwoPlayer = !!room.client; // 有客户端就是双人模式
    room.gameEngine.init();
    room.gameEngine.start();

    room.gameState = 'playing';
    room.syncCounter = 0;

    // 通知所有客户端游戏开始，附带游戏配置
    broadcastToRoom(room, {
        type: 'game_started',
        playerNumber: ws.playerNumber,
        level: room.level,
        isTwoPlayer: room.gameEngine.isTwoPlayer,
        config: { ...GAME_CONFIG, maps: MAP_INDEX }
    });

    // 启动游戏 tick 循环
    room.tickInterval = setInterval(() => {
        gameTick(room);
    }, SERVER_TICK_INTERVAL);

    console.log(`房间 ${room.code} 游戏开始`);
}

/**
 * 游戏 tick 循环
 */
function gameTick(room) {
    if (!room.gameEngine) {
        return;
    }
    // paused 状态下不调用 update，但保持 tick 继续运行以便后续恢复
    if (room.gameState !== 'playing') {
        return;
    }

    // 更新游戏状态
    room.gameEngine.update();

    // 游戏可能在 update 中结束，检查是否仍然在运行
    if (!room.gameEngine || room.gameState !== 'playing') {
        return;
    }

    // 定期同步状态到客户端
    room.syncCounter++;
    if (room.syncCounter >= STATE_SYNC_INTERVAL) {
        room.syncCounter = 0;
        const gameState = room.gameEngine.getGameState();
        broadcastToRoom(room, {
            type: 'game_state',
            state: gameState
        });
    }
}

/**
 * 停止游戏
 */
/**
 * 停止游戏并清理资源
 * @param {Object} room - 房间对象
 */
function stopGame(room) {
    if (room.tickInterval) {
        clearInterval(room.tickInterval);
        room.tickInterval = null;
    }
    room.gameState = 'ended';
    room.gameEngine = null;
}

/**
 * 客户端发送输入到服务器
 */
function handleInput(ws, message) {
    const room = getRoom(ws);
    if (!room || !room.gameEngine) return;

    const input = message.input;
    const playerNumber = ws.playerNumber; // 1 or 2

    // 获取对应玩家的按键状态
    const playerKeys = playerNumber === 1 
        ? room.gameEngine.player1Keys 
        : room.gameEngine.player2Keys;
    const playerKeyQueue = playerNumber === 1 
        ? room.gameEngine.player1KeyQueue 
        : room.gameEngine.player2KeyQueue;

    // 处理按键事件
    if (input.action === 'keydown') {
        playerKeys[input.key] = true;
        playerKeyQueue.push(input.key);
        // 保持队列长度合理
        if (playerKeyQueue.length > 20) {
            playerKeyQueue.splice(0, playerKeyQueue.length - 10);
        }
    } else if (input.action === 'keyup') {
        playerKeys[input.key] = false;
    }
}

/**
 * 处理暂停/继续请求（房间内任意玩家均可触发）
 */
function handleGamePause(ws, message) {
    const room = getRoom(ws);
    if (!room || !room.gameEngine) return;

    // 暂停/继续不限制为主机，房间内任何玩家均可触发
    if (message.action === 'pause') {
        if (room.gameState === 'playing') {
            room.gameState = 'paused';
            room.gameEngine.pause();
            console.log(`房间 ${room.code} 游戏已暂停`);
            // 广播暂停通知给所有客户端
            broadcastToRoom(room, {
                type: 'game_paused'
            });
        }
    } else if (message.action === 'resume') {
        if (room.gameState === 'paused') {
            room.gameState = 'playing';
            room.gameEngine.resume();
            console.log(`房间 ${room.code} 游戏已继续`);
            // 广播继续通知给所有客户端
            broadcastToRoom(room, {
                type: 'game_resumed'
            });
        }
    }
}

/**
 * 处理断线
 */
function handleDisconnect(ws) {
    if (!ws.roomCode) return;

    const room = rooms.get(ws.roomCode);
    if (!room) return;

    if (ws.role === 'host') {
        // 停止游戏
        stopGame(room);
        
        // 主机断线，通知客户端
        if (room.client) {
            sendTo(room.client, {
                type: 'host_disconnected',
                message: '主机已断开连接'
            });
            room.client.roomCode = null;
            room.client.role = null;
            room.client.playerNumber = null;
        }
        rooms.delete(ws.roomCode);
        console.log(`房间 ${ws.roomCode} 已删除（主机断线）`);
    } else if (ws.role === 'client') {
        // 客户端断线，通知主机
        if (room.host) {
            sendTo(room.host, {
                type: 'client_disconnected',
                message: '玩家2已断开连接'
            });
            
            // 如果游戏正在运行，切换为单人模式
            if (room.gameEngine) {
                room.gameEngine.isTwoPlayer = false;
                if (room.gameEngine.player2) {
                    room.gameEngine.player2 = null;
                }
            }
        }
        room.client = null;
        ws.roomCode = null;
        ws.role = null;
        ws.playerNumber = null;
        console.log(`房间 ${room.code} 客户端已离开`);

        // 发送更新后的玩家列表
        broadcastPlayerList(room);
    }
}

/**
 * 获取玩家所在的房间
 */
function getRoom(ws) {
    if (!ws.roomCode) return null;
    return rooms.get(ws.roomCode);
}

/**
 * 发送玩家列表更新给房间内所有玩家
 */
function broadcastPlayerList(room) {
    const players = [];
    // 主机（用户1）
    if (room.host) {
        players.push({
            playerId: room.host.playerId,
            playerNumber: 1,
            role: 'host',
            name: '用户1'
        });
    }
    // 客户端（用户2）
    if (room.client) {
        players.push({
            playerId: room.client.playerId,
            playerNumber: 2,
            role: 'client',
            name: '用户2'
        });
    }

    broadcastToRoom(room, {
        type: 'player_list_update',
        players: players
    });
}

/**
 * 发送消息给指定 WebSocket
 */
function sendTo(ws, message) {
    if (ws.readyState === 1) { // WebSocket.OPEN
        ws.send(JSON.stringify(message));
    }
}

/**
 * 广播消息给房间内所有玩家
 */
function broadcastToRoom(room, message, excludeWs = null) {
    if (room.host && room.host.readyState === 1 && room.host !== excludeWs) {
        room.host.send(JSON.stringify(message));
    }
    if (room.client && room.client.readyState === 1 && room.client !== excludeWs) {
        room.client.send(JSON.stringify(message));
    }
}

// 定期清理空房间
setInterval(() => {
    for (const [code, room] of rooms) {
        const hostConnected = room.host && room.host.readyState === 1;
        const clientConnected = room.client && room.client.readyState === 1;
        
        // 清理没有玩家的房间
        if (!hostConnected && !clientConnected) {
            stopGame(room);
            rooms.delete(code);
            console.log(`清理空房间 ${code}`);
        }
    }
}, 30000);

// 优雅退出
process.on('SIGINT', () => {
    console.log('\n服务器正在关闭...');
    
    // 停止所有游戏
    for (const [code, room] of rooms) {
        stopGame(room);
    }
    
    wss.close(() => {
        console.log('服务器已关闭');
        process.exit(0);
    });
});
