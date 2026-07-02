const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  dialog,
  clipboard,
} = require("electron");

const sqlite = require("sqlite3").verbose();
const nodemailer = require("nodemailer");
// const serialNumber = require('serial-number'); // Desabilitado para Linux
let configMonitor;
let configSerial;
const path = require("path");
const url = require("url");
const fs = require("fs-extra");
const moment = require("moment");
const os = require("os");
const { spawn } = require("child_process");
let activeTunnel = null;
const bannerServer = require("./server/banner-server");

// #region debug-point A:dbg-report
let __dbgCfg = null;
function __dbgGetCfg() {
  if (__dbgCfg) return __dbgCfg;
  let u = "http://127.0.0.1:7777/event";
  let s = "napi-throw-crash";
  try {
    const c = require("fs").readFileSync(".dbg/napi-throw-crash.env", "utf8");
    u = c.match(/DEBUG_SERVER_URL=(.+)/)?.[1]?.trim() || u;
    s = c.match(/DEBUG_SESSION_ID=(.+)/)?.[1]?.trim() || s;
  } catch { }
  __dbgCfg = { u, s };
  return __dbgCfg;
}
function __dbgEmit(hypothesisId, location, msg, data) {
  try {
    const { u, s } = __dbgGetCfg();
    const payload = {
      sessionId: s,
      runId: "pre-fix",
      hypothesisId,
      location,
      msg: `[DEBUG] ${msg}`,
      data: data || {},
      ts: Date.now(),
    };
    const body = JSON.stringify(payload);
    const { URL } = require("url");
    const parsed = new URL(u);
    const mod = parsed.protocol === "https:" ? require("https") : require("http");
    const req = mod.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        timeout: 800,
      },
      (res) => { res.resume(); },
    );
    req.on("error", () => { });
    req.on("timeout", () => { try { req.destroy(); } catch { } });
    req.write(body);
    req.end();
  } catch { }
}
// #endregion

// ============================================
// SISTEMA DE LOGS PERSISTENTES
// ============================================
let logFilePath = null;
let logStream = null;

/**
 * Inicializa o sistema de logs.
 * Cria um arquivo de log com timestamp no nome.
 */
function initLogging() {
  try {
    const logsDir = (app && app.isPackaged)
      ? path.join("C:\\Scoreboard-voleibol", "logs")
      : path.join(__dirname, "logs");

    fs.ensureDirSync(logsDir);

    // Nome do arquivo com data/hora
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
    logFilePath = path.join(logsDir, `scoreboard-${timestamp}.log`);

    // Criar stream de escrita
    logStream = fs.createWriteStream(logFilePath, { flags: "a" });

    // Log inicial
    writeLog("INFO", "=".repeat(60));
    writeLog("INFO", "SCOREBOARD VOLEIBOL - INICIANDO APLICAÇÃO");
    writeLog("INFO", "=".repeat(60));
    writeLog("INFO", `Data/Hora: ${new Date().toISOString()}`);
    writeLog("INFO", `Plataforma: ${os.platform()} ${os.arch()}`);
    writeLog("INFO", `Node Version: ${process.version}`);
    writeLog("INFO", `Electron Version: ${process.versions.electron}`);
    writeLog("INFO", `App Packaged: ${app ? app.isPackaged : false}`);
    writeLog("INFO", `Exec Path: ${process.execPath}`);
    writeLog("INFO", `CWD: ${process.cwd()}`);
    writeLog("INFO", `__dirname: ${__dirname}`);
    writeLog("INFO", "-".repeat(60));

    // Sobrescrever console.log, console.error, console.warn
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    console.log = function (...args) {
      writeLog(
        "LOG",
        args
          .map((a) => (typeof a === "object" ? JSON.stringify(a) : a))
          .join(" "),
      );
      originalLog.apply(console, args);
    };

    console.error = function (...args) {
      const safeArgs = args.map((a) => {
        if (typeof a === "object") {
          try {
            const s = JSON.stringify(a);
            return s.length > 1000 ? s.substring(0, 1000) + '...[TRUNCATED]' : s;
          } catch (e) { return '[Object]'; }
        }
        return typeof a === 'string' && a.length > 1000 ? a.substring(0, 1000) + '...[TRUNCATED]' : a;
      });
      writeLog("ERROR", safeArgs.join(" "));
      originalError.apply(console, args);
    };

    console.warn = function (...args) {
      const safeArgs = args.map((a) => {
        if (typeof a === "object") {
          try {
            const s = JSON.stringify(a);
            return s.length > 1000 ? s.substring(0, 1000) + '...[TRUNCATED]' : s;
          } catch (e) { return '[Object]'; }
        }
        return typeof a === 'string' && a.length > 1000 ? a.substring(0, 1000) + '...[TRUNCATED]' : a;
      });
      writeLog("WARN", safeArgs.join(" "));
      originalWarn.apply(console, args);
    };

    console.log("[Logging] Sistema de logs iniciado em:", logFilePath);
  } catch (err) {
    // Fallback: mostrar erro no console original
    process.stderr.write(
      `[Logging] Erro ao inicializar logs: ${err.message}\n`,
    );
  }
}

/**
 * Escreve uma mensagem no arquivo de log
 */
function writeLog(level, message) {
  if (!logStream) return;

  const timestamp = new Date().toISOString();
  // Truncar mensagens muito grandes para evitar problemas de memória
  const safeMsg = (message && message.length > 2000) ? message.substring(0, 2000) + '...[TRUNCATED]' : message;
  const logLine = `[${timestamp}] [${level}] ${safeMsg}\n`;

  try {
    logStream.write(logLine);
  } catch (err) {
    // Silenciar erros de escrita
  }
}

/**
 * Captura erros de janelas do renderer
 */
function setupWindowErrorLogging(window, windowName) {
  if (!window || !window.webContents) return;

  window.webContents.on("crashed", (event, killed) => {
    writeLog("CRASH", `Janela ${windowName} crashou! killed=${killed}`);
  });

  window.webContents.on("unresponsive", () => {
    writeLog("WARN", `Janela ${windowName} não está respondendo`);
  });

  window.webContents.on("responsive", () => {
    writeLog("INFO", `Janela ${windowName} voltou a responder`);
  });

  window.webContents.on(
    "did-fail-load",
    (event, errorCode, errorDescription, validatedURL) => {
      writeLog(
        "ERROR",
        `Janela ${windowName} falhou ao carregar: ${errorDescription} (${errorCode}) - URL: ${validatedURL}`,
      );
    },
  );

  window.webContents.on(
    "console-message",
    (event, level, message, line, sourceId) => {
      const levelNames = ["DEBUG", "LOG", "WARN", "ERROR"];
      // Truncar mensagens muito grandes para evitar crash do V8 Inspector (BLOB data)
      const safeMessage = (message && message.length > 500) ? message.substring(0, 500) + '...[TRUNCATED]' : message;
      writeLog(
        `RENDERER-${levelNames[level] || "LOG"}`,
        `[${windowName}] ${safeMessage} (${sourceId}:${line})`,
      );
    },
  );
}

/**
 * Envia mensagem IPC de forma segura, verificando se a janela e webContents
 * existem e não foram destruídos. Previne o erro "Render frame was disposed".
 */
function safeSend(win, channel, ...args) {
  try {
    if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  } catch (e) {
    // Silencia erros de frame destruído durante transições/reloads
  }
}

// Capturar erros não tratados do processo principal
process.on("uncaughtException", (error) => {
  writeLog("FATAL", `Uncaught Exception: ${error.message}`);
  writeLog("FATAL", `Stack: ${error.stack}`);

  // Mostrar diálogo de erro
  try {
    dialog.showErrorBox(
      "Erro Fatal",
      `${error.message}\n\nVeja o log em: ${logFilePath}`,
    );
  } catch (e) { }
});

process.on("unhandledRejection", (reason, promise) => {
  writeLog("ERROR", `Unhandled Rejection: ${reason}`);
});

// Inicializar logging assim que possível
initLogging();

// #region debug-point A:process-hooks
try {
  __dbgEmit("A", "main.js:init", "initLogging ok", {
    node: process.version,
    electron: process.versions?.electron,
    chrome: process.versions?.chrome,
    platform: `${os.platform()} ${os.arch()}`,
    packaged: app ? app.isPackaged : null,
  });

  process.on("warning", (w) => {
    __dbgEmit("A", "main.js:process.warning", "process warning", {
      name: w?.name,
      message: w?.message,
      stack: w?.stack ? String(w.stack).slice(0, 2000) : undefined,
    });
  });

  process.on("exit", (code) => {
    __dbgEmit("A", "main.js:process.exit", "process exit", { code });
  });

  app?.on?.("render-process-gone", (_event, details) => {
    __dbgEmit("D", "main.js:render-process-gone", "render process gone", details || {});
  });

  app?.on?.("child-process-gone", (_event, details) => {
    __dbgEmit("D", "main.js:child-process-gone", "child process gone", details || {});
  });
} catch { }
// #endregion

// ============================================
// GESTÃO DO BANCO DE DADOS E ARQUIVOS
// ============================================
let resolvedDataRoot = null;
function getDataRoot() {
  if (resolvedDataRoot) return resolvedDataRoot;

  const preferred = (app && app.isPackaged) ? "C:\\Scoreboard-voleibol" : __dirname;
  try {
    fs.ensureDirSync(preferred);
    fs.accessSync(preferred, fs.constants.W_OK);
    resolvedDataRoot = preferred;
    return resolvedDataRoot;
  } catch (e) {
    const fallback = path.join(app.getPath("userData"), "Scoreboard-voleibol");
    fs.ensureDirSync(fallback);
    resolvedDataRoot = fallback;
    return resolvedDataRoot;
  }
}

/**
 * Inicializa o diretório de dados e o banco de dados.
 */
function initDb() {
  const dataRoot = getDataRoot();

  const assetsPath = path.join(dataRoot, "resources", "assets");
  fs.ensureDirSync(assetsPath);

  const targetDbPath = path.join(dataRoot, "scoreboard.sqlite");

  // Se o banco não existe no destino, copia do local de instalação
  if (!fs.existsSync(targetDbPath)) {
    let sourcePath;
    if (app && app.isPackaged) {
      // O arquivo original fica junto com o executável (extraFiles)
      sourcePath = path.join(
        path.dirname(process.execPath),
        "scoreboard.sqlite",
      );
    } else {
      sourcePath = path.join(__dirname, "scoreboard.sqlite");
    }

    try {
      if (fs.existsSync(sourcePath)) {
        console.log(
          `[InitDB] Copiando banco de dados de ${sourcePath} para ${targetDbPath}`,
        );
        fs.copyFileSync(sourcePath, targetDbPath);
      } else {
        console.error(
          `[InitDB] Banco de dados original não encontrado em: ${sourcePath}`,
        );
      }
    } catch (err) {
      console.error(`[InitDB] Erro ao copiar banco de dados: ${err.message}`);
    }
  }

  // Migração: Adicionar coluna arquivo_data se não existir
  try {
    const db = new sqlite.Database(targetDbPath);
    db.run(
      `ALTER TABLE config_video_foto ADD COLUMN arquivo_data BLOB`,
      function (err) {
        if (err && !err.message.includes("duplicate column")) {
          console.error(
            "[InitDB] Erro ao adicionar coluna arquivo_data:",
            err.message,
          );
        } else if (!err) {
          console.log("[InitDB] Coluna arquivo_data adicionada com sucesso.");
        }
      },
    );
    db.close();
  } catch (err) {
    console.error("[InitDB] Erro na migração:", err.message);
  }

  // Migração: Adicionar coluna partes_jogo se não existir
  try {
    const db2 = new sqlite.Database(targetDbPath);
    db2.run(
      `ALTER TABLE config_jogo_setup ADD COLUMN partes_jogo INTEGER DEFAULT 1`,
      function (err) {
        if (err && !err.message.includes("duplicate column")) {
          console.error(
            "[InitDB] Erro ao adicionar coluna partes_jogo:",
            err.message,
          );
        } else if (!err) {
          console.log("[InitDB] Coluna partes_jogo adicionada com sucesso.");
        }
      },
    );
    db2.close();
  } catch (err) {
    console.error("[InitDB] Erro na migração partes_jogo:", err.message);
  }
}

