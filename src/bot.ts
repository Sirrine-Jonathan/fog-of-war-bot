import io from 'socket.io-client';
import { GameStartData, GameUpdateData, Move, TILE_EMPTY, TILE_MOUNTAIN, TILE_FOG } from './types';
import { patch, getAdjacentIndices } from './utils';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

class GeneralsBot {
  public socket: any;
  private playerIndex: number = -1;
  private generals: number[] = [];
  private cities: number[] = [];
  private map: number[] = [];
  private serverUrl: string;
  private gameId?: string;
  private lastMove: Move | null = null;
  private failedMoves: Set<string> = new Set();

  constructor(serverUrl: string = 'https://fog-of-war-0f4f.onrender.com', gameId?: string) {
    this.serverUrl = serverUrl;
    this.gameId = gameId;
    
    // Configure socket options for HTTPS connections
    const socketOptions: any = {
      transports: ['websocket', 'polling'],
      timeout: 20000,
    };
    
    // Add SSL options for HTTPS connections
    if (serverUrl.startsWith('https://')) {
      socketOptions.rejectUnauthorized = false; // Allow self-signed certificates
    }
    
    this.socket = io(serverUrl, socketOptions);
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
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
        // Don't auto-start - wait for manual start
      } else {
        console.log('🎯 Joining 1v1 queue');
        this.socket.emit('join_1v1', userId);
      }
    });

    this.socket.on('game_start', (data: GameStartData) => {
      this.playerIndex = data.playerIndex;
      this.failedMoves.clear(); // Reset failed moves for new game
      console.log(`🎲 Game started! Player index: ${this.playerIndex}`);
    });

    this.socket.on('game_update', (data: GameUpdateData) => {
      const prevTiles = this.map.length > 0 ? this.parseMap().terrain.filter(t => t === this.playerIndex).length : 0;
      
      this.cities = patch(this.cities, data.cities_diff);
      this.map = patch(this.map, data.map_diff);
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

    this.socket.on('game_won', (data: any) => {
      console.log('🏆 Game ended - Winner:', data.winner);
      console.log('🔄 Resetting bot state for next game...');
      this.resetGameState();
      
      // Wait a bit for game reset, then rejoin
      setTimeout(() => {
        if (this.gameId) {
          console.log('🎮 Rejoining game room for next game...');
          const userId = process.env.BOT_USER_ID;
          this.socket.emit('join_private', this.gameId, userId);
        }
      }, 1000); // 1 second delay to ensure game is reset
    });

    this.socket.on('game_lost', () => {
      console.log('💀 Defeat!');
      console.log('🔄 Resetting bot state for next game...');
      this.resetGameState();
      
      // Wait a bit for game reset, then rejoin
      setTimeout(() => {
        if (this.gameId) {
          console.log('🎮 Rejoining game room for next game...');
          const userId = process.env.BOT_USER_ID;
          this.socket.emit('join_private', this.gameId, userId);
        }
      }, 1000); // 1 second delay to ensure game is reset
    });

    this.socket.on('disconnect', () => {
      console.log('❌ Disconnected from server');
    });

    this.socket.on('connect_error', (error: any) => {
      console.error('🚫 Connection error:', error);
    });

    this.socket.on('error', (error: any) => {
      console.error('⚠️ Socket error:', error);
    });
  }

  private resetGameState(): void {
    this.playerIndex = -1;
    this.generals = [];
    this.cities = [];
    this.map = [];
    this.lastMove = null;
    this.failedMoves.clear();
    console.log('✅ Bot state reset complete');
  }

  private makeMove(): void {
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
    } else {
      console.log(`🤔 No valid moves found`);
    }
  }

  private findBestMove(): Move | null {
    const { width, height, armies, terrain } = this.parseMap();
    
    if (!width || !height || armies.length === 0) {
      console.log(`❌ Invalid map data: ${width}x${height}, armies: ${armies.length}`);
      return null;
    }

    console.log(`🗺️ Map: ${width}x${height}, Player: ${this.playerIndex}`);
    console.log(`🎯 My tiles: ${terrain.map((t, i) => t === this.playerIndex ? i : null).filter(x => x !== null).join(', ')}`);

    const myTiles: number[] = [];
    
    // Find all my tiles with armies > 1
    for (let i = 0; i < terrain.length; i++) {
      if (terrain[i] === this.playerIndex && armies[i] > 1) {
        myTiles.push(i);
      }
    }
    
    console.log(`🏰 Found ${myTiles.length} tiles with armies > 1: ${myTiles.join(', ')}`);
    
    // Try to expand or attack
    for (const tile of myTiles) {
      const adjacent = getAdjacentIndices(tile, width, height);
      
      for (const adj of adjacent) {
        if (adj < 0 || adj >= terrain.length) continue;
        
        const moveKey = `${tile}-${adj}`;
        if (this.failedMoves.has(moveKey)) continue;
        
        // Expand to empty tiles
        if (terrain[adj] === TILE_EMPTY) {
          console.log(`🌱 Expanding to empty tile: ${tile}(${armies[tile]}) → ${adj}(${armies[adj]})`);
          return { from: tile, to: adj };
        }
        
        // Attack weaker enemies
        if (terrain[adj] >= 0 && terrain[adj] !== this.playerIndex && 
            armies[tile] > armies[adj] + 1) {
          console.log(`⚔️ Attacking enemy: ${tile}(${armies[tile]}) → ${adj}(${armies[adj]})`);
          return { from: tile, to: adj };
        }
      }
    }

    return null;
  }

  private parseMap() {
    if (this.map.length < 2) {
      console.log(`❌ Map too short: ${this.map.length}`);
      return { width: 0, height: 0, armies: [], terrain: [] };
    }
    
    const width = this.map[0];
    const height = this.map[1];
    const size = width * height;
    
    if (this.map.length < size * 2 + 2) {
      console.log(`❌ Map data incomplete: expected ${size * 2 + 2}, got ${this.map.length}`);
      return { width: 0, height: 0, armies: [], terrain: [] };
    }
    
    const armies = this.map.slice(2, size + 2);
    const terrain = this.map.slice(size + 2, size + 2 + size);
    
    console.log(`🔍 Raw map data: [${this.map.slice(0, 10).join(',')}...] (${this.map.length} total)`);
    console.log(`🔍 Terrain sample: [${terrain.slice(0, 10).join(',')}...]`);
    console.log(`🔍 Armies sample: [${armies.slice(0, 10).join(',')}...]`);
    
    return { width, height, armies, terrain };
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const serverUrl = args.find(arg => arg.startsWith('--server='))?.split('=')[1] || 
                  process.env.HOST || 
                  'http://localhost:3001';
const gameId = args.find(arg => arg.startsWith('--game='))?.split('=')[1] || 
               process.env.GAME_ID || 
               undefined; // undefined means auto-match

console.log('Starting bot with:');
console.log('Server:', serverUrl);
console.log('Game ID:', gameId || 'Auto-match');

// Start the bot
const bot = new GeneralsBot(serverUrl, gameId);

// Add simple force start on any input
process.stdin.on('data', () => {
  if (gameId) {
    console.log('🚀 Force starting game...');
    bot.socket.emit('set_force_start', gameId, true);
  }
});
