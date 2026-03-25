/**
 * 坦克大战 - 客户端渲染器
 *
 * 职责：
 * - 只负责玩家输入采集和游戏画面渲染
 * - 游戏逻辑完全在服务端（server/game-engine.js）
 */

// ==================== Canvas 元素 ====================
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// ==================== 常量定义 ====================
/**
 * 计算精度缩放因子
 * 用于避免浮点数精度问题，所有位置计算都乘以这个系数后再进行
 */
const SCALE = 10000;

/**
 * 地图格子的像素大小
 * 每个地图单元在画布上占据的宽高像素值
 */
const TILE_SIZE = 32;

/**
 * 地图宽度（格子数）
 * 地图横向包含的格子数量
 */
const MAP_WIDTH = 26;

/**
 * 地图高度（格子数）
 * 地图纵向包含的格子数量
 */
const MAP_HEIGHT = 26;

/**
 * 方向枚举
 * 用于表示坦克的移动方向
 */
const DIRECTIONS = {
    UP: 0, // 向上
    RIGHT: 1, // 向右
    DOWN: 2, // 向下
    LEFT: 3 // 向左
};

/**
 * 地图块类型枚举
 * 用于表示地图中每个格子的类型
 */
const TILE_TYPES = {
    EMPTY: 0, // 空白
    BRICK: 1,  // 砖块
    STEEL: 2,  // 钢板
    WATER: 3,  // 海洋
    GRASS: 4,  // 草地
    BASE: 5,    // 基地
    BASE_DESTROYED: 6 // 摧毁的基地
};

// ==================== 游戏配置（从服务器接收） ====================
let GAME_CONFIG = null;

function setGameConfig(config) {
    GAME_CONFIG = config;
    console.log('[Config] 已从服务器接收游戏配置');
}

// ==================== 渲染实体（纯数据容器 + 渲染器） ====================

/**
 * 道具类 - 表示游戏中的各种增益道具
 * @class
 */
class PowerUp {
    /**
     * 创建道具实例
     * @param {number} x - X坐标（缩放后的值）
     * @param {number} y - Y坐标（缩放后的值）
     * @param {string} type - 道具类型（speed/damage/bulletSpeed等）
     */
    constructor(x, y, type) {
        this.x = x;
        this.y = y;
        this.size = TILE_SIZE * SCALE;
        this.type = type;
        this.active = true;
        this.animTimer = 0;
        this.lifetime = 3600;
        this.color = '#4080ff';
        this.symbol = 'S';
    }

    /**
     * 绘制道具（包含动画效果）
     */
    draw() {
        // 不激活的道具不绘制
        if (!this.active) {
            return;
        }
        this.animTimer++;

        const drawX = this.x / SCALE;
        const drawY = this.y / SCALE;
        const drawSize = this.size / SCALE;
        const pulse = Math.sin(this.animTimer * 0.1) * 2;
        const size = drawSize + pulse;
        const radius = 6;

        ctx.fillStyle = this.color;
        ctx.globalAlpha = 0.3 + Math.sin(this.animTimer * 0.15) * 0.2;
        ctx.beginPath();
        ctx.roundRect(drawX - pulse / 2, drawY - pulse / 2, size, size, radius);
        ctx.fill();
        ctx.globalAlpha = 1;

        ctx.strokeStyle = this.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(drawX + 2, drawY + 2, drawSize - 4, drawSize - 4, radius - 2);
        ctx.stroke();

        // 绘制道具图标
        ctx.fillStyle = this.color;
        ctx.font = 'bold 14px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.symbol, drawX + drawSize / 2, drawY + drawSize / 2 - 4);

        // 绘制剩余时间
        const remainingSeconds = Math.ceil(this.lifetime / 60);
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(remainingSeconds + 's', drawX + drawSize - 3, drawY + drawSize - 3);
    }
}

/**
 * 子弹类 - 表示游戏中的子弹实体
 * @class
 */
class Bullet {
    /**
     * 创建子弹实例
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     * @param {number} direction - 方向（0:上, 1:右, 2:下, 3:左）
     * @param {string} owner - 所有者（'player1'/'player2'/'enemy'）
     * @param {number} damage - 伤害值
     * @param {number} size - 子弹大小
     */
    constructor(x, y, direction, owner, damage, size) {
        this.x = x;
        this.y = y;
        this.direction = direction;
        this.size = size;
        this.damage = damage;
        this.owner = owner;
        this.active = true;
    }

    /**
     * 绘制子弹
     */
    draw() {
        if (this.owner === 'player1') {
            ctx.fillStyle = '#f8d830';
        } else if (this.owner === 'player2') {
            ctx.fillStyle = '#40c040';
        } else {
            ctx.fillStyle = '#c0c0c0';
        }
        const drawX = this.x / SCALE;
        const drawY = this.y / SCALE;
        const drawSize = this.size / SCALE;
        ctx.fillRect(drawX - drawSize / 2, drawY - drawSize / 2, drawSize, drawSize);
    }
}

/**
 * 坦克类 - 表示玩家或敌人的坦克实体
 * @class
 */
class Tank {
    /**
     * 创建坦克实例
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     * @param {number} direction - 初始方向
     * @param {boolean} isPlayer - 是否为玩家
     * @param {number} playerId - 玩家ID（1或2）
     * @param {number} tankClass - 坦克等级（0:轻型, 1:中型, 2:重型）
     */
    constructor(x, y, direction, isPlayer = false, playerId = 1, tankClass = 0) {
        this.x = x;
        this.y = y;
        this.direction = direction;
        this.isPlayer = isPlayer;
        this.playerId = playerId;
        this.size = (TILE_SIZE - 2) * SCALE;
        this.tankClass = tankClass;

        // 坦克当前生命值
        this.health = 0;
        // 坦克最大生命值
        this.maxHealth = 0;
        // 坦克是否激活
        this.active = true;
        // 坦克是否正在生成
        this.isSpawning = true;
        // 坦克生成时间Timer
        this.spawnTimer = 0;
        // 坦克是否被 stun
        this.isStunned = false;
        // 坦克stunned闪烁Timer
        this.stunnedTimer = 0;

        this.trackOffset = 0;
        // 坦克基础移动速度
        this.baseSpeed = 0;
        // 坦克基础炮弹速度
        this.bulletSpeed = 0;
        // 坦克基础炮弹伤害
        this.bulletDamage = 0;
        // 坦克射击冷却时间
        this.shootDelay = 0;
        // 坦克炮弹数量
        this.bulletCount = 0;
        // 坦克设计冷却（秒）*帧数
        this.shootCooldown = 0;
    }

