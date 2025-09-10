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
      console.log(`Connected: ${this.serverUrl}`);
      const userId = process.env.BOT_USER_ID;
      
      if (!userId) {
        throw new Error('BOT_USER_ID environment variable is required');
      }
      
      this.socket.emit('set_username', userId, userId);
      
      if (this.gameId) {
        console.log(`Joining game: ${this.gameId}`);
        this.socket.emit('join_private', this.gameId, userId);
      } else {
        this.socket.emit('join_1v1', userId);
      }
    });

    this.socket.on('game_start', (data: GameStartData) => {
      this.playerIndex = data.playerIndex;
      console.log(`Game started, player ${this.playerIndex}`);
    });

    this.socket.on('game_update', (data: GameUpdateData) => {
      this.cities = patch(this.cities, data.cities_diff);
      this.map = patch(this.map, data.map_diff);
      this.generals = data.generals;
      
      const { armies, terrain } = this.parseMap();
      const myTiles = terrain.filter(t => t === this.playerIndex).length;
      const myArmies = armies.reduce((sum, army, i) => terrain[i] === this.playerIndex ? sum + army : sum, 0);
      
      console.log(`T${myTiles} A${myArmies}`);
      this.makeMove();
    });

    this.socket.on('game_won', (data: any) => {
      if (data.winner === this.playerIndex) {
        console.log('Won');
      } else {
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

    this.socket.on('connect_error', (error: any) => {
      console.error('Connection error:', error);
    });

    this.socket.on('error', (error: any) => {
      console.error('Socket error:', error);
    });
  }

  private resetGameState(): void {
    this.playerIndex = -1;
    this.generals = [];
    this.cities = [];
    this.map = [];
  }

  private makeMove(): void {
    const move = this.findExpansionMove();
    if (move) {
      const { armies, terrain } = this.parseMap();
      const moveType = this.getMoveType(move.to, terrain);
      console.log(`${move.from}→${move.to}(${armies[move.from]}→${armies[move.to]}) ${moveType}`);
      this.socket.emit('attack', move.from, move.to);
    } else {
      const { armies, terrain } = this.parseMap();
      const myTiles = terrain.filter(t => t === this.playerIndex).length;
      const availableMoves = this.countAvailableMoves(armies, terrain);
      console.log(`NO MOVES (${myTiles}t, ${availableMoves}av)`);
    }
  }

  private getMoveType(targetTile: number, terrain: number[]): string {
    const target = terrain[targetTile];
    if (target === -1) return 'EXP';
    if (target === -6) return 'CITY';
    if (target >= 0 && target !== this.playerIndex) return 'ATK';
    if (target === this.playerIndex) return 'REIN';
    return 'UNK';
  }

  private countAvailableMoves(armies: number[], terrain: number[]): number {
    return terrain.filter((t, i) => t === this.playerIndex && armies[i] > 1).length;
  }

  private findExpansionMove(): Move | null {
    const { width, height, armies, terrain } = this.parseMap();
    
    if (!width || !height || armies.length === 0) {
      return null;
    }

    const generalPos = this.generals[this.playerIndex];

    // First priority: capture cities (huge strategic value)
    const cityMoves = [];
    for (let i = 0; i < terrain.length; i++) {
      if (terrain[i] === this.playerIndex && armies[i] > 1) {
        const adjacent = getAdjacentIndices(i, width, height);
        
        for (const adj of adjacent) {
          if (terrain[adj] === -6 && armies[i] > armies[adj] * 2 + 1) { // City - overwhelming force
            // General protection: don't leave general area weak
            const distFromGeneral = this.getDistance(i, generalPos, width);
            if (distFromGeneral > 3 || this.getArmiesNearGeneral(width, height, armies, terrain) > 10) {
              cityMoves.push({ from: i, to: adj, armies: armies[i] });
            }
          }
        }
      }
    }
    if (cityMoves.length > 0) {
      cityMoves.sort((a, b) => b.armies - a.armies); // Prefer larger armies
      return { from: cityMoves[0].from, to: cityMoves[0].to };
    }

    // Second priority: attack enemy territory
    const attackMoves = [];
    for (let i = 0; i < terrain.length; i++) {
      if (terrain[i] === this.playerIndex && armies[i] > 1) {
        const adjacent = getAdjacentIndices(i, width, height);
        
        for (const adj of adjacent) {
          if (terrain[adj] >= 0 && terrain[adj] !== this.playerIndex && armies[i] > armies[adj] * 2 + 1) { // Overwhelming force
            // General protection: don't leave general area weak
            const distFromGeneral = this.getDistance(i, generalPos, width);
            if (distFromGeneral > 3 || this.getArmiesNearGeneral(width, height, armies, terrain) > 10) {
              attackMoves.push({ from: i, to: adj, armies: armies[i] });
            }
          }
        }
      }
    }
    if (attackMoves.length > 0) {
      attackMoves.sort((a, b) => b.armies - a.armies); // Prefer larger armies
      return { from: attackMoves[0].from, to: attackMoves[0].to };
    }

    // Third priority: expand to empty tiles
    const expansionMoves = [];
    for (let i = 0; i < terrain.length; i++) {
      if (terrain[i] === this.playerIndex && armies[i] > 1) {
        const adjacent = getAdjacentIndices(i, width, height);
        
        for (const adj of adjacent) {
          if (terrain[adj] === -1) { // Empty tile
            expansionMoves.push({ from: i, to: adj, armies: armies[i] });
          }
        }
      }
    }
    if (expansionMoves.length > 0) {
      expansionMoves.sort((a, b) => b.armies - a.armies); // Prefer larger armies
      return { from: expansionMoves[0].from, to: expansionMoves[0].to };
    }
    
    // Fourth priority: move armies toward frontline tiles (tiles that border empty space or cities)
    const myTiles = [];
    for (let i = 0; i < terrain.length; i++) {
      if (terrain[i] === this.playerIndex && armies[i] > 1) {
        myTiles.push({ index: i, armies: armies[i] });
      }
    }
    
    // Sort by army count (highest first)
    myTiles.sort((a, b) => b.armies - a.armies);
    
    for (const tile of myTiles) {
      const adjacent = getAdjacentIndices(tile.index, width, height);
      
      for (const adj of adjacent) {
        if (terrain[adj] === this.playerIndex && armies[adj] < tile.armies - 5) {
          // Check if target tile is on frontline (borders empty space or cities)
          const targetAdjacent = getAdjacentIndices(adj, width, height);
          const isOnFrontline = targetAdjacent.some(t => terrain[t] === -1 || terrain[t] === -6);
          
          if (isOnFrontline) {
            return { from: tile.index, to: adj };
          }
        }
      }
    }
    
    return null;
  }

  private getArmiesNearGeneral(width: number, height: number, armies: number[], terrain: number[]): number {
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
