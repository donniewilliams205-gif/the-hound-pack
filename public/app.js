'use strict';
const $ = (id) => document.getElementById(id);
const ROOMS = ['The Den', 'Clip Vault', 'Pet Pics', 'Setup Flex', 'Chill Corner', 'Meme Cave', 'Wins & Fails', 'Beats & Music', 'Munchie Runs', 'Looking for Squad'];
const REACTIONS = ['🔥', '❤️', '😂', '🎮', '🐺', '🌿'];
let me = null;
let currentRoom = 'All Rooms';
let postKind = 'moment';
let selectedGift = null;
let giftCatalog = [];
const socket = io({ autoConnect: true });

async function api(url, options = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function youtubeEmbed(url) {
  const m = String(url).match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/);
  return m ? `https://www.youtube-nocookie.com/embed/${m[1]}` : null;
}

/* ---------- auth ---------- */
$('tab-login').onclick = () => { $('tab-login').classList.add('active'); $('tab-signup').classList.remove('active'); $('login-form').classList.remove('hidden'); $('signup-form').classList.add('hidden'); };
$('tab-signup').onclick = () => { $('tab-signup').classList.add('active'); $('tab-login').classList.remove('active'); $('signup-form').classList.remove('hidden'); $('login-form').classList.add('hidden'); };

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    const { user } = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(fd)) });
    me = user; enterApp();
  } catch (err) { $('login-error').textContent = err.message; }
});
$('signup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd);
  body.isAdult = fd.get('isAdult') === 'on';
  try {
    const { user } = await api('/api/auth/signup', { method: 'POST', body: JSON.stringify(body) });
    me = user; enterApp();
  } catch (err) { $('signup-error').textContent = err.message; }
});

function renderHeader() {
  $('header-user').innerHTML = me
    ? `<span>${esc(me.avatarEmoji)} ${esc(me.displayName)} ${me.isFounder ? '👑 Founder' : ''}</span><span class="chip">🪙 ${me.coins} Hound Coins</span><span class="chip">⭐ Lv ${me.level}</span><button class="btn" id="logout-btn">Log out</button>`
    : '';
  const lb = $('logout-btn');
  if (lb) lb.onclick = async () => { await api('/api/auth/logout', { method: 'POST' }); location.reload(); };
}

function enterApp() {
  $('auth-view').classList.add('hidden');
  $('app-view').classList.remove('hidden');
  renderHeader();
  buildRooms(); loadPosts(); loadMembers(); loadEvents(); loadPoll(); loadGifts(); loadMine(); loadSystem(); loadChat('lobby');
  startGameNightCountdown(); loadSpotlight(); initArcade();
  socket.emit('chat:join', 'lobby');
  const pf = $('profile-form');
  pf.displayName.value = me.displayName; pf.avatarEmoji.value = me.avatarEmoji; pf.bio.value = me.bio || ''; pf.isAdult.checked = !!me.isAdult;
  $('my-profile').innerHTML = `<p><span class="avatar">${esc(me.avatarEmoji)}</span> <strong>${esc(me.displayName)}</strong> (@${esc(me.username)})<br><span class="muted">${esc(me.bio || 'No bio yet.')}</span></p>`;
}

/* ---------- rooms & composer ---------- */
function buildRooms() {
  const sel = $('post-room');
  sel.innerHTML = ROOMS.map(r => `<option>${r}</option>`).join('');
  const nav = $('room-filter');
  nav.innerHTML = ['All Rooms', ...ROOMS].map(r => `<button data-room="${r}" class="${r === currentRoom ? 'active' : ''}">${r === 'All Rooms' ? '🌐 All Rooms' : r}</button>`).join('');
  nav.querySelectorAll('button').forEach(b => b.onclick = () => { currentRoom = b.dataset.room; buildRooms(); loadPosts(); });
}
document.querySelectorAll('.kind').forEach(b => b.onclick = () => {
  postKind = b.dataset.kind;
  document.querySelectorAll('.kind').forEach(x => x.classList.toggle('active', x === b));
  $('picture-fields').classList.toggle('hidden', postKind !== 'picture');
  $('clip-fields').classList.toggle('hidden', postKind !== 'clip');
});
document.querySelectorAll('.starter').forEach(b => b.onclick = () => { $('post-body').value = b.dataset.text + ' '; $('post-body').focus(); });
$('post-body').addEventListener('input', () => $('post-counter').textContent = `${$('post-body').value.length} / 2000`);
$('post-image-file').addEventListener('change', () => {
  const f = $('post-image-file').files[0];
  if (f) { $('post-image-preview').src = URL.createObjectURL(f); $('post-image-preview').classList.remove('hidden'); }
});