    /**
     * 绘制坦克（根据类型和状态）
     */
    draw() {
        // 非激活状态
        if (!this.active) {
            return;
        }

        // 出生状态
        if (this.isSpawning) {
            this.spawnTimer++;
            this.drawSpawnEffect();
            return;
        }

        // Stun状态
        if (this.isStunned) {
            this.stunnedTimer++;
            // 当flashOn为false时，直接return不绘制坦克；从而达到闪烁效果
            const flashOn = Math.floor(this.stunnedTimer / 4) % 2 === 0;
            if (!flashOn) {
                return;
            }
        }

        const drawX = this.x / SCALE;
        const drawY = this.y / SCALE;
        const drawSize = this.size / SCALE;

        ctx.save();
        ctx.translate(drawX + drawSize / 2, drawY + drawSize / 2);
        ctx.rotate(this.direction * Math.PI / 2);
        ctx.translate(-drawSize / 2, -drawSize / 2);

        if (this.isPlayer) {
            // 绘制玩家坦克
            this.drawPlayerTank(drawSize);
        } else {
            // 绘制敌人坦克
            this.drawEnemyTank(drawSize);
        }

        ctx.restore();

        // 如果敌人不是满血状态，敌人绘制血条
        if (!this.isPlayer && this.health < this.maxHealth) {
            this.drawHealthBar(drawX, drawY, drawSize);
        }
    }

    /**
     * 绘制出生动画效果
     */
    drawSpawnEffect() {
        const frame = Math.floor(this.spawnTimer / 8) % 4;
        const sizes = [8, 16, 24, this.size / SCALE];
        const currentSize = sizes[Math.min(frame, 3)];
        const drawX = this.x / SCALE;
        const drawY = this.y / SCALE;
        const drawSize = this.size / SCALE;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(
            drawX + (drawSize - currentSize) / 2,
            drawY + (drawSize - currentSize) / 2,
            currentSize, currentSize
        );
    }

    /**
     * 绘制玩家坦克（根据玩家ID使用不同颜色）
     * @param {number} s - 坦克尺寸
     */
    drawPlayerTank(s) {
        let bodyColor, darkColor, lightColor;
        if (this.playerId === 1) {
            bodyColor = '#f8d830';
            darkColor = '#c8a820';
            lightColor = '#f8e860';
        } else {
            bodyColor = '#40c040';
            darkColor = '#208020';
            lightColor = '#60e060';
        }

        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 2, 4, s - 4);
        ctx.fillRect(s - 4, 2, 4, s - 4);

        ctx.fillStyle = '#606060';
        for (let i = 0; i < 4; i++) {
            const offset = (this.trackOffset + i) % 4;
            ctx.fillRect(1, 4 + i * 6 + offset, 2, 2);
            ctx.fillRect(s - 3, 4 + i * 6 + offset, 2, 2);
        }

        ctx.fillStyle = bodyColor;
        ctx.fillRect(4, 4, s - 8, s - 8);

        ctx.fillStyle = darkColor;
        ctx.fillRect(6, 6, s - 12, s - 12);

        ctx.fillStyle = bodyColor;
        ctx.fillRect(s / 2 - 3, 0, 6, s / 2 + 4);

        ctx.fillStyle = darkColor;
        ctx.fillRect(s / 2 - 1, 0, 2, s / 2 + 2);
    }

    /**
     * 绘制敌人坦克（根据坦克等级使用不同外观）
     * @param {number} s - 坦克尺寸
     */
    drawEnemyTank(s) {
        if (this.tankClass === 0) {
            const offset = 4;
            const ts = s - offset * 2;

            ctx.fillStyle = '#6090c0';
            ctx.fillRect(offset + 0, offset + 2, 2, ts - 4);
            ctx.fillRect(offset + ts - 2, offset + 2, 2, ts - 4);

            ctx.fillStyle = '#404040';
            for (let i = 0; i < 3; i++) {
                const trackOffset = (this.trackOffset + i) % 3;
                ctx.fillRect(offset + 1, offset + 4 + i * 4 + trackOffset, 1, 1);
                ctx.fillRect(offset + ts - 2, offset + 4 + i * 4 + trackOffset, 1, 1);
            }

            ctx.fillStyle = '#a0d0ff';
            ctx.fillRect(offset + 4, offset + 4, ts - 8, ts - 8);

            ctx.fillStyle = '#80b0e0';
            ctx.fillRect(offset + 6, offset + 6, ts - 12, ts - 12);

            ctx.fillStyle = '#c0e0ff';
            ctx.fillRect(offset + ts / 2 - 2, offset, 4, ts / 2 + 4);

            ctx.fillStyle = '#80b0e0';
            ctx.fillRect(offset + ts / 2 - 1, offset, 2, ts / 2 + 2);
        } else if (this.tankClass === 1) {
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 2, 4, s - 4);
            ctx.fillRect(s - 4, 2, 4, s - 4);

            ctx.fillStyle = '#505050';
            for (let i = 0; i < 4; i++) {
                const offset = (this.trackOffset + i) % 4;
                ctx.fillRect(1, 4 + i * 6 + offset, 2, 2);
                ctx.fillRect(s - 3, 4 + i * 6 + offset, 2, 2);
            }

            ctx.fillStyle = '#c0c0c0';
            ctx.fillRect(4, 4, s - 8, s - 8);

            ctx.fillStyle = '#a08010';
            ctx.fillRect(6, 6, s - 12, s - 12);

            ctx.fillStyle = '#e0c040';
            ctx.fillRect(8, 8, 4, 4);
            ctx.fillRect(s - 12, 8, 4, 4);
            ctx.fillRect(8, s - 12, 4, 4);
            ctx.fillRect(s - 12, s - 12, 4, 4);

            ctx.fillStyle = '#c0c0c1';
            ctx.fillRect(s / 2 - 3, 0, 6, s / 2 + 4);

            ctx.fillStyle = '#a08010';
            ctx.fillRect(s / 2 - 1, 0, 2, s / 2 + 2);
        } else {
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, s, s);
            ctx.fillRect(s, 0, 0, s);

            ctx.fillStyle = '#303030';
            for (let i = 0; i < 5; i++) {
                const offset = (this.trackOffset + i) % 5;
                ctx.fillRect(1, 3 + i * 5 + offset, 1, 1);
                ctx.fillRect(s - 2, 3 + i * 5 + offset, 1, 1);
            }

            ctx.fillStyle = '#404040';
            ctx.fillRect(4, 4, s - 8, s - 8);

            ctx.fillStyle = '#606060';
            ctx.fillRect(6, 6, s - 12, s - 12);

            ctx.fillStyle = '#505050';
            ctx.fillRect(8, 8, s - 16, s - 16);
            ctx.fillRect(10, 10, s - 20, s - 20);
            ctx.fillRect(s - 20, 10, 10, s - 20);

            ctx.fillStyle = '#404040';
            ctx.fillRect(s / 2 - 4, 0, 8, s / 2 + 8);

            ctx.fillStyle = '#303030';
            ctx.fillRect(s / 2 - 2, 0, 8, s / 2 + 2);

            ctx.fillStyle = '#606060';
            ctx.fillRect(s / 2 - 1, 0, 4, s / 2 + 4);

            ctx.fillStyle = '#404040';
            ctx.fillRect(s / 2 - 3, 0, 6, s / 2 + 4);

            ctx.fillStyle = '#303030';
            ctx.fillRect(s / 2 - 5, 0, 6, s / 2 + 6);
        }
    }

    /**
     * 绘制生命条（仅敌人显示）
     * @param {number} drawX - 绘制X坐标
     * @param {number} drawY - 绘制Y坐标
     * @param {number} drawSize - 绘制尺寸
     */
    drawHealthBar(drawX, drawY, drawSize) {
        const barWidth = drawSize - 4;
        const barHeight = 3;
        const barX = drawX + 2;
        const barY = drawY + drawSize + 2;
        const healthPercent = this.health / this.maxHealth;

        ctx.fillStyle = '#333333';
        ctx.fillRect(barX, barY, barWidth, barHeight);

        if (healthPercent > 0.6) {
            ctx.fillStyle = '#40c040';
        } else if (healthPercent > 0.3) {
            ctx.fillStyle = '#f0c020';
        } else {
            ctx.fillStyle = '#e02020';
        }

        ctx.fillRect(barX, barY, barWidth * healthPercent, barHeight);

        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(barX, barY, barWidth, barHeight);
    }
}

