# claude-job-hunter

**Agente de búsqueda laboral construido sobre Claude Code, pensado para LATAM.** No necesita API keys: Claude es el motor.

Le hablás con slash commands. Busca trabajos en boards regionales y remotos, escribe cover letters en español/inglés según corresponda, y aplica con human-in-the-loop antes de enviar.

---

## Cómo funciona

Claude Code (la app que ya usás) es el motor. Los workers en Node.js manejan scraping y automatización de browser. Claude maneja razonamiento, priorización y redacción.

```
/job-hunter setup   ← primera vez, 2 minutos
/job-hunter hunt    ← buscar nuevas oportunidades
/job-hunter apply   ← revisar matches y aplicar (con confirmación)
/job-hunter status  ← ver el pipeline
```

---

## Setup (2 minutos)

### 1. Instalar Claude Code

```bash
npm install -g @anthropic-ai/claude-code
```

### 2. Clonar e instalar dependencias

```bash
git clone https://github.com/ale-aguirre/claude-job-hunter
cd claude-job-hunter/workers && npm install
```

### 3. Agregarlo como skill de Claude Code

```bash
ln -s $(pwd)/.. ~/.claude/skills/job-hunter
```

### 4. Correr el wizard

Abrí Claude Code y escribí:

```
/job-hunter setup
```

El wizard te pregunta 6 cosas, genera `profile.json` y corre una búsqueda de prueba.

---

## Comandos

| Comando | Qué hace |
|---------|----------|
| `/job-hunter setup` | Wizard de onboarding — genera tu perfil |
| `/job-hunter hunt` | Busca en boards LATAM + remotos |
| `/job-hunter apply` | Revisa los matches y aplica (con human-in-the-loop antes de submit) |
| `/job-hunter status` | Estado del pipeline: encontrados / aplicados / entrevistas |
| `/job-hunter dashboard` | Abre panel visual en `localhost:4242` |
| `/job-hunter research <empresa>` | Investigación profunda antes de aplicar |
| `/job-hunter letter <url>` | Cover letter para cualquier URL de job |
| `/job-hunter help` | Lista todos los comandos |

---

## Boards que busca

**LATAM (prioridad)**:
- GetOnBrd, Torre, Workana, Computrabajo (AR/MX/CL/CO/PE), Bumeran (AR/MX/CL)
- Reddit r/devsArgentina, r/PeruDev, r/mexicodevs (jobs threads)

**Remoto internacional en USD**:
- Remotive, RemoteOK, We Work Remotely
- Arc.dev, Lemon.io, Wellfound, Braintrust
- HN Who's Hiring mensual

**Plataformas freelance / contract**:
- Upwork, Contra
- Outlier.ai, Alignerr (gigs de AI training pagados en USD)

**Opcional con sesión activa de Chrome**:
- LinkedIn (jobs feed + Easy Apply)
- X/Twitter (búsqueda de hiring posts)

La selección exacta se ajusta a tu profesión y modalidad (remoto / híbrido / presencial) según `profile.json`.

---

## Groq key opcional para cover letters más rápidas

Sin key, Claude maneja todo. Con una key gratis de Groq, las cover letters y el scoring corren más rápido:

```bash
# workers/.env
GROQ_API_KEY=tu_key_aca   # gratis en groq.com
```

---

## Dashboard opcional

```
/job-hunter dashboard
```

Abre un kanban visual en `localhost:4242` con jobs en estados found / applied / interview y actividad de los agentes.

---

## Agentes internos

Cada agente es un prompt especializado que Claude corre como subagente:

| Agente | Rol |
|--------|-----|
| Fern | Busca en job boards, clasifica oportunidades |
| Kaguya | Scrapea redes sociales (X, Reddit) para hiring posts |
| Reigen | Llena formularios ATS y prepara aplicaciones |
| Erwin | Análisis de mercado — qué priorizar |

Podés renombrar agentes y cambiarles avatar en `dashboard/src/agents.js`.

---

## Privacidad

`profile.json`, `jobs.db` y `.env` están en `.gitignore`. Nada personal se sube al repo.

---

## Requisitos

- [Claude Code](https://claude.ai/code) (CLI o app desktop)
- Node.js 18+

Opcional:
- [Groq API key](https://console.groq.com) gratis para cover letters más rápidas
- Playwright MCP en settings de Claude para auto-fill de formularios
- Chrome con sesiones activas para LinkedIn y scraping de X

---

## Estado

Proyecto activo, en uso personal. Sin promesas de soporte ni roadmap público. Si rompe algo, abrí un issue y miro cuando puedo.

---

## Licencia

MIT
