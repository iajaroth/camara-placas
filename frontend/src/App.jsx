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
  
  const pad = (n) => n.toString().padStart(2, '0')
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  
  return { start: fmt(start), end: fmt(end) }
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => localStorage.getItem('auth') === 'true')
  const [loginUser, setLoginUser] = useState('')
  const [loginPass, setLoginPass] = useState('')
  const [loginError, setLoginError] = useState('')

  const initDates = getInitialDates()
  
  const [tab, setTab] = useState('live') // live | records | info
  const [camera, setCamera] = useState({ status: 'connecting' })
  const [snapshot, setSnapshot] = useState(null)
  const [snapshotTs, setSnapshotTs] = useState(null)
  
  const [events, setEvents] = useState([])
  
  const [dateStart, setDateStart] = useState(initDates.start)
  const [dateEnd, setDateEnd] = useState(initDates.end)
  const [recordFilter, setRecordFilter] = useState('')
  
  const [diagResults, setDiagResults] = useState(null)
  const [diagLoading, setDiagLoading] = useState(false)
  
  const [records, setRecords] = useState([])
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  
  const [previewImage, setPreviewImage] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  
  const [selectedRecords, setSelectedRecords] = useState([])
  const [downloadingZip, setDownloadingZip] = useState(false)
  
  const eventSourceRef = useRef(null)
  const snapshotInterval = useRef(null)

  // Login handler
  const handleLogin = (e) => {
    e.preventDefault()
    if (loginUser === 'admin' && loginPass === 'STStec2703') {
      localStorage.setItem('auth', 'true')
      setIsAuthenticated(true)
      setLoginError('')
    } else {
      setLoginError('Usuario o contraseña incorrectos')
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('auth')
    setIsAuthenticated(false)
  }

  // Effect to pull data when authenticated
  useEffect(() => {
    if (!isAuthenticated) return

    checkHealth()
    const iv = setInterval(checkHealth, 15000)
    
    // Connect SSE
    connectSSE()
    
    return () => {
      clearInterval(iv)
      disconnectSSE()
    }
  }, [isAuthenticated])

  // Snapshot polling
  useEffect(() => {
    if (!isAuthenticated) return
    
    if (tab === 'live' && autoRefresh) {
      fetchSnapshot()
      snapshotInterval.current = setInterval(fetchSnapshot, 3000)
      return () => clearInterval(snapshotInterval.current)
    }
    return () => clearInterval(snapshotInterval.current)
  }, [tab, autoRefresh, isAuthenticated])

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
            // Solo keep the last 50 for the live tab to show "recent" plates
            return [data, ...prev].slice(0, 50)
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
      const startParam = dateStart ? dateStart.replace('T', ' ') + ':00' : ''
      const endParam = dateEnd ? dateEnd.replace('T', ' ') + ':59' : ''
      const q = new URLSearchParams()
      if (startParam) q.append('start', startParam)
      if (endParam) q.append('end', endParam)
      
      const r = await fetch(`${API}/records?${q.toString()}`)
      const data = await r.json()
      setRecords(data.records || [])
      setSelectedRecords([]) // Reset selection on new search
    } catch (err) {
      console.error('Records:', err)
      setRecords([])
      setSelectedRecords([])
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
      if (!r.ok) throw new Error('No se pudo cargar la imagen de la cámara')
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
    
    // Cleanup fields
    const copy = data.map(item => {
      const plate = item.PlateNumber || (item.Events && item.Events.includes('PlateNumber') ? 'Reconocida' : '')
      return {
        Placa: plate,
        FechaHoraInicial: item.StartTime || '',
        FechaHoraFinal: item.EndTime || '',
        Canal: item.Channel || '',
        TipoEvento: item.Type || '',
        RutaArchivo: item.FilePath || '',
        MedidaKB: item.FileLength ? Math.round(item.FileLength / 1024) : ''
      }
    })

    const keys = Object.keys(copy[0])
    const header = keys.join(',')
    const lines = copy.map(item => 
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

  const downloadSelectedImages = async () => {
    const paths = selectedRecords.map(i => filteredRecords[i]?.FilePath).filter(Boolean)
    if (!paths.length) return alert('No hay rutas válidas o imágenes en los registros seleccionados.')
    
    setDownloadingZip(true)
    try {
      const resp = await fetch(`${API}/download-images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths })
      })
      if (!resp.ok) throw new Error('Falló la creación del ZIP en el servidor')
      
      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `placas_fotos_${Date.now()}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      alert('Error descargando el ZIP: ' + err.message)
    }
    setDownloadingZip(false)
  }

  const toggleSelection = (idx) => {
    setSelectedRecords(prev => prev.includes(idx) ? prev.filter(x => x !== idx) : [...prev, idx])
  }

  const toggleSelectAll = () => {
    if (selectedRecords.length === filteredRecords.length) {
      setSelectedRecords([])
    } else {
      setSelectedRecords(filteredRecords.map((_, i) => i))
    }
  }

  // Filtrado de registros obtenidos desde la cámara
  const filteredRecords = records.filter(rec => {
    if (!recordFilter) return true
    const hint = rec.PlateNumber || ''
    return hint.toLowerCase().includes(recordFilter.toLowerCase())
  })

  // === RENDER LOGIN APP ===
  if (!isAuthenticated) {
    return (
      <div className="app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', padding: 20 }}>
        <div className="card" style={{ maxWidth: 400, width: '100%', padding: 40 }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div className="header-logo" style={{ margin: '0 auto 16px auto', width: 64, height: 64, fontSize: 32 }}>📷</div>
            <div className="header-title" style={{ fontSize: 24 }}>MC47-Main2</div>
            <div className="header-subtitle">Acceso de Seguridad</div>
          </div>
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="filter-group">
              <span className="filter-label">Usuario</span>
              <input 
                type="text" 
                className="filter-input" 
                style={{ width: '100%', boxSizing: 'border-box' }}
                value={loginUser} 
                onChange={e => setLoginUser(e.target.value)} 
                autoFocus 
              />
            </div>
            <div className="filter-group">
              <span className="filter-label">Contraseña</span>
              <input 
                type="password" 
                className="filter-input" 
                style={{ width: '100%', boxSizing: 'border-box' }}
                value={loginPass} 
                onChange={e => setLoginPass(e.target.value)} 
              />
            </div>
            {loginError && <div style={{ color: 'var(--danger)', fontSize: 13, background: 'var(--danger-bg)', padding: '8px 12px', borderRadius: 6 }}>{loginError}</div>}
            <button type="submit" className="btn btn-accent" style={{ marginTop: 8, justifyContent: 'center', padding: '12px' }}>
              Iniciar Sesión
            </button>
          </form>
        </div>
      </div>
    )
  }

  const statusClass = camera.status === 'online' ? 'online' : camera.status === 'connecting' ? 'connecting' : 'offline'
  const statusText = camera.status === 'online' ? 'Online' : camera.status === 'connecting' ? 'Conectando...' : 'Offline'

  // === RENDER MAIN APP ===
  return (
    <div className="app">
      {/* HEADER */}
      <header className="header" style={{ marginBottom: 16 }}>
        <div className="header-left">
          <div className="header-logo">📷</div>
          <div>
            <div className="header-title">MC47-Main2</div>
            <div className="header-subtitle">Cámara LPR • {camera.camera || '192.168.38.200'}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div className={`status-badge ${statusClass}`}>
            <span className="status-dot"></span>
            {statusText}
          </div>
          <button className="btn" onClick={handleLogout} style={{ padding: '6px 10px', fontSize: 11 }}>Salir</button>
        </div>
      </header>

      {/* TABS (Bottom nav on mobile) */}
      <div className="tabs">
        <button className={`tab ${tab === 'live' ? 'active' : ''}`} onClick={() => setTab('live')}>
          📹 En Vivo
        </button>
        <button className={`tab ${tab === 'records' ? 'active' : ''}`} onClick={() => setTab('records')}>
          🔍 Buscar Placas
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
              <span className="card-title">🚗 Placas Recientes</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Muestra memoria rápida en vivo</span>
            </div>
            <div className="records-list">
              {events.map((evt) => (
                <div key={evt.id} className="record-item new-event">
                  <div className="record-left">
                    <div className="record-icon">🚗</div>
                    <div>
                      <div className="plate-number">{evt.plateNumber}</div>
                      <div className="record-meta">
                        {evt.plateColor !== 'Unknown' && `Color: ${evt.plateColor}`}
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
                   <div className="empty-state-icon">📡</div>
                   <div className="empty-state-text">Esperando detecciones de placas en tiempo real...</div>
                 </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* RECORDS TAB: NOW "BUSCAR PLACAS" */}
      {tab === 'records' && (
        <div className="card">
          <div className="filter-bar">
            <div className="filter-row">
              <div className="filter-group" style={{ flex: '1.5' }}>
                <span className="filter-label">Filtro de Placa</span>
                <input
                  type="text"
                  className="filter-input"
                  placeholder="Ejem: AAA111 (aplica tras buscar)"
                  value={recordFilter}
                  onChange={(e) => setRecordFilter(e.target.value)}
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
            <div className="filter-row" style={{ marginTop: '12px', gap: 8 }}>
              <button className="btn btn-accent" onClick={searchRecords} disabled={recordsLoading}>
                {recordsLoading ? '⏳ Consultando sistema...' : '🔍 Buscar'}
              </button>
              
              <div style={{ flex: 1 }}></div>

              <button 
                className="btn btn-accent" 
                onClick={downloadSelectedImages}
                disabled={selectedRecords.length === 0 || downloadingZip}
                style={{ background: selectedRecords.length ? 'var(--accent)' : 'var(--bg-input)' }}
              >
                {downloadingZip ? '⏳ Comprimiendo ZIP...' : `⬇️ Descargar Fotos (${selectedRecords.length})`}
              </button>
              
              <button 
                className="btn btn-accent" 
                onClick={() => exportCSV(filteredRecords, 'registros_camara')} 
                disabled={filteredRecords.length === 0}
                style={{ background: filteredRecords.length ? '' : 'var(--bg-input)' }}
              >
                ⬇️ Descargar Resultados CSV
              </button>
            </div>
          </div>
          
          <div className="stats-bar">
            <div className="stat-item">Resultados: <span className="stat-value">{filteredRecords.length}</span></div>
            {filteredRecords.length > 0 && (
              <div className="stat-item" style={{marginLeft: 16, cursor: 'pointer', color: 'var(--accent)'}} onClick={toggleSelectAll}>
                {selectedRecords.length === filteredRecords.length ? '☑️ Deseleccionar Todos' : '✅ Seleccionar Todos'}
              </div>
            )}
            <div className="stat-item" style={{marginLeft: 'auto', fontSize: '11px'}}>
              Extraído directamente del almacenamiento interno
            </div>
          </div>
          
          {recordsLoading ? (
            <div className="empty-state"><div className="spinner"></div><p style={{marginTop: 12}}>Analizando memoria interna de cámara...</p></div>
          ) : filteredRecords.length > 0 ? (
            <div className="events-container">
              {filteredRecords.map((rec, i) => {
                const placaText = rec.PlateNumber || 'Desconocida'
                const isSelected = selectedRecords.includes(i)
                return (
                  <div key={i} className="record-item" style={{ cursor: 'pointer', background: isSelected ? 'var(--dark-2)' : '' }} onClick={() => toggleSelection(i)}>
                    <div className="record-left">
                      <div className="record-icon" style={{ padding: '0 8px' }}>
                        <input 
                          type="checkbox" 
                          checked={isSelected} 
                          onChange={() => {}} 
                          style={{ width: 18, height: 18, cursor: 'pointer' }}
                        />
                      </div>
                      <div>
                        {/* We use PlateNumber extraction from backend */}
                        <div className="plate-number" style={{ fontSize: 16 }}>{placaText}</div>
                        <div className="record-meta" style={{ fontFamily: 'JetBrains Mono', fontSize: '10px' }}>
                          Archivo: {rec.FilePath ? rec.FilePath.substring(rec.FilePath.lastIndexOf('/') + 1) : 'Local'}
                        </div>
                        {rec.FilePath && (
                           <button 
                             className="btn btn-accent" 
                             style={{ padding: '4px 10px', fontSize: '11px', marginTop: '8px' }}
                             onClick={(e) => { e.stopPropagation(); viewFile(rec.FilePath); }}
                           >
                             👁️ Vista Previa
                           </button>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="record-time">{rec.StartTime?.split(' ')[1] || ''}</div>
                      <div className="record-date">{rec.StartTime?.split(' ')[0] || ''}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">📁</div>
              <div className="empty-state-text">Presiona "Buscar" para descargar el resumen de placas guardado en la última fecha seleccionada.</div>
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
            <div className="stat-item">Dispositivo: <span className="stat-value">{camera.device || 'MC47-Main2'}</span></div>
          </div>

          {camera.error && (
            <div style={{ padding: '12px 20px', background: 'var(--danger-bg)', color: 'var(--danger)', fontSize: 13, borderBottom: '1px solid var(--border)' }}>
              ⚠️ Error: {camera.error}
            </div>
          )}

          {diagLoading && (
            <div className="empty-state"><div className="spinner"></div><p>Probando endpoints de cámara...</p></div>
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
              <span className="record-meta">Archivo temporal descargado</span>
              <a href={previewImage} download={`imagen_placa_${new Date().getTime()}.jpg`} className="btn btn-accent">
                ⬇️ Descargar
              </a>
            </div>
          </div>
        </div>
      )}
      
    </div>
  )
}

export default App