$('post-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('post-error').textContent = '';
  try {
    let imageUrl = $('post-image-url').value.trim();
    const file = $('post-image-file').files[0];
    if (postKind === 'picture' && file) {
      const fd = new FormData(); fd.append('image', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed.');
      imageUrl = data.url;
    }
    const { coins } = await api('/api/posts', {
      method: 'POST',
      body: JSON.stringify({
        kind: postKind, title: $('post-title').value, body: $('post-body').value,
        room: $('post-room').value, imageUrl, mediaUrl: $('post-media-url').value.trim(),
      }),
    });
    me.coins = coins; renderHeader();
    e.target.reset(); $('post-image-preview').classList.add('hidden');
    $('post-counter').textContent = '0 / 2000';
    loadPosts(); loadMembers();
  } catch (err) { $('post-error').textContent = err.message; }
});

/* ---------- feed ---------- */
async function loadPosts() {
  const q = currentRoom === 'All Rooms' ? '' : `?room=${encodeURIComponent(currentRoom)}`;
  const { posts } = await api('/api/posts' + q);
  $('feed').innerHTML = posts.map(renderPost).join('') || '<div class="card">No posts here yet — be the first!</div>';
  wirePosts();
  loadSpotlight();
}
function postMedia(p) {
  if (p.kind === 'picture' && p.imageUrl) return `<img class="post-img" src="${esc(p.imageUrl)}" alt="">`;
  if (p.kind === 'clip' && p.mediaUrl) {
    const emb = youtubeEmbed(p.mediaUrl);
    return emb
      ? `<div class="video-wrap"><iframe src="${emb}" allowfullscreen title="clip"></iframe></div>`
      : `<div class="video-wrap"><video src="${esc(p.mediaUrl)}" controls></video></div>`;
  }
  return '';
}
function renderPost(p) {
  const media = postMedia(p);
  const reactions = REACTIONS.map(e => {
    const count = (p.reactions || {})[e] || 0;
    return `<button class="react" data-post="${p.id}" data-emoji="${e}">${e}${count ? ' ' + count : ''}</button>`;
  }).join('');
  const comments = (p.comments || []).map(c => `<p class="comment"><strong>${esc(c.displayName)}</strong> ${esc(c.body)}</p>`).join('');
  const mine = me && p.authorId === me.id;
  return `<article class="post" id="post-${p.id}">
    <div class="post-head"><span class="avatar">${esc(p.authorEmoji || '🎮')}</span>
      <div><strong>${esc(p.authorDisplay)}</strong> <span class="post-meta">@${esc(p.authorName)} · ${esc(p.room)} · ${new Date(p.createdAt).toLocaleString()}</span></div></div>
    <h3>${esc(p.title)}</h3><p>${esc(p.body)}</p>${media}
    <div class="post-actions">${reactions}
      <button class="react share-btn" data-post="${p.id}">🔗 Share</button>
      <button class="react gift-btn" data-user="${esc(p.authorName)}">🎁 Gift @${esc(p.authorName)}</button>
      ${mine ? `<button class="react del-btn" data-post="${p.id}">🗑️ Delete</button>` : ''}
    </div>
    <div class="comments">${comments}
      <form class="comment-form row" data-post="${p.id}"><input class="grow" maxlength="600" placeholder="Add a comment…"><button class="btn" type="submit">Comment</button></form>
    </div></article>`;
}
function wirePosts() {
  document.querySelectorAll('.react[data-emoji]').forEach(b => b.onclick = async () => {
    if (!me) return;
    await api(`/api/posts/${b.dataset.post}/reactions`, { method: 'POST', body: JSON.stringify({ emoji: b.dataset.emoji }) });
    loadPosts();
  });
  document.querySelectorAll('.share-btn').forEach(b => b.onclick = async () => {
    const link = location.origin + '/#post-' + b.dataset.post;
    try { await navigator.clipboard.writeText(link); b.textContent = '✅ Link copied'; } catch { b.textContent = link; }
    api(`/api/posts/${b.dataset.post}/share`, { method: 'POST' }).catch(() => {});
  });
  document.querySelectorAll('.gift-btn').forEach(b => b.onclick = () => { $('gift-to').value = b.dataset.user; document.getElementById('profile-card').scrollIntoView; $('gift-to').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('gift-to').focus(); });
  document.querySelectorAll('.del-btn').forEach(b => b.onclick = async () => { if (confirm('Delete this post?')) { await api(`/api/posts/${b.dataset.post}`, { method: 'DELETE' }); loadPosts(); } });
  document.querySelectorAll('.comment-form').forEach(f => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = f.querySelector('input');
    if (!input.value.trim()) return;
    await api(`/api/posts/${f.dataset.post}/comments`, { method: 'POST', body: JSON.stringify({ body: input.value }) });
    loadPosts();
  }));
}
socket.on('post:new', () => { if (me) loadPosts(); });
socket.on('post:update', () => { if (me) loadPosts(); });
socket.on('gift:new', () => { if (me) { loadMembers(); loadMine(); } });

