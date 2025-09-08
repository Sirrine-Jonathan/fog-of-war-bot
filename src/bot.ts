import io from 'socket.io-client';
import { GameStartData, GameUpdateData, Move, TILE_EMPTY, TILE_MOUNTAIN, TILE_FOG } from './types';
import { patch, getAdjacentIndices } from './utils';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

export class GeneralsBot {
  public socket: any;
  public playerIndex: number = -1;
  private generals: number[] = [];
  private cities: number[] = [];
  private map: number[] = [];
  public serverUrl: string;
  public gameId?: string;
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
      } else {
        console.log('🎯 Joining 1v1 queue');
        this.socket.emit('join_1v1', userId);
      }
    });

    this.socket.on('game_start', (data: GameStartData) => {
      this.playerIndex = data.playerIndex;
      this.failedMoves.clear();
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
    const { width, height, armies, terrain, towerDefense } = this.parseMap();
    
    if (!width || !height || armies.length === 0) {
      console.log(`❌ Invalid map data: ${width}x${height}, armies: ${armies.length}`);
      return null;
    }

    const gamePhase = this.getGamePhase();
    console.log(`🎯 Game phase: ${gamePhase}`);

    if (gamePhase === 'early') {
      return this.findExpansionMove(width, height, armies, terrain);
    } else if (gamePhase === 'mid') {
      return this.findCityHuntingMove(width, height, armies, terrain, towerDefense);
    } else {
      return this.findCombatMove(width, height, armies, terrain);
    }
  }

  private getGamePhase(): 'early' | 'mid' | 'late' {
    const { terrain } = this.parseMap();
    const myTiles = terrain.filter(t => t === this.playerIndex).length;
    const enemyTiles = terrain.filter(t => t >= 0 && t !== this.playerIndex).length;
    
    if (myTiles < 15) return 'early'; // Rapid expansion phase
    if (enemyTiles === 0) return 'mid'; // City hunting phase
    return 'late'; // Combat phase
  }

  private findExpansionMove(width: number, height: number, armies: number[], terrain: number[]): Move | null {
    console.log(`🌱 Early game: rapid expansion`);
    
    // Find all expansion moves, prioritize by distance from general
    const moves: Array<{from: number, to: number, priority: number}> = [];
    const generalPos = this.generals[this.playerIndex];
    
    for (let i = 0; i < terrain.length; i++) {
      if (terrain[i] === this.playerIndex && armies[i] > 1) {
        const adjacent = getAdjacentIndices(i, width, height);
        
        for (const adj of adjacent) {
          if (adj < 0 || adj >= terrain.length) continue;
          if (terrain[adj] !== -1) continue; // Only expand to empty tiles
          
          const moveKey = `${i}-${adj}`;
          if (this.failedMoves.has(moveKey)) continue;
          
          // Prioritize moves further from general for faster expansion
          const distFromGeneral = this.getDistance(adj, generalPos, width);
          moves.push({ from: i, to: adj, priority: distFromGeneral });
        }
      }
    }
    
    if (moves.length === 0) return null;
    
    moves.sort((a, b) => b.priority - a.priority);
    const bestMove = moves[0];
    console.log(`🎯 Expansion move: ${bestMove.from} → ${bestMove.to}`);
    return { from: bestMove.from, to: bestMove.to };
  }

  private findCityHuntingMove(width: number, height: number, armies: number[], terrain: number[], towerDefense: number[]): Move | null {
    console.log(`🏙️ Mid game: hunting cities`);
    
    // First priority: attack cities directly
    for (let i = 0; i < terrain.length; i++) {
      if (terrain[i] === this.playerIndex && armies[i] > 1) {
        const adjacent = getAdjacentIndices(i, width, height);
        
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

  private findCombatMove(width: number, height: number, armies: number[], terrain: number[]): Move | null {
    console.log(`⚔️ Late game: combat mode`);
    
    const enemyGeneral = this.findEnemyGeneral(terrain);
    const myStrength = this.calculateStrength(terrain, armies);
    const enemyStrength = this.calculateEnemyStrength(terrain, armies);
    
    console.log(`💪 Strength comparison: Me=${myStrength}, Enemy=${enemyStrength}`);
    
    if (myStrength < enemyStrength * 0.7) {
      // Defensive mode
      console.log(`🛡️ Playing defensively`);
      return this.findDefensiveMove(width, height, armies, terrain);
    } else {
      // Offensive mode
      console.log(`⚔️ Playing offensively`);
      if (enemyGeneral >= 0) {
        const attackMove = this.findMoveTowardsTarget(enemyGeneral, width, height, armies, terrain);
        if (attackMove) return attackMove;
      }
      
      // Attack any enemy territory
      return this.findAttackMove(width, height, armies, terrain);
    }
  }

  private findDefensiveMove(width: number, height: number, armies: number[], terrain: number[]): Move | null {
    const generalPos = this.generals[this.playerIndex];
    
    // Move armies towards general for defense
    for (let i = 0; i < terrain.length; i++) {
      if (terrain[i] === this.playerIndex && armies[i] > 1) {
        const distToGeneral = this.getDistance(i, generalPos, width);
        if (distToGeneral > 2) { // If far from general
          const adjacent = getAdjacentIndices(i, width, height);
          
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

  private findAttackMove(width: number, height: number, armies: number[], terrain: number[]): Move | null {
    for (let i = 0; i < terrain.length; i++) {
      if (terrain[i] === this.playerIndex && armies[i] > 1) {
        const adjacent = getAdjacentIndices(i, width, height);
        
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

  private findMoveTowardsTarget(target: number, width: number, height: number, armies: number[], terrain: number[]): Move | null {
    let bestMove: Move | null = null;
    let bestDistance = Infinity;
    
    for (let i = 0; i < terrain.length; i++) {
      if (terrain[i] === this.playerIndex && armies[i] > 1) {
        const adjacent = getAdjacentIndices(i, width, height);
        
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

  private findNearestCity(width: number, height: number, terrain: number[]): number {
    const myTiles = terrain.map((t, i) => t === this.playerIndex ? i : -1).filter(i => i >= 0);
    if (myTiles.length === 0) return -1;
    
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

  private findEnemyGeneral(terrain: number[]): number {
    for (let i = 0; i < this.generals.length; i++) {
      if (i !== this.playerIndex && this.generals[i] >= 0) {
        return this.generals[i];
      }
    }
    return -1;
  }

  private calculateStrength(terrain: number[], armies: number[]): number {
    return armies.reduce((sum, army, i) => terrain[i] === this.playerIndex ? sum + army : sum, 0);
  }

  private calculateEnemyStrength(terrain: number[], armies: number[]): number {
    return armies.reduce((sum, army, i) => terrain[i] >= 0 && terrain[i] !== this.playerIndex ? sum + army : sum, 0);
  }

  private getDistance(pos1: number, pos2: number, width: number): number {
    const row1 = Math.floor(pos1 / width);
    const col1 = pos1 % width;
    const row2 = Math.floor(pos2 / width);
    const col2 = pos2 % width;
    return Math.abs(row1 - row2) + Math.abs(col1 - col2);
  }

  private parseMap() {
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
