import express from 'express';
import path from 'path';
import { GeneralsBot } from './bot';
import * as dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const WEB_PASSWORD = process.env.WEB_PASSWORD || 'botcontrol';

app.use(express.json());

// Auth middleware for static files
const staticAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  // Allow login.html, shared.css, and API routes without this auth check
  if (req.path === '/login.html' || req.path === '/shared.css' || req.path.startsWith('/api/')) {
    next();
    return;
  }
  
  const sessionId = req.headers.cookie?.split('session=')[1]?.split(';')[0];
  if (sessionId && sessions.has(sessionId)) {
    next();
  } else {
    res.redirect('/login.html');
  }
};

app.use(staticAuth);
app.use(express.static(path.join(__dirname, '../public')));

// Simple session storage (in production, use proper session management)
const sessions = new Set<string>();

// Auth middleware
const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const sessionId = req.headers.cookie?.split('session=')[1]?.split(';')[0];
  if (sessions.has(sessionId || '')) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

// Initialize bot
const args = process.argv.slice(2);
const serverUrl = args.find(arg => arg.startsWith('--server='))?.split('=')[1] || 
                  process.env.HOST || 
                  'https://fog-of-war-0f4f.onrender.com';

let bot = new GeneralsBot(serverUrl);

// Routes
app.get('/', (req, res) => {
  const sessionId = req.headers.cookie?.split('session=')[1]?.split(';')[0];
  console.log('Session check:', sessionId, 'Valid:', sessions.has(sessionId || ''));
  if (sessionId && sessions.has(sessionId)) {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  } else {
    res.sendFile(path.join(__dirname, '../public/login.html'));
  }
});

app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === WEB_PASSWORD) {
    const sessionId = Math.random().toString(36).substring(7);
    sessions.add(sessionId);
    res.setHeader('Set-Cookie', `session=${sessionId}; Path=/; HttpOnly`);
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

app.get('/api/status', requireAuth, (req, res) => {
  const status = {
    connected: bot.socket?.connected || false,
    inGame: bot.playerIndex >= 0,
    gameId: bot.gameId,
    currentRoom: bot.currentRoom || 'Lobby',
    username: process.env.BOT_USER_ID,
    serverUrl: bot.serverUrl
  };
  res.json(status);
});

app.post('/api/username', requireAuth, (req, res) => {
  const { username } = req.body;
  if (!username) {
    return res.status(400).json({ error: 'Username required' });
  }
  
  process.env.BOT_USER_ID = username;
  if (bot.socket?.connected) {
    bot.socket.emit('set_username', username, username);
  }
  res.json({ success: true });
});

app.post('/api/join', requireAuth, (req, res) => {
  const { gameId } = req.body;
  const userId = process.env.BOT_USER_ID;
  
  if (!userId) {
    return res.status(400).json({ error: 'Bot user ID not set' });
  }
  
  if (!gameId) {
    return res.status(400).json({ error: 'Game ID is required' });
  }
  
  if (!bot.socket?.connected) {
    return res.status(400).json({ error: 'Bot not connected' });
  }
  
  console.log(`🎮 Attempting to join game: ${gameId} (currently in: ${bot.currentRoom})`);
  bot.gameId = gameId;
  bot.socket.emit('join_private', gameId, userId);
  
  res.json({ success: true });
});

app.post('/api/leave', requireAuth, (req, res) => {
  if (!bot.socket?.connected) {
    return res.status(400).json({ error: 'Bot not connected' });
  }
  
  // Disconnect and reconnect to leave game
  bot.socket.disconnect();
  setTimeout(() => {
    bot = new GeneralsBot(serverUrl, undefined);
  }, 1000);
  
  res.json({ success: true });
});

app.post('/api/reconnect', requireAuth, (req, res) => {
  bot.socket?.disconnect();
  setTimeout(() => {
    bot = new GeneralsBot(serverUrl, bot.gameId);
  }, 1000);
  
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`🌐 Web interface running on port ${PORT}`);
  console.log(`🔑 Password: ${WEB_PASSWORD}`);
  console.log(`🤖 Bot connecting to: ${serverUrl}`);
});
