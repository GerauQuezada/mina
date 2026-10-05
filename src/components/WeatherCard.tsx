import { useEffect, useMemo, useState } from 'react'
import { Cloud, CloudLightning, CloudRain, CloudSun, Droplets, MapPin, RefreshCw, Snowflake, Sun, Wind } from 'lucide-react'

type Weather = {
  current: { temperature_2m:number; apparent_temperature:number; relative_humidity_2m:number; precipitation:number; weather_code:number; wind_speed_10m:number; is_day:number; time:string }
  daily: { temperature_2m_max:number[]; temperature_2m_min:number[] }
}
const CACHE_KEY='mina-pataz-weather-v1'
const URL='https://api.open-meteo.com/v1/forecast?latitude=-7.73245254081&longitude=-77.5895450001&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,is_day&daily=temperature_2m_max,temperature_2m_min&timezone=America%2FLima&forecast_days=1'

function description(code:number){if(code===0)return'Despejado';if(code<=3)return'Parcialmente nublado';if(code<=48)return'Niebla';if(code<=67)return'Lluvia';if(code<=77)return'Nieve';if(code<=82)return'Chubascos';if(code<=99)return'Tormenta';return'Tiempo variable'}
function WeatherIcon({code,day}:{code:number;day:boolean}){if(code===0)return day?<Sun/>:<CloudSun/>;if(code<=3)return<CloudSun/>;if(code<=48)return<Cloud/>;if(code<=67)return<CloudRain/>;if(code<=77)return<Snowflake/>;if(code<=82)return<CloudRain/>;return<CloudLightning/>}

export default function WeatherCard(){
  const [weather,setWeather]=useState<Weather|null>(()=>{try{return JSON.parse(localStorage.getItem(CACHE_KEY)||'null')?.data||null}catch{return null}})
  const [busy,setBusy]=useState(false),[failed,setFailed]=useState(false),[refresh,setRefresh]=useState(0)
  useEffect(()=>{let active=true;const controller=new AbortController();async function load(){setBusy(true);try{const response=await fetch(URL,{signal:controller.signal});if(!response.ok)throw new Error();const value=await response.json() as Weather;if(!Number.isFinite(value.current?.temperature_2m))throw new Error();if(active){setWeather(value);setFailed(false);localStorage.setItem(CACHE_KEY,JSON.stringify({data:value,savedAt:Date.now()}))}}catch{if(active)setFailed(true)}finally{if(active)setBusy(false)}}void load();const timer=window.setInterval(load,10*60*1000);return()=>{active=false;controller.abort();window.clearInterval(timer)}},[refresh])
  const current=weather?.current
  const updated=useMemo(()=>current?new Date(current.time).toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'}):'',[current?.time])
  return <article className="weather-card glass">
    <div className="weather-head"><div><span className="eyebrow"><MapPin/> PATAZ · LA LIBERTAD</span><b>{failed?'Último clima disponible':'Clima en el pueblo'}</b></div><button className="icon-button" aria-label="Actualizar clima" disabled={busy} onClick={()=>setRefresh(value=>value+1)}><RefreshCw className={busy?'spinning':''}/></button></div>
    {current?<><div className="weather-now"><div className="weather-symbol"><WeatherIcon code={current.weather_code} day={Boolean(current.is_day)}/></div><div><strong>{Math.round(current.temperature_2m)}°</strong><span>{description(current.weather_code)}</span></div></div><div className="weather-range"><span>Máx. {Math.round(weather!.daily.temperature_2m_max[0])}°</span><i/><span>Mín. {Math.round(weather!.daily.temperature_2m_min[0])}°</span></div><div className="weather-metrics"><span><Droplets/> {current.relative_humidity_2m}%<small>Humedad</small></span><span><Wind/> {Math.round(current.wind_speed_10m)} km/h<small>Viento</small></span><span><CloudRain/> {current.precipitation} mm<small>Lluvia</small></span></div><footer>Sensación {Math.round(current.apparent_temperature)}° · actualizado {updated}</footer></>:<div className="weather-loading">Consultando el clima de Pataz…</div>}
  </article>
}
