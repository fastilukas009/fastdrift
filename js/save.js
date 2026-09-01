// Tallennus selaimen localStorageen. Kaikki on paikallista - mitään ei lähetetä palvelimelle.

import { CARS, defaultTune, defaultUpgrades, CAR_BY_ID } from './cars.js';

const KEY = 'fastidrift.save.v3';
const START_MONEY = 6000;

function freshCarState(carId) {
  const car = CAR_BY_ID[carId] || CARS[0];
  return {
    upgrades: defaultUpgrades(),
    tune: defaultTune(car),
    paint: { body: car.body.color, rim: '#c8ccd4', finish: 'gloss' }
  };
}

export function freshSave() {
  return {
    version: 2,
    money: START_MONEY,
    owned: [CARS[0].id],
    current: CARS[0].id,
    cars: { [CARS[0].id]: freshCarState(CARS[0].id) },
    records: {},
    settings: {
      volume: 0.7,
      sound: true,
      quality: 'high',
      assist: 0.35,
      autoGear: true,
      camera: 'chase',
      sensitivity: 1,
      showHud: true,
      shadows: true
    },
    stats: { totalScore: 0, runs: 0, distance: 0, bestCombo: 0, playTime: 0 }
  };
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshSave();
    const data = JSON.parse(raw);
    const base = freshSave();
    const merged = {
      ...base, ...data,
      settings: { ...base.settings, ...(data.settings || {}) },
      stats: { ...base.stats, ...(data.stats || {}) },
      records: data.records || {},
      cars: data.cars || base.cars
    };
    // Varmistetaan, että omistetuilla autoilla on aina eheä tila (uudet kentät päivityksissä).
    for (const id of merged.owned) {
      if (!merged.cars[id]) merged.cars[id] = freshCarState(id);
      const car = CAR_BY_ID[id];
      if (!car) continue;
      merged.cars[id].upgrades = { ...defaultUpgrades(), ...(merged.cars[id].upgrades || {}) };
      merged.cars[id].tune = { ...defaultTune(car), ...(merged.cars[id].tune || {}) };
      merged.cars[id].paint = { body: car.body.color, rim: '#c8ccd4', finish: 'gloss', ...(merged.cars[id].paint || {}) };
    }
    if (!merged.owned.includes(merged.current)) merged.current = merged.owned[0];
    return merged;
  } catch (e) {
    return freshSave();
  }
}

let pending = null;
export function persist(state) {
  // Kirjoitus niputetaan, jotta jokainen ajon aikainen muutos ei osu levylle erikseen.
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* kiintiö täynnä */ }
    pending = null;
  }, 250);
}

export function persistNow(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ohitetaan */ }
}

export function resetSave() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ohitetaan */ }
  return freshSave();
}

export function ensureCarState(state, carId) {
  if (!state.cars[carId]) state.cars[carId] = freshCarState(carId);
  return state.cars[carId];
}

export function recordRun(state, trackId, result) {
  const rec = state.records[trackId] || { best: 0, runs: 0, bestCombo: 0, topSpeed: 0 };
  rec.runs++;
  rec.best = Math.max(rec.best, result.total);
  rec.bestCombo = Math.max(rec.bestCombo, result.bestCombo || 0);
  rec.topSpeed = Math.max(rec.topSpeed, result.topSpeed || 0);
  state.records[trackId] = rec;
  state.stats.totalScore += result.total;
  state.stats.runs++;
  state.stats.bestCombo = Math.max(state.stats.bestCombo, result.bestCombo || 0);
  return rec;
}