/* ---------- members / leaderboard ---------- */
async function loadMembers() {
  const { members } = await api('/api/members');
  $('leaderboard').innerHTML = members.map(m => `<li>${esc(m.avatarEmoji)} <strong>${esc(m.displayName)}</strong> (@${esc(m.username)}) ${m.isFounder ? '👑' : ''}<br><span class="muted">Lv ${m.level} · ${m.xp} XP · 🪙 ${m.coins} · ${m.postCount} posts · 🎁 ${m.giftsReceived}</span></li>`).join('') || '<li>No members yet.</li>';
  const mine = members.find(m => me && m.id === me.id);
  if (mine) { me.coins = mine.coins; me.xp = mine.xp; me.level = mine.level; renderHeader(); }
}

/* ---------- gifts ---------- */
async function loadGifts() {
  const { catalog } = await api('/api/gifts/catalog');
  giftCatalog = catalog;
  $('gift-catalog').innerHTML = catalog.map(g => `<button type="button" class="gift" data-id="${g.id}">${g.emoji} <strong>${esc(g.name)}</strong><br><span class="muted">🪙 ${g.cost} coins</span></button>`).join('');
  document.querySelectorAll('.gift').forEach(b => b.onclick = () => {
    selectedGift = b.dataset.id;
    document.querySelectorAll('.gift').forEach(x => x.classList.toggle('selected', x === b));
  });
}
$('gift-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!selectedGift) { $('gift-msg').textContent = 'Pick a gift first.'; return; }
  try {
    const { coins } = await api('/api/gifts/send', { method: 'POST', body: JSON.stringify({ giftId: selectedGift, toUsername: $('gift-to').value.trim() }) });
    me.coins = coins; renderHeader();
    $('gift-msg').textContent = '🎉 Gift sent!';
    loadMembers(); loadMine();
  } catch (err) { $('gift-msg').textContent = err.message; }
});
async function loadMine() {
  if (!me) return;
  const data = await api('/api/gifts/mine');
  $('my-gifts').innerHTML = '<h3>🎁 Your gift shelf</h3>' + (data.received.length
    ? data.received.slice(0, 10).map(g => `<p class="comment">${g.giftEmoji} <strong>${esc(g.giftName)}</strong> from @${esc(g.fromName)} <span class="muted">(${new Date(g.createdAt).toLocaleDateString()})</span></p>`).join('')
    : '<p class="muted">No gifts yet — post something great and the Pack will hook you up.</p>');
}

