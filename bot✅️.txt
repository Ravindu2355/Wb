const crypto = require('crypto') ||  require('crypto-browserify'); // ⬅️ Add this line at the top
global.crypto = crypto;
console.log('✅ crypto loaded:', typeof crypto.createHash === 'function');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const qrcode = require('qrcode')
const fs = require('fs')
const http = require('http')
const path = require('path')

// HTTP server to show QR
http.createServer((req, res) => {
  if (req.url === '/qr') {
    const filePath = path.join(__dirname, 'qr.png')
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': 'image/png' })
      fs.createReadStream(filePath).pipe(res)
    } else {
      res.writeHead(404)
      res.end('QR not ready')
    }
  } else {
    res.writeHead(200)
    res.end('Whatsapp Bot interface index!')
  }
}).listen(8000, () => console.log('🔗 Visit: http://localhost:8000/qr'))

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth')

  const sock = makeWASocket({
    auth: state,
  })

  sock.ev.on('connection.update', async (update) => {
    const { qr, connection, lastDisconnect } = update

    if (qr) {
      await qrcode.toFile('qr.png', qr)
      console.log('📷 Scan QR from: http://localhost:3000/qr')
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.statusCode || ''
      console.log('❌ Disconnected. Reason code:', code)

      // Remove QR file if exists
      if (fs.existsSync('qr.png')) fs.unlinkSync('qr.png')

      // Auto-restart if not logged in
      if (code !== DisconnectReason.loggedOut) {
        console.log('🔁 Restarting bot...')
        startBot()
      } else {
        console.log('👋 Logged out. Please delete auth folder to reconnect.')
      }
    } else if (connection === 'open') {
      if (fs.existsSync('qr.png')) fs.unlinkSync('qr.png')
      console.log('✅ Connected to WhatsApp!')
    }
  })

  sock.ev.on('creds.update', saveCreds)

  // Simple reply to all messages
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return
    const msg = messages[0]
    if (!msg.message || msg.key.fromMe) return

    const from = msg.key.remoteJid
    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      msg.message.videoMessage?.caption ||
      ''

    console.log('📩 Message from:', from, '-', text)

    await sock.sendMessage(from, { text: 'Hi! I received your message 👋' })
  })
}

// Safe start with error handling
startBot().catch((err) => {
  console.error('🚨 Bot failed to start:', err)
})
