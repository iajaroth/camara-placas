# Cámara Placas - Dahua ITC413

Aplicación web para acceder a registros, imágenes y control de cámara Dahua ITC413-PW4D-Z1.

## Requisitos

- VPS con EasyPanel
- Wireguard VPN conectada a la red de la cámara (192.168.38.x)
- Docker y Docker Compose instalados

## Configuración

1. Copia el archivo `.env.example` a `.env` y configura las credenciales:
```bash
cp .env.example .env
# Edita .env con los datos de tu cámara
```

2. Configura la IP de la cámara según tu red Wireguard

## Despliegue en EasyPanel

### Opción 1: Git Repository (Recomendado)

1. Sube este proyecto a GitHub/GitLab
2. En EasyPanel:
   - App Type: **Compose**
   - Repository: URL de tu repositorio
   - Branch: main
   - Environment Variables: Añade las variables de `.env`

### Opción 2: Upload Manual

1.zip los archivos:
```bash
zip -r camara-placas.zip . -x "node_modules/*" -x ".git/*"
```

2. Sube el .zip en EasyPanel como "Compose App"

## Puertos

- Frontend: `3000`
- Backend API: `3001`

## Features

- ✅ Vista en vivo de la cámara
- ✅ Registro automático de placas detectadas
- ✅ Streaming de eventos en tiempo real
- ✅ Control PTZ (Pan/Tilt/Zoom)
- ✅ Búsqueda por placa
- ✅ Captura de snapshots

## Endpoints API

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/health` | Estado de la conexión |
| GET | `/api/snapshot` | Imagen actual |
| GET | `/api/stream` | URL RTSP |
| GET | `/api/events` | Lista de eventos |
| GET | `/api/event-stream` | Server-Sent Events |
| GET | `/api/records` | Grabaciones |
| POST | `/api/ptz` | Control PTZ |
| POST | `/api/capture` | Captura manual |