/* ---------- profile / howl ---------- */
$('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd);
  body.isAdult = fd.get('isAdult') === 'on';
  const { user } = await api('/api/profile', { method: 'POST', body: JSON.stringify(body) });
  me = user; renderHeader(); enterAppRefresh();
});
function enterAppRefresh() {
  $('my-profile').innerHTML = `<p><span class="avatar">${esc(me.avatarEmoji)}</span> <strong>${esc(me.displayName)}</strong> (@${esc(me.username)})<br><span class="muted">${esc(me.bio || 'No bio yet.')}</span></p>`;
  buildRooms(); loadPosts();
}
$('daily-howl').onclick = async () => {
  try {
    const { coins, reward } = await api('/api/quests/daily-howl', { method: 'POST' });
    me.coins = coins; renderHeader();
    $('howl-msg').textContent = `🐺 HOWL! +${reward} Hound Coins.`;
    loadMembers();
  } catch (err) { $('howl-msg').textContent = err.message; }
};

/* ---------- events & poll ---------- */
async function loadEvents() {
  const { events } = await api('/api/events');
  $('events').innerHTML = events.map(ev => `<div class="event"><strong>${esc(ev.title)}</strong><br><span class="muted">${esc(ev.date)}</span><p>${esc(ev.description)}</p><button class="btn rsvp" data-id="${ev.id}">${ev.going ? '✅ Going' : 'RSVP'} · ${ev.rsvpCount}</button></div>`).join('') || '<p class="muted">No events yet.</p>';
  document.querySelectorAll('.rsvp').forEach(b => b.onclick = async () => { await api(`/api/events/${b.dataset.id}/rsvp`, { method: 'POST' }); loadEvents(); });
  renderHubRsvp(events.find(e => /game night/i.test(e.title)));
}
async function loadPoll() {
  const data = await api('/api/poll');
  $('poll-q').textContent = data.question;
  const total = data.options.reduce((sum, o) => sum + o.votes, 0);
  $('poll-options').innerHTML = data.options.map(o => {
    const pct = total ? Math.round((o.votes / total) * 100) : 0;
    return `<div class="poll-row"><p><button class="btn poll-btn" data-id="${o.id}">${o.mine ? '✅ ' : ''}${esc(o.text)}</button> <span class="muted">${o.votes} votes · ${pct}%</span></p><div class="poll-bar"><i style="width:${pct}%"></i></div></div>`;
  }).join('') + (total ? '' : '<p class="muted">No votes yet — be the first!</p>');
  document.querySelectorAll('.poll-btn').forEach(b => b.onclick = async () => { await api('/api/poll/vote', { method: 'POST', body: JSON.stringify({ optionId: b.dataset.id }) }); loadPoll(); });
}

/* ---------- system / security ---------- */
async function loadSystem() {
  const s = await api('/api/system');
  let html = `<p><span class="stat">Version ${esc(s.version)}</span><span class="stat">🐺 ${s.memberCount} members</span><span class="stat">📝 ${s.postCount} posts</span></p>`;
  if (s.isFounder && s.securityEvents) {
    html += '<h3>Security event log (Founder only)</h3>' + (s.securityEvents.map(e => `<p class="sev">• ${new Date(e.createdAt).toLocaleString()} — <strong>${esc(e.type)}</strong> ${esc(e.detail)}</p>`).join('') || '<p class="muted">No security events yet.</p>');
  }
  $('system-info').innerHTML = html;
}
$('copy-invite').onclick = async () => {
  $('invite-text').select();
  try { await navigator.clipboard.writeText($('invite-text').value); $('copy-invite').textContent = '✅ Copied!'; } catch { document.execCommand('copy'); }
};

