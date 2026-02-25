const { contextBridge } = require('electron')

// Expor funcionalidades do Node.js para o contexto do navegador
contextBridge.exposeInMainWorld('electron', {
  require: require,
})