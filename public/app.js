'use strict';
const $ = (id) => document.getElementById(id);
const ROOMS = ['The Den', 'Clip Vault', 'Pet Pics', 'Setup Flex', 'Chill Corner', 'Meme Cave', 'Wins & Fails', 'Beats & Music', 'Munchie Runs'];
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
}
function renderPost(p) {
  let media = '';
  if (p.kind === 'picture' && p.imageUrl) media = `<img class="post-img" src="${esc(p.imageUrl)}" alt="">`;
  if (p.kind === 'clip' && p.mediaUrl) {
    const emb = youtubeEmbed(p.mediaUrl);
    media = emb
      ? `<div class="video-wrap"><iframe src="${emb}" allowfullscreen title="clip"></iframe></div>`
      : `<div class="video-wrap"><video src="${esc(p.mediaUrl)}" controls></video></div>`;
  }
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
}
async function loadPoll() {
  const data = await api('/api/poll');
  $('poll-q').textContent = data.question;
  $('poll-options').innerHTML = data.options.map(o => `<p><button class="btn poll-btn" data-id="${o.id}">${o.mine ? '✅ ' : ''}${esc(o.text)}</button> <span class="muted">${o.votes} votes</span></p>`).join('');
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

/* ---------- boot ---------- */
(async () => {
  try {
    const { user } = await api('/api/auth/me');
    if (user) { me = user; enterApp(); return; }
  } catch {}
  $('auth-view').classList.remove('hidden');
})();
