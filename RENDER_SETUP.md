# 🚀 Como Hospedar o Bot na Render

## Passo 1: Preparar o Repositório Git

1. **Inicialize o Git** (se ainda não foi feito):
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   ```

2. **Crie um repositório no GitHub**:
   - Acesse: https://github.com/new
   - Crie um repositório (pode ser privado)
   - Copie a URL do repositório

3. **Conecte e envie o código**:
   ```bash
   git remote add origin https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git
   git branch -M main
   git push -u origin main
   ```

## Passo 2: Configurar na Render

1. **Acesse a Render**: https://render.com/
2. **Crie uma conta** (pode usar GitHub)
3. **Clique em "New +"** → **"Web Service"**
4. **Conecte seu repositório do GitHub**
5. **Configure o serviço**:
   - **Name**: `novo-bot` (ou o nome que preferir)
   - **Region**: `Frankfurt (EU Central)` ou `Oregon (US West)`
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free`

## Passo 3: Configurar Variáveis de Ambiente

Na página do serviço, vá em **"Environment"** e adicione:

```
BOT_TOKEN=SEU_TOKEN_DO_DISCORD
ADMIN_IDS=1382576164752724069
LICENSE_SECRET=defina_um_segredo_aleatorio_de_pelo_menos_32_bytes
PREFIX=!
PANEL_CHANNEL_ID=1563626802910601306
LOG_CHANNEL_ID=1563685695610953828
PRODUCT_LOG_CHANNEL_ID=1563690643149160529
STATUS_CHANNEL_ID=1524326072701681664
STATUS_GUILD_ID=1522456699082903572
DISCORD_INVITE=https://discord.gg/mrstore
STATS_CHANNEL_ID=1564535719907561492
MAIN_GUILD_ID=1522456699082903572
```

⚠️ **IMPORTANTE**: Não esqueça de substituir `SEU_TOKEN_DO_DISCORD` pelo token real!

## Passo 4: Deploy

1. Clique em **"Create Web Service"**
2. Aguarde o build e deploy (leva ~3-5 minutos)
3. O bot estará online! 🎉

## ⚠️ Limitações do Plano Free da Render

- O serviço **hiberna após 15 minutos de inatividade**
- **750 horas grátis por mês** (suficiente para 1 bot rodando 24/7)
- Para evitar hibernação, considere usar um serviço de ping (UptimeRobot, etc)

## 🔄 Manter o Bot Sempre Online (Opcional)

### Opção 1: UptimeRobot (Recomendado)
1. Acesse: https://uptimerobot.com/
2. Crie uma conta grátis
3. Adicione um novo monitor:
   - **Type**: HTTP(s)
   - **URL**: `https://seu-bot.onrender.com` (URL do seu serviço na Render)
   - **Interval**: 5 minutos

### Opção 2: Cron-job.org
1. Acesse: https://cron-job.org/
2. Crie uma conta
3. Configure um cronjob para fazer ping na URL do seu serviço a cada 5-10 minutos

## 📊 Persistência de Dados

**⚠️ IMPORTANTE**: O plano free da Render **não persiste arquivos** após restart!

Os arquivos `data/store.json` e `data/redeems-log.json` serão perdidos a cada deploy.

### Soluções:

1. **Redis** (Recomendado): Migrar para Redis grátis
2. **MongoDB**: Usar MongoDB Atlas (grátis)
3. **PostgreSQL**: Render oferece PostgreSQL grátis
4. **Backup automático**: Criar um sistema que faz backup dos JSONs em um banco

Quer que eu implemente uma dessas soluções?

## 🐛 Troubleshooting

### Bot não inicia
- Verifique os logs na Render: "Logs" tab
- Confirme que todas as variáveis de ambiente estão configuradas

### Bot desconecta sozinho
- Isso é normal no plano free (hibernação após 15 min sem requisições)
- Configure um monitor de ping

### Comandos não funcionam
- Verifique se o token do bot está correto
- Confirme que o bot tem as permissões necessárias no Discord

## 📞 Suporte

Se tiver problemas, verifique:
1. Logs da Render
2. Status do Discord API: https://discordstatus.com/
3. Configurações de variáveis de ambiente
