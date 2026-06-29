/**
 * Banner Streaming Server - Voleibol
 * Servidor Express + Socket.IO para streaming do banner via web
 */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fsExtra = require("fs-extra");

let io = null;
let server = null;
let app = null;

// Sistema de logging
let logPath = null;
function logToFileServer(message) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [BannerServer] ${message}\n`;
  console.log(`[BannerServer] ${message}`);
  if (logPath) {
    try {
      fsExtra.appendFileSync(logPath, logLine);
    } catch (e) {}
  }
}

// Estado atual do banner
let bannerState = {
  cronometro: "00:00",
  periodo: "1",
  time01: { gols: "00", faltas: "00", sigla: "N/D", logo: "" },
  time02: { gols: "00", faltas: "00", sigla: "N/D", logo: "" },
  setsTime1: "0",
  setsTime2: "0",
  exclusoesTime1: [],
  exclusoesTime2: [],
  cores: {},
  tempoAtaque: "45",
  mostrarAtaque: true,
  gestorLogo: "",
  gestorFundoColor: "",
  camisaVisitadaColor: "",
  camisaVisitanteColor: "",
  serveTeam: 0,
  golosColor: "",
  faltasColor: "",
  equipaNomeColor: "",
  chromaKeyColor: "",
  fundoColor: "",
  golosBgColor: "",
  faltasBgColor: "",
};

let customAssetsPath = null;
let appBasePath = null;

function setAppBasePath(basePath) {
  appBasePath = basePath;
  logToFileServer(`App base path definido: ${appBasePath}`);
}

function setAssetsPath(assetPath) {
  customAssetsPath = assetPath;
}

function startServer(port = 3000) {
  if (server) {
    logToFileServer("Servidor já está rodando");
    return Promise.resolve({ app, server, io });
  }

  app = express();
  server = http.createServer(app);
  io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ["websocket"],
    perMessageDeflate: false
  });

  const fs = require("fs");

  // Resolução de caminhos
  let viewsPath = null;
  let resourcesPath = null;
  const pathsToTry = [];

  if (appBasePath) {
    pathsToTry.push({
      name: "Dev (appBasePath direto)",
      views: path.join(appBasePath, "views"),
      resources: path.join(appBasePath, "resources"),
    });
    pathsToTry.push({
      name: "Prod (resources/app.asar.unpacked)",
      views: path.join(appBasePath, "resources", "app.asar.unpacked", "views"),
      resources: path.join(
        appBasePath,
        "resources",
        "app.asar.unpacked",
        "resources",
      ),
    });
  }

  pathsToTry.push({
    name: "Fallback (__dirname relativo)",
    views: path.join(__dirname, "..", "views"),
    resources: path.join(__dirname, "..", "resources"),
  });

  const unpackedDirname = __dirname.replace("app.asar", "app.asar.unpacked");
  if (unpackedDirname !== __dirname) {
    pathsToTry.push({
      name: "Fallback (__dirname.unpacked)",
      views: path.join(unpackedDirname, "..", "views"),
      resources: path.join(unpackedDirname, "..", "resources"),
    });
  }

  logToFileServer(`Testando ${pathsToTry.length} caminhos possíveis...`);

  for (const pathOption of pathsToTry) {
    const testFile = path.join(pathOption.views, "banner-web.html");
    const exists = fs.existsSync(testFile);
    logToFileServer(`${pathOption.name}: ${exists ? "✓" : "✗"} - ${testFile}`);
    if (exists && !viewsPath) {
      viewsPath = pathOption.views;
      resourcesPath = pathOption.resources;
      logToFileServer(`✓ Usando: ${pathOption.name}`);
    }
  }

  if (!viewsPath) {
    logToFileServer("ERRO: Nenhum caminho válido encontrado!");
    viewsPath = pathsToTry[0].views;
    resourcesPath = pathsToTry[0].resources;
  }

  logToFileServer(`Views path final: ${viewsPath}`);
  logToFileServer(`Resources path final: ${resourcesPath}`);

  // Servir arquivos estáticos
  app.use("/assets", express.static(path.join(viewsPath, "assets")));
  app.use("/resources", express.static(resourcesPath));
  app.use("/views", express.static(viewsPath));

  if (customAssetsPath) {
    logToFileServer(`Servindo assets de: ${customAssetsPath}`);
    app.use("/config-logos", express.static(customAssetsPath));
  }
  app.use("/config-logos", express.static(path.join(resourcesPath, "assets")));
  app.use("/config-logos", express.static("/"));

  app.get("/debug", (req, res) => {
    res.json({
      appBasePath,
      __dirname,
      viewsPath,
      resourcesPath,
      customAssetsPath,
      bannerHtmlExists: fs.existsSync(path.join(viewsPath, "banner-web.html")),
    });
  });

  app.get("/banner2", (req, res) => {
    const bannerHtmlPath = path.join(viewsPath, "banner-web.html");
    logToFileServer(`Servindo banner de: ${bannerHtmlPath}`);
    res.sendFile(bannerHtmlPath);
  });

  app.get("/api/state", (req, res) => {
    res.json(bannerState);
  });

  io.on("connection", (socket) => {
    logToFileServer(`Cliente conectado: ${socket.id}`);
    socket.emit("fullState", bannerState);
    socket.on("disconnect", () => {
      logToFileServer(`Cliente desconectado: ${socket.id}`);
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(port, "0.0.0.0", () => {
      logToFileServer(`Servidor rodando em http://localhost:${port}/banner2`);
      resolve({ app, server, io });
    });

    server.on("error", (e) => {
      if (e.code === "EADDRINUSE") {
        logToFileServer("Porta em uso, servidor provavelmente já rodando...");
        resolve({ app, server, io });
      } else {
        logToFileServer(`Erro no servidor: ${e.message}`);
        reject(e);
      }
    });
  });
}

