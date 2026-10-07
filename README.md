# MINA OMAR MIRANDA

Aplicación web privada para administrar labores, producción, gastos, préstamos, ventas y recorridos de la mina. La interfaz usa glassmorphism y está adaptada para escritorio y celular.

## Sitio público y datos privados

La aplicación estática se publica gratuitamente con GitHub Pages mediante `.github/workflows/pages.yml`:

- Sitio: `https://gerauquezada.github.io/mina/`
- El código y el modelo 3D publicados en GitHub Pages son públicos.
- El panel y los datos operativos requieren la cuenta propietaria configurada en Supabase.
- El registro público está desactivado y las políticas de base de datos impiden lecturas o escrituras anónimas.

No se usa Render, tarjeta de crédito ni un servidor de pago. Los planes gratuitos de GitHub Pages y Supabase tienen límites y no ofrecen una garantía contractual de disponibilidad 24/7; Supabase puede pausar proyectos gratuitos inactivos.

## Funciones principales

- Labores con socio y porcentaje configurable.
- Labores propias cuya producción pertenece al propietario al 100%.
- Dashboard con tres totales separados: participación en labores con socios, labores propias y total del propietario.
- Dashboard reactivo: se recalcula al guardar cualquier registro, al volver a la pantalla, al recuperar el foco y periódicamente para sincronizar otros dispositivos.
- Fotografías para socios, préstamos con comprobantes y seguimiento de abonos.
- Ventas con fecha, hora, peso, ley, ingreso y ganancia neta cuando se conocen los costos.
- Precio actual del oro con estado de actualización y manejo de fallos de red.
- Reportes, historial y respaldos completos en JSON.
- Diseño responsive para teléfono y escritorio.

## Editor modular 3D

La ruta `#/edicion-3d` es independiente del visor operativo. Conserva `mine.glb` como capa maestra de solo lectura y permite:

- subir avances `.glb` sin reconstruir la mina completa;
- mover, girar, escalar, ocultar y transparentar cada ampliación;
- medir polilíneas sobre la geometría y calibrar la escala con una distancia física conocida;
- deshacer, rehacer y conservar una copia local en IndexedDB;
- sincronizar transformaciones en `mine_workspace` y archivos en el bucket privado `mine-models`.

El bucket admite GLB de hasta 50 MB. Debe ejecutarse la sección correspondiente de `supabase/schema.sql` para activar el almacenamiento privado. Si todavía no existe, el editor continúa funcionando localmente sin afectar las demás páginas.

## Asistente de WhatsApp

La ruta `#/whatsapp` permite vincular un número a cada labor, preparar el mensaje diario, generar un QR e interpretar respuestas antes de guardarlas. La integración automática está preparada en `supabase/functions/whatsapp-assistant`:

- webhook firmado de WhatsApp Cloud API;
- recepción idempotente de texto y audio;
- transcripción opcional mediante un endpoint compatible con Whisper;
- extracción de sacos, gastos, día sin trabajo o solo desmonte;
- registro automático en producción, gastos, actividad e historial;
- envío diario mediante una plantilla oficial aprobada y una tarea de Supabase Cron.

Para activarla se necesitan un número de WhatsApp Business, una plantilla aprobada y secretos configurados en Supabase. Use `supabase/functions/.env.example` como lista de nombres; nunca guarde valores reales en GitHub. Después despliegue la función y programe su invocación periódica desde Supabase Cron. Los mensajes programados de WhatsApp deben usar una plantilla aprobada por Meta.

## Modelo 3D y recorrido interno

`public/models/mine.glb` conserva el modelo original. `public/models/mine-mobile.glb` mantiene la misma geometría con texturas optimizadas para teléfonos.

El modo **Recorrido** incluye:

- WASD o flechas y ratón con Pointer Lock en escritorio.
- Joystick izquierdo y arrastre derecho en móvil.
- Movimiento relativo a la mirada, incluyendo subida y bajada guiada por su inclinación.
- Perfil reducido para entrar en galerías y espacios angostos.
- Colisión selectiva: las paredes amplias son sólidas, mientras soportes delgados, ruido del escaneo y zonas angostas no bloquean. Cinco sondas siguen el suelo real y conservan la altura ante huecos del escaneo.
- Detección de una posición interior transitable y coordenadas X/Y/Z de depuración.
- Regreso al visor orbital con **Salir del recorrido**.

Las coordenadas manuales de respaldo están en `src/three/walkConfig.ts`, en `WALK_START_POSITION` y `WALK_START_TARGET`. No se reconstruye ni modifica la geometría visible del GLB.

## Configuración segura

`public/cloud-config.json` contiene solamente la URL de Supabase y la clave pública publishable. Las contraseñas, la clave `service_role` y la contraseña de la base de datos nunca deben guardarse en GitHub.

El esquema de tablas, política RLS y función de escritura está en `supabase/schema.sql`. Solo se debe ejecutar en el proyecto Supabase del propietario.

## Uso local

```powershell
Set-Location 'D:\MINA-OMAR-MIRANDA'
npm install
npm run dev:web
```

Abra `http://localhost:5173/mina/` e inicie sesión con la cuenta propietaria creada en Supabase.

## Pruebas y compilación

```powershell
npm test
npx tsc -b
npm run build
```

Las pruebas cubren autenticación privada, separación de producción propia/compartida, préstamos, ventas, respaldos, concurrencia, validación y movimiento con colisiones sobre la geometría real.

## Estructura principal

- `src/lib/cloud.ts`: sesión y sincronización con Supabase.
- `src/lib/api.ts`: reglas de negocio y persistencia.
- `src/pages/`: dashboard, registros, reportes, configuración y visor 3D.
- `src/three/walkPhysics.ts`: física compartida del recorrido.
- `src/three/walkConfig.ts`: posición y objetivo configurables.
- `public/models/`: GLB original y variante móvil.
- `supabase/schema.sql`: esquema y seguridad de datos.
- `supabase/functions/whatsapp-assistant/`: webhook, envío diario y procesamiento de respuestas.
- `.github/workflows/pages.yml`: prueba, compilación y publicación.

El directorio `server/` se conserva como referencia histórica de la versión local con SQLite; GitHub Pages no lo ejecuta.
