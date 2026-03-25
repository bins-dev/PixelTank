/**
 * 坦克大战 - 服务器端共享常量
 * 这些常量与客户端完全一致，确保服务器和客户端使用相同的数值标准
 */

// 缩放比例：内部数值放大10000倍，渲染时除以此值
const SCALE = 10000;
// 地图瓦片大小（像素）
const TILE_SIZE = 32;
// 地图宽度（瓦片数）
const MAP_WIDTH = 26;
// 地图高度（瓦片数）
const MAP_HEIGHT = 26;
// 画布宽度（像素）
const CANVAS_WIDTH = MAP_WIDTH * TILE_SIZE;  // 832
// 画布高度（像素）
const CANVAS_HEIGHT = MAP_HEIGHT * TILE_SIZE; // 832

// 方向枚举
const DIRECTIONS = {
    UP: 0,
    RIGHT: 1,
    DOWN: 2,
    LEFT: 3
};

// 瓦片类型枚举
const TILE_TYPES = {
    EMPTY: 0,
    BRICK: 1,
    STEEL: 2,
    WATER: 3,
    GRASS: 4,
    BASE: 5,
    BASE_DESTROYED: 6
};

// 服务器 tick 率
const SERVER_TICK_RATE = 60; // 60 FPS
const SERVER_TICK_INTERVAL = 1000 / SERVER_TICK_RATE;

// 状态同步间隔（帧数）- 每2帧同步一次
const STATE_SYNC_INTERVAL = 2;

module.exports = {
    SCALE,
    TILE_SIZE,
    MAP_WIDTH,
    MAP_HEIGHT,
    CANVAS_WIDTH,
    CANVAS_HEIGHT,
    DIRECTIONS,
    TILE_TYPES,
    SERVER_TICK_RATE,
    SERVER_TICK_INTERVAL,
    STATE_SYNC_INTERVAL
};
