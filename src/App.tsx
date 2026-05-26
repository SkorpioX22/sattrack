import React, { useState, useEffect, useMemo } from 'react';
import { fetchTLEs, SATELLITES, predictPasses, getSatelliteState, calculateGroundTrack, type TrackPoint } from './services/satelliteService';
import type { Pass, SatelliteState } from './types/satellite';
import { MapContainer, TileLayer, Marker, Circle, Polyline, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Satellite, Clock, MapPin, Loader2, ChevronRight, SignalHigh, SignalMedium, SignalLow, Zap, Search } from 'lucide-react';
import { format, isAfter, isBefore } from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const App: React.FC = () => {
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [tles, setTles] = useState<Map<string, string[]>>(new Map());
  const [passes, setPasses] = useState<Pass[]>([]);
  const [states, setStates] = useState<SatelliteState[]>([]);
  const [loading, setLoading] = useState(true);
  const [predicting, setPredicting] = useState(false);
  const [selectedSat, setSelectedSat] = useState<string>(SATELLITES[0].name);
  const [track, setTrack] = useState<TrackPoint[]>([]);
  const [searchTerm, setSearch] = useState('');
  const [isLive, setIsLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Constants
  const EARTH_RADIUS = 6371;

  useEffect(() => {
    const init = async () => {
      try {
        const result = await fetchTLEs();
        setTles(result.data);
        setIsLive(result.isLive);
      } catch (err) {
        setError('Failed to connect to satellite database.');
      } finally {
        setLoading(false);
      }
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => setLocation({ lat: 51.505, lng: -0.09 })
        );
      } else {
        setLocation({ lat: 51.505, lng: -0.09 });
      }
    };
    init();
  }, []);

  // HIGH PERFORMANCE PREDICTION: Processes satellites one-by-one with 200ms rest
  useEffect(() => {
    if (location && tles.size > 0 && !predicting && passes.length === 0) {
      const calculateAll = async () => {
        setPredicting(true);
        const accumulatedPasses: Pass[] = [];
        for (let i = 0; i < SATELLITES.length; i++) {
          const sat = SATELLITES[i];
          const tle = tles.get(sat.noradId);
          if (tle) {
            const satPasses = predictPasses(tle, sat, location.lat, location.lng, 365);
            accumulatedPasses.push(...satPasses);
            
            // Batch updates to reduce sidebar re-renders
            if (i % 8 === 0 || i === SATELLITES.length - 1) {
              const unique = Array.from(new Map(accumulatedPasses.map(p => [`${p.satelliteName}-${p.aos.getTime()}`, p])).values())
                .sort((a, b) => a.aos.getTime() - b.aos.getTime());
              setPasses(unique);
            }
            // Yield significantly to browser for smooth UI
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        }
        setPredicting(false);
      };
      calculateAll();
    }
  }, [location, tles, predicting, passes.length]);

  // THROTTLED TELEMETRY: Updates every 2 seconds instead of 1 to save CPU
  useEffect(() => {
    const timer = setInterval(() => {
      if (location && tles.size > 0) {
        const newStates: SatelliteState[] = [];
        SATELLITES.forEach(sat => {
          const tle = tles.get(sat.noradId);
          if (tle) {
            const state = getSatelliteState(tle, new Date(), location.lat, location.lng);
            if (state) {
              state.name = sat.name;
              newStates.push(state);
            }
          }
        });
        setStates(newStates);
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [location, tles]);

  // Track Update: Only runs when satellite or location changes
  useEffect(() => {
    if (location && tles.size > 0 && selectedSat) {
      const sat = SATELLITES.find(s => s.name === selectedSat);
      const tle = sat ? tles.get(sat.noradId) : null;
      if (tle) setTrack(calculateGroundTrack(tle, location.lat, location.lng, 110));
    }
  }, [selectedSat, location, tles]);

  // VIRTUALIZED LIST: Only render first 50 results to keep DOM light
  const filteredPasses = useMemo(() => {
    return passes
      .filter(p => isAfter(p.aos, new Date()))
      .filter(p => p.satelliteName.toLowerCase().includes(searchTerm.toLowerCase()))
      .slice(0, 50); 
  }, [passes, searchTerm]);

  const activePass = useMemo(() => {
    return states.some(s => s.name === selectedSat && s.elevation > 1) 
      ? passes.find(p => p.satelliteName === selectedSat && isBefore(p.aos, new Date()) && isAfter(p.los, new Date()))
      : passes.find(p => p.satelliteName === selectedSat && isAfter(p.aos, new Date()));
  }, [passes, selectedSat, states]);

  if (loading) return (
    <div className="flex h-screen items-center justify-center bg-slate-950 text-cyan-500 font-black">
      <div className="text-center"><Loader2 className="w-12 h-12 animate-spin mx-auto mb-4" /><h1>FLEET INITIALIZATION...</h1></div>
    </div>
  );

  const getFootprintRadius = (alt: number) => {
    const angle = Math.acos(EARTH_RADIUS / (EARTH_RADIUS + alt));
    return EARTH_RADIUS * angle * 1000;
  };

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 overflow-hidden font-sans select-none">
      <header className="h-16 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md px-6 flex items-center justify-between z-50">
        <div className="flex items-center gap-3">
          <Satellite className="text-cyan-400 w-8 h-8" />
          <div>
            <h1 className="text-xl font-black tracking-tighter uppercase">OrbitWatch <span className="text-slate-500 font-light italic">v1.0</span></h1>
            <div className="flex items-center gap-2 text-[9px] font-bold uppercase">
              <span className={cn("w-1.5 h-1.5 rounded-full", isLive ? "bg-green-500" : "bg-yellow-500")} />
              {isLive ? 'Link Active' : 'Offline Mode'} • {tles.size} OBJ
            </div>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right"><div className="text-[10px] text-slate-500 font-bold uppercase">Location</div><div className="text-sm font-mono text-cyan-400">{location ? `${location.lat.toFixed(2)}N ${location.lng.toFixed(2)}E` : '---'}</div></div>
          <div className="text-right border-l border-slate-800 pl-6"><div className="text-[10px] text-slate-500 font-bold uppercase">Mission Time</div><div className="text-sm font-mono text-slate-300">{format(new Date(), 'HH:mm:ss')} UTC</div></div>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        <aside className="w-80 flex flex-col border-r border-slate-800 bg-slate-900/20">
          <div className="p-4 space-y-4">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Targeted Window</h2>
            {activePass ? (
              <div className={cn("glass-panel p-4 relative overflow-hidden", isBefore(activePass.aos, new Date()) ? "border-green-500/30" : "border-cyan-500/30")}>
                <div className="flex justify-between items-start mb-4">
                  <div><h3 className={cn("text-lg font-black leading-none", isBefore(activePass.aos, new Date()) ? "text-green-400" : "text-cyan-400")}>{activePass.satelliteName}</h3><p className="text-[10px] text-slate-400 mt-1 uppercase font-bold">{activePass.mode}</p></div>
                </div>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div><div className="text-[9px] text-slate-500 font-bold uppercase">Tuning</div><div className="text-xs font-mono font-bold">{activePass.frequency.split('/')[0]}</div></div>
                  <div className="text-right"><div className="text-[9px] text-slate-500 font-bold uppercase">El Peak</div><div className="text-xs font-mono font-bold">{activePass.maxElevation.toFixed(0)}°</div></div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] font-bold">
                    <span className="text-slate-500">{isBefore(activePass.aos, new Date()) ? 'LOS IN' : 'AOS IN'}</span>
                    <span className="font-mono text-cyan-400">
                      {(() => { 
                        const target = isBefore(activePass.aos, new Date()) ? activePass.los : activePass.aos; 
                        const diff = Math.floor((target.getTime() - new Date().getTime()) / 1000); 
                        if (diff < 0) return '---';
                        return `${Math.floor(diff/60)}m ${diff%60}s`; 
                      })()}
                    </span>
                  </div>
                  <div className="h-1 bg-slate-800 rounded-full"><div className="h-full bg-cyan-500" style={{ width: '50%' }} /></div>
                </div>
              </div>
            ) : <div className="p-6 text-center text-slate-600 text-xs italic border border-slate-800 rounded">Scanning...</div>}
          </div>

          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-y border-slate-800 bg-slate-900/40">
              <div className="flex justify-between items-center mb-3">
                <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Forecast</h2>
                {predicting && <Loader2 className="w-3 h-3 animate-spin text-cyan-500" />}
              </div>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" />
                <input type="text" placeholder="Filter fleet..." className="w-full bg-slate-950 border border-slate-800 rounded px-7 py-1 text-[10px] focus:outline-none focus:border-cyan-500/50" value={searchTerm} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto scrollbar-hide">
              {filteredPasses.map((pass) => (
                <div key={`${pass.satelliteName}-${pass.aos.getTime()}`} className={cn("p-4 border-b border-slate-800/40 hover:bg-cyan-500/5 cursor-pointer transition-colors group", selectedSat === pass.satelliteName && "bg-cyan-500/5 border-l-2 border-l-cyan-500")} onClick={() => setSelectedSat(pass.satelliteName)}>
                  <div className="flex justify-between items-start"><span className="font-bold text-xs text-slate-300 group-hover:text-cyan-400">{pass.satelliteName}</span><span className="text-[10px] font-mono text-slate-500">{pass.maxElevation.toFixed(0)}°</span></div>
                  <div className="text-[9px] font-mono text-slate-500 mt-1">{format(pass.aos, 'MMM dd • HH:mm:ss')}</div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <section className="flex-1 relative bg-[#020617]">
          {location && (
            <MapContainer center={[location.lat, location.lng]} zoom={3} style={{ height: '100%', width: '100%' }} zoomControl={false}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OSM" />
              <Marker position={[location.lat, location.lng]} icon={L.divIcon({ className: 'obs', html: `<div class="w-2 h-2 bg-red-500 rounded-full shadow-[0_0_10px_red]"></div>` })} />
              
              {states.map((s, i) => (
                <Marker key={i} position={[s.lat, s.lng]} eventHandlers={{ click: () => setSelectedSat(s.name) }} icon={L.divIcon({ className: 'sat', html: `<div class="w-3 h-3 rounded-full border-2 border-white ${selectedSat === s.name ? 'bg-cyan-400' : 'bg-cyan-700'}"></div>` })}>
                  {selectedSat === s.name && (
                    <>
                      <Tooltip permanent direction="top" className="bg-slate-900 text-white text-[10px] border-none">{s.name}</Tooltip>
                      <Circle center={[s.lat, s.lng]} radius={getFootprintRadius(s.alt)} pathOptions={{ color: '#06b6d4', weight: 1, fillOpacity: 0.05 }} />
                    </>
                  )}
                </Marker>
              ))}

              {track.map((p, i) => {
                if (i === 0) return null;
                const prev = track[i-1];
                if (Math.abs(p.lng - prev.lng) > 100) return null;
                return <Polyline key={i} positions={[[prev.lat, prev.lng], [p.lat, p.lng]]} pathOptions={{ color: p.elevation > 0 ? '#22c55e' : '#475569', weight: 2, opacity: 0.5 }} />;
              })}
            </MapContainer>
          )}

          {states.find(s => s.name === selectedSat) && (
            <div className="absolute bottom-6 left-6 right-6 pointer-events-none">
              {(() => {
                const s = states.find(st => st.name === selectedSat)!;
                return (
                  <div className="glass-panel p-4 flex gap-8 items-center border-cyan-500/30 pointer-events-auto bg-slate-900/90">
                    <div><div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Target</div><div className="text-base font-black text-cyan-400 uppercase leading-none">{s.name}</div></div>
                    <div className="flex-1 text-xs font-mono text-slate-300">
                      {s.lat.toFixed(2)}N {s.lng.toFixed(2)}E • {s.alt.toFixed(0)}km • {(s.velocity*3600).toFixed(0)}km/h<br/>
                      AZ: {s.azimuth.toFixed(1)}° • EL: {s.elevation.toFixed(1)}°
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </section>
      </main>
    </div>
  );
};

export default App;
