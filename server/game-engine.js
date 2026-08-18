/**
 * 坦克大战 - 服务器端游戏引擎
 * 
 * 包含完整的坦克大战游戏逻辑：
 * - Tank、Bullet、PowerUp 类
 * - 游戏状态更新、碰撞检测、AI
 * - 地图生成
 * 
 * 无 DOM 依赖，纯 Node.js 可运行
 */

const { SCALE, TILE_SIZE, MAP_WIDTH, MAP_HEIGHT, CANVAS_WIDTH, CANVAS_HEIGHT, DIRECTIONS, TILE_TYPES } = require('./constants');
const fs = require('fs');
const path = require('path');

// ==================== 加载游戏配置 ====================
const configPath = path.join(__dirname, 'game-config.json');
const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// 从配置文件读取游戏配置（排除 maps 字段）
const GAME_CONFIG = {
    levelCompleteDelay: configData.levelCompleteDelay,
    player: configData.player,
    enemies: configData.enemies,
    levelMultiplier: configData.levelMultiplier,
    powerUps: configData.powerUps
};

// 地图索引：{ 1: 'level1.json', 2: 'level2.json', ... }
const MAP_INDEX = {};
if (configData.maps) {
    for (const mapEntry of configData.maps) {
        MAP_INDEX[mapEntry.id] = mapEntry.file;
    }
}

// 地图缓存（懒加载）
const mapsCache = {};

/**
 * 加载指定关卡的地图数据
 */
function loadMapData(level) {
    if (mapsCache[level]) {
        return mapsCache[level];
    }

    const mapFile = MAP_INDEX[level];
    if (!mapFile) {
        // 如果没有配置该关卡地图，返回空
        return null;
    }

    const mapPath = path.join(__dirname, 'maps', mapFile);
    try {
        const mapData = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
        mapsCache[level] = mapData;
        return mapData;
    } catch (e) {
        console.error(`加载地图失败 level=${level}: ${e.message}`);
        return null;
    }
}

// ==================== 道具类 ====================

/**
 * 道具类 - 表示游戏中的增益道具
 * @class
 */
class PowerUp {
    /**
     * 创建道具实例
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     * @param {string} type - 道具类型
     */
    constructor(x, y, type) {
        this.x = x;
        this.y = y;
        this.size = TILE_SIZE * SCALE;
        this.type = type;
        this.active = true;

        const config = GAME_CONFIG.powerUps;
        this.lifetime = config.lifetime;

        const tc = config.types[type];
        this.name = tc ? tc.name : type;
        this.color = tc ? tc.color : '#4080ff';
        this.multiplier = tc ? tc.multiplier : 0.1;
        this.calcType = tc ? tc.calcType : 'percent';
        this.fixedValue = tc ? tc.fixedValue : 0;
        this.symbol = tc ? tc.symbol : (this.calcType === 'percent' ? 'S' : 'S+');
    }

    /**
     * 更新道具状态（生命周期递减）
     */
    update() {
        this.lifetime--;
        if (this.lifetime <= 0) {
            this.active = false;
        }
    }

    /**
     * 将道具效果应用到坦克
     * @param {Tank} tank - 坦克对象
     */
    applyTo(tank) {
        if (!this.active) return;

        const isSpeed = this.type === 'speed' || this.type === 'speedFixed';
        const isDamage = this.type === 'damage' || this.type === 'damageFixed';
        const isBulletSpeed = this.type === 'bulletSpeed' || this.type === 'bulletSpeedFixed';
        const isHeal = this.type === 'heal' || this.type === 'healFixed';
        const isCooldown = this.type === 'cooldown' || this.type === 'cooldownFixed';

        if (isSpeed) {
            let bonus = this.calcType === 'percent' ? tank.initialBaseSpeed * this.multiplier : this.fixedValue;
            tank.baseSpeed = tank.baseSpeed + bonus;
            tank.speed = tank.baseSpeed;
        } else if (isDamage) {
            let bonus = this.calcType === 'percent' ? tank.initialBulletDamage * this.multiplier : this.fixedValue;
            tank.bulletDamage = tank.bulletDamage + bonus;
        } else if (isBulletSpeed) {
            let bonus = this.calcType === 'percent' ? tank.initialBulletSpeed * this.multiplier : this.fixedValue;
            tank.bulletSpeed = tank.bulletSpeed + bonus;
        } else if (isHeal) {
            let healAmount = this.calcType === 'percent' ? tank.maxHealth * this.multiplier : this.fixedValue;
            tank.health = Math.min(tank.maxHealth, tank.health + healAmount);
        } else if (isCooldown) {
            let reduction = this.calcType === 'percent' ? tank.initialShootDelay * this.multiplier : this.fixedValue;
            tank.shootDelay = Math.max(30, tank.shootDelay - reduction);
        }

        this.active = false;
    }

    /**
     * 序列化道具数据（用于网络传输）
     * @returns {Object} 序列化后的数据
     */
    serialize() {
        return { x: this.x, y: this.y, type: this.type, active: this.active, lifetime: this.lifetime };
    }
}

// ==================== 子弹类 ====================

/**
 * 子弹类 - 表示游戏中的子弹实体
 * @class
 */
