
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const express = require('express');
const fs = require('fs');
const P = require('pino');

const app = express();
const PORT = process.env.PORT || 10000;
let lastQR = '';
let status = 'Starting THUSO BOT...';
let activeGroups = new Set();

app.get('/', async (req, res) => {
    if (!lastQR) {
        return res.send(`<html><body style="font-family:sans-serif;text-align:center;margin-top:50px"><h1>${status}</h1><p>Active Groups: ${activeGroups.size}</p><p>Rules: 1) No links/ads 2) No other bots 3) 12h notify 4) Status mentions</p><p>Refresh in 5 sec</p><script>setTimeout(()=>location.reload(),5000)</script></body></html>`);
    }
    try {
        const qrImage = await QRCode.toDataURL(lastQR);
        res.send(`
            <div style="font-family:sans-serif;text-align:center;margin-top:30px">
                <h1>THUSO BOT - RULES FIXED</h1>
                <h2>📱 Scan QR with WhatsApp</h2>
                <img src="${qrImage}" style="width:300px;border:10px solid #000;padding:10px"/>
                <p><b>Status:</b> ${status}</p>
                <p>!rules now works for everyone</p>
            </div>
        `);
    } catch { res.send('Error generating QR'); }
});

app.listen(PORT, () => console.log(`THUSO BOT running on port ${PORT}`));

const RULES = {
    1: "Remove/Delete group links, websites, & other advertisement misconduct purposes",
    2: "Delete messages from other bots (no warning) instantly remove them",
    3: "Notify every 12 hours 'BOT BY THUSO ACTIVATED'",
    4: "Delete mentions the group in a member status (EXCLUDES @everyone/@all in chat)"
};

const AD_REGEX = /(https?:\/\/|www\.|chat\.whatsapp\.com|whatsapp\.com\/channel|wa\.me\/|t\.me\/|telegram\.me|discord\.gg|discord\.com\/invite|\.com|\.net|\.org|\.co\.za|\.xyz|\.online|bit\.ly|tinyurl)/i;

let OTHER_BOTS = [];
const OTHER_BOTS_FILE = './other_bots.json';
if (fs.existsSync(OTHER_BOTS_FILE)) {
    try { OTHER_BOTS = JSON.parse(fs.readFileSync(OTHER_BOTS_FILE)); } catch {}
}
function saveOtherBots() { fs.writeFileSync(OTHER_BOTS_FILE, JSON.stringify(OTHER_BOTS, null, 2)); }

const WARN_FILE = './warnings.json';
let warnings = fs.existsSync(WARN_FILE) ? JSON.parse(fs.readFileSync(WARN_FILE)) : {};
function saveWarnings() { fs.writeFileSync(WARN_FILE, JSON.stringify(warnings, null, 2)); }

