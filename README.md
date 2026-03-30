# Cámara Placas - Dahua ITC413

Aplicación web para monitorear registros, imágenes y detecciones de placas de cámara Dahua ITC413-PW4D-Z1.

## Arquitectura

```
[Usuario] → [VPS:8080 nginx] → [VPS:3001 backend] → [WireGuard VPN] → [Cámara 192.168.38.200]
```

- **Frontend**: React (Vite) servido por nginx, proxy API al backend
- **Backend**: Node.js + Express con autenticación Digest hacia la cámara
- **Conexión**: WireGuard VPN en la VPS para acceder a la red local de la cámara

## Requisitos

- VPS con Docker y Docker Compose
- WireGuard VPN conectada a la red de la cámara (192.168.38.x)
- Ping a 192.168.38.200 desde la VPS

## Despliegue rápido en VPS

```bash
# 1. Clonar o subir el proyecto
git clone <tu-repo> /opt/camara-placas
cd /opt/camara-placas

# 2. Configurar credenciales
cp .env.example .env
# Editar .env con: DAHUA_PASSWORD=STStec2703

# 3. Construir y levantar
docker compose up -d --build

# 4. Acceder
# Frontend: http://<ip-vps>:8080
# API directa: http://<ip-vps>:3001/api/health
```

### Si el backend NO alcanza la cámara vía Docker networking

Descomentar `network_mode: host` en `docker-compose.yml` para el servicio backend. 
Nota: al hacer esto el backend usa la red del host directamente y puede acceder al tunnel WireGuard.

## Verificar conexión

```bash
# Desde la VPS, verificar que la cámara responde:
curl --digest -u admin:STStec2703 http://192.168.38.200/cgi-bin/magicBox.cgi?action=getDeviceType

# Probar snapshot:
curl --digest -u admin:STStec2703 -o test.jpg http://192.168.38.200/cgi-bin/snapshot.cgi?channel=1
```

## Endpoints API

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/health` | Estado de conexión con la cámara |
| GET | `/api/diagnose` | Test de múltiples endpoints de la cámara |
| GET | `/api/snapshot` | Imagen actual (proxy con digest auth) |
| GET | `/api/stream` | URLs RTSP del stream |
| GET | `/api/events` | Eventos de placas almacenados |
| GET | `/api/event-stream` | SSE en tiempo real |
| POST | `/api/push` | Endpoint para recibir push de la cámara |
| GET | `/api/records` | Buscar grabaciones en almacenamiento |
| GET | `/api/config` | Configuración de la cámara |

## Features

- ✅ Vista en vivo (snapshot cada 3s)
- ✅ Detección automática de placas en tiempo real (SSE)
- ✅ Búsqueda/filtro de placas
- ✅ Diagnóstico de conexión a la cámara
- ✅ Búsqueda de grabaciones en almacenamiento
- ✅ Endpoint push para que la cámara envíe eventos
- ✅ Autenticación Digest HTTP correcta
- ✅ UI responsive con tema oscuro premium

## Puertos

- **8080**: Frontend (nginx)
- **3001**: Backend API (Express)
