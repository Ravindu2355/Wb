const crypto = require('crypto') || require('crypto-browserify');
global.crypto = crypto;

console.log('✅ crypto loaded:', typeof crypto.createHash === 'function');

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const fs = require('fs');
const http = require('http');
const path = require('path');
const axios = require('axios');

// === Replace this with your actual OpenAI API key ===
//const OPENAI_API_KEY = 'sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const OPENAI_API_KEY = process.env.key;

if (!OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY is missing!");
  process.exit(1);
}


// HTTP server to show QR code
http.createServer((req, res) => {
  if (req.url === '/qr') {
    const filePath = path.join(__dirname, 'qr.png');
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404);
      res.end('QR not ready');
    }
  } else {
    res.writeHead(200);
    res.end('Whatsapp Bot interface index!');
  }
}).listen(8000, () => console.log('🔗 Visit: http://localhost:8000/qr'));

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth');

  const sock = makeWASocket({ auth: state });

  sock.ev.on('connection.update', async (update) => {
    const { qr, connection, lastDisconnect } = update;

    if (qr) {
      await qrcode.toFile('qr.png', qr);
      console.log('📷 Scan QR from: http://localhost:8000/qr');
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.statusCode || '';
      console.log('❌ Disconnected. Reason code:', code);

      if (fs.existsSync('qr.png')) fs.unlinkSync('qr.png');

      if (code !== DisconnectReason.loggedOut) {
        console.log('🔁 Restarting bot...');
        startBot();
      } else {
        console.log('👋 Logged out. Please delete auth folder to reconnect.');
      }
    } else if (connection === 'open') {
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
      msg.message.videoMessage?.caption ||
      '';

    if (!text.startsWith('/ai')) return;

    const prompt = text.replace('/ai', '').trim();
    if (!prompt) {
      await sock.sendMessage(from, { text: '🤖 Please provide a message after `/ai`.' });
      return;
    }

    console.log('📩 AI Request from:', from, '-', prompt);

    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 1000,
          temperature: 0.7,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
        }
      );

      const reply = response.data.choices[0].message.content.trim();
      console.log('🤖 ChatGPT:', reply);

      await sock.sendMessage(from, { text: reply });
    } catch (err) {
      console.error('❌ OpenAI API Error:', err.response?.data || err.message);
      await sock.sendMessage(from, { text: '⚠️ Failed to fetch AI response. Try again later.' });
    }
  });
}

startBot().catch((err) => {
  console.error('🚨 Bot failed to start:', err);
});