/* ---------- lobby chat ---------- */
function renderChatMsg(m) {
  const div = document.createElement('p');
  div.innerHTML = `<strong>${esc(m.displayName)}</strong> <span class="muted">${new Date(m.createdAt).toLocaleTimeString()}</span><br>${esc(m.body)}`;
  $('chat-box').appendChild(div);
  $('chat-box').scrollTop = $('chat-box').scrollHeight;
}
async function loadChat(channel) {
  const { messages } = await api('/api/chat?channel=' + encodeURIComponent(channel));
  $('chat-box').innerHTML = '';
  messages.forEach(renderChatMsg);
}
$('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const body = $('chat-input').value.trim();
  if (!body) return;
  socket.emit('chat:send', { channel: 'lobby', body });
  $('chat-input').value = '';
});
socket.on('chat:message', (m) => { if (m.channel === 'lobby') renderChatMsg(m); });
socket.on('chat:error', (msg) => alert(msg));

/* ---------- Voice & Video Lounge (WebRTC mesh) ---------- */
const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };
let localStream = null, screenStream = null, vcPeers = {}, vcChannel = null, handRaised = false;

function vcTile(id, name, stream, isLocal) {
  let tile = document.getElementById('tile-' + id);
  if (!tile) {
    tile = document.createElement('div');
    tile.className = 'vc-tile'; tile.id = 'tile-' + id;
    tile.innerHTML = `<video autoplay playsinline ${isLocal ? 'muted' : ''}></video><span class="vc-name">${esc(name)}</span>`;
    $('vc-grid').appendChild(tile);
  }
  if (stream) tile.querySelector('video').srcObject = stream;
  return tile;
}
function makePeer(remoteId, remoteName) {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  vcPeers[remoteId] = pc;
  if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  pc.ontrack = (e) => vcTile(remoteId, remoteName || 'Pack member', e.streams[0], false);
  pc.onicecandidate = (e) => { if (e.candidate) socket.emit('vc:signal', { to: remoteId, data: { ice: e.candidate } }); };
  pc.onconnectionstatechange = () => { if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) closePeer(remoteId); };
  return pc;
}
function closePeer(remoteId) {
  if (vcPeers[remoteId]) { try { vcPeers[remoteId].close(); } catch {} delete vcPeers[remoteId]; }
  const tile = document.getElementById('tile-' + remoteId);
  if (tile) tile.remove();
}
$('vc-join').onclick = async () => {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  } catch (err) {
    try { localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); }
    catch { alert('Could not access your mic/camera. Check browser permissions.'); return; }
  }
  vcChannel = $('vc-channel').value;
  vcTile('local', me.displayName + ' (you)', localStream, true);
  $('vc-join').classList.add('hidden'); $('vc-leave').classList.remove('hidden'); $('vc-controls').classList.remove('hidden');
  socket.emit('vc:join', vcChannel);
};
socket.on('vc:peers', async (peers) => {
  for (const p of peers) {
    const pc = makePeer(p.socketId, p.user.displayName);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('vc:signal', { to: p.socketId, data: { sdp: pc.localDescription } });
  }
});
socket.on('vc:peer-joined', ({ socketId, user }) => { makePeer(socketId, user.displayName); });
socket.on('vc:signal', async ({ from, data }) => {
  let pc = vcPeers[from] || makePeer(from, 'Pack member');
  if (data.sdp) {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    if (data.sdp.type === 'offer') {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('vc:signal', { to: from, data: { sdp: pc.localDescription } });
    }
  } else if (data.ice) {
    try { await pc.addIceCandidate(new RTCIceCandidate(data.ice)); } catch {}
  }
});
socket.on('vc:peer-left', ({ socketId }) => closePeer(socketId));
socket.on('vc:peer-state', ({ socketId, state }) => {
  const tile = document.getElementById('tile-' + socketId);
  if (tile && state) tile.querySelector('.vc-name').textContent = (state.name || 'Pack member') + (state.hand ? ' ✋' : '') + (state.muted ? ' 🔇' : '');
});
socket.on('vc:error', (msg) => alert(msg));
function leaveVc() {
  socket.emit('vc:leave');
  Object.keys(vcPeers).forEach(closePeer);
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  if (screenStream) screenStream.getTracks().forEach(t => t.stop());
  localStream = null; screenStream = null;
  $('vc-grid').innerHTML = '';
  $('vc-join').classList.remove('hidden'); $('vc-leave').classList.add('hidden'); $('vc-controls').classList.add('hidden');
}
$('vc-leave').onclick = leaveVc;
$('vc-mute').onclick = () => {
  const track = localStream && localStream.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  $('vc-mute').textContent = track.enabled ? '🎤 Mute' : '🔇 Unmute';
  socket.emit('vc:state', { muted: !track.enabled, hand: handRaised, name: me.displayName });
};
$('vc-camera').onclick = () => {
  const track = localStream && localStream.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  $('vc-camera').textContent = track.enabled ? '📷 Camera Off' : '📷 Camera On';
};
$('vc-hand').onclick = () => {
  handRaised = !handRaised;
  $('vc-hand').textContent = handRaised ? '✋ Hand Raised' : '✋ Raise Hand';
  socket.emit('vc:state', { hand: handRaised, muted: false, name: me.displayName });
};
$('vc-screen').onclick = async () => {
  try {
    if (screenStream) {
      screenStream.getTracks().forEach(t => t.stop()); screenStream = null;
      $('vc-screen').textContent = '🖥️ Share Screen';
      return;
    }
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const screenTrack = screenStream.getVideoTracks()[0];
    for (const pc of Object.values(vcPeers)) {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) sender.replaceTrack(screenTrack);
    }
    vcTile('local', me.displayName + ' (you)', screenStream, true);
    $('vc-screen').textContent = '🖥️ Stop Sharing';
    screenTrack.onended = () => { screenStream = null; $('vc-screen').textContent = '🖥️ Share Screen'; if (localStream) vcTile('local', me.displayName + ' (you)', localStream, true); };
  } catch {}
};

