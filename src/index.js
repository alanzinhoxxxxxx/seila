const crypto = require("node:crypto");
const path = require("node:path");

// Função para gerar código TOTP (2FA) a partir de um secret
function generate2FA(secret) {
  try {
    // Remover espaços e converter para uppercase
    const cleanSecret = secret.replace(/\s+/g, '').toUpperCase();
    
    // Decodificar Base32 manualmente
    const base32chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    for (let i = 0; i < cleanSecret.length; i++) {
      const val = base32chars.indexOf(cleanSecret[i]);
      if (val === -1) continue;
      bits += val.toString(2).padStart(5, '0');
    }
    
    // Converter bits para bytes
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
      bytes.push(parseInt(bits.substr(i, 8), 2));
    }
    const key = Buffer.from(bytes);
    
    // Calcular TOTP
    const epoch = Math.floor(Date.now() / 1000);
    const time = Math.floor(epoch / 30);
    const timeBuffer = Buffer.alloc(8);
    timeBuffer.writeBigInt64BE(BigInt(time));
    
    // HMAC-SHA1
    const hmac = crypto.createHmac('sha1', key);
    hmac.update(timeBuffer);
    const hash = hmac.digest();
    
    // Extrair código de 6 dígitos
    const offset = hash[hash.length - 1] & 0x0f;
    const code = (
      ((hash[offset] & 0x7f) << 24) |
      ((hash[offset + 1] & 0xff) << 16) |
      ((hash[offset + 2] & 0xff) << 8) |
      (hash[offset + 3] & 0xff)
    ) % 1000000;
    
    return code.toString().padStart(6, '0');
  } catch (error) {
    return null;
  }
}
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  ModalBuilder,
  MessageFlags,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const { adminIds, licenseSecret, panelChannelId, logChannelId, productLogChannelId, statusChannelId, statusGuildId, discordInvite, mainGuildId, statsChannelId, prefix, token } = require("./config");
const { Storage } = require("./storage");

// Voice connection (instalado com: npm install @discordjs/voice)
let voiceModule;
try {
  voiceModule = require("@discordjs/voice");
} catch (err) {
  console.warn("⚠️ @discordjs/voice não instalado. Comando !cv não funcionará. Instale com: npm install @discordjs/voice");
}

const storage = new Storage(path.join(__dirname, "..", "data", "store.json"));
const redeemsLogPath = path.join(__dirname, "..", "data", "redeems-log.json");

// Funções para gerenciar log de resgates
async function loadRedeemsLog() {
  try {
    const data = await require("node:fs/promises").readFile(redeemsLogPath, "utf8");
    return JSON.parse(data);
  } catch (error) {
    return { redeems: {} };
  }
}

async function saveRedeemsLog(log) {
  await require("node:fs/promises").writeFile(redeemsLogPath, JSON.stringify(log, null, 2) + "\n", "utf8");
}

async function logRedeem(userId, productId, timestamp) {
  const log = await loadRedeemsLog();
  if (!log.redeems[userId]) {
    log.redeems[userId] = {};
  }
  if (!log.redeems[userId][productId]) {
    log.redeems[userId][productId] = [];
  }
  log.redeems[userId][productId].push({
    timestamp,
    date: new Date(timestamp).toISOString()
  });
  await saveRedeemsLog(log);
}

async function getLastRedeem(userId, productId) {
  const log = await loadRedeemsLog();
  const userRedeems = log.redeems[userId]?.[productId];
  if (!userRedeems || userRedeems.length === 0) return null;
  return userRedeems[userRedeems.length - 1].timestamp;
}

// Produtos disponíveis — chave = ID interno, valor = nome de exibição
const products = {
  rockstar:    "Rockstar",
  discord:     "Discord",
  steam:       "Steam",
  rockstar_50: "Rockstar 50%",
};

// URL do canal de compra
const BUY_CHANNEL_URL = "https://discord.com/channels/1522456699082903572/1563638044286918757";

// ---------------------------------------------------------------------------
// Log de atividade
// ---------------------------------------------------------------------------

/**
 * Envia uma embed de log para o canal configurado em LOG_CHANNEL_ID.
 * @param {"success"|"fail"|"warn"} type
 * @param {string} title
 * @param {Object} fields  { label: string, value: string }[]
 * @param {import("discord.js").User} user
 */
async function sendLog(type, title, fields, user, guildId = null) {
  if (!logChannelId) return;
  try {
    const channel = await client.channels.fetch(logChannelId);
    if (!channel || !channel.isTextBased()) return;

    const colors = { success: 0x57f287, fail: 0xed4245, warn: 0xfee75c };
    const icons  = { success: "✅", fail: "❌", warn: "⚠️" };

    const guildName = guildId ? (client.guilds.cache.get(guildId)?.name || `ID: ${guildId}`) : "Desconhecido";

    const embed = new EmbedBuilder()
      .setColor(colors[type] ?? 0x99aab5)
      .setTitle(`${icons[type] ?? "📋"} ${title}`)
      .setThumbnail(user.displayAvatarURL({ size: 64 }))
      .addFields(
        { name: "Usuário", value: `<@${user.id}> \`${user.tag}\``, inline: true },
        { name: "ID", value: `\`${user.id}\``, inline: true },
        { name: "Servidor", value: guildName, inline: true },
        ...fields.map((f) => ({ name: f.label, value: f.value, inline: f.inline ?? false })),
      )
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error("Não foi possível enviar log:", error);
  }
}

/**
 * Gera um hash de autenticidade para o log de resgate de produto.
 * Combina userId + productId + account + timestamp.
 */
function productRedeemHash(userId, productId, account, redeemedAt) {
  return crypto
    .createHmac("sha256", licenseSecret)
    .update(`PRODUCT:${userId}:${productId}:${account}:${redeemedAt}`)
    .digest("hex")
    .toUpperCase()
    .slice(0, 32); // 32 chars — legível mas único
}

/**
 * Envia o log de produto resgatado para o canal PRODUCT_LOG_CHANNEL_ID.
 */
async function sendProductLog({ user, plan, productId, account, redeemedAt, guildId }) {
  if (!productLogChannelId) return;
  try {
    const channel = await client.channels.fetch(productLogChannelId);
    if (!channel || !channel.isTextBased()) return;

    const buttonLabel = products[productId] ?? productId;
    const licenseText = plan?.expiresAt === null
      ? "Vitalício"
      : plan?.expiresAt
        ? `<t:${Math.floor(plan.expiresAt / 1000)}:F> (<t:${Math.floor(plan.expiresAt / 1000)}:R>)`
        : "Desconhecido";

    const hash = productRedeemHash(user.id, productId, account, redeemedAt);
    const guildName = guildId ? (client.guilds.cache.get(guildId)?.name || `ID: ${guildId}`) : "Desconhecido";

    const embed = new EmbedBuilder()
      .setColor(0xed1c24)
      .setTitle("🎮 Produto resgatado")
      .setThumbnail(user.displayAvatarURL({ size: 64 }))
      .addFields(
        { name: "Usuário",            value: `<@${user.id}>`,      inline: true },
        { name: "ID do usuário",      value: `\`${user.id}\``,     inline: true },
        { name: "Servidor",           value: guildName,            inline: true },
        { name: "Tempo de licença",   value: licenseText,          inline: false },
        { name: "Botão",              value: `\`${buttonLabel}\``, inline: true },
        { name: "Produto resgatado",  value: `\`\`\`${account}\`\`\``, inline: false },
        { name: "Hash de autenticidade", value: `\`${hash}\``,    inline: false },
      )
      .setTimestamp(new Date(redeemedAt))
      .setFooter({ text: "Gerador de Licenças • Log de entregas" });

    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error("Não foi possível enviar log de produto:", error);
  }
}

// ---------------------------------------------------------------------------
// Duração livre
// ---------------------------------------------------------------------------

/**
 * Parseia uma string de duração livre.
 * Retorna { label, keyCode, milliseconds } ou null se inválido.
 * Exemplos: "1h", "3d", "2w", "6mo", "1ano", "vitalicio"
 */
function parseDuration(input) {
  const raw = input.trim().toLowerCase().replace(/\s+/g, "");

  if (["vitalicio", "vitalício", "lifetime", "life"].includes(raw)) {
    return { label: "Vitalício", keyCode: "life", milliseconds: null };
  }

  const match = /^(\d+)(s|m|h|d|w|sem|mo|mes|mês|ano|anos|year|years|y)$/.exec(raw);
  if (!match) return null;

  const n = Number(match[1]);
  if (n <= 0 || n > 3650) return null;

  const unit = match[2];
  let ms, labelUnit, keyCodeUnit;

  if (unit === "s") {
    ms = n * 1_000;
    labelUnit = n === 1 ? "segundo" : "segundos";
    keyCodeUnit = "s";
  } else if (unit === "m") {
    ms = n * 60_000;
    labelUnit = n === 1 ? "minuto" : "minutos";
    keyCodeUnit = "m";
  } else if (unit === "h") {
    ms = n * 3_600_000;
    labelUnit = n === 1 ? "hora" : "horas";
    keyCodeUnit = "h";
  } else if (unit === "d") {
    ms = n * 86_400_000;
    labelUnit = n === 1 ? "dia" : "dias";
    keyCodeUnit = "d";
  } else if (unit === "w" || unit === "sem") {
    ms = n * 7 * 86_400_000;
    labelUnit = n === 1 ? "semana" : "semanas";
    keyCodeUnit = "w";
  } else if (unit === "mo" || unit === "mes" || unit === "mês") {
    ms = n * 30 * 86_400_000;
    labelUnit = n === 1 ? "mês" : "meses";
    keyCodeUnit = "mo";
  } else if (unit === "ano" || unit === "anos" || unit === "year" || unit === "years" || unit === "y") {
    ms = n * 365 * 86_400_000;
    labelUnit = n === 1 ? "ano" : "anos";
    keyCodeUnit = "y";
  } else {
    return null;
  }

  return { label: `${n} ${labelUnit}`, keyCode: `${n}${keyCodeUnit}`, milliseconds: ms };
}

// Durations legadas — apenas para resgate de keys antigas
const legacyDurations = {
  "1s":     { label: "1 segundo",      keyCode: "1s",  milliseconds: 1_000 },
  "1m":     { label: "1 minuto",       keyCode: "1m",  milliseconds: 60_000 },
  "1h":     { label: "1 hora",         keyCode: "1h",  milliseconds: 3_600_000 },
  "1d":     { label: "1 dia",          keyCode: "1d",  milliseconds: 86_400_000 },
  month:    { label: "1 mês (30 dias)", keyCode: "1mo", milliseconds: 30 * 86_400_000 },
  lifetime: { label: "Vitalício",       keyCode: "life", milliseconds: null },
};

