# Continuar el proyecto en otra computadora

Este paquete contiene el código fuente, el modelo 3D, las imágenes, las pruebas y la configuración de despliegue de **MINA OMAR MIRANDA**.

## Programas que debe instalar

1. **Git para Windows**: https://git-scm.com/download/win
2. **Node.js 22 LTS o superior**: https://nodejs.org/
3. **Visual Studio Code** (recomendado): https://code.visualstudio.com/

No necesita copiar `node_modules`; se vuelve a generar automáticamente.

## Abrir y ejecutar

1. Descomprima el ZIP en una ubicación corta, por ejemplo `D:\MINA-OMAR-MIRANDA`.
2. Abra PowerShell dentro de esa carpeta.
3. Ejecute:

```powershell
npm install
npm run dev:web
```

4. Abra `http://localhost:5173/mina/`.

La configuración pública de Supabase ya está en `public/cloud-config.json`. Las contraseñas no están dentro del ZIP ni deben guardarse en GitHub.

## Comprobar cambios

```powershell
npm test
npm run build
```

## Continuar usando GitHub

El repositorio remoto es:

`https://github.com/GerauQuezada/mina.git`

La forma recomendada en la nueva computadora es clonar el repositorio para conservar el historial:

```powershell
git clone https://github.com/GerauQuezada/mina.git D:\MINA-OMAR-MIRANDA
Set-Location D:\MINA-OMAR-MIRANDA
npm install
npm run dev:web
```

Si empieza desde este ZIP, conecte la carpeta con GitHub así:

```powershell
git init
git remote add origin https://github.com/GerauQuezada/mina.git
git fetch origin
git checkout -B main origin/main
```

Antes de editar desde la nueva computadora, confirme que puede iniciar sesión en GitHub y en el proyecto de Supabase con sus propias cuentas.

## Qué no incluye el ZIP

- `node_modules`: ocupa cientos de MB y se regenera con `npm install`.
- `dist`: es una compilación temporal y se regenera con `npm run build`.
- `.git`: el historial se obtiene desde GitHub.
- bases SQLite de pruebas en `data`.
- contraseñas, claves privadas o sesiones del navegador.

