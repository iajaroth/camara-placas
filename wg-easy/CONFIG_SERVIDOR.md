# Configuración WireGuard Cliente (VPS)

## En tu VPS, ejecuta:

```bash
# 1. Crear directorio
mkdir -p wg-easy/config

# 2. Generar claves
wg genkey | tee wg-easy/config/private.key
cat wg-easy/config/private.key | wg pubkey > wg-easy/config/public.key

# 3. Ver tu clave pública (envía esta al Mikrotik)
cat wg-easy/config/public.key
```

## 4. Crear wg0.conf en wg-easy/config/:

```ini
[Interface]
PrivateKey = TU_CLAVE_PRIVADA_AQUI
Address = 100.100.100.4/32
DNS = 1.1.1.1
MTU = 1420
Table = auto
PreUp = sysctl -w net.ipv4.ip_forward=1

[Peer]
PublicKey = CLAVE_PUBLICA_DEL_MIKROTIK
Endpoint = mikrotik-sts.cr-safe.com:13231
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
```

## 5. Levantar el contenedor:
```bash
cd wg-easy
docker compose up -d
```

## 6. Verificar conexión:
```bash
docker exec -it wireguard wg show
```

---

## Para agregar en el Mikrotik:

Necesitas la **CLAVE PÚBLICA** de esta VPS (del paso 3) y agregar un peer:

```
/interface wireguard peer add allowed-address=100.100.100.4/32 endpoint-address=mikrotik-sts.cr-safe.com endpoint-port=13231 public-key=TU_CLAVE_PUBLICA persistent-keepalive=25s
```
