// Quick debug script to test bot logic
const fs = require('fs');

// Read the current bot.ts file and add try-catch blocks around strategic methods
const botCode = fs.readFileSync('./src/bot.ts', 'utf8');

// Find the makeMove method and wrap strategic calls in try-catch
const debuggedCode = botCode.replace(
  /private makeMove\(\): void \{[\s\S]*?\n  \}/,
  `private makeMove(): void {
    try {
      const gameState = this.parseMap();
      if (!gameState.width || !gameState.height) return;

      console.log(\`T\${this.turnCount} DEBUG: Starting strategic analysis\`);
      
      // Update strategic intelligence
      try {
        this.gameIntelligence.updateIntelligence(gameState, this.generals, this.playerIndex, this.turnCount);
        console.log(\`T\${this.turnCount} DEBUG: Intelligence updated successfully\`);
      } catch (e) {
        console.log(\`T\${this.turnCount} ERROR: Intelligence update failed:\`, e.message);
        return;
      }
      
      // Detect current game phase
      let gamePhase;
      try {
        gamePhase = this.gamePhaseManager.detectGamePhase(gameState, this.gameIntelligence, this.playerIndex, this.turnCount);
        console.log(\`T\${this.turnCount} DEBUG: Game phase detected: \${gamePhase.phase}\`);
      } catch (e) {
        console.log(\`T\${this.turnCount} ERROR: Game phase detection failed:\`, e.message);
        gamePhase = { phase: 'EXPANSION', strategy: 'fallback', priorities: [] };
      }
      
      // Plan strategic objectives
      let objectives;
      try {
        objectives = this.strategicPlanner.planStrategy(gameState, this.gameIntelligence, this.playerIndex, this.turnCount);
        console.log(\`T\${this.turnCount} DEBUG: Found \${objectives.length} objectives\`);
      } catch (e) {
        console.log(\`T\${this.turnCount} ERROR: Strategic planning failed:\`, e.message);
        objectives = [];
      }
      
      // Find optimal move
      const move = this.findOptimalMove(gameState, objectives);
      
      if (move) {
        const moveType = this.getMoveType(move.to, gameState.terrain);
        console.log(\`T\${this.turnCount} \${gamePhase.phase}: \${move.from}→\${move.to}(\${gameState.armies[move.from]}→\${gameState.armies[move.to]}) \${moveType} [\${move.priority || 'TACTICAL'}]\`);
        this.socket.emit('attack', move.from, move.to);
      } else {
        console.log(\`T\${this.turnCount} NO MOVES - Strategic analysis failed\`);
      }
    } catch (e) {
      console.log(\`T\${this.turnCount} CRITICAL ERROR in makeMove:\`, e.message, e.stack);
    }
  }`
);

fs.writeFileSync('./src/bot-debug.ts', debuggedCode);
console.log('Created debug version at src/bot-debug.ts');
