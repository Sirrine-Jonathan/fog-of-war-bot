"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeneralsBot = void 0;
const socket_io_client_1 = __importDefault(require("socket.io-client"));
const utils_1 = require("./utils");
const dotenv = __importStar(require("dotenv"));
// Load environment variables from .env file
dotenv.config();
class GeneralsBot {
    constructor(serverUrl = 'https://fog-of-war-0f4f.onrender.com', gameId) {
        this.playerIndex = -1;
        this.generals = [];
        this.cities = [];
        this.map = [];
        this.lastMove = null;
        this.failedMoves = new Set();
        this.serverUrl = serverUrl;
        this.gameId = gameId;
        // Configure socket options for HTTPS connections
        const socketOptions = {
            transports: ['websocket', 'polling'],
            timeout: 20000,
        };
        // Add SSL options for HTTPS connections
        if (serverUrl.startsWith('https://')) {
            socketOptions.rejectUnauthorized = false; // Allow self-signed certificates
        }
        this.socket = (0, socket_io_client_1.default)(serverUrl, socketOptions);
        this.setupEventHandlers();
    }
    setupEventHandlers() {
        this.socket.on('connect', () => {
            console.log(`✅ Connected to server: ${this.serverUrl}`);
            const userId = process.env.BOT_USER_ID;
            if (!userId) {
                throw new Error('BOT_USER_ID environment variable is required');
            }
            console.log(`🤖 Setting username: userId=${userId}, username=${userId}`);
            this.socket.emit('set_username', userId, userId);
            if (this.gameId) {
                console.log(`🎮 Joining custom game: ${this.gameId}`);
                this.socket.emit('join_private', this.gameId, userId);
            }
            else {
                console.log('🎯 Joining 1v1 queue');
                this.socket.emit('join_1v1', userId);
            }
        });
        this.socket.on('game_start', (data) => {
            this.playerIndex = data.playerIndex;
            this.failedMoves.clear();
            console.log(`🎲 Game started! Player index: ${this.playerIndex}`);
        });
        this.socket.on('game_update', (data) => {
            const prevTiles = this.map.length > 0 ? this.parseMap().terrain.filter(t => t === this.playerIndex).length : 0;
            this.cities = (0, utils_1.patch)(this.cities, data.cities_diff);
            this.map = (0, utils_1.patch)(this.map, data.map_diff);
            this.generals = data.generals;
            const { width, height, armies, terrain } = this.parseMap();
            const myTiles = terrain.filter(t => t === this.playerIndex).length;
            const myArmies = armies.reduce((sum, army, i) => terrain[i] === this.playerIndex ? sum + army : sum, 0);
            // Check if last move failed
            if (this.lastMove && myTiles === prevTiles) {
                const moveKey = `${this.lastMove.from}-${this.lastMove.to}`;
                this.failedMoves.add(moveKey);
                console.log(`❌ Move failed, blacklisting: ${moveKey}`);
            }
            console.log(`📊 Update: ${myTiles} tiles, ${myArmies} armies`);
            this.makeMove();
        });
        this.socket.on('game_won', (data) => {
            console.log('🏆 Game ended - Winner:', data.winner);
            console.log('🔄 Resetting bot state for next game...');
            this.resetGameState();
            setTimeout(() => {
                if (this.gameId) {
                    console.log('🎮 Rejoining game room for next game...');
                    const userId = process.env.BOT_USER_ID;
                    this.socket.emit('join_private', this.gameId, userId);
                }
            }, 1000);
        });
        this.socket.on('game_lost', () => {
            console.log('💀 Defeat!');
            console.log('🔄 Resetting bot state for next game...');
            this.resetGameState();
            setTimeout(() => {
                if (this.gameId) {
                    console.log('🎮 Rejoining game room for next game...');
                    const userId = process.env.BOT_USER_ID;
                    this.socket.emit('join_private', this.gameId, userId);
                }
            }, 1000);
        });
        this.socket.on('disconnect', () => {
            console.log('❌ Disconnected from server');
        });
        this.socket.on('connect_error', (error) => {
            console.error('🚫 Connection error:', error);
        });
        this.socket.on('error', (error) => {
            console.error('⚠️ Socket error:', error);
        });
    }
    resetGameState() {
        this.playerIndex = -1;
        this.generals = [];
        this.cities = [];
        this.map = [];
        this.lastMove = null;
        this.failedMoves.clear();
        console.log('✅ Bot state reset complete');
    }
    makeMove() {
        const move = this.findBestMove();
        if (move) {
            const moveKey = `${move.from}-${move.to}`;
            if (this.failedMoves.has(moveKey)) {
                console.log(`🚫 Skipping failed move: ${move.from} → ${move.to}`);
                return;
            }
            console.log(`⚔️ Attacking: ${move.from} → ${move.to}`);
            this.lastMove = move;
            this.socket.emit('attack', move.from, move.to);
        }
        else {
            console.log(`🤔 No valid moves found`);
        }
    }
    findBestMove() {
        const { width, height, armies, terrain, towerDefense } = this.parseMap();
        if (!width || !height || armies.length === 0) {
            console.log(`❌ Invalid map data: ${width}x${height}, armies: ${armies.length}`);
            return null;
        }
        const gamePhase = this.getGamePhase();
        console.log(`🎯 Game phase: ${gamePhase}`);
        if (gamePhase === 'early') {
            return this.findExpansionMove(width, height, armies, terrain);
        }
        else if (gamePhase === 'mid') {
            return this.findCityHuntingMove(width, height, armies, terrain, towerDefense);
        }
        else {
            return this.findCombatMove(width, height, armies, terrain);
        }
    }
    getGamePhase() {
        const { terrain } = this.parseMap();
        const myTiles = terrain.filter(t => t === this.playerIndex).length;
        const enemyTiles = terrain.filter(t => t >= 0 && t !== this.playerIndex).length;
        if (myTiles < 15)
            return 'early'; // Rapid expansion phase
        if (enemyTiles === 0)
            return 'mid'; // City hunting phase
        return 'late'; // Combat phase
    }
    findExpansionMove(width, height, armies, terrain) {
        console.log(`🌱 Early game: rapid expansion`);
        // Find all expansion moves, prioritize by distance from general
        const moves = [];
        const generalPos = this.generals[this.playerIndex];
        for (let i = 0; i < terrain.length; i++) {
            if (terrain[i] === this.playerIndex && armies[i] > 1) {
                const adjacent = (0, utils_1.getAdjacentIndices)(i, width, height);
                for (const adj of adjacent) {
                    if (adj < 0 || adj >= terrain.length)
                        continue;
                    if (terrain[adj] !== -1)
                        continue; // Only expand to empty tiles
                    const moveKey = `${i}-${adj}`;
                    if (this.failedMoves.has(moveKey))
                        continue;
                    // Prioritize moves further from general for faster expansion
                    const distFromGeneral = this.getDistance(adj, generalPos, width);
                    moves.push({ from: i, to: adj, priority: distFromGeneral });
                }
            }
        }
        if (moves.length === 0)
            return null;
        moves.sort((a, b) => b.priority - a.priority);
        const bestMove = moves[0];
        console.log(`🎯 Expansion move: ${bestMove.from} → ${bestMove.to}`);
        return { from: bestMove.from, to: bestMove.to };
    }
    findCityHuntingMove(width, height, armies, terrain, towerDefense) {
        console.log(`🏙️ Mid game: hunting cities`);
        // First priority: attack cities directly
        for (let i = 0; i < terrain.length; i++) {
            if (terrain[i] === this.playerIndex && armies[i] > 1) {
                const adjacent = (0, utils_1.getAdjacentIndices)(i, width, height);
                for (const adj of adjacent) {
                    if (terrain[adj] === -6 && armies[i] > armies[adj] + 1) {
                        console.log(`🎯 Attacking city: ${i} → ${adj}`);
                        return { from: i, to: adj };
                    }
                }
            }
        }
        // Second priority: move towards nearest city
        const nearestCity = this.findNearestCity(width, height, terrain);
        if (nearestCity >= 0) {
            const moveTowardsCity = this.findMoveTowardsTarget(nearestCity, width, height, armies, terrain);
            if (moveTowardsCity) {
                console.log(`🎯 Moving towards city at ${nearestCity}: ${moveTowardsCity.from} → ${moveTowardsCity.to}`);
                return moveTowardsCity;
            }
        }
        // Fallback: continue expansion
        return this.findExpansionMove(width, height, armies, terrain);
    }
    findCombatMove(width, height, armies, terrain) {
        console.log(`⚔️ Late game: combat mode`);
        const enemyGeneral = this.findEnemyGeneral(terrain);
        const myStrength = this.calculateStrength(terrain, armies);
        const enemyStrength = this.calculateEnemyStrength(terrain, armies);
        console.log(`💪 Strength comparison: Me=${myStrength}, Enemy=${enemyStrength}`);
        if (myStrength < enemyStrength * 0.7) {
            // Defensive mode
            console.log(`🛡️ Playing defensively`);
            return this.findDefensiveMove(width, height, armies, terrain);
        }
        else {
            // Offensive mode
            console.log(`⚔️ Playing offensively`);
            if (enemyGeneral >= 0) {
                const attackMove = this.findMoveTowardsTarget(enemyGeneral, width, height, armies, terrain);
                if (attackMove)
                    return attackMove;
            }
            // Attack any enemy territory
            return this.findAttackMove(width, height, armies, terrain);
        }
    }
    findDefensiveMove(width, height, armies, terrain) {
        const generalPos = this.generals[this.playerIndex];
        // Move armies towards general for defense
        for (let i = 0; i < terrain.length; i++) {
            if (terrain[i] === this.playerIndex && armies[i] > 1) {
                const distToGeneral = this.getDistance(i, generalPos, width);
                if (distToGeneral > 2) { // If far from general
                    const adjacent = (0, utils_1.getAdjacentIndices)(i, width, height);
                    for (const adj of adjacent) {
                        if (terrain[adj] === this.playerIndex) {
                            const newDist = this.getDistance(adj, generalPos, width);
                            if (newDist < distToGeneral) {
                                console.log(`🛡️ Defensive retreat: ${i} → ${adj}`);
                                return { from: i, to: adj };
                            }
                        }
                    }
                }
            }
        }
        return null;
    }
    findAttackMove(width, height, armies, terrain) {
        for (let i = 0; i < terrain.length; i++) {
            if (terrain[i] === this.playerIndex && armies[i] > 1) {
                const adjacent = (0, utils_1.getAdjacentIndices)(i, width, height);
                for (const adj of adjacent) {
                    if (terrain[adj] >= 0 && terrain[adj] !== this.playerIndex && armies[i] > armies[adj] + 1) {
                        console.log(`⚔️ Attacking enemy: ${i} → ${adj}`);
                        return { from: i, to: adj };
                    }
                }
            }
        }
        return null;
    }
    findMoveTowardsTarget(target, width, height, armies, terrain) {
        let bestMove = null;
        let bestDistance = Infinity;
        for (let i = 0; i < terrain.length; i++) {
            if (terrain[i] === this.playerIndex && armies[i] > 1) {
                const adjacent = (0, utils_1.getAdjacentIndices)(i, width, height);
                for (const adj of adjacent) {
                    if (terrain[adj] === -1 || (terrain[adj] >= 0 && terrain[adj] !== this.playerIndex && armies[i] > armies[adj] + 1)) {
                        const distance = this.getDistance(adj, target, width);
                        if (distance < bestDistance) {
                            bestDistance = distance;
                            bestMove = { from: i, to: adj };
                        }
                    }
                }
            }
        }
        return bestMove;
    }
    findNearestCity(width, height, terrain) {
        const myTiles = terrain.map((t, i) => t === this.playerIndex ? i : -1).filter(i => i >= 0);
        if (myTiles.length === 0)
            return -1;
        let nearestCity = -1;
        let minDistance = Infinity;
        for (let i = 0; i < terrain.length; i++) {
            if (terrain[i] === -6) { // City
                for (const myTile of myTiles) {
                    const distance = this.getDistance(i, myTile, width);
                    if (distance < minDistance) {
                        minDistance = distance;
                        nearestCity = i;
                    }
                }
            }
        }
        return nearestCity;
    }
    findEnemyGeneral(terrain) {
        for (let i = 0; i < this.generals.length; i++) {
            if (i !== this.playerIndex && this.generals[i] >= 0) {
                return this.generals[i];
            }
        }
        return -1;
    }
    calculateStrength(terrain, armies) {
        return armies.reduce((sum, army, i) => terrain[i] === this.playerIndex ? sum + army : sum, 0);
    }
    calculateEnemyStrength(terrain, armies) {
        return armies.reduce((sum, army, i) => terrain[i] >= 0 && terrain[i] !== this.playerIndex ? sum + army : sum, 0);
    }
    getDistance(pos1, pos2, width) {
        const row1 = Math.floor(pos1 / width);
        const col1 = pos1 % width;
        const row2 = Math.floor(pos2 / width);
        const col2 = pos2 % width;
        return Math.abs(row1 - row2) + Math.abs(col1 - col2);
    }
    parseMap() {
        if (this.map.length < 2) {
            console.log(`❌ Map too short: ${this.map.length}`);
            return { width: 0, height: 0, armies: [], terrain: [], towerDefense: [] };
        }
        const width = this.map[0];
        const height = this.map[1];
        const size = width * height;
        if (this.map.length < size * 3 + 2) {
            console.log(`❌ Map data incomplete: expected ${size * 3 + 2}, got ${this.map.length}`);
            return { width: 0, height: 0, armies: [], terrain: [], towerDefense: [] };
        }
        const armies = this.map.slice(2, size + 2);
        const terrain = this.map.slice(size + 2, size * 2 + 2);
        const towerDefense = this.map.slice(size * 2 + 2, size * 3 + 2);
        return { width, height, armies, terrain, towerDefense };
    }
}
exports.GeneralsBot = GeneralsBot;
// Legacy CLI support - only run if this file is executed directly
if (require.main === module) {
    const args = process.argv.slice(2);
    const serverUrl = args.find(arg => arg.startsWith('--server='))?.split('=')[1] ||
        process.env.HOST ||
        'http://localhost:3001';
    const gameId = args.find(arg => arg.startsWith('--game='))?.split('=')[1] ||
        process.env.GAME_ID ||
        undefined;
    console.log('Starting bot with:');
    console.log('Server:', serverUrl);
    console.log('Game ID:', gameId || 'Auto-match');
    const bot = new GeneralsBot(serverUrl, gameId);
    process.stdin.on('data', () => {
        if (gameId) {
            console.log('🚀 Force starting game...');
            bot.socket.emit('set_force_start', gameId, true);
        }
    });
}
