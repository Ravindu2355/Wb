const crypto = require('crypto') || require('crypto-browserify');
global.crypto = crypto;

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { lookup } = require('mime-types');
const https = require('https');
const httpLib = require('http');

let sock; // global socket for REST access

// HTTP Server for QR and REST API
http.createServer(async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.url === '/qr') {
    const filePath = path.join(__dirname, 'qr.png');
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404);
      return res.end('QR not ready');
    }
  }

  // REST: Send text message
  if (req.url === '/api/send' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      try {
        const { to, message } = JSON.parse(body);
        if (!sock) throw 'Bot not connected';
        await sock.sendMessage(to, { text: message });
        res.end(JSON.stringify({ ok: true, sent: true }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.toString() }));
      }
    });
    return;
  }

  // REST: Upload file from URL
  if (req.url === '/api/upload' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      try {
        const { to, fileUrl, fileName = 'file', mimeType } = JSON.parse(body);
        if (!sock) throw 'Bot not connected';

        const stream = await downloadFile(fileUrl);
        const ext = path.extname(fileUrl.split('?')[0]) || '';
        const fileType = mimeType || lookup(ext) || 'application/octet-stream';

        await sock.sendMessage(to, {
          document: stream,
          fileName: fileName + ext,
          mimetype: fileType
        });

        res.end(JSON.stringify({ ok: true, sent: true }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.toString() }));
      }
    });
    return;
  }

  // Default: Index
  res.writeHead(200);
  res.end('✅ WhatsApp Bot is running.\nSee /qr for QR code');
}).listen(8000, () => {
  console.log('🔗 REST API and QR Server running on http://localhost:8000');
});

// Download file stream
function downloadFile(fileUrl) {
  return new Promise((resolve, reject) => {
    const lib = fileUrl.startsWith('https') ? https : httpLib;
    lib.get(fileUrl, (response) => {
      if (response.statusCode !== 200) return reject('File not reachable');
      resolve(response);
    }).on('error', reject);
  });
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth');
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
  });

  sock.ev.on('connection.update', async (update) => {
    const { qr, connection, lastDisconnect } = update;

    if (qr) {
      await qrcode.toFile('qr.png', qr);
      console.log('📷 QR available at: http://localhost:8000/qr');
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode || '';
      console.log('❌ Disconnected. Code:', code);

      if (fs.existsSync('qr.png')) fs.unlinkSync('qr.png');

      if (code !== DisconnectReason.loggedOut) {
        console.log('🔁 Reconnecting...');
        startBot();
      } else {
        console.log('👋 Logged out. Delete auth folder to relogin.');
      }
    }

    if (connection === 'open') {
      if (fs.existsSync('qr.png')) fs.unlinkSync('qr.png');
      console.log('✅ Connected to WhatsApp!');
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      msg.message.videoMessage?.caption || '';

    console.log('📩', from, '-', text);

    if (text.startsWith('/upload ')) {
      const url = text.split(' ')[1];
      if (!url) return await sock.sendMessage(from, { text: '⚠️ Usage: /upload <video_url>' });

      try {
        const stream = await downloadFile(url);
        await sock.sendMessage(from, {
          document: stream,
          fileName: 'video.mp4',
          mimetype: 'video/mp4'
        });
      } catch (e) {
        await sock.sendMessage(from, { text: '❌ Failed to upload video.' });
      }
    } else {
      await sock.sendMessage(from, { text: '👋 I received your message!' });
    }
  });
}

startBot().catch((err) => {
  console.error('🚨 Failed to start bot:', err);
});
