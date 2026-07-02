[OPEN] Debug Session: napi-throw-crash

Contexto
- Sintoma: ao executar `npm start` (Electron), o app encerra com “FATAL ERROR: Error::ThrowAsJavaScriptException napi_throw”.
- Esperado: o app permanecer aberto e estável.

Hipóteses (falsificáveis)
- H1: O crash é disparado durante `syncBannerConfigToServer()` (ex.: payload grande, dados inválidos, ou erro no fluxo de DB/sync).
- H2: O crash é disparado durante `bannerServer.updatePontuacao()` (ex.: evento muito frequente/timer) após o banner server iniciar.
- H3: O crash é disparado por um módulo nativo (ex.: sqlite3) em callback assíncrono, e ocorre perto de operações de DB/IO.
- H4: O crash é disparado por eventos de janela/frame (reload/dispose) e um envio IPC em momento inválido piora a situação.

Plano de evidência
- Instrumentar (sem alterar lógica) pontos: init do app, start do banner server, syncBannerConfigToServer start/end, updatePontuacao, tamanhos de payload, e handlers globais (uncaughtException/unhandledRejection/warning/render-process-gone).
- Reproduzir com `npm start` e coletar logs do Debug Server.

Resultados
- pre-fix: (pendente)
- post-fix: (pendente)
