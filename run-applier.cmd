@echo off
REM Envoltorio para la tarea programada job-hunter-applier.
REM Existe por dos razones: schtasks no traga rutas con espacios anidadas entre
REM comillas, y una tarea que guarda el WorkingDirectory absoluto se rompe en
REM silencio si el proyecto se mueve de carpeta. Aca el cd es relativo a este
REM archivo, asi que mover el proyecto no rompe nada.
cd /d "%~dp0workers"
"C:\Program Files\nodejs\node.exe" apply-ats.mjs --limit=8 >> "%~dp0workers\applier.log" 2>&1