/**
 * Obtém o caminho do banco de dados de forma ABSOLUTA.
 */
function getDbPath() {
  return path.join(getDataRoot(), "scoreboard.sqlite");
}

// Handler para fornecer o caminho do DB para as views
ipcMain.handle("get-db-path", () => {
  return getDbPath();
});

/**
 * Obtém o caminho base para assets do usuário
 */
function getUserAssetsPath() {
  return path.join(getDataRoot(), "resources", "assets");
}

var isDebug = false; // Desabilitado para produção
var activeReload = false;
var isLinux = os.platform() === "linux";

// Inclua esta linha para adicionar a funcionalidade de recarga automática.
if (isDebug && activeReload) {
  // require('electron-reload')(__dirname, {
  //   electron: path.join(__dirname, 'node_modules', '.bin', 'electron'),
  // });
}

let firstWindow;
let secondWindow;
let thirdWindow;
let fourthWindow;
let fifthWindow;
let janelas = [];
let numero_serial = "";

// ============================================
// BYPASS DE LICENÇA - ATIVO PARA TODAS PLATAFORMAS
// ============================================
var bypassLicense = true; // Altere para false para reativar licenciamento
if (bypassLicense) {
  console.log("🔓 Bypass de licença ativado (Voleibol)");
  app.whenReady().then(() => {
    // Inicializar DB na área do usuário
    initDb();
    try {
      process.chdir(getDataRoot());
    } catch (e) { }

    console.log("[Main] App Path:", app.getAppPath());
    console.log("[Main] Exec Path:", process.execPath);
    console.log("[Main] DB Path:", getDbPath());

    createWindow().catch((err) => {
      console.error("Erro ao criar janela:", err);
      dialog.showErrorBox("Erro ao iniciar", err.message);
    });
  });
} else {
  // Licenciamento hardware-bound (igual ao Scoreboard-main)
  const serialNumber = require("serial-number");
  serialNumber.preferUUID = true;
  serialNumber(async function (err, value) {
    numero_serial = value;
    console.log('[License] Hardware serial:', numero_serial);

    app.whenReady().then(async () => {
      // Inicializar DB
      initDb();

      // Garantir colunas de licença no banco
      try {
        const dbMig = new sqlite.Database(getDbPath());
        await new Promise((resolve) => {
          dbMig.run('ALTER TABLE config_serial ADD COLUMN senha TEXT DEFAULT NULL', () => {
            dbMig.run('ALTER TABLE config_serial ADD COLUMN data_expiration TEXT DEFAULT NULL', () => {
              dbMig.close();
              resolve();
            });
          });
        });
      } catch (e) { /* colunas já existem */ }

      // Ler config_serial do banco
      let configSerial = null;
      try {
        const dbR = new sqlite.Database(getDbPath());
        configSerial = await new Promise((resolve, reject) => {
          dbR.get('SELECT * FROM config_serial WHERE id = 1', (e, row) => {
            dbR.close();
            if (e) reject(e); else resolve(row);
          });
        });
      } catch (e) {
        console.error('[License] Erro ao ler config_serial:', e.message);
      }

      if (!configSerial) {
        console.log('[License] config_serial não encontrado. Abrindo importação...');
        createWindowImport();
        return;
      }

      // Se serial não armazenado OU hardware mudou → salva serial e limpa senha
      if (configSerial.serial == null || configSerial.serial !== numero_serial) {
        try {
          const dbU = new sqlite.Database(getDbPath());
          await new Promise((resolve, reject) => {
            dbU.run('UPDATE config_serial SET serial = ?, senha = NULL, data_expiration = NULL WHERE id = 1',
              [numero_serial], function (e) { dbU.close(); if (e) reject(e); else resolve(); });
          });
          configSerial.serial = numero_serial;
          configSerial.senha = null;
          configSerial.data_expiration = null;
          console.log('[License] Serial de hardware atualizado no banco.');
        } catch (e) {
          console.error('[License] Erro ao salvar serial:', e.message);
        }
      }

      // Sem senha → pede importação
      if (numero_serial === configSerial.serial && (configSerial.senha == null || configSerial.senha === '')) {
        console.log('[License] Sem senha de licença. Abrindo importação...');
        createWindowImport();
        return;
      }

      // Senha existe → validar arquivo de licença salvo
      const savedPathFile = path.join(app.getPath('userData'), 'license_path.txt');
      let licensePath = null;
      let licenseJson = null;

      if (fs.existsSync(savedPathFile)) {
        licensePath = fs.readFileSync(savedPathFile, 'utf-8').trim();
      }

      if (!licensePath || !fs.existsSync(licensePath)) {
        console.log('[License] Arquivo de licença não encontrado em:', licensePath);
        // Limpar senha para forçar reimportação
        try {
          const dbC = new sqlite.Database(getDbPath());
          await new Promise((resolve) => {
            dbC.run('UPDATE config_serial SET senha = NULL WHERE id = 1', () => { dbC.close(); resolve(); });
          });
        } catch (e) { }
        const msg = licensePath
          ? 'O arquivo de licença não foi encontrado em:\n' + licensePath + '\n\nPor favor, importe a licença novamente.'
          : 'Nenhum arquivo de licença salvo.\n\nPor favor, importe a licença.';
        dialog.showErrorBox('Alerta!', msg);
        createWindowImport();
        return;
      }

      try {
        const content = fs.readFileSync(licensePath, 'utf-8');
        const parsed = JSON.parse(content);
        licenseJson = Array.isArray(parsed) ? parsed[0] : parsed;
      } catch (e) {
        console.error('[License] Erro ao ler arquivo de licença:', e.message);
      }

      if (!licenseJson) {
        console.log('[License] Arquivo de licença inválido. Abrindo importação...');
        createWindowImport();
        return;
      }

      // Verificar expiração
      const expirationDate = licenseJson.data_expiration || configSerial.data_expiration;
      if (expirationDate && expirationDate !== '') {
        const data_atual = moment();
        const data_vencimento = moment(expirationDate);
        if (data_atual.isSame(data_vencimento, 'day') || data_atual.isAfter(data_vencimento)) {
          console.log('[License] Licença expirada:', expirationDate);
          dialog.showErrorBox('Alerta!', 'Sua licença expirou! Por favor, insira uma nova licença.');
          try {
            const dbE = new sqlite.Database(getDbPath());
            await new Promise((resolve) => {
              dbE.run('UPDATE config_serial SET senha = NULL, data_expiration = NULL WHERE id = 1',
                () => { dbE.close(); resolve(); });
            });
          } catch (e) { }
          if (fs.existsSync(savedPathFile)) { try { fs.unlinkSync(savedPathFile); } catch (e) { } }
          createWindowImport();
          return;
        }
      }

      // Validar serial e senha
      if (numero_serial !== configSerial.serial || licenseJson.password !== configSerial.senha) {
        console.log('[License] Serial ou senha não confere. Abrindo importação...');
        if (numero_serial !== configSerial.serial) {
          dialog.showErrorBox('Licença Inválida', 'O hardware foi alterado ou não pôde ser verificado.\nPor favor, importe a licença novamente.');
        } else {
          dialog.showErrorBox('Licença Inválida', 'A senha da licença não corresponde.\nPor favor, importe a licença novamente.');
        }
        createWindowImport();
        return;
      }

      // Licença válida → abrir aplicação
      console.log('[License] Licença válida. Abrindo aplicação...');
      createWindow().catch((e) => {
        console.error('Erro ao criar janela:', e);
        dialog.showErrorBox('Erro ao iniciar', e.message);
      });
    });
  });
}
let importWindow;
async function createWindowImport() {
  importWindow = new BrowserWindow({
    width: 400,
    height: 400,
    minWidth: 400,
    minHeight: 400,
    icon: path.join(__dirname, "resources/images/icon.png"),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
    },
    backgroundColor: '#000000',
  });
  // if (process.env.NODE_ENV !== 'development') {
  importWindow.setMenuBarVisibility(false);
  importWindow.resizable = false;
  // }
  // importWindow.webContents.openDevTools();

  importWindow.loadFile(path.join(__dirname, "views", "import_license.html"));
  importWindow.on("closed", () => {
    importWindow = null;
  });
}

function checkAndApplyMigration() {
  console.log("[Main] Verificando migrações de banco de dados...");
  const dbMs = new sqlite.Database(getDbPath());
  try {
    const migrations = [
      {
        table: "config_jogo_setup",
        column: "jogadores_por_pagina",
        type: "INTEGER DEFAULT 10",
      },
      {
        table: "config_jogo_setup",
        column: "slide_tempo",
        type: "INTEGER DEFAULT 10",
      },
      {
        table: "config_monitor",
        column: "fullscreen",
        type: "INTEGER DEFAULT 0",
      },
      {
        table: "config_monitor",
        column: "min_width",
        type: "INTEGER DEFAULT 0",
      },
      {
        table: "config_monitor",
        column: "min_height",
        type: "INTEGER DEFAULT 0",
      },
      {
        table: "config_equipas_times_jogadores",
        column: "list",
        type: "INTEGER DEFAULT NULL",
      },
      {
        table: "config_jogo_setup",
        column: "email_destinatario",
        type: "TEXT DEFAULT ''",
      },
      {
        table: "config_jogo_setup",
        column: "banner_web_enabled",
        type: "INTEGER DEFAULT 0",
      },
      {
        table: "config_equipas_times",
        column: "logo_data",
        type: "BLOB DEFAULT NULL",
      },
      {
        table: "config_equipas_geral",
        column: "logo_data",
        type: "BLOB DEFAULT NULL",
      },
      {
        table: "config_equipas_times_jogadores",
        column: "foto_data",
        type: "BLOB DEFAULT NULL",
      },
      // Migrações do scoreboard-main que estavam faltando
      {
        table: "config_jogo_setup",
        column: "tempo_final_minutos_int",
        type: "INTEGER DEFAULT 0",
      },
      {
        table: "config_jogo_setup",
        column: "tempo_final_segundos_int",
        type: "INTEGER DEFAULT 0",
      },
      { table: "config_monitor", column: "tipo", type: "TEXT DEFAULT NULL" },
      {
        table: "config_video_foto",
        column: "arquivo_data",
        type: "BLOB DEFAULT NULL",
      },
      // Cores de fundo dos golos e sets no banner
      {
        table: "config_banner_color",
        column: "golos_bg_color",
        type: "TEXT(30) DEFAULT ''",
      },
      {
        table: "config_banner_color",
        column: "faltas_bg_color",
        type: "TEXT(30) DEFAULT ''",
      },
      {
        table: "config_jogo_setup",
        column: "music_folder",
        type: "TEXT DEFAULT ''",
      },
      {
        table: "config_jogo_setup",
        column: "video_folder",
        type: "TEXT DEFAULT ''",
      },
    ];

    migrations.forEach((m) => {
      dbMs.run(
        `ALTER TABLE ${m.table} ADD COLUMN ${m.column} ${m.type}`,
        (err) => {
          if (!err) console.log(`[Migration] Coluna ${m.column} adicionada.`);
        },
      );
    });

    // Criar tabela partida_ativa se não existir (auto-save)
    dbMs.run(
      `CREATE TABLE IF NOT EXISTS partida_ativa (
      id INTEGER PRIMARY KEY DEFAULT 1,
      placar_time1 INTEGER DEFAULT 0,
      placar_time2 INTEGER DEFAULT 0,
      cronometro_minutos INTEGER DEFAULT 0,
      cronometro_segundos INTEGER DEFAULT 0,
      cronometro_pausado INTEGER DEFAULT 1,
      periodo_atual INTEGER DEFAULT 1,
      faltas_time1 INTEGER DEFAULT 0,
      faltas_time2 INTEGER DEFAULT 0,
      tempo_ataque INTEGER DEFAULT 0,
      sets_time1 INTEGER DEFAULT 0,
      sets_time2 INTEGER DEFAULT 0,
      ultimo_save TEXT,
      partida_iniciada INTEGER DEFAULT 0
    )`,
      (err) => {
        if (!err)
          console.log("[Migration] Tabela partida_ativa criada/verificada.");
      },
    );
  } catch (err) {
    console.error("[Main] Erro fatal na migração:", err);
  } finally {
    dbMs.close();
  }
}

