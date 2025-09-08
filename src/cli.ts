#!/usr/bin/env node

import * as readline from 'readline';
import { GeneralsBot } from './bot';
import * as fs from 'fs';
import * as path from 'path';

interface BotConfig {
  username?: string;
  serverUrl?: string;
  gameId?: string;
}

class BotCLI {
  private rl: readline.Interface;
  private config: BotConfig = {};

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  async start() {
    console.log('🤖 Fog of War Bot Setup');
    console.log('========================\n');

    await this.loadConfig();
    await this.setupBot();
    await this.connectBot();
  }

  private async loadConfig() {
    const configPath = path.join(process.cwd(), '.bot-config.json');
    if (fs.existsSync(configPath)) {
      try {
        this.config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        console.log('📁 Loaded saved configuration\n');
      } catch (error) {
        console.log('⚠️ Could not load config file, starting fresh\n');
      }
    }
  }

  private async saveConfig() {
    const configPath = path.join(process.cwd(), '.bot-config.json');
    try {
      fs.writeFileSync(configPath, JSON.stringify(this.config, null, 2));
      console.log('💾 Configuration saved\n');
    } catch (error) {
      console.log('⚠️ Could not save configuration\n');
    }
  }

  private async setupBot() {
    // Username
    const defaultUsername = this.config.username || 'MyBot';
    const username = await this.prompt(`Bot username (${defaultUsername}): `);
    this.config.username = username || defaultUsername;

    // Server URL
    const defaultServer = this.config.serverUrl || 'https://fog-of-war-0f4f.onrender.com';
    const serverUrl = await this.prompt(`Server URL (${defaultServer}): `);
    this.config.serverUrl = serverUrl || defaultServer;

    // Game ID
    const defaultGame = this.config.gameId || 'auto-match';
    const gameId = await this.prompt(`Game ID (${defaultGame}): `);
    this.config.gameId = gameId === 'auto-match' ? undefined : (gameId || this.config.gameId);

    await this.saveConfig();
  }

  private async connectBot() {
    console.log('\n🚀 Starting bot with configuration:');
    console.log(`   Username: ${this.config.username}`);
    console.log(`   Server: ${this.config.serverUrl}`);
    console.log(`   Game: ${this.config.gameId || 'Auto-match'}\n`);

    // Set environment variables for the bot
    process.env.BOT_USER_ID = this.config.username;

    const bot = new GeneralsBot(this.config.serverUrl, this.config.gameId);

    // Add CLI controls
    console.log('Bot Controls:');
    console.log('  [ENTER] - Force start game (if host)');
    console.log('  [q] - Quit bot');
    console.log('  [r] - Restart with new config\n');

    this.rl.on('line', (input) => {
      const command = input.trim().toLowerCase();
      
      if (command === 'q' || command === 'quit') {
        console.log('👋 Shutting down bot...');
        bot.socket.disconnect();
        process.exit(0);
      } else if (command === 'r' || command === 'restart') {
        console.log('🔄 Restarting with new configuration...');
        bot.socket.disconnect();
        this.config = {};
        setTimeout(() => this.start(), 1000);
      } else if (command === '' && this.config.gameId) {
        console.log('🚀 Force starting game...');
        bot.socket.emit('set_force_start', this.config.gameId, true);
      }
    });
  }

  private prompt(question: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(question, resolve);
    });
  }
}

// Export the bot class for programmatic use
export { GeneralsBot };

// Run CLI if this file is executed directly
if (require.main === module) {
  const cli = new BotCLI();
  cli.start().catch(console.error);
}
