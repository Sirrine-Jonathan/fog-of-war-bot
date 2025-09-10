// Simple test to see bot errors without CLI interaction
const { GeneralsBot } = require('./dist/bot');

const bot = new GeneralsBot();

// Mock game state for testing
const mockGameState = {
  width: 10,
  height: 10,
  armies: new Array(100).fill(1),
  terrain: new Array(100).fill(-1), // All empty
  towerDefense: new Array(100).fill(0)
};

// Set some owned territory
mockGameState.terrain[45] = 0; // Player 0 general
mockGameState.armies[45] = 5;
mockGameState.terrain[46] = 0; // Player 0 territory
mockGameState.armies[46] = 3;

// Set some cities
mockGameState.terrain[20] = -6; // City
mockGameState.armies[20] = 40;

console.log('Testing bot strategic analysis...');

try {
  // Test the strategic components directly
  const gameIntelligence = new (require('./dist/bot').GameIntelligence)();
  console.log('GameIntelligence created successfully');
  
  gameIntelligence.updateIntelligence(mockGameState, [45, -1, -1, -1], 0, 1);
  console.log('Intelligence update successful');
  
  const territoryValue = gameIntelligence.getTerritoryValue();
  console.log('Territory values:', territoryValue.slice(0, 10));
  
} catch (error) {
  console.log('ERROR in strategic analysis:', error.message);
  console.log('Stack:', error.stack);
}
