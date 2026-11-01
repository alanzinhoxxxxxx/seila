const fs = require("node:fs/promises");
const path = require("node:path");

const emptyState = () => ({
  stock: {
    rockstar: [],
    discord: [],
    steam: [],
    rockstar_50: [],
  },
  keys: {},
  plans: {},
  history: {},
  cooldowns: {},
  blacklist: {},
  panel: null,
  panels: {},
  guildStats: {}, // { guildId: { keysRedeemed: 0, lastUpdate: timestamp } }
});

class Storage {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = null;
    this.queue = Promise.resolve();
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const contents = await fs.readFile(this.filePath, "utf8");
      this.state = JSON.parse(contents);
      this.validateState();
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw new Error(`Não foi possível carregar o estoque em ${this.filePath}: ${error.message}`);
      }

      this.state = emptyState();
      await this.persist(this.state);
    }
  }

  validateState() {
    if (
      !this.state ||
      !this.state.stock ||
      !Array.isArray(this.state.stock.rockstar) ||
      !Array.isArray(this.state.stock.discord) ||
      !Array.isArray(this.state.stock.steam) ||
      !this.state.keys ||
      !this.state.plans ||
      !this.state.history
    ) {
      throw new Error(`O arquivo de dados ${this.filePath} não possui um formato válido.`);
    }

    // Migração: inicializar slot de desconto se ausente em dados antigos
    if (!Array.isArray(this.state.stock.rockstar_50)) {
      this.state.stock.rockstar_50 = [];
    }

    if (this.state.cooldowns === undefined || this.state.cooldowns === null) {
      this.state.cooldowns = {};
    }
    if (typeof this.state.cooldowns !== "object" || Array.isArray(this.state.cooldowns)) {
      throw new Error(`O arquivo de dados ${this.filePath} contém cooldowns em um formato inválido.`);
    }

    if (!this.state.blacklist || typeof this.state.blacklist !== "object" || Array.isArray(this.state.blacklist)) {
      this.state.blacklist = {};
    }

    // Validação e migração de painéis — multi-servidor (panels) é o formato atual
    if (!this.state.panels || typeof this.state.panels !== "object" || Array.isArray(this.state.panels)) {
      this.state.panels = {};
    }

    // Manter state.panel para compatibilidade com dados antigos (será migrado no refreshPanel)
    const panel = this.state.panel;
    if (panel === undefined || panel === null) {
      this.state.panel = null;
    } else if (
      typeof panel !== "object" ||
      Array.isArray(panel) ||
      typeof panel.channelId !== "string" ||
      typeof panel.messageId !== "string"
    ) {
      this.state.panel = null;
    }

    // Inicializar estatísticas de servidor se ausente
    if (!this.state.guildStats || typeof this.state.guildStats !== "object" || Array.isArray(this.state.guildStats)) {
      this.state.guildStats = {};
    }
  }

  async persist(state) {
    const temporaryPath = `${this.filePath}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await fs.rename(temporaryPath, this.filePath);
  }

  transact(callback) {
    const operation = this.queue.then(async () => {
      const nextState = JSON.parse(JSON.stringify(this.state));
      const result = await callback(nextState);
      await this.persist(nextState);
      this.state = nextState;
      return result;
    });

    this.queue = operation.catch(() => {});
    return operation;
  }

  read(callback) {
    return this.queue.then(() => callback(this.state));
  }
}

module.exports = { Storage };
