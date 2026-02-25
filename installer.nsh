!macro preInit
  ; Forçar instalação em C:\Scoreboard-voleibol
  StrCpy $INSTDIR "C:\Scoreboard-voleibol"
!macroend

!macro customInit
  ; Forçar novamente em customInit
  StrCpy $INSTDIR "C:\Scoreboard-voleibol"
  
  ; Limpar registro de instalações anteriores
  DeleteRegKey HKCU "Software\Scoreboard-voleibol"
  DeleteRegKey HKLM "Software\Scoreboard-voleibol"
!macroend

!macro customInstall
  ; Liberar permissões da pasta para todos os usuários
  DetailPrint "Configurando permissões da pasta..."
  ExecWait 'icacls "$INSTDIR" /grant Users:(OI)(CI)F /T /Q'
  
  ; Verificar VC++ Redistributable
  DetailPrint "Verificando Visual C++ Redistributable..."
  ReadRegDword $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  
  ${If} $0 != 1
    DetailPrint "Visual C++ não encontrado. Por favor instale manualmente."
    MessageBox MB_ICONEXCLAMATION "Visual C++ Redistributable (x64) não está instalado.$\n$\nO aplicativo pode não funcionar corretamente.$\n$\nPor favor, baixe e instale de: https://aka.ms/vs/17/release/vc_redist.x64.exe"
  ${Else}
    DetailPrint "Visual C++ já instalado."
  ${EndIf}
!macroend
