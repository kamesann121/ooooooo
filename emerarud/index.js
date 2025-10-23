// index.js
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Server } = require('socket.io');

const ADMIN_PASS = process.env.ADMIN_PASS || 'change_me';
const DATA_FILE = path.join(__dirname, 'data.json');
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = Date.now() + '_' + file.originalname.replace(/\s+/g, '_');
    cb(null, safe);
  }
});
const upload = multer({ storage });

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// load or init store
let store = { users: {}, bans: {}, globalShop: {
  sword: { price: 50, power: 1 },
  armor: { price: 100, power: 2 },
  gemBooster: { price: 250, power: 5 }
}};
try { const txt = fs.readFileSync(DATA_FILE, 'utf8'); store = JSON.parse(txt); } catch(e) { save(); }
function save() { fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2)); }

// Upload endpoint
app.post('/upload-avatar', upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const url = `/uploads/${req.file.filename}`;
  return res.json({ url });
});

// admin login check
app.post('/admin-login', (req, res) => {
  const { pass } = req.body;
  if (pass === ADMIN_PASS) return res.json({ ok: true });
  return res.status(401).json({ ok: false });
});

io.on('connection', socket => {
  // send initial public data
  socket.emit('init', { shop: store.globalShop, bans: store.bans });

  // auto-register attempt: client may send 'auto-register' with nickname & avatar
  socket.on('auto-register', ({ nickname, avatar }) => {
    nickname = String(nickname || '').trim();
    if (!nickname) return socket.emit('register-error', 'Nickname required');
    if (store.bans[nickname]) return socket.emit('register-error', 'You are banned');
    const existing = store.users[nickname];
    if (existing) {
      // if another active socket holds this nickname, reject
      if (existing.socketId && existing.socketId !== socket.id) {
        return socket.emit('register-error', 'Nickname taken by another session');
      }
      // resume existing user: keep emeralds/power/avatar (update avatar if provided)
      existing.socketId = socket.id;
      if (avatar) existing.avatar = avatar;
      store.users[nickname] = existing;
      save();
      socket.data.nickname = nickname;
      socket.emit('register-ok', store.users[nickname]);
      io.emit('user-list', store.users);
      return;
    }
    // new registration
    store.users[nickname] = { emeralds: 0, power: 1, avatar: avatar || null, socketId: socket.id };
    save();
    socket.data.nickname = nickname;
    socket.emit('register-ok', store.users[nickname]);
    io.emit('user-list', store.users);
  });

  // explicit register (when no localStorage)
  socket.on('register', ({ nickname, avatar }) => {
    nickname = String(nickname || '').trim();
    if (!nickname) return socket.emit('register-error', 'Nickname required');
    if (store.bans[nickname]) return socket.emit('register-error', 'You are banned');
    const existing = store.users[nickname];
    if (existing && existing.socketId && existing.socketId !== socket.id) {
      return socket.emit('register-error', 'Nickname taken');
    }
    if (existing) {
      // resume
      existing.socketId = socket.id;
      if (avatar) existing.avatar = avatar;
      store.users[nickname] = existing;
    } else {
      store.users[nickname] = { emeralds: 0, power: 1, avatar: avatar || null, socketId: socket.id };
    }
    save();
    socket.data.nickname = nickname;
    socket.emit('register-ok', store.users[nickname]);
    io.emit('user-list', store.users);
  });

  socket.on('click', () => {
    const nick = socket.data.nickname;
    if (!nick || !store.users[nick]) return;
    const user = store.users[nick];
    const gain = user.power || 1;
    user.emeralds = (user.emeralds || 0) + gain;
    save();
    io.emit('update-user', { nickname: nick, emeralds: user.emeralds, power: user.power });
  });

  socket.on('buy', ({ itemKey }) => {
    const nick = socket.data.nickname;
    if (!nick || !store.users[nick]) return socket.emit('buy-result', { ok: false, message: 'Not registered' });
    const user = store.users[nick];
    const item = store.globalShop[itemKey];
    if (!item) return socket.emit('buy-result', { ok: false, message: 'Invalid item' });
    if ((user.emeralds || 0) < item.price) return socket.emit('buy-result', { ok: false, message: 'Not enough emeralds' });
    user.emeralds -= item.price;
    user.power = (user.power || 1) + item.power;
    save();
    io.emit('update-user', { nickname: nick, emeralds: user.emeralds, power: user.power });
    return socket.emit('buy-result', { ok: true, message: 'Purchased' });
  });

  socket.on('chat', ({ text, admin }) => {
    const nick = socket.data.nickname;
    if (!nick || !store.users[nick]) return socket.emit('chat-error', 'Register first');
    const trimmed = String(text || '').trim();
    if (!trimmed) return;
    // admin commands
    if (trimmed.startsWith('/BAN ')) {
      const target = trimmed.slice(5).trim();
      if (admin === true) {
        store.bans[target] = true;
        if (store.users[target]) delete store.users[target];
        save();
        io.emit('system', `${target} has been banned`);
        io.emit('user-list', store.users);
        return;
      } else {
        return socket.emit('chat-error', 'Not authorized');
      }
    }
    if (trimmed.startsWith('/bro ')) {
      const target = trimmed.slice(5).trim();
      if (admin === true) {
        delete store.bans[target];
        save();
        io.emit('system', `${target} has been unbanned`);
        return;
      } else {
        return socket.emit('chat-error', 'Not authorized');
      }
    }
    // normal message
    const payload = { nickname: nick, avatar: store.users[nick].avatar || null, text: trimmed, time: Date.now() };
    io.emit('chat-message', payload);
  });

  socket.on('disconnect', () => {
    const nick = socket.data.nickname;
    if (nick && store.users[nick]) {
      // clear socketId so user can reconnect from other tab
      if (store.users[nick].socketId === socket.id) {
        delete store.users[nick].socketId;
        save();
        io.emit('user-list', store.users);
      }
    }
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log('Server listening on', port));
