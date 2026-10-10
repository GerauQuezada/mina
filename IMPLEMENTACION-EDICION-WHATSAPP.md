# Edición y WhatsApp: estado real

## Alcance protegido

El modelo original no se sobrescribe: el editor añade capas y guarda transformaciones aparte. Los cambios a los adaptadores de datos están limitados a la ruta de proyectos del editor y al almacenamiento privado de ampliaciones. No se reescribieron producción, gastos, ventas ni el recorrido existente.

## Edición

- GLB y PLY, también dentro de ZIP; Gaussian PLY conserva sus datos y utiliza Spark. PLY sin caras se muestra como puntos.
- Ajustes manuales de posición, rotación, escala, pasos finos y alineación por tres referencias correspondientes.
- Interfaz adaptada mediante estilos exclusivos del editor. Falta comprobar visualmente en el iPhone del propietario: las pruebas de compilación no prueban interacción táctil.
- Medición de polilíneas. Antes de calibrar se muestran unidades del modelo (`u`), no metros supuestos. La escala se confirma explícitamente o se calcula con una distancia física conocida; ese estado se guarda en el proyecto. Precisión condicionada por el escaneo y los puntos seleccionados, especialmente en nubes de puntos/splats.
- Archivos locales en IndexedDB y copia privada en Supabase si el bucket está operativo y el archivo no supera su límite. No se garantiza copia privada cuando la interfaz indica guardado solo local.
- Guardar reintenta las copias pendientes, muestra el fallo concreto y conserva posiciones modificadas durante la subida. Un borrador local sin sincronizar se conserva al recargar en vez de ser sustituido silenciosamente por una versión remota antigua. Deshacer/rehacer también marca el borrador pendiente. Una eliminación remota confirmada no resucita desde una copia local ya sincronizada.

## WhatsApp

- Conector Baileys instalado, servicio de audio local instalado y probado con una voz sintetizada en español, Ollama probado con sacos y gastos. No se ha vinculado una cuenta real todavía.
- Solo números individuales habilitados, asociados a una labor activa. No lectura de todos los chats ni sincronización de historial/grupos.
- Recordatorios por hora de Lima, con recuperación dentro del día y registro persistente para evitar duplicados.
- Mensajes de texto/audio, identificación de sacos, gastos, sin trabajo o desmonte; los mensajes dudosos entran a revisión. La IA nunca decide la labor.
- Función SQL privada separada para fecha del reporte, propietario y deduplicación del mensaje; todavía no aplicada en la cuenta real.

## Para completar la verificación real

1. Completar `SUPABASE_SERVICE_ROLE_KEY` solo en `whatsapp-bridge/.env`, excluido de Git. No es la contraseña de la base de datos ni una clave pública.
2. Aplicar `supabase/whatsapp-qr.sql` en el proyecto correspondiente, después de comprobar su esquema actual.
3. Iniciar `whatsapp-bridge/start-local.ps1` y vincular el teléfono desde la sección WhatsApp. El administrador debe escanear el QR.
4. Confirmar los números/labores y horario antes de activar los envíos reales. Probar texto, audio, desmonte y sin trabajo; comprobar la labor y fecha en Supabase y el dashboard.
5. Si se accede desde otro dispositivo, abrir el túnel HTTPS del conector y colocar su URL en la web. La PC debe seguir encendida. Nunca exponer el puerto de transcripción.
6. Adjuntar el ZIP concreto que no se visualizaba para verificar su contenido y render. Probar el encaje y la medición en el iPhone, además de PC.
7. La publicación de la web no instala el conector privado ni aplica la función SQL. No publicar `.env`, sesiones, datos privados ni entornos instalados. La vinculación real de WhatsApp requiere completar los pasos anteriores incluso después de desplegar GitHub Pages.

CloudCompare: el instalador fue verificado, pero la instalación se canceló. No está instalado ni es imprescindible para el encaje manual de la web.

Última comprobación: 53 pruebas automatizadas correctas, incluido rechazo persistente de mensajes repetidos, recuperación de recordatorios, guardado de la escala verificada, reintento de archivos y recuperación de borradores del editor. Comprobación TypeScript del conector correcta. La clave privada sigue sin configurar: no se considera completada la prueba de WhatsApp real.

Se añadió verificación de la función SQL con PostgreSQL local en memoria (PGlite, solo dependencia de desarrollo), utilizando las definiciones de tablas de `schema.sql` y el archivo SQL real, no una imitación de su lógica. Comprueba sacos y reparto, soles en céntimos, fecha histórica, aislamiento de propietarios, duplicados, sin trabajo/desmonte, rechazo de reportes inválidos, permisos y rollback ante fallo de almacenamiento. Se valida también que la labor siga siendo la misma entre la recepción del mensaje y el guardado: una reasignación durante la transcripción requiere revisión. La función SQL actual requiere el parámetro `p_expected_labor_id`, incluido por el conector. Estas pruebas no sustituyen aplicar la función ni probar el servicio contra Supabase real.