class Bullet {
    /**
     * 创建子弹实例
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     * @param {number} direction - 方向
     * @param {string} owner - 所有者
     * @param {number} damage - 伤害值
     * @param {number} size - 子弹大小
     */
    constructor(x, y, direction, owner, damage = 40000, size = 40000) {
        this.x = x;
        this.y = y;
        this.direction = direction;
        this.speed = 60000;
        this.size = size;
        this.damage = damage;
        this.owner = owner;
        this.active = true;
    }

    /**
     * 更新子弹位置
     */
    update() {
        switch (this.direction) {
            case DIRECTIONS.UP: this.y -= this.speed; break;
            case DIRECTIONS.RIGHT: this.x += this.speed; break;
            case DIRECTIONS.DOWN: this.y += this.speed; break;
            case DIRECTIONS.LEFT: this.x -= this.speed; break;
        }

        if (this.x < 0 || this.x > CANVAS_WIDTH * SCALE ||
            this.y < 0 || this.y > CANVAS_HEIGHT * SCALE) {
            this.active = false;
        }
    }

    /**
     * 序列化子弹数据
     * @returns {Object} 序列化后的数据
     */
    serialize() {
        return { x: this.x, y: this.y, direction: this.direction, speed: this.speed, size: this.size, damage: this.damage, owner: this.owner, active: this.active };
    }
}

