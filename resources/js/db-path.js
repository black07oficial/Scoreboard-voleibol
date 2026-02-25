/**
 * Helper para obter o caminho correto do banco de dados
 * Em produção (ASAR), usa IPC get-db-path do main process
 * Em desenvolvimento, retorna o caminho relativo ao projeto
 */
(function () {
    const path = require('path');
    const fs = require('fs');
    const { ipcRenderer } = require('electron');

    // Caminho inicial (fallback) — __dirname é resources/js/, então subimos 2 níveis
    let _dbPath = path.join(__dirname, '..', '..', 'scoreboard.sqlite');
    let _dataRoot = path.join(__dirname, '..', '..');

    // Resolver via IPC do main process (mais confiável, funciona em dev e produção)
    (async () => {
        try {
            const resolved = await ipcRenderer.invoke('get-db-path');
            if (resolved) {
                _dbPath = resolved;
                _dataRoot = path.dirname(resolved);
                console.log('[db-path] Caminho resolvido via IPC:', _dbPath);
            }
        } catch (e) {
            console.warn('[db-path] Fallback para caminho local:', _dbPath);
        }
    })();

    /**
     * Retorna o caminho correto para o banco de dados scoreboard.sqlite
     * Funciona tanto em desenvolvimento quanto em produção (ASAR)
     */
    window.getDbPath = function () {
        return _dbPath;
    };

    /**
     * Retorna o diretório raiz de dados (onde estão logs, assets, etc)
     */
    window.getDataRoot = function () {
        return _dataRoot;
    };

    console.log('[db-path] Módulo carregado. DB Path inicial:', _dbPath);
})();
