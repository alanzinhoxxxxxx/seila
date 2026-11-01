const dotenv = require("dotenv");

dotenv.config();

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error("Configure BOT_TOKEN no arquivo .env antes de iniciar o bot.");
}

const licenseSecret = process.env.LICENSE_SECRET;
if (!licenseSecret || Buffer.byteLength(licenseSecret, "utf8") < 32) {
  throw new Error("Configure LICENSE_SECRET no .env com pelo menos 32 bytes aleatórios.");
}

const adminIds = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

if (adminIds.length === 0 || adminIds.some((id) => !/^\d{17,20}$/.test(id))) {
  throw new Error("Configure ADMIN_IDS com um ou mais IDs numéricos de usuários do Discord.");
}

const prefix = process.env.PREFIX || "!";
if (prefix.length === 0 || prefix.length > 5) {
  throw new Error("PREFIX deve ter entre 1 e 5 caracteres.");
}

const panelChannelId = process.env.PANEL_CHANNEL_ID || null;
if (panelChannelId !== null && !/^\d{17,20}$/.test(panelChannelId)) {
  throw new Error("PANEL_CHANNEL_ID deve ser um ID numérico de canal válido do Discord.");
}

const logChannelId = process.env.LOG_CHANNEL_ID || null;
if (logChannelId !== null && !/^\d{17,20}$/.test(logChannelId)) {
  throw new Error("LOG_CHANNEL_ID deve ser um ID numérico de canal válido do Discord.");
}

const productLogChannelId = process.env.PRODUCT_LOG_CHANNEL_ID || null;
if (productLogChannelId !== null && !/^\d{17,20}$/.test(productLogChannelId)) {
  throw new Error("PRODUCT_LOG_CHANNEL_ID deve ser um ID numérico de canal válido do Discord.");
}

const statusChannelId = process.env.STATUS_CHANNEL_ID || null;
const statusGuildId   = process.env.STATUS_GUILD_ID   || null;
const discordInvite   = process.env.DISCORD_INVITE     || "https://discord.gg/mrstore";

const mainGuildId = process.env.MAIN_GUILD_ID || "1522456699082903572";
const statsChannelId = process.env.STATS_CHANNEL_ID || null;

module.exports = { adminIds: new Set(adminIds), licenseSecret, prefix, token, panelChannelId, logChannelId, productLogChannelId, statusChannelId, statusGuildId, discordInvite, mainGuildId, statsChannelId };
