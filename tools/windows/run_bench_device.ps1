$ErrorActionPreference = "Stop"
$root = "C:\dev\ars-vox-v2"
$py = Join-Path $root ".venv-win\Scripts\python.exe"
$nv = Join-Path $root ".venv-win\Lib\site-packages\nvidia"
$env:PATH = "$nv\cublas\bin;$nv\cudnn\bin;$nv\cuda_nvrtc\bin;$env:PATH"
Set-Location $root
& $py tools\bench_device.py
