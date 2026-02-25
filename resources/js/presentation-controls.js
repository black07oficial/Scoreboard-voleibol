// ============================================
// CONTROLES DE APRESENTAÇÃO DE JOGADORES
// ============================================

(function () {
    const { ipcRenderer } = require('electron');

    // Estado da apresentação
    let presentationActive = false;
    let presentationPaused = false;

    // Criar barra flutuante dinamicamente
    function createPresentationBar() {
        const bar = document.createElement('div');
        bar.id = 'presentation-control-bar';
        bar.innerHTML = `
            <style>
                #presentation-control-bar {
                    position: fixed;
                    bottom: 20px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: linear-gradient(135deg, #2c3e50, #34495e);
                    border-radius: 12px;
                    padding: 12px 24px;
                    display: none;
                    align-items: center;
                    gap: 16px;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
                    z-index: 9999;
                    border: 2px solid #f39c12;
                }
                #presentation-control-bar.active {
                    display: flex !important;
                }
                #presentation-control-bar .pres-info {
                    color: #ecf0f1;
                    font-size: 14px;
                    min-width: 180px;
                }
                #presentation-control-bar .pres-info .player-name {
                    font-weight: bold;
                    color: #f39c12;
                }
                #presentation-control-bar .pres-info .player-count {
                    color: #95a5a6;
                    font-size: 12px;
                }
                #presentation-control-bar .ctrl-btn {
                    background: #3498db;
                    border: none;
                    color: white;
                    width: 40px;
                    height: 40px;
                    border-radius: 50%;
                    cursor: pointer;
                    font-size: 16px;
                    transition: all 0.2s ease;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                #presentation-control-bar .ctrl-btn:hover {
                    background: #2980b9;
                    transform: scale(1.1);
                }
                #presentation-control-bar .ctrl-btn.pause-btn {
                    background: #e74c3c;
                }
                #presentation-control-bar .ctrl-btn.pause-btn:hover {
                    background: #c0392b;
                }
                #presentation-control-bar .ctrl-btn.pause-btn.paused {
                    background: #27ae60;
                }
                #presentation-control-bar .close-btn {
                    background: transparent;
                    border: none;
                    color: #95a5a6;
                    cursor: pointer;
                    font-size: 18px;
                    padding: 4px 8px;
                }
                #presentation-control-bar .close-btn:hover {
                    color: #e74c3c;
                }
            </style>
            <div class="pres-info">
                <div class="player-name" id="pres-player-name">-</div>
                <div class="player-count">Jogador <span id="pres-current">0</span> de <span id="pres-total">0</span></div>
            </div>
            <button class="ctrl-btn" id="pres-prev-btn" title="Anterior">
                <i class="fa fa-step-backward"></i>
            </button>
            <button class="ctrl-btn pause-btn" id="pres-pause-btn" title="Pausar/Continuar">
                <i class="fa fa-pause" id="pres-pause-icon"></i>
            </button>
            <button class="ctrl-btn" id="pres-next-btn" title="Próximo">
                <i class="fa fa-step-forward"></i>
            </button>
            <button class="close-btn" id="pres-close-btn" title="Ocultar">
                <i class="fa fa-times"></i>
            </button>
        `;
        document.body.appendChild(bar);

        // Event listeners
        document.getElementById('pres-prev-btn').addEventListener('click', () => {
            ipcRenderer.send('presentation-control-prev');
        });

        document.getElementById('pres-pause-btn').addEventListener('click', () => {
            ipcRenderer.send('presentation-control-pause');
        });

        document.getElementById('pres-next-btn').addEventListener('click', () => {
            ipcRenderer.send('presentation-control-next');
        });

        document.getElementById('pres-close-btn').addEventListener('click', () => {
            bar.classList.remove('active');
        });

        return bar;
    }

    // Inicializar quando DOM estiver pronto
    document.addEventListener('DOMContentLoaded', () => {
        console.log('[Presentation Controls] Inicializando...');
        const bar = createPresentationBar();
        console.log('[Presentation Controls] Barra criada, aguardando eventos...');

        // Solicitar status atual (caso a apresentacao ja esteja rodando e pausada)
        ipcRenderer.send('presentation-get-status');

        // Receber atualizações de status da apresentação
        ipcRenderer.on('presentation-status-update', (event, status) => {
            console.log('[Presentation Controls] Recebido status:', status);
            if (status.isActive) {
                bar.classList.add('active');
                presentationActive = true;
                presentationPaused = status.isPaused;

                // Atualizar informações
                document.getElementById('pres-player-name').textContent = status.currentPlayer || '-';
                document.getElementById('pres-current').textContent = status.currentIndex || 0;
                document.getElementById('pres-total').textContent = status.total || 0;

                // Atualizar botão de pausa
                const pauseBtn = document.getElementById('pres-pause-btn');
                const pauseIcon = document.getElementById('pres-pause-icon');
                if (presentationPaused) {
                    pauseBtn.classList.add('paused');
                    pauseIcon.className = 'fa fa-play';
                } else {
                    pauseBtn.classList.remove('paused');
                    pauseIcon.className = 'fa fa-pause';
                }
            }
        });
    });
})();
