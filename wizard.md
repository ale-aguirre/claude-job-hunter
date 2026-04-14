# Job Hunter — Wizard de Setup

Seguí estos pasos en orden. Hacé las preguntas de a una, esperá la respuesta, y guardá todo en `profile.json` al final.

---

## Paso 1 — Bienvenida

Decile al usuario:

> Hola, soy tu Job Hunter. Voy a hacerte algunas preguntas para configurar tu perfil y empezar a buscar trabajo.
> Solo tarda 2 minutos. Podés cambiar cualquier cosa después editando `profile.json`.

---

## Paso 2 — Perfil profesional

Preguntá en este orden, de a una:

1. **Profesión y experiencia:**
   > ¿A qué te dedicás? Contame brevemente tu profesión y cuántos años de experiencia tenés.
   > (Ejemplos: desarrollador web 5 años, electricista matriculado 10 años, diseñadora gráfica freelance)

2. **Skills principales:**
   > ¿Cuáles son tus 3-5 habilidades principales? Las que más usás en el trabajo.

3. **Objetivo económico:**
   > ¿Cuánto querés ganar? Podés decirlo por hora, por mes, o por proyecto.
   > ¿En qué moneda? (USD, ARS, EUR, etc.)

4. **Modalidad:**
   > ¿Buscás trabajo remoto, presencial, o te da igual?
   > ¿Relación de dependencia, freelance, o ambos?

5. **Ubicación:**
   > ¿En qué país y ciudad estás?

6. **Idiomas:**
   > ¿En qué idiomas podés trabajar? (español, inglés, ambos, etc.)

---

## Paso 3 — Verificar conexiones

Verificá qué herramientas están disponibles con estos comandos:

```bash
# ¿Tiene Node.js?
node --version

# ¿Tiene npm?
npm --version

# ¿Está instalado Playwright?
npx playwright --version 2>/dev/null || echo "no"

# ¿Está Chrome accesible?
ls "/Applications/Google Chrome.app" 2>/dev/null && echo "Chrome encontrado" || echo "Chrome no encontrado"
```

Mostrá el resultado así:

```
Verificando tu entorno...
[✓] Node.js v20+ — OK
[✓] npm — OK  
[✗] Playwright — no instalado
[✓] Chrome — encontrado
```

Para cada elemento faltante, ofrecé instalarlo:
- **Playwright faltante:** `cd workers && npm install && npx playwright install chromium`
- **Node.js faltante:** decile que lo instale desde nodejs.org antes de continuar
- **Chrome faltante en Mac:** `brew install --cask google-chrome` o descargarlo manualmente

---

## Paso 4 — Conexión a Claude (verificar MCPs)

Verificá qué MCPs tiene disponibles el usuario. Ejecutá en la sesión de Claude Code:

Chequeá si WebSearch está disponible intentando una búsqueda simple.
Chequeá si Playwright MCP está configurado intentando navegar.

Mostrá:

```
Herramientas de Claude disponibles:
[✓] WebSearch — puede buscar ofertas en tiempo real
[✓] WebFetch — puede leer páginas de trabajo
[?] Playwright MCP — necesario para aplicar automáticamente
    → Si no está: agregar en ~/.claude/settings.json (ver docs)
[?] Filesystem MCP — opcional, para gestión de archivos
```

Si falta Playwright MCP, mostrá exactamente qué agregar al `settings.json` de Claude Code:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

---

## Paso 5 — Twitter/X (opcional)

> ¿Usás Twitter/X? Kaguya puede buscar posts de hiring en tiempo real si tenés sesión activa en Chrome.

Si dice que sí:
```bash
cd workers && node get-twitter-token.mjs
```

Si el script encuentra los tokens, guardá en profile.json.
Si falla, decile que no pasa nada — Kaguya puede trabajar sin X.

---

## Paso 6 — Job boards según profesión

Basándote en la profesión que respondió en el Paso 2, leé el archivo de boards correspondiente:

- **Tech / Developer:** `boards/tech.md`
- **Diseño / Creativo:** `boards/creative.md`
- **Oficios / Trades:** `boards/trades.md`
- **Marketing / Ventas:** `boards/marketing.md`
- **Administración / Contabilidad:** `boards/business.md`
- **Cualquier profesión:** `boards/universal.md` (siempre incluido)

Si la profesión no encaja en ninguna categoría clara, usá `boards/universal.md` y mencioná qué boards activaste.

---

## Paso 7 — Generar profile.json

Con toda la información recopilada, creá el archivo `profile.json`:

```json
{
  "name": "<nombre del usuario>",
  "profession": "<profesión en texto libre>",
  "skills": ["skill1", "skill2", "skill3"],
  "experience_years": <número>,
  "salary_target": {
    "amount": <número>,
    "currency": "USD",
    "period": "monthly",
    "minimum": <número>
  },
  "work_mode": ["remote", "freelance"],
  "location": {
    "country": "Argentina",
    "city": "Córdoba",
    "timezone": "America/Argentina/Cordoba"
  },
  "languages": ["es", "en"],
  "search_tags": ["<derivados de skills y profesión>"],
  "boards": ["<boards activados según profesión>"],
  "has_twitter": false,
  "cv_path": "",
  "portfolio_url": "",
  "linkedin_url": "",
  "github_url": "",
  "contact": {
    "email": "",
    "phone": ""
  },
  "setup_complete": true,
  "setup_date": "<fecha de hoy>"
}
```

Derivá `search_tags` automáticamente desde `profession` y `skills`. Ejemplo:
- Electricista + instalaciones industriales → `["electricista", "instalaciones eléctricas", "industrial electrician", "electrical technician"]`
- Developer React → `["react", "next.js", "typescript", "frontend developer", "full stack"]`

---

## Paso 8 — Instalar dependencias de workers

```bash
cd workers && npm install
```

Si falla, mostrá el error y sugerí solución.

---

## Paso 9 — Primera búsqueda de prueba

> ¡Todo listo! ¿Querés que haga una búsqueda de prueba ahora para ver cómo funciona?

Si dice que sí, corré:
```bash
cd workers && node scout-api.mjs
```

Mostrá cuántos jobs encontró y de qué tipo.

---

## Paso 10 — Fin del wizard

Mostrá un resumen final:

```
✓ Perfil configurado: <profesión>
✓ Buscando en: <lista de boards>
✓ Workers instalados
✓ <N> jobs encontrados en la primera búsqueda

Comandos disponibles:
  /job-hunter hunt      → buscar nuevos trabajos
  /job-hunter status    → ver el pipeline
  /job-hunter apply     → aplicar a los mejores matches
  /job-hunter dashboard → abrir panel visual en localhost:4242
  /job-hunter letter <url> → generar cover letter para un trabajo

Para cambiar cualquier dato: editá profile.json directamente.
```
