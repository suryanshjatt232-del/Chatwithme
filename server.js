const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

function defaultData() {
  return {
    ownerUsername: 'owner',
    ownerPassword: '123',
    ownerRecoveryPin: '1234',
    users: [],
    messages: []
  };
}

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.users) && Array.isArray(parsed.messages)) {
        return parsed;
      }
    }
  } catch (e) {}
  const init = defaultData();
  saveData(init);
  return init;
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // Serve HTML pages
  if (req.method === 'GET' && pathname === '/') {
    return serveFile(res, path.join(PUBLIC_DIR, 'visitor.html'));
  }
  if (req.method === 'GET' && pathname === '/owner') {
    return serveFile(res, path.join(PUBLIC_DIR, 'admin.html'));
  }

  // Visitor APIs
  try {
    if (req.method === 'POST' && pathname === '/api/register') {
      const { username, displayName, password, securityQuestion, securityAnswer } = await readBody(req);
      const u = String(username || '').trim().toLowerCase().replace(/\s+/g, '_');
      if (u.length < 3 || !password || password.length < 4 || !securityAnswer) {
        return sendJson(res, 400, { error: 'Invalid registration details.' });
      }
      const db = loadData();
      if (db.users.some(x => x.username === u)) {
        return sendJson(res, 409, { error: 'Username already exists.' });
      }
      const user = {
        username: u,
        displayName: String(displayName || '').trim() || u,
        password,
        securityQuestion: securityQuestion || 'What is your favorite food?',
        securityAnswer: String(securityAnswer).trim().toLowerCase(),
        createdAt: new Date().toISOString()
      };
      db.users.push(user);
      saveData(db);
      return sendJson(res, 200, { user: { username: user.username, displayName: user.displayName, securityQuestion: user.securityQuestion } });
    }

    if (req.method === 'POST' && pathname === '/api/login') {
      const { username, password } = await readBody(req);
      const u = String(username || '').trim().toLowerCase();
      const db = loadData();
      const user = db.users.find(x => x.username === u && x.password === password);
      if (!user) {
        return sendJson(res, 401, { error: 'Invalid username or password.' });
      }
      return sendJson(res, 200, { user: { username: user.username, displayName: user.displayName, securityQuestion: user.securityQuestion } });
    }

    if (req.method === 'POST' && pathname === '/api/forgot-lookup') {
      const { username } = await readBody(req);
      const u = String(username || '').trim().toLowerCase();
      const db = loadData();
      const user = db.users.find(x => x.username === u);
      if (!user) return sendJson(res, 404, { error: 'Account not found.' });
      return sendJson(res, 200, { username: user.username, securityQuestion: user.securityQuestion });
    }

    if (req.method === 'POST' && pathname === '/api/forgot-reset') {
      const { username, securityAnswer, newPassword } = await readBody(req);
      const u = String(username || '').trim().toLowerCase();
      const db = loadData();
      const user = db.users.find(x => x.username === u);
      if (!user) return sendJson(res, 404, { error: 'Account not found.' });
      if (String(securityAnswer || '').trim().toLowerCase() !== user.securityAnswer) {
        return sendJson(res, 403, { error: 'Incorrect security answer.' });
      }
      if (!newPassword || newPassword.length < 4) {
        return sendJson(res, 400, { error: 'Password must be at least 4 characters.' });
      }
      user.password = newPassword;
      saveData(db);
      return sendJson(res, 200, { user: { username: user.username, displayName: user.displayName, securityQuestion: user.securityQuestion } });
    }

    if (req.method === 'POST' && pathname === '/api/change-password') {
      const { username, currentPassword, newPassword } = await readBody(req);
      const db = loadData();
      const user = db.users.find(x => x.username === username);
      if (!user || user.password !== currentPassword) {
        return sendJson(res, 403, { error: 'Current password is incorrect.' });
      }
      if (!newPassword || newPassword.length < 4) {
        return sendJson(res, 400, { error: 'New password must be at least 4 characters.' });
      }
      user.password = newPassword;
      saveData(db);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET' && pathname === '/api/messages') {
      const username = url.searchParams.get('username');
      const db = loadData();
      const msgs = db.messages.filter(m => m.username === username);
      return sendJson(res, 200, { messages: msgs });
    }

    if (req.method === 'POST' && pathname === '/api/messages') {
      const { username, text } = await readBody(req);
      if (!username || !text || !String(text).trim()) {
        return sendJson(res, 400, { error: 'Message text required.' });
      }
      const db = loadData();
      if (!db.users.some(x => x.username === username)) {
        return sendJson(res, 404, { error: 'User not found.' });
      }
      const msg = {
        id: 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        username,
        sender: 'visitor',
        text: String(text).trim(),
        timestamp: new Date().toISOString(),
        readByOwner: false
      };
      db.messages.push(msg);
      saveData(db);
      return sendJson(res, 200, { message: msg });
    }

    // Owner APIs
    if (req.method === 'POST' && pathname === '/api/owner/login') {
      const { username, password } = await readBody(req);
      const db = loadData();
      const expectedU = (db.ownerUsername || 'owner').toLowerCase();
      const expectedP = db.ownerPassword || '123';
      if (String(username || '').trim().toLowerCase() !== expectedU || password !== expectedP) {
        return sendJson(res, 401, { error: 'Invalid Owner Username or Admin Password.' });
      }
      return sendJson(res, 200, { ok: true, ownerUsername: db.ownerUsername || 'owner' });
    }

    if (req.method === 'POST' && pathname === '/api/owner/forgot-reset') {
      const { pin, newUsername, newPassword } = await readBody(req);
      const db = loadData();
      if (String(pin || '').trim() !== (db.ownerRecoveryPin || '1234')) {
        return sendJson(res, 403, { error: 'Incorrect Recovery PIN.' });
      }
      if (!newUsername || newUsername.trim().length < 3 || !newPassword || newPassword.length < 3) {
        return sendJson(res, 400, { error: 'Username and password must be at least 3 characters.' });
      }
      db.ownerUsername = newUsername.trim();
      db.ownerPassword = newPassword;
      saveData(db);
      return sendJson(res, 200, { ok: true, ownerUsername: db.ownerUsername });
    }

    if (req.method === 'POST' && pathname === '/api/owner/credentials') {
      const { newUsername, currentPassword, newPassword, newPin } = await readBody(req);
      const db = loadData();
      if (currentPassword !== (db.ownerPassword || '123')) {
        return sendJson(res, 403, { error: 'Current admin password is incorrect.' });
      }
      if (!newUsername || newUsername.trim().length < 3) {
        return sendJson(res, 400, { error: 'Username must be at least 3 characters.' });
      }
      db.ownerUsername = newUsername.trim();
      if (newPassword && newPassword.length >= 3) db.ownerPassword = newPassword;
      if (newPin && newPin.trim()) db.ownerRecoveryPin = newPin.trim();
      saveData(db);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET' && pathname === '/api/owner/inbox') {
      const db = loadData();
      return sendJson(res, 200, {
        ownerUsername: db.ownerUsername || 'owner',
        ownerRecoveryPin: db.ownerRecoveryPin || '1234',
        users: db.users.map(u => ({ username: u.username, displayName: u.displayName, createdAt: u.createdAt })),
        messages: db.messages
      });
    }

    if (req.method === 'POST' && pathname === '/api/owner/mark-read') {
      const { username } = await readBody(req);
      const db = loadData();
      let changed = false;
      db.messages.forEach(m => {
        if (m.username === username && m.sender === 'visitor' && !m.readByOwner) {
          m.readByOwner = true;
          changed = true;
        }
      });
      if (changed) saveData(db);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && pathname === '/api/owner/reply') {
      const { username, text } = await readBody(req);
      if (!username || !text || !String(text).trim()) {
        return sendJson(res, 400, { error: 'Reply text required.' });
      }
      const db = loadData();
      const msg = {
        id: 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        username,
        sender: 'owner',
        text: String(text).trim(),
        timestamp: new Date().toISOString(),
        readByOwner: true
      };
      db.messages.push(msg);
      saveData(db);
      return sendJson(res, 200, { message: msg });
    }

    if (req.method === 'POST' && pathname === '/api/owner/delete-message') {
      const { id } = await readBody(req);
      const db = loadData();
      db.messages = db.messages.filter(m => m.id !== id);
      saveData(db);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && pathname === '/api/owner/clear-chat') {
      const { username } = await readBody(req);
      const db = loadData();
      db.messages = db.messages.filter(m => m.username !== username);
      saveData(db);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && pathname === '/api/owner/reset-user-password') {
      const { username, newPassword } = await readBody(req);
      const db = loadData();
      const user = db.users.find(u => u.username === username);
      if (!user) return sendJson(res, 404, { error: 'User not found.' });
      if (!newPassword || newPassword.length < 4) return sendJson(res, 400, { error: 'Min 4 characters.' });
      user.password = newPassword;
      saveData(db);
      return sendJson(res, 200, { ok: true });
    }

    sendJson(res, 404, { error: 'Endpoint not found' });
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`DirectConnect Server running!`);
  console.log(`  Visitor App (Chat with Us):  http://localhost:${PORT}/`);
  console.log(`  Private Owner Inbox:         http://localhost:${PORT}/owner`);
});