/* ---------- Game Night Live hub ---------- */
// Pack Game Night is every Saturday at 8:00 PM Central. All math is done in
// the America/Chicago wall-clock frame so the countdown is right wherever
// the visitor's own clock is set.
function chicagoNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
}
function nextGameNight() {
  const now = chicagoNow();
  const start = new Date(now);
  start.setHours(20, 0, 0, 0);
  start.setDate(start.getDate() + ((6 - now.getDay()) + 7) % 7); // next Saturday (6)
  const end = new Date(start); end.setHours(21, 30, 0, 0); // show wraps ~9:30 PM
  if (now > end) start.setDate(start.getDate() + 7);
  return start;
}
let gnTimer = null;
function startGameNightCountdown() {
  const tick = () => {
    const now = chicagoNow();
    const start = nextGameNight();
    const end = new Date(start); end.setHours(21, 30, 0, 0);
    const cd = $('gn-countdown');
    $('gn-date-line').textContent = 'Next Game Night: ' + start.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) + ' · 8:00 PM CT · Voice & Video Lounge + Lobby Chat';
    if (now >= start && now <= end) {
      cd.textContent = '🔴 LIVE NOW — join the Lounge!';
      cd.classList.add('live');
      return;
    }
    cd.classList.remove('live');
    let s = Math.max(0, Math.floor((start - now) / 1000));
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); const sec = s - m * 60;
    const pad = (n) => String(n).padStart(2, '0');
    cd.textContent = `⏳ ${d > 0 ? d + 'd ' : ''}${pad(h)}:${pad(m)}:${pad(sec)} to Game Night`;
  };
  tick();
  if (gnTimer) clearInterval(gnTimer);
  gnTimer = setInterval(tick, 1000);
}
function renderHubRsvp(ev) {
  const btn = $('gn-rsvp');
  if (!btn) return;
  if (!ev) { $('gn-rsvp-count').textContent = ''; btn.disabled = true; btn.textContent = 'Game Night event not posted yet'; return; }
  btn.disabled = false;
  btn.textContent = ev.going ? '✅ You\'re going — see you Saturday!' : 'RSVP to Game Night';
  $('gn-rsvp-count').textContent = `${ev.rsvpCount} Pack member${ev.rsvpCount === 1 ? '' : 's'} going`;
  btn.onclick = async () => { await api(`/api/events/${ev.id}/rsvp`, { method: 'POST' }); loadEvents(); };
}