// ==================== 渲染器主类 ====================

/**
 * 渲染器类 - 负责游戏画面渲染和用户交互
 * @class
 */
class Renderer {
    /**
     * 创建渲染器实例
     */
    constructor() {
        /** 
         * 游戏对象（从服务器数据创建）
         */
        // 玩家1
        this.player1 = null;
        // 玩家2
        this.player2 = null;
        // 敌人
        this.enemies = [];
        // 子弹
        this.bullets = [];
        // 道具
        this.powerUps = [];

        /**
         * 状态
         */
        // 双人游玩
        this.isTwoPlayer = false;
        // 玩家1分数
        this.score1 = 0;
        // 玩家2分数
        this.score2 = 0;
        // 玩家1生命数
        this.lives1 = 3;
        // 玩家2生命数
        this.lives2 = 3;
        // 最大生命数
        this.maxLives = 6;
        // 玩家1击杀信息
        this.kills1 = { light: 0, normal: 0, heavy: 0, total: 0 };
        // 玩家2击杀信息
        this.kills2 = { light: 0, normal: 0, heavy: 0, total: 0 };
        // 关卡
        this.level = 1;
        // 游戏状态
        this.gameState = 'menu';

        // 敌人被击杀数量
        this.enemiesKilled = 0;
        // 敌人总数
        this.totalEnemiesToSpawn = 0;

        // 地图数据
        this.map = [];
        this.mapName = '';
        this.mapDescription = '';
        this.messageTimer = 0;
        this.waterAnimTimer = 0;

        // 动画帧
        this.animationId = null;

        // 网络模块
        this.network = null;

        // 初始化
        this.setupEventListeners();
        this.setupNetworkListeners();

        // test
        this.oldState;
    }

    // ==================== 网络模块 ====================

    /**
     * 设置网络监听器，创建 NetworkManager 实例并注册回调
     */
    setupNetworkListeners() {
        if (typeof NetworkManager !== 'undefined') {
            this.network = new NetworkManager(this);
            this.setupNetworkCallbacks();
            this.autoConnectServer();
        }
    }

    /**
     * 自动连接到服务器
     */
    async autoConnectServer() {
        if (!this.network || this.network.connected) {
            return;
        }
        try {
            // 使用配置的 WebSocket 地址
            const wsUrl = `ws://${window.WS_HOST || 'localhost'}:${window.WS_PORT || 8080}`;
            await this.network.connect(wsUrl);
            console.log('[Renderer] 服务器连接成功');
        } catch (error) {
            console.warn('[Renderer] 服务器连接失败:', error.message);
        }
        this.showPopMenu('网络联机', '创建或加入房间', 0);
    }

    /**
     * 设置网络回调函数，处理各种网络事件
     */
    setupNetworkCallbacks() {

        if (!this.network) {
            return;
        }

        /**
         * 连接服务端成功，使用服务端下发的配置
         */
        this.network.onConnected = (data) => {
            console.log('[Renderer] Connected, playerId:', data.playerId);
            if (data.config) {
                setGameConfig(data.config);
            }
        };

        /**
         * 创建房间成功，显示房间号
         */
        this.network.onRoomCreated = (data) => {
            // 当前为房主
            this.isHost = true;
            // 默认不是双玩家模式
            this.isTwoPlayer = false;

            // 设置随机房间码
            const displayRoomCode = document.getElementById('displayRoomCode');
            if (displayRoomCode) {
                displayRoomCode.textContent = data.roomCode;
            }
            this.showPopMenu('房间创建成功', '等待用户加入房间', 1);

        };

        /**
         * 加入房间成功，显示房间号
         */
        this.network.onRoomJoined = (data) => {
            this.isHost = false;
            this.isTwoPlayer = true;
            this.gameState = 'waiting';

            // 设置房间码
            const displayRoomCode = document.getElementById('displayRoomCode');
            if (displayRoomCode) {
                displayRoomCode.textContent = data.roomCode;
            }
            this.showPopMenu('房间加入成功', '等待主机开始', 2);
        };

        /**
         * 玩家加入房间
         */
        this.network.onPlayerJoined = () => {
            this.isTwoPlayer = true;
            const waitingText = document.getElementById('waitingText');
            if (waitingText) {
                waitingText.textContent = '玩家2已加入！';
            }
        };

        /**
         * 玩家加入失败
         */
        this.network.onJoinFailed = (data) => {
            console.log("玩家加入房间失败");
        };

        /**
         * 玩家离开房间
         */
        this.network.onLeftRoom = () => {
            this.isHost = false;
            this.isTwoPlayer = false;
            this.gameState = 'menu';
            this.showPopMenu();
        };

        /**
         * 收到服务器通知：host（房主）玩家断线
         * @param {Object} data
         */
        this.network.onDisconnected = (data) => {
            if (this.isHost) {
                this.isTwoPlayer = false;
                const startBtn = document.getElementById('startGameBtn');
                if (startBtn) startBtn.classList.remove('hidden');
                const waitingText = document.getElementById('waitingText');
                if (waitingText) waitingText.textContent = '等待其他玩家加入...';
            }
            if (this.gameState === 'running') {
                if (this.isHost) {
                    this.setGameOver();
                } else {
                    this.showPopMenu('连接断开', '主机已断开连接');
                    this.gameState = 'gameover';
                    cancelAnimationFrame(this.animationId);
                    this.animationId = null;
                }
            }
            this.isHost = false;
            this.showPopMenu();
        };

        /**
         * 开始游戏
         */
        this.network.onGameStarted = (data) => {
            console.log('[Renderer] Game started, isTwoPlayer:', data.isTwoPlayer);
            if (data.isTwoPlayer !== undefined) {
                this.isTwoPlayer = data.isTwoPlayer;
            }
            this.hidePopMenu();
            this.gameState = 'running';
            // 更新按钮可见性
            this.updateButtonVisibility();
            // 开始游戏渲染
            this.startClientRenderLoop();
        };

        /**
         * 接收到服务器通知：游戏结束
         */
        this.network.onGameOver = (data) => {
            console.log('[Renderer] Game over');
            this.gameState = 'gameover';
            if (data.state) {
                this.applyServerState(data.state);
            }

            // 显示最终得分
            const message = this.score1 > 0 ? `最终得分: ${this.score1}` : '游戏结束';
            this.showPopMenu('游戏结束', message, 3);
            this.updateButtonVisibility();
        };

        /**
         * 接收到服务器消息：游戏暂停
         */
        this.network.onGamePaused = () => {
            console.log('[Renderer] 收到服务器暂停通知');
            // 设置游戏状态为暂停
            this.gameState = 'paused';
            // 停止渲染
            if (this.animationId) {
                cancelAnimationFrame(this.animationId);
                this.animationId = null;
            }
            // 开始暂停按钮文本修改为‘继续’
            const pauseResumeBtn = document.getElementById('pauseResumeBtn');
            if (pauseResumeBtn) {
                pauseResumeBtn.textContent = '继续';
            }
        };

        /**
         * 接收到服务器消息：游戏恢复
         */
        this.network.onGameResumed = () => {
            console.log('[Renderer] 收到服务器继续通知');
            // 设置游戏状态为‘运行’
            this.gameState = 'running';
            // 暂停恢复按钮文本修改为‘暂停’
            const pauseResumeBtn = document.getElementById('pauseResumewBtn');
            if (pauseResumeBtn) {
                pauseResumeBtn.textContent = '暂停';
            }
            // 启动渲染渲染
            this.startClientRenderLoop();
        };

        /**
         * 接收到服务器错误消息
         */
        this.network.onError = (data) => {
            console.error('[Renderer] Error:', data.message);
        };

        /**
         * 接收到服务器消息：玩家列表更新
         */
        this.network.onPlayerListUpdate = (data) => {
            this.updatePlayerList(data.players);
        };
    }

