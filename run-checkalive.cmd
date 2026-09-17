@echo off
REM Marca los avisos vencidos ANTES de que el applier los descubra uno por uno.
REM Sin esto el applier gasta sus cupos en avisos cerrados: el 3/9, 13 de los 24
REM que toco ya no existian, y 23 de ellos llevaban tres dias en la base.
cd /d "%~dp0workers"
"C:\Program Files\nodejs\node.exe" check-alive.mjs --limit=600 >> "%~dp0workers\check-alive.log" 2>&1
