import { useState, useEffect, useRef } from 'react'
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

function getInitialDates() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  
  // Format to YYYY-MM-DDTHH:mm for input[type="datetime-local"]
  const pad = (n) => n.toString().padStart(2, '0')
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  
  return { start: fmt(start), end: fmt(end) }
}

function App() {
  const initDates = getInitialDates()
  
  const [tab, setTab] = useState('live')
  const [camera, setCamera] = useState({ status: 'connecting' })
  const [snapshot, setSnapshot] = useState(null)
  const [snapshotTs, setSnapshotTs] = useState(null)
  const [events, setEvents] = useState([])
  const [filter, setFilter] = useState('')
  const [dateStart, setDateStart] = useState(initDates.start)
  const [dateEnd, setDateEnd] = useState(initDates.end)
  
  const [diagResults, setDiagResults] = useState(null)
  const [diagLoading, setDiagLoading] = useState(false)
  const [records, setRecords] = useState([])
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  
  const [previewImage, setPreviewImage] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  
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
            // Limitar a máximo 2000 eventos en memoria para mejor rendimiento
            return [data, ...prev].slice(0, 2000)
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
      // Convert datetime-local format back to standard YYYY-MM-DD HH:mm:ss string for camera
      const startParam = dateStart ? dateStart.replace('T', ' ') + ':00' : ''
      const endParam = dateEnd ? dateEnd.replace('T', ' ') + ':59' : ''
      const q = new URLSearchParams()
      if (startParam) q.append('start', startParam)
      if (endParam) q.append('end', endParam)
      
      const r = await fetch(`${API}/records?${q.toString()}`)
      const data = await r.json()
      setRecords(data.records || [])
    } catch (err) {
      console.error('Records:', err)
      setRecords([])
    }
    setRecordsLoading(false)
  }
  
  const viewFile = async (filePath) => {
    if (!filePath) return
    setPreviewLoading(true)
    setPreviewImage(null)
    try {
      const url = `${API}/camera-file?path=${encodeURIComponent(filePath)}&t=${Date.now()}`
      const r = await fetch(url)
      if (!r.ok) throw new Error('No se pudo cargar la imagen')
      const blob = await r.blob()
      setPreviewImage(URL.createObjectURL(blob))
    } catch (err) {
      alert('Error al cargar la imagen: ' + err.message)
    }
    setPreviewLoading(false)
  }

  const exportCSV = (data, prefix) => {
    if (!data.length) {
      alert('No hay datos para exportar')
      return
    }
    
    const keys = Object.keys(data[0])
    const header = keys.join(',')
    const lines = data.map(item => 
      keys.map(k => {
        const val = item[k] === null || item[k] === undefined ? '' : String(item[k])
        return `"${val.replace(/"/g, '""')}"`
      }).join(',')
    )
    
    const csv = [header, ...lines].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${prefix}_${new Date().toISOString().slice(0, 10)}.csv`
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Filtrado de eventos locales
  const filteredEvents = events.filter(evt => {
    // Texto
    if (filter && !evt.plateNumber?.toLowerCase().includes(filter.toLowerCase())) {
      return false
    }
    
    if (!evt.timestamp) return true
    
    // Fechas
    const evtTime = new Date(evt.timestamp).getTime()
    if (dateStart) {
      const s = new Date(dateStart).getTime()
      if (evtTime < s) return false
    }
    if (dateEnd) {
      const e = new Date(dateEnd).getTime()
      if (evtTime > e) return false
    }
    
    return true
  })

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

      {/* TABS (Bottom nav on mobile) */}
      <div className="tabs">
        <button className={`tab ${tab === 'live' ? 'active' : ''}`} onClick={() => setTab('live')}>
          📹 En Vivo
        </button>
        <button className={`tab ${tab === 'events' ? 'active' : ''}`} onClick={() => setTab('events')}>
          🚗 Placas
          {events.length > 0 && <span className="tab-badge">{events.length}</span>}
        </button>
        <button className={`tab ${tab === 'records' ? 'active' : ''}`} onClick={() => setTab('records')}>
          📁 Registros
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
            <div className="filter-row">
              <div className="filter-group">
                <span className="filter-label">Buscar Placa</span>
                <input
                  type="text"
                  className="filter-input"
                  placeholder="ABC-123"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </div>
              <div className="filter-group">
                <span className="filter-label">Desde</span>
                <input
                  type="datetime-local"
                  className="filter-input"
                  value={dateStart}
                  onChange={(e) => setDateStart(e.target.value)}
                />
              </div>
              <div className="filter-group">
                <span className="filter-label">Hasta</span>
                <input
                  type="datetime-local"
                  className="filter-input"
                  value={dateEnd}
                  onChange={(e) => setDateEnd(e.target.value)}
                />
              </div>
            </div>
            <div className="filter-row" style={{ marginTop: '8px', justifyContent: 'space-between' }}>
              <button className="btn btn-danger" onClick={() => { setFilter(''); setEvents([]); }}>🗑️ Limpiar Memoria</button>
              <button className="btn btn-accent" onClick={() => exportCSV(filteredEvents, 'placas_memoria')}>
                ⬇️ Descargar CSV
              </button>
            </div>
          </div>
          
          <div className="stats-bar">
            <div className="stat-item">Total Memoria: <span className="stat-value">{events.length}</span></div>
            <div className="stat-item">Filtradas: <span className="stat-value">{filteredEvents.length}</span></div>
            <div className="stat-item" style={{marginLeft: 'auto', fontSize: '11px', color: 'var(--warning)'}}>
              * Registro temporal (se pierde al reiniciar el backend)
            </div>
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
                        {evt.plateColor !== 'Unknown' && `Placa: ${evt.plateColor}`}
                        {evt.vehicleColor && ` • Vehículo: ${evt.vehicleColor}`}
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
              ))
            )}
          </div>
        </div>
      )}

      {/* RECORDS TAB */}
      {tab === 'records' && (
        <div className="card">
          <div className="filter-bar">
            <div className="filter-row">
              <div className="filter-group">
                <span className="filter-label">Desde</span>
                <input
                  type="datetime-local"
                  className="filter-input"
                  value={dateStart}
                  onChange={(e) => setDateStart(e.target.value)}
                />
              </div>
              <div className="filter-group">
                <span className="filter-label">Hasta</span>
                <input
                  type="datetime-local"
                  className="filter-input"
                  value={dateEnd}
                  onChange={(e) => setDateEnd(e.target.value)}
                />
              </div>
            </div>
            <div className="filter-row" style={{ marginTop: '8px', justifyContent: 'space-between' }}>
              <button className="btn btn-accent" onClick={searchRecords} disabled={recordsLoading}>
                {recordsLoading ? '⏳ Buscando en SD...' : '🔍 Buscar Grabaciones'}
              </button>
              <button 
                className="btn btn-accent" 
                onClick={() => exportCSV(records, 'registros_camara')} 
                disabled={records.length === 0}
                style={{ background: records.length ? '' : 'var(--bg-input)' }}
              >
                ⬇️ Descargar CSV
              </button>
            </div>
          </div>
          
          <div className="stats-bar">
            <div className="stat-item">Resultados: <span className="stat-value">{records.length}</span></div>
            <div className="stat-item" style={{marginLeft: 'auto', fontSize: '11px'}}>
              * Busca directamente en la memoria SD de la cámara
            </div>
          </div>
          
          {recordsLoading ? (
            <div className="empty-state"><div className="spinner"></div><p style={{marginTop: 12}}>Buscando en la cámara...</p></div>
          ) : records.length > 0 ? (
            <div className="events-container">
              {records.map((rec, i) => {
                // El número de placa a menudo está en Event o PlateNumber si es ANPR
                const hint = rec.PlateNumber || (rec.Events && rec.Events.includes('PlateNumber') ? 'Placa' : 'Registro')
                return (
                  <div key={i} className="record-item">
                    <div className="record-left">
                      <div className="record-icon">📄</div>
                      <div>
                        <div className="plate-number" style={{ fontSize: 13 }}>{hint} {i+1}</div>
                        <div className="record-meta" style={{ fontFamily: 'JetBrains Mono', fontSize: '10px' }}>
                          {rec.FilePath ? rec.FilePath.substring(rec.FilePath.lastIndexOf('/') + 1) : 'Archivo local'}
                          <br/>
                          Size: {rec.FileLength ? Math.round(rec.FileLength / 1024) + ' KB' : 'N/A'}
                        </div>
                        {rec.FilePath && (
                           <button 
                             className="btn btn-accent" 
                             style={{ padding: '2px 8px', fontSize: '10px', marginTop: '6px' }}
                             onClick={() => viewFile(rec.FilePath)}
                           >
                             👁️ Vista Previa
                           </button>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="record-time">{rec.StartTime || ''}</div>
                      <div className="record-date">{rec.EndTime || ''}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">📁</div>
              <div className="empty-state-text">Presiona "Buscar Grabaciones" para consultar la memoria SD de la cámara en el rango seleccionado</div>
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
        </div>
      )}
      
      {/* MODAL IMAGE PREVIEW */}
      {previewLoading && (
        <div className="modal-overlay">
          <div className="spinner" style={{ width: 40, height: 40 }}></div>
        </div>
      )}
      
      {previewImage && !previewLoading && (
        <div className="modal-overlay" onClick={() => setPreviewImage(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="card-title">👁️ Vista Previa</span>
              <button className="btn btn-danger" onClick={() => setPreviewImage(null)}>✕ Cerrar</button>
            </div>
            <div className="modal-body">
              <img src={previewImage} alt="Preview de cámara" className="modal-image" />
            </div>
            <div className="modal-header" style={{ borderTop: '1px solid var(--border)', borderBottom: 'none' }}>
              <span className="record-meta">Archivo temporal descargado de la memoria SD</span>
              <a href={previewImage} download={`imagen_camara_${new Date().getTime()}.jpg`} className="btn btn-accent">
                ⬇️ Descargar Imagen
              </a>
            </div>
          </div>
        </div>
      )}
      
    </div>
  )
}

export default App
