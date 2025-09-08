# Fog of War Bot

An intelligent TypeScript bot for the Fog of War generals game with enhanced strategy and user-friendly CLI.

## Features

### 🧠 Enhanced Strategy
- **Priority-based decision making**: Targets generals > cities > towers > expansion > enemies
- **Tower awareness**: Understands tower defense mechanics (30+ defense)
- **City prioritization**: Captures cities for consistent army generation
- **Failed move tracking**: Avoids repeating unsuccessful moves
- **Smart expansion**: Prefers easier captures and strategic positioning

### 🎮 User-Friendly CLI
- **Interactive setup**: Guided configuration for username, server, and game
- **Configuration persistence**: Saves settings for future use
- **Real-time controls**: Force start games, restart with new config, quit gracefully
- **Visual feedback**: Clear status updates and move reasoning

## Quick Start

### Using the CLI (Recommended)
```bash
npm run dev-cli
```

The CLI will guide you through:
1. Setting your bot username
2. Choosing server URL
3. Joining a specific game or auto-matching
4. Real-time game controls

### Traditional Usage
```bash
# Set environment variables
export BOT_USER_ID="MyBot"

# Run with specific game
npm run dev -- --server=https://fog-of-war-0f4f.onrender.com --game=test

# Run locally
npm run local
```

## Configuration

The CLI creates a `.bot-config.json` file to remember your preferences:
```json
{
  "username": "MyBot",
  "serverUrl": "https://fog-of-war-0f4f.onrender.com",
  "gameId": "test"
}
```

## Bot Strategy

### Priority System
1. **Attack Generals (200)**: Game-winning moves
2. **Capture Cities (100)**: High-value army generators
3. **Capture Towers (80)**: Defensive positions when feasible
4. **Expand Territory (50+)**: Claim neutral ground
5. **Attack Enemies (40+)**: Weaken opponents
6. **Reinforce (10)**: Consolidate forces

### Game Mechanics Understanding
- **Lookout Towers**: Require 30+ armies to capture
- **Cities**: Generate 1 army per turn when owned
- **Generals**: Generate 1 army per turn, capturing eliminates player
- **Regular Territory**: Generates 1 army every 25 turns

## Controls (CLI Mode)

- **[ENTER]**: Force start game (if host)
- **[q]**: Quit bot
- **[r]**: Restart with new configuration

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run development mode
npm run dev

# Run CLI in development
npm run dev-cli
```

## Game Server

This bot connects to the Fog of War game server. See the [server documentation](https://github.com/Sirrine-Jonathan/fog-of-war-bot) for more details on game mechanics and API.