function updateCronometro(time) {
  bannerState.cronometro = time;
  if (io) io.emit("updateCronometro", time);
}

function updatePontuacao(data) {
  const { inputOrigin, pontuacao, pontuacaoFormatada } = data;
  switch (inputOrigin) {
    case "#input-periodo":
      bannerState.periodo = pontuacao;
      break;
    case "#input-gols-time-01":
      bannerState.time01.gols = pontuacaoFormatada;
      break;
    case "#input-gols-time-02":
      bannerState.time02.gols = pontuacaoFormatada;
      break;
    case "#input-faltas-time-01":
      bannerState.time01.faltas = pontuacaoFormatada;
      break;
    case "#input-faltas-time-02":
      bannerState.time02.faltas = pontuacaoFormatada;
      break;
    case "#input-tempo-ataque":
      bannerState.tempoAtaque = pontuacaoFormatada;
      break;
  }
  if (io) io.emit("updatePontuacao", data);
}

function updateConfig(configType, data) {
  bannerState[configType] = data;
  if (io) io.emit("updateConfig", { type: configType, data });
}

function updateTeamInfo(teamId, data) {
  if (teamId === "1") {
    bannerState.time01 = { ...bannerState.time01, ...data };
  } else {
    bannerState.time02 = { ...bannerState.time02, ...data };
  }
  if (io) io.emit("updateTeamInfo", { teamId, data });
}

function updateFullConfig(config) {
  if (config.gestorLogo) bannerState.gestorLogo = config.gestorLogo;
  if (config.gestorFundoColor)
    bannerState.gestorFundoColor = config.gestorFundoColor;
  if (config.time01)
    bannerState.time01 = { ...bannerState.time01, ...config.time01 };
  if (config.time02)
    bannerState.time02 = { ...bannerState.time02, ...config.time02 };
  if (config.camisaVisitadaColor)
    bannerState.camisaVisitadaColor = config.camisaVisitadaColor;
  if (config.camisaVisitanteColor)
    bannerState.camisaVisitanteColor = config.camisaVisitanteColor;
  if (config.golosColor) bannerState.golosColor = config.golosColor;
  if (config.faltasColor) bannerState.faltasColor = config.faltasColor;
  if (config.equipaNomeColor)
    bannerState.equipaNomeColor = config.equipaNomeColor;
  if (config.chromaKeyColor) bannerState.chromaKeyColor = config.chromaKeyColor;
  if (config.fundoColor) bannerState.fundoColor = config.fundoColor;
  if (config.golosBgColor) bannerState.golosBgColor = config.golosBgColor;
  if (config.faltasBgColor) bannerState.faltasBgColor = config.faltasBgColor;
  if (typeof config.mostrarAtaque !== "undefined")
    bannerState.mostrarAtaque = config.mostrarAtaque;
  if (io) io.emit("updateFullConfig", config);
}

function updateMostrarAtaque(mostrar) {
  bannerState.mostrarAtaque = mostrar;
  if (io) io.emit("updateMostrarAtaque", mostrar);
}

function updateServe(teamId) {
  bannerState.serveTeam = teamId;
  if (io) io.emit("updateServe", teamId);
}

function updateExclusao(data) {
  if (data.tabela === "lista-time-1") {
    bannerState.exclusoesTime1 = data.lista;
  } else {
    bannerState.exclusoesTime2 = data.lista;
  }
  if (io) io.emit("updateExclusao", data);
}

function stopServer() {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => {
        console.log("[Banner Server Voleibol] Servidor fechado");
        resolve();
      });
      if (io) {
        io.close();
        io = null;
      }
      server = null;
      app = null;
    } else {
      resolve();
    }
  });
}

module.exports = {
  startServer,
  stopServer,
  setAppBasePath,
  setAssetsPath,
  updateCronometro,
  updatePontuacao,
  updateConfig,
  updateTeamInfo,
  updateFullConfig,
  updateServe,
  updateExclusao,
  updateMostrarAtaque,
  getBannerState: () => bannerState,
};
