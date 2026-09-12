# Ars Vox service: the ears, the loop and the window, with the CUDA libraries on PATH.
$repo = 'C:\dev\ars-vox-v2'
$libs = 'cublas', 'cudnn', 'cuda_nvrtc' | ForEach-Object { "$repo\.venv-win\Lib\site-packages\nvidia\$_\bin" }
$env:PATH = (($libs + $env:PATH) -join ';')
Set-Location $repo
& "$repo\.venv-win\Scripts\python.exe" "$repo\apps\cli\arsvox_cli.py" serve --session cli --port 8790 @args
