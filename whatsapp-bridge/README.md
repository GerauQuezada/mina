# WhatsApp por QR

## Instalación en esta PC

Las dependencias Node de Baileys ya están instaladas y el conector pasó `npm run check`. Spark 2.3.1 está integrado en el editor web: detecta los PLY Gaussian, conserva sus bytes y utiliza su renderizador propio; los PLY normales siguen como malla o nube de puntos. No modifica la mina original. Spark se carga bajo demanda.

El entorno Python está en `.venv` y Ollama ya tenía los modelos `qwen2.5-coder:3b` y `:7b`. `.env` contiene las direcciones locales y **la clave service_role permanece vacía**. Completarla localmente y aplicar `supabase/whatsapp-qr.sql` es necesario antes de vincular el QR. Nunca copiar esa clave a GitHub. La prueba real de IA puede enviar mensajes a revisión; no se relajan las validaciones para forzar una respuesta.

Se añadieron ejemplos al extractor y la prueba real con `qwen2.5-coder:3b` reconoció correctamente “Hoy sacamos 18 sacos; gastamos 120 soles en gasolina”, conservando las validaciones de evidencia. El modelo de 7b superó el tiempo máximo en esta PC: por eso se configuró el de 3b. CloudCompare 2.13.2 verificó el hash del instalador, pero su instalación se canceló; **no está instalado**. No es una dependencia obligatoria de la web ni sustituye los controles de alineación del editor.

Después de completar la configuración, `powershell -File .\start-local.ps1` inicia los dos servicios ocultos. Los modelos de voz se guardan en `D:\MinaTools\whisper-models`. Las dependencias del proyecto permanecen junto al código existente en C: para no romper sus rutas. El script no abre puertos públicos ni activa recordatorios automáticamente. Consulta los registros privados de `runtime/` para comprobar el arranque.

Desde un teléfono, `127.0.0.1` es el propio teléfono: sigue haciendo falta una dirección HTTPS que llegue al conector de esta computadora. GitHub Pages solo aloja la interfaz, no ejecuta Baileys ni Whisper. No se ha verificado todavía un mensaje real o audio enviado por un socio, ni el ZIP concreto que no se veía (debe adjuntarse para probarlo).

Cloudflared 2026.10.0 está instalado en `D:\MinaTools\cloudflared\cloudflared.exe`, descargado del release oficial y comprobado contra su SHA-256. **No se abrió ningún túnel**. Cuando el conector esté configurado, puede iniciarse temporalmente con `& 'D:\MinaTools\cloudflared\cloudflared.exe' tunnel --url http://127.0.0.1:3080`. La URL HTTPS resultante se coloca en la sección WhatsApp. La URL temporal cambia al reiniciar y no garantiza disponibilidad 24/7; no exponer el transcriptor 3081. Fuente: https://github.com/cloudflare/cloudflared

El modelo de voz `small` está descargado en `D:\MinaTools\whisper-models\small` desde la revisión `536b0662742c02347bc0e980a01041f333bce120` de `Systran/faster-whisper-small`. Se fijó PyAV 16.1.0 porque PyAV 19 eliminó un argumento utilizado por Faster-Whisper 1.2.1.

Verificación del 10/10/2026: 42 pruebas de la web pasaron, compilación de producción correcta, comprobación TypeScript del conector correcta y auditorías npm sin vulnerabilidades conocidas. El servicio de transcripción devolvió HTTP 200 con “Hoy sacamos 18 sacos. Gastamos 120 soles en gasolina.” usando un audio sintetizado en español como prueba. Esto no valida todavía audios con ruido real de la mina. Los servicios de prueba se detuvieron al finalizar. No hay QR vinculado, túnel abierto ni recordatorios activos, y estos cambios locales aún no se publicaron en GitHub Pages.

Servicio independiente para mantener la cuenta vinculada. La web en GitHub Pages se conecta a este servicio para mostrar el QR. Requiere Node 22 o posterior y una computadora encendida o servidor persistente; GitHub Pages y las funciones temporales de Supabase no mantienen una sesión de WhatsApp Web.

## Preparación

1. En esta carpeta, ejecutar `npm install` y después `npm run check`. Se genera el lockfile; en instalaciones posteriores puedes usar `npm ci` con ese archivo.
2. Copiar `.env.example` a `.env`. Completar la clave **service_role** de Supabase solamente aquí, nunca en archivos públicos o en el formulario de la web.
   Ejecutar `supabase/whatsapp-qr.sql` en el SQL Editor de tu proyecto (requiere que `schema.sql` ya esté aplicado). Añade una función nueva privada; no reemplaza el webhook anterior. Restringe cada registro a su propietario y conserva la fecha real del reporte.