/* ---------- Clip of the Week spotlight ---------- */
function reactionTotal(p) {
  return Object.values(p.reactions || {}).reduce((a, b) => a + b, 0);
}
let spotlightBusy = false;
async function loadSpotlight() {
  const el = $('spotlight-body');
  if (!el || spotlightBusy) return;
  spotlightBusy = true;
  try {
    const { posts } = await api('/api/posts');
    const clips = posts.filter(p => p.kind === 'clip');
    if (!clips.length) {
      el.innerHTML = '<p class="muted">No clips yet — the spotlight is warmed up and waiting. Post the first banger in the <strong>Clip Vault</strong> and the most-reacted clip takes this spot. 🎬</p>';
      return;
    }
    clips.sort((a, b) => (reactionTotal(b) - reactionTotal(a)) || (new Date(b.createdAt) - new Date(a.createdAt)));
    const top = clips[0];
    const total = reactionTotal(top);
    el.innerHTML = `<p><span class="spotlight-badge">🏆 ${total} reaction${total === 1 ? '' : 's'}</span></p>
      <h3>${esc(top.title)}</h3>
      <p class="post-meta">${esc(top.authorEmoji || '🎮')} ${esc(top.authorDisplay)} (@${esc(top.authorName)}) · ${esc(top.room)}</p>
      ${postMedia(top)}
      <p>${esc(top.body || '')}</p>
      <p><a href="#post-${top.id}" class="spotlight-link">Jump to this post in the feed →</a></p>`;
  } catch { /* spotlight is a bonus; never break the page over it */ }
  finally { spotlightBusy = false; }
}