// ==================== 坦克类 ====================

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
     * @param {number} playerId - 玩家ID
     * @param {number} tankClass - 坦克等级
     * @param {number} level - 关卡等级
     */
    constructor(x, y, direction, isPlayer = false, playerId = 1, tankClass = 0, level = 1) {
        this.x = x;
        this.y = y;
        this.direction = direction;
        this.isPlayer = isPlayer;
        this.playerId = playerId;
        this.size = (TILE_SIZE - 2) * SCALE;
        this.tankClass = tankClass;
        this.level = level;

        if (isPlayer) {
            const config = GAME_CONFIG.player;
            this.baseSpeed = config.baseSpeed;
            this.maxHealth = config.maxHealth;
            this.health = this.maxHealth;
            this.bulletSpeed = config.bulletSpeed;
            this.bulletDamage = config.bulletDamage;
            this.bulletSize = config.bulletSize;
            this.bulletCount = config.bulletCount;
            this.shootDelay = config.shootCooldown;
        } else {
            const levelMultiplier = 1 + (level - 1) * GAME_CONFIG.levelMultiplier;
            const enemyTypes = ['light', 'normal', 'heavy'];
            const enemyType = enemyTypes[tankClass] || 'normal';
            const config = GAME_CONFIG.enemies[enemyType];

            this.baseSpeed = config.baseSpeed * levelMultiplier;
            this.maxHealth = config.maxHealth;
            this.health = this.maxHealth;
            this.bulletSpeed = config.bulletSpeed;
            this.bulletDamage = config.bulletDamage;
            this.bulletSize = config.bulletSize;
            this.bulletCount = Infinity;
            this.shootDelay = config.shootCooldown;
        }

        this.speed = this.baseSpeed;
        this.active = true;
        this.shootCooldown = 0;
        this.moveTimer = 0;
        this.aiDirectionTimer = 0;
        this.trackOffset = 0;
        this.isSpawning = true;
        this.spawnTimer = 0;
        this.isStunned = false;
        this.stunTimer = 0;
        this.stunDuration = 120;

        this.initialBaseSpeed = this.baseSpeed;
        this.initialBulletDamage = this.bulletDamage;
        this.initialBulletSpeed = this.bulletSpeed;
        this.initialShootDelay = this.shootDelay;
        this.initialMaxHealth = this.maxHealth;
        this.speedBonusCount = 0;
        this.damageBonusCount = 0;
        this.bulletSpeedBonusCount = 0;
        this.cooldownBonusCount = 0;
    }

    /**
     * 更新坦克状态（处理输入或AI）
     * @param {Object} keys - 按键状态
     * @param {Array} keyQueue - 按键队列
     * @param {Array} bullets - 子弹数组
     * @param {Array} map - 地图数据
     * @param {Array} otherTanks - 其他坦克数组
     */
    update(keys, keyQueue, bullets, map, otherTanks) {
        if (!this.active) return;

        if (this.isSpawning) {
            this.spawnTimer++;
            if (this.spawnTimer > 60) {
                this.isSpawning = false;
            }
            return;
        }

        if (this.isStunned) {
            this.stunTimer--;
            if (this.stunTimer <= 0) {
                this.isStunned = false;
            }
            // 击晕时也要递减冷却时间
            this.shootCooldown = Math.max(0, this.shootCooldown - 1);
            return;
        }

        this.shootCooldown = Math.max(0, this.shootCooldown - 1);

        if (this.isPlayer) {
            this.handlePlayerInput(keys, keyQueue, bullets, map, otherTanks);
        } else {
            this.handleAI(bullets, map, otherTanks);
        }

        this.trackOffset = (this.trackOffset + 1) % 4;
    }

    /**
     * 击晕坦克
     */
    stun() {
        this.isStunned = true;
        this.stunTimer = this.stunDuration;
    }

    /**
     * 处理玩家输入
     */
    handlePlayerInput(keys, keyQueue, bullets, map, otherTanks) {
        let newX = this.x;
        let newY = this.y;
        let newDirection = this.direction;

        // 所有玩家统一使用 WASD + Space 控制
        const moveKeys = ['KeyW', 'KeyS', 'KeyA', 'KeyD'];
        let lastKey = null;
        for (let i = keyQueue.length - 1; i >= 0; i--) {
            if (moveKeys.includes(keyQueue[i]) && keys[keyQueue[i]]) {
                lastKey = keyQueue[i];
                break;
            }
        }

        if (lastKey === 'KeyW') { newDirection = DIRECTIONS.UP; newY -= this.speed; }
        else if (lastKey === 'KeyS') { newDirection = DIRECTIONS.DOWN; newY += this.speed; }
        else if (lastKey === 'KeyA') { newDirection = DIRECTIONS.LEFT; newX -= this.speed; }
        else if (lastKey === 'KeyD') { newDirection = DIRECTIONS.RIGHT; newX += this.speed; }

        this.direction = newDirection;

        if (this.canMove(newX, newY, map, otherTanks)) {
            this.x = newX; this.y = newY;
        } else if (this.canMove(newX, this.y, map, otherTanks)) {
            this.x = newX;
        } else if (this.canMove(this.x, newY, map, otherTanks)) {
            this.y = newY;
        }

        if (keyQueue.includes('Space') && keys['Space'] && this.shootCooldown <= 0) {
            this.shoot(bullets);
        }
    }

    /**
     * 处理AI逻辑
     */
    handleAI(bullets, map, otherTanks) {
        this.aiDirectionTimer++;

        if (this.aiDirectionTimer > 60 + Math.random() * 120) {
            this.aiDirectionTimer = 0;
            const directions = [DIRECTIONS.UP, DIRECTIONS.RIGHT, DIRECTIONS.DOWN, DIRECTIONS.LEFT];
            if (Math.random() < 0.3) {
                this.direction = directions[Math.floor(Math.random() * directions.length)];
            }
        }

        let newX = this.x;
        let newY = this.y;

        switch (this.direction) {
            case DIRECTIONS.UP: newY -= this.speed; break;
            case DIRECTIONS.RIGHT: newX += this.speed; break;
            case DIRECTIONS.DOWN: newY += this.speed; break;
            case DIRECTIONS.LEFT: newX -= this.speed; break;
        }

        if (this.canMove(newX, newY, map, otherTanks)) {
            this.x = newX; this.y = newY;
        } else {
            const directions = [DIRECTIONS.UP, DIRECTIONS.RIGHT, DIRECTIONS.DOWN, DIRECTIONS.LEFT];
            this.direction = directions[Math.floor(Math.random() * directions.length)];
        }

        if (this.shootCooldown <= 0 && Math.random() < 0.02) {
            this.shoot(bullets);
        }
    }

    /**
     * 检查坦克是否可以移动到指定位置
     * @param {number} newX - 新X坐标
     * @param {number} newY - 新Y坐标
     * @param {Array} map - 地图数据
     * @param {Array} otherTanks - 其他坦克数组
     * @returns {boolean} 是否可以移动
     */
    canMove(newX, newY, map, otherTanks = []) {
        const margin = 2 * SCALE;

        if (newX < 0 || newX + this.size > CANVAS_WIDTH * SCALE ||
            newY < 0 || newY + this.size > CANVAS_HEIGHT * SCALE) {
            return false;
        }

        const checkPoints = [
            { x: newX + margin, y: newY + margin },
            { x: newX + this.size - margin - SCALE, y: newY + margin },
            { x: newX + margin, y: newY + this.size - margin - SCALE },
            { x: newX + this.size - margin - SCALE, y: newY + this.size - margin - SCALE }
        ];

        for (let point of checkPoints) {
            const tileX = Math.floor(point.x / (TILE_SIZE * SCALE));
            const tileY = Math.floor(point.y / (TILE_SIZE * SCALE));

            if (tileX >= 0 && tileX < MAP_WIDTH && tileY >= 0 && tileY < MAP_HEIGHT) {
                const tile = map[tileY][tileX];
                if (tile === TILE_TYPES.BRICK || tile === TILE_TYPES.STEEL ||
                    tile === TILE_TYPES.WATER || tile === TILE_TYPES.BASE ||
                    tile === TILE_TYPES.BASE_DESTROYED) {
                    return false;
                }
            }
        }

        for (let tank of otherTanks) {
            if (tank && tank.active && tank !== this && !tank.isSpawning) {
                if (newX < tank.x + tank.size &&
                    newX + this.size > tank.x &&
                    newY < tank.y + tank.size &&
                    newY + this.size > tank.y) {
                    return false;
                }
            }
        }

        return true;
    }

    /**
     * 发射子弹
     * @param {Array} bullets - 子弹数组
     */
    shoot(bullets) {
        if (this.shootCooldown > 0) return;
        if (this.bulletCount <= 0) return;

        let bulletX = this.x + this.size / 2;
        let bulletY = this.y + this.size / 2;

        switch (this.direction) {
            case DIRECTIONS.UP: bulletY = this.y - 2 * SCALE; break;
            case DIRECTIONS.RIGHT: bulletX = this.x + this.size + 2 * SCALE; break;
            case DIRECTIONS.DOWN: bulletY = this.y + this.size + 2 * SCALE; break;
            case DIRECTIONS.LEFT: bulletX = this.x - 2 * SCALE; break;
        }

        let owner = 'enemy';
        if (this.isPlayer) {
            owner = this.playerId === 1 ? 'player1' : 'player2';
        }

        const bullet = new Bullet(bulletX, bulletY, this.direction, owner, this.bulletDamage, this.bulletSize);
        bullet.speed = this.bulletSpeed;
        bullets.push(bullet);
        this.shootCooldown = this.shootDelay;

        if (this.isPlayer) {
            this.bulletCount--;
        }
    }

    /**
     * 坦克受到伤害
     * @param {number} damage - 伤害值
     * @returns {boolean} 是否被击毁
     */
    hit(damage = 40000) {
        this.health -= damage;
        if (this.health <= 0) {
            this.health = 0;
            this.active = false;
            return true;
        }
        return false;
    }

    /**
     * 序列化坦克数据
     * @returns {Object} 序列化后的数据
     */
    serialize() {
        const data = {
            x: this.x,
            y: this.y,
            direction: this.direction,
            health: this.health,
            maxHealth: this.maxHealth,
            active: this.active,
            isSpawning: this.isSpawning,
            isStunned: this.isStunned,
            baseSpeed: this.baseSpeed,
            bulletSpeed: this.bulletSpeed,
            bulletDamage: this.bulletDamage,
            shootDelay: this.shootDelay,
            bulletCount: this.bulletCount,
            tankClass: this.tankClass,
            playerId: this.playerId,
            shootCooldown: this.shootCooldown
        };
        return data;
    }
}

