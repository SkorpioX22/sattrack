import * as satellite from 'satellite.js';
import { addDays, addMinutes, addSeconds } from 'date-fns';
import type { SatelliteInfo, Pass, SatelliteState } from '../types/satellite';

export const SATELLITES: SatelliteInfo[] = [
  // --- NOAA POES (APT & HRPT) ---
  { name: 'NOAA 15', noradId: '25338', frequency: '137.620 / 1702.5 MHz', mode: 'APT / HRPT', description: 'US Weather' },
  { name: 'NOAA 18', noradId: '28654', frequency: '137.9125 / 1707.0 MHz', mode: 'APT / HRPT', description: 'US Weather' },
  { name: 'NOAA 19', noradId: '33591', frequency: '137.100 / 1698.0 MHz', mode: 'APT / HRPT', description: 'US Weather' },

  // --- Meteor-M (LRPT & HRPT) ---
  { name: 'METEOR-M 2-3', noradId: '57166', frequency: '137.100 / 1700.0 MHz', mode: 'LRPT / HRPT', description: 'RU Weather' },
  { name: 'METEOR-M 2-4', noradId: '59051', frequency: '137.100 / 1700.0 MHz', mode: 'LRPT / HRPT', description: 'RU Weather' },

  // --- MetOp (AHRPT) ---
  { name: 'METOP-B', noradId: '38771', frequency: '1701.3 MHz', mode: 'AHRPT', description: 'EU Weather' },
  { name: 'METOP-C', noradId: '43689', frequency: '1701.3 MHz', mode: 'AHRPT', description: 'EU Weather' },

  // --- FengYun (AHRPT / HRIT) ---
  { name: 'FY-3B', noradId: '37214', frequency: '1704.5 MHz', mode: 'AHRPT', description: 'CN Weather' },
  { name: 'FY-3C', noradId: '39260', frequency: '1704.5 MHz', mode: 'AHRPT', description: 'CN Weather' },
  { name: 'FY-3D', noradId: '43010', frequency: '1704.5 MHz', mode: 'AHRPT', description: 'CN Weather' },
  { name: 'FY-3E', noradId: '49008', frequency: '1704.5 MHz', mode: 'AHRPT', description: 'CN Weather' },
  { name: 'FY-4A', noradId: '41882', frequency: '1694.6 MHz', mode: 'HRIT/LRIT', description: 'CN Geo' },

  // --- GOES Series (HRIT/LRIT - Dish Required) ---
  { name: 'GOES 16', noradId: '41866', frequency: '1694.1 MHz', mode: 'HRIT/LRIT', description: 'US Geo East' },
  { name: 'GOES 17', noradId: '43226', frequency: '1694.1 MHz', mode: 'HRIT/LRIT', description: 'US Geo West' },
  { name: 'GOES 18', noradId: '51850', frequency: '1694.1 MHz', mode: 'HRIT/LRIT', description: 'US Geo West' },

  // --- Russian GEO (HRIT/LRIT) ---
  { name: 'ELEKTRO-L 2', noradId: '41105', frequency: '1691.0 MHz', mode: 'HRIT/LRIT', description: 'RU Geo' },
  { name: 'ARKTIKA-M 1', noradId: '47719', frequency: '1691.0 MHz', mode: 'HRIT/LRIT', description: 'RU HEO' },

  // --- ISS (SSTV) ---
  { name: 'ISS', noradId: '25544', frequency: '145.800 MHz', mode: 'SSTV / Voice', description: 'Space Station' },
];

const TLE_GROUPS = ['weather', 'stations', 'noaa', 'goes'];

