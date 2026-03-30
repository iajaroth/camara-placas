import { useState, useEffect, useRef, useCallback } from 'react'
import './index.css'

const API = import.meta.env.VITE_API_URL || '/api'

function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatDate(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
}

function formatFull(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function App() {
  const [tab, setTab] = useState('live')
  const [camera, setCamera] = useState({ status: 'connecting' })
  const [snapshot, setSnapshot] = useState(null)
  const [snapshotTs, setSnapshotTs] = useState(null)
  const [events, setEvents] = useState([])
  const [filter, setFilter] = useState('')
  const [diagResults, setDiagResults] = useState(null)
  const [diagLoading, setDiagLoading] = useState(false)
  const [records, setRecords] = useState([])
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const eventSourceRef = useRef(null)
  const snapshotInterval = useRef(null)

  // Health check
  useEffect(() => {
    checkHealth()
    const iv = setInterval(checkHealth, 15000)
    return () => clearInterval(iv)
  }, [])

  // Snapshot polling
  useEffect(() => {
    if (tab === 'live' && autoRefresh) {
      fetchSnapshot()
      snapshotInterval.current = setInterval(fetchSnapshot, 3000)
      return () => clearInterval(snapshotInterval.current)
    }
    return () => clearInterval(snapshotInterval.current)
  }, [tab, autoRefresh])

  // SSE event stream
  useEffect(() => {
    connectSSE()
    return () => disconnectSSE()
  }, [])

  const checkHealth = async () => {
    try {
      const r = await fetch(`${API}/health`, { signal: AbortSignal.timeout(8000) })
      const data = await r.json()
      setCamera(data)
    } catch {
      setCamera(prev => ({ ...prev, status: 'offline', error: 'No se puede conectar al backend' }))
    }
  }

  const fetchSnapshot = async () => {
    try {
      const r = await fetch(`${API}/snapshot?t=${Date.now()}`, { signal: AbortSignal.timeout(12000) })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const blob = await r.blob()
      if (blob.size > 0) {
        if (snapshot) URL.revokeObjectURL(snapshot)
        setSnapshot(URL.createObjectURL(blob))
        setSnapshotTs(new Date().toISOString())
      }
    } catch (err) {
      console.warn('Snapshot:', err.message)
    }
  }

  const connectSSE = () => {
    if (eventSourceRef.current) return
    const es = new EventSource(`${API}/event-stream`)
    eventSourceRef.current = es
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.plateNumber) {
          setEvents(prev => {
            const exists = prev.find(p => p.id === data.id)
            if (exists) return prev
            return [data, ...prev].slice(0, 500)
          })
        }
      } catch {}
    }
    es.onerror = () => {
      es.close()
      eventSourceRef.current = null
      setTimeout(connectSSE, 5000)
    }
  }

  const disconnectSSE = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
  }

  const runDiagnostic = async () => {
    setDiagLoading(true)
    try {
      const r = await fetch(`${API}/diagnose`)
      setDiagResults(await r.json())
    } catch (err) {
      setDiagResults({ error: err.message })
    }
    setDiagLoading(false)
  }

  const searchRecords = async () => {
    setRecordsLoading(true)
    try {
      const r = await fetch(`${API}/records`)
      const data = await r.json()
      setRecords(data.records || [])
    } catch (err) {
      console.error('Records:', err)
      setRecords([])
    }
    setRecordsLoading(false)
  }

  const filteredEvents = filter
    ? events.filter(e => e.plateNumber?.toLowerCase().includes(filter.toLowerCase()))
    : events

  const statusClass = camera.status === 'online' ? 'online' : camera.status === 'connecting' ? 'connecting' : 'offline'
  const statusText = camera.status === 'online' ? 'Cámara Online' : camera.status === 'connecting' ? 'Conectando...' : 'Cámara Offline'

  return (
    <div className="app">
      {/* HEADER */}
      <header className="header">
        <div className="header-left">
          <div className="header-logo">📷</div>
          <div>
            <div className="header-title">CámaraPlacas</div>
            <div className="header-subtitle">Dahua ITC413 • {camera.camera || '192.168.38.200'}</div>
          </div>
        </div>
        <div className={`status-badge ${statusClass}`}>
          <span className="status-dot"></span>
          {statusText}
        </div>
      </header>

      {/* TABS */}
      <div className="tabs">
        <button className={`tab ${tab === 'live' ? 'active' : ''}`} onClick={() => setTab('live')}>
          📹 En Vivo
        </button>
        <button className={`tab ${tab === 'events' ? 'active' : ''}`} onClick={() => setTab('events')}>
          🚗 Placas
          {events.length > 0 && <span className="tab-badge">{events.length}</span>}
        </button>
        <button className={`tab ${tab === 'records' ? 'active' : ''}`} onClick={() => setTab('records')}>
          📁 Grabaciones
        </button>
        <button className={`tab ${tab === 'info' ? 'active' : ''}`} onClick={() => setTab('info')}>
          ⚙️ Diagnóstico
        </button>
      </div>

      {/* LIVE VIEW */}
      {tab === 'live' && (
        <div className="grid">
          <div className="card">
            <div className="card-header">
              <span className="card-title">📹 Vista en Vivo</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => setAutoRefresh(!autoRefresh)}>
                  {autoRefresh ? '⏸ Pausar' : '▶ Reanudar'}
                </button>
                <button className="btn btn-accent" onClick={fetchSnapshot}>📸 Capturar</button>
              </div>
            </div>
            <div className="video-container">
              {snapshot ? (
                <>
                  <img src={snapshot} alt="Cámara en vivo" />
                  <span className="live-badge">LIVE</span>
                  {snapshotTs && <span className="snapshot-time">{formatTime(snapshotTs)}</span>}
                </>
              ) : (
                <div className="snapshot-loading">
                  <div className="spinner"></div>
                  <span>Conectando a la cámara...</span>
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <span className="card-title">🚗 Últimas Detecciones</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{events.length} total</span>
            </div>
            <div className="records-list">
              {events.slice(0, 15).map((evt) => (
                <div key={evt.id} className="record-item new-event">
                  <div className="record-left">
                    <div className="record-icon">🚗</div>
                    <div>
                      <div className="plate-number">{evt.plateNumber}</div>
                      <div className="record-meta">
                        {evt.plateColor !== 'Unknown' && `Color: ${evt.plateColor}`}
                        {evt.lane > 0 && ` • Carril: ${evt.lane}`}
                        {evt.speed > 0 && ` • ${evt.speed} km/h`}
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="record-time">{formatTime(evt.timestamp)}</div>
                    <div className="record-date">{formatDate(evt.timestamp)}</div>
                  </div>
                </div>
              ))}
              {events.length === 0 && (
                <div className="empty-state">
                  <div className="empty-state-icon">🔍</div>
                  <div className="empty-state-text">Esperando detecciones de placas...</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* EVENTS / PLATES TAB */}
      {tab === 'events' && (
        <div className="card">
          <div className="filter-bar">
            <input
              type="text"
              className="filter-input"
              placeholder="🔍 Buscar por número de placa..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <button className="btn btn-danger" onClick={() => setEvents([])}>🗑️ Limpiar</button>
          </div>
          <div className="stats-bar">
            <div className="stat-item">Total: <span className="stat-value">{events.length}</span></div>
            <div className="stat-item">Filtradas: <span className="stat-value">{filteredEvents.length}</span></div>
          </div>
          <div className="events-container">
            {filteredEvents.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">{filter ? '🔍' : '📡'}</div>
                <div className="empty-state-text">
                  {filter ? 'No se encontraron placas con ese filtro' : 'Esperando eventos de la cámara...'}
                </div>
              </div>
            ) : (
              filteredEvents.map((evt) => (
                <div key={evt.id} className="record-item new-event">
                  <div className="record-left">
                    <div className="record-icon">🚗</div>
                    <div>
                      <div className="plate-number">{evt.plateNumber}</div>
                      <div className="record-meta">
                        {evt.plateColor !== 'Unknown' && `Color placa: ${evt.plateColor}`}
                        {evt.vehicleColor && ` • Vehículo: ${evt.vehicleColor}`}
                        {evt.lane > 0 && ` • Carril: ${evt.lane}`}
                        {evt.speed > 0 && ` • ${evt.speed} km/h`}
                        {evt.source && ` • Fuente: ${evt.source}`}
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="record-time">{formatTime(evt.timestamp)}</div>
                    <div className="record-date">{formatDate(evt.timestamp)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* RECORDS TAB */}
      {tab === 'records' && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">📁 Grabaciones / Registros en Cámara</span>
            <button className="btn btn-accent" onClick={searchRecords} disabled={recordsLoading}>
              {recordsLoading ? '⏳ Buscando...' : '🔍 Buscar últimas 24h'}
            </button>
          </div>
          {recordsLoading ? (
            <div className="empty-state"><div className="spinner"></div></div>
          ) : records.length > 0 ? (
            <div className="events-container">
              {records.map((rec, i) => (
                <div key={i} className="record-item">
                  <div className="record-left">
                    <div className="record-icon">📄</div>
                    <div>
                      <div className="plate-number" style={{ fontSize: 14 }}>{rec.FilePath || rec.FileName || `Registro ${i + 1}`}</div>
                      <div className="record-meta">
                        Canal: {rec.Channel || '1'}
                        {rec.Type && ` • Tipo: ${rec.Type}`}
                        {rec.FileLength && ` • ${Math.round(rec.FileLength / 1024)} KB`}
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="record-time">{rec.StartTime || ''}</div>
                    <div className="record-date">{rec.EndTime || ''}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">📁</div>
              <div className="empty-state-text">Presiona "Buscar" para consultar las grabaciones almacenadas en la cámara</div>
            </div>
          )}
        </div>
      )}

      {/* DIAGNOSTIC TAB */}
      {tab === 'info' && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">⚙️ Diagnóstico de Conexión</span>
            <button className="btn btn-accent" onClick={runDiagnostic} disabled={diagLoading}>
              {diagLoading ? '⏳ Probando...' : '🔧 Ejecutar Diagnóstico'}
            </button>
          </div>

          <div className="stats-bar">
            <div className="stat-item">Cámara: <span className="stat-value">{camera.camera || '—'}</span></div>
            <div className="stat-item">Estado: <span className="stat-value">{camera.status}</span></div>
            <div className="stat-item">Dispositivo: <span className="stat-value">{camera.device || '—'}</span></div>
            <div className="stat-item">Eventos: <span className="stat-value">{camera.eventsStored || 0}</span></div>
          </div>

          {camera.error && (
            <div style={{ padding: '12px 20px', background: 'var(--danger-bg)', color: 'var(--danger)', fontSize: 13, borderBottom: '1px solid var(--border)' }}>
              ⚠️ Error: {camera.error}
            </div>
          )}

          {diagLoading && (
            <div className="empty-state"><div className="spinner"></div><p>Probando endpoints de la cámara...</p></div>
          )}

          {diagResults?.results && (
            <div className="diag-grid">
              {diagResults.results.map((r, i) => (
                <div key={i} className="diag-item">
                  <div className={`diag-status ${r.ok ? 'ok' : 'fail'}`}></div>
                  <div className="diag-name">{r.name}</div>
                  <div className="diag-detail">
                    {r.ok ? r.preview?.substring(0, 120) : (r.error || `HTTP ${r.status}`)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!diagResults && !diagLoading && (
            <div className="empty-state">
              <div className="empty-state-icon">🔧</div>
              <div className="empty-state-text">Ejecuta el diagnóstico para probar la conectividad con la cámara y verificar qué endpoints están disponibles</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default App