// ==================== 游戏引擎类 ====================

/**
 * 游戏引擎类 - 管理整个游戏逻辑和状态
 * @class
 */
class GameEngine {
    /**
     * 创建游戏引擎实例
     * @param {number} level - 关卡等级
     * @param {Object} mapData - 地图数据
     * @param {Function} onStateChange - 状态变更回调
     */
    constructor(level = 1, mapData = null, onStateChange = null) {
        this.level = level;
        this.onStateChange = onStateChange; // callback(newState)

        this.keys = {};
        this.keyQueue = [];

        // 分玩家的按键状态（网络模式下每个玩家独立按键）
        this.player1Keys = {};
        this.player1KeyQueue = [];
        this.player2Keys = {};
        this.player2KeyQueue = [];

        this.player1 = null;
        this.player2 = null;
        this.isTwoPlayer = false;

        this.enemies = [];
        this.bullets = [];
        this.powerUps = [];

        this.score1 = 0;
        this.score2 = 0;
        this.lives1 = 3;
        this.lives2 = 3;
        this.maxLives = 6;
        this.lastBonusScore1 = 0;
        this.lastBonusScore2 = 0;

        this.kills1 = { light: 0, normal: 0, heavy: 0, total: 0 };
        this.kills2 = { light: 0, normal: 0, heavy: 0, total: 0 };

        this.gameState = 'menu';
        this.levelComplete = false;
        this.levelCompleteTimer = 0;

        this.enemiesKilled = 0;
        this.maxEnemies = 4;
        this.spawnTimer = 0;
        this.totalEnemiesToSpawn = 0;
        this.enemiesSpawned = 0;

        this.basePositions = [];
        this.waterAnimTimer = 0;

        this.player1PowerUpBonuses = null;
        this.player2PowerUpBonuses = null;

        this.baseX = Math.floor(MAP_WIDTH / 2);
        this.baseY = MAP_HEIGHT - 2;
        this.levelEnemyCount = 5;

        this.map = [];
        this.mapName = '';
        this.mapDescription = '';

        if (mapData) {
            this.mapsCache = { [level]: mapData };
        } else {
            this.mapsCache = {};
        }
    }

    // ==================== 地图生成 ====================

    /**
     * 获取默认地图数据
     * @param {number} level - 关卡等级
     * @returns {Object|null} 地图数据
     */
    getDefaultMap(level) {
        return loadMapData(level);
    }

    /**
     * 应用关卡地图障碍物
     * @param {Array} obstacles - 障碍物数组
     */
    applyLevelMap(obstacles) {
        obstacles.forEach(obs => {
            for (let dy = 0; dy < obs.h; dy++) {
                for (let dx = 0; dx < obs.w; dx++) {
                    const tx = obs.x + dx;
                    const ty = obs.y + dy;
                    if (tx >= 0 && tx < MAP_WIDTH && ty >= 0 && ty < MAP_HEIGHT) {
                        this.map[ty][tx] = obs.type;
                    }
                }
            }
        });
    }