    /**
     * 更新玩家列表显示
     * @param {Array} players - 玩家列表数据
     */
    updatePlayerList(players) {
        const playerCount = players ? players.length : 1;
        this.isTwoPlayer = playerCount >= 2;

        for (let i = 1; i <= 2; i++) {
            const slot = document.getElementById(`playerSlot${i}`);
            if (!slot) continue;
            const label = slot.querySelector('.player-slot-label');
            const status = slot.querySelector('.player-slot-status');
            if (label) label.textContent = `用户${i}`;
            if (status) {
                status.textContent = '等待加入...';
                status.classList.remove('active');
            }
            slot.classList.remove('joined');
            slot.classList.add('empty');
        }

        if (players) {
            for (const player of players) {
                const slot = document.getElementById(`playerSlot${player.playerNumber}`);
                if (!slot) continue;
                const label = slot.querySelector('.player-slot-label');
                const status = slot.querySelector('.player-slot-status');
                if (label) label.textContent = player.name;
                if (status) {
                    status.textContent = '已加入';
                    status.classList.add('active');
                }
                slot.classList.add('joined');
                slot.classList.remove('empty');
            }
        }

        const waitingText = document.getElementById('waitingText');
        if (waitingText) {
            waitingText.textContent = playerCount >= 2 ? '所有玩家已就绪！' : '等待其他玩家加入...';
        }
    }

    // ==================== 客户端渲染循环 ====================

    /**
     * 启动客户端渲染循环
     */
    startClientRenderLoop() {
        const renderLoop = () => {
            // 游戏不在运行时，停止渲染
            if (this.gameState !== 'running') {
                return;
            }

            const state = this.network ? this.network.getServerState() : null;
            if (state) {
                this.renderServerState(state);
                this.draw();
            }

            if (this.gameState === 'running') {
                this.animationId = requestAnimationFrame(renderLoop);
            }
        };

        if (!this.animationId) {
            this.animationId = requestAnimationFrame(renderLoop);
        }
    }

    // ==================== 渲染服务器状态 ====================

