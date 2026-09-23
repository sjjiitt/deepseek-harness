; Office preview loads LibreOfficeKit and the bundled runtime loads its native modules through the
; Microsoft Visual C++ 2015-2022 runtime, which Windows does not ship. Packaging embeds the official
; redistributable at resources\vc_redist.x64.exe when the packaging environment provides it, and the
; installer offers it only on computers that lack the 64-bit runtime. Installation never depends on
; it: a declined or failing redistributable leaves the application installed and Office preview
; unavailable until the runtime is present.
Var InstallerVcRedist

; Records whether the 64-bit runtime is absent in $InstallerVcRedist.
Function InstallerVcRuntimeMissing
    SetRegView 64
    ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
    SetRegView lastused
    StrCpy $InstallerVcRedist 0
    ${If} $0 != 1
        StrCpy $InstallerVcRedist 1
    ${EndIf}
FunctionEnd

; The caller's extraction errors must survive this function, so the error flag is restored on exit.
Function InstallerInstallVcRuntime
    Push $0
    Push $1
    StrCpy $1 0
    ${If} ${Errors}
        StrCpy $1 1
    ${EndIf}
    Call InstallerVcRuntimeMissing
    ${If} $InstallerVcRedist == 0
        Goto installer_vc_runtime_done
    ${EndIf}
    ${IfNot} ${FileExists} "$INSTDIR\resources\vc_redist.x64.exe"
        DetailPrint "Visual C++ 2015-2022 runtime: absent, and this installer carries no redistributable."
        Goto installer_vc_runtime_done
    ${EndIf}
    ; Unattended installations never prompt; an elevated deployment installs the runtime here, and an
    ; unelevated one records the failure for the operator instead of blocking on a dialog.
    ${If} ${Silent}
        ClearErrors
        ExecWait '"$INSTDIR\resources\vc_redist.x64.exe" /install /quiet /norestart' $0
        DetailPrint "Visual C++ 2015-2022 runtime: bundled installer exit code $0."
        Goto installer_vc_runtime_done
    ${EndIf}
    MessageBox MB_ICONINFORMATION|MB_YESNO "$(INSTALLER_VC_RUNTIME)" /SD IDYES IDNO installer_vc_runtime_declined
    ClearErrors
    ExecWait '"$INSTDIR\resources\vc_redist.x64.exe" /install /quiet /norestart' $0
    Call InstallerVcRuntimeMissing
    ${If} $InstallerVcRedist == 1
        MessageBox MB_OK|MB_ICONEXCLAMATION "$(INSTALLER_VC_RUNTIME_FAILED)"
    ${EndIf}
    Goto installer_vc_runtime_done
  installer_vc_runtime_declined:
    DetailPrint "Visual C++ 2015-2022 runtime: installation declined."
  installer_vc_runtime_done:
    ${If} $1 == 1
        SetErrors
    ${Else}
        ClearErrors
    ${EndIf}
    Pop $1
    Pop $0
FunctionEnd
