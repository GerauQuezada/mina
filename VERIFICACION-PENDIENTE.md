# Verificación de la versión preparada para publicar

El proyecto se mantiene en D:\MINA-OMAR-MIRANDA. Supabase está configurado únicamente con su URL y clave pública; ninguna contraseña ni clave secreta forma parte del repositorio.

## Evidencia reunida

- `npm test`: incluye cuentas no autorizadas, abonos parciales/totales, rechazo de sobrepago, ingresos frente a ganancia neta, operaciones negativas, respaldos con fotos sin credenciales, concurrencia optimista y CSV seguro.
- Las pruebas unitarias simulan el servicio cloud; además, la integración real se verificó con autenticación, lectura, escritura sin cambios y controles anónimos contra Supabase.
- La autenticación real aceptó la cuenta propietaria y cargó el panel vacío desde Supabase. El registro público está desactivado. Una petición anónima recibió `401` al leer la tabla y la función de escritura rechazó el acceso como no autorizado.
- La pantalla principal separa la parte del propietario en labores con socios, la producción de labores propias al 100% y la suma de ambas. Las pruebas cubren el cálculo 50/50 y la propiedad completa.
- `tests/walk.test.ts` carga posiciones, índices y transformaciones reales de `public/models/mine.glb`, omitiendo únicamente imágenes/materiales en la copia de diagnóstico. Comprueba 78.803 triángulos, inicio bajo techo con suelo, avance, separación de paredes y que no se modifiquen las posiciones originales.
- Dimensiones originales: 22,248390 × 25,009112 × 46,964035 unidades. Centro aproximadamente (0, 0, 0), radio de esfera 28,836033. No se afirma que las unidades sean metros. Altura relativa de ojos 1,379400, radio 0,220704.
- Inicio interior detectado: (5,283993; 8,396501; 11,153958). Se observó visualmente una galería con sostenimiento y superficies escaneadas. No se ha identificado de forma concluyente la boca exterior física de la mina.
- La dirección inicial se elige probando la cápsula completa en 16 direcciones, no solo un rayo de mirada. El movimiento compartido entre visor y pruebas está en `src/three/walkPhysics.ts`.
- Se comprobó en navegador local: entrar, pequeño avance W, joystick, giro por arrastre derecho, restablecer y salir. Viewport 390 × 844; contenido medido sin desbordamiento horizontal. No es una prueba en teléfono físico ni una exploración exhaustiva de cada galería.
- Con registros ficticios se revisaron visualmente dashboard, tarjeta del oro, labores/foto de socio, préstamos/abonos, ventas, reportes y respaldos en viewport 390 × 844. Todos midieron `scrollWidth === clientWidth`. Los formularios largos usan desplazamiento interno. La cuadrícula de indicadores se ajustó a tres columnas antes para evitar texto cortado en escritorios medianos.
- El GLB omite metalnessFactor en sus materiales. El visor corrige el valor metálico en memoria para iluminar las superficies como roca; conserva archivos, geometría y mapas originales. Calidad adaptable utiliza las texturas móviles; el usuario puede seleccionar originales.

## Pendiente antes de entregar

1. Identificar la entrada exterior exacta si se requiere comenzar necesariamente en la boca física, recorrer más ramales y documentar los huecos/límites del escaneo. Las constantes editables están en `src/three/walkConfig.ts`; ahora se validan contra suelo y espacio libre antes de usarse.
2. Comprobar en un teléfono físico la carga de texturas originales y los gestos simultáneos joystick+mirada. La emulación móvil ya pasó sin desbordamiento horizontal.
3. El plan gratuito de Supabase tiene límites y posible pausa por inactividad; no prometer disponibilidad garantizada 24/7.

## Prueba local aislada del visor

Con `npm run dev:web`, abrir `http://localhost:5173/mina/tests/viewer.html`. Es un arnés de pruebas, no otra aplicación ni ruta de producción; no expone datos privados ni evita la autenticación. La compilación de producción solo tiene `index.html` como entrada.