const maxKeysPerBatch = 100;
const productCooldownMs = 2 * 60 * 60 * 1_000; // 2 horas (planos 16+ dias)
const shortPlanCooldownMs = 3 * 60 * 60 * 1_000; // 3 horas (planos 5min a 15 dias)
const lifetimeCooldownMs = 45 * 60 * 1_000; // 45 minutos (planos vitalícios)
const penaltyCooldownMs = 4 * 60 * 60 * 1_000; // 4 horas (penalidade por uso abusivo)
const redeemTrackingWindow = 6 * 60 * 60 * 1_000; // Janela de 6 horas para rastrear resgates
const maxRedeemsBeforePenalty = 3; // Máximo de resgates na janela antes de penalizar
const shortPlanThresholdMs = 15 * 24 * 60 * 60 * 1_000; // 15 dias - limite para cooldown de 3h

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

function isAdmin(userId) {
  return adminIds.has(userId);
}

// ---------------------------------------------------------------------------
// Painel público de produtos
// ---------------------------------------------------------------------------

function createProductPanel(counts, ativos = 0, expirados = 0) {
  const embed = new EmbedBuilder()
    .setColor(0xed1c24)
    .setTitle("⚡ Gerador de Licenças")
    .setDescription([
      "Você possui uma assinatura ativa? Clique no botão abaixo para receber seu item.",
      "",
      "> Selecione um produto para receber a conta em uma mensagem privada.",
    ].join("\n"))
    .addFields(
      {
        name: "📦 Estoque disponível",
        value: [
          `🎮 **Rockstar:** ${counts.rockstar} disponível(is)`,
          `💬 **Discord:** ${counts.discord} disponível(is)`,
          `🎮 **Steam:** ${counts.steam} disponível(is)`,
          `🏷️ **Rockstar 50%:** ${counts.rockstar_50} disponível(is)`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "👥 Status das Licenças",
        value: `🟢 **${ativos}** licenças ativas  ·  🔴 **${expirados}** expiradas`,
        inline: false,
      },
    )
    .setImage("attachment://panel-banner.png")
    .setFooter({ text: "Quantidade atualizada automaticamente • Entrega privada" });

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("product:rockstar")
      .setLabel("Rockstar")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(counts.rockstar === 0),
    new ButtonBuilder()
      .setCustomId("product:discord")
      .setLabel("Discord")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(counts.discord === 0),
    new ButtonBuilder()
      .setCustomId("product:steam")
      .setLabel("Steam")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(counts.steam === 0),
    new ButtonBuilder()
      .setCustomId("product:rockstar_50")
      .setLabel("Rockstar 50%")
      .setStyle(ButtonStyle.Success)
      .setDisabled(counts.rockstar_50 === 0),
    new ButtonBuilder()
      .setCustomId("plan:show")
      .setLabel("Meu Plano")
      .setStyle(ButtonStyle.Danger),
  );

  return {
    embeds: [embed],
    components: [row1],
    files: [
      new AttachmentBuilder(path.join(__dirname, "..", "assets", "panel-banner.png"), {
        name: "panel-banner.png",
      }),
    ],
  };
}

async function productPanel() {
  const counts = await storage.read((state) => ({
    rockstar:    state.stock.rockstar.length,
    discord:     state.stock.discord.length,
    steam:       state.stock.steam.length,
    rockstar_50: state.stock.rockstar_50.length,
  }));

  const now = Date.now();
  const plans = await storage.read((state) => state.plans);
  let ativos = 0, expirados = 0;
  for (const plan of Object.values(plans)) {
    if (plan.expiresAt === null || plan.expiresAt > now) ativos++;
    else expirados++;
  }

  return createProductPanel(counts, ativos, expirados);
}

async function findPanelMessage(channel) {
  const messages = await channel.messages.fetch({ limit: 50 });
  for (const message of messages.values()) {
    if (message.author.id !== client.user.id) continue;
    const embed = message.embeds?.[0];
    if (embed?.description?.includes("Clique no botão abaixo para receber")) {
      return message;
    }
  }
  return null;
}

async function refreshPanel() {
  const panels = await storage.read((state) => state.panels || {});
  
  // Se não houver painéis multi-servidor, tentar migrar o painel antigo
  if (Object.keys(panels).length === 0) {
    const oldPanel = await storage.read((state) => state.panel);
    if (oldPanel && oldPanel.channelId) {
      // Migrar painel antigo para nova estrutura
      try {
        const channel = await client.channels.fetch(oldPanel.channelId);
        if (channel && channel.guildId) {
          await storage.transact((state) => {
            if (!state.panels) state.panels = {};
            state.panels[channel.guildId] = { channelId: oldPanel.channelId, messageId: oldPanel.messageId };
          });
          panels[channel.guildId] = { channelId: oldPanel.channelId, messageId: oldPanel.messageId };
        }
      } catch (err) {
        console.error("Erro ao migrar painel antigo:", err);
      }
    }
  }

  // Se ainda não houver painéis, tentar criar um no canal padrão
  if (Object.keys(panels).length === 0 && panelChannelId) {
    try {
      const channel = await client.channels.fetch(panelChannelId);
      if (channel && channel.guildId) {
        const message = await findPanelMessage(channel);
        if (message) {
          await storage.transact((state) => {
            if (!state.panels) state.panels = {};
            state.panels[channel.guildId] = { channelId: channel.id, messageId: message.id };
          });
          panels[channel.guildId] = { channelId: channel.id, messageId: message.id };
        }
      }
    } catch (err) {
      console.error("Erro ao criar painel padrão:", err);
    }
  }

  // Atualizar todos os painéis registrados
  for (const [guildId, ref] of Object.entries(panels)) {
    if (!ref || !ref.channelId) continue;

    let channel;
    try {
      channel = await client.channels.fetch(ref.channelId);
    } catch (error) {
      console.error(`Não foi possível encontrar o canal do painel no servidor ${guildId}:`, error);
      continue;
    }

    if (!channel || typeof channel.messages?.fetch !== "function") continue;

    try {
      let message = null;
      if (ref.messageId) {
        try {
          const fetched = await channel.messages.fetch(ref.messageId);
          if (fetched.author.id === client.user.id) message = fetched;
        } catch {
          // mensagem removida; localizar novamente
        }
      }
      if (!message) {
        message = await findPanelMessage(channel);
        if (message) {
          await storage.transact((state) => {
            if (!state.panels) state.panels = {};
            state.panels[guildId] = { channelId: channel.id, messageId: message.id };
          });
        }
      }
      if (!message) {
        console.error(`Painel não encontrado no servidor ${guildId}. Reenvie com !painel.`);
        continue;
      }
      await message.edit(await productPanel());
    } catch (error) {
      console.error(`Não foi possível atualizar o painel no servidor ${guildId}:`, error);
    }
  }
}

// ---------------------------------------------------------------------------
// Painel de administração unificado (!admin)
// ---------------------------------------------------------------------------

function adminPanel() {
  // Linha 1 — Adicionar estoque
  const rowStock = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("stock:add:rockstar")
      .setLabel("＋ Rockstar")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("stock:add:discord")
      .setLabel("＋ Discord")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("stock:add:steam")
      .setLabel("＋ Steam")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("stock:add:rockstar_50")
      .setLabel("＋ Rockstar 50%")
      .setStyle(ButtonStyle.Success),
  );

  // Linha 2 — Resgatar produtos e Keys
  const rowRedeemKeys = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("admin:bulk-redeem")
      .setLabel("🎁 Resgatar Produtos")
      .setEmoji("📦")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("key:open:single")
      .setLabel("🔑 Gerar Key")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("key:open:batch")
      .setLabel("📦 Keys em Lote")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("key:open:free")
      .setLabel("🆓 Key Free")
      .setStyle(ButtonStyle.Secondary),
  );

  // Linha 3 — Gerenciamento
  const rowManagement = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("admin:reset-key")
      .setLabel("🔄 Resetar Key")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("admin:revoke")
      .setLabel("🚫 Remover Acesso")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("admin:plans")
      .setLabel("📋 Ver Planos")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("admin:toggle-free")
      .setLabel("⏸️ Pausar Free")
      .setStyle(ButtonStyle.Secondary),
  );

  // Linha 4 — Blacklist
  const rowBlacklist = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("admin:blacklist:add")
      .setLabel("⛔ Adicionar Blacklist")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("admin:blacklist:remove")
      .setLabel("✅ Remover Blacklist")
      .setStyle(ButtonStyle.Success),
  );

  const embed = new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle("🛠️ Painel Administrativo")
    .setDescription("**Gerencie estoque, keys e usuários de forma rápida e prática.**")
    .addFields(
      {
        name: "📦 Adicionar Estoque",
        value: "Clique nos botões **＋** para adicionar contas aos produtos.",
        inline: false
      },
      {
        name: "🎁 Resgatar Produtos",
        value: "Resgata múltiplas contas de qualquer produto para uso externo (enviado no privado).",
        inline: false
      },
      {
        name: "🔑 Gerenciar Keys",
        value: "• **Gerar Key**: Cria uma key individual\n• **Keys em Lote**: Cria várias keys de uma vez\n• **Key Free**: Key gratuita (acesso limitado)\n• **Resetar Key**: Torna uma key usada disponível novamente",
        inline: false
      },
      {
        name: "👥 Gerenciar Usuários",
        value: "• **Remover Acesso**: Revoga acesso de um usuário\n• **Ver Planos**: Lista todos os usuários e seus planos\n• **Pausar Free**: Desativa resgate de keys gratuitas",
        inline: false
      },
      {
        name: "⛔ Blacklist",
        value: "Adicione ou remova usuários da lista de bloqueio.",
        inline: false
      },
    )
    .setFooter({ text: "🔐 Acesso restrito a administradores" })
    .setTimestamp();

  return { embeds: [embed], components: [rowStock, rowRedeemKeys, rowManagement, rowBlacklist] };
}

// ---------------------------------------------------------------------------
// Plano do usuário
// ---------------------------------------------------------------------------

function createPlanView(userId, plan) {
  const now = Date.now();
  const active = plan && (plan.expiresAt === null || plan.expiresAt > now);
  let description = "Você não possui um plano ativo. Resgate uma key para ativar seu acesso.";

  if (active && plan.expiresAt === null) {
    description = "Seu plano está **vitalício**.";
  } else if (active) {
    const timestamp = Math.floor(plan.expiresAt / 1000);
    description = `Seu plano vence <t:${timestamp}:R>.\nVencimento: <t:${timestamp}:F>`;
  }

  const embed = new EmbedBuilder()
    .setColor(active ? 0x57f287 : 0xed4245)
    .setTitle(`Meu plano — <@${userId}>`)
    .setDescription(description);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("plan:redeem")
      .setLabel("Resgatar key")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("plan:history")
      .setLabel("Ver histórico")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setLabel("🛒 Comprar plano")
      .setStyle(ButtonStyle.Link)
      .setURL(BUY_CHANNEL_URL),
  );

  return { embeds: [embed], components: [row] };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeModal(customId, title, fieldId, label, placeholder, style = TextInputStyle.Short) {
  const input = new TextInputBuilder()
    .setCustomId(fieldId)
    .setLabel(label)
    .setPlaceholder(placeholder)
    .setStyle(style)
    .setRequired(true);

  if (fieldId === "license-key") {
    input.setMaxLength(110);
  } else if (style === TextInputStyle.Paragraph) {
    input.setMaxLength(4_000);
  } else {
    input.setMaxLength(100);
  }

  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(new ActionRowBuilder().addComponents(input));
}

