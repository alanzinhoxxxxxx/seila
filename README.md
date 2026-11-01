# 🤖 Novo Bot - Discord License Manager

Bot Discord profissional para gerenciamento de licenças e distribuição de produtos digitais com sistema de cooldown inteligente e anti-abuse.

Bot Discord para distribuir contas digitais a usuários com licença ativa.

## Requisitos

- Node.js 20.11 ou mais recente
- Um aplicativo/bot criado no [Discord Developer Portal](https://discord.com/developers/applications)

## Configuração

1. Instale as dependências com `npm install`.
2. Copie `.env.example` para `.env`.
3. Defina `BOT_TOKEN`, `ADMIN_IDS` e `LICENSE_SECRET`. Gere o segredo com `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` e mantenha-o privado. Trocar esse segredo invalida as keys assinadas ainda não resgatadas. Para obter seu ID do Discord, habilite o modo de desenvolvedor no Discord e use **Copiar ID do usuário**. Separe vários administradores por vírgulas.
4. No Developer Portal, habilite **Message Content Intent** em *Bot > Privileged Gateway Intents*.
5. Convide o bot para o servidor com as permissões de ver canais, enviar mensagens, incorporar links e anexar arquivos.
6. Inicie com `npm start`.

Não compartilhe o token do bot nem publique o arquivo `.env`.

## Comandos

- `!painel` — publica o painel de entregas com Rockstar, Discord, Steam e Meu plano. A quantidade em estoque aparece no embed e nos botões; produtos sem estoque ficam desativados. Publique novamente o comando após adicionar estoque para atualizar o painel existente. Cada usuário tem um cooldown independente por produto: 45 minutos para planos vitalícios, 1h30 para planos normais e 8 horas para keys free.
- `!estoque` — abre o painel administrativo para adicionar contas; informe uma conta por linha.
- `!key` — abre o painel administrativo de geração de licenças.
- `!cv` — bot entra no canal de voz onde você está (requer `@discordjs/voice` instalado - veja [INSTALL_VOICE.md](INSTALL_VOICE.md)).
- `!dc` — bot sai do canal de voz.

O prefixo pode ser alterado pela variável `PREFIX`. Os comandos de estoque e geração de keys e suas interações são restritos aos IDs listados em `ADMIN_IDS`.

## Keys e planos

No painel `!key`, escolha uma duração e gere uma key individual ou um lote de até 100 keys. O lote é entregue em um arquivo privado. As opções são 1 segundo, 1 minuto, 1 hora, 1 dia, 1 mês (30 dias) e vitalício. As novas keys usam o formato `TEMPO-XXXX-XXXX-XXXX` (por exemplo, `1m-AbCd-EfGh-IjKl`), recebem uma assinatura criptográfica criada com `LICENSE_SECRET` e precisam constar no registro local do bot para serem resgatadas; keys inventadas, alteradas ou não registradas são recusadas. O primeiro bloco da key mostra sua duração: `1s`, `1m`, `1h`, `1d`, `1mo` ou `life`. Keys antigas já geradas pelo bot continuam válidas se ainda estiverem registradas. Cada key só pode ser resgatada uma vez. Resgatar uma key durante um plano ativo soma o prazo ao vencimento atual; um plano vitalício não perde a validade.

O painel **Meu plano** e as respostas de resgate, entrega de conta e histórico são privados/efêmeros. O histórico completo é enviado como arquivo privado.

## Dados

Estoque, licenças, planos e histórico ficam em `data/store.json`. Esse arquivo contém credenciais de contas em texto puro: proteja o acesso à máquina e faça backups seguros. Não edite o arquivo enquanto o bot estiver em execução.


## 🚀 Deploy Rápido

### Hospedar na Render (Grátis)

1. **Push para GitHub**:
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/SEU_USUARIO/SEU_REPO.git
git push -u origin main
```

2. **Deploy na Render**:
   - Acesse: https://render.com/
   - New + → Web Service
   - Conecte seu repositório
   - Configure as variáveis de ambiente (veja `.env.example`)
   - Deploy! 🎉

📖 **Guia completo**: Veja [RENDER_SETUP.md](./RENDER_SETUP.md)

## ⚡ Recursos

- ✅ Sistema de licenças com duração customizável
- ✅ Cooldown dinâmico baseado na duração do plano
- ✅ Sistema anti-abuse com penalidades
- ✅ Painel admin completo
- ✅ Resgate em massa (10 unidades)
- ✅ Gerador de código 2FA/TOTP
- ✅ Multi-servidor support
- ✅ Logs detalhados de resgates
- ✅ Backup automático

## 🛠️ Instalação Local

```bash
npm install
cp .env.example .env
# Configure suas variáveis no .env
npm start
```

## 📝 Comandos

- `!painel` - Mostra o painel de produtos
- `!admin` - Painel administrativo (apenas admins)
- `!2fa` - Gerador de código 2FA
- `!cv` - Conectar ao canal de voz
- `!dc` - Desconectar do canal de voz

## 🔒 Segurança

- Tokens nunca são commitados (`.gitignore`)
- Secrets em variáveis de ambiente
- Sistema de blacklist integrado
- Logs de auditoria completos
