# MINA OMAR MIRANDA

Aplicación web gratuita para administrar labores, producción, gastos, recuperaciones, liquidaciones y ventas, con gráficos glassmorphism, reportes, auditoría, plano 2D y recorrido interno en primera persona sobre el GLB real de la mina.

## Sitio público 24/7

La aplicación se publica automáticamente con GitHub Pages mediante `.github/workflows/pages.yml`. No usa Render, tarjetas, suscripciones ni servidores de pago.

- URL prevista: `https://gerauquezada.github.io/mina/`
- Cada cambio enviado a `main` ejecuta pruebas, compila y actualiza el sitio.
- GitHub sirve los archivos estáticos con HTTPS y disponibilidad continua.

GitHub Pages no ejecuta Node, Express ni SQLite. Por esa razón, la versión pública guarda cuentas, registros y comprobantes en el almacenamiento local de cada navegador. Los datos de un teléfono no aparecen automáticamente en otro teléfono. Use **Reportes** para descargar respaldos CSV o Excel.

## Uso local

```powershell
Set-Location 'D:\MINA-OMAR-MIRANDA'
npm install
npm run dev:web
```

Abra `http://localhost:5173/mina/`. En el primer acceso se crea el administrador local del dispositivo. La contraseña se transforma en un hash SHA-256 mediante Web Crypto antes de guardarse; nunca se incluye en GitHub.

## Gráficos de progresión

Producción, Gastos, Recuperaciones, Liquidaciones y Ventas muestran paneles de evolución que responden al filtro de labor y a la búsqueda actual. Incluyen líneas de colores, acumulados y distribuciones por labor o categoría.

## Modelo 3D y recorrido interno

`public/models/mine.glb` conserva el modelo original y `public/models/mine-mobile.glb` mantiene la misma geometría con texturas optimizadas para teléfonos.

El modo **Recorrido** usa navegación en primera persona:

- WASD o flechas y ratón con Pointer Lock en escritorio.
- Joystick izquierdo y arrastre derecho en móvil.
- Movimiento relativo a la mirada, gravedad y altura humana.
- Colisiones contra los triángulos reales mediante `three-mesh-bvh`.
- Detección automática de una entrada transitable y coordenadas X/Y/Z de depuración.

La reserva manual está en `src/three/walkConfig.ts`, en `WALK_START_POSITION` y `WALK_START_TARGET`. No se modifica ni se reconstruye la geometría visible del GLB.

## Persistencia gratuita

- La información queda en `localStorage` del navegador actual.
- La sesión activa queda en `sessionStorage`.
- Los comprobantes admiten hasta 1 MB para respetar el límite del navegador.
- Limpiar los datos del sitio elimina los registros locales.
- Para usar otro dispositivo se crea allí una cuenta local nueva.

Esta arquitectura es la única forma de alojar todo gratuitamente solo con GitHub Pages. Para sincronización entre dispositivos haría falta un servicio externo de base de datos.

## Pruebas y compilación

```powershell
npm test
npm run build
```

Las pruebas cubren reparto 50/50, porcentajes personalizados, gastos, recuperaciones, ventas y validación de porcentajes. La compilación genera `dist/`, que GitHub Actions publica automáticamente.

## Estructura principal

- `src/lib/api.ts`: base local y reglas de persistencia del navegador.
- `src/pages/`: dashboard, registros, reportes, mapa y visor 3D.
- `src/components/TrendCharts.tsx`: gráficos de progresión.
- `src/three/walkConfig.ts`: posición y objetivo configurables del recorrido.
- `public/models/`: GLB original y variante móvil.
- `.github/workflows/pages.yml`: prueba, compilación y publicación gratuita.

El directorio `server/` se conserva únicamente como referencia de la versión local con SQLite; GitHub Pages no lo ejecuta.
