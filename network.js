/**
 * 坦克大战网络联机客户端
 * 
 * 职责：
 * - 管理 WebSocket 连接
 * - 发送玩家输入到服务器
 * - 接收并处理服务器状态同步
 * - 处理房间管理（创建、加入、离开）
 * 
 * 设计原则：
 * - 客户端只负责发送输入和接收服务器状态
 * - 游戏逻辑完全由服务器处理
 * - 无本地游戏逻辑，确保防作弊
 */

class NetworkManager {
    constructor(renderer) {
        this.renderer = renderer; // 渲染器实例
        this.ws = null;
        this.playerId = null;
        this.roomCode = null;
        this.role = null; // 'host' | 'client'
        this.playerNumber = null;
        this.connected = false;

        // WebSocket 服务器配置
        this.wsHost = window.WS_HOST || 'localhost';
        this.wsPort = window.WS_PORT || 8080;

        // 本地按键状态
        this.keys = {};
        this.keyQueue = [];

        // 服务器游戏状态
        this.serverState = null;

        // 游戏配置（从服务器获取）
        this.gameConfig = null;

        // 心跳
        this.heartbeatInterval = null;

        // 配置接收事件回调
        this.onConfigReceived = null;
        // 连接成功事件回调
        this.onConnected = null;
        // 房间创建事件回调
        this.onRoomCreated = null;
        // 房间加入事件回调
        this.onRoomJoined = null;
        // 玩家加入事件回调
        this.onPlayerJoined = null;
        // 玩家列表更新事件回调
        this.onPlayerListUpdate = null;
        // 玩家离开事件回调
        this.onDisconnected = null;
        // 加入房间失败事件回调
        this.onJoinFailed = null;
        // 游戏开始事件回调
        this.onGameStarted = null;
        // 游戏暂停事件回调
        this.onGamePaused = null;
        // 游戏恢复事件回调
        this.onGameResumed = null;
        // 游戏结束事件回调
        this.onGameOver = null;
        // 错误事件
        this.onError = null;
    }

