# Generals.io TypeScript Bot

A TypeScript bot for playing generals.io built from the reverse-engineered API documentation.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set your bot user ID:
```bash
cp .env.example .env
# Edit .env and set your BOT_USER_ID
```

3. Build and run:
```bash
npm run build
npm start
```

Or run in development mode:
```bash
npm run dev
```

## Bot Strategy

This bot implements a simple expansion-focused strategy:
- Expands to neutral territory when possible
- Attacks weak enemy positions
- Prioritizes moves with army advantage

## Environment Variables

- `BOT_USER_ID`: Your unique bot identifier (required)

Keep your BOT_USER_ID secret - anyone with it can control your bot!
