﻿$ErrorActionPreference = "Stop"
$root = "C:\dev\ars-vox-v2"
$py = Join-Path $root ".venv-win\Scripts\python.exe"
$nv = Join-Path $root ".venv-win\Lib\site-packages\nvidia"
$env:PATH = "$nv\cublas\bin;$nv\cudnn\bin;$nv\cuda_nvrtc\bin;$env:PATH"
Set-Location $root

& $py -c "import ctranslate2; print('cuda_devices', ctranslate2.get_cuda_device_count())"

$small = "C:\dev\models\whisper\small"
$turbo = "C:\dev\models\whisper\large-v3-turbo"
New-Item -ItemType Directory -Force -Path (Join-Path $root "results") | Out-Null

$log = Join-Path $root "results\cuda-win-set.log"
& $py tools\stt_set.py data\baseline --models $small $turbo --device cuda --compute-type float16 --out results\cuda-win 2>&1 | Out-File -Encoding utf8 $log
Get-Content $log -Tail 22