3. Ejecutar `npm start`.
4. Para usar desde un teléfono, exponer este servicio con una dirección HTTPS mediante un servidor propio o túnel. Un túnel también requiere que la computadora permanezca encendida. Poner `HOST=0.0.0.0` si el proxy lo requiere.
5. En la sección WhatsApp de la web introducir la URL del servicio. En la misma PC se puede usar `http://127.0.0.1:3080`; esa dirección no conecta al PC desde un teléfono.
6. Pulsar Obtener QR. En WhatsApp: Configuración → Dispositivos vinculados → Vincular dispositivo. Escanear el QR en otra pantalla.
7. Agregar los contactos autorizados y su labor, luego pulsar Activar recordatorios diarios.

La API comprueba la sesión de Supabase del administrador para entregar el QR y activar la automatización. Las sesiones de WhatsApp permanecen en `session/`, excluidas de Git. La automatización comienza pausada después de reiniciar: debe activarse conscientemente desde el dashboard. No se importan el historial de chats ni grupos; solo respuestas nuevas de números autorizados.

El registro de entregas se persiste antes de enviar para evitar duplicados tras un reinicio. Si una entrega queda en estado `pending` por un fallo de red, requiere revisión; no se reenvía automáticamente.

Si la conexión vuelve después de la hora programada, el conector recupera el recordatorio pendiente del mismo día al estar activado; no envía recordatorios de días anteriores. Los contactos duplicados/ambiguos o de labores inactivas no se procesan. Un mensaje que ya entró a revisión, incluido uno rechazado, no vuelve a importarse automáticamente por una retransmisión de WhatsApp.

## Audio

Configurar `TRANSCRIPTION_URL` a un endpoint compatible con Whisper (`POST multipart`, campos `file`, `model`, `language`; respuesta JSON `text`). Si no está configurado, el audio pasa a revisión; debes escucharlo en el chat original y escribir sus cifras.

Se incluye `transcription_server.py`, un servicio local opcional con Faster-Whisper. Requiere Python 3.10 o posterior. En una terminal dentro de esta carpeta:

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r transcription-requirements.txt
.\.venv\Scripts\python -m uvicorn transcription_server:app --host 127.0.0.1 --port 3081
```

El primer inicio descarga el modelo `small`; consume disco, RAM y tiempo de CPU. Para probar un modelo más pequeño configura `WHISPER_MODEL=base`. Usa `TRANSCRIPTION_URL=http://127.0.0.1:3081/v1/audio/transcriptions` en `.env`. No publiques el puerto 3081 en Internet. El audio temporal se elimina después de transcribirlo. Un audio poco claro puede contener errores: la transcripción no es una garantía de exactitud.

## Interpretación con IA local

Opcionalmente instala Ollama desde su sitio oficial, descarga un modelo adecuado a la RAM de tu equipo y configura `OLLAMA_URL=http://127.0.0.1:11434` y `OLLAMA_MODEL` con el nombre exacto de ese modelo. No se instala ni descarga un modelo automáticamente desde este proyecto.

El servicio llama a `/api/chat` con un esquema JSON y comprueba que las cifras tengan citas reales del reporte, incluyendo cantidades habladas en español. La IA no elige la labor: esa relación proviene únicamente del número autorizado. Se rechazan endpoints de IA que no sean locales para no transmitir la contabilidad a terceros. Sin Ollama se usan reglas y mensajes claros, por ejemplo `12 sacos; 40 soles en gasolina; 20 soles en comida`.

## Revisión de reportes

Mensajes ambiguos, fallos de transcripción/IA y errores de sincronización quedan en una bandeja persistente dentro de `runtime/reviews.jsonl`, excluida de Git. Solo el administrador autenticado puede verla y confirmar o descartar un reporte; descartar no modifica la contabilidad y mantiene el historial local. Se deduplica por identificador original de WhatsApp. El historial se añade a disco, sin reemplazar el archivo completo en cada mensaje.

Para confirmar, escribe los datos verificados con conceptos separados por punto y coma y comprueba la fecha. Si el contacto cambió de labor se impide la importación automática. Los mensajes recibidos tarde o que mencionan ayer/otra fecha no se registran como hoy automáticamente: puedes corregir su fecha en la bandeja y confirmar con la función privada QR. No se permiten fechas futuras. El mensaje original permanece en el historial de revisión.

Fuentes: https://docs.ollama.com/capabilities/structured-outputs y https://github.com/SYSTRAN/faster-whisper

## Verificación pendiente

El frontend y sus pruebas pueden ejecutarse sin este servicio. La sesión QR, la entrega real y los audios deben verificarse con las dependencias instaladas, la clave privada configurada y el usuario escaneando el código. La compilación de la web no prueba el servicio de WhatsApp. No configures simultáneamente el antiguo programador de Meta y este servicio para los mismos contactos.

## Límite actual

Baileys es un proyecto no oficial de WhatsApp. La sesión puede desconectarse y el uso puede estar sujeto a restricciones de WhatsApp. La ejecución 24/7 depende del equipo y su conexión. Este repositorio no proporciona alojamiento persistente gratuito garantizado.

Fuente: https://github.com/WhiskeySockets/Baileys
