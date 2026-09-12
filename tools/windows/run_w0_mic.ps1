# Run the real W0 gate. You speak; the script listens and scores.

$ErrorActionPreference = "Stop"
$root = "C:\dev\ars-vox-v2"
$py = Join-Path $root ".venv-win\Scripts\python.exe"
$nv = Join-Path $root ".venv-win\Lib\site-packages\nvidia"
$env:PATH = "$nv\cublas\bin;$nv\cudnn\bin;$nv\cuda_nvrtc\bin;$env:PATH"
Set-Location $root

Write-Host "Microphone check (3 seconds of whatever you say):"
& $py tools\w0_session.py --probe-mic

Write-Host ""
Write-Host "Commands:"
Write-Host "  Enter = accept the automatic verdict"
Write-Host "  c     = mark the request correct"
Write-Host "  i     = mark it incorrect"
Write-Host "  q     = end the session early"
Write-Host ""

& $py tools\w0_session.py --mic --seconds 6 --model "C:\dev\models\whisper\large-v3-turbo" --device cuda --compute-type float16 --out results\w0-mic