async function createWindow() {
  // Inicializar sistema de logs ANTES de tudo
  initLogging();

  // Banner Web Server - Resetar estado ao iniciar
  async function resetBannerWebState() {
    const dbPath = getDbPath();
    console.log("[Main] Resetando estado do banner em:", dbPath);
    const dbTemp = new sqlite.Database(dbPath);
    try {
      await new Promise((resolve, reject) => {
        dbTemp.run(
          "UPDATE config_jogo_setup SET banner_web_enabled = 0 WHERE id = 1",
          (err) => {
            if (err) reject(err);
            else resolve();
          },
        );
      });
      console.log("ℹ️  Banner Web resetado para OFF (padrão de inicialização)");
    } catch (err) {
      console.error("Erro ao resetar estado do banner:", err);
    } finally {
      dbTemp.close();
    }
  }
  await resetBannerWebState();

  // Auto-migration for new features (like players per page)
  checkAndApplyMigration();

  db = new sqlite.Database(getDbPath());
  try {
    rows = await new Promise((resolve, reject) => {
      db.all("SELECT * FROM config_monitor", (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
    configMonitor = rows;
  } catch (error) {
    console.error(error.message);
  } finally {
    db.close();
  }
  console.log(configMonitor);
  // const displays = screen.getAllDisplays();
  // console.log(displays);
  // console.log(`file:${path.join(__dirname,a'views', 'index.html')}`);
  // console.log(path.join(__dirname, 'resources/images/icon.png'));
  firstWindow = new BrowserWindow({
    width: configMonitor[1].width,
    height: configMonitor[1].height,
    x: configMonitor[1].x,
    y: configMonitor[1].y,
    minWidth: 1224,
    minHeight: 768,
    autoHideMenuBar: true,
    fullscreen: configMonitor[1].fullscreen == 0 ? false : true,
    icon: path.join(__dirname, "resources/images/icon.png"),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
    },
    backgroundColor: '#000000',
  });
  janelas.push(firstWindow);
  // if (process.env.NODE_ENV !== 'development') {
  if (!isDebug) {
    firstWindow.removeMenu();
  } else {
    firstWindow.webContents.openDevTools();
  }

  // Configurar logging de erros para a janela principal
  setupWindowErrorLogging(firstWindow, "MainWindow");

  // }
  // firstWindow.webContents.openDevTools();

  // Validar e carregar arquivo HTML
  const indexPath = path.join(__dirname, "views", "index.html");
  console.log("[Main] Carregando index.html de:", indexPath);
  console.log("[Main] Arquivo existe:", fs.existsSync(indexPath));

  // Em produção ASAR, verificar caminho alternativo
  let fileToLoad = indexPath;
  if (!fs.existsSync(indexPath) && (app && app.isPackaged)) {
    const unpackedPath = path.join(
      path.dirname(process.execPath),
      "resources",
      "app.asar.unpacked",
      "views",
      "index.html",
    );
    console.log("[Main] Tentando caminho unpacked:", unpackedPath);
    if (fs.existsSync(unpackedPath)) {
      fileToLoad = unpackedPath;
    } else {
      console.error("[Main] ERRO: index.html não encontrado em nenhum local!");
    }
  }

  firstWindow.loadFile(fileToLoad);
  firstWindow.maximize();
  if (configMonitor[0].show_monitor == 1) {
    createSecondWindow("placar.html");
  }
  // if (configMonitor[2].show_monitor == 1) {
  //   createThirdWindow('tempo_ataque.html');
  // }
  if (configMonitor[3].show_monitor == 1) {
    createFourthWindow();
  }
  // if (configMonitor[4].show_monitor == 1) {
  //   createFifthWindow();
  // }

  // Banner Web Server - Inicialização
  try {
    const appPath = app.getAppPath();
    const execDir = path.dirname(process.execPath);
    const appBasePath = (app && app.isPackaged) ? execDir : __dirname;
    const assetsPath = getUserAssetsPath();

    bannerServer.setAppBasePath(appBasePath);
    bannerServer.setAssetsPath(assetsPath);
    bannerServer.startServer(3000);

    console.log(
      "🌐 Banner Server Voleibol iniciado em http://localhost:3000/banner2",
    );
    setTimeout(() => {
      syncBannerConfigToServer();
    }, 1000);
  } catch (err) {
    console.error("Erro ao iniciar banner server:", err);
  }

  // Auto-start Serveo Tunnel se habilitado no banco
  try {
    const dbPath = getDbPath();
    console.log("[Main] Verificando auto-start do Serveo...");
    console.log("[Main] DB Path:", dbPath);
    const dbServeo = new sqlite.Database(dbPath);
    dbServeo.get(
      "SELECT banner_web_enabled FROM config_jogo_setup WHERE id = 1",
      (err, row) => {
        if (err) {
          console.error("[Main] Erro ao ler banner_web_enabled:", err);
        } else {
          console.log(
            "[Main] banner_web_enabled:",
            row ? row.banner_web_enabled : "row is null",
          );
          if (row && row.banner_web_enabled == 1) {
            console.log(
              "🔄 Auto-iniciando Serveo Tunnel (config_jogo_setup.banner_web_enabled = 1)",
            );
            writeLog(
              "INFO",
              "🔄 Auto-iniciando Serveo Tunnel (config_jogo_setup.banner_web_enabled = 1)",
            );
            startServeoTunnel();
          } else {
            console.log(
              "ℹ️  Serveo Tunnel não será iniciado automaticamente (banner_web_enabled = 0)",
            );
          }
        }
        dbServeo.close();
      },
    );
  } catch (err) {
    console.error("Erro ao verificar auto-start do Serveo:", err);
    writeLog("ERROR", `Erro ao verificar auto-start do Serveo: ${err.message}`);
  }

  // createSecondWindow('placar.html');
  // createThirdWindow('tempo_ataque.html');
  // createFourthWindow();
  firstWindow.on("closed", () => {
    if (secondWindow) secondWindow.close();
    if (thirdWindow) thirdWindow.close();
    if (fourthWindow) fourthWindow.close();
    if (fifthWindow) fifthWindow.close();
    app.exit();
  });
  if (importWindow) {
    importWindow.close();
  }
}

function createSecondWindow(route) {
  secondWindow = new BrowserWindow({
    width: configMonitor[0].width,
    height: configMonitor[0].height,
    x: configMonitor[0].x,
    y: configMonitor[0].y,
    minWidth: 720,
    minHeight: 525,
    closable: true,
    autoHideMenuBar: true,
    fullscreen: configMonitor[0].fullscreen == 0 ? false : true,
    icon: path.join(__dirname, "resources/images/icon.png"),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
    },
    backgroundColor: '#000000',
  });

  // Configurar logging de erros
  setupWindowErrorLogging(secondWindow, "SecondWindow");

  // secondWindow.webContents.openDevTools();
  janelas.push(secondWindow);
  // secondWindow.maximize();
  if (!isDebug) {
    secondWindow.removeMenu();
  }
  secondWindow.loadFile(path.join(__dirname, "views", route));
  secondWindow.on("closed", () => {
    secondWindow = null;
  });
}
let configWindow = null;
function createConfigWindow(route) {
  configWindow = new BrowserWindow({
    width: 1224,
    height: 768,
    minWidth: 720,
    minHeight: 520,
    closable: false,
    modal: true,
    parent: firstWindow,
    autoHideMenuBar: true,
    icon: path.join(__dirname, "resources/images/icon.png"),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
    },
    backgroundColor: '#000000',
  });

  // Configurar logging de erros
  setupWindowErrorLogging(configWindow, "ConfigWindow");

  janelas.push(configWindow);
  configWindow.maximize();
  if (!isDebug) {
    configWindow.removeMenu();
  } else {
    configWindow.webContents.openDevTools();
  }
  configWindow.loadFile(path.join(__dirname, "views", route));
  // configWindow.webContents.openDevTools(); // DEBUG: Desabilitado
  configWindow.on("closed", () => {
    configWindow = null;
  });
}
ipcMain.on("reloadMain", (event, arg) => {
  if (secondWindow) {
    secondWindow.webContents.reload();
  }
});
ipcMain.on("send-alert", (event, incomingMessage) => {
  const options = {
    type: "none",
    buttons: ["OK"],
    title: "Alerta!",
    message: incomingMessage,
  };
  dialog.showMessageBox(configWindow, options);
});
ipcMain.on("send-alert-imp", (event, incomingMessage) => {
  const options = {
    type: "none",
    buttons: ["OK"],
    title: "Alerta!",
    message: incomingMessage,
  };
  dialog.showMessageBox(importWindow, options);
});
ipcMain.on("send-alert-main", (event, incomingMessage) => {
  const options = {
    type: "none",
    buttons: ["OK"],
    title: "Alerta!",
    message: incomingMessage,
  };
  dialog.showMessageBox(firstWindow, options);
});
ipcMain.on("closeWindowConfig", (event, arg) => {
  if (arg == true) {
    firstWindow.webContents.reload();
    if (secondWindow) {
      secondWindow.webContents.reload();
    }
    if (thirdWindow) {
      thirdWindow.webContents.reload();
    }
    if (fourthWindow) {
      fourthWindow.webContents.reload();
    }
    if (fifthWindow) {
      fifthWindow.webContents.reload();
    }
  }
  if (configWindow) {
    configWindow.destroy();
  }
});
ipcMain.on("openWindowConfig", (event, arg) => {
  // console.log(arg)
  if (!configWindow) {
    createConfigWindow(arg);
  }
});

function createThirdWindow(route) {
  thirdWindow = new BrowserWindow({
    width: configMonitor[2].width,
    height: configMonitor[2].height,
    x: configMonitor[2].x,
    y: configMonitor[2].y,
    minWidth: configMonitor[2].min_width,
    minHeight: configMonitor[2].min_height,
    closable: true,
    autoHideMenuBar: true,
    fullscreen: configMonitor[2].fullscreen == 0 ? false : true,
    icon: path.join(__dirname, "resources/images/icon.png"),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
    },
    backgroundColor: '#000000',
  });

  // Configurar logging de erros
  setupWindowErrorLogging(thirdWindow, "ThirdWindow");

  janelas.push(thirdWindow);
  if (!isDebug) {
    thirdWindow.removeMenu();
  }
  // thirdWindow.webContents.openDevTools();
  thirdWindow.loadFile(path.join(__dirname, "views", route));
  thirdWindow.on("closed", () => {
    thirdWindow = null;
  });
}

