# Nexus Connections

Nexus Connections, ou NC, é um site open source para facilitar a conexão temporária de bots WhatsApp usando Baileys.

## Criador

- Criador: lukscode
- GitHub: https://github.com/lukscode-py
- Canal: @vixzap

## Objetivo

Permitir que o usuário escolha entre:

- QR Code
- Código por número

Depois da conexão, o sistema prepara os arquivos de sessão em um ZIP temporário.

## Segurança

- Dados temporários em JSON
- Sessões expiram rápido
- Sem sistema de usuários
- Sem banco persistente
- Rate limit por IP e telefone
- Arquivos sensíveis ignorados pelo Git
- Arquivos .env reais não são versionados

## Desenvolvimento

Comandos:

npm install
npm run dev

Acesse:

http://localhost:3333

## Produção

Comando:

npm start

## Vercel

O projeto possui vercel.json para deploy.

Observação: a Vercel pode servir o site e rodar rotas serverless, mas conexão Baileys com QR/pair code é mais estável em VPS/Node direto porque usa socket vivo e arquivos temporários.

## Licença

MIT