    /**
     * 渲染服务器发送的游戏状态
     * @param {Object} state - 服务器游戏状态对象
     */
    renderServerState(state) {
        if (!state) {
            return;
        }

        // 更新基础状态
        this.score1 = state.score1;
        this.score2 = state.score2;
        this.lives1 = state.lives1;
        this.lives2 = state.lives2;
        this.kills1 = state.kills1 ? { ...state.kills1 } : this.kills1;
        this.kills2 = state.kills2 ? { ...state.kills2 } : this.kills2;
        this.level = state.level;
        this.gameState = state.gameState;
        this.waterAnimTimer = state.waterAnimTimer || 0;

        // 更新敌人数量统计
        this.enemiesKilled = state.enemiesKilled || 0;
        this.totalEnemiesToSpawn = state.totalEnemiesToSpawn || 0;

        // 更新地图
        if (state.map) {
            this.map = state.map;
        }
        if (state.mapName) {
            this.mapName = state.mapName;
            this.mapDescription = state.mapDescription || '';
        }

        // 更新玩家1
        if (state.player1) {
            const p = state.player1;
            if (!this.player1) {
                this.player1 = new Tank(p.x, p.y, p.direction, true, 1, p.tankClass);
            }
            // 当服务端标记为击晕且之前未击晕时，重置本地闪烁计时器
            if (p.isStunned && !this.player1.isStunned) {
                this.player1.stunnedTimer = 0;
            }
            Object.assign(this.player1, {
                x: p.x,
                y: p.y,
                direction: p.direction,
                health: p.health,
                maxHealth: p.maxHealth,
                active: p.active,
                isSpawning: p.isSpawning,
                isStunned: p.isStunned,
                baseSpeed: p.baseSpeed,
                bulletSpeed: p.bulletSpeed,
                bulletDamage: p.bulletDamage,
                shootDelay: p.shootDelay,
                bulletCount: p.bulletCount,
                tankClass: p.tankClass,
                shootCooldown: p.shootCooldown
            });
        }

        // 更新玩家2
        if (state.player2) {
            const p = state.player2;
            if (!this.player2) {
                this.player2 = new Tank(p.x, p.y, p.direction, true, 2, p.tankClass);
            }
            // 当服务端标记为击晕且之前未击晕时，重置本地闪烁计时器
            if (p.isStunned && !this.player2.isStunned) {
                this.player2.stunnedTimer = 0;
            }
            Object.assign(this.player2, {
                x: p.x,
                y: p.y,
                direction: p.direction,
                health: p.health,
                maxHealth: p.maxHealth,
                active: p.active,
                isSpawning: p.isSpawning,
                isStunned: p.isStunned,
                baseSpeed: p.baseSpeed,
                bulletSpeed: p.bulletSpeed,
                bulletDamage: p.bulletDamage,
                shootDelay: p.shootDelay,
                bulletCount: p.bulletCount,
                tankClass: p.tankClass,
                shootCooldown: p.shootCooldown
            });
        }

        // 更新敌人
        if (state.enemies) {
            this.enemies = state.enemies.map(eData => {
                let enemy = this.enemies.find(e => e.x === eData.x && e.y === eData.y && e.tankClass === eData.tankClass);
                if (!enemy) {
                    enemy = new Tank(eData.x, eData.y, eData.direction, false, 0, eData.tankClass || 0);
                }
                // 当服务端标记为击晕且之前未击晕时，重置本地闪烁计时器
                if (eData.isStunned && !enemy.isStunned) {
                    enemy.flashTimer = 0;
                }
                Object.assign(enemy, {
                    health: eData.health,
                    maxHealth: eData.maxHealth,
                    active: eData.active,
                    isSpawning: eData.isSpawning,
                    isStunned: eData.isStunned,
                    baseSpeed: eData.baseSpeed,
                    bulletSpeed: eData.bulletSpeed,
                    bulletDamage: eData.bulletDamage,
                    shootDelay: eData.shootDelay,
                    bulletCount: eData.bulletCount,
                    tankClass: eData.tankClass,
                    direction: eData.direction,
                    x: eData.x,
                    y: eData.y,
                    shootCooldown: eData.shootCooldown
                });
                return enemy;
            });
        }

        // 更新子弹
        if (state.bullets) {
            this.bullets = state.bullets.map(bData => {
                const bullet = new Bullet(bData.x, bData.y, bData.direction, bData.owner, bData.damage, bData.size);
                bullet.active = bData.active;
                return bullet;
            });
        }

        // 更新道具
        if (state.powerUps) {
            this.powerUps = state.powerUps.map(pData => {
                const pu = new PowerUp(pData.x, pData.y, pData.type);
                pu.active = pData.active;
                pu.lifetime = pData.lifetime;
                return pu;
            });
        }

        // 进入下一关
        if (state.gameState === 'level_transition') {
            const levelCompleteOverlay = document.getElementById('levelCompleteOverlay');
            if (levelCompleteOverlay) {
                levelCompleteOverlay.classList.add('active');
            }
        }


        this.updateUI();
    }

    /**
     * 应用服务器状态（用于游戏结束时）
     * @param {Object} state - 游戏状态对象
     */
    applyServerState(state) {
        if (!state) return;
        this.score1 = state.score1;
        this.score2 = state.score2;
        this.lives1 = state.lives1;
        this.lives2 = state.lives2;
        this.kills1 = state.kills1 ? { ...state.kills1 } : this.kills1;
        this.kills2 = state.kills2 ? { ...state.kills2 } : this.kills2;
        this.level = state.level;
        this.gameState = state.gameState;
        if (state.map) this.map = state.map;
        this.updateUI();
    }

    // ==================== 事件监听 ====================

    /**
     * 设置键盘和按钮事件监听器
     */
    setupEventListeners() {
        // 键盘按下事件
        document.addEventListener('keydown', (e) => {
            // 发送按键到服务器
            if (this.gameState === 'running' && this.network && this.network.connected) {
                this.network.sendKeyDown(e.code);
            }

            // P键暂停（房间内任意玩家均可触发）
            if (e.code === 'KeyP' && this.gameState !== 'menu') {
                this.togglePauseResume();
            }

            // V键切换敌人属性弹窗
            if (e.code === 'KeyV') {
                console.log('[Input] KeyV pressed, gameState:', this.gameState);
                this.toggleEnemyInfoPopup();
            }

            // 阻止默认行为
            if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash'].includes(e.code)) {
                e.preventDefault();
            }
        });

        // 键盘抬起按键
        document.addEventListener('keyup', (e) => {
            if (this.gameState === 'running' && this.network && this.network.connected) {
                this.network.sendKeyUp(e.code);
            }
        });

        // 暂停/恢复 按钮
        const pauseBtn = document.getElementById('pauseResumeBtn');
        if (pauseBtn) {
            pauseBtn.addEventListener('click', () => this.togglePauseResume());
        }

        // 退出游戏 按钮
        const exitBtn = document.getElementById('exitGameBtn');
        if (exitBtn) {
            exitBtn.addEventListener('click', () => this.exitGame());
        }

        // 下一关按钮：通关后点击立即进入下一关，不用等待时间
        const nextLevelBtn = document.getElementById('nextLevelBtn');
        if (nextLevelBtn) {
            nextLevelBtn.addEventListener('click', () => this.toNextLevel());
        }

        /*****************************************************************
         * 房间面板
         ****************************************************************/
        // 创建房间按钮
        const createRoomBtn = document.getElementById('createRoomBtn');
        if (createRoomBtn) {
            createRoomBtn.onclick = () => {
                if (!this.network) {
                    console.error('[Renderer] 网络模块未加载');
                    return;
                }
                this.network.createRoom();
            };
        }

        // 房间码输入框
        const roomCodeInput = document.getElementById('roomCodeInput');
        if (roomCodeInput) {
            roomCodeInput.addEventListener('keydown', (e) => {
                if (e.code === 'Enter') {
                    joinRoomBtn.click();
                }
            });
        }

        // 加入房间按钮
        const joinRoomBtn = document.getElementById('joinRoomBtn');
        if (joinRoomBtn) {
            joinRoomBtn.onclick = () => {
                if (!this.network) {
                    console.error('[Renderer] 网络模块未加载');
                    return;
                }
                const code = roomCodeInput ? roomCodeInput.value.trim() : '';
                if (code.length !== 4 || !/^\d{4}$/.test(code)) {
                    console.error('[Renderer] 请输入4位数字房间码');
                    return;
                }
                this.network.joinRoom(code);
            };
        }

        /*********************************************************
         * 等待玩家加入面板
         *********************************************************/
        // 开始游戏按钮
        const startGameBtn = document.getElementById('startGameBtn');
        if (startGameBtn) {
            startGameBtn.onclick = () => this.startGame();
        }

