export interface SatelliteInfo {
  name: string;
  noradId: string;
  frequency: string;
  mode: 'APT' | 'LRPT' | 'SSTV' | 'Voice';
  description: string;
}

export interface Pass {
  satelliteName: string;
  aos: Date; // Acquisition of Signal
  los: Date; // Loss of Signal
  maxElevation: number;
  duration: number; // in seconds
  frequency: string;
  mode: string;
}

export interface SatelliteState {
  name: string;
  lat: number;
  lng: number;
  alt: number;
  velocity: number;
  azimuth: number;
  elevation: number;
  range: number;
}