function start12HourNotifier(sock) {
    setInterval(async () => {
        const message = "🤖 BOT BY THUSO ACTIVATED ✅\n\nRules Active:\n1️⃣ No group links / websites / ads\n2️⃣ No other bots allowed\n3️⃣ Group protected 24/7\n4️⃣ No status mentions of group";
        for (let groupId of activeGroups) {
            try { await sock.sendMessage(groupId, { text: message }); } catch {}
        }
    }, 12 * 60 * 60 * 1000);
    setTimeout(async () => {
        const message = "🤖 BOT BY THUSO ACTIVATED ✅\nBot is now ONLINE!";
        for (let groupId of activeGroups) {
            try { await sock.sendMessage(groupId, { text: message }); } catch {}
        }
    }, 10000);
}

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
        }
        if (connection === 'open') {
            status = '✅ THUSO BOT ONLINE - !rules FIXED';
            lastQR = '';
            console.log(status);
            try {
                const chats = await sock.groupFetchAllParticipating();
                activeGroups = new Set(Object.keys(chats));
                start12HourNotifier(sock);
            } catch {}
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;
        const jid = msg.key.remoteJid;
        if (!jid.endsWith('@g.us')) return;
        if (msg.key.fromMe) return;

        activeGroups.add(jid);

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || msg.message.videoMessage?.caption || '';
        const lower = text.toLowerCase().trim();
        const userId = msg.key.participant || msg.key.remoteJid;

        const contextInfo = msg.message.extendedTextMessage?.contextInfo || {};
        const groupMentions = contextInfo.groupMentions || [];

        // FIXED: !rules works for EVERYONE, before any admin checks
        if (lower === '!rules' || lower === '!rule' || lower === 'rules') {
            console.log(`!rules requested by ${userId} in ${jid}`);
            const rulesText = `📜 *GROUP RULES - THUSO BOT*\n\n1️⃣ ${RULES[1]}\n\n2️⃣ ${RULES[2]}\n\n3️⃣ ${RULES[3]}\n\n4️⃣ ${RULES[4]}\n\n🤖 BOT BY THUSO ACTIVATED`;
            try {
                await sock.sendMessage(jid, { text: rulesText });
                console.log('Sent rules');
            } catch (e) { console.log('Failed to send rules:', e.message); }
            return;
        }

        let isAdmin = false;
        let isBotAdmin = false;
        try {
            const groupMetadata = await sock.groupMetadata(jid);
            const participant = groupMetadata.participants.find(p => p.id === userId);
            isAdmin = participant?.admin === 'admin' || participant?.admin === 'superadmin';
            const botParticipant = groupMetadata.participants.find(p => p.id === sock.user.id);
            isBotAdmin = botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin';
        } catch {}

        if (isAdmin) {
            if (lower.startsWith('!addbot ')) {
                const num = lower.split(' ')[1].replace(/[^0-9]/g, '');
                if (num) {
                    const botId = num + '@s.whatsapp.net';
                    if (!OTHER_BOTS.includes(botId)) {
                        OTHER_BOTS.push(botId);
                        saveOtherBots();
                        await sock.sendMessage(jid, { text: `✅ Added ${num} to blocklist` });
                    }
                }
                return;
            }
            if (lower === '!listbots') {
                const list = OTHER_BOTS.map(b => b.split('@')[0]).join('\n') || 'No bots blocked';
                await sock.sendMessage(jid, { text: `🚫 Blocked bots:\n${list}` });
                return;
            }
            return;
        }

        if (!isBotAdmin) {
            console.log('Bot not admin, cannot delete');
            return;
        }

        // RULE 2: Other bots
        if (OTHER_BOTS.includes(userId) || OTHER_BOTS.includes(userId.split(':')[0] + '@s.whatsapp.net')) {
            try { await sock.sendMessage(jid, { delete: msg.key }); } catch {}
            return;
        }

        // RULE 1: Links/ads
        if (AD_REGEX.test(lower)) {
            try {
                await sock.sendMessage(jid, { delete: msg.key });
                const userShort = userId.split('@')[0].split(':')[0];
                warnings[userId] = (warnings[userId] || 0) + 1;
                saveWarnings();
                if (warnings[userId] >= 3) {
                    await sock.sendMessage(jid, { text: `🚫 @${userShort} removed - Rule 1`, mentions: [userId] });
                    try { await sock.groupParticipantsUpdate(jid, [userId], 'remove'); } catch {}
                    delete warnings[userId]; saveWarnings();
                } else {
                    await sock.sendMessage(jid, { text: `⚠️ @${userShort} Warning ${warnings[userId]}/3 - Rule 1: No links/ads`, mentions: [userId] });
                }
            } catch {}
            return;
        }

        // RULE 4: Status mentions of group
        if (groupMentions.length > 0) {
            try {
                await sock.sendMessage(jid, { delete: msg.key });
                const userShort = userId.split('@')[0].split(':')[0];
                await sock.sendMessage(jid, { text: `⚠️ @${userShort} Rule 4: No mentioning group in status`, mentions: [userId] });
            } catch {}
        }
    });
}

startBot();
