
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const express = require('express');
const fs = require('fs');
const P = require('pino');

const app = express();
const PORT = process.env.PORT || 3000;
let lastQR = '';
let status = 'Starting...';

app.get('/', async (req, res) => {
    if (!lastQR) {
        return res.send(`<h2>${status}</h2><p>Refresh in 5 sec</p><script>setTimeout(()=>location.reload(),5000)</script>`);
    }
    try {
        const qrImage = await QRCode.toDataURL(lastQR);
        res.send(`
            <div style="font-family:sans-serif;text-align:center;margin-top:30px">
                <h2>📱 Scan this QR with WhatsApp</h2>
                <p>WhatsApp > Linked Devices > Link a Device</p>
                <img src="${qrImage}" style="width:300px;border:10px solid #000;padding:10px"/>
                <p>Status: ${status}</p>
            </div>
        `);
    } catch { res.send('Error generating QR'); }
});

app.listen(PORT, () => console.log(`Web QR server running on port ${PORT}`));

const WARN_FILE = './warnings.json';
let warnings = fs.existsSync(WARN_FILE) ? JSON.parse(fs.readFileSync(WARN_FILE)) : {};

const LINK_REGEX = /(chat\.whatsapp\.com|whatsapp\.com\/channel|wa\.me\/|t\.me\/|telegram\.me|discord\.gg|discord\.com\/invite)/i;
const NSFW_WORDS = ['porn','xxx','onlyfans','xvideos','xnxx','pornhub','xhamster','nudes','nude pic','sex video','amanyala','ucansi','thumela amanyala','mzansi porn','mzansi nudes','sex'];
const SPAM_TRACKER = new Map();

function isSpam(userId, message) {
    const now = Date.now();
    let history = SPAM_TRACKER.get(userId) || [];
    history = history.filter(t => now - t < 15000);
    history.push(now);
    SPAM_TRACKER.set(userId, history);
    if (history.length > 8) return 'Flood';
    if (message.length > 700) return 'Too long';
    return false;
}
function saveWarnings() { fs.writeFileSync(WARN_FILE, JSON.stringify(warnings, null, 2)); }

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const sock = makeWASocket({
        auth: state,
        logger: P({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome'),
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            lastQR = qr;
            status = 'QR Ready - Scan now!';
            qrcode.generate(qr, { small: true });
            console.log('QR Ready - Open your Render URL to scan');
        }
        if (connection === 'open') {
            status = '✅ Bot is ONLINE and READY!';
            lastQR = '';
            console.log(status);
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed, reconnecting:', shouldReconnect);
            if (shouldReconnect) startBot();
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;
        const jid = msg.key.remoteJid;
        if (!jid.endsWith('@g.us')) return; // only groups
        if (msg.key.fromMe) return;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || msg.message.videoMessage?.caption || '';
        const lower = text.toLowerCase();
        const userId = msg.key.participant || msg.key.remoteJid;
        const userShort = userId.split('@')[0].split(':')[0];

        // Check group admin status
        let isAdmin = false;
        try {
            const groupMetadata = await sock.groupMetadata(jid);
            const participant = groupMetadata.participants.find(p => p.id === userId);
            isAdmin = participant?.admin === 'admin' || participant?.admin === 'superadmin';
        } catch {}

        if (isAdmin) return; // admins immune

        let reason = null;
        if (LINK_REGEX.test(lower)) reason = 'Group/Channel link not allowed';
        else if (NSFW_WORDS.some(w => lower.includes(w))) reason = 'NSFW content';
        else {
            const spam = isSpam(userId, text);
            if (spam) reason = `Spam: ${spam}`;
        }

        if (!reason) return;

        // Delete message
        try {
            await sock.sendMessage(jid, { delete: msg.key });
            console.log(`Deleted ${reason} from ${userShort}`);
        } catch (e) {
            console.log('Failed to delete - Bot must be ADMIN');
            return;
        }

        warnings[userId] = (warnings[userId] || 0) + 1;
        saveWarnings();

        if (warnings[userId] >= 5) {
            await sock.sendMessage(jid, { text: `🚫 @${userShort} removed after 5 warnings (${reason})`, mentions: [userId] });
            try { await sock.groupParticipantsUpdate(jid, [userId], 'remove'); } catch {}
            delete warnings[userId]; saveWarnings();
        } else {
            await sock.sendMessage(jid, { text: `⚠️ @${userShort} Warning ${warnings[userId]}/5: ${reason}`, mentions: [userId] });
        }
    });
}

startBot();
