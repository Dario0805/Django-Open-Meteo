import { useEffect, useState, useCallback, useRef } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { API_URL, pedirOExplotar, aQuery, FallaApi } from '../../shared/api.js'

/**
 * Mapa interactivo con Leaflet de las ciudades monitorizadas.
 *
 * Estilo: liquid glass con colores vivos.
 *
 * - Carga /api/ciudades/ al montar y luego /api/mediciones/clima-actual/
 *   para CADA ciudad, de modo que el marcador muestre la temperatura actual
 *   visible SIN necesidad de abrir el popup.
 * - Cada CircleMarker se pinta con un color vivo según la temperatura
 *   (azul muy frío → cian → verde → amarillo → naranja → rojo).
 * - Al pulsar un marcador se abre un popup con la temperatura como hero
 *   gigante y los detalles (humedad, precipitación, viento).
 * - Tiles: Esri World Imagery (satelital colorido, sin API key).
 */

const CENTRO = [4.0, -75.0]
const ZOOM = 3
// Esri World Imagery: tiles satelitales coloridos, gratis y SIN API key.
// Más confiable que CARTO (que ahora pide clave) y más vivo que OSM estándar.
const URL_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const ATRIBUCION_TILES =
  'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, ' +
  'and the GIS User Community'

/**
 * Devuelve un color vivo según la temperatura (°C).
 * Escala: -10°C → azul profundo, 35°C → rojo intenso.
 */
function colorPorTemperatura(temp) {
  if (temp === null || temp === undefined || Number.isNaN(Number(temp))) {
    return '#a78bfa' // morado si no hay dato
  }
  const t = Number(temp)
  if (t < 0) return '#4361ee'       // azul profundo
  if (t < 8) return '#00d4ff'       // cian
  if (t < 15) return '#00f5a0'      // verde
  if (t < 22) return '#ffd93d'      // amarillo
  if (t < 28) return '#ff9f43'      // naranja
  return '#ff4757'                   // rojo
}

function descripcionCodigo(codigo) {
  const c = Number(codigo)
  if (c === 0) return 'Despejado'
  if (c <= 3) return 'Parcialmente nublado'
  if (c <= 48) return 'Niebla'
  if (c <= 57) return 'Llovizna'
  if (c <= 67) return 'Lluvia'
  if (c <= 77) return 'Nieve'
  if (c <= 82) return 'Chubascos'
  if (c <= 86) return 'Chubascos de nieve'
  if (c >= 95) return 'Tormenta'
  return '—'
}

/**
 * Pequeño componente hijo del MapContainer que usa useMap para forzar
 * invalidateSize() una vez que el layout del contenedor se ha estabilizado.
 */
function AjustadorMapa() {
  const mapa = useMap()
  useEffect(() => {
    const t = setTimeout(() => mapa.invalidateSize(), 200)
    return () => clearTimeout(t)
  }, [mapa])
  return null
}

