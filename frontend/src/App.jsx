import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import moment from 'moment'
import 'moment/locale/es'

moment.locale('es')

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'

function App() {
  const [activeTab, setActiveTab] = useState('live')
  const [status, setStatus] = useState('connecting')
  const [snapshot, setSnapshot] = useState(null)
  const [events, setEvents] = useState([])
  const [filter, setFilter] = useState('')
  const [ptzAction, setPtzAction] = useState(null)
  const eventSourceRef = useRef(null)

  useEffect(() => {
    checkStatus()
    const interval = setInterval(checkStatus, 30000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (activeTab === 'events') {
      connectEventStream()
    } else {
      disconnectEventStream()
    }
  }, [activeTab])

  useEffect(() => {
    if (activeTab === 'live') {
      fetchSnapshot()
      const interval = setInterval(fetchSnapshot, 5000)
      return () => clearInterval(interval)
    }
  }, [activeTab])

  const checkStatus = async () => {
    try {
      await axios.get(`${API_URL}/health`, { timeout: 5000 })
      setStatus('online')
    } catch {
      setStatus('offline')
    }
  }

  const fetchSnapshot = async () => {
    try {
      const response = await axios.get(`${API_URL}/snapshot`, { 
        responseType: 'blob',
        timeout: 10000 
      })
      const url = URL.createObjectURL(response.data)
      setSnapshot(url)
    } catch (err) {
      console.error('Snapshot error:', err)
    }
  }

  const connectEventStream = () => {
    if (eventSourceRef.current) return

    const eventSource = new EventSource(`${API_URL}/event-stream`)
    eventSourceRef.current = eventSource

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.plateNumber) {
          setEvents(prev => [data, ...prev].slice(0, 100))
        }
      } catch (e) {
        console.error('Event parse error:', e)
      }
    }

    eventSource.onerror = () => {
      eventSource.close()
      eventSourceRef.current = null
      setTimeout(connectEventStream, 5000)
    }
  }

  const disconnectEventStream = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
  }

  const handlePtz = async (action) => {
    setPtzAction(action)
    try {
      await axios.post(`${API_URL}/ptz`, { action })
    } catch (err) {
      console.error('PTZ error:', err)
    }
    setTimeout(() => setPtzAction(null), 500)
  }

  const handlePtzStop = async () => {
    try {
      await axios.post(`${API_URL}/ptz/stop`, { action: ptzAction })
    } catch (err) {
      console.error('PTZ stop error:', err)
    }
  }

  const filteredEvents = events.filter(e => 
    e.plateNumber?.toLowerCase().includes(filter.toLowerCase())
  )

  return (
    <div className="app">
      <header className="header">
        <h1>📷 Cámara Placas - Dahua ITC413</h1>
        <div className="status-badge">
          <span className={`status-dot ${status === 'offline' ? 'offline' : ''}`}></span>
          {status === 'online' ? 'Cámara Online' : 'Cámara Offline'}
        </div>
      </header>

      <div className="tabs">
        <button 
          className={`tab ${activeTab === 'live' ? 'active' : ''}`}
          onClick={() => setActiveTab('live')}
        >
          📹 En Vivo
        </button>
        <button 
          className={`tab ${activeTab === 'events' ? 'active' : ''}`}
          onClick={() => setActiveTab('events')}
        >
          🚗 Registros ({events.length})
        </button>
        <button 
          className={`tab ${activeTab === 'ptz' ? 'active' : ''}`}
          onClick={() => setActiveTab('ptz')}
        >
          🎮 PTZ
        </button>
      </div>

      <div style={{ marginTop: '20px' }}>
        {activeTab === 'live' && (
          <div className="grid">
            <div className="card">
              <div className="card-header">
                <span className="card-title">Vista en Vivo</span>
                <button className="btn btn-secondary" onClick={fetchSnapshot}>
                  📸 Capturar
                </button>
              </div>
              <div className="video-container">
                {snapshot && (
                  <>
                    <img src={snapshot} alt="Live" />
                    <span className="live-badge">LIVE</span>
                  </>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <span className="card-title">Últimas Detections</span>
              </div>
              <div className="records-list">
                {events.slice(0, 10).map((event) => (
                  <div key={event.id} className="record-item">
                    <div>
                      <div className="record-plate">{event.plateNumber}</div>
                      <div className="record-info">Color: {event.plateColor} | Lane: {event.lane}</div>
                    </div>
                    <div className="record-time">
                      {moment(event.timestamp).format('HH:mm:ss')}
                    </div>
                  </div>
                ))}
                {events.length === 0 && (
                  <div className="empty-state">
                    Esperando detecciones...
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'events' && (
          <div className="card">
            <div className="filter-bar">
              <input
                type="text"
                className="filter-input"
                placeholder="Buscar por placa..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <button className="btn btn-primary" onClick={() => setEvents([])}>
                🗑️ Limpiar
              </button>
            </div>
            <div className="events-container">
              {filteredEvents.length === 0 ? (
                <div className="empty-state">
                  {filter ? 'No se encontraron registros' : 'Esperando eventos de la cámara...'}
                </div>
              ) : (
                filteredEvents.map((event) => (
                  <div key={event.id} className="event-item">
                    <div className="event-icon">🚗</div>
                    <div className="event-content">
                      <div className="event-plate">{event.plateNumber}</div>
                      <div className="event-meta">
                        Color: {event.plateColor} | Calle: {event.lane}
                      </div>
                    </div>
                    <div className="record-time">
                      {moment(event.timestamp).format('DD/MM HH:mm:ss')}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'ptz' && (
          <div className="card">
            <div className="card-header">
              <span className="card-title">Control PTZ</span>
            </div>
            <div className="ptz-controls">
              <div></div>
              <button 
                className="ptz-btn"
                onMouseDown={() => handlePtz('up')}
                onMouseUp={handlePtzStop}
                onMouseLeave={handlePtzStop}
              >
                ⬆️
              </button>
              <div></div>
              <button 
                className="ptz-btn"
                onMouseDown={() => handlePtz('left')}
                onMouseUp={handlePtzStop}
                onMouseLeave={handlePtzStop}
              >
                ⬅️
              </button>
              <button 
                className="ptz-btn ptz-center"
                onClick={fetchSnapshot}
              >
                📷
              </button>
              <button 
                className="ptz-btn"
                onMouseDown={() => handlePtz('right')}
                onMouseUp={handlePtzStop}
                onMouseLeave={handlePtzStop}
              >
                ➡️
              </button>
              <div></div>
              <button 
                className="ptz-btn"
                onMouseDown={() => handlePtz('down')}
                onMouseUp={handlePtzStop}
                onMouseLeave={handlePtzStop}
              >
                ⬇️
              </button>
              <div></div>
              <button 
                className="ptz-btn"
                onMouseDown={() => handlePtz('zoomIn')}
                onMouseUp={handlePtzStop}
                onMouseLeave={handlePtzStop}
              >
                🔍+
              </button>
              <button 
                className="ptz-btn"
                onMouseDown={() => handlePtz('zoomOut')}
                onMouseUp={handlePtzStop}
                onMouseLeave={handlePtzStop}
              >
                🔍-
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