        // 退出房间按钮
        const leaveRoomBtn = document.getElementById('leaveRoomBtn');
        if (leaveRoomBtn) {
            leaveRoomBtn.onclick = () => {
                if (this.network) {
                    this.network.leaveRoom();
                }
                this.isHost = false;
                this.isTwoPlayer = false;
                this.gameState = 'menu';
                this.showPopMenu();
            };
        }

    }


    // ==================== 菜单和状态管理 ====================
    /**
     * 显示弹出菜单
     * @param {string} title - 标题
     * @param {string} message - 消息内容
     * @param {number} type - 弹窗类型 0：显示创建/加入房间相关的按钮
     *                                 1：主机创建房间成功后显示的按钮
     *                                 2：客户端加入房间后显示的按钮
     *                                 3：游戏结束后显示的按钮
     */
    showPopMenu(title, message, type) {
        document.getElementById('overlayTitle').textContent = title;
        document.getElementById('overlayMessage').textContent = message;


        // 房间面板：创建/加入房间
        const roomPanel = document.getElementById('roomPanel');
        // 等待用户加入房间面板
        const waitingPanel = document.getElementById('waitingPanel');
        // 开始按钮
        const startBtn = document.getElementById('startGameBtn');
        // 退出房间按钮
        const leaveRoomBtn = document.getElementById('leaveRoomBtn');
        switch (type) {
            case 0: // // 显示房间管理面板&&隐藏其它
                if (roomPanel) {
                    roomPanel.classList.remove('hidden');
                    roomPanel.classList.add('visible');
                }
                if (waitingPanel) {
                    waitingPanel.classList.remove('visible');
                    waitingPanel.classList.add('hidden');

                }
                break;
            case 1: // 主机创建房间成功后显示的按钮
                if (roomPanel) {
                    roomPanel.classList.remove('visible');
                    roomPanel.classList.add('hidden');
                }
                if (waitingPanel) {
                    waitingPanel.classList.remove('hidden');
                    waitingPanel.classList.add('visible');
                    // 显示开始游戏按钮
                    if (startBtn) {
                        startBtn.classList.remove('hidden');
                        startBtn.classList.add('visible');
                    }
                    // 显示退出房间按钮
                    if (leaveRoomBtn) {
                        leaveRoomBtn.classList.remove('hidden');
                        leaveRoomBtn.classList.add('visible');
                    }
                }
                break;
            case 2: // 客户端加入房间后显示的按钮
                if (roomPanel) {
                    roomPanel.classList.remove('visible');
                    roomPanel.classList.add('hidden');
                }
                if (waitingPanel) {
                    waitingPanel.classList.remove('hidden');
                    waitingPanel.classList.add('visible');
                }
                break;
            case 3: // 游戏结束显示的按钮
                break;
        }


        // 显示游戏菜单弹窗
        const overlay = document.getElementById('gameOverlay');
        if (overlay) {
            overlay.classList.add('active');
        }
    }

    /**
     * 隐藏弹出菜单
     */
    hidePopMenu() {
        // 弹窗菜单
        const gameOverlay = document.getElementById('gameOverlay');
        if (gameOverlay) {
            gameOverlay.classList.remove('active');
        }
        // 隐藏等待游戏开始面板
        const waitingPanel = document.getElementById('waitingPanel');
        if (waitingPanel) {
            waitingPanel.classList.remove('visible');
            waitingPanel.classList.add('hidden');
        }
    }

    /**
    * 开始游戏
    */
    startGame() {
        if (this.network && this.network.isHost()) {
            this.network.startGame();
        }
    }
    /**
     * 切换游戏暂停/继续状态
     */
    togglePauseResume() {
        if (!this.network || !this.network.connected || !this.network.roomCode) {
            console.error('[Renderer] 请先创建或加入房间');
            return;
        }

        if (this.gameState === 'running') {
            this.network.sendPause();
        } else if (this.gameState === 'paused') {
            this.network.sendResume();
        }
    }

    /**
     * 切换敌人属性弹窗显示
     */
    toggleEnemyInfoPopup() {
        const popup = document.getElementById('enemyInfoPopup');
        if (!popup) {
            return;
        }
        popup.classList.toggle('hidden');

        // 更新敌人属性数据（根据当前关卡等级计算）
        if (!popup.classList.contains('hidden') && GAME_CONFIG) {
            const level = this.level || 1;
            const levelMultiplier = 1 + (level - 1) * GAME_CONFIG.levelMultiplier;

            const types = ['light', 'normal', 'heavy'];
            types.forEach(type => {
                const config = GAME_CONFIG.enemies[type];
                if (!config) {
                    return;
                }
                const suffix = type.charAt(0).toUpperCase() + type.slice(1);
                const hpEl = document.getElementById(`enemyHp${suffix}`);
                const speedEl = document.getElementById(`enemySpeed${suffix}`);
                const bulletEl = document.getElementById(`enemyBullet${suffix}`);
                const dmgEl = document.getElementById(`enemyDmg${suffix}`);
                if (hpEl) {
                    hpEl.textContent = config.maxHealth.toFixed(0);
                }
                if (speedEl) {
                    speedEl.textContent = (config.baseSpeed * levelMultiplier).toFixed(0);
                }
                if (bulletEl) {
                    bulletEl.textContent = config.bulletSpeed.toFixed(0);
                }
                if (dmgEl) {
                    dmgEl.textContent = config.bulletDamage.toFixed(0);
                }
            });
        }
    }

    /**
     * 更新侧边栏按钮可见性（根据游戏状态）
     */
    updateButtonVisibility() {
        const pauseResumeBtn = document.getElementById('pauseResumeBtn');
        const exitGameBtn = document.getElementById('exitGameBtn');

        const isPlaying = this.gameState === 'running' || this.gameState === 'paused';
        if (isPlaying) {
            pauseResumeBtn.classList.remove('hidden');
            pauseResumeBtn.classList.add('visible');
            exitGameBtn.classList.remove('hidden');
            exitGameBtn.classList.add('visible');
        } else {
            pauseResumeBtn.classList.remove('visible');
            pauseResumeBtn.classList.add('hidden');
            exitGameBtn.classList.remove('visible');
            exitGameBtn.classList.add('hidden');
        }

        if (this.gameState === 'paused') {
            pauseResumeBtn.textContent = '继续';
        } else {
            pauseResumeBtn.textContent = '暂停';
        }
    }

    /**
     * 退出游戏，返回菜单
     */
    exitGame() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        this.player1 = null;
        this.player2 = null;
        this.enemies = [];
        this.bullets = [];
        this.powerUps = [];
        this.map = [];
        this.showPopMenu();
    }

    /**
     * 跳过关卡过度等待时间，进入下一关
     */
    toNextLevel() {
        // 通知服务器用户已点击下一关按钮
        if (this.network && this.network.isHost()) {
            this.network.nextLevel();
        }
        // 隐藏关卡完成面板
        const overlay = document.getElementById('levelCompleteOverlay');
        if (overlay) {
            overlay.classList.remove('active');
        }
    }

    /**
     * 主动结束游戏
     */
    setGameOver() {
        this.gameState = 'gameover';
        cancelAnimationFrame(this.animationId);
        this.animationId = null;
        this.updateButtonVisibility();
        const message = this.score1 > 0 ? `最终得分: ${this.score1}` : '游戏结束';
        this.showPopMenu('游戏结束', message);
    }

    /**
     * 显示地图名称和描述消息
     * @param {string} text - 地图名称
     * @param {string} description - 地图描述
     */
    showMessage(text, description) {
        this.mapName = text;
        this.mapDescription = description;
    }

    // ==================== UI 更新 ====================

    /**
     * UI更新入口函数，调用各个子模块的更新方法
     */
    updateUI() {
        this.updateLevelInfo();
        this.updatePlayerStats(1);
        this.updatePlayerStats(2);
    }

    /**
     * 更新关卡信息显示
     */
    updateLevelInfo() {
        document.getElementById('level').textContent = this.level;
        document.getElementById('enemyCount').textContent =
            Math.max(0, (this.totalEnemiesToSpawn || 0) - (this.enemiesKilled || 0));

        if (GAME_CONFIG) {
            const levelMultiplier = 1 + (this.level - 1) * GAME_CONFIG.levelMultiplier;
            const lightSpeed = GAME_CONFIG.enemies.light.baseSpeed;
            const normalSpeed = GAME_CONFIG.enemies.normal.baseSpeed;
            const heavySpeed = GAME_CONFIG.enemies.heavy.baseSpeed;
            document.getElementById('enemySpeedLight').textContent = (lightSpeed * levelMultiplier).toFixed(0);
            document.getElementById('enemySpeedNormal').textContent = (normalSpeed * levelMultiplier).toFixed(0);
            document.getElementById('enemySpeedHeavy').textContent = (heavySpeed * levelMultiplier).toFixed(0);
        }
    }

    /**
     * 更新指定玩家的状态信息
     * @param {number} playerId - 玩家ID（1或2）
     */
    updatePlayerStats(playerId) {
        const player = playerId === 1 ? this.player1 : this.player2;
        const playerStats = document.getElementById(`player${playerId}Stats`);

        // 如果是玩家2，根据isTwoPlayer决定是否显示
        if (playerId === 2) {
            if (this.isTwoPlayer) {
                playerStats.classList.remove('hidden');
            } else {
                playerStats.classList.add('hidden');
                return;
            }
        }

        // 更新分数
        const scoreEl = document.getElementById(`score${playerId}`);
        if (scoreEl) {
            scoreEl.textContent = playerId === 1 ? this.score1 : this.score2;
        }

        // 更新玩家数据
        if (player) {
            // 速度
            const speedEl = document.getElementById(`speed${playerId}`);
            if (speedEl) speedEl.textContent = player.baseSpeed ? player.baseSpeed.toFixed(0) : '0';

            // 生命值
            if (player.maxHealth && player.health !== undefined) {
                const hpPercent = (player.health / player.maxHealth) * 100;
                const hpFill = document.getElementById(`hpFill${playerId}`);
                const hpText = document.getElementById(`hpText${playerId}`);
                if (hpFill) hpFill.style.width = hpPercent + '%';
                if (hpText) hpText.textContent = `${player.health.toFixed(0)}/${player.maxHealth.toFixed(0)}`;
            }

            // 炮弹速度
            const bulletSpeedEl = document.getElementById(`bulletSpeed${playerId}`);
            if (bulletSpeedEl) bulletSpeedEl.textContent = player.bulletSpeed ? player.bulletSpeed.toFixed(0) : '0';

            // 炮弹伤害
            const bulletDamageEl = document.getElementById(`bulletDamage${playerId}`);
            if (bulletDamageEl) bulletDamageEl.textContent = player.bulletDamage ? player.bulletDamage.toFixed(0) : '0';

            // 炮弹数量
            const bulletCountEl = document.getElementById(`bulletCount${playerId}`);
            if (bulletCountEl) bulletCountEl.textContent = player.bulletCount || 0;

            // 冷却时间
            this.updateCooldownDisplay(playerId);
        }

        // 击杀统计
        const kills = playerId === 1 ? this.kills1 : this.kills2;
        const killsStats = document.getElementById(`kills${playerId}Stats`);
        if (killsStats) {
            killsStats.innerHTML =
                `<span class="kill-type"><span class="kill-type-icon light"></span>${kills.light}</span> ` +
                `<span class="kill-type"><span class="kill-type-icon normal"></span>${kills.normal}</span> ` +
                `<span class="kill-type"><span class="kill-type-icon heavy"></span>${kills.heavy}</span> ` +
                `<span class="kill-type">总:${kills.total}</span>`;
        }

        // 生命图标
        const lives = playerId === 1 ? this.lives1 : this.lives2;
        const livesDisplay = document.getElementById(`lives${playerId}Display`);
        if (livesDisplay) {
            livesDisplay.innerHTML = '';
            for (let i = 0; i < this.maxLives; i++) {
                const lifeIcon = document.createElement('span');
                const playerClass = playerId === 1 ? 'p1' : 'p2';
                lifeIcon.className = 'life-icon ' + (i < lives ? playerClass : 'lost');
                livesDisplay.appendChild(lifeIcon);
            }
        }
    }

    /**
     * 更新玩家的冷却时间显示
     * @param {number} playerId - 玩家ID（1或2）
     */
    updateCooldownDisplay(playerId) {
        const player = playerId === 1 ? this.player1 : this.player2;
        if (!player || !player.shootDelay) {
            return;
        }
        // 本地递减冷却时间(用于UI平滑显示)
        if (player.shootCooldown > 0) {
            player.shootCooldown = Math.max(0, player.shootCooldown - 1);
        }

        // 更新UI显示
        const cooldownEl = document.getElementById(`cooldown${playerId}`);
        if (cooldownEl) {
            if (player.shootCooldown > 0) {
                cooldownEl.textContent = (player.shootCooldown / 60).toFixed(1) + 's';
                cooldownEl.classList.remove('ready');
            } else {
                cooldownEl.textContent = '就绪';
                cooldownEl.classList.add('ready');
            }
        }
    }

    // ==================== 渲染地图 ====================

    /**
     * 绘制地图（砖块、钢铁、水、基地等）
     */
    drawMap() {
        if (!this.map || this.map.length === 0) return;

        for (let y = 0; y < MAP_HEIGHT; y++) {
            for (let x = 0; x < MAP_WIDTH; x++) {
                const tile = this.map[y] ? this.map[y][x] : TILE_TYPES.EMPTY;
                const px = x * TILE_SIZE;
                const py = y * TILE_SIZE;

                switch (tile) {
                    case TILE_TYPES.BRICK: this.drawBrick(px, py); break;
                    case TILE_TYPES.STEEL: this.drawSteel(px, py); break;
                    case TILE_TYPES.WATER: this.drawWater(px, py); break;
                    case TILE_TYPES.BASE: this.drawBase(px, py, false); break;
                    case TILE_TYPES.BASE_DESTROYED: this.drawBase(px, py, true); break;
                }
            }
        }
    }

    /**
     * 绘制砖块瓦片
     * @param {number} px - X坐标（像素）
     * @param {number} py - Y坐标（像素）
     */
    drawBrick(px, py) {
        ctx.fillStyle = '#c06030';
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        ctx.fillStyle = '#a04820';
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                const bx = px + j * 8;
                const by = py + i * 8;
                ctx.fillRect(bx, by + 4, 8, 4);
                ctx.fillRect(bx + 4, by, 4, 4);
            }
        }
        ctx.fillStyle = '#e08050';
        ctx.fillRect(px, py, TILE_SIZE, 1);
        for (let i = 0; i < 4; i++) {
            ctx.fillRect(px, py + i * 8, TILE_SIZE, 1);
        }
    }

    /**
     * 绘制钢铁瓦片
     * @param {number} px - X坐标（像素）
     * @param {number} py - Y坐标（像素）
     */
    drawSteel(px, py) {
        ctx.fillStyle = '#808080';
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        ctx.fillStyle = '#c0c0c0';
        ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
        ctx.fillStyle = '#e0e0e0';
        ctx.fillRect(px + 4, py + 4, TILE_SIZE - 12, TILE_SIZE - 12);
        ctx.fillRect(px + TILE_SIZE - 10, py + 4, 6, 6);
        ctx.fillRect(px + 4, py + TILE_SIZE - 10, 6, 6);
        ctx.fillStyle = '#606060';
        ctx.fillRect(px, py + TILE_SIZE - 2, TILE_SIZE, 2);
        ctx.fillRect(px + TILE_SIZE - 2, py, 2, TILE_SIZE);
    }

    /**
     * 绘制水瓦片（带动画效果）
     * @param {number} px - X坐标（像素）
     * @param {number} py - Y坐标（像素）
     */
    drawWater(px, py) {
        ctx.fillStyle = '#0000a0';
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        const waveOffset = Math.floor(this.waterAnimTimer / 8) % 4;
        ctx.fillStyle = '#0000c0';
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                const wx = px + j * 8 + ((i + waveOffset) % 2) * 4;
                const wy = py + i * 8;
                ctx.fillRect(wx, wy, 4, 4);
            }
        }
    }

    /**
     * 绘制基地（正常或摧毁状态）
     * @param {number} px - X坐标（像素）
     * @param {number} py - Y坐标（像素）
     * @param {boolean} destroyed - 是否已摧毁
     */
    drawBase(px, py, destroyed) {
        if (destroyed) {
            ctx.fillStyle = '#404040';
            ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
            ctx.fillStyle = '#202020';
            ctx.fillRect(px + 4, py + 4, TILE_SIZE - 8, TILE_SIZE - 8);
        } else {
            ctx.fillStyle = '#c0c0c0';
            ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
            ctx.fillStyle = '#f0f0f0';
            ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);

            ctx.fillStyle = '#e00000';
            const cx = px + TILE_SIZE / 2;
            const cy = py + TILE_SIZE / 2;
            const outerRadius = TILE_SIZE / 2 - 4;
            const innerRadius = outerRadius * 0.4;

            ctx.beginPath();
            for (let i = 0; i < 5; i++) {
                const outerAngle = (i * 72 - 90) * Math.PI / 180;
                const innerAngle = ((i * 72) + 36 - 90) * Math.PI / 180;
                if (i === 0) {
                    ctx.moveTo(cx + outerRadius * Math.cos(outerAngle), cy + outerRadius * Math.sin(outerAngle));
                } else {
                    ctx.lineTo(cx + outerRadius * Math.cos(outerAngle), cy + outerRadius * Math.sin(outerAngle));
                }
                ctx.lineTo(cx + innerRadius * Math.cos(innerAngle), cy + innerRadius * Math.sin(innerAngle));
            }
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = '#ff4040';
            ctx.beginPath();
            const highlightRadius = outerRadius * 0.3;
            for (let i = 0; i < 5; i++) {
                const outerAngle = (i * 72 - 90) * Math.PI / 180;
                const innerAngle = ((i * 72) + 36 - 90) * Math.PI / 180;
                if (i === 0) {
                    ctx.moveTo(cx + highlightRadius * Math.cos(outerAngle), cy + highlightRadius * Math.sin(outerAngle));
                } else {
                    ctx.lineTo(cx + highlightRadius * Math.cos(outerAngle), cy + highlightRadius * Math.sin(outerAngle));
                }
                ctx.lineTo(cx + (innerRadius * 0.5) * Math.cos(innerAngle), cy + (innerRadius * 0.5) * Math.sin(innerAngle));
            }
            ctx.closePath();
            ctx.fill();
        }
    }

    /**
     * 绘制草地瓦片（在所有对象之上渲染）
     */
    drawGrass() {
        if (!this.map || this.map.length === 0) return;
        for (let y = 0; y < MAP_HEIGHT; y++) {
            for (let x = 0; x < MAP_WIDTH; x++) {
                if (this.map[y] && this.map[y][x] === TILE_TYPES.GRASS) {
                    const px = x * TILE_SIZE;
                    const py = y * TILE_SIZE;
                    ctx.fillStyle = '#00a000';
                    ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
                    ctx.fillStyle = '#008000';
                    for (let i = 0; i < 8; i++) {
                        for (let j = 0; j < 8; j++) {
                            if ((i + j) % 2 === 0) {
                                ctx.fillRect(px + j * 4, py + i * 4, 4, 4);
                            }
                        }
                    }
                }
            }
        }
    }

    // ==================== 主绘制函数 ====================

    /**
     * 主绘制函数，渲染整个游戏画面
     */
    draw() {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        this.drawMap();

        ctx.fillStyle = '#f0f0f0';
        ctx.font = 'bold 14px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';

        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(4, 4, canvas.width - 8, this.mapDescription ? 44 : 22);

        ctx.fillStyle = '#f0f0f0';
        ctx.fillText(this.mapName, 8, 8);

        if (this.messageTimer > 0) {
            this.messageTimer--;
            const alpha = Math.min(1, this.messageTimer / 60);
            ctx.fillStyle = `rgba(240, 240, 240, ${alpha})`;
            ctx.font = '12px monospace';

            if (this.mapDescription.length > 40) {
                const line1 = this.mapDescription.substring(0, 40);
                const line2 = this.mapDescription.substring(40);
                ctx.fillText(line1, 8, 26);
                ctx.fillText(line2, 8, 42);
            } else {
                ctx.fillText(this.mapDescription, 8, 26);
            }
        }

        this.bullets.forEach(bullet => bullet.draw());
        this.powerUps.forEach(powerUp => powerUp.draw());

        if (this.player1 && this.player1.active) this.player1.draw();
        if (this.player2 && this.player2.active) this.player2.draw();

        this.enemies.forEach(enemy => {
            if (enemy.active && !enemy.isSpawning) enemy.draw();
        });

        this.drawGrass();
    }
}

// ==================== 创建渲染器实例 ====================
const renderer = new Renderer();