function createFourthWindow() {
  fourthWindow = new BrowserWindow({
    width: configMonitor[3].width,
    height: configMonitor[3].height,
    x: configMonitor[3].x,
    y: configMonitor[3].y,
    minWidth: 900,
    minHeight: 300,
    closable: true,
    resizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    fullscreen: configMonitor[3].fullscreen == 0 ? false : true,
    icon: path.join(__dirname, "resources/images/icon.png"),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
    },
    backgroundColor: '#000000',
  });

  // Configurar logging de erros
  setupWindowErrorLogging(fourthWindow, "FourthWindow");

  janelas.push(fourthWindow);
  // fourthWindow.webContents.openDevTools();
  if (!isDebug) {
    fourthWindow.removeMenu();
  }
  fourthWindow.loadFile(path.join(__dirname, "views", "banner.html"));
  fourthWindow.on("closed", () => {
    fourthWindow = null;
  });
}
function createFifthWindow() {
  fifthWindow = new BrowserWindow({
    width: configMonitor[4].width,
    height: configMonitor[4].height,
    x: configMonitor[4].x,
    y: configMonitor[4].y,
    minWidth: configMonitor[4].min_width,
    minHeight: configMonitor[4].min_height,
    closable: true,
    autoHideMenuBar: true,
    fullscreen: configMonitor[4].fullscreen == 0 ? false : true,
    icon: path.join(__dirname, "resources/images/icon.png"),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
    },
    backgroundColor: '#000000',
  });

  // Configurar logging de erros
  setupWindowErrorLogging(fifthWindow, "FifthWindow");

  janelas.push(fifthWindow);

  if (!isDebug) {
    fifthWindow.removeMenu();
  }
  fifthWindow.loadFile(path.join(__dirname, "views", "tempo_ataque_2.html"));
  fifthWindow.on("closed", () => {
    fifthWindow = null;
  });
}
function updateSecondWindow(route) {
  secondWindow.loadFile(path.join(__dirname, "views", route));
}
function updateFirstWindow(route) {
  firstWindow.loadFile(path.join(__dirname, "views", route));
}

function updateThirdWindow(route) {
  thirdWindow.loadFile(path.join(__dirname, "views", route));
}

