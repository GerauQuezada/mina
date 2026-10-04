# Contexto de traspaso para otra cuenta de Codex

## Objetivo del proyecto

**MINA OMAR MIRANDA** es una aplicación web privada, responsive y con estilo glassmorphism para administrar labores, socios, producción, sacos, gastos, préstamos, ventas, reportes y recorridos 2D/3D de una mina.

Repositorio: `https://github.com/GerauQuezada/mina`

Sitio publicado: `https://gerauquezada.github.io/mina/`

Supabase público configurado: `https://tmvziqnztypvvujcwthz.supabase.co`

## Estado actual

- La aplicación se publica gratis mediante GitHub Pages.
- La autenticación y los datos compartidos entre dispositivos usan Supabase.
- El registro público está desactivado y el acceso depende del usuario autorizado creado en Supabase.
- El dashboard se recalcula al modificar labores, producción, sacos, gastos, préstamos y ventas.
- El dashboard separa la participación del propietario en labores con socios, la producción propia al 100 % y el total combinado.
- Los socios y préstamos admiten fotografías/comprobantes.
- Las ventas registran fecha, hora, peso, ley, ingreso y ganancia.
- El precio del oro se consulta en línea con manejo de fallos.
- `Recorrido 2D` muestra `public/images/mapa-recorrido-mina.png` con zoom y desplazamiento.
- `Modelo 3D` usa el GLB original y una variante móvil; admite vista exterior y recorrido interno en primera persona.
- El recorrido interno tiene teclado/ratón en escritorio y joystick/gestos en móvil, seguimiento del suelo y perfil reducido para galerías angostas.

## Archivos clave

- `src/lib/cloud.ts`: autenticación, sesión y sincronización con Supabase.
- `src/lib/api.ts`: reglas de negocio, persistencia y cálculos del dashboard.
- `src/pages/`: pantallas de la aplicación.
- `src/pages/MineMap.tsx`: mapa/recorrido 2D.
- `src/pages/Model3D.tsx`: visor y recorrido 3D.
- `src/three/walkPhysics.ts`: movimiento y colisiones.
- `src/three/walkConfig.ts`: `WALK_START_POSITION` y `WALK_START_TARGET`.
- `public/models/mine.glb`: modelo original.
- `public/models/mine-mobile.glb`: variante optimizada para teléfonos.
- `public/cloud-config.json`: URL y clave pública de Supabase.
- `supabase/schema.sql`: tablas, políticas RLS y funciones.
- `.github/workflows/pages.yml`: pruebas, build y despliegue en GitHub Pages.
- `tests/`: pruebas automatizadas.

## Reglas que deben conservarse

- No reconstruir ni modificar visualmente la geometría original del GLB.
- Mantener el modo exterior y el modo `Recorrido` interno.
- En el recorrido, permitir entrar en espacios angostos sin flotar ni caer por huecos del escaneo.
- Evitar que la cámara atraviese las paredes principales; los obstáculos pequeños o ruido de escaneo no deben bloquear toda la ruta.
- Mantener compatibilidad completa con celulares.
- No guardar contraseñas, claves `service_role`, tokens ni sesiones en GitHub.
- Probar antes de publicar con `npm test` y `npm run build`.

## Cómo continuar en otra PC

1. Instalar Git, Node.js 22 LTS o superior y Visual Studio Code.
2. Descomprimir el paquete completo.
3. Abrir la carpeta `MINA-OMAR-MIRANDA`.
4. Ejecutar `npm install`.
5. Ejecutar `npm run dev:web`.
6. Abrir `http://localhost:5173/mina/`.
7. Iniciar sesión manualmente en GitHub, Supabase y Codex con las cuentas correspondientes.

## Verificación

```powershell
npm test
npm run build
git status
git remote -v
```

## Información privada que no se incluye

Por seguridad, el paquete no contiene contraseñas de Gmail, GitHub, Supabase, Codex ni de la base de datos; tampoco contiene cookies o sesiones del navegador. Esos accesos se deben iniciar manualmente en la nueva computadora.

La clave presente en `public/cloud-config.json` es pública/publishable y está diseñada para utilizarse en el navegador. Nunca debe sustituirse por una clave privada `service_role`.

