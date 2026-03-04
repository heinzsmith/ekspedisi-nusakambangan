// ============================================================
// DISCORD VERIFICATION BOT — !verify command
// Player ketik !verify di Discord → dapat kode DM → input di Roblox
//
// SETUP:
// 1. npm install discord.js express
// 2. Isi CONFIG di bawah
// 3. node bot.js
// ============================================================

const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const express = require("express");
const crypto  = require("crypto");

// ============================================================
// KONFIGURASI — WAJIB DIISI
// ============================================================
const CONFIG = {
  BOT_TOKEN        : process.env.BOT_TOKEN,
  GUILD_ID         : "1435839623979991052",
  VERIFY_CHANNEL_ID: "1478650907364429956",  // Channel tempat !verify bisa dipakai
  PORT             : 3000,
  CODE_EXPIRE_MIN  : 10,
};

// ============================================================
// STORAGE (in-memory)
// pendingVerifications: Map<code, { discordUserId, discordUsername, expiresAt }>
// usedDiscordIds: Set<discordUserId> — sudah pernah verify (session)
// ============================================================
const pendingVerifications = new Map();
const usedDiscordIds       = new Set();

function generateCode() {
  return crypto.randomBytes(3).toString("hex").toUpperCase(); // contoh: A3F9C1
}

// ============================================================
// DISCORD CLIENT
// ============================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

client.once("ready", () => {
  console.log(`[Bot] ✅ Online sebagai ${client.user.tag}`);
  console.log(`[Bot] Mendengarkan !verify di channel ID: ${CONFIG.VERIFY_CHANNEL_ID}`);
});

// ============================================================
// HANDLE PESAN !verify
// ============================================================
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  // Hanya proses di channel yang ditentukan
  if (message.channel.id !== CONFIG.VERIFY_CHANNEL_ID) return;

  const content = message.content.trim().toLowerCase();
  if (content !== "!verify") return;

  const discordUser = message.author;

  // Hapus pesan player agar channel tetap bersih
  try { await message.delete(); } catch (_) {}

  // ── Cek sudah pernah verify sebelumnya ──
  if (usedDiscordIds.has(discordUser.id)) {
    const reply = await message.channel.send({
      content: `<@${discordUser.id}> ✅ Kamu sudah terverifikasi! Free VIP sudah aktif di game.`,
    });
    setTimeout(() => reply.delete().catch(() => {}), 6000);
    return;
  }

  // ── Cek apakah sudah punya kode aktif ──
  let existingCode = null;
  for (const [code, data] of pendingVerifications.entries()) {
    if (data.discordUserId === discordUser.id && data.expiresAt > Date.now()) {
      existingCode = code;
      break;
    }
  }

  if (existingCode) {
    const data     = pendingVerifications.get(existingCode);
    const minsLeft = Math.ceil((data.expiresAt - Date.now()) / 60000);

    try {
      await discordUser.send({
        embeds: [new EmbedBuilder()
          .setTitle("⏳ Kode Masih Aktif")
          .setDescription(
            `Kamu sudah punya kode aktif:\n\n` +
            `# \`${existingCode}\`\n\n` +
            `Masukkan kode ini di game Roblox.\n` +
            `*Berlaku ${minsLeft} menit lagi.*`
          )
          .setColor(0xFFA500)
        ]
      });
    } catch (_) {}

    const reply = await message.channel.send({
      content: `<@${discordUser.id}> Kode masih aktif, sudah dikirim ulang ke DM! 📬`,
    });
    setTimeout(() => reply.delete().catch(() => {}), 6000);
    return;
  }

  // ── Hapus kode lama yang expired milik user ini ──
  for (const [code, data] of pendingVerifications.entries()) {
    if (data.discordUserId === discordUser.id) {
      pendingVerifications.delete(code);
    }
  }

  // ── Generate kode baru ──
  const code      = generateCode();
  const expiresAt = Date.now() + CONFIG.CODE_EXPIRE_MIN * 60 * 1000;

  pendingVerifications.set(code, {
    discordUserId  : discordUser.id,
    discordUsername: discordUser.username,
    expiresAt,
  });

  console.log(`[Bot] 🔑 Kode ${code} dibuat untuk ${discordUser.username} (${discordUser.id})`);

  // ── Kirim kode via DM ──
  const codeEmbed = new EmbedBuilder()
    .setTitle("🔑 Kode Verifikasi Roblox Kamu")
    .setDescription(
      `Kode verifikasi kamu:\n\n` +
      `# \`${code}\`\n\n` +
      `**Cara pakai:**\n` +
      `1️⃣ Buka game Roblox\n` +
      `2️⃣ Klik tombol 🎮 di pojok kanan bawah layar\n` +
      `3️⃣ Masukkan kode di atas\n` +
      `4️⃣ Free VIP langsung aktif! 🏆\n\n` +
      `⏱️ Kode berlaku **${CONFIG.CODE_EXPIRE_MIN} menit**\n` +
      `🔒 **Jangan bagikan kode ini ke siapapun!**`
    )
    .setColor(0x5865F2)
    .setFooter({ text: "Satu akun Discord = satu akun Roblox" })
    .setTimestamp();

  let dmSent = false;
  try {
    await discordUser.send({ embeds: [codeEmbed] });
    dmSent = true;
  } catch (_) {
    // DM diblokir oleh user
  }

  // ── Reply di channel (auto-delete 6 detik) ──
  const replyText = dmSent
    ? `<@${discordUser.id}> ✅ Kode verifikasi sudah dikirim ke DM kamu! 📬`
    : `<@${discordUser.id}> ❌ Gagal mengirim DM! Pastikan DM kamu terbuka, lalu ketik \`!verify\` lagi.`;

  const reply = await message.channel.send({ content: replyText });
  setTimeout(() => reply.delete().catch(() => {}), 6000);
});