/* ---------- Pack Arcade (client-side fun only — NOT Hound Coins) ---------- */
const SPIN_PRIZES = [10, 50, 5, 25, 100, 5, 15, 40];
let arcade = { tokens: 0, bestClicks: 0, bestReaction: null, lastSpin: '' };
try { Object.assign(arcade, JSON.parse(localStorage.getItem('hp_arcade_v1') || '{}')); } catch {}
let arcadeReady = false;
function saveArcade() { try { localStorage.setItem('hp_arcade_v1', JSON.stringify(arcade)); } catch {} }
function renderArcade() {
  $('arcade-tokens').textContent = arcade.tokens;
  const bits = [];
  if (arcade.bestClicks) bits.push(`Best frenzy: ${arcade.bestClicks} clicks`);
  if (arcade.bestReaction) bits.push(`Best reaction: ${arcade.bestReaction} ms`);
  $('arcade-best').textContent = bits.join(' · ');
  const today = new Date().toISOString().slice(0, 10);
  const spun = arcade.lastSpin === today;
  $('spin-btn').disabled = spun;
  if (spun && !$('spin-status').textContent) $('spin-status').textContent = 'You already spun today — come back tomorrow! 🎡';
}
function awardTokens(n) { arcade.tokens += n; saveArcade(); renderArcade(); }
function initArcade() {
  if (arcadeReady) { renderArcade(); return; }
  arcadeReady = true;
  // Spin wheel face: alternating crimson / dark segments
  $('spin-wheel').style.background = `conic-gradient(${SPIN_PRIZES.map((_, i) => `${i % 2 ? '#241118' : '#8f0e27'} ${i * 45}deg ${(i + 1) * 45}deg`).join(',')})`;
  renderArcade();

  // Coin Clicker Frenzy
  let frenzy = null;
  $('clicker-start').onclick = () => {
    if (frenzy) return;
    let clicks = 0;
    const coin = $('clicker-coin');
    coin.disabled = false;
    $('clicker-start').disabled = true;
    $('clicker-status').textContent = '🔥 FRENZY! 15 seconds — GO!';
    coin.onclick = () => { clicks++; $('clicker-status').textContent = `🔥 ${clicks} clicks… keep going!`; };
    frenzy = setTimeout(() => {
      frenzy = null;
      coin.disabled = true; coin.onclick = null;
      $('clicker-start').disabled = false;
      awardTokens(clicks);
      if (clicks > arcade.bestClicks) { arcade.bestClicks = clicks; saveArcade(); }
      renderArcade();
      $('clicker-status').textContent = clicks ? `⏱️ Time! ${clicks} clicks = +${clicks} Arcade Tokens.` : '⏱️ Time! Zero clicks — the coin is disappointed. 😅';
    }, 15000);
  };

  // Reaction Sprint
  let rState = 'idle', rTimer = null, rStart = 0;
  const box = $('reaction-box');
  $('reaction-start').onclick = () => {
    if (rState === 'waiting' || rState === 'go') return;
    rState = 'waiting';
    box.className = 'reaction-box ready';
    box.textContent = 'Wait for green…';
    $('reaction-status').textContent = '';
    rTimer = setTimeout(() => {
      rState = 'go'; rStart = performance.now();
      box.className = 'reaction-box go';
      box.textContent = 'CLICK! ⚡';
    }, 1200 + Math.random() * 2300);
  };
  box.onclick = () => {
    if (rState === 'waiting') {
      clearTimeout(rTimer); rState = 'idle';
      box.className = 'reaction-box';
      box.textContent = 'Too soon! 😅';
      $('reaction-status').textContent = 'False start — wait for green next time.';
    } else if (rState === 'go') {
      const ms = Math.round(performance.now() - rStart);
      rState = 'idle';
      box.className = 'reaction-box';
      box.textContent = `${ms} ms`;
      let bonus = 0;
      if (ms < 250) bonus = 15; else if (ms < 300) bonus = 10; else if (ms < 400) bonus = 5;
      if (!arcade.bestReaction || ms < arcade.bestReaction) { arcade.bestReaction = ms; saveArcade(); }
      if (bonus) awardTokens(bonus); else renderArcade();
      $('reaction-status').textContent = bonus ? `⚡ ${ms} ms — +${bonus} Arcade Tokens!` : `${ms} ms. Under 400 ms earns tokens — run it back!`;
    }
  };

  // Daily Spin
  let spinning = false, spinAngle = 0;
  $('spin-btn').onclick = () => {
    const today = new Date().toISOString().slice(0, 10);
    if (spinning || arcade.lastSpin === today) return;
    spinning = true;
    const idx = Math.floor(Math.random() * SPIN_PRIZES.length);
    // Pointer sits at the top; land the chosen segment's middle under it.
    const target = 360 * 5 + (360 - idx * 45 - 22.5);
    spinAngle += target - (spinAngle % 360);
    const wheel = $('spin-wheel');
    wheel.style.transform = `rotate(${spinAngle}deg)`;
    $('spin-status').textContent = 'Spinning… 🎡';
    setTimeout(() => {
      spinning = false;
      arcade.lastSpin = today;
      awardTokens(SPIN_PRIZES[idx]);
      $('spin-status').textContent = `🎉 You won +${SPIN_PRIZES[idx]} Arcade Tokens!`;
    }, 4200);
  };
}

/* ---------- boot ---------- */
(async () => {
  try {
    const { user } = await api('/api/auth/me');
    if (user) { me = user; enterApp(); return; }
  } catch {}
  $('auth-view').classList.remove('hidden');
})();
