const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const express = require('express');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
let lastQR = '';
let status = 'Starting...';

app.get('/', async (req, res) => {
    if (!lastQR) {
        return res.send(`<h2>${status}</h2><p>Waiting for QR... Refresh in 5 sec</p><script>setTimeout(()=>location.reload(),5000)</script>`);
    }
    try {
        const qrImage = await QRCode.toDataURL(lastQR);
        res.send(`
            <div style="font-family:sans-serif;text-align:center;margin-top:30px">
                <h2>📱 Scan this QR with your WhatsApp</h2>
                <p>WhatsApp > Linked Devices > Link a Device</p>
                <img src="${qrImage}" style="width:300px;border:10px solid #000;padding:10px"/>
                <p>Status: ${status}</p>
                <p><i>Refresh page for new QR if expired</i></p>
            </div>
        `);
    } catch { res.send('Error generating QR'); }
});

app.listen(PORT, () => console.log(`Web QR server running on port ${PORT}`));

const client = new Client({
    authStrategy: new LocalAuth({ clientId: "group-manager-24-7" }),
    puppeteer: { headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] }
});

client.on('qr', qr => {
    lastQR = qr;
    status = 'QR Ready - Scan now!';
    console.log('QR Received - Open your hosted URL to scan');
    qrcode.generate(qr, {small: true});
});

client.on('ready', () => {
    status = '✅ Bot is ONLINE and READY!';
    lastQR = '';
    console.log(status);
});

client.on('authenticated', () => { status = 'Authenticated! Loading chats...'; });

const WARN_FILE = './warnings.json';
let warnings = fs.existsSync(WARN_FILE) ? JSON.parse(fs.readFileSync(WARN_FILE)) : {};

const CONFIG = {
    maxWarnings: 5,
    adminsImmune: true,
    allowLinksFromAdmins: true
};

const LINK_REGEX = /(chat\.whatsapp\.com|whatsapp\.com\/channel|wa\.me\/|t\.me\/|telegram\.me|discord\.gg|discord\.com\/invite)/i;
const NSFW_WORDS = ['porn','xxx','onlyfans','xvideos','xnxx','pornhub','xhamster','nudes','nude pic','sex video','amanyala','ucansi','ukuya ocansini','thumela amanyala','mzansi porn','mzansi nudes','sex'];
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

async function punish(chat, msg, reason) {
    const contact = await msg.getContact();
    const userId = contact.id._serialized;
    const participant = chat.participants.find(p => p.id._serialized === userId);
    if (CONFIG.adminsImmune && participant?.isAdmin) return;
    try { await msg.delete(true); } catch { return; }
    warnings[userId] = (warnings[userId] || 0) + 1;
    saveWarnings();
    if (warnings[userId] >= CONFIG.maxWarnings) {
        await chat.sendMessage(`🚫 @${contact.id.user} removed after ${CONFIG.maxWarnings} warnings (${reason})`, { mentions: [userId] });
        try { await chat.removeParticipants([userId]); } catch {}
        delete warnings[userId]; saveWarnings();
    } else {
        await chat.sendMessage(`⚠️ @${contact.id.user} Warning ${warnings[userId]}/${CONFIG.maxWarnings}: ${reason}`, { mentions: [userId] });
    }
}

client.on('message', async msg => {
    const chat = await msg.getChat();
    if (!chat.isGroup) return;
    const lower = msg.body.toLowerCase();

    // FIXED: get contact first, then check
    const contact = await msg.getContact();
    const contactId = contact.id._serialized;
    const participant = chat.participants.find(p => p.id._serialized === contactId);
    const isAdmin = participant?.isAdmin || false;

    if (LINK_REGEX.test(lower)) {
        if (!(CONFIG.allowLinksFromAdmins && isAdmin)) {
            await punish(chat, msg, 'Group/Channel link not allowed'); return;
        }
    }
    if (NSFW_WORDS.some(w => lower.includes(w))) { await punish(chat, msg, 'NSFW content'); return; }
    const spam = isSpam(msg.author || msg.from, msg.body);
    if (spam) { await punish(chat, msg, `Spam: ${spam}`); return; }
});

client.initialize();
