const dotenv = require("dotenv");

// Carrega .env apenas se não estiver em produção
if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("❌ BOT_TOKEN não configurado!");
  throw new Error("Configure BOT_TOKEN nas variáveis de ambiente.");
}

const licenseSecret = process.env.LICENSE_SECRET || "default_secret_key_for_license_generation_32bytes_minimum";

// Aceita ADMIN_IDS ou ADMIN1D_ID (erro de digitação comum)
const adminIdsEnv = process.env.ADMIN_IDS || process.env.ADMIN1D_ID || "1382576164752724069";
const adminIds = adminIdsEnv
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

const prefix = process.env.PREFIX || "!";
if (prefix.length === 0 || prefix.length > 5) {
  console.warn("⚠️ PREFIX inválido, usando '!' como padrão");
}

const panelChannelId = process.env.PANEL_CHANNEL_ID || null;
const logChannelId = process.env.LOG_CHANNEL_ID || null;
const productLogChannelId = process.env.PRODUCT_LOG_CHANNEL_ID || logChannelId; // Usa LOG_CHANNEL_ID como fallback

const statusChannelId = process.env.STATUS_CHANNEL_ID || null;
const statusGuildId   = process.env.STATUS_GUILD_ID   || null;
const discordInvite   = process.env.DISCORD_INVITE     || "https://discord.gg/mrstore";

const mainGuildId = process.env.MAIN_GUILD_ID || "1522456699082903572";
const statsChannelId = process.env.STATS_CHANNEL_ID || null;

module.exports = { adminIds: new Set(adminIds), licenseSecret, prefix, token, panelChannelId, logChannelId, productLogChannelId, statusChannelId, statusGuildId, discordInvite, mainGuildId, statsChannelId };
