'use strict';
/*
 * The Hound Pack datastore.
 *
 * Choice: a single JSON file on disk (db.json inside DATA_DIR).
 * - Writes are atomic: data is written to db.json.tmp, then renamed over
 *   db.json, so a crash mid-write cannot corrupt the database.
 * - Before each replace we keep db.backup.json (the previous good copy).
 * - All data lives in memory and is flushed on every change (save()).
 * - This is deliberately simple and dependency-free. It works well for a
 *   small/medium community on a host with a persistent disk (Render disk).
 *   If the community outgrows it, migrate to Postgres (e.g. Supabase) —
 *   see README.md.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const DB_FILE = path.join(DATA_DIR, 'db.json');
const BACKUP_FILE = path.join(DATA_DIR, 'db.backup.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

function uid() {
  return crypto.randomBytes(9).toString('hex');
}

function seedData() {
  const now = new Date().toISOString();
  return {
    users: [],
    posts: [
      {
        id: 'welcome-post',
        authorId: 'founder',
        authorName: 'bludhound420',
        authorDisplay: 'Houndy',
        authorEmoji: '🐺',
        room: 'The Den',
        kind: 'moment',
        title: 'Welcome to The Hound Pack! 🐺🎮',
        body: "Hey everyone, I'm Houndy (Bludhound420) — welcome to The Hound Pack! This is our spot to share your best gaming clips, pictures, wins, and funny moments. Say hi in the lobby, drop an emote, and show me what you've been playing. Let's build this community together!",
        imageUrl: '',
        mediaUrl: '',
        createdAt: now,
        reactions: {},
        comments: [],
        shares: 0,
      },
    ],
    gifts: [], // {id, fromId, fromName, toId, toName, giftId, giftName, cost, postId, createdAt}
    chatMessages: [], // {id, channel, userId, username, displayName, body, createdAt}
    events: [
      {
        id: uid(),
        title: 'Pack Game Night',
        date: 'Every Saturday, 8pm CT',
        description: 'Squad up in the Voice & Video Lounge and the lobby chat. All games welcome.',
        rsvps: [],
        createdAt: now,
      },
      {
        id: uid(),
        title: 'Clip Contest',
        date: 'Last Friday of the month',
        description: 'Post your best clip in the Clip Vault. Most 🔥 reactions wins the Champion Crown.',
        rsvps: [],
        createdAt: now,
      },
    ],
    poll: {
      question: 'Game of the Week — what should the Pack play together?',
      options: [
        { id: 'opt1', text: 'Shooter night', votes: [] },
        { id: 'opt2', text: 'Racing tournament', votes: [] },
        { id: 'opt3', text: 'Co-op survival', votes: [] },
        { id: 'opt4', text: 'Retro / party games', votes: [] },
      ],
    },
    securityEvents: [], // {id, type, detail, createdAt}
  };
}

let db = null;

function load() {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  for (const file of [DB_FILE, BACKUP_FILE]) {
    try {
      if (fs.existsSync(file)) {
        db = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (db && Array.isArray(db.users) && Array.isArray(db.posts)) return db;
      }
    } catch (e) {
      // fall through to backup / seed
    }
  }
  db = seedData();
  save();
  return db;
}

function save() {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  try {
    if (fs.existsSync(DB_FILE)) fs.copyFileSync(DB_FILE, BACKUP_FILE);
  } catch (e) { /* backup is best-effort */ }
  fs.renameSync(tmp, DB_FILE);
}

function logSecurity(type, detail) {
  db.securityEvents.unshift({ id: uid(), type, detail: String(detail || ''), createdAt: new Date().toISOString() });
  db.securityEvents = db.securityEvents.slice(0, 200);
}

module.exports = { load, save, uid, logSecurity, DATA_DIR, DB_FILE, UPLOADS_DIR, get db() { return db; } };