function MarcaCiudad({ ciudad, datos, cargando, markerRef }) {
  const [abierta, setAbierta] = useState(false)

  const lat = parseFloat(ciudad.latitud)
  const lng = parseFloat(ciudad.longitud)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

  const tempValor = datos?.temperatura
  const color = colorPorTemperatura(tempValor)
  const u = datos?.unidades ?? {}
  const tempTexto =
    tempValor !== null && tempValor !== undefined
      ? `${Number(tempValor).toFixed(0)}°`
      : cargando
        ? '…'
        : '—'

  return (
    <CircleMarker
      center={[lat, lng]}
      radius={11}
      pathOptions={{
        color: '#ffffff',
        weight: 2,
        fillColor: color,
        fillOpacity: 0.95,
      }}
      ref={markerRef}
      eventHandlers={{
        popupopen: () => setAbierta(true),
        popupclose: () => setAbierta(false),
      }}
    >
      {/* Tooltip visible al pasar el mouse: muestra temp sin abrir popup */}
      <Popup>
        <div className="mapa-popup">
          <div className="mapa-popup-titulo">{ciudad.nombre}</div>
          <div className="mapa-popup-pais texto-suave texto-pequeno">
            {ciudad.pais || '—'}
          </div>

          {cargando && !datos && (
            <div className="mapa-popup-carga">
              <span className="spinner spinner--pequeno" />
              Cargando clima actual…
            </div>
          )}

          {!cargando && !datos && (
            <div className="mapa-popup-error">
              No se pudo cargar el clima actual.
            </div>
          )}

          {datos && (
            <div className="mapa-popup-cuerpo">
              <div className="mapa-popup-temp">
                <span className="mapa-popup-temp-valor">
                  {tempValor !== null && tempValor !== undefined
                    ? Number(tempValor).toFixed(1)
                    : '—'}
                </span>
                <span className="mapa-popup-temp-unidad">
                  {u.temperatura || '°C'}
                </span>
              </div>

              <div className="mapa-popup-detalle">
                <span className="mapa-popup-detalle-etiqueta">Condición</span>
                <span className="mapa-popup-detalle-valor">
                  {descripcionCodigo(datos.codigo_clima)}
                </span>
              </div>

              <div className="mapa-popup-detalle">
                <span className="mapa-popup-detalle-etiqueta">Humedad</span>
                <span className="mapa-popup-detalle-valor">
                  {datos.humedad_relativa != null
                    ? `${Number(datos.humedad_relativa).toFixed(0)}`
                    : '—'}
                  <small> {u.humedad_relativa || '%'}</small>
                </span>
              </div>

              <div className="mapa-popup-detalle">
                <span className="mapa-popup-detalle-etiqueta">Precip.</span>
                <span className="mapa-popup-detalle-valor">
                  {datos.precipitacion != null
                    ? Number(datos.precipitacion).toFixed(2)
                    : '—'}
                  <small> {u.precipitacion || 'mm'}</small>
                </span>
              </div>

              <div className="mapa-popup-detalle">
                <span className="mapa-popup-detalle-etiqueta">Viento</span>
                <span className="mapa-popup-detalle-valor">
                  {datos.velocidad_viento != null
                    ? Number(datos.velocidad_viento).toFixed(1)
                    : '—'}
                  <small> {u.velocidad_viento || 'km/h'}</small>
                </span>
              </div>

              {datos.tiempo && (
                <div className="mapa-popup-detalle">
                  <span className="mapa-popup-detalle-etiqueta">Actualizado</span>
                  <span className="mapa-popup-detalle-valor">
                    <small>{String(datos.tiempo).replace('T', ' ')}</small>
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </Popup>

      {/* Tooltip permanente con la temperatura visible sin abrir el popup */}
      <TooltipMediana texto={tempTexto} color={color} />
    </CircleMarker>
  )
}

/**
 * Tooltip pequeño pegado al marcador que muestra la temperatura de un vistazo.
 * Se renderiza como HTML crudo para tener estilo glass completo.
 */
function TooltipMediana({ texto, color }) {
  return (
    <span
      style={{
        position: 'absolute',
        transform: 'translate(-50%, -150%)',
        background: 'rgba(20, 20, 40, 0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        color: '#fff',
        fontWeight: 800,
        fontSize: '0.78rem',
        padding: '3px 8px',
        borderRadius: '999px',
        border: `2px solid ${color}`,
        boxShadow: `0 4px 14px rgba(0,0,0,0.4), 0 0 12px ${color}`,
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        lineHeight: 1,
        zIndex: 1000,
      }}
    >
      {texto}
    </span>
  )
}

function Mapa() {
  const [ciudades, setCiudades] = useState([])
  const [climaPorCiudad, setClimaPorCiudad] = useState({})
  const [cargandoCiudades, setCargandoCiudades] = useState(true)
  const [cargandoClima, setCargandoClima] = useState(false)
  const [error, setError] = useState(null)
  const markerRefs = useRef({})

  const cargarCiudades = useCallback(async () => {
    setCargandoCiudades(true)
    setError(null)
    try {
      const { datos } = await pedirOExplotar(`${API_URL}/ciudades/`)
      const lista = Array.isArray(datos) ? datos : datos?.results ?? []
      setCiudades(lista)
      return lista
    } catch (e) {
      if (e instanceof FallaApi) setError(e.message)
      else setError('No se pudo cargar la lista de ciudades.')
      return []
    } finally {
      setCargandoCiudades(false)
    }
  }, [])

  /**
   * Carga el clima actual de todas las ciudades en paralelo, pero en lotes
   * de 5 para no agotar el límite de Open-Meteo (5 peticiones/segundo).
   * Cada lote espera 1.2s antes del siguiente.
   */
  const cargarClimaCiudades = useCallback(async (lista) => {
    if (!lista || lista.length === 0) return
    setCargandoClima(true)
    const TAMANO_LOTE = 5
    const PAUSA = 1200
    const resultados = {}
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

    for (let i = 0; i < lista.length; i += TAMANO_LOTE) {
      const lote = lista.slice(i, i + TAMANO_LOTE)
      const promesas = lote.map(async (c) => {
        try {
          const query = aQuery({ ciudad: c.id })
          const { datos } = await pedirOExplotar(
            `${API_URL}/mediciones/clima-actual/${query}`,
          )
          return [c.id, datos]
        } catch {
          return [c.id, null]
        }
      })
      const resueltas = await Promise.all(promesas)
      for (const [id, datos] of resueltas) {
        resultados[id] = datos
      }
      // Actualiza el estado parcialmente para que el usuario vea progreso.
      setClimaPorCiudad((p) => ({ ...p, ...resultados }))
      if (i + TAMANO_LOTE < lista.length) {
        await sleep(PAUSA)
      }
    }
    setCargandoClima(false)
  }, [])

  useEffect(() => {
    let cancelado = false
    ;(async () => {
      const lista = await cargarCiudades()
      if (cancelado || lista.length === 0) return
      // Carga el clima en segundo plano; los marcadores aparecen de inmediato.
      cargarClimaCiudades(lista)
    })()
    return () => {
      cancelado = true
    }
  }, [cargarCiudades, cargarClimaCiudades])

  function abrirPopup(ciudad) {
    const marker = markerRefs.current[ciudad.id]
    if (marker && typeof marker.openPopup === 'function') {
      marker.openPopup()
    }
  }

  function centrarEnCiudad(ciudad) {
    const marker = markerRefs.current[ciudad.id]
    if (marker && typeof marker.openPopup === 'function') {
      marker.openPopup()
    }
  }

  return (
    <section className="panel">
      <div className="panel-encabezado">
        <div>
          <h2>Mapa de ciudades monitorizadas</h2>
          <p>
            Marcadores con la temperatura actual en vivo desde Open-Meteo.
            Colores según temperatura: azul (frío) → verde → amarillo → rojo (calor).
            Pulsa un marcador para ver el detalle completo.
          </p>
        </div>
        {!cargandoCiudades && !error && (
          <span className="badge badge--celeste">
            {ciudades.length} ciudades
            {cargandoClima && (
              <>
                {' '}· <span className="spinner spinner--pequeno" /> cargando clima…
              </>
            )}
          </span>
        )}
      </div>

      <div className="panel-cuerpo">
        {cargandoCiudades && (
          <div className="carga-bloque">
            <span className="spinner" />
            Cargando ciudades…
          </div>
        )}

        {error && !cargandoCiudades && (
          <div className="aviso" data-tipo="error">
            <strong>Error</strong>
            {error}
            <button
              type="button"
              className="boton-mini"
              onClick={cargarCiudades}
              style={{ marginLeft: '0.5rem' }}
            >
              Reintentar
            </button>
          </div>
        )}

        {!cargandoCiudades && !error && ciudades.length > 0 && (
          <div className="mapa-card">
            <div className="mapa-contenedor">
              <MapContainer
                center={CENTRO}
                zoom={ZOOM}
                scrollWheelZoom={false}
                style={{ height: '100%', width: '100%' }}
              >
                <TileLayer
                  url={URL_TILES}
                  attribution={ATRIBUCION_TILES}
                />
                <AjustadorMapa />
                {ciudades.map((c) => (
                  <MarcaCiudad
                    key={c.id}
                    ciudad={c}
                    datos={climaPorCiudad[c.id]}
                    cargando={cargandoClima && !(c.id in climaPorCiudad)}
                    markerRef={(r) => {
                      if (r) markerRefs.current[c.id] = r
                    }}
                  />
                ))}
              </MapContainer>
            </div>

            {/* Leyenda de colores */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.75rem',
                padding: '0.6rem 0.85rem',
                background: 'var(--glass)',
                border: '1px solid var(--glass-borde)',
                borderRadius: 'var(--radio-sm)',
                fontSize: '0.78rem',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
              }}
            >
              <span style={{ color: 'var(--texto-suave)', fontWeight: 700 }}>
                Escala:
              </span>
              {[
                { t: '< 0°C', c: '#4361ee' },
                { t: '0-8°C', c: '#00d4ff' },
                { t: '8-15°C', c: '#00f5a0' },
                { t: '15-22°C', c: '#ffd93d' },
                { t: '22-28°C', c: '#ff9f43' },
                { t: '> 28°C', c: '#ff4757' },
              ].map((x) => (
                <span
                  key={x.t}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    color: 'var(--texto)',
                  }}
                >
                  <span
                    style={{
                      width: '14px',
                      height: '14px',
                      borderRadius: '999px',
                      background: x.c,
                      border: '1.5px solid rgba(255,255,255,0.8)',
                      boxShadow: `0 0 8px ${x.c}`,
                      display: 'inline-block',
                    }}
                  />
                  {x.t}
                </span>
              ))}
            </div>

            <div className="mapa-lista-ciudades">
              {ciudades.map((c) => {
                const d = climaPorCiudad[c.id]
                const tempNum =
                  d?.temperatura !== null && d?.temperatura !== undefined
                    ? Number(d.temperatura).toFixed(0)
                    : null
                return (
                  <button
                    key={c.id}
                    type="button"
                    className="boton-mini"
                    onClick={() => centrarEnCiudad(c)}
                    title={`Ver clima actual de ${c.nombre}`}
                    style={
                      tempNum !== null
                        ? {
                            borderColor: colorPorTemperatura(d.temperatura),
                            boxShadow: `0 0 12px ${colorPorTemperatura(d.temperatura)}55`,
                          }
                        : undefined
                    }
                  >
                    {c.nombre}
                    {tempNum !== null ? ` · ${tempNum}°` : ''}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {!cargandoCiudades && !error && ciudades.length === 0 && (
          <div className="tabla-vacia">
            <strong>Sin ciudades</strong>
            No hay ciudades registradas para mostrar en el mapa.
          </div>
        )}
      </div>
    </section>
  )
}

export default Mapa