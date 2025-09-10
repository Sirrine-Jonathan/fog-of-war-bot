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
        this.lastMove = null;
        this.moveHistory = [];
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
        this.lastMove = null;
        this.moveHistory = [];
    }
    makeMove() {
        const move = this.findSimpleMove();
        if (move) {
            const { armies, terrain } = this.parseMap();
            const moveType = this.getMoveType(move.to, terrain);
            console.log(`T${this.turnCount} ${move.from}→${move.to}(${armies[move.from]}→${armies[move.to]}) ${moveType} [SIMPLE]`);
            // Track move history for oscillation prevention
            this.lastMove = move;
            this.moveHistory.push(move);
            if (this.moveHistory.length > 10) {
                this.moveHistory.shift();
            }
            this.socket.emit('attack', move.from, move.to);
        }
        else {
            const { armies, terrain } = this.parseMap();
            const myTiles = terrain.filter(t => t === this.playerIndex).length;
            const availableMoves = this.countAvailableMoves(armies, terrain);
            console.log(`T${this.turnCount} NO MOVES (${myTiles}t, ${availableMoves}av)`);
        }
    }
    findSimpleMove() {
        const { width, height, armies, terrain } = this.parseMap();
        if (!width || !height || armies.length === 0) {
            return null;
        }
        // Lava flood: radiate outward from generative sources (general + cities)
        const allMoves = [];
        const generalPos = this.generals[this.playerIndex];
        for (let i = 0; i < terrain.length; i++) {
            if (terrain[i] === this.playerIndex && armies[i] > 1) {
                const adjacent = (0, utils_1.getAdjacentIndices)(i, width, height);
                for (const adj of adjacent) {
                    let priority = 0;
                    // Priority: Cities > Enemy > Empty > Own (for reinforcement)
                    if (terrain[adj] === -6) { // City
                        priority = 1000;
                    }
                    else if (terrain[adj] >= 0 && terrain[adj] !== this.playerIndex) { // Enemy
                        priority = 800;
                    }
                    else if (terrain[adj] === -1) { // Empty
                        priority = 600;
                    }
                    else if (terrain[adj] === this.playerIndex && armies[adj] < armies[i] / 2) { // Own territory (reinforcement)
                        priority = 200;
                    }
                    if (priority > 0) {
                        // Radial expansion bonus: prefer moves that push away from generative sources
                        const radiationBonus = this.getRadiationBonus(i, adj, generalPos, width, height);
                        priority += radiationBonus;
                        // Push armies out from interior: bonus for moves from high-army tiles
                        if (armies[i] > 10) {
                            priority += Math.min(armies[i] * 2, 200); // More armies = higher priority to move
                        }
                        allMoves.push({
                            from: i,
                            to: adj,
                            priority,
                            armies: armies[i]
                        });
                    }
                }
            }
        }
        if (allMoves.length === 0) {
            return null;
        }
        // Sort by priority (highest first), then by army strength
        allMoves.sort((a, b) => {
            if (b.priority !== a.priority)
                return b.priority - a.priority;
            return b.armies - a.armies;
        });
        // Try moves in priority order, avoiding oscillation
        for (const move of allMoves) {
            const candidate = { from: move.from, to: move.to };
            if (!this.wouldOscillate(candidate)) {
                return candidate;
            }
        }
        // If all moves would oscillate, take the best one anyway to keep expanding
        return { from: allMoves[0].from, to: allMoves[0].to };
    }
    getRadiationBonus(from, to, generalPos, width, height) {
        if (generalPos === -1 || generalPos === undefined)
            return 0;
        const fromDistToGeneral = this.getManhattanDistance(from, generalPos, width);
        const toDistToGeneral = this.getManhattanDistance(to, generalPos, width);
        // Bonus for moves that increase distance from general (radiating outward)
        if (toDistToGeneral > fromDistToGeneral) {
            return 100; // Encourage outward radiation
        }
        // Penalty for moves toward general (except for reinforcement)
        if (toDistToGeneral < fromDistToGeneral) {
            return -50; // Discourage inward movement
        }
        return 0;
    }
    getManhattanDistance(pos1, pos2, width) {
        const x1 = pos1 % width;
        const y1 = Math.floor(pos1 / width);
        const x2 = pos2 % width;
        const y2 = Math.floor(pos2 / width);
        return Math.abs(x1 - x2) + Math.abs(y1 - y2);
    }
    wouldOscillate(move) {
        // Check if this move is the reverse of the last move
        if (this.lastMove &&
            this.lastMove.from === move.to &&
            this.lastMove.to === move.from) {
            return true;
        }
        // Check for repeated patterns in recent history
        const recentMoves = this.moveHistory.slice(-6);
        let oscillationCount = 0;
        for (const histMove of recentMoves) {
            if (histMove.from === move.from && histMove.to === move.to) {
                oscillationCount++;
            }
        }
        return oscillationCount >= 2;
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