    /**
     * 连接到服务器
     */
    connect(url = null) {
        return new Promise((resolve, reject) => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                resolve();
                return;
            }

            // 如果没有提供 URL，使用配置的地址
            const serverUrl = url || `ws://${this.wsHost}:${this.wsPort}`;

            try {
                this.ws = new WebSocket(serverUrl);

                this.ws.onopen = () => {
                    console.log('[Network] 已连接到服务器');
                    this.connected = true;
                    this.startHeartbeat();
                    resolve();
                };

                this.ws.onmessage = (event) => {
                    try {
                        const message = JSON.parse(event.data);
                        this.handleMessage(message);
                    } catch (e) {
                        console.error('[Network] 消息解析错误:', e);
                    }
                };

                this.ws.onclose = () => {
                    console.log('[Network] 与服务器的连接已断开');
                    this.connected = false;
                    this.stopHeartbeat();
                    if (this.onDisconnected) {
                        this.onDisconnected();
                    }
                };

                this.ws.onerror = (error) => {
                    console.error('[Network] 连接错误:', error);
                    reject(error);
                };
            } catch (e) {
                reject(e);
            }
        });
    }

    /**
     * 离开房间（不断开连接）
     */
    leaveRoom() {
        if (this.roomCode) {
            this.send({ type: 'leave_room' });
        }
        this.roomCode = null;
        this.role = null;
        this.playerNumber = null;
    }

    /**
     * 断开连接
     */
    disconnect() {
        if (this.roomCode) {
            this.send({ type: 'leave_room' });
        }
        this.stopHeartbeat();
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.connected = false;
        this.roomCode = null;
        this.role = null;
        this.playerNumber = null;
    }

    /**
     * 处理收到的消息
     */
    handleMessage(message) {
        switch (message.type) {
            case 'connected':
                this.playerId = message.playerId;
                console.log('[Network] 连接成功，玩家ID:', this.playerId);
                if (this.onConnected) {
                    this.onConnected(message);
                }
                break;

            case 'room_created':
                this.roomCode = message.roomCode;
                this.role = message.role;
                this.playerNumber = message.playerNumber;
                console.log(`[Network] 房间创建成功: ${message.roomCode}`);
                if (this.onRoomCreated) {
                    this.onRoomCreated(message);
                }
                break;

            case 'room_joined':
                this.roomCode = message.roomCode;
                this.role = message.role;
                this.playerNumber = message.playerNumber;
                console.log(`[Network] 加入房间成功: ${message.roomCode}`);
                if (this.onRoomJoined) {
                    this.onRoomJoined(message);
                }
                break;

            case 'join_failed':
                console.error('[Network] 加入房间失败:', message.message);
                if (this.onJoinFailed) {
                    this.onJoinFailed(message);
                }
                break;

            case 'left_room':
                console.log('[Network] 已离开房间');
                this.roomCode = null;
                this.role = null;
                this.playerNumber = null;
                if (this.onLeftRoom) {
                    this.onLeftRoom();
                }
                break;

            case 'player_joined':
                console.log('[Network] 玩家2已加入');
                if (this.onPlayerJoined) {
                    this.onPlayerJoined(message);
                }
                break;

            case 'player_list_update':
                console.log('[Network] 玩家列表更新:', message.players);
                if (this.onPlayerListUpdate) {
                    this.onPlayerListUpdate(message);
                }
                break;

            case 'host_disconnected':
                console.log('[Network] 主机已断开');
                if (this.onDisconnected) {
                    this.onDisconnected(message);
                }
                break;

            case 'client_disconnected':
                console.log('[Network] 客户端已断开');
                if (this.onClientDisconnected) {
                    this.onClientDisconnected(message);
                }
                break;

            case 'game_started':
                console.log('[Network] 游戏开始');
                if (this.onGameStarted) {
                    this.onGameStarted(message);
                }
                break;

            case 'game_over':
                console.log('[Network] 游戏结束');
                if (this.onGameOver) {
                    this.onGameOver(message);
                }
                break;

            case 'game_state':
                // 接收服务器同步的游戏状态
                this.serverState = message.state;
                if (this.renderer) {
                    this.renderer.renderServerState(message.state);
                }
                break;
            case 'game_paused':
                console.log('[Network] 游戏已暂停');
                if (this.onGamePaused) {
                    this.onGamePaused(message);
                }
                break;

            case 'game_resumed':
                console.log('[Network] 游戏已继续');
                if (this.onGameResumed) {
                    this.onGameResumed(message);
                }
                break;

            case 'error':
                console.error('[Network] 服务器错误:', message.message);
                if (this.onError) {
                    this.onError(message);
                }
                break;

            case 'heartbeat_ack':
                console.log('[Network] 收到服务器心跳:', message.type);
                // 心跳响应
                break;

            default:
                console.warn('[Network] 未知消息类型:', message.type);
        }
    }

    /**
     * 创建房间
     */
    createRoom(level = 1) {
        if (!this.connected) {
            console.error('[Network] 未连接到服务器');
            return;
        }
        this.send({
            type: 'create_room',
            level: level
        });
    }

    /**
     * 加入房间
     */
    joinRoom(roomCode) {
        if (!this.connected) {
            console.error('[Network] 未连接到服务器');
            return;
        }
        this.send({
            type: 'join_room',
            roomCode: roomCode
        });
    }

    /**
     * 开始游戏
     */
    startGame() {
        if (!this.connected || !this.roomCode) {
            console.error('[Network] 未连接到服务器或未加入房间');
            return;
        }
        this.send({
            type: 'game_start'
        });
    }

    /**
     * 发送按键按下事件
     */
    sendKeyDown(key) {
        if (!this.connected || !this.roomCode) return;
        
        this.keys[key] = true;
        this.keyQueue.push(key);
        
        // 保持队列长度合理
        if (this.keyQueue.length > 20) {
            this.keyQueue = this.keyQueue.slice(-10);
        }
        
        this.send({
            type: 'input',
            input: {
                action: 'keydown',
                key: key
            }
        });
    }

    /**
     * 发送按键抬起事件
     */
    sendKeyUp(key) {
        if (!this.connected || !this.roomCode) return;
        
        this.keys[key] = false;
        
        this.send({
            type: 'input',
            input: {
                action: 'keyup',
                key: key
            }
        });
    }

    /**
     * 下一关
     */
    nextLevel() {
        if (!this.connected) return;
        this.send({
            type: 'game_event',
            event: { type: 'next_level' }
        });
    }

    /**
     * 重新开始
     */
    restart() {
        if (!this.connected || this.role !== 'host') return;
        this.send({
            type: 'game_event',
            event: { type: 'restart' }
        });
    }

    /**
     * 跳过当前关卡
     */
    skipLevel() {
        if (!this.connected || this.role !== 'host') return;
        this.send({
            type: 'game_event',
            event: { type: 'skip_level' }
        });
    }

    /**
     * 发送暂停请求（房间内任意玩家均可触发）
     */
    sendPause() {
        if (!this.connected || !this.roomCode) return;
        this.send({
            type: 'game_pause',
            action: 'pause'
        });
    }

    /**
     * 发送继续请求（房间内任意玩家均可触发）
     */
    sendResume() {
        if (!this.connected || !this.roomCode) return;
        this.send({
            type: 'game_pause',
            action: 'resume'
        });
    }

    /**
     * 开始心跳
     */
    startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatInterval = setInterval(() => {
            if (this.connected) {
                this.send({ type: 'heartbeat' });
            }
        }, 30000);
    }

    /**
     * 停止心跳
     */
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    /**
     * 发送消息到服务器
     * @param {Object} message - 消息对象
     */
    send(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        }
    }

    /**
     * 获取服务器同步的游戏状态
     */
    getServerState() {
        return this.serverState;
    }

    /**
     * 是否为主机（房主）
     */
    isHost() {
        return this.role === 'host';
    }

    /**
     * 是否为客户端
     */
    isClient() {
        return this.role === 'client';
    }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = NetworkManager;
}
