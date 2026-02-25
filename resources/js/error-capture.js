/**
 * Captura global de erros no renderer.
 * Qualquer erro não tratado será logado via console.error,
 * que é capturado pelo setupWindowErrorLogging no main.js
 * e gravado no arquivo de log.
 */
(function () {
    // Capturar erros JavaScript não tratados
    window.onerror = function (message, source, lineno, colno, error) {
        var errorInfo = '[UNCAUGHT ERROR] ' + message + ' em ' + source + ':' + lineno + ':' + colno;
        if (error && error.stack) {
            errorInfo += '\nStack: ' + error.stack;
        }
        console.error(errorInfo);

        // Também tentar enviar via IPC como backup
        try {
            var ipc = require('electron').ipcRenderer;
            ipc.send('frontend-log', { level: 'ERROR', message: errorInfo });
        } catch (e) { }

        return false; // Não suprimir o erro
    };

    // Capturar Promise rejections não tratadas
    window.addEventListener('unhandledrejection', function (event) {
        var reason = event.reason;
        var errorInfo = '[UNHANDLED REJECTION] ';
        if (reason instanceof Error) {
            errorInfo += reason.message + '\nStack: ' + (reason.stack || 'N/A');
        } else {
            errorInfo += String(reason);
        }
        console.error(errorInfo);

        // Também tentar enviar via IPC como backup
        try {
            var ipc = require('electron').ipcRenderer;
            ipc.send('frontend-log', { level: 'ERROR', message: errorInfo });
        } catch (e) { }
    });

    // Log de inicialização da página
    console.log('[ErrorCapture] Captura de erros ativa para: ' + window.location.pathname);
})();
