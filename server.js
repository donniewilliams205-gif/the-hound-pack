'use strict';
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { Server } = require('socket.io');

const store = require('./store');
const pkg = require('./package.json');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
const FOUNDER_USERNAME = (process.env.FOUNDER_USERNAME || 'bludhound420').toLowerCase();
if (!process.env.JWT_SECRET) {
  console.warn('WARNING: JWT_SECRET is not set. Using a development fallback — set it in production!');
}

store.load();
const db = store.db;

const ROOMS = ['The Den', 'Clip Vault', 'Pet Pics', 'Setup Flex', 'Chill Corner', 'Meme Cave', 'Wins & Fails', 'Beats & Music', 'Munchie Runs'];
const ADULT_ROOM = 'Chill Corner';
const GIFT_CATALOG = [
  { id: 'gg-token', name: 'GG Token', emoji: '🪙', cost: 10 },
  { id: 'loot-gem', name: 'Loot Gem', emoji: '💎', cost: 25 },
  { id: 'health-pack', name: 'Health Pack', emoji: '🧰', cost: 15 },
  { id: 'champion-crown', name: 'Champion Crown', emoji: '👑', cost: 100 },
  { id: 'pizza-slice', name: 'Pizza Slice', emoji: '🍕', cost: 12 },
  { id: 'golden-joystick', name: 'Golden Joystick', emoji: '🕹️', cost: 50 },
  { id: 'moon-herb', name: 'Moon Herb', emoji: '🌿', cost: 20 },
  { id: 'star-fragment', name: 'Star Fragment', emoji: '⭐', cost: 40 },
];
const STARTING_COINS = 100;
const POST_REWARD = 5;
const DAILY_HOWL_REWARD = 20;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false } }); // same-origin only

app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      mediaSrc: ["'self'", 'blob:', 'https:'],
      frameSrc: ["'self'", 'https://www.youtube.com', 'https://www.youtube-nocookie.com', 'https://player.vimeo.com'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use('/uploads', express.static(store.UPLOADS_DIR, { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, 'public')));

function onRateLimit(req) {
  store.logSecurity('rate_limit', `${req.method} ${req.originalUrl} from ${req.ip}`);
  store.save();
}
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false, handler: (req, res) => { onRateLimit(req); res.status(429).json({ error: 'Too many requests. Slow down a bit.' }); } });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, handler: (req, res) => { onRateLimit(req); res.status(429).json({ error: 'Too many login attempts. Try again in a few minutes.' }); } });
app.use('/api', apiLimiter);

/* ---------------- auth helpers ---------------- */
function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, username: u.username, displayName: u.displayName, avatarEmoji: u.avatarEmoji,
    bio: u.bio, coins: u.coins, xp: u.xp, level: Math.floor(Math.sqrt(u.xp / 50)) + 1,
    isFounder: !!u.isFounder, isAdult: !!u.isAdult, createdAt: u.createdAt,
    postCount: db.posts.filter(p => p.authorId === u.id).length,
    giftsReceived: db.gifts.filter(g => g.toId === u.id).length,
  };
}
function signToken(user) {
  return jwt.sign({ uid: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
}
function setSession(res, user) {
  res.cookie('hp_session', signToken(user), {
    httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production',
  });
}
function userFromToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return db.users.find(u => u.id === payload.uid) || null;
  } catch (e) { return null; }
}
function currentUser(req) {
  return userFromToken(req.cookies && req.cookies.hp_session);
}
function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Please log in first.' });
  req.user = user;
  next();
}
function addXp(user, amount) { user.xp = (user.xp || 0) + amount; }