function updateFourthWindow(route) {
  fourthWindow.loadFile(path.join(__dirname, "views", "banner.html"));
}
function updateFifthWindow(route) {
  fifthWindow.loadFile(path.join(__dirname, "views", "tempo_ataque_2.html"));
}
ipcMain.on("tempoJogo", (event, data) => {
  if (secondWindow) {
    safeSend(secondWindow, "tempoJogo", data);
  }
});
ipcMain.on("getClickedButton", (event, data) => {
  if (secondWindow) {
    safeSend(secondWindow, "getClickedButton", data);
  }
  if (fourthWindow) {
    safeSend(fourthWindow, "getClickedButton", data);
  }
  // Atualizar banner web
  bannerServer.updateServe(data);
});
ipcMain.on("reload", (event, arg) => {
  if (firstWindow) {
    safeSend(firstWindow, "force-graceful-reload");
  }
  if (secondWindow) {
    safeSend(secondWindow, "force-graceful-reload");
  }
  if (thirdWindow) {
    safeSend(thirdWindow, "force-graceful-reload");
  }
  if (fourthWindow) {
    safeSend(fourthWindow, "force-graceful-reload");
  }
  if (fifthWindow) {
    safeSend(fifthWindow, "force-graceful-reload");
  }
  // Sincronizar com banner web
  syncBannerConfigToServer();
});
ipcMain.on("sendNovoSet", (event, arg) => {
  safeSend(secondWindow, "sendNovoSet", arg);
});
ipcMain.on("solicitarLicenca", async (event, data) => {
  const db = new sqlite.Database(getDbPath());
  let configSeria;
  try {
    rows_security = await new Promise((resolve, reject) => {
      db.all("SELECT * FROM config_serial", (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
    configSeria = rows_security[0];
  } catch (error) {
    console.error(error.message);
  }
  serial = configSeria.serial;
  const transporter = nodemailer.createTransport({
    service: "Gmail",
    auth: {
      user: "pcscoreboard26@gmail.com",
      pass: "bmuqemjdiaprjrmw",
    },
  });
  const mailOptions = {
    from: '"Scoreboard" <pcscoreboard@ideiasdeletra.com>',
    to: "pcscoreboard26@gmail.com",
    subject: "Scoreboard Voleibol - Solicitação de Licença",
    text: `Solicitação de licença:\n\nEmail do cliente: ${data.email}\nSerial: ${serial}\n\nData: ${new Date().toISOString()}`,
  };

  // Enviar o e-mail
  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error("Erro ao enviar o e-mail:", error);
    } else {
      console.log("E-mail enviado com sucesso:", info.response);
    }
  });
  safeSend(importWindow,
    "encaminhadoEmail",
    "Licença solicitada com sucesso!",
  );
});
ipcMain.on("selecionarArquivoLicenca", async (event) => {
  const result = await dialog.showOpenDialog(importWindow, {
    title: 'Selecione o arquivo de licença',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (!result.canceled && result.filePaths.length > 0) {
    const filePath = result.filePaths[0];
    try {
      const conteudo = fs.readFileSync(filePath, 'utf-8');
      event.reply('licencaSelecionada', { arquivo: filePath, conteudo: conteudo });
    } catch (e) {
      dialog.showErrorBox("Erro", "Não foi possível ler o arquivo de licença.");
    }
  }
});

ipcMain.on("importarLicenca", async (event, data) => {
  try {
    const filePath = data.arquivo;
    const conteudo = data.conteudo;
    console.log('[License] Importando licença de:', filePath);

    // Salvar caminho do arquivo em license_path.txt (igual ao Scoreboard-main)
    const savedPathFile = path.join(app.getPath('userData'), 'license_path.txt');
    if (filePath) {
      fs.writeFileSync(savedPathFile, filePath, 'utf-8');
      console.log('[License] Caminho salvo em license_path.txt:', filePath);
    }

    // Ler conteúdo
    let fileContent = conteudo;
    if (!fileContent) {
      if (!filePath || !fs.existsSync(filePath)) {
        safeSend(importWindow, 'atualizarLicenca-erro', 'Arquivo de licença não encontrado.');
        return;
      }
      fileContent = fs.readFileSync(filePath, 'utf-8');
    }

    // Parse JSON
    let json;
    try {
      json = JSON.parse(fileContent);
    } catch (e) {
      safeSend(importWindow, 'atualizarLicenca-erro', 'Arquivo de licença inválido (JSON mal formatado).');
      return;
    }

    const lic = Array.isArray(json) ? json[0] : json;

    if (!lic || !('serial' in lic)) {
      safeSend(importWindow, 'atualizarLicenca-erro', 'Licença inválida: campo serial em falta.');
      return;
    }

    // Usar numero_serial global (já obtido no início, sem nova chamada ao serialNumber)
    console.log('[License] Serial da licença:', lic.serial);
    console.log('[License] Serial do hardware:', numero_serial);

    if (numero_serial !== lic.serial) {
      safeSend(importWindow, 'atualizarLicenca-erro',
        'Licença não válida para este computador.\n\nSerial da licença: ' + lic.serial + '\nSerial deste PC: ' + numero_serial);
      return;
    }

    // Atualizar banco de dados
    const dbW = new sqlite.Database(getDbPath());
    await new Promise((resolve, reject) => {
      dbW.run('UPDATE config_serial SET serial = ?, senha = ? WHERE id = 1',
        [lic.serial, lic.password], function (e) {
          if (e) reject(e); else resolve();
        });
    });

    if (lic.data_expiration != null && lic.data_expiration !== undefined && lic.data_expiration !== '') {
      await new Promise((resolve) => {
        dbW.run('UPDATE config_serial SET data_expiration = ? WHERE id = 1',
          [lic.data_expiration], () => resolve());
      });
    } else {
      // Limpar data_expiration se a nova licença não tem
      await new Promise((resolve) => {
        dbW.run('UPDATE config_serial SET data_expiration = NULL WHERE id = 1', () => resolve());
      });
    }
    dbW.close();

    console.log('[License] Licença importada com sucesso. serial=', lic.serial, 'expires=', lic.data_expiration || 'nunca');
    safeSend(importWindow, 'atualizarLicenca', 'Licença importada com sucesso!');
  } catch (e) {
    console.error('[License] Erro ao importar licença:', e.message);
    safeSend(importWindow, 'atualizarLicenca-erro', 'Erro ao importar licença: ' + e.message);
  }
});

ipcMain.on("abrirTelas", async (event, data) => {
  console.log('[License] abrirTelas: Licença aceite, abrindo aplicação...');
  try {
    await createWindow();
  } catch (e) {
    console.error('Erro ao criar janela principal:', e);
    dialog.showErrorBox('Erro ao iniciar', e.message);
  }
});

// Função para sincronizar configurações com o banner streaming server
async function syncBannerConfigToServer() {
  const db = new sqlite.Database(getDbPath());

  try {
    // #region debug-point B:banner-sync-start
    __dbgEmit("B", "main.js:syncBannerConfigToServer", "banner sync start", {});
    // #endregion
    // Buscar logo do gestor
    const gestorConfig = await new Promise((resolve, reject) => {
      db.get("SELECT * FROM config_equipas_geral WHERE id = 1", (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    // Buscar times
    const time01 = await new Promise((resolve, reject) => {
      db.get("SELECT * FROM config_equipas_times WHERE id = 1", (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    const time02 = await new Promise((resolve, reject) => {
      db.get("SELECT * FROM config_equipas_times WHERE id = 2", (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    // Buscar cores
    const cores = await new Promise((resolve, reject) => {
      db.get("SELECT * FROM config_banner_color WHERE id = 1", (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    // Buscar configurações do jogo (para mostrar_ataque)
    const gameConfig = await new Promise((resolve, reject) => {
      db.get("SELECT * FROM config_jogo_setup WHERE id = 1", (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    // Função para converter caminhos para URLs web
    function toWebPath(dbPath) {
      if (!dbPath) return "";

      // Se já é uma URL web, retornar como está
      if (dbPath.startsWith("/")) return dbPath;

      // Converter barras invertidas para barras normais
      let webPath = dbPath.replace(/\\/g, "/");

      // Padrão antigo: ../resources/... -> /resources/...
      if (webPath.startsWith("../resources/")) {
        return webPath.replace("../resources/", "/resources/");
      }

      // Novo padrão: caminho absoluto com resources/assets/images/temp/...
      const resourcesAssetsMatch = webPath.match(/resources\/assets\/(.*)/);
      if (resourcesAssetsMatch) {
        return "/config-logos/" + resourcesAssetsMatch[1];
      }

      // Fallback: se contém images/temp/, extrair essa parte
      const imagesTempMatch = webPath.match(/images\/temp\/(.*)/);
      if (imagesTempMatch) {
        return "/config-logos/images/temp/" + imagesTempMatch[1];
      }

      // Se nada funcionou, retornar o caminho original
      return webPath;
    }

    // === Função para obter logo (BLOB > path) como scoreboard-main ===
    function getLogoUrl(config) {
      if (!config) return "";
      // Priorizar BLOB se disponível
      if (config.logo_data && config.logo_data.length > 0) {
        const base64 = Buffer.from(config.logo_data).toString("base64");
        writeLog("INFO", "[BannerSync] Usando logo BLOB como Base64");
        return `data:image/png;base64,${base64}`;
      }
      // Sem BLOB - usar caminho convertido
      return toWebPath(config.logo_caminho);
    }

    // Debug: Log das cores e logos
    writeLog("INFO", `[BannerSync] Time 1 Logo Raw: ${time01?.logo_caminho}`);
    writeLog("INFO", `[BannerSync] Time 2 Logo Raw: ${time02?.logo_caminho}`);
    writeLog(
      "INFO",
      `[BannerSync] Time 1 Logo BLOB: ${time01?.logo_data ? "presente (" + time01.logo_data.length + " bytes)" : "ausente"}`,
    );
    writeLog(
      "INFO",
      `[BannerSync] Time 2 Logo BLOB: ${time02?.logo_data ? "presente (" + time02.logo_data.length + " bytes)" : "ausente"}`,
    );
    writeLog(
      "INFO",
      `[BannerSync] Cores encontradas: gestor_fundo=${cores?.gestor_fundo_color}, visitada=${cores?.camisa_visitada_color}, visitante=${cores?.camisa_visitante_color}`,
    );

    // Enviar para o banner server com TODAS as cores (como scoreboard-main)
    bannerServer.updateFullConfig({
      gestorLogo: getLogoUrl(gestorConfig),
      gestorFundoColor: cores?.gestor_fundo_color || "",
      time01: {
        sigla: time01?.abreviatura || time01?.nome || "N/D",
        logo: getLogoUrl(time01),
      },
      time02: {
        sigla: time02?.abreviatura || time02?.nome || "N/D",
        logo: getLogoUrl(time02),
      },
      camisaVisitadaColor: cores?.camisa_visitada_color || "",
      camisaVisitanteColor: cores?.camisa_visitante_color || "",
      // === Cores do banner (config_banner_color) ===
      fundoColor: cores?.fundo_color || "",
      golosColor: cores?.golos_color || "",
      faltasColor: cores?.faltas_color || "",
      equipaNomeColor: cores?.equipa_nome_color || "",
      chromaKeyColor: cores?.chroma_key_color || "",
      golosBgColor: cores?.golos_bg_color || "",
      faltasBgColor: cores?.faltas_bg_color || "",
      mostrarAtaque: gameConfig?.mostrar_ataque,
    });

    // #region debug-point B:banner-sync-end
    __dbgEmit("B", "main.js:syncBannerConfigToServer", "banner sync end", {
      gestorLogoBytes: gestorConfig?.logo_data?.length || 0,
      time01LogoBytes: time01?.logo_data?.length || 0,
      time02LogoBytes: time02?.logo_data?.length || 0,
      gestorLogoPath: gestorConfig?.logo_caminho || "",
      time01LogoPath: time01?.logo_caminho || "",
      time02LogoPath: time02?.logo_caminho || "",
    });
    // #endregion

    console.log("[Banner Server Voleibol] Configurações sincronizadas");
  } catch (err) {
    console.error(
      "[Banner Server Voleibol] Erro ao sincronizar configurações:",
      err,
    );
  } finally {
    db.close();
  }
}

function updateSecondWindow(route) {
  if (secondWindow) {
    secondWindow.loadFile(path.join(__dirname, "views", route));
    // Re-send desconto painel state after placar loads
    if (route === 'placar.html') {
      secondWindow.webContents.once('did-finish-load', () => {
        if (descontoPainelState.equipe1 !== null) {
          safeSend(secondWindow, 'setDescontoPainel', descontoPainelState.equipe1);
        }
        if (descontoPainelState.equipe2 !== null) {
          safeSend(secondWindow, 'setDescontoPainel', descontoPainelState.equipe2);
        }
        if (atualizaDescontoState !== null) {
          safeSend(secondWindow, 'atualizaDesconto', atualizaDescontoState);
        }
      });
    }
  }
}

ipcMain.on("openSecondWindow", (event, data) => {
  if (!secondWindow) {
    createSecondWindow(data);
    // Re-send desconto painel state after placar loads
    if (data === 'placar.html') {
      secondWindow.webContents.once('did-finish-load', () => {
        if (descontoPainelState.equipe1 !== null) {
          safeSend(secondWindow, 'setDescontoPainel', descontoPainelState.equipe1);
        }
        if (descontoPainelState.equipe2 !== null) {
          safeSend(secondWindow, 'setDescontoPainel', descontoPainelState.equipe2);
        }
        if (atualizaDescontoState !== null) {
          safeSend(secondWindow, 'atualizaDesconto', atualizaDescontoState);
        }
      });
    }
  } else {
    updateSecondWindow(data);
  }
});

ipcMain.on("save-config-setup", (event, data) => {
  const db = new sqlite.Database(getDbPath());
  const sql = `UPDATE config_jogo_setup SET
    duracao_jogo_minutos = ?,
    duracao_jogo_segundos = ?,
    tempo_ataque = ?,
    desconto_tempo_minutos = ?,
    desconto_tempo_segundos = ?,
    aquecimento_jogo_minutos = ?,
    aquecimento_jogo_segundos = ?,
    tempo_final_minutos = ?,
    tempo_final_segundos = ?,
    tempo_final_minutos_int = ?,
    tempo_final_segundos_int = ?,
    intervalo_tempo_minutos = ?,
    intervalo_tempo_segundos = ?,
    tempo_jogo = ?,
    mostrar_ecran = ?,
    slide_tempo = ?,
    toque_buzinar_iniciar = ?,
    toque_buzinar_final = ?,
    tocar_ao_finalizar_desconto = ?,
    mostrar_ataque = ?,
    tocar_ao_finalizar_ataque = ?,
    partes_jogo = ?
    WHERE id = 1`;

  const params = [
    data.duracao_jogo_minutos,
    data.duracao_jogo_segundos,
    data.tempo_ataque,
    data.desconto_tempo_minutos,
    data.desconto_tempo_segundos,
    data.aquecimento_jogo_minutos,
    data.aquecimento_jogo_segundos,
    data.tempo_final_minutos,
    data.tempo_final_segundos,
    data.tempo_final_minutos_int,
    data.tempo_final_segundos_int,
    data.intervalo_tempo_minutos,
    data.intervalo_tempo_segundos,
    data.tempo_jogo,
    data.mostrar_ecran,
    data.slide_tempo,
    data.toque_buzinar_iniciar,
    data.toque_buzinar_final,
    data.tocar_ao_finalizar_desconto,
    data.mostrar_ataque,
    data.tocar_ao_finalizar_ataque,
    data.partes_jogo || 1,
  ];

  db.run(sql, params, function (err) {
    if (err) {
      console.error(err.message);
      event.reply("save-config-setup-error", err.message);
    } else {
      event.reply("save-config-setup-success");
      // Sincronizar com banner web
      syncBannerConfigToServer();
    }
    db.close();
  });
});

// Banner Web IPCs - Handlers movidos para o final do arquivo com suporte a Serveo (SSH)

ipcMain.on("copyToClipboard", (event, text) => {
  clipboard.writeText(text);
});

ipcMain.on("getDisplays", (event, data) => {
  safeSend(configWindow, "getDisplays_", screen.getAllDisplays());
});

ipcMain.on("alterarPontuacaoPlacar", (event, arg) => {
  if (secondWindow) {
    safeSend(secondWindow, "updatesFromControl", arg);
  } // sends the stuff from Window1 to Window2.
  if (thirdWindow) {
    safeSend(thirdWindow, "updatesFromControl", arg); // sends the stuff from Window1 to Window2.
  }
  if (fourthWindow) {
    safeSend(fourthWindow, "updatesFromControl", arg);
  }
  if (fifthWindow) {
    safeSend(fifthWindow, "updatesFromControl", arg);
  }
  // Atualizar banner web
  // #region debug-point C:banner-updatePontuacao
  __dbgEmit("C", "main.js:alterarPontuacaoPlacar", "bannerServer.updatePontuacao", {
    inputOrigin: arg?.inputOrigin,
    pontuacaoFormatada: typeof arg?.pontuacaoFormatada === "string" ? arg.pontuacaoFormatada.slice(0, 50) : arg?.pontuacaoFormatada,
  });
  // #endregion
  bannerServer.updatePontuacao(arg);
});

let atualizaDescontoState = null;

ipcMain.on("atualizarDesconto", (event, data) => {
  atualizaDescontoState = data;
  safeSend(secondWindow, "atualizaDesconto", data);
});

ipcMain.on("alterarPosicao", (event, data) => {
  console.log(data);
  safeSend(secondWindow, "alterarPosicao", data);
});

ipcMain.on("exportar-equipe-1", async (event, data) => {
  var equipe_time_1 = [];
  db = new sqlite.Database(getDbPath());
  try {
    rows = await new Promise((resolve, reject) => {
      db.all("SELECT * FROM config_equipas_times where id = 1", (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
    equipe_time_1 = rows;
    rows_jogadores = await new Promise((resolve, reject) => {
      db.all(
        "SELECT * FROM config_equipas_times_jogadores where time_id = 1 ORDER BY COALESCE(list, id)",
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        },
      );
    });
    equipe_time_1_jogadores = rows_jogadores;
  } catch (error) {
    console.error(error.message);
  } finally {
    db.close();
  }
  var json_jogadores = [];
  equipe_time_1_jogadores.forEach((element) => {
    var dt = {
      foto_caminho: element.foto_caminho,
      nome: element.nome,
      camisa: element.camisa,
      posicao: element.posicao,
      list: element.list,
    };
    // Incluir foto como Base64 se BLOB disponível
    if (element.foto_data) {
      dt.foto_base64 = Buffer.from(element.foto_data).toString("base64");
    }
    json_jogadores.push(dt);
  });
  var data_json = [
    {
      logo_caminho: equipe_time_1[0].logo_caminho,
      logo_base64: equipe_time_1[0].logo_data
        ? Buffer.from(equipe_time_1[0].logo_data).toString("base64")
        : null,
      nome: equipe_time_1[0].nome,
      abreviatura: equipe_time_1[0].abreviatura,
      jogadores: json_jogadores,
    },
  ];
  data_json = JSON.stringify(data_json);
  const filePath = path.join(
    app.getPath("temp"),
    `equipe_${equipe_time_1[0].nome}.json`,
  );
  fs.writeFileSync(filePath, data_json);

  // Iniciar o download do arquivo
  event.sender.downloadURL("file://" + filePath);
});
ipcMain.on("exportar-t1", async (event, data) => {
  var tabela1 = [];
  db = new sqlite.Database(getDbPath());
  try {
    rows = await new Promise((resolve, reject) => {
      db.all(
        "SELECT * FROM config_video_foto where tabela_id = 1 order by id",
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        },
      );
    });
    tabela1 = rows;
    tabela1.map(function (item, index) {
      delete item.id;
      // Converter BLOB para Base64 para exportação
      if (item.arquivo_data) {
        item.arquivo_data = Buffer.from(item.arquivo_data).toString("base64");
      }
      return item;
    });
  } catch (error) {
    console.error(error.message);
  } finally {
    db.close();
  }
  data_json = JSON.stringify(tabela1);
  const filePath = path.join(app.getPath("temp"), `inicio_jogo.json`);
  fs.writeFileSync(filePath, data_json);
  configWindow.webContents.downloadURL("file://" + filePath);
});
ipcMain.on("exportar-t2", async (event, data) => {
  var tabela1 = [];
  db = new sqlite.Database(getDbPath());
  try {
    rows = await new Promise((resolve, reject) => {
      db.all(
        "SELECT * FROM config_video_foto where tabela_id = 2 order by id",
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        },
      );
    });
    tabela1 = rows;
    tabela1.map(function (item, index) {
      delete item.id;
      // Converter BLOB para Base64 para exportação
      if (item.arquivo_data) {
        item.arquivo_data = Buffer.from(item.arquivo_data).toString("base64");
      }
      return item;
    });
  } catch (error) {
    console.error(error.message);
  } finally {
    db.close();
  }
  data_json = JSON.stringify(tabela1);
  const filePath = path.join(app.getPath("temp"), `desconto.json`);
  fs.writeFileSync(filePath, data_json);
  configWindow.webContents.downloadURL("file://" + filePath);
});
ipcMain.on("exportar-t3", async (event, data) => {
  var tabela1 = [];
  db = new sqlite.Database(getDbPath());
  try {
    rows = await new Promise((resolve, reject) => {
      db.all(
        "SELECT * FROM config_video_foto where tabela_id = 3 order by id",
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        },
      );
    });
    tabela1 = rows;
    tabela1.map(function (item, index) {
      delete item.id;
      // Converter BLOB para Base64 para exportação
      if (item.arquivo_data) {
        item.arquivo_data = Buffer.from(item.arquivo_data).toString("base64");
      }
      return item;
    });
  } catch (error) {
    console.error(error.message);
  } finally {
    db.close();
  }
  data_json = JSON.stringify(tabela1);
  const filePath = path.join(app.getPath("temp"), `intervalo.json`);
  fs.writeFileSync(filePath, data_json);
  configWindow.webContents.downloadURL("file://" + filePath);
});
ipcMain.on("validPassword", async (event, arg) => {
  if (arg === "Scoreboard@2310") {
    safeSend(configWindow, "validPassword", true);
  } else {
    safeSend(configWindow, "validPassword", false);
  }
});
ipcMain.on("exportar-equipe-2", async (event, data) => {
  var equipe_time_2 = [];
  db = new sqlite.Database(getDbPath());
  try {
    rows = await new Promise((resolve, reject) => {
      db.all("SELECT * FROM config_equipas_times where id = 2", (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
    equipe_time_2 = rows;
    rows_jogadores = await new Promise((resolve, reject) => {
      db.all(
        "SELECT * FROM config_equipas_times_jogadores where time_id = 2 ORDER BY COALESCE(list, id)",
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        },
      );
    });
    equipe_time_2_jogadores = rows_jogadores;
  } catch (error) {
    console.error(error.message);
  } finally {
    db.close();
  }
  var json_jogadores = [];
  equipe_time_2_jogadores.forEach((element) => {
    var dt = {
      foto_caminho: element.foto_caminho,
      nome: element.nome,
      camisa: element.camisa,
      posicao: element.posicao,
      list: element.list,
    };
    if (element.foto_data) {
      dt.foto_base64 = Buffer.from(element.foto_data).toString("base64");
    }
    json_jogadores.push(dt);
  });
  var data_json = [
    {
      logo_caminho: equipe_time_2[0].logo_caminho,
      logo_base64: equipe_time_2[0].logo_data
        ? Buffer.from(equipe_time_2[0].logo_data).toString("base64")
        : null,
      nome: equipe_time_2[0].nome,
      abreviatura: equipe_time_2[0].abreviatura,
      jogadores: json_jogadores,
    },
  ];
  data_json = JSON.stringify(data_json);
  const filePath = path.join(
    app.getPath("temp"),
    `equipe_${equipe_time_2[0].nome}.json`,
  );
  fs.writeFileSync(filePath, data_json);
  configWindow.webContents.downloadURL("file://" + filePath);
});
ipcMain.on("atualizacaoTelas", async (event, data) => {
  db = new sqlite.Database(getDbPath());
  try {
    rows = await new Promise((resolve, reject) => {
      db.all("SELECT * FROM config_monitor", (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
    configMonitor = rows;
  } catch (error) {
    console.error(error.message);
  } finally {
    db.close();
  }
  console.log(configMonitor);

  if (firstWindow) {
    firstWindow.setFullScreen(configMonitor[1].fullscreen);
    firstWindow.setBounds({
      x: configMonitor[1].x,
      y: configMonitor[1].y,
      width: configMonitor[1].width,
      height: configMonitor[1].height,
    });
  }
  if (configMonitor[0].show_monitor == 0) {
    if (secondWindow) {
      secondWindow.close();
      secondWindow = null;
    }
  } else {
    if (secondWindow) {
      secondWindow.setFullScreen(configMonitor[0].fullscreen);
      secondWindow.setBounds({
        x: configMonitor[0].x,
        y: configMonitor[0].y,
        width: configMonitor[0].width,
        height: configMonitor[0].height,
      });
    }
    if (!secondWindow) createSecondWindow("placar.html");
  }

  if (configMonitor[2].show_monitor == 0) {
    if (thirdWindow) {
      thirdWindow.close();
      thirdWindow = null;
    }
  } else {
    if (thirdWindow) {
      thirdWindow.setFullScreen(configMonitor[2].fullscreen);
      thirdWindow.setBounds({
        x: configMonitor[2].x,
        y: configMonitor[2].y,
        width: configMonitor[2].width,
        height: configMonitor[2].height,
      });
    }
    if (!thirdWindow) {
      createThirdWindow("tempo_ataque.html");
    }
  }

  if (configMonitor[3].show_monitor == 0) {
    if (fourthWindow) {
      fourthWindow.close();
      fourthWindow = null;
    }
  } else {
    if (fourthWindow) {
      console.log(fourthWindow);
      fourthWindow.setFullScreen(configMonitor[3].fullscreen);
      fourthWindow.setBounds({
        x: configMonitor[3].x,
        y: configMonitor[3].y,
        width: configMonitor[3].width,
        height: configMonitor[3].height,
      });
    }
    if (!fourthWindow) createFourthWindow();
  }
  if (configMonitor[4].show_monitor == 0) {
    if (fifthWindow) {
      fifthWindow.close();
      fifthWindow = null;
    }
  } else {
    if (fifthWindow) {
      console.log(fourthWindow);
      fifthWindow.setFullScreen(configMonitor[4].fullscreen);
      fifthWindow.setBounds({
        x: configMonitor[4].x,
        y: configMonitor[4].y,
        width: configMonitor[4].width,
        height: configMonitor[4].height,
      });
    }
    if (!fifthWindow) createFifthWindow();
  }
});
ipcMain.on("alterarCronometro", (event, arg) => {
  safeSend(secondWindow, "updateCronometro", arg); // sends the stuff from Window1 to Window2.
  safeSend(thirdWindow, "updateCronometro", arg);
  safeSend(fourthWindow, "updateCronometro", arg);
  safeSend(fifthWindow, "updateCronometro", arg);
  // Atualizar banner web
  bannerServer.updateCronometro(arg);
});

ipcMain.on("sendCronometroFixed", (event, arg) => {
  safeSend(secondWindow, "listingCronometro", arg);
});

ipcMain.on("sendCronometroAquecimento", (event, arg) => {
  safeSend(firstWindow, "updateAquecimento", arg);
});

ipcMain.on("sendCronometroDesconto", (event, arg) => {
  safeSend(firstWindow, "updateDesconto", arg);
});

ipcMain.on("sendCronometroIntervalo", (event, arg) => {
  safeSend(firstWindow, "updateIntervalo", arg);
});

ipcMain.on("solicitaAtualizacoes", (event, arg) => {
  safeSend(firstWindow, "getInformacoesPartida", arg);
});

ipcMain.on("sendInformacoesPartida", (event, arg) => {
  safeSend(secondWindow, "loadInformacoesPartida", arg);
});

ipcMain.on("sendNovaExclusao", (event, arg) => {
  safeSend(secondWindow, "addNovaExclusao", arg);
  // Atualizar banner web com exclusões
  bannerServer.updateExclusao(arg);
});

// Store desconto painel state so it can be re-sent when placar reloads
let descontoPainelState = { equipe1: null, equipe2: null };

ipcMain.on("sendDescontoPainel", (event, arg) => {
  // Store the state
  if (arg.origem === 'btn-desconto-equipe1') {
    descontoPainelState.equipe1 = arg;
  } else {
    descontoPainelState.equipe2 = arg;
  }
  safeSend(secondWindow, "setDescontoPainel", arg);
  safeSend(firstWindow, "setDescontoPainel", arg);
});

ipcMain.handle("get-user-assets-path", () => {
  return getUserAssetsPath();
});

ipcMain.on("salvarArquivo", async (event, arg) => {
  const filePath = arg["path"];
  const fileExtension = path.extname(filePath);
  // Usar getUserAssetsPath() para consistência em dev e produção
  const assetsBasePath = getUserAssetsPath();
  const newFilePath = path.join(
    assetsBasePath,
    arg["newPath"],
    `${arg["imagePrefixo"]}`,
  );

  // Criar diretório se não existir
  const dir = path.dirname(newFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.copy(filePath, newFilePath, (err) => {
    if (err) {
      console.log("Erro ao salvar arquivo em:", newFilePath);
      console.log(err);
      return;
    }
    console.log("Arquivo copiado com sucesso");
    console.log(newFilePath);
  });
});

ipcMain.on("verificarArquivo", async (event, arg) => {
  const filePath = arg["path"];
  const fileExtension = path.extname(filePath);
  // Usar getUserAssetsPath() para consistência em dev e produção
  const assetsBasePath = getUserAssetsPath();
  const newFilePath = path.join(
    assetsBasePath,
    arg["newPath"],
    `${arg["imagePrefixo"]}${fileExtension}`,
  );
  console.log("Verificando arquivo em:", newFilePath);
  var data = "ok";
  if (fs.existsSync(newFilePath)) {
    data = "existe";
  }
  console.log(data);
  safeSend(configWindow, "arquivoVerificado", data);
});

ipcMain.on("excluirArquivo", async (event, arg) => {
  // console.log('teste:' + arg);
  // arg.replace('../resources/', '');
  // const newFilePath = path.join(__dirname, 'resources', arg);
  // const newFilePath = arg;
  // if (fs.existsSync(newFilePath)) {
  //   fs.removeSync(newFilePath);
  //   console.log(`O arquivo ${newFilePath} foi apagado com sucesso!`);
  // }
});

ipcMain.on("novaPartida", (event, arg) => {
  if (secondWindow) {
    updateSecondWindow("placar.html");
  }
  if (thirdWindow) {
    updateThirdWindow("tempo_ataque.html");
  }
  if (fourthWindow) {
    updateFourthWindow();
  }
  if (fifthWindow) {
    updateFifthWindow();
  }
});

ipcMain.on("closeApp", (event, arg) => {
  app.quit();
});

// Music Player - Seleção de pasta de músicas
ipcMain.on("select-music-folder", async (event) => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: "Selecione a pasta de músicas",
  });
  if (!result.canceled && result.filePaths.length > 0) {
    const folderPath = result.filePaths[0];
    try {
        const dbPath = getDbPath();
        const dbM = new sqlite.Database(dbPath);
        await new Promise((resolve) => {
            dbM.run('UPDATE config_jogo_setup SET music_folder = ? WHERE id = 1', [folderPath], () => {
                dbM.close();
                resolve();
            });
        });
    } catch(e) {}
    event.sender.send("music-folder-selected", folderPath);
    // Carregar arquivos automaticamente
    loadMusicFilesFromFolder(event.sender, folderPath);
  }
});

// Music Player - Carregar arquivos de música de uma pasta
ipcMain.on("load-music-files", (event, folderPath) => {
  loadMusicFilesFromFolder(event.sender, folderPath);
});

function loadMusicFilesFromFolder(sender, folderPath) {
  try {
    const files = fs.readdirSync(folderPath);
    const audioExtensions = [".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac"];
    const musicFiles = files
      .filter((file) =>
        audioExtensions.includes(path.extname(file).toLowerCase()),
      )
      .map((file) => path.join(folderPath, file));
    sender.send("music-files-loaded", musicFiles);
    console.log(`🎵 ${musicFiles.length} músicas carregadas de ${folderPath}`);
  } catch (err) {
    console.error("Erro ao carregar músicas:", err);
    sender.send("music-files-loaded", []);
  }
}

// ====== Video Player - Seleção de pasta de vídeos ======
ipcMain.on("select-video-folder", async (event) => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: "Selecione a pasta de vídeos",
  });
  if (!result.canceled && result.filePaths.length > 0) {
    const folderPath = result.filePaths[0];
    try {
        const dbPath = getDbPath();
        const dbV = new sqlite.Database(dbPath);
        await new Promise((resolve) => {
            dbV.run('UPDATE config_jogo_setup SET video_folder = ? WHERE id = 1', [folderPath], () => {
                dbV.close();
                resolve();
            });
        });
    } catch(e) {}
    event.sender.send("video-folder-selected", folderPath);
    // Carregar arquivos automaticamente
    try {
      const files = fs.readdirSync(folderPath);
      const videoExtensions = [".mp4", ".webm", ".avi", ".mkv", ".mov", ".wmv"];
      const videoFiles = files
        .filter((file) =>
          videoExtensions.includes(path.extname(file).toLowerCase()),
        )
        .map((file) => path.join(folderPath, file));
      event.sender.send("video-files-loaded", videoFiles);
      console.log(`🎬 ${videoFiles.length} vídeos carregados de ${folderPath}`);
    } catch (err) {
      console.error("Erro ao carregar vídeos:", err);
      event.sender.send("video-files-loaded", []);
    }
  }
});

ipcMain.on('load-video-files', (event, folderPath) => {
    try {
        if (fs.existsSync(folderPath)) {
            const files = fs.readdirSync(folderPath);
            const videoExtensions = [".mp4", ".webm", ".avi", ".mkv", ".mov", ".wmv"];
            const videoFiles = files
                .filter((file) => videoExtensions.includes(path.extname(file).toLowerCase()))
                .map((file) => path.join(folderPath, file));
            event.sender.send("video-files-loaded", videoFiles);
        } else {
            event.sender.send("video-files-loaded", []);
        }
    } catch (err) {
        console.error("Erro ao carregar vídeos:", err);
        event.sender.send("video-files-loaded", []);
    }
});

ipcMain.handle('get-saved-folders', async () => {
    const dbPath = getDbPath();
    const dbF = new sqlite.Database(dbPath);
    try {
        return await new Promise((resolve) => {
            dbF.get('SELECT music_folder, video_folder FROM config_jogo_setup WHERE id = 1', (err, row) => {
                dbF.close();
                if (err) resolve({ music_folder: '', video_folder: '' });
                else resolve(row || { music_folder: '', video_folder: '' });
            });
        });
    } catch (e) {
        return { music_folder: '', video_folder: '' };
    }
});

// Video Player - Exibir vídeo no placar (secondWindow)
ipcMain.on("play-video-placar", (event, filePath) => {
  if (secondWindow) {
    safeSend(secondWindow, "play-video-placar", filePath);
  }
});

// Video Player - Parar vídeo no placar
ipcMain.on("stop-video-placar", (event) => {
  if (secondWindow) {
    safeSend(secondWindow, "stop-video-placar");
  }
});

// Video Player - Ajustar volume no placar
ipcMain.on("set-video-volume", (event, value) => {
  if (secondWindow) {
    safeSend(secondWindow, "set-video-volume", value);
  }
});

// Video Player - Atualizar progresso no placar
ipcMain.on("video-progress-update", (event, progress) => {
  if (firstWindow) {
    safeSend(firstWindow, "video-progress-update", progress);
  }
});

// Video Player - Definir progresso do placar
ipcMain.on("set-video-progress", (event, progress) => {
  if (secondWindow) {
    safeSend(secondWindow, "set-video-progress", progress);
  }
});

// Video Player - Pausar/Retomar vídeo no placar
ipcMain.on("pause-video-placar", (event) => {
  if (secondWindow) {
    safeSend(secondWindow, "pause-video-placar");
  }
});

// ====== Controles de Apresentação de Jogadores ======
// Recebe status da apresentação e retransmite para o painel
ipcMain.on("presentation-status", (event, status) => {
  if (firstWindow && firstWindow.webContents) {
    safeSend(firstWindow, "presentation-status-update", status);
  }
});

// Controles do painel para a apresentação
// ============================================
// CONTROLES DE APRESENTAÇÃO (Bouncer)
// ============================================
// Comandos: Control Panel (index.html) -> Presentation Windows
ipcMain.on("presentation-control-pause", (event) => {
  if (secondWindow && !secondWindow.isDestroyed())
    safeSend(secondWindow, "presentation-control-pause");
  if (thirdWindow && !thirdWindow.isDestroyed())
    safeSend(thirdWindow, "presentation-control-pause");
  if (fourthWindow && !fourthWindow.isDestroyed())
    safeSend(fourthWindow, "presentation-control-pause");
  if (fifthWindow && !fifthWindow.isDestroyed())
    safeSend(fifthWindow, "presentation-control-pause");
});

ipcMain.on("presentation-control-next", (event) => {
  if (secondWindow && !secondWindow.isDestroyed())
    safeSend(secondWindow, "presentation-control-next");
  if (thirdWindow && !thirdWindow.isDestroyed())
    safeSend(thirdWindow, "presentation-control-next");
  if (fourthWindow && !fourthWindow.isDestroyed())
    safeSend(fourthWindow, "presentation-control-next");
  if (fifthWindow && !fifthWindow.isDestroyed())
    safeSend(fifthWindow, "presentation-control-next");
});

ipcMain.on("presentation-control-prev", (event) => {
  if (secondWindow && !secondWindow.isDestroyed())
    safeSend(secondWindow, "presentation-control-prev");
  if (thirdWindow && !thirdWindow.isDestroyed())
    safeSend(thirdWindow, "presentation-control-prev");
  if (fourthWindow && !fourthWindow.isDestroyed())
    safeSend(fourthWindow, "presentation-control-prev");
  if (fifthWindow && !fifthWindow.isDestroyed())
    safeSend(fifthWindow, "presentation-control-prev");
});

// Solicitacao de status (Handshake inicial)
ipcMain.on("presentation-get-status", (event) => {
  // Envia solicitacao para todas as janelas de apresentacao
  // Elas irao responder com presentation-status-update se estiverem ativas
  if (secondWindow && !secondWindow.isDestroyed())
    safeSend(secondWindow, "presentation-get-status");
  if (thirdWindow && !thirdWindow.isDestroyed())
    safeSend(thirdWindow, "presentation-get-status");
  if (fourthWindow && !fourthWindow.isDestroyed())
    safeSend(fourthWindow, "presentation-get-status");
  if (fifthWindow && !fifthWindow.isDestroyed())
    safeSend(fifthWindow, "presentation-get-status");
});

// Status: Presentation Windows -> Control Panel (index.html)
ipcMain.on("presentation-status-update", (event, status) => {
  if (firstWindow && !firstWindow.isDestroyed()) {
    safeSend(firstWindow, "presentation-status-update", status);
  }
});

// Toggle Banner Web Server em tempo real
// Função auxiliar para iniciar o túnel Serveo
function startServeoTunnel(sender = null) {
  console.log(">>> startServeoTunnel() CHAMADA <<<");
  if (activeTunnel) {
    console.log("Servidor Serveo já está rodando ou iniciando.");
    writeLog("INFO", "Servidor Serveo já está rodando ou iniciando.");
    if (activeTunnel.publicUrl) {
      if (sender && !sender.isDestroyed())
        sender.send("updateBannerUrl", activeTunnel.publicUrl + "/banner2");
      if (configWindow && !configWindow.isDestroyed())
        safeSend(configWindow,
          "updateBannerUrl",
          activeTunnel.publicUrl + "/banner2",
        );
    }
    return;
  }

  console.log("🌐 Iniciando Serveo Tunnel (SSH)...");
  writeLog("INFO", "🌐 Iniciando Serveo Tunnel (SSH)...");

  console.log(
    "[SSH] Comando: ssh -o StrictHostKeyChecking=no -R 80:127.0.0.1:3000 serveo.net",
  );
  activeTunnel = spawn("ssh", [
    "-o",
    "StrictHostKeyChecking=no",
    "-R",
    "80:127.0.0.1:3000",
    "serveo.net",
  ]);

  console.log(`[SSH] Processo iniciado com PID: ${activeTunnel.pid || "N/A"}`);
  writeLog(
    "INFO",
    `[SSH] Processo iniciado com PID: ${activeTunnel.pid || "N/A"}`,
  );
  let urlFound = false;

  activeTunnel.stdout.on("data", (data) => {
    const output = data.toString();
    console.log(`[SSH stdout]: ${output.trim()}`);
    writeLog("INFO", `[SSH stdout]: ${output.trim()}`);
    const match = output.match(/https:\/\/[^\s]+/);
    if (match && !urlFound) {
      urlFound = true;
      activeTunnel.publicUrl = match[0];
      console.log(`🌐 URL Pública encontrada: ${activeTunnel.publicUrl}`);
      writeLog("INFO", `🌐 URL Pública encontrada: ${activeTunnel.publicUrl}`);
      const finalUrl = activeTunnel.publicUrl + "/banner2";

      try {
        if (sender && !sender.isDestroyed())
          sender.send("updateBannerUrl", finalUrl);
      } catch (e) { }
      if (configWindow && !configWindow.isDestroyed())
        safeSend(configWindow, "updateBannerUrl", finalUrl);
    }
  });

  activeTunnel.stderr.on("data", (data) => {
    const output = data.toString();
    console.log(`[SSH stderr]: ${output.trim()}`);
    writeLog("INFO", `[SSH stderr]: ${output.trim()}`);
    const match = output.match(/https:\/\/[^\s]+/);
    if (match && !urlFound) {
      urlFound = true;
      activeTunnel.publicUrl = match[0];
      console.log(`🌐 URL Pública (stderr): ${activeTunnel.publicUrl}`);
      writeLog("INFO", `🌐 URL Pública (stderr): ${activeTunnel.publicUrl}`);
      const finalUrl = activeTunnel.publicUrl + "/banner2";

      try {
        if (sender && !sender.isDestroyed())
          sender.send("updateBannerUrl", finalUrl);
      } catch (e) { }
      if (configWindow && !configWindow.isDestroyed())
        safeSend(configWindow, "updateBannerUrl", finalUrl);
    }
  });

  activeTunnel.on("close", (code) => {
    console.log(`🌐 Tunnel SSH fechado (code ${code})`);
    writeLog("INFO", `🌐 Tunnel SSH fechado (code ${code})`);
    activeTunnel = null;
  });

  activeTunnel.on("error", (err) => {
    console.error(`[SSH ERROR] Falha ao iniciar tunnel: ${err.message}`);
    console.error(
      "[SSH ERROR] Verifique se o OpenSSH está instalado no Windows.",
    );
    console.error(
      "[SSH ERROR] Para instalar: Configurações > Aplicativos > Recursos opcionais > OpenSSH Client",
    );
    writeLog("ERROR", `[SSH ERROR] Falha ao iniciar tunnel: ${err.message}`);
    writeLog(
      "ERROR",
      "[SSH ERROR] Verifique se o OpenSSH está instalado no Windows.",
    );
    activeTunnel = null;
    try {
      if (sender && !sender.isDestroyed())
        sender.send("updateBannerUrl", "Erro: SSH não disponível");
    } catch (e) { }
  });
}

// Função auxiliar para parar o túnel
function stopServeoTunnel(sender = null) {
  if (activeTunnel) {
    activeTunnel.kill();
    activeTunnel = null;
  }
  console.log("🛑 Serveo Tunnel parado.");
  writeLog("INFO", "🛑 Serveo Tunnel parado.");
  const localUrl = "http://localhost:3000/banner2";
  try {
    if (sender && !sender.isDestroyed())
      sender.send("updateBannerUrl", localUrl);
  } catch (e) { }
  if (configWindow && !configWindow.isDestroyed())
    safeSend(configWindow, "updateBannerUrl", localUrl);
}

// Toggle Banner Web Server em tempo real
ipcMain.on("toggleBannerWeb", async (event, enabled) => {
  console.log("=".repeat(60));
  console.log("🔄 [toggleBannerWeb] CHAMADO - enabled:", enabled);
  console.log("=".repeat(60));
  writeLog(
    "INFO",
    `🔄 Toggle Banner Web: ${enabled ? "Ativando" : "Desativando"}`,
  );

  // Atualizar no banco de dados
  const bannerDbPath = getDbPath();
  console.log("[Main] Atualizando banner em:", bannerDbPath);
  const db = new sqlite.Database(bannerDbPath);

  db.run(
    `UPDATE config_jogo_setup SET banner_web_enabled = ${enabled ? 1 : 0} WHERE id = 1`,
    (err) => {
      if (err) {
        console.error("Erro ao atualizar banner_web_enabled no DB:", err);
        writeLog(
          "ERROR",
          `Erro ao atualizar banner_web_enabled no DB: ${err.message}`,
        );
      } else {
        console.log(
          "✅ banner_web_enabled atualizado no banco de dados para:",
          enabled,
        );
        writeLog(
          "INFO",
          `✅ banner_web_enabled atualizado no banco de dados para: ${enabled}`,
        );
      }
      db.close();
    },
  );

  if (enabled) {
    console.log("🚀 Iniciando Banner Web e Serveo Tunnel...");
    try {
      // Definir caminho base da aplicação (para resolver arquivos estáticos)
      const appPath = app.getAppPath();
      const execDir = path.dirname(process.execPath);
      const appBasePath = app.isPackaged ? execDir : __dirname;
      const assetsPath = getUserAssetsPath();

      writeLog("INFO", `[Banner] app.isPackaged: ${app.isPackaged}`);
      writeLog("INFO", `[Banner] appBasePath escolhido: ${appBasePath}`);
      writeLog("INFO", `[Banner] assetsPath: ${assetsPath}`);

      bannerServer.setAppBasePath(appBasePath);
      bannerServer.setAssetsPath(assetsPath);

      // Garantir que o server express está rodando
      await bannerServer.startServer(3000);
      console.log("✅ Banner Server iniciado");
      writeLog("INFO", "🌐 Banner streaming server iniciado na porta 3000");

      // Iniciar Túnel
      console.log("🚀 Chamando startServeoTunnel()...");
      startServeoTunnel(event.sender);

      // Sincronizar configurações
      syncBannerConfigToServer();

      // Self-test: verificar se o server está acessível localmente
      const http = require("http");
      writeLog("INFO", "🔍 Executando auto-teste de conexão local (IPv4)...");
      http
        .get("http://127.0.0.1:3000/debug", (res) => {
          writeLog(
            "INFO",
            `✅ Auto-teste de conexão: SUCESSO! Status Code: ${res.statusCode}`,
          );
        })
        .on("error", (e) => {
          writeLog(
            "ERROR",
            `❌ Auto-teste de conexão: FALHA! Erro: ${e.message}`,
          );
          writeLog(
            "ERROR",
            "⚠️  Isto indica que algo está bloqueando conexões locais na porta 3000 (Firewall/Antivírus?)",
          );
        });
    } catch (err) {
      console.error("❌ Erro ao iniciar banner server/tunnel:", err);
      writeLog("ERROR", `Erro ao iniciar banner server/tunnel: ${err.message}`);
    }
  } else {
    console.log("🛑 Desativando Banner Web...");
    try {
      // Parar o túnel SSH
      stopServeoTunnel(event.sender);
      // Parar o servidor Express
      await bannerServer.stopServer();
      console.log("🛑 Banner streaming server parado.");
    } catch (err) {
      console.error("Erro ao parar banner web:", err);
      writeLog("ERROR", `Erro ao parar banner web: ${err.message}`);
    }
    console.log("ℹ️  Banner Web desabilitado");
    writeLog("INFO", "ℹ️  Banner Web desabilitado");
  }
  console.log("=".repeat(60));
});

// Obter status do Banner Web
ipcMain.handle("getBannerWebStatus", async (event) => {
  const dbPath = getDbPath();
  console.log("[Main] Lendo status do banner de:", dbPath);
  const db = new sqlite.Database(dbPath);

  return new Promise((resolve, reject) => {
    db.get(
      "SELECT banner_web_enabled, email_destinatario FROM config_jogo_setup WHERE id = 1",
      (err, row) => {
        db.close();
        if (err) {
          console.error("Erro ao ler banner_web_enabled:", err);
          resolve({ enabled: false, url: null, email: '' });
        } else {
          const status = row && row.banner_web_enabled == 1;
          const userEmail = row && row.email_destinatario ? row.email_destinatario : '';
          const currentUrl = status && activeTunnel && activeTunnel.publicUrl ? activeTunnel.publicUrl + "/banner2" : null;

          if (status && activeTunnel && activeTunnel.publicUrl) {
            event.sender.send(
              "updateBannerUrl",
              currentUrl,
            );
          }
          resolve({ enabled: status, url: currentUrl, email: userEmail });
        }
      },
    );
  });
});

// -- Save Email Destinatário --
ipcMain.handle('saveEmailDestinatario', async (event, email) => {
  try {
    const dbPath = getDbPath();
    const db = new sqlite.Database(dbPath);
    await new Promise((resolve, reject) => {
      db.run('UPDATE config_jogo_setup SET email_destinatario = ? WHERE id = 1', [email || ''], (err) => {
        db.close();
        if (err) reject(err);
        else resolve();
      });
    });
    return { success: true };
  } catch (e) {
    console.error('saveEmailDestinatario error: ' + e.message);
    return { success: false, error: e.message };
  }
});

// -- Silent Email --
ipcMain.on('emailBannerUrl', async (event, url) => {
  console.log('IPC: emailBannerUrl -> ' + url);
  try {
    // Ler email do destinatário do banco de dados
    let emailDestinatario = '';
    const dbPath = getDbPath();
    const db = new sqlite.Database(dbPath);
    try {
      const row = await new Promise((resolve, reject) => {
        db.get('SELECT email_destinatario FROM config_jogo_setup WHERE id = 1', (err, r) => {
          if (err) reject(err);
          else resolve(r);
        });
      });
      if (row && row.email_destinatario) emailDestinatario = row.email_destinatario;
    } catch (e) {
      console.log('Erro ao ler email_destinatario: ' + e.message);
    } finally {
      db.close();
    }

    if (!emailDestinatario) {
      console.log('Nenhum email destinatário configurado');
      if (event.sender && !event.sender.isDestroyed()) {
        event.sender.send('sendEmailResult', { success: false, error: 'Nenhum email destinatário configurado. Defina nas Configurações.' });
      }
      return;
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: "pcscoreboard26@gmail.com",
        pass: "bmuqemjdiaprjrmw",
      }
    });

    const mailOptions = {
      from: '"Scoreboard" <pcscoreboard26@gmail.com>',
      to: emailDestinatario,
      subject: "Scoreboard - Link do Banner Web",
      text: `Olá,\n\nAqui está o link de acesso ao Banner Web:\n\n${url}\n\nObrigado.`,
      html: `<p>Olá,</p><p>Aqui está o link de acesso ao Banner Web:</p><p><a href="${url}">${url}</a></p><p><i>Obrigado.</i></p>`
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Email enviado: ' + info.response);

    if (event.sender && !event.sender.isDestroyed()) {
      event.sender.send('sendEmailResult', { success: true });
    }
  } catch (err) {
    console.error('Erro geral ao enviar email: ', err);
    if (event.sender && !event.sender.isDestroyed()) {
      event.sender.send('sendEmailResult', { success: false, error: err.message });
    }
  }
});

// ============================================
// AUTO-SAVE GAME STATE (Recuperação de partida)
// ============================================
ipcMain.on("auto-save-game-state", async (event, data) => {
  const dbPath = getDbPath();
  const db = new sqlite.Database(dbPath);
  try {
    // Criar tabela se não existir
    await new Promise((resolve, reject) => {
      db.run(
        `CREATE TABLE IF NOT EXISTS partida_ativa (
        id INTEGER PRIMARY KEY DEFAULT 1,
        placar_time1 INTEGER DEFAULT 0,
        placar_time2 INTEGER DEFAULT 0,
        cronometro_minutos INTEGER DEFAULT 0,
        cronometro_segundos INTEGER DEFAULT 0,
        cronometro_pausado INTEGER DEFAULT 1,
        periodo_atual INTEGER DEFAULT 1,
        faltas_time1 INTEGER DEFAULT 0,
        faltas_time2 INTEGER DEFAULT 0,
        tempo_ataque INTEGER DEFAULT 0,
        sets_time1 INTEGER DEFAULT 0,
        sets_time2 INTEGER DEFAULT 0,
        ultimo_save TEXT,
        partida_iniciada INTEGER DEFAULT 0
      )`,
        (err) => {
          if (err) reject(err);
          else resolve();
        },
      );
    });

    // Insert or replace
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT OR REPLACE INTO partida_ativa (id, placar_time1, placar_time2, cronometro_minutos, cronometro_segundos, cronometro_pausado, periodo_atual, faltas_time1, faltas_time2, tempo_ataque, sets_time1, sets_time2, ultimo_save, partida_iniciada) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          data.placar_time1 || 0,
          data.placar_time2 || 0,
          data.cronometro_minutos || 0,
          data.cronometro_segundos || 0,
          data.cronometro_pausado ? 1 : 0,
          data.periodo_atual || 1,
          data.faltas_time1 || 0,
          data.faltas_time2 || 0,
          data.tempo_ataque || 0,
          data.sets_time1 || 0,
          data.sets_time2 || 0,
          new Date().toISOString(),
          data.partida_iniciada ? 1 : 0,
        ],
        (err) => {
          if (err) reject(err);
          else resolve();
        },
      );
    });
  } catch (err) {
    writeLog("ERROR", `[AutoSave] Erro ao salvar estado: ${err.message}`);
  } finally {
    db.close();
  }
});

ipcMain.handle("get-saved-game-state", async (event) => {
  const dbPath = getDbPath();
  const db = new sqlite.Database(dbPath);
  try {
    // Criar tabela se não existir
    await new Promise((resolve, reject) => {
      db.run(
        `CREATE TABLE IF NOT EXISTS partida_ativa (
        id INTEGER PRIMARY KEY DEFAULT 1,
        placar_time1 INTEGER DEFAULT 0,
        placar_time2 INTEGER DEFAULT 0,
        cronometro_minutos INTEGER DEFAULT 0,
        cronometro_segundos INTEGER DEFAULT 0,
        cronometro_pausado INTEGER DEFAULT 1,
        periodo_atual INTEGER DEFAULT 1,
        faltas_time1 INTEGER DEFAULT 0,
        faltas_time2 INTEGER DEFAULT 0,
        tempo_ataque INTEGER DEFAULT 0,
        sets_time1 INTEGER DEFAULT 0,
        sets_time2 INTEGER DEFAULT 0,
        ultimo_save TEXT,
        partida_iniciada INTEGER DEFAULT 0
      )`,
        (err) => {
          if (err) reject(err);
          else resolve();
        },
      );
    });

    const row = await new Promise((resolve, reject) => {
      db.get("SELECT * FROM partida_ativa WHERE id = 1", (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    return row || null;
  } catch (err) {
    writeLog("ERROR", `[AutoSave] Erro ao ler estado: ${err.message}`);
    return null;
  } finally {
    db.close();
  }
});

ipcMain.on("clear-saved-game-state", async (event) => {
  const dbPath = getDbPath();
  const db = new sqlite.Database(dbPath);
  try {
    await new Promise((resolve, reject) => {
      db.run("DELETE FROM partida_ativa WHERE id = 1", (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    writeLog("INFO", "[AutoSave] Estado da partida limpo.");
  } catch (err) {
    writeLog("ERROR", `[AutoSave] Erro ao limpar estado: ${err.message}`);
  } finally {
    db.close();
  }
});

// Frontend logging
ipcMain.on("frontend-log", (event, data) => {
  const level = data.level || "INFO";
  const msg = data.message || data;
  writeLog(level, `[Frontend] ${msg}`);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
