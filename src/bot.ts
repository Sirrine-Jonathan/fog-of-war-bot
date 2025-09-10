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
  
  // Hybrid Strategy State
  private knownEnemyGenerals: Map<number, number> = new Map();
  private discoveredCities: Set<number> = new Set();
  private discoveredTowers: Set<number> = new Set();
  private targetGeneral: number = -1;
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
    this.knownEnemyGenerals.clear();
    this.discoveredCities.clear();
    this.discoveredTowers.clear();
    this.targetGeneral = -1;
    this.lastMove = null;
    this.moveHistory = [];
  }

  private makeMove(): void {
    // Update strategic intelligence
    this.updateStrategicIntel();
    
    let move: Move | null = null;
    const phase = this.getCurrentPhase();
    
    switch (phase) {
      case 'FLOOD':
        move = this.findLavaFloodMove();
        break;
      case 'HYBRID':
        move = this.findHybridMove();
        break;
      case 'HUNT':
        move = this.findHuntMove();
        break;
      case 'ASSAULT':
        move = this.findAssaultMove();
        break;
    }
    
    if (move && !this.wouldOscillate(move)) {
      const { armies, terrain } = this.parseMap();
      const moveType = this.getMoveType(move.to, terrain);
      console.log(`T${this.turnCount} ${move.from}→${move.to}(${armies[move.from]}→${armies[move.to]}) ${moveType} [${phase}]`);
      
      // Track move history
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
      console.log(`T${this.turnCount} NO MOVES (${myTiles}t, ${availableMoves}av) [${phase}]`);
    }
  }

  private getCurrentPhase(): string {
    if (this.turnCount <= 15) {
      return 'FLOOD';
    } else if (this.turnCount <= 30) {
      return 'HYBRID';
    } else if (this.targetGeneral !== -1) {
      return 'ASSAULT';
    } else {
      return 'HUNT';
    }
  }

  private updateStrategicIntel(): void {
    const { armies, terrain } = this.parseMap();
    
    // Update discovered cities and towers
    for (let i = 0; i < terrain.length; i++) {
      if (terrain[i] === -6) this.discoveredCities.add(i);
      if (terrain[i] === -5) this.discoveredTowers.add(i);
    }
    
    // Update known enemy generals
    for (let i = 0; i < this.generals.length; i++) {
      if (i !== this.playerIndex && this.generals[i] !== -1) {
        this.knownEnemyGenerals.set(i, this.generals[i]);
        if (this.targetGeneral === -1) {
          this.targetGeneral = this.generals[i];
          console.log(`🎯 Enemy general discovered at position ${this.targetGeneral}!`);
        }
      }
    }
  }

  // PHASE 1: Lava Flood (Turns 1-15) - Maximum territorial expansion
  private findLavaFloodMove(): Move | null {
    const { width, height, armies, terrain } = this.parseMap();
    
    if (!width || !height || armies.length === 0) {
      return null;
    }

    const allMoves: Array<{from: number, to: number, priority: number, armies: number}> = [];
    const generalPos = this.generals[this.playerIndex];
    
    for (let i = 0; i < terrain.length; i++) {
      if (terrain[i] === this.playerIndex && armies[i] > 1) {
        const adjacent = getAdjacentIndices(i, width, height);
        
        for (const adj of adjacent) {
          let priority = 0;
          
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
            // Radial expansion bonus
            const radiationBonus = this.getRadiationBonus(i, adj, generalPos, width, height);
            priority += radiationBonus;
            
            // Push armies out from interior
            if (armies[i] > 10) {
              priority += Math.min(armies[i] * 2, 200);
            }
            
            allMoves.push({ from: i, to: adj, priority, armies: armies[i] });
          }
        }
      }
    }

    if (allMoves.length === 0) return null;

    allMoves.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return b.armies - a.armies;
    });

    return { from: allMoves[0].from, to: allMoves[0].to };
  }

  // PHASE 2: Hybrid (Turns 16-30) - Expansion + Enemy Search
  private findHybridMove(): Move | null {
    const { width, height, armies, terrain } = this.parseMap();
    
    if (!width || !height || armies.length === 0) {
      return null;
    }

    // Priority 1: Attack any visible enemy territory
    const enemyAttacks: Array<{from: number, to: number, armies: number}> = [];
    
    for (let i = 0; i < terrain.length; i++) {
      if (terrain[i] === this.playerIndex && armies[i] > 3) {
        const adjacent = getAdjacentIndices(i, width, height);
        
        for (const adj of adjacent) {
          if (terrain[adj] >= 0 && terrain[adj] !== this.playerIndex) {
            enemyAttacks.push({ from: i, to: adj, armies: armies[i] });
          }
        }
      }
    }
    
    if (enemyAttacks.length > 0) {
      enemyAttacks.sort((a, b) => b.armies - a.armies);
      return { from: enemyAttacks[0].from, to: enemyAttacks[0].to };
    }

    // Priority 2: Continue lava flood expansion
    return this.findLavaFloodMove();
  }

  // PHASE 3: Hunt (Turns 31+, no general found) - Aggressive enemy search
  private findHuntMove(): Move | null {
    const { width, height, armies, terrain } = this.parseMap();
    
    if (!width || !height || armies.length === 0) {
      return null;
    }

    // Aggressive expansion to find enemies
    const expansionMoves: Array<{from: number, to: number, armies: number}> = [];
    
    for (let i = 0; i < terrain.length; i++) {
      if (terrain[i] === this.playerIndex && armies[i] > 5) {
        const adjacent = getAdjacentIndices(i, width, height);
        
        for (const adj of adjacent) {
          if (terrain[adj] === -1 || (terrain[adj] >= 0 && terrain[adj] !== this.playerIndex)) {
            expansionMoves.push({ from: i, to: adj, armies: armies[i] });
          }
        }
      }
    }
    
    if (expansionMoves.length > 0) {
      expansionMoves.sort((a, b) => b.armies - a.armies);
      return { from: expansionMoves[0].from, to: expansionMoves[0].to };
    }
    
    return null;
  }

  // PHASE 4: Assault (General found) - Coordinated attack
  private findAssaultMove(): Move | null {
    const { width, height, armies, terrain } = this.parseMap();
    
    if (!width || !height || armies.length === 0 || this.targetGeneral === -1) {
      return null;
    }

    // Calculate required force and available force
    const requiredForce = 50;
    const availableForce = this.calculateAvailableForce(terrain, armies);
    
    if (availableForce < requiredForce) {
      return this.findArmyAccumulationMove();
    }

    // Launch coordinated assault
    let bestMove: Move | null = null;
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

  // Helper methods
  private getRadiationBonus(from: number, to: number, generalPos: number, width: number, height: number): number {
    if (generalPos === -1 || generalPos === undefined) return 0;
    
    const fromDistToGeneral = this.getManhattanDistance(from, generalPos, width);
    const toDistToGeneral = this.getManhattanDistance(to, generalPos, width);
    
    if (toDistToGeneral > fromDistToGeneral) {
      return 100; // Encourage outward radiation
    }
    
    if (toDistToGeneral < fromDistToGeneral) {
      return -50; // Discourage inward movement
    }
    
    return 0;
  }

  private calculateAvailableForce(terrain: number[], armies: number[]): number {
    let totalForce = 0;
    for (let i = 0; i < terrain.length; i++) {
      if (terrain[i] === this.playerIndex && armies[i] > 5) {
        totalForce += armies[i] - 1;
      }
    }
    return totalForce;
  }

  private findArmyAccumulationMove(): Move | null {
    const { width, height, armies, terrain } = this.parseMap();
    
    // Find strongest army closest to target
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
    
    if (bestSource === -1) return null;
    
    // Move other armies toward accumulation point
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

  private findPathToTarget(start: number, target: number, width: number, height: number, terrain: number[]): number[] | null {
    const queue: Array<{pos: number, path: number[]}> = [{pos: start, path: [start]}];
    const visited = new Set<number>();
    
    while (queue.length > 0) {
      const {pos, path} = queue.shift()!;
      
      if (pos === target) {
        return path;
      }
      
      if (visited.has(pos)) continue;
      visited.add(pos);
      
      const adjacent = getAdjacentIndices(pos, width, height);
      for (const adj of adjacent) {
        if (!visited.has(adj) && terrain[adj] !== -2) {
          queue.push({pos: adj, path: [...path, adj]});
        }
      }
    }
    
    return null;
  }

  private getManhattanDistance(pos1: number, pos2: number, width: number): number {
    const x1 = pos1 % width;
    const y1 = Math.floor(pos1 / width);
    const x2 = pos2 % width;
    const y2 = Math.floor(pos2 / width);
    
    return Math.abs(x1 - x2) + Math.abs(y1 - y2);
  }

  private wouldOscillate(move: Move): boolean {
    if (this.lastMove && 
        this.lastMove.from === move.to && 
        this.lastMove.to === move.from) {
      return true;
    }

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

  private parseMap(): { width: number; height: number; armies: number[]; terrain: number[]; towerDefense: number[] } {
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

  console.log('Starting hybrid bot with:');
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
