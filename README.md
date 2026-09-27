# MINA OMAR MIRANDA

Aplicación web local para administrar labores, un socio responsable por labor, producción, gastos y comprobantes, recuperación de gastos, liquidaciones, ventas, reportes, auditoría, recorrido 2D y el modelo 3D real de la mina.

## Requisitos

- Windows 10/11
- Node.js 24 o superior (la base usa `node:sqlite`)
- Navegador moderno con WebGL: Chrome, Edge, Firefox o Safari

## Instalación y ejecución local

```powershell
Set-Location 'D:\MINA-OMAR-MIRANDA'
Copy-Item .env.example .env
npm install
npm run dev
```

Abra `http://localhost:5173`. En el primer acceso, el sistema muestra un formulario seguro para crear el administrador inicial. La contraseña se procesa con `scrypt`, se guarda únicamente como hash y no forma parte del frontend ni del repositorio.

Para probar la versión compilada:

```powershell
npm run build
$env:NODE_ENV='production'
npm start
```

La API escucha en `http://localhost:3001`. En desarrollo, Vite sirve la interfaz y reenvía las llamadas a la API.

## Variables de entorno

Copie `.env.example` a `.env` y cambie `AUTH_SECRET` por un valor largo y aleatorio. `DATABASE_URL` define la base SQLite y `STORAGE_URL` el directorio privado de comprobantes. `ADMIN_EMAIL` y `ADMIN_PASSWORD` se reservan para una futura inicialización automatizada; la instalación actual usa el flujo de primer acceso para evitar contraseñas escritas en archivos.

## Base de datos y migraciones

La instalación local usa SQLite real con WAL, claves foráneas, restricciones e índices. Se eligió por ser autocontenida, fiable y no requerir instalar un servidor de PostgreSQL en el equipo. El acceso está concentrado en `server/db.ts`, por lo que una migración futura a PostgreSQL puede realizarse sin cambiar la interfaz.

Al iniciar, las tablas e índices se crean de forma idempotente. Los datos quedan en `data/mina-omar-miranda.db`. Haga copias de seguridad de `data/` y `uploads/` con la aplicación detenida.

## Seguridad

- Sesiones aleatorias almacenadas en base de datos, con cookie `HttpOnly` y `SameSite=Strict`.
- Hash de contraseña mediante `scrypt` y comparación en tiempo constante.
- API protegida, control de rol administrador, rate limiting en autenticación y auditoría.
- Validación backend con Zod, consultas parametrizadas y restricciones de integridad en SQLite.
- Comprobantes limitados a JPG, PNG, WebP o PDF, con máximo de 8 MB y acceso autenticado.
- Borrado lógico para producción y gastos financieros.

En producción detrás de HTTPS, configure `NODE_ENV=production` para activar cookies `Secure`.

## Modelo 3D

El ZIP recibido contenía `Se ve bien.glb`. Se inspeccionó y se integró sin reemplazarlo:

- GLB 2.0, 43.93 MB.
- 16 mallas, 16 materiales y 16 texturas JPEG.
- Aproximadamente 236,409 vértices procesados por pasada.
- Caja envolvente aproximada: `22.25 × 25.01 × 46.96` unidades.
- Texturas originales de 4096×4096, con consumo elevado de GPU en conjunto.

`public/models/mine.glb` conserva la calidad original para PC. `public/models/mine-mobile.glb` conserva la misma geometría y reduce las texturas a un máximo de 1024 px; el archivo baja a 4.63 MB para móviles. El visor elige la variante según pantalla/capacidad y carga el GLB solamente al abrir el módulo 3D.

El modo **Recorrido** es navegación interna en primera persona, no una animación. En escritorio usa WASD o flechas, ratón con Pointer Lock, movimiento relativo a la dirección de la cámara, gravedad y altura de ojos. En móvil muestra un joystick analógico izquierdo y una zona táctil derecha para mirar.

Las colisiones se calculan contra los triángulos reales del GLB. Al cargar el modelo, `StaticGeometryGenerator` combina las 16 mallas únicamente para crear un collider invisible y `three-mesh-bvh` construye un BVH. El controlador utiliza una cápsula y `shapecast`, evitando raycast contra todos los triángulos en cada cuadro. La geometría y los materiales visibles no se modifican.

Al cargar, el visor analiza superficies, altura libre y aperturas laterales para escoger una entrada transitable próxima al borde del escaneo. La reserva editable se define en `src/three/walkConfig.ts` mediante `WALK_START_POSITION` y `WALK_START_TARGET`; se utiliza si no se detecta una entrada fiable. Durante el recorrido aparece un panel con las coordenadas X/Y/Z actuales para poder afinar manualmente la ubicación. El sistema calcula el bounding box, bounding sphere, altura, radio, velocidad y planos de cámara a partir de las dimensiones reales del modelo.

Para reemplazar el modelo:

1. Detenga la aplicación.
2. Reemplace `public/models/mine.glb` con otro GLB compatible.
3. Genere la variante móvil:

```powershell
npx @gltf-transform/cli resize public/models/mine.glb public/models/mine-mobile.glb --width 1024 --height 1024
```

4. Actualice la fila activa de `model3d` si desea conservar metadatos/versiones adicionales.

## Cálculos históricos

Todos los importes se guardan en céntimos para evitar errores decimales. Cada producción, gasto y liquidación guarda una copia de los porcentajes Mina/Socio aplicados; cambiar una labor de 50/50 a 60/40 no modifica su historia.

## Pruebas

```powershell
npm test
```

Las pruebas cubren reparto 50/50, porcentaje personalizado, gastos, recuperación pendiente, ventas y validación de porcentajes.

## Estructura

- `src/pages/`: dashboard, módulos administrativos, reportes, mapa y 3D.
- `src/components/`: navegación, modales y componentes compartidos.
- `server/index.ts`: API protegida, archivos y exportaciones.
- `server/db.ts`: esquema relacional, índices y auditoría.
- `server/calculations.ts`: reglas de negocio centralizadas.
- `data/`: base SQLite (no se versiona).
- `uploads/`: comprobantes privados (no se versionan).
- `public/models/`: GLB original y variante móvil.

## Despliegue

Esta entrega está configurada para uso local en el disco D, tal como se solicitó. Para exponerla a Internet se requiere HTTPS, copias de seguridad, almacenamiento de objetos para comprobantes y una base PostgreSQL administrada; no publique directamente el puerto local sin esas medidas.
