import { useState } from 'react'
import { MapPin, Minus, Plus, RotateCcw } from 'lucide-react'

const MAP_IMAGE=new URL('images/mapa-recorrido-mina.png',document.baseURI).href

export default function MineMap(){
  const [zoom,setZoom]=useState(1)

  return <section className="map-page">
    <div className="map-tools glass">
      <div>
        <MapPin/>
        <span>
          <b>Levantamiento topográfico</b>
          <small>Mapeo de rutas, estaciones y ramales de la mina</small>
        </span>
      </div>
      <div>
        <button onClick={()=>setZoom(value=>Math.max(.6,value-.2))} aria-label="Alejar mapa"><Minus/></button>
        <span aria-live="polite">{Math.round(zoom*100)}%</span>
        <button onClick={()=>setZoom(value=>Math.min(2.4,value+.2))} aria-label="Acercar mapa"><Plus/></button>
        <button onClick={()=>setZoom(1)} aria-label="Restablecer mapa"><RotateCcw/></button>
      </div>
    </div>
    <div className="map-canvas glass">
      <div className="map-stage map-image-stage" style={{transform:`scale(${zoom})`}}>
        <img src={MAP_IMAGE} alt="Levantamiento topográfico y mapeo de rutas de la mina, con estaciones E2 a E11, corredor norte y ramales este, suroeste y sureste" draggable={false}/>
      </div>
    </div>
    <p className="map-caption">Plano topográfico de referencia con la ruta principal, rutas secundarias, estaciones, bifurcaciones y zonas amplias de la mina.</p>
  </section>
}
