$ErrorActionPreference = 'Stop'
$bridgeDirectory = $PSScriptRoot
$configFile = Join-Path $bridgeDirectory '.env'
if (!(Test-Path -LiteralPath $configFile)) { throw 'Falta .env. Consulta README.md.' }
$privateConfig = Get-Content -LiteralPath $configFile
if (!($privateConfig | Where-Object { $_ -match '^SUPABASE_SERVICE_ROLE_KEY=\S+' })) {
    throw 'Completa SUPABASE_SERVICE_ROLE_KEY en el .env privado. No la publiques ni la pegues en el chat.'
}
$pythonExecutable = Join-Path $bridgeDirectory '.venv\Scripts\python.exe'
if (!(Test-Path -LiteralPath $pythonExecutable)) { throw 'Falta el entorno Python .venv. Consulta README.md.' }
$nodeExecutable = (Get-Command node -ErrorAction Stop).Source
if (Get-NetTCPConnection -State Listen -LocalPort 3080,3081 -ErrorAction SilentlyContinue) {
    throw 'Los puertos 3080/3081 están ocupados. Comprueba si los servicios ya están iniciados.'
}
$runtimeDirectory = Join-Path $bridgeDirectory 'runtime'
New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
$env:WHISPER_DOWNLOAD_ROOT = 'D:\MinaTools\whisper-models'
$env:WHISPER_MODEL = 'D:\MinaTools\whisper-models\small'
$audioProcess = Start-Process -FilePath $pythonExecutable -ArgumentList '-m uvicorn transcription_server:app --host 127.0.0.1 --port 3081' -WorkingDirectory $bridgeDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDirectory 'audio-out.log') -RedirectStandardError (Join-Path $runtimeDirectory 'audio-error.log')
$qrProcess = Start-Process -FilePath $nodeExecutable -ArgumentList '--env-file=.env --import tsx index.ts' -WorkingDirectory $bridgeDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDirectory 'qr-out.log') -RedirectStandardError (Join-Path $runtimeDirectory 'qr-error.log')
Write-Host "Transcriptor PID $($audioProcess.Id), conector QR PID $($qrProcess.Id). Revisa runtime/*.log."
Write-Host 'En la web, WhatsApp: http://127.0.0.1:3080. Desde celular necesitas HTTPS con un túnel a esta PC.'