function generateKey(durationObj) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const id = Array.from({ length: 12 }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
  const groups = id.match(/.{4}/g);
  return `${durationObj.keyCode}-${groups.join("-")}`;
}

function isFormattedKey(key) {
  return /^(?:\d+[smhdwy]|\d+mo|life|free)-[A-Za-z0-9]{4}(?:-[A-Za-z0-9]{4}){2}$/.test(key);
}

function signIssuedKey(key) {
  return crypto.createHmac("sha256", licenseSecret).update(`ISSUED:${key}`).digest("hex");
}

function matchesIssuedKeySignature(key, signature) {
  if (typeof signature !== "string" || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expected = Buffer.from(signIssuedKey(key), "hex");
  const supplied = Buffer.from(signature, "hex");
  return crypto.timingSafeEqual(expected, supplied);
}

function isKeyAuthentic(key) {
  if (isFormattedKey(key)) return true;
  if (/^NOVO-[A-F0-9]{32}$/.test(key)) return true;
  const match = /^NOVO-([A-F0-9]{32})-([A-F0-9]{64})$/.exec(key);
  if (!match) return false;
  const expected = crypto.createHmac("sha256", licenseSecret).update(`NOVO:${match[1]}`).digest();
  const supplied = Buffer.from(match[2], "hex");
  return crypto.timingSafeEqual(expected, supplied);
}

function getActivePlan(state, userId, now) {
  const plan = state.plans[userId];
  if (!plan || (plan.expiresAt !== null && plan.expiresAt <= now)) return null;
  return plan;
}

// Produtos livres para key free (Rockstar 50% e Steam)
const freeAllowedProducts = new Set(["rockstar_50", "steam"]);

// Cooldown padrão para key free (8 horas) — pode ser configurado ao gerar
const defaultFreeCooldownMs = 8 * 60 * 60 * 1_000;

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleProduct(interaction, productId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  
  // VERIFICAR ÚLTIMO RESGATE NO LOG (antes de tudo)
  const now = Date.now();
  const lastRedeemTime = await getLastRedeem(interaction.user.id, productId);
  
  // Aplicar cooldown de 4h para o usuário problemático
  if (interaction.user.id === "1500803024166195373" && lastRedeemTime) {
    const timeSinceLastRedeem = now - lastRedeemTime;
    const fourHours = 4 * 60 * 60 * 1000;
    if (timeSinceLastRedeem < fourHours) {
      const nextAvailable = Math.floor((lastRedeemTime + fourHours) / 1000);
      await interaction.editReply(
        `🚫 **COOLDOWN DE 4 HORAS ATIVO**\n\n` +
        `Você poderá resgatar **${products[productId]}** novamente <t:${nextAvailable}:R> (<t:${nextAvailable}:F>).\n\n` +
        `> ⚠️ Cooldown especial aplicado devido a resgates excessivos.`
      );
      return;
    }
  }
  
  const result = await storage.transact((state) => {
    // Registrar painel do servidor atual se ainda não estiver registrado
    if (interaction.message && interaction.guildId) {
      if (!state.panels) state.panels = {};
      if (!state.panels[interaction.guildId]) {
        state.panels[interaction.guildId] = { channelId: interaction.channelId, messageId: interaction.message.id };
      }
    }
    // Blacklist — bloqueia antes de qualquer outra verificação
    if (state.blacklist && state.blacklist[interaction.user.id]) {
      return { status: "blacklisted", reason: state.blacklist[interaction.user.id].reason };
    }
    
    const plan = getActivePlan(state, interaction.user.id, now);
    if (!plan) return { status: "no-plan" };

    // Verificar se usuário está tentando usar painel de servidor diferente
    if (plan.guildId && interaction.guildId && plan.guildId !== interaction.guildId) {
      const guildName = plan.guildName || `ID: ${plan.guildId}`;
      return { status: "wrong-server", correctGuildName: guildName };
    }

    // Keys free pausadas — bloqueia uso
    if (plan.type === "free" && state.freeKeysPaused) {
      return { status: "free-paused" };
    }

    if (state.stock[productId].length === 0) return { status: "empty" };

    const planStartedAt = plan.startedAt ?? 0;
    const isFreePlan = plan.type === "free";

    // Key free só libera Rockstar 50% e Steam
    if (isFreePlan && !freeAllowedProducts.has(productId)) {
      return { status: "free-restricted" };
    }

    const isShortPlan = !isFreePlan && plan.expiresAt !== null &&
      (plan.expiresAt - planStartedAt) <= shortPlanThresholdMs;

    const userCooldowns = state.cooldowns[interaction.user.id] || {};
    const cooldownEntry = userCooldowns[productId];

    if (cooldownEntry !== undefined && cooldownEntry !== null) {
      const lastRedeemedAt = typeof cooldownEntry === "object"
        ? cooldownEntry.redeemedAt
        : cooldownEntry;

      const entryCooldownPlanStartedAt = typeof cooldownEntry === "object"
        ? cooldownEntry.planStartedAt
        : 0;

      // Migração: garantir estrutura completa
      const penalty = typeof cooldownEntry === "object" && cooldownEntry.penalty
        ? cooldownEntry.penalty
        : { active: false, until: 0 };

      const redeemHistory = typeof cooldownEntry === "object" && cooldownEntry.redeemHistory
        ? cooldownEntry.redeemHistory
        : [];

      // Verificar se está sob penalidade
      if (penalty.active && penalty.until > now) {
        return { status: "penalty", nextAvailableAt: penalty.until, penaltyCount: penalty.count || 3 };
      }

      if (isFreePlan) {
        // Key free: cooldown fixo configurável (padrão 8h)
        const freeCd = plan.freeCooldownMs ?? defaultFreeCooldownMs;
        const nextAvailableAt = lastRedeemedAt + freeCd;
        if (nextAvailableAt > now) return { status: "cooldown", nextAvailableAt, isFreePlan: true };
      } else if (isShortPlan) {
        if (entryCooldownPlanStartedAt >= planStartedAt) {
          return { status: "cooldown", nextAvailableAt: plan.expiresAt };
        }
      } else {
        // Calcular cooldown baseado na duração do plano
        const isLifetime = plan.expiresAt === null;
        
        let cooldownTime;
        if (isLifetime) {
          // Lifetime: 45 minutos
          cooldownTime = lifetimeCooldownMs;
        } else {
          // Calcular duração do plano
          const planDuration = plan.expiresAt - planStartedAt;
          const fifteenDaysMs = 15 * 24 * 60 * 60 * 1000;
          
          if (planDuration <= fifteenDaysMs) {
            // Planos de 5min a 15 dias: 3 horas
            cooldownTime = shortPlanCooldownMs;
          } else {
            // Planos de 16+ dias: 2 horas
            cooldownTime = productCooldownMs;
          }
        }
        
        const nextAvailableAt = lastRedeemedAt + cooldownTime;
        if (nextAvailableAt > now) {
          return { 
            status: "cooldown", 
            nextAvailableAt, 
            isLifetime,
            cooldownHours: cooldownTime / (60 * 60 * 1000)
          };
        }
      }
    }

    const account = state.stock[productId].shift();
    const history = state.history[interaction.user.id] || [];
    history.push({ productId, account, redeemedAt: now });
    state.history[interaction.user.id] = history;

    // Sistema de penalidade: rastrear resgates nas últimas horas
    const lastCooldown = userCooldowns[productId];
    const lastRedeemedAt = typeof lastCooldown === "object" ? lastCooldown.redeemedAt : (lastCooldown || 0);
    
    let redeemHistory = typeof lastCooldown === "object" && lastCooldown.redeemHistory
      ? [...lastCooldown.redeemHistory]
      : [];

    let penalty = typeof lastCooldown === "object" && lastCooldown.penalty
      ? { ...lastCooldown.penalty }
      : { active: false, until: 0 };

    // Adicionar resgate atual ao histórico
    redeemHistory.push(now);

    // Limpar resgates antigos (fora da janela de 5 horas)
    redeemHistory = redeemHistory.filter(time => (now - time) <= redeemTrackingWindow);

    // Se resgatou 3 ou mais vezes nas últimas 5 horas, aplicar penalidade de 3h AGORA
    let willApplyPenalty = false;
    if (!isFreePlan && !isShortPlan && redeemHistory.length >= maxRedeemsBeforePenalty) {
      penalty.active = true;
      penalty.until = now + penaltyCooldownMs; // Cooldown de 3h começa AGORA
      penalty.triggeredAt = now;
      penalty.count = redeemHistory.length;
      willApplyPenalty = true;
      
      // Resetar histórico após aplicar penalidade
      redeemHistory = [];
    }

    state.cooldowns[interaction.user.id] = {
      ...userCooldowns,
      [productId]: { 
        redeemedAt: now, 
        planStartedAt, 
        penalty,
        redeemHistory 
      },
    };
    return { 
      status: "delivered", 
      account, 
      isShortPlan, 
      planExpiresAt: plan.expiresAt, 
      penaltyApplied: willApplyPenalty,
      redeemCount: redeemHistory.length 
    };
  });

  try {
    await interaction.message.edit(await productPanel());
  } catch (error) {
    console.error("Não foi possível atualizar o painel:", error);
  }

  if (result.status === "no-plan") {
    await interaction.editReply("Você precisa de um plano ativo para resgatar contas. Abra **Meu plano** e resgate uma key.");

    // Log de tentativa com licença expirada/ausente
    if (productLogChannelId) {
      try {
        const ch = await client.channels.fetch(productLogChannelId);
        if (ch && ch.isTextBased()) {
          const guildName = interaction.guildId ? (client.guilds.cache.get(interaction.guildId)?.name || `ID: ${interaction.guildId}`) : "Desconhecido";
          const embed = new EmbedBuilder()
            .setColor(0xed4245)
            .setTitle("❌ Tentativa sem licença ativa")
            .setThumbnail(interaction.user.displayAvatarURL({ size: 64 }))
            .addFields(
              { name: "Usuário",       value: `<@${interaction.user.id}>`,     inline: true },
              { name: "ID do usuário", value: `\`${interaction.user.id}\``,    inline: true },
              { name: "Servidor",      value: guildName,                       inline: true },
              { name: "Botão",         value: `\`${products[productId]}\``,    inline: true },
              { name: "Motivo",        value: "Licença expirada ou inexistente", inline: true },
            )
            .setTimestamp()
            .setFooter({ text: "Gerador de Licenças • Log de acessos negados" });
          await ch.send({ embeds: [embed] });
        }
      } catch (logErr) {
        console.error("Não foi possível enviar log de acesso negado:", logErr);
      }
    }
    return;
  }
  if (result.status === "wrong-server") {
    await interaction.editReply(
      `🚫 **Servidor incorreto.**\n\nVocê resgatou sua key no servidor **${result.correctGuildName}** e só pode usar o painel lá.\n\nSe quiser usar em outro servidor, sua key precisa expirar primeiro e você deverá resgatar uma nova key no servidor desejado.`
    );
    await sendLog("warn", "Tentativa de uso em servidor errado", [
      { label: "Produto tentado", value: products[productId] },
      { label: "Servidor correto", value: result.correctGuildName },
    ], interaction.user, interaction.guildId);
    return;
  }
  if (result.status === "blacklisted") {
    await interaction.editReply(
      `⛔ Você está na **blacklist** e não pode usar o gerador.\n> **Motivo:** ${result.reason}\n\nPara ser removido, pague a taxa de **R$ 5,00** e entre em contato com um administrador.`,
    );
    return;
  }
  if (result.status === "free-paused") {
    await interaction.editReply(
      `⏸️ **Keys free temporariamente pausadas.** O uso de contas com plano free está suspenso no momento. Aguarde ou adquira um plano pago.`,
    );
    await sendLog("warn", "Tentativa de resgate — keys free pausadas", [
      { label: "Produto", value: products[productId] },
    ], interaction.user, interaction.guildId);
    return;
  }
  if (result.status === "free-restricted") {
    await interaction.editReply(
      `Seu plano **free** só permite resgatar **Rockstar 50%** e **Steam**. Para acessar Rockstar e Discord, adquira um plano pago.`,
    );
    await sendLog("warn", "Tentativa de resgate — key free tentou produto premium", [
      { label: "Produto bloqueado", value: products[productId] },
    ], interaction.user, interaction.guildId);
    return;
  }
  if (result.status === "empty") {
    await interaction.editReply(`O estoque de **${products[productId]}** está vazio no momento.`);
    return;
  }
  if (result.status === "cooldown") {
    const availableAt = Math.floor(result.nextAvailableAt / 1000);
    let msg;
    
    if (result.isShortPlan) {
      msg = `Você já resgatou **${products[productId]}** neste plano. Quando seu plano expirar e você resgatar uma nova key, poderá resgatar novamente.`;
    } else if (result.isLifetime) {
      msg = `⏰ **Cooldown vitalício (45min)**\n\nVocê poderá resgatar **${products[productId]}** novamente <t:${availableAt}:R> (<t:${availableAt}:F>).\n\n> 💎 Usuários vitalícios têm cooldown reduzido!`;
    } else {
      // Mostrar o tempo de cooldown correto
      const cooldownHours = result.cooldownHours || 2;
      const cooldownText = cooldownHours === 3 ? "3 horas" : "2 horas";
      msg = `⏰ **Cooldown de ${cooldownText}**\n\nVocê poderá resgatar **${products[productId]}** novamente <t:${availableAt}:R> (<t:${availableAt}:F>).\n\nOs cooldowns de cada produto são independentes.`;
    }
    
    await interaction.editReply(msg);
    return;
  }

  if (result.status === "penalty") {
    const availableAt = Math.floor(result.nextAvailableAt / 1000);
    await interaction.editReply(
      `🚫 **PENALIDADE ATIVA — COOLDOWN DE 4 HORAS**\n\n` +
      `Você resgatou **${products[productId]}** ${result.penaltyCount} vezes seguidas nas últimas horas.\n\n` +
      `⏰ Próximo resgate disponível: <t:${availableAt}:R> (<t:${availableAt}:F>)\n\n` +
      `> ⚠️ **Para evitar penalidades futuras, não resgate o mesmo produto várias vezes seguidas.**`
    );
    
    await sendLog("warn", "⏱️ Penalidade aplicada (3 resgates seguidos)", [
      { label: "Produto", value: products[productId] },
      { label: "Resgates nas últimas horas", value: `${result.penaltyCount}x` },
      { label: "Cooldown até", value: `<t:${availableAt}:F>` },
    ], interaction.user, interaction.guildId);
    return;
  }

  // Enviar conta no privado (DM)
  try {
    let message = `✅ Sua conta **${products[productId]}** foi resgatada com sucesso!\n\n\`\`\`\n${result.account}\n\`\`\``;
    
    // Aviso de penalidade aplicada
    if (result.penaltyApplied) {
      const penaltyUntil = Math.floor((Date.now() + penaltyCooldownMs) / 1000);
      message += `\n\n⚠️ **ATENÇÃO: PENALIDADE APLICADA**\n` +
        `Você resgatou **${products[productId]}** 3 vezes nas últimas horas.\n` +
        `Seu próximo cooldown será de **4 horas** (até <t:${penaltyUntil}:t>).`;
    }
    
    await interaction.user.send({ content: message });
    
    // SALVAR RESGATE NO LOG
    await logRedeem(interaction.user.id, productId, Date.now());
    
    // Confirmar no canal
    let confirmMsg = `✅ Sua conta **${products[productId]}** foi enviada no seu privado! Verifique suas mensagens diretas.`;
    
    if (result.penaltyApplied) {
      confirmMsg += `\n\n⚠️ **Penalidade aplicada:** Você resgatou 3x. Próximo cooldown: **4 horas**.`;
    }
    
    await interaction.editReply({ content: confirmMsg });
  } catch (dmError) {
    // Se não conseguir enviar DM (privado fechado), avisar no canal
    console.error("Não foi possível enviar DM:", dmError);
    await interaction.editReply({
      content: `❌ Não consegui enviar a conta no seu privado.\n\n**Abra suas mensagens diretas** (Configurações do servidor → Privacidade → "Permitir mensagens diretas de membros do servidor") e tente novamente.\n\n*A conta não foi consumida do estoque.*`
    });
    
    // Devolver conta ao estoque
    await storage.transact((state) => {
      state.stock[productId].unshift(result.account);
      // Remover do histórico
      const history = state.history[interaction.user.id] || [];
      const lastIndex = history.length - 1;
      if (lastIndex >= 0 && history[lastIndex].account === result.account) {
        history.pop();
      }
    });
    
    return;
  }

  // Log de produto entregue
  const plan = await storage.read((state) => state.plans[interaction.user.id] || null);
  await sendProductLog({
    user: interaction.user,
    plan,
    productId,
    account: result.account,
    redeemedAt: Date.now(),
    guildId: interaction.guildId,
  });
}

async function handlePlan(interaction) {
  const plan = await storage.read((state) => state.plans[interaction.user.id] || null);
  await interaction.reply({ ...createPlanView(interaction.user.id, plan), flags: MessageFlags.Ephemeral });
}

async function handleHistory(interaction) {
  const entries = await storage.read((state) => state.history[interaction.user.id] || []);
  const content = entries.length === 0
    ? "Nenhuma conta resgatada até o momento."
    : entries.map((entry, index) => {
      const date = new Date(entry.redeemedAt).toISOString();
      const label = products[entry.productId] || entry.productId;
      return `${index + 1}. ${label} — ${date}\n${entry.account}`;
    }).join("\n\n");
  const attachment = new AttachmentBuilder(Buffer.from(content, "utf8"), { name: "historico-contas.txt" });
  await interaction.reply({
    content: "Seu histórico completo de contas resgatadas:",
    files: [attachment],
    flags: MessageFlags.Ephemeral,
  });
}

async function issueKeys(interaction, durationObj, quantity) {
  const issued = await storage.transact((state) => {
    const keys = [];
    for (let index = 0; index < quantity; index += 1) {
      let key;
      do {
        key = generateKey(durationObj);
      } while (Object.prototype.hasOwnProperty.call(state.keys, key));

      const signature = signIssuedKey(key);
      state.keys[key] = {
        duration: durationObj.keyCode,
        createdAt: Date.now(),
        redeemedAt: null,
        redeemedBy: null,
        signature,
        signatureVersion: 2,
      };
      keys.push(key);
    }
    return keys;
  });

  const attachment = new AttachmentBuilder(Buffer.from(issued.join("\n"), "utf8"), {
    name: `keys-${durationObj.keyCode}-x${quantity}.txt`,
  });
  await interaction.reply({
    content: `${quantity === 1 ? "Key gerada" : `${quantity} keys geradas`} com duração **${durationObj.label}**. Guarde o arquivo: ele não será exibido novamente.`,
    files: [attachment],
    flags: MessageFlags.Ephemeral,
  });
}

async function issueFreeKeys(interaction, durationObj, freeCooldownMs, quantity) {
  const freeDurationObj = { ...durationObj, keyCode: "free" };

  const issued = await storage.transact((state) => {
    const keys = [];
    for (let index = 0; index < quantity; index += 1) {
      let key;
      do {
        key = generateKey(freeDurationObj);
      } while (Object.prototype.hasOwnProperty.call(state.keys, key));

      const signature = signIssuedKey(key);
      state.keys[key] = {
        duration: durationObj.keyCode,   // duração real (ex: "1d", "8h")
        createdAt: Date.now(),
        redeemedAt: null,
        redeemedBy: null,
        signature,
        signatureVersion: 2,
        type: "free",
        freeCooldownMs,
      };
      keys.push(key);
    }
    return keys;
  });

  const cdHoras = Math.round(freeCooldownMs / 3_600_000);
  const attachment = new AttachmentBuilder(Buffer.from(issued.join("\n"), "utf8"), {
    name: `keys-free-${durationObj.keyCode}-x${quantity}.txt`,
  });
  await interaction.reply({
    content: [
      `${quantity === 1 ? "Key free gerada" : `${quantity} keys free geradas`} com duração **${durationObj.label}** e cooldown de **${cdHoras}h**.`,
      `> 🆓 Produtos liberados: **Rockstar 50%** e **Steam** apenas.`,
      `Guarde o arquivo: ele não será exibido novamente.`,
    ].join("\n"),
    files: [attachment],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleRedeemKey(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const submittedKey = interaction.fields.getTextInputValue("license-key").trim();
  const isNewFormat = isFormattedKey(submittedKey);
  const suppliedKey = isNewFormat ? submittedKey : submittedKey.toUpperCase();
  if (!isKeyAuthentic(suppliedKey)) {
    await interaction.editReply("Essa key não foi gerada por este bot ou é inválida.");
    await sendLog("fail", "Tentativa de resgate — key não reconhecida", [
      { label: "Key fornecida", value: `\`${submittedKey.slice(0, 80)}\`` },
      { label: "Resultado", value: "Formato inválido ou não gerada por este bot." },
    ], interaction.user, interaction.guildId);
    return;
  }

  const result = await storage.transact((state) => {
    const key = Object.prototype.hasOwnProperty.call(state.keys, suppliedKey)
      ? state.keys[suppliedKey] : null;
    if (!key) return { status: "invalid" };

    // Blacklist — impede resgate de key
    if (state.blacklist && state.blacklist[interaction.user.id]) {
      return { status: "blacklisted", reason: state.blacklist[interaction.user.id].reason };
    }

    const isLegacyKey = /^NOVO-[A-F0-9]{32}$/.test(suppliedKey);
    const isSignedLegacyKey = /^NOVO-[A-F0-9]{32}-[A-F0-9]{64}$/.test(suppliedKey);
    const isFreeKey = key.type === "free";

    const durationObj = Object.prototype.hasOwnProperty.call(legacyDurations, key.duration)
      ? legacyDurations[key.duration]
      : parseDuration(key.duration);

    // Para keys free o prefixo é sempre "free" — não compara com durationObj.keyCode
    const keyPrefix = suppliedKey.split("-")[0];
    const prefixValid = isFreeKey
      ? keyPrefix === "free"
      : durationObj !== null && durationObj.keyCode === keyPrefix;

    if (
      !durationObj ||
      !Number.isFinite(key.createdAt) ||
      key.createdAt > Date.now() ||
      (isNewFormat && (
        key.signatureVersion !== 2 ||
        !prefixValid ||
        !matchesIssuedKeySignature(suppliedKey, key.signature)
      )) ||
      (!isNewFormat && !isLegacyKey && (!isSignedLegacyKey || key.signatureVersion !== 1)) ||
      (key.redeemedAt !== null && !Number.isFinite(key.redeemedAt))
    ) {
      return { status: "invalid" };
    }
    if (key.redeemedAt !== null) return { status: "used" };

    const now = Date.now();
    const currentPlan = getActivePlan(state, interaction.user.id, now);

    // Impede resgatar uma segunda key free enquanto a primeira ainda está ativa
    if (key.type === "free" && currentPlan && currentPlan.type === "free") {
      return { status: "free-already-active" };
    }
    if (currentPlan && currentPlan.expiresAt === null) {
      key.redeemedAt = now;
      key.redeemedBy = interaction.user.id;
      return { status: "lifetime" };
    }
    const baseTime = currentPlan ? currentPlan.expiresAt : now;
    const expiresAt = durationObj.milliseconds === null ? null : baseTime + durationObj.milliseconds;
    
    // Salvar servidor onde a key foi resgatada
    const guildId = interaction.guildId || null;
    const guildName = guildId ? (interaction.guild?.name || `ID: ${guildId}`) : null;
    
    state.plans[interaction.user.id] = {
      expiresAt,
      startedAt: now,
      type: key.type ?? "paid",
      freeCooldownMs: key.freeCooldownMs ?? undefined,
      guildId,
      guildName,
    };
    key.redeemedAt = now;
    key.redeemedBy = interaction.user.id;

    // Rastrear estatísticas por servidor
    if (!state.guildStats) state.guildStats = {};
    const gId = interaction.guildId || "unknown";
    if (!state.guildStats[gId]) state.guildStats[gId] = { keysRedeemed: 0, lastUpdate: now };
    state.guildStats[gId].keysRedeemed += 1;
    state.guildStats[gId].lastUpdate = now;

    return { status: "redeemed", expiresAt, isFree: key.type === "free" };
  });

  const messages = {
    invalid: "Essa key não existe. Confira o código e tente novamente.",
    used: "Essa key já foi resgatada e não pode ser reutilizada.",
    lifetime: "Seu plano já é vitalício. A key foi marcada como resgatada.",
    "free-already-active": "Você já possui uma **key free ativa**. Aguarde ela expirar antes de resgatar outra.",
  };

  if (result.status === "blacklisted") {
    const msg = `⛔ Você está na **blacklist** e não pode resgatar keys.\n> **Motivo:** ${result.reason}\n\nPara ser removido, pague a taxa de **R$ 5,00** e entre em contato com um administrador.`;
    await interaction.editReply(msg);
    await sendLog("fail", "Tentativa de resgate — usuário na blacklist", [
      { label: "Key fornecida", value: `\`${suppliedKey}\`` },
      { label: "Motivo da blacklist", value: result.reason },
    ], interaction.user, interaction.guildId);
    return;
  }

  if (result.status !== "redeemed") {
    await interaction.editReply(messages[result.status]);

    // Log de tentativa falha
    const logTitles = {
      invalid: "Tentativa de resgate — key inválida",
      used:    "Tentativa de resgate — key já usada",
      lifetime: "Resgate — plano já vitalício",
      "free-already-active": "Tentativa de resgate — key free já ativa",
      blacklisted: "Tentativa de resgate — usuário na blacklist",
    };
    const logTypes = { invalid: "fail", used: "warn", lifetime: "warn", "free-already-active": "warn", blacklisted: "fail" };
    await sendLog(logTypes[result.status], logTitles[result.status], [
      { label: "Key fornecida", value: `\`${suppliedKey}\`` },
      { label: "Resultado", value: messages[result.status] },
    ], interaction.user, interaction.guildId);
    return;
  }

  const expiryText = result.expiresAt === null
    ? "Seu plano agora é **vitalício**."
    : `Seu plano vence <t:${Math.floor(result.expiresAt / 1000)}:F> (<t:${Math.floor(result.expiresAt / 1000)}:R>).`;
  const freeNote = result.isFree
    ? "\n> 🆓 **Plano free** — disponível apenas Rockstar 50% e Steam, cooldown de 8h por produto."
    : "";
  await interaction.editReply(`Key resgatada com sucesso! ${expiryText}${freeNote}`);

  // Log de resgate bem-sucedido
  const expiryLog = result.expiresAt === null
    ? "Vitalício"
    : `<t:${Math.floor(result.expiresAt / 1000)}:F>`;
  await sendLog("success", "Key resgatada com sucesso", [
    { label: "Key", value: `\`${suppliedKey}\`` },
    { label: "Vencimento do plano", value: expiryLog },
  ], interaction.user, interaction.guildId);
}

async function handleRevokeAccess(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const rawId = interaction.fields.getTextInputValue("user-id").trim();

  if (!/^\d{17,20}$/.test(rawId)) {
    await interaction.editReply("ID inválido. Cole o ID numérico do usuário (17–20 dígitos).");
    return;
  }

  const result = await storage.transact((state) => {
    const hadPlan = Object.prototype.hasOwnProperty.call(state.plans, rawId);
    if (!hadPlan) return { status: "not-found" };
    delete state.plans[rawId];
    return { status: "revoked" };
  });

  if (result.status === "not-found") {
    await interaction.editReply(`Usuário <@${rawId}> não possui nenhum plano registrado.`);
    return;
  }

  await interaction.editReply(
    `✅ Acesso de <@${rawId}> removido com sucesso.\nEle poderá resgatar uma nova key para voltar a ter acesso.`,
  );
}

async function handleResetKey(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const rawKey = interaction.fields.getTextInputValue("reset-key").trim();
  const isNewFormat = isFormattedKey(rawKey);
  const keyToReset = isNewFormat ? rawKey : rawKey.toUpperCase();

  const result = await storage.transact((state) => {
    if (!Object.prototype.hasOwnProperty.call(state.keys, keyToReset)) {
      return { status: "not-found" };
    }
    const key = state.keys[keyToReset];
    if (key.redeemedAt === null) {
      return { status: "already-unused" };
    }
    key.redeemedAt = null;
    key.redeemedBy = null;
    return { status: "reset", duration: key.duration };
  });

  if (result.status === "not-found") {
    await interaction.editReply("Key não encontrada. Verifique o código e tente novamente.");
    return;
  }
  if (result.status === "already-unused") {
    await interaction.editReply("Essa key já está disponível (nunca foi resgatada ou já foi resetada).");
    return;
  }

  await interaction.editReply(
    `✅ Key \`${keyToReset}\` resetada com sucesso.\nEla pode ser usada novamente em qualquer Discord.`,
  );
}

async function handleViewPlans(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const now = Date.now();

  const plansData = await storage.read((state) => state.plans);
  const entries = Object.entries(plansData);

  if (entries.length === 0) {
    await interaction.editReply("Nenhum plano registrado ainda.");
    return;
  }

  // Separar ativos e expirados
  const active = [];
  const expired = [];

  for (const [userId, plan] of entries) {
    const isActive = plan.expiresAt === null || plan.expiresAt > now;
    const expiry = plan.expiresAt === null
      ? "Vitalício"
      : new Date(plan.expiresAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const started = plan.startedAt
      ? new Date(plan.startedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
      : "Desconhecido";
    const line = `ID: ${userId} | Início: ${started} | Vencimento: ${expiry}`;
    if (isActive) active.push(line); else expired.push(line);
  }

  const lines = [
    `=== PLANOS ATIVOS (${active.length}) ===`,
    ...active,
    "",
    `=== PLANOS EXPIRADOS (${expired.length}) ===`,
    ...expired,
    "",
    `Total: ${entries.length} usuário(s) | Gerado em: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
  ];

  const attachment = new AttachmentBuilder(
    Buffer.from(lines.join("\n"), "utf8"),
    { name: `planos-${Date.now()}.txt` },
  );

  await interaction.editReply({
    content: `📋 **${active.length}** plano(s) ativo(s) · **${expired.length}** expirado(s) · **${entries.length}** total`,
    files: [attachment],
  });
}

async function handleBlacklistAdd(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const rawId = interaction.fields.getTextInputValue("user-id").trim();

  if (!/^\d{17,20}$/.test(rawId)) {
    await interaction.editReply("ID inválido. Cole o ID numérico do usuário (17–20 dígitos).");
    return;
  }

  const reason = interaction.fields.getTextInputValue("reason").trim();

  const result = await storage.transact((state) => {
    if (!state.blacklist) state.blacklist = {};
    if (state.blacklist[rawId]) return { status: "already" };
    state.blacklist[rawId] = { reason, addedAt: Date.now() };
    // Revogar plano ativo automaticamente
    if (state.plans[rawId]) delete state.plans[rawId];
    return { status: "added" };
  });

  if (result.status === "already") {
    await interaction.editReply(`Usuário <@${rawId}> já está na blacklist.`);
    return;
  }

  await interaction.editReply(
    `⛔ <@${rawId}> adicionado à blacklist.\n> Motivo: ${reason}\nO acesso foi revogado. Para remoção deve pagar **R$ 5,00**.`,
  );
}

async function handleBlacklistRemove(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const rawId = interaction.fields.getTextInputValue("user-id").trim();

  if (!/^\d{17,20}$/.test(rawId)) {
    await interaction.editReply("ID inválido. Cole o ID numérico do usuário (17–20 dígitos).");
    return;
  }

  const result = await storage.transact((state) => {
    if (!state.blacklist || !state.blacklist[rawId]) return { status: "not-found" };
    delete state.blacklist[rawId];
    return { status: "removed" };
  });

  if (result.status === "not-found") {
    await interaction.editReply(`Usuário <@${rawId}> não está na blacklist.`);
    return;
  }

  await interaction.editReply(
    `✅ <@${rawId}> removido da blacklist com sucesso.\nEle pode usar o gerador normalmente após resgatar uma key.`,
  );
}

// ---------------------------------------------------------------------------
// Comandos de texto
// ---------------------------------------------------------------------------

client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot || !message.content.startsWith(prefix)) return;

    const [command] = message.content.slice(prefix.length).trim().split(/\s+/);

    if (command === "painel") {
      const sent = await message.channel.send(await productPanel());
      await storage.transact((state) => {
        if (!state.panels) state.panels = {};
        state.panels[message.guildId] = { channelId: sent.channelId, messageId: sent.id };
      });
      return;
    }

    if (command === "admin" || command === "estoque" || command === "key") {
      if (!isAdmin(message.author.id)) return;
      if (message.guildId !== mainGuildId) {
        await message.reply("⛔ Painel admin disponível apenas no servidor principal.");
        return;
      }
      await message.channel.send(adminPanel());
      return;
    }

    if (command === "cv") {
      // Verificar se o módulo de voz está instalado
      if (!voiceModule) {
        await message.reply("❌ Módulo de voz não instalado. Execute: `npm install @discordjs/voice`");
        return;
      }

      // Verificar se o usuário está em um canal de voz
      const voiceChannel = message.member?.voice?.channel;
      if (!voiceChannel) {
        await message.reply("❌ Você precisa estar em um canal de voz para usar este comando!");
        return;
      }

      try {
        const { joinVoiceChannel, VoiceConnectionStatus, entersState } = voiceModule;
        
        // Conectar ao canal de voz
        const connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: message.guildId,
          adapterCreator: message.guild.voiceAdapterCreator,
        });

        // Aguardar conexão
        await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
        
        await message.reply(`✅ Conectado ao canal de voz **${voiceChannel.name}**!\n\n> Use \`!dc\` para me desconectar.`);
      } catch (error) {
        console.error("Erro ao conectar ao canal de voz:", error);
        await message.reply("❌ Não foi possível conectar ao canal de voz.");
      }
      return;
    }

    if (command === "dc") {
      // Desconectar do canal de voz
      if (!voiceModule) {
        await message.reply("❌ Módulo de voz não instalado.");
        return;
      }

      try {
        const { getVoiceConnection } = voiceModule;
        const connection = getVoiceConnection(message.guildId);
        
        if (!connection) {
          await message.reply("❌ Não estou conectado a nenhum canal de voz!");
          return;
        }

        connection.destroy();
        await message.reply("✅ Desconectado do canal de voz!");
      } catch (error) {
        console.error("Erro ao desconectar:", error);
        await message.reply("❌ Erro ao desconectar.");
      }
      return;
    }

    if (command === "2fa") {
      // Criar painel do gerador 2FA
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("🔐 Gerador de Código 2FA")
        .setDescription([
          "Clique no botão abaixo, insira seu **Secret Key** e receba",
          "o código de **6 dígitos** instantaneamente.",
          "",
          "⚠️ O código é válido **apenas para você** e expira em até **30 segundos**.",
        ].join("\n"))
        .setFooter({ text: "MR Store • Autenticação 2FA • " + new Date().toLocaleString("pt-BR") })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("2fa:gerar")
          .setLabel("Gerar Código")
          .setEmoji("🔐")
          .setStyle(ButtonStyle.Primary)
      );

      await message.channel.send({ embeds: [embed], components: [row] });
      return;
    }
  } catch (error) {
    console.error("Erro ao processar comando:", error);
    try {
      await message.reply("Não foi possível concluir o comando. Verifique os logs do bot.");
    } catch (replyError) {
      console.error("Não foi possível informar o erro:", replyError);
    }
  }
});

// ---------------------------------------------------------------------------
// Interações
// ---------------------------------------------------------------------------

async function handleInteraction(interaction) {
  if (interaction.isButton()) {

    // Termos & Serviços
    if (interaction.customId === "status:termos") {
      const termos = new EmbedBuilder()
        .setColor(0xed1c24)
        .setTitle("🚨 Termos e Condições de Compra — Produtos Unlocked 🚨")
        .setDescription([
          "**1. Natureza do Produto Digital**",
          "+ Todos os produtos vendidos são exclusivamente digitais (softwares, chaves de acesso, licenças ou arquivos).",
          "+ Não realizamos envio de nenhum item físico.",
          "+ O acesso ao produto digital é liberado via download, e-mail ou painel do cliente após confirmação de pagamento.",
          "",
          "**2. Política de Não Devolução e Não Reembolso**",
          "+ Não aceitamos devoluções, trocas ou cancelamentos após o envio ou visualização do produto/chave de acesso.",
          "+ Uma vez entregue, a chave, software ou licença considera-se utilizada e consumida — processo irreversível.",
          "+ O direito de arrependimento (CDC) não se aplica a produtos digitais cujo acesso já foi fornecido e consumido integralmente.",
          "",
          "**3. Suporte e Assistência Técnica**",
          "+ Garantimos a entrega de licenças válidas e funcionais no momento da compra.",
          "+ Caso enfrente problemas técnicos, nossa equipe de suporte estará disponível dentro do período estipulado na compra.",
          "+ Não nos responsabilizamos por incompatibilidades com sistema operacional ou hardware fora dos requisitos mínimos.",
          "",
          "**4. Responsabilidade do Cliente**",
          "+ É de inteira responsabilidade do cliente verificar a compatibilidade do dispositivo antes de efetuar a compra.",
          "+ O cliente compromete-se a fornecer dados corretos no cadastro para recebimento do produto.",
          "",
          "─────────────────────────────",
          "*Ao clicar em **Aceito** ou efetuar o pagamento, você declara que leu, compreendeu e concorda com todos os termos.*",
        ].join("\n"))
        .setFooter({ text: "Termos de Serviço" })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("status:termos:aceito")
          .setLabel("✅ Aceito")
          .setStyle(ButtonStyle.Success),
      );

      await interaction.reply({ embeds: [termos], components: [row], flags: MessageFlags.Ephemeral });
      return;
    }

    if (interaction.customId === "status:termos:aceito") {
      await interaction.update({
        content: "✅ Você aceitou os Termos & Serviços.",
        embeds: [],
        components: [],
      });
      return;
    }

    // Gerador 2FA
    if (interaction.customId === "2fa:gerar") {
      const modal = new ModalBuilder()
        .setCustomId("2fa:submit")
        .setTitle("Gerar Código 2FA");

      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("secret")
          .setLabel("Secret Key (Base32)")
          .setPlaceholder("Ex.: JBSWY3DPEHPK3PXP")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
      ));

      await interaction.showModal(modal);
      return;
    }

    // Produtos públicos (normal e 50%)
    if (interaction.customId.startsWith("product:")) {
      const productId = interaction.customId.slice("product:".length);
      if (products[productId]) await handleProduct(interaction, productId);
      return;
    }

    // Plano do usuário
    if (interaction.customId === "plan:show") { await handlePlan(interaction); return; }
    if (interaction.customId === "plan:redeem") {
      await interaction.showModal(makeModal("plan:redeem:submit", "Resgatar key", "license-key", "Código da key", "NOVO-..."));
      return;
    }
    if (interaction.customId === "plan:history") { await handleHistory(interaction); return; }

    // Estoque — normal e 50% (mesmo handler, productId diferente)
    if (interaction.customId.startsWith("stock:add:")) {
      if (!isAdmin(interaction.user.id)) {
        await interaction.reply({ content: "Somente administradores podem alterar o estoque.", flags: MessageFlags.Ephemeral });
        return;
      }
      const productId = interaction.customId.slice("stock:add:".length);
      if (!products[productId]) return;
      await interaction.showModal(makeModal(
        `stock:submit:${productId}`,
        `Adicionar ${products[productId]}`,
        "accounts",
        "Uma conta por linha",
        "email:senha",
        TextInputStyle.Paragraph,
      ));
      return;
    }

    // Keys (admin)
    if (interaction.customId === "key:open:single" || interaction.customId === "key:open:batch") {
      if (!isAdmin(interaction.user.id)) {
        await interaction.reply({ content: "Somente administradores podem gerar keys.", flags: MessageFlags.Ephemeral });
        return;
      }
      const isBatch = interaction.customId === "key:open:batch";
      const modal = new ModalBuilder()
        .setCustomId(isBatch ? "key:modal:batch" : "key:modal:single")
        .setTitle(isBatch ? "Gerar keys em lote" : "Gerar key");

      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("duration")
          .setLabel("Duração")
          .setPlaceholder("Ex.: 1d  3d  1w  1mo  6mo  1ano  vitalicio")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(20),
      ));
      if (isBatch) {
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("quantity")
            .setLabel(`Quantidade (1 a ${maxKeysPerBatch})`)
            .setPlaceholder("Ex.: 10")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(3),
        ));
      }
      await interaction.showModal(modal);
      return;
    }

    // Keys free (admin)
    if (interaction.customId === "key:open:free" || interaction.customId === "key:open:free:batch") {
      if (!isAdmin(interaction.user.id)) {
        await interaction.reply({ content: "Somente administradores podem gerar keys.", flags: MessageFlags.Ephemeral });
        return;
      }
      const isBatch = interaction.customId === "key:open:free:batch";
      const modal = new ModalBuilder()
        .setCustomId(isBatch ? "key:modal:free:batch" : "key:modal:free:single")
        .setTitle(isBatch ? "Gerar keys free em lote" : "Gerar key free");

      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("duration")
          .setLabel("Duração da key")
          .setPlaceholder("Ex.: 1d  7d  1w  1mo")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(20),
      ));
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("cooldown")
          .setLabel("Cooldown entre resgates (padrão: 8h)")
          .setPlaceholder("Ex.: 8h  12h  1d")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(10),
      ));
      if (isBatch) {
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("quantity")
            .setLabel(`Quantidade (1 a ${maxKeysPerBatch})`)
            .setPlaceholder("Ex.: 10")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(3),
        ));
      }
      await interaction.showModal(modal);
      return;
    }

    // Remover acesso (admin)
    if (interaction.customId === "admin:revoke") {
      if (!isAdmin(interaction.user.id)) {
        await interaction.reply({ content: "Somente administradores podem remover acessos.", flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.showModal(makeModal(
        "admin:revoke:submit",
        "Remover acesso",
        "user-id",
        "ID do usuário",
        "Ex.: 123456789012345678",
      ));
      return;
    }

    // Resetar key (admin)
    if (interaction.customId === "admin:reset-key") {
      if (!isAdmin(interaction.user.id)) {
        await interaction.reply({ content: "Somente administradores podem resetar keys.", flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.showModal(makeModal(
        "admin:reset-key:submit",
        "Resetar key",
        "reset-key",
        "Código da key",
        "Ex.: 1d-XXXX-XXXX-XXXX",
      ));
      return;
    }

    // Ver planos (admin)
    if (interaction.customId === "admin:plans") {
      if (!isAdmin(interaction.user.id)) {
        await interaction.reply({ content: "Somente administradores podem ver os planos.", flags: MessageFlags.Ephemeral });
        return;
      }
      await handleViewPlans(interaction);
      return;
    }

    // Toggle keys free — pausar/despausar
    if (interaction.customId === "admin:toggle-free") {
      if (!isAdmin(interaction.user.id)) {
        await interaction.reply({ content: "Somente administradores.", flags: MessageFlags.Ephemeral });
        return;
      }

      const newState = await storage.transact((state) => {
        if (!state.freeKeysPaused) state.freeKeysPaused = false;
        state.freeKeysPaused = !state.freeKeysPaused;
        return state.freeKeysPaused;
      });

      await interaction.reply({
        content: newState
          ? "⏸️ **Keys free pausadas.** Usuários não poderão mais resgatar keys free até você despausar."
          : "▶️ **Keys free ativadas.** Usuários podem resgatar keys free normalmente.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Resgatar produtos em quantidade personalizada (admin)
    if (interaction.customId === "admin:bulk-redeem") {
      if (!isAdmin(interaction.user.id)) {
        await interaction.reply({ content: "Somente administradores podem usar esta função.", flags: MessageFlags.Ephemeral });
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId("admin:bulk-redeem:submit")
        .setTitle("Resgatar Produtos");

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("product")
            .setLabel("Produto")
            .setPlaceholder("rockstar, discord, steam ou rockstar_50")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(20)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("quantity")
            .setLabel("Quantidade")
            .setPlaceholder("Ex.: 10")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(4)
        )
      );

      await interaction.showModal(modal);
      return;
    }

    // Resgatar 10 unidades de um produto (admin only)
    if (interaction.customId.startsWith("admin:redeem10:")) {
      if (!isAdmin(interaction.user.id)) {
        await interaction.reply({ content: "Somente administradores podem usar esta função.", flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const productId = interaction.customId.split(":")[2];

      const result = await storage.transact((state) => {
        if (state.stock[productId].length < 10) {
          return { status: "insufficient", available: state.stock[productId].length };
        }

        const accounts = [];
        for (let i = 0; i < 10; i++) {
          accounts.push(state.stock[productId].shift());
        }

        return { status: "success", accounts };
      });

      if (result.status === "insufficient") {
        await interaction.editReply(`❌ Estoque insuficiente! Disponível: **${result.available}** contas de **${products[productId]}**.`);
        return;
      }

      // Enviar no privado do admin
      try {
        let message = `✅ **10x ${products[productId]}** resgatadas com sucesso!\n\n`;
        result.accounts.forEach((account, index) => {
          message += `**${index + 1}.** \`${account}\`\n`;
        });

        await interaction.user.send({ content: message });
        await interaction.editReply({
          content: `✅ **10x ${products[productId]}** enviadas no seu privado!\n\nEstoque restante: **${await storage.read(s => s.stock[productId].length)}** contas.`
        });

        // Log admin
        await sendLog("success", "🎁 Admin resgatou 10 unidades", [
          { label: "Admin", value: `<@${interaction.user.id}>` },
          { label: "Produto", value: products[productId] },
          { label: "Quantidade", value: "10 contas" },
        ], interaction.user);

      } catch (dmError) {
        console.error("Não foi possível enviar DM ao admin:", dmError);
        
        // Devolver contas ao estoque
        await storage.transact((state) => {
          result.accounts.reverse().forEach(account => {
            state.stock[productId].unshift(account);
          });
        });

        await interaction.editReply({
          content: `❌ Não consegui enviar no seu privado. **Abra suas mensagens diretas** e tente novamente.\n\n*As contas foram devolvidas ao estoque.*`
        });
      }

      // Atualizar painel de produtos
      try {
        await refreshPanel();
      } catch (error) {
        console.error("Não foi possível atualizar o painel:", error);
      }

      return;
    }

    // Blacklist — adicionar
    if (interaction.customId === "admin:blacklist:add") {
      if (!isAdmin(interaction.user.id)) {
        await interaction.reply({ content: "Somente administradores podem gerenciar a blacklist.", flags: MessageFlags.Ephemeral });
        return;
      }
      const modal = new ModalBuilder()
        .setCustomId("admin:blacklist:add:submit")
        .setTitle("Adicionar à blacklist");
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("user-id")
            .setLabel("ID do usuário")
            .setPlaceholder("Ex.: 123456789012345678")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(20),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("reason")
            .setLabel("Motivo")
            .setPlaceholder("Ex.: Chargeback, fraude, abuso...")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(100),
        ),
      );
      await interaction.showModal(modal);
      return;
    }

    // Blacklist — remover
    if (interaction.customId === "admin:blacklist:remove") {
      if (!isAdmin(interaction.user.id)) {
        await interaction.reply({ content: "Somente administradores podem gerenciar a blacklist.", flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.showModal(makeModal(
        "admin:blacklist:remove:submit",
        "Remover da blacklist",
        "user-id",
        "ID do usuário",
        "Ex.: 123456789012345678",
      ));
      return;
    }

    return;
  }

  if (!interaction.isModalSubmit()) return;

  // Adicionar estoque (normal e 50% — mesmo handler)
  if (interaction.customId.startsWith("stock:submit:")) {
    if (!isAdmin(interaction.user.id)) {
      await interaction.reply({ content: "Somente administradores podem alterar o estoque.", flags: MessageFlags.Ephemeral });
      return;
    }
    const productId = interaction.customId.slice("stock:submit:".length);
    if (!products[productId]) return;

    const accounts = interaction.fields.getTextInputValue("accounts")
      .split(/\r?\n/)
      .map((a) => a.trim())
      .filter(Boolean);

    if (accounts.length === 0) {
      await interaction.reply({ content: "Informe ao menos uma conta, cada uma em uma linha.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (accounts.length > 100) {
      await interaction.reply({ content: "Adicione no máximo 100 contas por envio.", flags: MessageFlags.Ephemeral });
      return;
    }

    await storage.transact((state) => { state.stock[productId].push(...accounts); });
    await interaction.reply({
      content: `${accounts.length} conta(s) adicionada(s) ao estoque de **${products[productId]}**.`,
      flags: MessageFlags.Ephemeral,
    });
    await refreshPanel();
    return;
  }

  // Resgatar key
  if (interaction.customId === "plan:redeem:submit") {
    await handleRedeemKey(interaction);
    return;
  }

  // Gerar código 2FA
  if (interaction.customId === "2fa:submit") {
    const secret = interaction.fields.getTextInputValue("secret").trim();
    
    if (!secret) {
      await interaction.reply({
        content: "❌ Você precisa fornecer um Secret Key!",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const code = generate2FA(secret);
    
    if (!code) {
      await interaction.reply({
        content: "❌ Secret Key inválido! Certifique-se de usar um secret Base32 válido.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle("🔐 Código 2FA Gerado com Sucesso")
      .setDescription(`**Código:** \`${code}\`\n\n⚠️ O código é válido **apenas para você** e expira em até **30 segundos**.`)
      .setFooter({ text: "MR Store • Autenticação 2FA • " + new Date().toLocaleString("pt-BR") })
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  // Resgatar produtos em massa (admin)
  if (interaction.customId === "admin:bulk-redeem:submit") {
    if (!isAdmin(interaction.user.id)) {
      await interaction.reply({ content: "Somente administradores podem usar esta função.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const productInput = interaction.fields.getTextInputValue("product").trim().toLowerCase();
    const quantityInput = interaction.fields.getTextInputValue("quantity").trim();

    // Validar produto
    const validProducts = {
      "rockstar": "rockstar",
      "discord": "discord",
      "steam": "steam",
      "rockstar_50": "rockstar_50",
      "rockstar50": "rockstar_50",
      "rockstar 50": "rockstar_50"
    };

    const productId = validProducts[productInput];

    if (!productId) {
      await interaction.editReply({
        content: `❌ Produto inválido! Use um desses:\n• \`rockstar\`\n• \`discord\`\n• \`steam\`\n• \`rockstar_50\``
      });
      return;
    }

    // Validar quantidade
    if (!/^\d+$/.test(quantityInput)) {
      await interaction.editReply({ content: "❌ Quantidade inválida! Use apenas números." });
      return;
    }

    const quantity = Number(quantityInput);

    if (quantity < 1 || quantity > 100) {
      await interaction.editReply({ content: "❌ A quantidade deve estar entre **1** e **100**." });
      return;
    }

    // Resgatar do estoque
    const result = await storage.transact((state) => {
      const available = state.stock[productId].length;

      if (available < quantity) {
        return { status: "insufficient", available };
      }

      const accounts = [];
      for (let i = 0; i < quantity; i++) {
        accounts.push(state.stock[productId].shift());
      }

      return { status: "success", accounts, remaining: state.stock[productId].length };
    });

    if (result.status === "insufficient") {
      await interaction.editReply({
        content: `❌ Estoque insuficiente!\n\n**Disponível:** ${result.available} contas de **${products[productId]}**\n**Solicitado:** ${quantity} contas`
      });
      return;
    }

    // Enviar no privado do admin
    try {
      // Dividir em mensagens de até 2000 caracteres
      let currentMessage = `✅ **${quantity}x ${products[productId]}** resgatadas com sucesso!\n\n`;
      const messages = [];

      result.accounts.forEach((account, index) => {
        const line = `**${index + 1}.** \`${account}\`\n`;
        
        if ((currentMessage + line).length > 1900) {
          messages.push(currentMessage);
          currentMessage = line;
        } else {
          currentMessage += line;
        }
      });

      if (currentMessage) messages.push(currentMessage);

      // Enviar todas as mensagens
      for (const msg of messages) {
        await interaction.user.send({ content: msg });
      }

      await interaction.editReply({
        content: `✅ **${quantity}x ${products[productId]}** enviadas no seu privado!\n\n📊 **Estoque restante:** ${result.remaining} contas`
      });

      // Log admin
      await sendLog("success", "🎁 Admin resgatou produtos em massa", [
        { label: "Admin", value: `<@${interaction.user.id}>` },
        { label: "Produto", value: products[productId] },
        { label: "Quantidade", value: `${quantity} contas` },
        { label: "Estoque restante", value: `${result.remaining} contas` },
      ], interaction.user);

    } catch (dmError) {
      console.error("Não foi possível enviar DM ao admin:", dmError);
      
      // Devolver contas ao estoque
      await storage.transact((state) => {
        result.accounts.reverse().forEach(account => {
          state.stock[productId].unshift(account);
        });
      });

      await interaction.editReply({
        content: `❌ Não consegui enviar no seu privado!\n\n**Abra suas mensagens diretas** e tente novamente.\n\n*As ${quantity} contas foram devolvidas ao estoque.*`
      });
    }

    return;
  }

  // Gerar key(s)
  if (interaction.customId === "key:modal:single" || interaction.customId === "key:modal:batch") {
    if (!isAdmin(interaction.user.id)) {
      await interaction.reply({ content: "Somente administradores podem gerar keys.", flags: MessageFlags.Ephemeral });
      return;
    }
    const durationText = interaction.fields.getTextInputValue("duration").trim();
    const durationObj = parseDuration(durationText);
    if (!durationObj) {
      await interaction.reply({
        content: `Duração **"${durationText}"** inválida. Use formatos como \`1h\`, \`3d\`, \`1w\`, \`2mo\`, \`1ano\` ou \`vitalicio\`.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let quantity = 1;
    if (interaction.customId === "key:modal:batch") {
      const quantityText = interaction.fields.getTextInputValue("quantity").trim();
      if (!/^\d+$/.test(quantityText)) {
        await interaction.reply({ content: "Informe uma quantidade numérica válida.", flags: MessageFlags.Ephemeral });
        return;
      }
      quantity = Number(quantityText);
      if (quantity < 1 || quantity > maxKeysPerBatch) {
        await interaction.reply({
          content: `A quantidade deve estar entre 1 e ${maxKeysPerBatch}.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    await issueKeys(interaction, durationObj, quantity);
    return;
  }

  // Gerar key free
  if (interaction.customId === "key:modal:free:single" || interaction.customId === "key:modal:free:batch") {
    if (!isAdmin(interaction.user.id)) {
      await interaction.reply({ content: "Somente administradores podem gerar keys.", flags: MessageFlags.Ephemeral });
      return;
    }

    const durationText = interaction.fields.getTextInputValue("duration").trim();
    const durationObj = parseDuration(durationText);
    if (!durationObj) {
      await interaction.reply({
        content: `Duração **"${durationText}"** inválida. Use formatos como \`1d\`, \`7d\`, \`1w\`, \`1mo\`.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const cooldownText = interaction.fields.getTextInputValue("cooldown").trim();
    let freeCooldownMs = defaultFreeCooldownMs;
    if (cooldownText) {
      const cdObj = parseDuration(cooldownText);
      if (!cdObj || cdObj.milliseconds === null) {
        await interaction.reply({
          content: `Cooldown **"${cooldownText}"** inválido. Use formatos como \`8h\`, \`12h\`, \`1d\`. Vitalício não é permitido.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      freeCooldownMs = cdObj.milliseconds;
    }

    let quantity = 1;
    if (interaction.customId === "key:modal:free:batch") {
      const quantityText = interaction.fields.getTextInputValue("quantity").trim();
      if (!/^\d+$/.test(quantityText)) {
        await interaction.reply({ content: "Informe uma quantidade numérica válida.", flags: MessageFlags.Ephemeral });
        return;
      }
      quantity = Number(quantityText);
      if (quantity < 1 || quantity > maxKeysPerBatch) {
        await interaction.reply({
          content: `A quantidade deve estar entre 1 e ${maxKeysPerBatch}.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    await issueFreeKeys(interaction, durationObj, freeCooldownMs, quantity);
    return;
  }

  // Remover acesso
  if (interaction.customId === "admin:revoke:submit") {
    if (!isAdmin(interaction.user.id)) {
      await interaction.reply({ content: "Somente administradores podem remover acessos.", flags: MessageFlags.Ephemeral });
      return;
    }
    await handleRevokeAccess(interaction);
    return;
  }

  // Resetar key
  if (interaction.customId === "admin:reset-key:submit") {
    if (!isAdmin(interaction.user.id)) {
      await interaction.reply({ content: "Somente administradores podem resetar keys.", flags: MessageFlags.Ephemeral });
      return;
    }
    await handleResetKey(interaction);
    return;
  }

  // Blacklist — adicionar
  if (interaction.customId === "admin:blacklist:add:submit") {
    if (!isAdmin(interaction.user.id)) {
      await interaction.reply({ content: "Somente administradores podem gerenciar a blacklist.", flags: MessageFlags.Ephemeral });
      return;
    }
    await handleBlacklistAdd(interaction);
    return;
  }

  // Blacklist — remover
  if (interaction.customId === "admin:blacklist:remove:submit") {
    if (!isAdmin(interaction.user.id)) {
      await interaction.reply({ content: "Somente administradores podem gerenciar a blacklist.", flags: MessageFlags.Ephemeral });
      return;
    }
    await handleBlacklistRemove(interaction);
  }
}

client.on("interactionCreate", async (interaction) => {
  try {
    await handleInteraction(interaction);
  } catch (error) {
    console.error("Erro ao processar interação:", error);
    if (interaction.isRepliable()) {
      try {
        const response = {
          content: "Não foi possível concluir a ação. Verifique os logs do bot.",
          flags: MessageFlags.Ephemeral,
        };
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp(response);
        } else {
          await interaction.reply(response);
        }
      } catch (replyError) {
        console.error("Não foi possível informar o erro:", replyError);
      }
    }
  }
});

client.once("ready", () => {
  console.log(`Bot conectado como ${client.user.tag}.`);
  startStatusEmbed();
  startStatsEmbed();
});

// ---------------------------------------------------------------------------
// Embed de status do servidor — atualiza a cada 5 segundos
// ---------------------------------------------------------------------------

let statusMessageId = null;
let statusIntervalRunning = false;

async function buildStatusEmbed() {
  try {
    const guild = statusGuildId
      ? (client.guilds.cache.get(statusGuildId) ?? await client.guilds.fetch(statusGuildId).catch(() => null))
      : client.guilds.cache.first();

    if (!guild) return null;

    await guild.members.fetch().catch(() => {});

    const total  = guild.memberCount;
    const online = guild.members.cache.filter(
      (m) => m.presence && ["online", "idle", "dnd"].includes(m.presence.status),
    ).size;

    // Contar planos ativos e expirados do store.json
    const now2 = Date.now();
    const plansData = await storage.read((state) => state.plans);
    let ativos = 0, expirados = 0;
    for (const plan of Object.values(plansData)) {
      if (plan.expiresAt === null || plan.expiresAt > now2) ativos++;
      else expirados++;
    }

    // Gerar convite válido automaticamente pelo canal de texto do servidor
    let inviteUrl = discordInvite;
    try {
      const invites = await guild.invites.fetch().catch(() => null);
      const existing = invites?.find((i) => i.channel && !i.expiresAt && i.maxUses === 0);
      if (existing) {
        inviteUrl = `https://discord.gg/${existing.code}`;
      } else {
        // Criar convite permanente no primeiro canal de texto disponível
        const textChannel = guild.channels.cache.find(
          (c) => c.isTextBased() && c.permissionsFor(guild.members.me)?.has("CreateInstantInvite"),
        );
        if (textChannel) {
          const newInvite = await textChannel.createInvite({ maxAge: 0, maxUses: 0, unique: false });
          inviteUrl = `https://discord.gg/${newInvite.code}`;
        }
      }
    } catch {}

    const now = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

    const embed = new EmbedBuilder()
      .setColor(0xed1c24)
      .setTitle("Status do Servidor")
      .setThumbnail("https://cdn.discordapp.com/attachments/1529764062123135048/1553082847974129784/YyHI49C.webp?ex=6adf819d&is=6ade301d&hm=dd0f36904f52bcc5c4b67ec8a18470578ee3632f86dd7395b11b8fea6622a43c")
      .addFields(
        {
          name: "👥 Usuários",
          value: `\`\`\`\n${total.toLocaleString("pt-BR")} usuários\n\`\`\``,
          inline: true,
        },
        {
          name: "🟢 Online",
          value: `\`\`\`\n${online.toLocaleString("pt-BR")} online\n\`\`\``,
          inline: true,
        },
        {
          name: "🔗 Convite Válido",
          value: `\`\`\`\n${inviteUrl}\n\`\`\``,
          inline: false,
        },
      )
      .setFooter({ text: `Criado e desenvolvido por @mr • Atualizado: ${now}` })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("🎮 Rockstar")
        .setStyle(ButtonStyle.Link)
        .setURL("https://discord.com/channels/1522456699082903572/1563626802910601306"),
      new ButtonBuilder()
        .setLabel("🎫 Ticket")
        .setStyle(ButtonStyle.Link)
        .setURL("https://discord.com/channels/1522456699082903572/1522587244614127676"),
      new ButtonBuilder()
        .setCustomId("status:termos")
        .setLabel("📜 Termos & Serviços")
        .setStyle(ButtonStyle.Secondary),
    );

    return { embed, row };
  } catch (err) {
    console.error("[Status Embed]", err.message);
    return null;
  }
}

async function startStatusEmbed() {
  if (statusIntervalRunning) return; // garante execução única
  statusIntervalRunning = true;

  const targetChannelId = "1564090642609610824";

  let channel;
  try {
    channel = await client.channels.fetch(targetChannelId);
  } catch {
    console.error("[Status Embed] Canal não encontrado:", targetChannelId);
    statusIntervalRunning = false;
    return;
  }

  if (!channel?.isTextBased()) { statusIntervalRunning = false; return; }

  // Buscar mensagem existente do bot — evita repostar ao reiniciar
  try {
    const msgs = await channel.messages.fetch({ limit: 50 });
    const botMsgs = msgs.filter((m) => m.author.id === client.user.id && m.embeds.length > 0);

    if (botMsgs.size > 1) {
      // Apagar duplicatas, manter só a mais recente
      const sorted = [...botMsgs.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
      for (let i = 1; i < sorted.length; i++) {
        await sorted[i].delete().catch(() => {});
      }
      statusMessageId = sorted[0].id;
    } else if (botMsgs.size === 1) {
      statusMessageId = botMsgs.first().id;
    }
  } catch {}

  const tick = async () => {
    const result = await buildStatusEmbed();
    if (!result) return;
    const { embed, row } = result;
    const payload = { embeds: [embed], components: [row] };

    try {
      if (statusMessageId) {
        const msg = await channel.messages.fetch(statusMessageId).catch(() => null);
        if (msg) {
          await msg.edit(payload);
          return;
        }
      }
      const sent = await channel.send(payload);
      statusMessageId = sent.id;
    } catch (err) {
      console.error("[Status Embed] Erro ao atualizar:", err.message);
    }
  };

  setTimeout(tick, 2000);
  setInterval(tick, 5000);
}

async function start() {
  await storage.init();
  await client.login(token);
}

start().catch((error) => {
  console.error("Não foi possível iniciar o bot:", error);
  process.exitCode = 1;
});


// ---------------------------------------------------------------------------
// Embed de estatísticas por servidor
// ---------------------------------------------------------------------------

let statsMessageId = null;

async function startStatsEmbed() {
  if (!statsChannelId) return;

  let channel;
  try {
    channel = await client.channels.fetch(statsChannelId);
  } catch {
    console.error("[Stats Embed] Canal não encontrado:", statsChannelId);
    return;
  }

  if (!channel?.isTextBased()) return;

  // Buscar mensagem existente
  try {
    const msgs = await channel.messages.fetch({ limit: 20 });
    const prev = msgs.find((m) => m.author.id === client.user.id && m.embeds.length > 0 && m.embeds[0].title?.includes("Estatísticas"));
    if (prev) statsMessageId = prev.id;
  } catch {}

  const tick = async () => {
    const stats = await storage.read((state) => state.guildStats || {});
    const sortedStats = Object.entries(stats).sort((a, b) => b[1].keysRedeemed - a[1].keysRedeemed);

    const description = sortedStats.length === 0
      ? "Nenhuma key resgatada ainda."
      : sortedStats.map(([gId, data], index) => {
          const guildName = client.guilds.cache.get(gId)?.name || `Servidor ${gId}`;
          return `**${index + 1}.** ${guildName}\n> 🔑 **${data.keysRedeemed}** keys resgatadas\n> 🕒 Última: <t:${Math.floor(data.lastUpdate / 1000)}:R>`;
        }).join("\n\n");

    const embed = new EmbedBuilder()
      .setColor(0xed1c24)
      .setTitle("📊 Estatísticas por Servidor")
      .setDescription(description)
      .setFooter({ text: "Atualizado a cada 30 segundos" })
      .setTimestamp();

    const payload = { embeds: [embed] };

    try {
      if (statsMessageId) {
        const msg = await channel.messages.fetch(statsMessageId).catch(() => null);
        if (msg) {
          await msg.edit(payload);
          return;
        }
      }
      const sent = await channel.send(payload);
      statsMessageId = sent.id;
    } catch (err) {
      console.error("[Stats Embed] Erro ao atualizar:", err.message);
    }
  };

  setTimeout(tick, 3000);
  setInterval(tick, 30_000);
}
