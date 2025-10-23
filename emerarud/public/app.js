// public/app.js
const socket = io();
let myNick = null;
let isAdmin = false;
let myAvatarUrl = null;

const shopListEl = document.getElementById('shopList');
const emeraldCountEl = document.getElementById('emeraldCount');
const powerCountEl = document.getElementById('powerCount');
const nickDisplay = document.getElementById('nickDisplay');
const avatarPreview = document.getElementById('avatarPreview');
const chatBox = document.getElementById('chatBox');

function escapeHtml(s){ return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function addChatMessage({ nickname, avatar, text, time }) {
  const wrap = document.createElement('div');
  wrap.className = 'chatMsg';
  const img = document.createElement('div');
  img.className = 'avatar';
  if (avatar) {
    const i = document.createElement('img');
    i.src = avatar;
    i.style.width = '100%';
    i.style.height = '100%';
    i.style.objectFit = 'cover';
    img.appendChild(i);
  } else {
    img.textContent = nickname[0].toUpperCase();
  }
  const body = document.createElement('div');
  body.innerHTML = `<strong>${escapeHtml(nickname)}</strong><div>${escapeHtml(text)}</div>`;
  wrap.appendChild(img);
  wrap.appendChild(body);
  chatBox.appendChild(wrap);
  chatBox.scrollTop = chatBox.scrollHeight;
}
function addSystem(text) {
  const div = document.createElement('div');
  div.className = 'system';
  div.textContent = text;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

// UI events
document.getElementById('clickBtn').addEventListener('click', ()=> socket.emit('click'));
document.getElementById('sendBtn').addEventListener('click', sendChat);
document.getElementById('chatInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
document.getElementById('registerBtn').addEventListener('click', manualRegister);
document.getElementById('uploadBtn').addEventListener('click', uploadAvatar);
document.getElementById('adminLogin').addEventListener('click', adminLogin);

function sendChat() {
  const text = document.getElementById('chatInput').value;
  if (!text) return;
  socket.emit('chat', { text, admin: isAdmin });
  document.getElementById('chatInput').value = '';
}

function manualRegister() {
  const name = document.getElementById('nameInput').value.trim();
  if (!name) { alert('Nickname required'); return; }
  // store locally before sending
  if (myAvatarUrl) localStorage.setItem('emerald_avatar', myAvatarUrl);
  localStorage.setItem('emerald_nick', name);
  socket.emit('register', { nickname: name, avatar: myAvatarUrl });
}

function uploadAvatar() {
  const file = document.getElementById('avatarFile').files[0];
  if (!file) { alert('Select a file'); return; }
  const fd = new FormData();
  fd.append('avatar', file);
  fetch('/upload-avatar', { method:'POST', body: fd })
    .then(r => r.json())
    .then(j => {
      if (j.url) {
        myAvatarUrl = j.url;
        localStorage.setItem('emerald_avatar', myAvatarUrl);
        avatarPreview.innerHTML = `<img src="${j.url}" style="width:100%;height:100%;object-fit:cover;">`;
      } else alert('Upload failed');
    }).catch(()=>alert('Upload error'));
}

function adminLogin() {
  const pass = document.getElementById('adminPass').value;
  if (!pass) { alert('Enter admin pass'); return; }
  fetch('/admin-login', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ pass }) })
    .then(r => {
      if (!r.ok) throw new Error('fail');
      return r.json();
    })
    .then(() => { isAdmin = true; alert('Admin enabled'); })
    .catch(()=> alert('Admin login failed'));
}

// socket handlers
socket.on('init', data => {
  // populate shop
  const shop = data.shop || {};
  shopListEl.innerHTML = '';
  Object.keys(shop).forEach(k => {
    const item = shop[k];
    const div = document.createElement('div');
    div.className = 'shopItem';
    div.innerHTML = `<div><strong>${escapeHtml(k)}</strong></div><div>Price: ${item.price}</div><div>Power: +${item.power}</div>`;
    const btn = document.createElement('button');
    btn.textContent = 'Buy';
    btn.addEventListener('click', ()=> socket.emit('buy', { itemKey: k }));
    div.appendChild(btn);
    shopListEl.appendChild(div);
  });

  // try auto-register from localStorage
  const storedNick = localStorage.getItem('emerald_nick');
  const storedAvatar = localStorage.getItem('emerald_avatar');
  if (storedNick) {
    myNick = storedNick;
    myAvatarUrl = storedAvatar || null;
    socket.emit('auto-register', { nickname: myNick, avatar: myAvatarUrl });
  } else {
    // show avatar preview if exists
    if (storedAvatar) {
      myAvatarUrl = storedAvatar;
      avatarPreview.innerHTML = `<img src="${myAvatarUrl}" style="width:100%;height:100%;object-fit:cover;">`;
    }
  }
});

socket.on('register-ok', user => {
  // user contains emeralds, power, avatar
  myNick = document.getElementById('nameInput').value.trim() || myNick;
  if (myNick) localStorage.setItem('emerald_nick', myNick);
  if (user && user.avatar) {
    myAvatarUrl = user.avatar;
    localStorage.setItem('emerald_avatar', myAvatarUrl);
    avatarPreview.innerHTML = `<img src="${myAvatarUrl}" style="width:100%;height:100%;object-fit:cover;">`;
  }
  nickDisplay.textContent = myNick || 'Guest';
  emeraldCountEl.textContent = (user && user.emeralds) || 0;
  powerCountEl.textContent = (user && user.power) || 1;
  addSystem(`Registered as ${myNick}`);
}

);

socket.on('register-error', msg => {
  // if auto-register failed due to ban or taken, clear local nickname to allow retry
  const stored = localStorage.getItem('emerald_nick');
  if (stored && msg && msg.toLowerCase().includes('ban')) {
    // keep nick but inform
  } else {
    // clear local nick if taken by another session
    localStorage.removeItem('emerald_nick');
  }
  alert(msg);
});

socket.on('user-list', users => {
  if (myNick && users && users[myNick]) {
    const u = users[myNick];
    emeraldCountEl.textContent = u.emeralds || 0;
    powerCountEl.textContent = u.power || 1;
    nickDisplay.textContent = myNick;
    if (u.avatar) {
      myAvatarUrl = u.avatar;
      avatarPreview.innerHTML = `<img src="${u.avatar}" style="width:100%;height:100%;object-fit:cover;">`;
      localStorage.setItem('emerald_avatar', myAvatarUrl);
    }
  }
});

socket.on('update-user', ({ nickname, emeralds, power }) => {
  if (nickname === myNick) {
    emeraldCountEl.textContent = emeralds;
    powerCountEl.textContent = power;
  }
});

socket.on('buy-result', r => { if (!r.ok) alert(r.message); });

socket.on('chat-message', msg => addChatMessage(msg));
socket.on('system', text => addSystem(text));
socket.on('chat-error', text => alert(text));
