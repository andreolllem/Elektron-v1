Cléo – Assistente Comercial (Electron)

Estrutura criada com Electron (sem TypeScript) e UI em HTML + JS + CSS, modo escuro, estilo chat.

Pastas:
- /main → processo principal do Electron (main.js)
- /renderer → interface (index.html, styles.css, app.js)
- /assets → ícones, avatar (cleo.svg). Opcional: adicionar icon.png

Como rodar (passos):
1) Instale dependências: npm install
2) Inicie o app: npm start

Notas:
- O ícone da janela usa assets/icon.png se existir (PNG 256x256 recomendado).
- A “API” é mockada em renderer/app.js (postMessage/getMessages). A integração real com n8n pode substituir essas funções.
- Envio com Enter e quebra de linha com Shift+Enter.
- Mensagens do usuário à direita; da assistente à esquerda, com avatar e nome “Cléo”.

