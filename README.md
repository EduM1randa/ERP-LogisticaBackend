# ERPBack — Backend para Logística (ERP-SI2)

Resumen breve

- Aplicación backend en Node.js + TypeScript para gestionar procesos de logística (OTs de picking, guías de despacho, recepciones e integraciones con ventas).
- Organización por controladores: `auth`, `automatizacion`, `despacho`, `integracion`, `picking`, `recepcion`, `recursos`, `usuarios`.

Tech stack

- Node.js, TypeScript, Express
- PostgreSQL (varias esquemas: `Logistica`, `Ventas`, `public`)
- PDF generation: `pdfkit`

Estructura importante del repositorio

- `src/` — código TypeScript del backend
  - `controllers/` — lógica por dominio (ver archivos mencionados arriba)
  - `routes/` — definiciones de rutas
  - `middleware/` — `auth.middleware.ts`, `role.middleware.ts`
  - `config/database.ts` — pool Postgres
  - `utils/` — helpers (auth, dates...)

Variables de entorno
Rellena un archivo `.env` en la raíz (puedes partir de `.env.example`). Estas variables se usan en el proyecto:

- `PORT` — puerto del servidor (ej. `3005`)
- `NODE_ENV` — `development` | `production`
- `DB_HOST` — host de la BD
- `DB_PORT` — puerto de la BD (ej. `5432`)
- `DB_USER` — usuario de la BD
- `DB_PASSWORD` — contraseña de la BD
- `DB_NAME` — nombre de la BD
- `DB_SCHEMA` — esquema por defecto (ej. `Logistica`)
- `DB_SSL` — `true`/`false` (usar `true` en Neon o servicios gestionados)
- `CORS_ORIGIN` — origen permitido por CORS (ej. `http://localhost:5173`)
- `JWT_SECRET` — secreto para firmar tokens JWT (cambiar en producción)

Instalación y ejecución (local)

1. Instala dependencias:

```powershell
npm install
```

2. Copia el ejemplo de variables de entorno y complétalo:

```powershell
copy .env.example .env
# editar .env con valores reales
```

3. Levanta en modo desarrollo (con `ts-node` / `nodemon` según configuración del `package.json`):

```powershell
npm run dev
```

4. Compilar y ejecutar en producción:

```powershell
npm run build
npm start
```

Base de datos y migraciones

- Si usas Neon o cualquier servicio con TLS/SSL, activa `DB_SSL=true` en `.env`.

Principales endpoints (resumen)

- `POST /api/auth/login` — autenticación
- `GET/PUT /api/picking` — OTs de picking (`getAllOrdenesPicking`, `getMisOrdenesPicking`, `getOrdenPickingById`, `createOrdenPicking`, `updateOrdenPicking`)
- `GET /api/picking/:id/pdf` — genera PDF de picking para la OT (usa `pdfkit`)
- `GET/PUT /api/automatizacion` — automatizaciones y edición de OTs/Guías
- `GET /api/despacho` — listados y detalles de guías (incluye `id_encargado` y `encargado_name`)
- `PUT /api/integracion/recepcion/:id/recibir` — marcar recepción como `RECIBIDA` (registra `id_empleado_logistica` y `fecha_recepcion_finalizada`)
- `GET /api/recursos` — listado de empleados y transportistas (sin filtro `estado = 'ACTIVO'` por defecto)

Reglas de negocio importantes (resumen implementado en controladores)

- No se permiten ediciones a guías en estado `ENTREGADA`.
- La OT al pasar a `COMPLETADA` actualiza sus guías asociadas a estado `POR ASIGNAR`, limpia `id_encargado` y fecha.
- Asignar `id_encargado` a una guía puede auto-promoverla a `ASIGNADA`; quitar el `id_encargado` la deja en `POR ASIGNAR`.
- Se añadió endpoint para marcar recepciones como `RECIBIDA` con registro del empleado y timestamp.
- Se eliminaron filtros estrictos `estado = 'ACTIVO'` en listados de recursos cuando fue requerido.

Contribuir

- Crea una rama con tu feature/fix y abre PR explicando los cambios.

---
