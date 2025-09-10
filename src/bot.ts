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

    // Lava flood: find ALL possible expansion moves and prioritize by distance from center
    const allMoves: Array<{from: number, to: number, priority: number, armies: number}> = [];
    
    for (let i = 0; i < terrain.length; i++) {
      if (terrain[i] === this.playerIndex && armies[i] > 1) {
        const adjacent = getAdjacentIndices(i, width, height);
        
        for (const adj of adjacent) {
          let priority = 0;
          
          // Priority: Cities > Enemy > Empty > Own (for reinforcement)
          if (terrain[adj] === -6) { // City
            priority = 1000;
          } else if (terrain[adj] >= 0 && terrain[adj] !== this.playerIndex) { // Enemy
            priority = 800;
          } else if (terrain[adj] === -1) { // Empty
            priority = 600;
          } else if (terrain[adj] === this.playerIndex && armies[adj] < armies[i] / 2) { // Own territory (reinforcement)
            priority = 200;
          }
          
          if (priority > 0) {
            // Add distance from edges to encourage spreading
            const distFromEdge = this.getDistanceFromEdges(adj, width, height);
            priority += distFromEdge * 10; // Prefer moves away from edges
            
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
      if (b.priority !== a.priority) return b.priority - a.priority;
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

  private getDistanceFromEdges(pos: number, width: number, height: number): number {
    const x = pos % width;
    const y = Math.floor(pos / width);
    
    const distFromLeft = x;
    const distFromRight = width - 1 - x;
    const distFromTop = y;
    const distFromBottom = height - 1 - y;
    
    return Math.min(distFromLeft, distFromRight, distFromTop, distFromBottom);
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