export async function fetchTLEs(): Promise<{ data: Map<string, string[]>, isLive: boolean }> {
  const tleMap = new Map<string, string[]>();
  let isLive = false;
  
  for (const group of TLE_GROUPS) {
    const url = `/celestrak-api/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!response.ok) continue;
      const text = await response.text();
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('1 ') && i + 1 < lines.length && lines[i+1].startsWith('2 ')) {
          const line1 = line;
          const line2 = lines[i+1];
          const noradId = line2.substring(2, 7).trim();
          if (!tleMap.has(noradId)) tleMap.set(noradId, [line1, line2]);
          i++;
        }
      }
      if (tleMap.size > 0) isLive = true;
    } catch (e) { /* silent sync */ }
  }
  return { data: tleMap, isLive };
}

export function getSatelliteState(tle: string[], date: Date, observerLat: number, observerLng: number, observerAlt: number = 0): SatelliteState | null {
  try {
    const satrec = satellite.twoline2satrec(tle[0], tle[1]);
    const positionAndVelocity = satellite.propagate(satrec, date);
    if (!positionAndVelocity || !positionAndVelocity.position || typeof positionAndVelocity.position === 'boolean') return null;
    const positionEci = positionAndVelocity.position as satellite.EciVec3<number>;
    const gmst = satellite.gstime(date);
    const positionGd = satellite.eciToGeodetic(positionEci, gmst);
    const observerGd = { latitude: satellite.degreesToRadians(observerLat), longitude: satellite.degreesToRadians(observerLng), height: observerAlt / 1000 };
    const lookAngles = satellite.ecfToLookAngles(observerGd, satellite.eciToEcf(positionEci, gmst));
    const velocityEci = positionAndVelocity.velocity as satellite.EciVec3<number>;
    const velocity = Math.sqrt(velocityEci.x**2 + velocityEci.y**2 + velocityEci.z**2);
    return { name: '', lat: satellite.radiansToDegrees(positionGd.latitude), lng: satellite.radiansToDegrees(positionGd.longitude), alt: positionGd.height, velocity, azimuth: satellite.radiansToDegrees(lookAngles.azimuth), elevation: satellite.radiansToDegrees(lookAngles.elevation), range: lookAngles.rangeSat };
  } catch (e) { return null; }
}

export function predictPasses(tle: string[], satInfo: SatelliteInfo, observerLat: number, observerLng: number, days: number = 365): Pass[] {
  const passes: Pass[] = [];
  try {
    const satrec = satellite.twoline2satrec(tle[0], tle[1]);
    let currentTime = new Date();
    const endTime = addDays(currentTime, days);
    const observerGd = { latitude: satellite.degreesToRadians(observerLat), longitude: satellite.degreesToRadians(observerLng), height: 0 };
    let inPass = false;
    let passStart: Date | null = null;
    let maxElevation = -180;

    while (currentTime < endTime) {
      const gmst = satellite.gstime(currentTime);
      const positionAndVelocity = satellite.propagate(satrec, currentTime);
      if (positionAndVelocity && positionAndVelocity.position && typeof positionAndVelocity.position !== 'boolean') {
        const positionEci = positionAndVelocity.position as satellite.EciVec3<number>;
        const lookAngles = satellite.ecfToLookAngles(observerGd, satellite.eciToEcf(positionEci, gmst));
        const elevation = satellite.radiansToDegrees(lookAngles.elevation);
        if (elevation > 0) {
          if (!inPass) { inPass = true; passStart = new Date(currentTime); maxElevation = elevation; }
          else { if (elevation > maxElevation) maxElevation = elevation; }
          currentTime = addSeconds(currentTime, 60);
        } else {
          if (inPass) {
            inPass = false;
            if (passStart) { passes.push({ satelliteName: satInfo.name, aos: passStart, los: new Date(currentTime), maxElevation, duration: (currentTime.getTime() - passStart.getTime()) / 1000, frequency: satInfo.frequency, mode: satInfo.mode }); }
            passStart = null; maxElevation = -180;
            currentTime = addMinutes(currentTime, 45);
          } else {
            currentTime = addMinutes(currentTime, 15);
          }
        }
      } else { currentTime = addMinutes(currentTime, 15); }
    }
  } catch (e) { /* ignore */ }
  return passes;
}

export interface TrackPoint { lat: number; lng: number; elevation: number; }

export function calculateGroundTrack(tle: string[], observerLat: number, observerLng: number, durationMinutes: number = 90): TrackPoint[] {
  const points: TrackPoint[] = [];
  try {
    const satrec = satellite.twoline2satrec(tle[0], tle[1]);
    const startTime = new Date();
    const observerGd = { latitude: satellite.degreesToRadians(observerLat), longitude: satellite.degreesToRadians(observerLng), height: 0 };
    for (let i = 0; i < durationMinutes * 60; i += 60) {
      const time = addSeconds(startTime, i);
      const gmst = satellite.gstime(time);
      const positionAndVelocity = satellite.propagate(satrec, time);
      if (positionAndVelocity && positionAndVelocity.position && typeof positionAndVelocity.position !== 'boolean') {
        const positionEci = positionAndVelocity.position as satellite.EciVec3<number>;
        const positionGd = satellite.eciToGeodetic(positionEci, gmst);
        const lookAngles = satellite.ecfToLookAngles(observerGd, satellite.eciToEcf(positionEci, gmst));
        points.push({ lat: satellite.radiansToDegrees(positionGd.latitude), lng: satellite.radiansToDegrees(positionGd.longitude), elevation: satellite.radiansToDegrees(lookAngles.elevation) });
      }
    }
  } catch (e) { /* ignore */ }
  return points;
}