// ============================================================
// EXPRESS API — Dipanggil Roblox untuk verifikasi kode
// POST /verify  body: { code, robloxUserId, robloxUsername }
// ============================================================
const app = express();
app.use(express.json());

app.post("/verify", async (req, res) => {
  const { code, robloxUserId, robloxUsername } = req.body;

  if (!code || !robloxUserId) {
    return res.status(400).json({ success: false, message: "Missing code or robloxUserId" });
  }

  const upperCode = code.toUpperCase().trim();
  const data      = pendingVerifications.get(upperCode);

  if (!data) {
    return res.status(404).json({ success: false, message: "Kode tidak ditemukan atau sudah digunakan." });
  }

  if (data.expiresAt < Date.now()) {
    pendingVerifications.delete(upperCode);
    return res.status(410).json({ success: false, message: "Kode sudah expired. Ketik !verify lagi di Discord." });
  }

  // ── Sukses! ──
  pendingVerifications.delete(upperCode);
  usedDiscordIds.add(data.discordUserId);

  console.log(`[Bot] ✅ Verified! Discord: ${data.discordUsername} ↔ Roblox: ${robloxUsername} (${robloxUserId})`);

  // DM sukses ke Discord user
  try {
    const guild  = await client.guilds.fetch(CONFIG.GUILD_ID);
    const member = await guild.members.fetch(data.discordUserId);
    await member.send({
      embeds: [new EmbedBuilder()
        .setTitle("🎉 Verifikasi Berhasil!")
        .setDescription(
          `Akun kamu berhasil terhubung!\n\n` +
          `🎮 **Roblox:** ${robloxUsername || robloxUserId}\n\n` +
          `✨ **Free VIP** sudah aktif di game!`
        )
        .setColor(0xFFD700)
        .setTimestamp()
      ]
    });
  } catch (_) {}

  return res.json({
    success        : true,
    message        : "Verifikasi berhasil!",
    discordUsername: data.discordUsername,
    discordId      : data.discordUserId,
  });
});

app.get("/", (_, res) => res.json({
  status : "running",
  pending: pendingVerifications.size,
  verified: usedDiscordIds.size,
}));

app.listen(CONFIG.PORT, () => {
  console.log(`[Express] ✅ API berjalan di port ${CONFIG.PORT}`);
});

client.login(CONFIG.BOT_TOKEN);

// Cleanup expired codes tiap 5 menit
setInterval(() => {
  const now     = Date.now();
  let   cleaned = 0;
  for (const [code, data] of pendingVerifications.entries()) {
    if (data.expiresAt < now) {
      pendingVerifications.delete(code);
      cleaned++;
    }
  }
  if (cleaned > 0) console.log(`[Bot] 🧹 Cleaned ${cleaned} expired codes`);
}, 5 * 60 * 1000);
