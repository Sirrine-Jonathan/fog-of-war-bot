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
  private turnCount: number = 0;
  private lastMove: Move | null = null;
  private moveHistory: Move[] = [];

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
      this.turnCount++;
      
      const { armies, terrain } = this.parseMap();
      const myTiles = terrain.filter(t => t === this.playerIndex).length;
      const myArmies = armies.reduce((sum, army, i) => terrain[i] === this.playerIndex ? sum + army : sum, 0);
      
      console.log(`T${this.turnCount} T${myTiles} A${myArmies}`);
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
    this.turnCount = 0;
    this.lastMove = null;
    this.moveHistory = [];
  }

  private makeMove(): void {
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
    } else {
      const { armies, terrain } = this.parseMap();
      const myTiles = terrain.filter(t => t === this.playerIndex).length;
      const availableMoves = this.countAvailableMoves(armies, terrain);
      console.log(`T${this.turnCount} NO MOVES (${myTiles}t, ${availableMoves}av)`);
    }
  }

  private findSimpleMove(): Move | null {
    const { width, height, armies, terrain } = this.parseMap();
    
    if (!width || !height || armies.length === 0) {
      return null;
    }

    // Get all valid source tiles (my tiles with >1 army)
    const validSources: number[] = [];
    for (let i = 0; i < terrain.length; i++) {
      if (terrain[i] === this.playerIndex && armies[i] > 1) {
        validSources.push(i);
      }
    }

    if (validSources.length === 0) {
      return null;
    }

    // Sort by army count (descending) but try different tiles to avoid oscillation
    validSources.sort((a, b) => armies[b] - armies[a]);

    // Try each source tile in order
    for (const source of validSources) {
      const move = this.findBestMoveFromTile(source, width, height, armies, terrain);
      if (move && !this.wouldOscillate(move)) {
        return move;
      }
    }

    // If all moves would oscillate, pick the best non-oscillating move anyway
    for (const source of validSources) {
      const move = this.findBestMoveFromTile(source, width, height, armies, terrain);
      if (move) {
        return move;
      }
    }

    return null;
  }

  private findBestMoveFromTile(source: number, width: number, height: number, armies: number[], terrain: number[]): Move | null {
    const adjacent = getAdjacentIndices(source, width, height);
    
    // Priority order: Cities > Enemy > Empty > Own
    for (const adj of adjacent) {
      if (terrain[adj] === -6) { // City
        return { from: source, to: adj };
      }
    }
    
    for (const adj of adjacent) {
      if (terrain[adj] >= 0 && terrain[adj] !== this.playerIndex) { // Enemy
        return { from: source, to: adj };
      }
    }
    
    for (const adj of adjacent) {
      if (terrain[adj] === -1) { // Empty
        return { from: source, to: adj };
      }
    }
    
    for (const adj of adjacent) {
      if (terrain[adj] === this.playerIndex) { // Own territory
        return { from: source, to: adj };
      }
    }
    
    return null;
  }

  private wouldOscillate(move: Move): boolean {
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
