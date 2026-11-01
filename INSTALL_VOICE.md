# 🎤 Instalação do Módulo de Voz

Para usar os comandos de voz (`!cv` e `!dc`), você precisa instalar a biblioteca `@discordjs/voice`.

## 📦 Instalação

### Windows (PowerShell como Administrador):

```powershell
# Habilitar execução de scripts (se necessário)
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned

# Instalar dependência
npm install @discordjs/voice
```

### Alternativa (usando cmd):

```cmd
npm install @discordjs/voice
```

### Alternativa (usando npx):

```cmd
npx npm install @discordjs/voice
```

## ✅ Verificação

Após instalar, reinicie o bot:

```bash
node src/index.js
```

Se a instalação foi bem-sucedida, você **não** verá a mensagem de aviso:
```
⚠️ @discordjs/voice não instalado...
```

## 🎯 Comandos Disponíveis

- `!cv` - Bot entra no canal de voz onde você está
- `!dc` - Bot sai do canal de voz

## ⚙️ Requisitos

- Node.js 20+
- Discord.js 14+
- @discordjs/voice 0.16+

## 🔧 Troubleshooting

Se encontrar erros durante a instalação, tente:

1. Fechar todos os terminais
2. Abrir PowerShell como Administrador
3. Navegar até a pasta do bot
4. Executar: `npm install --save @discordjs/voice`

## 📝 Nota

O bot já está preparado para usar o módulo de voz. Se a biblioteca não estiver instalada, os comandos `!cv` e `!dc` simplesmente informarão que o módulo não está disponível, mas o resto do bot funcionará normalmente.