    /**
     * 生成地图
     * @param {boolean} enableRandomObstacles - 是否启用随机障碍物
     */
    generateMap(enableRandomObstacles = false) {
        this.map = [];
        for (let y = 0; y < MAP_HEIGHT; y++) {
            this.map[y] = [];
            for (let x = 0; x < MAP_WIDTH; x++) {
                this.map[y][x] = TILE_TYPES.EMPTY;
            }
        }

        let mapData = this.mapsCache[this.level];
        if (!mapData) {
            mapData = this.getDefaultMap(this.level);
        }

        // 如果加载失败，使用默认fallback
        if (!mapData) {
            mapData = {
                obstacles: [],
                enemyCount: 5,
                name: '关卡 ' + this.level,
                description: ''
            };
        }

        this.mapName = mapData.name || ('关卡 ' + this.level);
        this.mapDescription = mapData.description || '';
        this.levelEnemyCount = mapData.enemyCount || 5;

        this.applyLevelMap(mapData.obstacles || []);

        this.basePositions = [];
        for (let y = 0; y < MAP_HEIGHT; y++) {
            for (let x = 0; x < MAP_WIDTH; x++) {
                if (this.map[y][x] === TILE_TYPES.BASE) {
                    this.basePositions.push({ x, y });
                }
            }
        }

        if (this.basePositions.length > 0) {
            this.baseX = this.basePositions[0].x;
            this.baseY = this.basePositions[0].y;
        } else {
            this.baseX = Math.floor(MAP_WIDTH / 2);
            this.baseY = MAP_HEIGHT - 2;
            this.map[this.baseY][this.baseX - 1] = TILE_TYPES.BASE;
            this.map[this.baseY][this.baseX] = TILE_TYPES.BASE;
            this.basePositions = [
                { x: this.baseX - 1, y: this.baseY },
                { x: this.baseX, y: this.baseY }
            ];

            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -2; dx <= 1; dx++) {
                    const tx = this.baseX + dx;
                    const ty = this.baseY + dy;
                    if (tx >= 0 && tx < MAP_WIDTH && ty >= 0 && ty < MAP_HEIGHT) {
                        if ((dx === -1 || dx === 0) && dy === 0) continue;
                        if (this.map[ty][tx] === TILE_TYPES.EMPTY) {
                            this.map[ty][tx] = TILE_TYPES.BRICK;
                        }
                    }
                }
            }
        }

        if (!enableRandomObstacles) return;

        const player1SpawnX = this.baseX - 4;
        const player1SpawnY = this.baseY;
        const player2SpawnX = this.baseX + 4;
        const player2SpawnY = this.baseY;

        for (let i = 0; i < 10 + this.level * 3; i++) {
            const x = Math.floor(Math.random() * MAP_WIDTH);
            const y = Math.floor(Math.random() * (MAP_HEIGHT - 5));

            if (this.map[y][x] === TILE_TYPES.EMPTY &&
                !(x >= this.baseX - 2 && x <= this.baseX + 1 && y >= this.baseY - 1) &&
                !(x >= player1SpawnX - 2 && x <= player1SpawnX + 2 && y >= player1SpawnY - 1 && y <= player1SpawnY + 1) &&
                !(x >= player2SpawnX - 2 && x <= player2SpawnX + 2 && y >= player2SpawnY - 1 && y <= player2SpawnY + 1)) {
                const rand = Math.random();
                if (rand < 0.5) {
                    this.map[y][x] = TILE_TYPES.BRICK;
                } else if (rand < 0.7) {
                    this.map[y][x] = TILE_TYPES.GRASS;
                } else if (rand < 0.85) {
                    this.map[y][x] = TILE_TYPES.WATER;
                } else {
                    this.map[y][x] = TILE_TYPES.STEEL;
                }
            }
        }
    }

    // ==================== 初始化 ====================

    /**
     * 初始化游戏（重置状态、创建玩家等）
     */
    init() {
        // 重置按键状态
        this.keys = {};
        this.keyQueue = [];
        this.player1Keys = {};
        this.player1KeyQueue = [];
        this.player2Keys = {};
        this.player2KeyQueue = [];

        const player1X = (this.baseX - 4) * TILE_SIZE * SCALE;
        const player1Y = this.baseY * TILE_SIZE * SCALE;
        this.player1 = new Tank(player1X, player1Y, DIRECTIONS.UP, true, 1);
        if (this.player1PowerUpBonuses) {
            this.player1.baseSpeed = this.player1PowerUpBonuses.baseSpeed;
            this.player1.speed = this.player1.baseSpeed;
            this.player1.bulletDamage = this.player1PowerUpBonuses.bulletDamage;
            this.player1.bulletSpeed = this.player1PowerUpBonuses.bulletSpeed;
            this.player1.shootDelay = this.player1PowerUpBonuses.shootDelay;
        }

        if (this.isTwoPlayer) {
            const player2X = (this.baseX + 3) * TILE_SIZE * SCALE;
            const player2Y = this.baseY * TILE_SIZE * SCALE;
            this.player2 = new Tank(player2X, player2Y, DIRECTIONS.UP, true, 2);
            if (this.player2PowerUpBonuses) {
                this.player2.baseSpeed = this.player2PowerUpBonuses.baseSpeed;
                this.player2.speed = this.player2.baseSpeed;
                this.player2.bulletDamage = this.player2PowerUpBonuses.bulletDamage;
                this.player2.bulletSpeed = this.player2PowerUpBonuses.bulletSpeed;
                this.player2.shootDelay = this.player2PowerUpBonuses.shootDelay;
            }
        } else {
            this.player2 = null;
        }

        this.enemies = [];
        this.bullets = [];
        this.powerUps = [];
        this.enemiesKilled = 0;
        this.enemiesSpawned = 0;
        this.spawnTimer = 0;
        this.totalEnemiesToSpawn = this.levelEnemyCount || 5;
        this.levelComplete = false;
        this.levelCompleteTimer = 0;
    }

    /**
     * 开始游戏
     */
    start() {
        if (this.gameState === 'stopped' || this.gameState === 'gameover' || this.gameState === 'menu') {
            this.gameState = 'running';
        }
    }

    /**
     * 进入下一关卡
     */
    toNextLevel() {
        this.levelComplete = false;
        this.levelCompleteTimer = 0;
        if (this.player1) {
            this.player1PowerUpBonuses = {
                baseSpeed: this.player1.baseSpeed,
                bulletDamage: this.player1.bulletDamage,
                bulletSpeed: this.player1.bulletSpeed,
                shootDelay: this.player1.shootDelay
            };
        }
        if (this.player2) {
            this.player2PowerUpBonuses = {
                baseSpeed: this.player2.baseSpeed,
                bulletDamage: this.player2.bulletDamage,
                bulletSpeed: this.player2.bulletSpeed,
                shootDelay: this.player2.shootDelay
            };
        }

        this.level++;
        this.generateMap();
        this.init();
        this.gameState = 'running';
    }

    // ==================== 敌人生成 ====================

    /**
     * 生成敌人坦克
     */
    spawnEnemy() {
        if (this.enemiesSpawned >= this.totalEnemiesToSpawn) return;
        if (this.enemies.length >= this.maxEnemies) return;

        const spawnPoints = [
            { x: TILE_SIZE * SCALE, y: TILE_SIZE * SCALE },
            { x: CANVAS_WIDTH / 2 * SCALE - TILE_SIZE * SCALE / 2, y: TILE_SIZE * SCALE },
            { x: (CANVAS_WIDTH - TILE_SIZE * 2) * SCALE, y: TILE_SIZE * SCALE }
        ];

        let availableSpawns = [];

        for (let spawn of spawnPoints) {
            let canSpawn = true;
            const allTanks = [];
            if (this.player1 && this.player1.active) allTanks.push(this.player1);
            if (this.player2 && this.player2.active) allTanks.push(this.player2);
            this.enemies.forEach(enemy => { if (enemy.active) allTanks.push(enemy); });

            for (let tank of allTanks) {
                if (this.checkCollision(
                    { x: spawn.x, y: spawn.y, size: (TILE_SIZE - 2) * SCALE },
                    { x: tank.x, y: tank.y, size: tank.size }
                )) {
                    canSpawn = false;
                    break;
                }
            }

            if (canSpawn) availableSpawns.push(spawn);
        }

        if (availableSpawns.length > 0) {
            const spawn = availableSpawns[Math.floor(Math.random() * availableSpawns.length)];
            const tankClassWeights = [0, 0, 0, 1, 1, 2, 2, 2];
            const tankClass = tankClassWeights[Math.floor(Math.random() * tankClassWeights.length)];
            const enemy = new Tank(spawn.x, spawn.y, DIRECTIONS.DOWN, false, 0, tankClass, this.level);
            this.enemies.push(enemy);
            this.enemiesSpawned++;
        }
    }

    // ==================== 碰撞检测 ====================

    /**
     * 检查两个对象是否碰撞
     * @param {Object} a - 对象A
     * @param {Object} b - 对象B
     * @returns {boolean} 是否碰撞
     */
    checkCollision(a, b) {
        return a.x < b.x + b.size &&
            a.x + a.size > b.x &&
            a.y < b.y + b.size &&
            a.y + a.size > b.y;
    }

    /**
     * 尝试生成道具
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     */
    trySpawnPowerUp(x, y) {
        const config = GAME_CONFIG.powerUps;
        const spawnChance = config.spawnChance;

        if (Math.random() < spawnChance) {
            const types = ['speed', 'damage', 'bulletSpeed', 'speedFixed', 'damageFixed', 'bulletSpeedFixed', 'heal', 'healFixed', 'cooldown', 'cooldownFixed'];
            const type = types[Math.floor(Math.random() * types.length)];
            this.powerUps.push(new PowerUp(x, y, type));
        }
    }

    /**
     * 检查道具碰撞
     */
    checkPowerUpCollisions() {
        this.powerUps.forEach(powerUp => {
            if (!powerUp.active) return;

            if (this.player1 && this.player1.active && !this.player1.isSpawning && this.checkCollision(
                { x: powerUp.x, y: powerUp.y, size: powerUp.size },
                { x: this.player1.x, y: this.player1.y, size: this.player1.size }
            )) {
                powerUp.applyTo(this.player1);
            }

            if (this.player2 && this.player2.active && !this.player2.isSpawning && this.checkCollision(
                { x: powerUp.x, y: powerUp.y, size: powerUp.size },
                { x: this.player2.x, y: this.player2.y, size: this.player2.size }
            )) {
                powerUp.applyTo(this.player2);
            }

            this.enemies.forEach(enemy => {
                if (enemy.active && !enemy.isSpawning && this.checkCollision(
                    { x: powerUp.x, y: powerUp.y, size: powerUp.size },
                    { x: enemy.x, y: enemy.y, size: enemy.size }
                )) {
                    powerUp.applyTo(enemy);
                }
            });
        });

        this.powerUps = this.powerUps.filter(pu => pu.active);
    }

    // ==================== 主更新循环 ====================

    /**
     * 游戏主更新循环（每帧调用）
     */
    update() {
        // level_transition 状态下仍需继续更新（倒计时进入下一关）
        if (this.gameState !== 'running' && this.gameState !== 'level_transition') {
            return;
        }

        this.waterAnimTimer++;

        const allTanks = [];
        if (this.player1 && this.player1.active) {
            allTanks.push(this.player1);
        }
        if (this.player2 && this.player2.active) {
            allTanks.push(this.player2);
        }
        this.enemies.forEach(enemy => { if (enemy.active) allTanks.push(enemy); });

        // 更新玩家（使用分玩家的按键状态）
        if (this.player1 && this.player1.active) {
            this.player1.update(this.player1Keys, this.player1KeyQueue, this.bullets, this.map, allTanks);
        }
        if (this.player2 && this.player2.active) {
            this.player2.update(this.player2Keys, this.player2KeyQueue, this.bullets, this.map, allTanks);
        }

        // 更新敌人
        this.enemies.forEach(enemy => {
            enemy.update(this.keys, this.keyQueue, this.bullets, this.map, allTanks);
        });

        // 更新子弹
        this.bullets.forEach(bullet => bullet.update());

        // 更新道具
        this.powerUps.forEach(powerUp => powerUp.update());

        // 移除不活跃的
        this.bullets = this.bullets.filter(b => b.active);
        this.enemies = this.enemies.filter(e => e.active);

        // 碰撞检测
        this.checkBulletCollisions();
        this.checkPowerUpCollisions();

        // 敌人生成
        if (!this.levelComplete) {
            this.spawnTimer++;
            if (this.spawnTimer > 150) {
                this.spawnTimer = 0;
                this.spawnEnemy();
            }
        }

        // 通关检测
        if (this.enemiesKilled >= this.totalEnemiesToSpawn && this.enemies.length === 0 && !this.levelComplete) {
            this.levelComplete = true;
            this.levelCompleteTimer = GAME_CONFIG.levelCompleteDelay * 60;
        }

        if (this.levelComplete) {
            this.gameState = 'level_transition';
            this.levelCompleteTimer--;
            if (this.levelCompleteTimer <= 0) {
                this.toNextLevel();
            }
        }

        // 触发状态变更回调
        if (this.onStateChange) {
            this.onStateChange(this.getGameState());
        }
    }

    /**
     * 暂停游戏
     */
    pause() {
        if (this.gameState === 'running') {
            this.gameState = 'paused';
            console.log('[GameEngine] 游戏已暂停');
        }
    }

    /**
     * 继续游戏
     */
    resume() {
        if (this.gameState === 'paused') {
            this.gameState = 'running';
            console.log('[GameEngine] 游戏已继续');
        }
    }

    // ==================== 子弹碰撞 ====================

    /**
     * 检查子弹碰撞（地图、坦克、子弹互撞）
     */
    checkBulletCollisions() {
        this.bullets.forEach(bullet => {
            if (!bullet.active) return;

            const tileX = Math.floor(bullet.x / (TILE_SIZE * SCALE));
            const tileY = Math.floor(bullet.y / (TILE_SIZE * SCALE));

            if (tileX >= 0 && tileX < MAP_WIDTH && tileY >= 0 && tileY < MAP_HEIGHT) {
                const tile = this.map[tileY][tileX];

                if (tile === TILE_TYPES.BRICK) {
                    this.map[tileY][tileX] = TILE_TYPES.EMPTY;
                    bullet.active = false;
                } else if (tile === TILE_TYPES.STEEL) {
                    bullet.active = false;
                } else if (tile === TILE_TYPES.BASE) {
                    this.map[tileY][tileX] = TILE_TYPES.BASE_DESTROYED;
                    bullet.active = false;

                    let hasRemainingBase = false;
                    for (const pos of this.basePositions) {
                        if (this.map[pos.y][pos.x] === TILE_TYPES.BASE) {
                            hasRemainingBase = true;
                            break;
                        }
                    }
                    if (!hasRemainingBase) {
                        this.gameOver();
                    }
                }
            }

            // 玩家子弹 vs 敌人
            if (bullet.owner === 'player1' || bullet.owner === 'player2') {
                this.enemies.forEach(enemy => {
                    if (enemy.active && !enemy.isSpawning && !enemy.isStunned && this.checkCollision(
                        { x: bullet.x - bullet.size, y: bullet.y - bullet.size, size: bullet.size * 2 },
                        { x: enemy.x, y: enemy.y, size: enemy.size }
                    )) {
                        bullet.active = false;
                        if (enemy.hit(bullet.damage)) {
                            const points = 100 + enemy.tankClass * 50;
                            const killTypes = ['light', 'normal', 'heavy'];
                            const killType = killTypes[enemy.tankClass];
                            if (bullet.owner === 'player1') {
                                this.score1 += points;
                                this.kills1[killType]++;
                                this.kills1.total++;
                                this.checkExtraLife(1);
                            } else {
                                this.score2 += points;
                                this.kills2[killType]++;
                                this.kills2.total++;
                                this.checkExtraLife(2);
                            }
                            this.enemiesKilled++;
                            this.trySpawnPowerUp(enemy.x, enemy.y);
                        }
                    }
                });

                // 双人模式友军伤害（仅击晕）
                if (this.isTwoPlayer) {
                    if (bullet.owner === 'player1' && this.player2 && this.player2.active && !this.player2.isSpawning && this.checkCollision(
                        { x: bullet.x - bullet.size, y: bullet.y - bullet.size, size: bullet.size * 2 },
                        { x: this.player2.x, y: this.player2.y, size: this.player2.size }
                    )) {
                        bullet.active = false;
                        this.player2.stun();
                    }
                    if (bullet.owner === 'player2' && this.player1 && this.player1.active && !this.player1.isSpawning && this.checkCollision(
                        { x: bullet.x - bullet.size, y: bullet.y - bullet.size, size: bullet.size * 2 },
                        { x: this.player1.x, y: this.player1.y, size: this.player1.size }
                    )) {
                        bullet.active = false;
                        this.player1.stun();
                    }
                }
            } else {
                // 敌人子弹 vs 玩家
                if (this.player1 && this.player1.active && !this.player1.isSpawning && this.checkCollision(
                    { x: bullet.x - bullet.size, y: bullet.y - bullet.size, size: bullet.size * 2 },
                    { x: this.player1.x, y: this.player1.y, size: this.player1.size }
                )) {
                    bullet.active = false;
                    this.playerHit(1, bullet.damage);
                }
                if (this.player2 && this.player2.active && !this.player2.isSpawning && this.checkCollision(
                    { x: bullet.x - bullet.size, y: bullet.y - bullet.size, size: bullet.size * 2 },
                    { x: this.player2.x, y: this.player2.y, size: this.player2.size }
                )) {
                    bullet.active = false;
                    this.playerHit(2, bullet.damage);
                }
            }
        });

        // 子弹互撞
        this.bullets.forEach((bullet1, i) => {
            if (!bullet1.active) return;
            for (let j = i + 1; j < this.bullets.length; j++) {
                const bullet2 = this.bullets[j];
                if (!bullet2.active) continue;

                if (bullet1.owner !== bullet2.owner) {
                    const dx = bullet1.x - bullet2.x;
                    const dy = bullet1.y - bullet2.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);

                    if (distance < bullet1.size + bullet2.size) {
                        bullet1.active = false;
                        bullet2.active = false;
                        break;
                    }
                }
            }
        });
    }

    /**
     * 检查是否给予额外生命
     * @param {number} playerId - 玩家ID
     */
    checkExtraLife(playerId) {
        if (playerId === 1) {
            const bonusLives = Math.floor(this.score1 / 1000) - this.lastBonusScore1;
            if (bonusLives > 0 && this.lives1 < this.maxLives) {
                this.lives1 = Math.min(this.lives1 + bonusLives, this.maxLives);
                this.lastBonusScore1 = Math.floor(this.score1 / 1000);
            }
        } else if (playerId === 2) {
            const bonusLives = Math.floor(this.score2 / 1000) - this.lastBonusScore2;
            if (bonusLives > 0 && this.lives2 < this.maxLives) {
                this.lives2 = Math.min(this.lives2 + bonusLives, this.maxLives);
                this.lastBonusScore2 = Math.floor(this.score2 / 1000);
            }
        }
    }

    /**
     * 玩家受到伤害
     * @param {number} playerId - 玩家ID
     * @param {number} damage - 伤害值
     */
    playerHit(playerId, damage = 40000) {
        if (playerId === 1) {
            if (this.player1.hit(damage)) {
                // 玩家死亡
                this.lives1--;
                if (this.lives1 <= 0) {
                    this.player1.active = false;
                    this.checkGameOver();
                } else {
                    const px = (this.baseX - 4) * TILE_SIZE * SCALE;
                    const py = this.baseY * TILE_SIZE * SCALE;
                    this.player1 = new Tank(px, py, DIRECTIONS.UP, true, 1);
                }
            }
            // 玩家存活：只减血，不击晕
        } else if (playerId === 2) {
            if (this.player2.hit(damage)) {
                // 玩家死亡
                this.lives2--;
                if (this.lives2 <= 0) {
                    this.player2.active = false;
                    this.checkGameOver();
                } else {
                    const px = (this.baseX + 3) * TILE_SIZE * SCALE;
                    const py = this.baseY * TILE_SIZE * SCALE;
                    this.player2 = new Tank(px, py, DIRECTIONS.UP, true, 2);
                }
            }
            // 玩家存活：只减血，不击晕
        }
    }

    /**
     * 检查游戏是否结束
     */
    checkGameOver() {
        const p1Dead = !this.player1 || !this.player1.active || this.lives1 <= 0;
        const p2Dead = !this.isTwoPlayer || !this.player2 || !this.player2.active || this.lives2 <= 0;
        if (p1Dead && p2Dead) {
            this.gameOver();
        }
    }

    /**
     * 游戏结束处理
     */
    gameOver() {
        this.gameState = 'gameover';
        if (this.onStateChange) {
            this.onStateChange(this.getGameState());
        }
    }

    // ==================== 获取游戏状态（用于网络同步） ====================

    /**
     * 获取当前游戏状态（用于网络同步）
     * @returns {Object} 游戏状态对象
     */
    getGameState() {
        return {
            player1: this.player1 ? this.player1.serialize() : null,
            player2: this.player2 ? this.player2.serialize() : null,
            enemies: this.enemies.map(e => e.serialize()),
            bullets: this.bullets.map(b => b.serialize()),
            powerUps: this.powerUps.map(p => p.serialize()),
            score1: this.score1,
            score2: this.score2,
            lives1: this.lives1,
            lives2: this.lives2,
            kills1: { ...this.kills1 },
            kills2: { ...this.kills2 },
            level: this.level,
            map: this.map,
            mapName: this.mapName,
            mapDescription: this.mapDescription,
            enemiesKilled: this.enemiesKilled,
            totalEnemiesToSpawn: this.totalEnemiesToSpawn,
            enemiesSpawned: this.enemiesSpawned,
            levelComplete: this.levelComplete,
            levelCompleteTimer: this.levelCompleteTimer,
            gameState: this.gameState,
            waterAnimTimer: this.waterAnimTimer
        };
    }
}

module.exports = { GameEngine, Tank, Bullet, PowerUp, GAME_CONFIG, MAP_INDEX, TILE_TYPES, DIRECTIONS, SCALE, TILE_SIZE };