/* ---------------- auth routes ---------------- */
const USERNAME_RE = /^[a-zA-Z0-9_]{3,24}$/;
app.post('/api/auth/signup', authLimiter, async (req, res) => {
  const { username, displayName, password, avatarEmoji, isAdult } = req.body || {};
  const uname = String(username || '').trim();
  if (!USERNAME_RE.test(uname)) return res.status(400).json({ error: 'Username must be 3–24 letters, numbers or underscores.' });
  if (!password || String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (db.users.some(u => u.username.toLowerCase() === uname.toLowerCase())) {
    return res.status(409).json({ error: 'That username is already taken.' });
  }
  const passwordHash = await bcrypt.hash(String(password), 12);
  const user = {
    id: store.uid(),
    username: uname,
    displayName: String(displayName || uname).trim().slice(0, 40) || uname,
    avatarEmoji: String(avatarEmoji || '🎮').slice(0, 8),
    bio: '',
    passwordHash,
    coins: STARTING_COINS,
    xp: 0,
    isFounder: uname.toLowerCase() === FOUNDER_USERNAME,
    isAdult: !!isAdult,
    lastHowlDate: null,
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  store.logSecurity('signup', `${user.username}${user.isFounder ? ' (founder)' : ''} signed up`);
  store.save();
  setSession(res, user);
  res.status(201).json({ user: publicUser(user) });
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  const user = db.users.find(u => u.username.toLowerCase() === String(username || '').trim().toLowerCase());
  const ok = user && await bcrypt.compare(String(password || ''), user.passwordHash);
  if (!ok) {
    store.logSecurity('failed_login', `Failed login for "${String(username || '')}" from ${req.ip}`);
    store.save();
    return res.status(401).json({ error: 'Wrong username or password.' });
  }
  setSession(res, user);
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('hp_session');
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  res.json({ user: publicUser(currentUser(req)) });
});

/* ---------------- posts ---------------- */
function publicPost(p) {
  const reactions = {};
  for (const [emoji, ids] of Object.entries(p.reactions || {})) reactions[emoji] = ids.length;
  return { ...p, reactions, reactionUsers: undefined };
}
function canSeeRoom(user, room) {
  if (room === ADULT_ROOM) return !!(user && user.isAdult);
  return true;
}
app.get('/api/posts', (req, res) => {
  const user = currentUser(req);
  let posts = db.posts.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const room = req.query.room;
  if (room && ROOMS.includes(room)) posts = posts.filter(p => p.room === room);
  posts = posts.filter(p => p.room !== ADULT_ROOM || canSeeRoom(user, ADULT_ROOM) || p.authorId === (user && user.id));
  res.json({ posts: posts.map(publicPost) });
});

app.post('/api/posts', requireAuth, (req, res) => {
  const { kind, title, body, room, imageUrl, mediaUrl } = req.body || {};
  const cleanKind = ['moment', 'picture', 'clip'].includes(kind) ? kind : 'moment';
  const cleanRoom = ROOMS.includes(room) ? room : 'The Den';
  if (cleanRoom === ADULT_ROOM && !req.user.isAdult) {
    return res.status(403).json({ error: 'The Chill Corner is 21+. Confirm you are 21+ on your profile to post there.' });
  }
  const cleanTitle = String(title || '').trim().slice(0, 120);
  if (!cleanTitle) return res.status(400).json({ error: 'Give your post a title.' });
  if (cleanKind === 'picture' && !imageUrl) return res.status(400).json({ error: 'Add a picture (upload one or paste an image link).' });
  if (cleanKind === 'clip' && !mediaUrl) return res.status(400).json({ error: 'Paste a YouTube or video link for your clip.' });
  const post = {
    id: store.uid(), authorId: req.user.id, authorName: req.user.username,
    authorDisplay: req.user.displayName, authorEmoji: req.user.avatarEmoji,
    room: cleanRoom, kind: cleanKind, title: cleanTitle,
    body: String(body || '').slice(0, 2000),
    imageUrl: cleanKind === 'picture' ? String(imageUrl).slice(0, 1000) : '',
    mediaUrl: cleanKind === 'clip' ? String(mediaUrl).slice(0, 1000) : '',
    createdAt: new Date().toISOString(), reactions: {}, comments: [], shares: 0,
  };
  db.posts.push(post);
  req.user.coins += POST_REWARD;
  addXp(req.user, 10);
  store.save();
  io.emit('post:new', publicPost(post));
  res.status(201).json({ post: publicPost(post), coins: req.user.coins });
});

app.delete('/api/posts/:id', requireAuth, (req, res) => {
  const idx = db.posts.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Post not found.' });
  if (db.posts[idx].authorId !== req.user.id && !req.user.isFounder) return res.status(403).json({ error: 'You can only delete your own posts.' });
  db.posts.splice(idx, 1);
  store.save();
  res.json({ ok: true });
});

app.post('/api/posts/:id/comments', requireAuth, (req, res) => {
  const post = db.posts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found.' });
  const body = String((req.body || {}).body || '').trim().slice(0, 600);
  if (!body) return res.status(400).json({ error: 'Write a comment first.' });
  const comment = { id: store.uid(), userId: req.user.id, username: req.user.username, displayName: req.user.displayName, body, createdAt: new Date().toISOString() };
  post.comments.push(comment);
  addXp(req.user, 2);
  store.save();
  io.emit('post:update', publicPost(post));
  res.status(201).json({ comment });
});

app.post('/api/posts/:id/reactions', requireAuth, (req, res) => {
  const post = db.posts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found.' });
  const emoji = String((req.body || {}).emoji || '').slice(0, 8);
  if (!emoji) return res.status(400).json({ error: 'Pick an emote.' });
  post.reactions = post.reactions || {};
  const list = post.reactions[emoji] || (post.reactions[emoji] = []);
  const i = list.indexOf(req.user.id);
  if (i >= 0) list.splice(i, 1); else { list.push(req.user.id); addXp(req.user, 1); }
  if (!list.length) delete post.reactions[emoji];
  store.save();
  io.emit('post:update', publicPost(post));
  res.json({ reactions: publicPost(post).reactions });
});

app.post('/api/posts/:id/share', (req, res) => {
  const post = db.posts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found.' });
  post.shares = (post.shares || 0) + 1;
  store.save();
  res.json({ shares: post.shares, link: `/` });
});

/* ---------------- uploads ---------------- */
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, store.UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
      cb(null, `${store.uid()}${ext || '.jpg'}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Only JPG, PNG, GIF or WebP pictures are allowed.'), ok);
  },
});
app.post('/api/upload', requireAuth, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed.' });
    if (!req.file) return res.status(400).json({ error: 'No picture received.' });
    res.status(201).json({ url: `/uploads/${req.file.filename}` });
  });
});

/* ---------------- members & profiles ---------------- */
app.get('/api/members', (req, res) => {
  const members = db.users.map(publicUser).sort((a, b) => (b.xp - a.xp) || (b.coins - a.coins));
  res.json({ members });
});
app.get('/api/profile/:username', (req, res) => {
  const user = db.users.find(u => u.username.toLowerCase() === req.params.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Member not found.' });
  const gifts = db.gifts.filter(g => g.toId === user.id).slice(-20).reverse();
  res.json({ user: publicUser(user), giftsReceived: gifts });
});
app.post('/api/profile', requireAuth, (req, res) => {
  const { displayName, avatarEmoji, bio, isAdult } = req.body || {};
  if (displayName) req.user.displayName = String(displayName).trim().slice(0, 40) || req.user.displayName;
  if (avatarEmoji) req.user.avatarEmoji = String(avatarEmoji).slice(0, 8);
  if (bio !== undefined) req.user.bio = String(bio).slice(0, 300);
  if (isAdult !== undefined) req.user.isAdult = !!isAdult;
  store.save();
  res.json({ user: publicUser(req.user) });
});

/* ---------------- gifts & coins ---------------- */
app.get('/api/gifts/catalog', (req, res) => res.json({ catalog: GIFT_CATALOG }));
app.post('/api/gifts/send', requireAuth, (req, res) => {
  const { toUsername, giftId, postId } = req.body || {};
  const gift = GIFT_CATALOG.find(g => g.id === giftId);
  if (!gift) return res.status(400).json({ error: 'Pick a gift from the catalog.' });
  const recipient = db.users.find(u => u.username.toLowerCase() === String(toUsername || '').toLowerCase());
  if (!recipient) return res.status(404).json({ error: 'Recipient not found.' });
  if (recipient.id === req.user.id) return res.status(400).json({ error: 'You cannot gift yourself.' });
  if (req.user.coins < gift.cost) return res.status(400).json({ error: `Not enough Hound Coins (you have ${req.user.coins}, this gift costs ${gift.cost}).` });
  req.user.coins -= gift.cost;
  recipient.coins += gift.cost;
  addXp(req.user, 5);
  const record = {
    id: store.uid(), fromId: req.user.id, fromName: req.user.username,
    toId: recipient.id, toName: recipient.username,
    giftId: gift.id, giftName: gift.name, giftEmoji: gift.emoji, cost: gift.cost,
    postId: postId || null, createdAt: new Date().toISOString(),
  };
  db.gifts.push(record);
  if (postId) {
    const post = db.posts.find(p => p.id === postId);
    if (post) io.emit('post:update', publicPost(post));
  }
  store.save();
  io.emit('gift:new', record);
  res.status(201).json({ gift: record, coins: req.user.coins });
});
app.get('/api/gifts/mine', requireAuth, (req, res) => {
  res.json({
    received: db.gifts.filter(g => g.toId === req.user.id).slice(-50).reverse(),
    sent: db.gifts.filter(g => g.fromId === req.user.id).slice(-50).reverse(),
  });
});

/* ---------------- chat (REST read + fallback post) ---------------- */
function saveChatMessage(user, channel, body) {
  const msg = {
    id: store.uid(), channel: channel || 'lobby', userId: user.id,
    username: user.username, displayName: user.displayName,
    body: String(body || '').trim().slice(0, 500), createdAt: new Date().toISOString(),
  };
  if (!msg.body) return null;
  db.chatMessages.push(msg);
  db.chatMessages = db.chatMessages.slice(-500);
  addXp(user, 1);
  store.save();
  io.to(`chat:${msg.channel}`).emit('chat:message', msg);
  io.emit('chat:message:all', msg);
  return msg;
}
app.get('/api/chat', (req, res) => {
  const channel = String(req.query.channel || 'lobby');
  res.json({ messages: db.chatMessages.filter(m => m.channel === channel).slice(-100) });
});
app.post('/api/chat', requireAuth, (req, res) => {
  const msg = saveChatMessage(req.user, (req.body || {}).channel, (req.body || {}).body);
  if (!msg) return res.status(400).json({ error: 'Write a message first.' });
  res.status(201).json({ message: msg });
});

/* ---------------- events, poll, quests ---------------- */
app.get('/api/events', (req, res) => {
  const user = currentUser(req);
  res.json({ events: db.events.map(e => ({ ...e, rsvpCount: e.rsvps.length, going: user ? e.rsvps.includes(user.id) : false })) });
});
app.post('/api/events/:id/rsvp', requireAuth, (req, res) => {
  const ev = db.events.find(e => e.id === req.params.id);
  if (!ev) return res.status(404).json({ error: 'Event not found.' });
  const i = ev.rsvps.indexOf(req.user.id);
  if (i >= 0) ev.rsvps.splice(i, 1); else ev.rsvps.push(req.user.id);
  store.save();
  res.json({ going: i < 0, rsvpCount: ev.rsvps.length });
});
app.post('/api/events', requireAuth, (req, res) => {
  if (!req.user.isFounder) return res.status(403).json({ error: 'Only the Founder can add events.' });
  const { title, date, description } = req.body || {};
  if (!String(title || '').trim()) return res.status(400).json({ error: 'Give the event a title.' });
  const ev = { id: store.uid(), title: String(title).trim().slice(0, 100), date: String(date || '').slice(0, 60), description: String(description || '').slice(0, 400), rsvps: [], createdAt: new Date().toISOString() };
  db.events.push(ev);
  store.save();
  res.status(201).json({ event: ev });
});

app.get('/api/poll', (req, res) => {
  const user = currentUser(req);
  res.json({
    question: db.poll.question,
    options: db.poll.options.map(o => ({ id: o.id, text: o.text, votes: o.votes.length, mine: user ? o.votes.includes(user.id) : false })),
  });
});
app.post('/api/poll/vote', requireAuth, (req, res) => {
  const opt = db.poll.options.find(o => o.id === (req.body || {}).optionId);
  if (!opt) return res.status(400).json({ error: 'Pick an option.' });
  for (const o of db.poll.options) {
    const i = o.votes.indexOf(req.user.id);
    if (i >= 0) o.votes.splice(i, 1);
  }
  opt.votes.push(req.user.id);
  store.save();
  res.json({ ok: true });
});

app.post('/api/quests/daily-howl', requireAuth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  if (req.user.lastHowlDate === today) return res.status(400).json({ error: 'You already claimed your Daily Howl today. Come back tomorrow!' });
  req.user.lastHowlDate = today;
  req.user.coins += DAILY_HOWL_REWARD;
  addXp(req.user, 5);
  store.save();
  res.json({ coins: req.user.coins, reward: DAILY_HOWL_REWARD });
});

/* ---------------- system / security center ---------------- */
app.get('/api/system', (req, res) => {
  const user = currentUser(req);
  const base = {
    name: 'The Hound Pack', version: pkg.version, shield: 'Aegis Shield',
    memberCount: db.users.length, postCount: db.posts.length,
    uptimeSeconds: Math.floor(process.uptime()),
  };
  if (user && user.isFounder) {
    base.securityEvents = db.securityEvents.slice(0, 50);
    base.isFounder = true;
  }
  res.json(base);
});

/* ---------------- Socket.IO: chat + WebRTC signaling ---------------- */
function socketUser(socket) {
  const cookieHeader = socket.handshake.headers.cookie || '';
  const match = cookieHeader.match(/hp_session=([^;]+)/);
  if (!match) return null;
  return userFromToken(decodeURIComponent(match[1]));
}
io.on('connection', (socket) => {
  const user = socketUser(socket);
  socket.on('chat:join', (channel) => socket.join(`chat:${channel || 'lobby'}`));
  socket.on('chat:send', (payload) => {
    if (!user) return socket.emit('chat:error', 'Please log in to chat.');
    saveChatMessage(user, (payload || {}).channel, (payload || {}).body);
  });

  // Voice & Video Lounge signaling (WebRTC mesh for small channels)
  let vcChannel = null;
  socket.on('vc:join', (channel) => {
    if (!user) return socket.emit('vc:error', 'Please log in to join the Voice & Video Lounge.');
    vcChannel = String(channel || 'lounge-1').slice(0, 40);
    socket.join(`vc:${vcChannel}`);
    socket.data.vcUser = { id: user.id, username: user.username, displayName: user.displayName };
    socket.to(`vc:${vcChannel}`).emit('vc:peer-joined', { socketId: socket.id, user: socket.data.vcUser });
    const peers = [];
    const room = io.sockets.adapter.rooms.get(`vc:${vcChannel}`);
    if (room) for (const sid of room) {
      if (sid === socket.id) continue;
      const s = io.sockets.sockets.get(sid);
      if (s && s.data.vcUser) peers.push({ socketId: sid, user: s.data.vcUser });
    }
    socket.emit('vc:peers', peers);
  });
  socket.on('vc:signal', ({ to, data }) => {
    if (to && data) io.to(to).emit('vc:signal', { from: socket.id, data });
  });
  socket.on('vc:state', (state) => {
    if (vcChannel) socket.to(`vc:${vcChannel}`).emit('vc:peer-state', { socketId: socket.id, state });
  });
  const leaveVc = () => {
    if (vcChannel) {
      socket.to(`vc:${vcChannel}`).emit('vc:peer-left', { socketId: socket.id });
      socket.leave(`vc:${vcChannel}`);
      vcChannel = null;
    }
  };
  socket.on('vc:leave', leaveVc);
  socket.on('disconnect', leaveVc);
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`🐺 The Hound Pack v${pkg.version} is running on http://localhost:${PORT}`);
  console.log(`   Data directory: ${store.DATA_DIR}`);
});
