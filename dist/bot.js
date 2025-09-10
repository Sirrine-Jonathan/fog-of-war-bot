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
        this.turnCount = 0;
        // Search & Destroy Strategy State
        this.knownEnemyGenerals = new Map(); // playerIndex -> position
        this.discoveredCities = new Set();
        this.discoveredTowers = new Set();
        this.expansionPhase = true; // First 25 turns
        this.targetGeneral = -1;
        this.armyGatheringTarget = -1;
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
            console.log(`Connected: ${this.serverUrl}`);
            const userId = process.env.BOT_USER_ID;
            if (!userId) {
                throw new Error('BOT_USER_ID environment variable is required');
            }
            this.socket.emit('set_username', userId, userId);
            if (this.gameId) {
                console.log(`Joining game: ${this.gameId}`);
                this.socket.emit('join_private', this.gameId, userId);
            }
            else {
                this.socket.emit('join_1v1', userId);
            }
        });
        this.socket.on('game_start', (data) => {
            this.playerIndex = data.playerIndex;
            console.log(`Game started, player ${this.playerIndex}`);
        });
        this.socket.on('game_update', (data) => {
            this.cities = (0, utils_1.patch)(this.cities, data.cities_diff);
            this.map = (0, utils_1.patch)(this.map, data.map_diff);
            this.generals = data.generals;
            this.turnCount++;
            const { armies, terrain } = this.parseMap();
            const myTiles = terrain.filter(t => t === this.playerIndex).length;
            const myArmies = armies.reduce((sum, army, i) => terrain[i] === this.playerIndex ? sum + army : sum, 0);
            console.log(`T${this.turnCount} T${myTiles} A${myArmies}`);
            this.makeMove();
        });
        this.socket.on('game_won', (data) => {
            if (data.winner === this.playerIndex) {
                console.log('Won');
            }
            else {
                console.log('Lost');
            }
            this.resetGameState();
            setTimeout(() => {
                if (this.gameId) {
                    const userId = process.env.BOT_USER_ID;
                    this.socket.emit('join_private', this.gameId, userId);
                }
            }, 1000);
        });
        this.socket.on('game_lost', () => {
            console.log('Lost');
            this.resetGameState();
            setTimeout(() => {
                if (this.gameId) {
                    const userId = process.env.BOT_USER_ID;
                    this.socket.emit('join_private', this.gameId, userId);
                }
            }, 1000);
        });
        this.socket.on('disconnect', () => {
            console.log('Disconnected');
        });
        this.socket.on('connect_error', (error) => {
            console.error('Connection error:', error);
        });
        this.socket.on('error', (error) => {
            console.error('Socket error:', error);
        });
    }
    resetGameState() {
        this.playerIndex = -1;
        this.generals = [];
        this.cities = [];
        this.map = [];
        this.turnCount = 0;
    }
    makeMove() {
        // Update strategic state
        this.updateStrategicIntel();
        // Determine current phase
        this.expansionPhase = this.turnCount <= 25;
        let move = null;
        if (this.expansionPhase) {
            // Phase 1: Rapid expansion for first 25 turns
            move = this.findRapidExpansionMove();
        }
        else if (this.targetGeneral !== -1) {
            // Phase 3: General assault - we know where an enemy general is
            move = this.findGeneralAssaultMove();
        }
        else {
            // Phase 2: Search & destroy - look for enemies/cities/towers
            move = this.findSearchAndDestroyMove();
        }
        if (move) {
            const { armies, terrain } = this.parseMap();
            const moveType = this.getMoveType(move.to, terrain);
            console.log(`T${this.turnCount} ${move.from}→${move.to}(${armies[move.from]}→${armies[move.to]}) ${moveType} [${this.getPhaseDescription()}]`);
            this.socket.emit('attack', move.from, move.to);
        }
        else {
            const { armies, terrain } = this.parseMap();
            const myTiles = terrain.filter(t => t === this.playerIndex).length;
            const availableMoves = this.countAvailableMoves(armies, terrain);
            console.log(`T${this.turnCount} NO MOVES (${myTiles}t, ${availableMoves}av) [${this.getPhaseDescription()}]`);
        }
    }
    findStrategicMove() {
        const { width, height, armies, terrain } = this.parseMap();
        if (!width || !height || armies.length === 0) {
            return null;
        }
        const generalPos = this.generals[this.playerIndex];
        // Strategic Priority 1: Capture cities with overwhelming force
        const cityMoves = [];
        for (let i = 0; i < terrain.length; i++) {
            if (terrain[i] === this.playerIndex && armies[i] > 1) {
                const adjacent = (0, utils_1.getAdjacentIndices)(i, width, height);
                for (const adj of adjacent) {
                    if (terrain[adj] === -6 && armies[i] > armies[adj] * 2 + 1) {
                        const distFromGeneral = this.getDistance(i, generalPos, width);
                        if (distFromGeneral > 3 || this.getArmiesNearGeneral(width, height, armies, terrain) > 15) {
                            cityMoves.push({ from: i, to: adj, armies: armies[i], priority: 1000 });
                        }
                    }
                }
            }
        }
        if (cityMoves.length > 0) {
            cityMoves.sort((a, b) => b.armies - a.armies);
            return { from: cityMoves[0].from, to: cityMoves[0].to };
        }
        // Strategic Priority 2: Attack enemy territory with overwhelming force
        const attackMoves = [];
        for (let i = 0; i < terrain.length; i++) {
            if (terrain[i] === this.playerIndex && armies[i] > 1) {
                const adjacent = (0, utils_1.getAdjacentIndices)(i, width, height);
                for (const adj of adjacent) {
                    if (terrain[adj] >= 0 && terrain[adj] !== this.playerIndex && armies[i] > armies[adj] * 2 + 1) {
                        const distFromGeneral = this.getDistance(i, generalPos, width);
                        if (distFromGeneral > 3 || this.getArmiesNearGeneral(width, height, armies, terrain) > 15) {
                            attackMoves.push({ from: i, to: adj, armies: armies[i], priority: 800 });
                        }
                    }
                }
            }
        }
        if (attackMoves.length > 0) {
            attackMoves.sort((a, b) => b.armies - a.armies);
            return { from: attackMoves[0].from, to: attackMoves[0].to };
        }
        // Strategic Priority 3: Expand to empty tiles (with strategic preference)
        const expansionMoves = [];
        for (let i = 0; i < terrain.length; i++) {
            if (terrain[i] === this.playerIndex && armies[i] > 1) {
                const adjacent = (0, utils_1.getAdjacentIndices)(i, width, height);
                for (const adj of adjacent) {
                    if (terrain[adj] === -1) {
                        // Strategic scoring: prefer expansion near cities or center
                        let score = armies[i];
                        const adjAdjacent = (0, utils_1.getAdjacentIndices)(adj, width, height);
                        for (const adjAdj of adjAdjacent) {
                            if (terrain[adjAdj] === -6)
                                score += 100; // Near city
                        }
                        const centerDistance = this.getDistance(adj, Math.floor(terrain.length / 2), width);
                        score += Math.max(0, 20 - centerDistance); // Prefer center
                        expansionMoves.push({ from: i, to: adj, armies: armies[i], score });
                    }
                }
            }
        }
        if (expansionMoves.length > 0) {
            expansionMoves.sort((a, b) => b.score - a.score);
            return { from: expansionMoves[0].from, to: expansionMoves[0].to };
        }
        // Strategic Priority 4: Reinforce frontline positions
        const myTiles = [];
        for (let i = 0; i < terrain.length; i++) {
            if (terrain[i] === this.playerIndex && armies[i] > 1) {
                myTiles.push({ index: i, armies: armies[i] });
            }
        }
        myTiles.sort((a, b) => b.armies - a.armies);
        for (const tile of myTiles) {
            const adjacent = (0, utils_1.getAdjacentIndices)(tile.index, width, height);
            for (const adj of adjacent) {
                if (terrain[adj] === this.playerIndex && armies[adj] < tile.armies - 5) {
                    const targetAdjacent = (0, utils_1.getAdjacentIndices)(adj, width, height);
                    const isOnFrontline = targetAdjacent.some(t => terrain[t] === -1 || terrain[t] === -6 || (terrain[t] >= 0 && terrain[t] !== this.playerIndex));
                    if (isOnFrontline) {
                        return { from: tile.index, to: adj };
                    }
                }
            }
        }
        return null;
    }
    getStrategyType(move, armies, terrain) {
        const target = terrain[move.to];
        if (this.generals.includes(move.to))
            return 'GENERAL_KILL';
        if (target === -6)
            return 'CITY_CAPTURE';
        if (target >= 0 && target !== this.playerIndex)
            return 'ENEMY_ATTACK';
        if (target === -1)
            return 'EXPANSION';
        if (target === this.playerIndex)
            return 'REINFORCE';
        return 'STRATEGIC';
    }
    getArmiesNearGeneral(width, height, armies, terrain) {
        const generalPos = this.generals[this.playerIndex];
        let totalArmies = 0;
        for (let i = 0; i < terrain.length; i++) {
            if (terrain[i] === this.playerIndex) {
                const distance = this.getDistance(i, generalPos, width);
                if (distance <= 3) {
                    totalArmies += armies[i];
                }
            }
        }
        return totalArmies;
    }
    getMoveType(targetTile, terrain) {
        const target = terrain[targetTile];
        if (target === -1)
            return 'EXP';
        if (target === -6)
            return 'CITY';
        if (target >= 0 && target !== this.playerIndex)
            return 'ATK';
        if (target === this.playerIndex)
            return 'REIN';
        return 'UNK';
    }
    countAvailableMoves(armies, terrain) {
        return terrain.filter((t, i) => t === this.playerIndex && armies[i] > 1).length;
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
    // ===== SEARCH & DESTROY STRATEGY METHODS =====
    updateStrategicIntel() {
        const { armies, terrain } = this.parseMap();
        // Update discovered cities
        for (let i = 0; i < terrain.length; i++) {
            if (terrain[i] === -6) {
                this.discoveredCities.add(i);
            }
        }
        // Update discovered towers (lookout towers)
        for (let i = 0; i < terrain.length; i++) {
            if (terrain[i] === -5) {
                this.discoveredTowers.add(i);
            }
        }
        // Update known enemy generals
        for (let i = 0; i < this.generals.length; i++) {
            if (i !== this.playerIndex && this.generals[i] !== -1) {
                this.knownEnemyGenerals.set(i, this.generals[i]);
                if (this.targetGeneral === -1) {
                    this.targetGeneral = this.generals[i];
                }
            }
        }
    }
    findRapidExpansionMove() {
        const { width, height, armies, terrain } = this.parseMap();
        if (!width || !height || armies.length === 0) {
            return null;
        }
        // Rapid expansion: prioritize empty tiles and weak enemies
        const expansionMoves = [];
        for (let i = 0; i < terrain.length; i++) {
            if (terrain[i] === this.playerIndex && armies[i] > 1) {
                const adjacent = (0, utils_1.getAdjacentIndices)(i, width, height);
                for (const adj of adjacent) {
                    let priority = 0;
                    if (terrain[adj] === -1) { // Empty
                        priority = 100;
                    }
                    else if (terrain[adj] === -6) { // City
                        priority = 200;
                    }
                    else if (terrain[adj] >= 0 && terrain[adj] !== this.playerIndex) { // Enemy
                        priority = 150;
                    }
                    if (priority > 0) {
                        expansionMoves.push({ from: i, to: adj, priority });
                    }
                }
            }
        }
        if (expansionMoves.length > 0) {
            expansionMoves.sort((a, b) => b.priority - a.priority);
            return { from: expansionMoves[0].from, to: expansionMoves[0].to };
        }
        return null;
    }
    findSearchAndDestroyMove() {
        const { width, height, armies, terrain } = this.parseMap();
        if (!width || !height || armies.length === 0) {
            return null;
        }
        // Search for enemies by probing unknown areas
        const probingMoves = [];
        for (let i = 0; i < terrain.length; i++) {
            if (terrain[i] === this.playerIndex && armies[i] > 5) { // Use stronger tiles for probing
                const adjacent = (0, utils_1.getAdjacentIndices)(i, width, height);
                for (const adj of adjacent) {
                    if (terrain[adj] === -1 || (terrain[adj] >= 0 && terrain[adj] !== this.playerIndex)) {
                        probingMoves.push({ from: i, to: adj, armies: armies[i] });
                    }
                }
            }
        }
        if (probingMoves.length > 0) {
            // Use strongest available army for probing
            probingMoves.sort((a, b) => b.armies - a.armies);
            return { from: probingMoves[0].from, to: probingMoves[0].to };
        }
        return null;
    }
    findGeneralAssaultMove() {
        const { width, height, armies, terrain } = this.parseMap();
        if (!width || !height || armies.length === 0 || this.targetGeneral === -1) {
            return null;
        }
        // Calculate required force for assault (estimate enemy general strength)
        const requiredForce = this.estimateRequiredForce();
        const availableForce = this.calculateAvailableForce(terrain, armies);
        // If we don't have enough force, accumulate armies first
        if (availableForce < requiredForce) {
            return this.findArmyAccumulationMove();
        }
        // We have enough force - launch coordinated assault
        return this.findCoordinatedAssaultMove();
    }
    estimateRequiredForce() {
        // Conservative estimate: assume enemy general has significant protection
        // In real game, we'd analyze visible enemy territory
        return 50; // Minimum force needed for successful assault
    }
    calculateAvailableForce(terrain, armies) {
        let totalForce = 0;
        for (let i = 0; i < terrain.length; i++) {
            if (terrain[i] === this.playerIndex && armies[i] > 5) {
                totalForce += armies[i] - 1; // -1 because we need to leave 1 army
            }
        }
        return totalForce;
    }
    findArmyAccumulationMove() {
        const { width, height, armies, terrain } = this.parseMap();
        // Find the strongest army closest to target general
        let bestSource = -1;
        let bestDistance = Infinity;
        let bestArmies = 0;
        for (let i = 0; i < terrain.length; i++) {
            if (terrain[i] === this.playerIndex && armies[i] > 5) {
                const distance = this.getManhattanDistance(i, this.targetGeneral, width);
                if (distance < bestDistance || (distance === bestDistance && armies[i] > bestArmies)) {
                    bestSource = i;
                    bestDistance = distance;
                    bestArmies = armies[i];
                }
            }
        }
        if (bestSource === -1)
            return null;
        // Move other armies toward this accumulation point
        for (let i = 0; i < terrain.length; i++) {
            if (terrain[i] === this.playerIndex && armies[i] > 3 && i !== bestSource) {
                const path = this.findPathToTarget(i, bestSource, width, height, terrain);
                if (path && path.length > 1) {
                    return { from: i, to: path[1] };
                }
            }
        }
        return null;
    }
    findCoordinatedAssaultMove() {
        const { width, height, armies, terrain } = this.parseMap();
        // Find the strongest army that can move toward the target general
        let bestMove = null;
        let bestArmies = 0;
        for (let i = 0; i < terrain.length; i++) {
            if (terrain[i] === this.playerIndex && armies[i] > bestArmies) {
                const path = this.findPathToTarget(i, this.targetGeneral, width, height, terrain);
                if (path && path.length > 1) {
                    bestMove = { from: i, to: path[1] };
                    bestArmies = armies[i];
                }
            }
        }
        return bestMove;
    }
    getManhattanDistance(pos1, pos2, width) {
        const x1 = pos1 % width;
        const y1 = Math.floor(pos1 / width);
        const x2 = pos2 % width;
        const y2 = Math.floor(pos2 / width);
        return Math.abs(x1 - x2) + Math.abs(y1 - y2);
    }
    findPathToTarget(start, target, width, height, terrain) {
        // Simple pathfinding toward target
        const queue = [{ pos: start, path: [start] }];
        const visited = new Set();
        while (queue.length > 0) {
            const { pos, path } = queue.shift();
            if (pos === target) {
                return path;
            }
            if (visited.has(pos))
                continue;
            visited.add(pos);
            const adjacent = (0, utils_1.getAdjacentIndices)(pos, width, height);
            for (const adj of adjacent) {
                if (!visited.has(adj) && terrain[adj] !== -2) { // Not mountain
                    queue.push({ pos: adj, path: [...path, adj] });
                }
            }
        }
        return null;
    }
    getPhaseDescription() {
        if (this.expansionPhase) {
            return 'EXPAND';
        }
        else if (this.targetGeneral !== -1) {
            return 'ASSAULT';
        }
        else {
            return 'SEARCH';
        }
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
