let currentPosition = null;
let currentHeading = 0;
let currentBearing = 0;
let gpxPoints = [];
let displayedRotation = 0;

// 📂 GPX upload en opslaan
document.getElementById("gpxUpload").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const text = await file.text();
  const parser = new DOMParser();
  const xml = parser.parseFromString(text, 'application/xml');

  const trkpts = Array.from(xml.querySelectorAll('trkpt')).map(pt => ({
    lat: parseFloat(pt.getAttribute('lat')),
    lon: parseFloat(pt.getAttribute('lon'))
  }));

  gpxPoints = trkpts;
  localStorage.setItem('gpxPoints', JSON.stringify(trkpts));
  alert("GPX geladen!");
});

// GPX bij opstarten laden uit localStorage
const savedGPX = localStorage.getItem('gpxPoints');
if (savedGPX) gpxPoints = JSON.parse(savedGPX);

// 🧭 Kompas activeren
async function enableCompass() {
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    const permission = await DeviceOrientationEvent.requestPermission();
    if (permission !== 'granted') {
      alert("Geen toestemming voor kompas");
      return;
    }
  }
  window.addEventListener('deviceorientation', e => {
    currentHeading = e.alpha || 0;
    updateArrow();
  });
}

// 📍 GPS volgen
navigator.geolocation.watchPosition(pos => {
  currentPosition = { lat: pos.coords.latitude, lon: pos.coords.longitude };
  updateArrow();
});

// 🧮 Bereken bearing
function getBearing(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
            Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.cos(toRad(lon2 - lon1));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// 🌍 Afstand tussen twee punten in km (Haversine)
function distanceKm(p1, p2) {
  const R = 6371; // km
  const dLat = (p2.lat - p1.lat) * Math.PI / 180;
  const dLon = (p2.lon - p1.lon) * Math.PI / 180;
  const lat1 = p1.lat * Math.PI / 180;
  const lat2 = p2.lat * Math.PI / 180;

  const a = Math.sin(dLat/2)**2 + Math.sin(dLon/2)**2 * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// 📏 Dichtstbijzijnde lijnstuk
function nextGPXPoint(userPos, gpxPoints) {
  let minDist = Infinity;
  let nextPoint = gpxPoints[gpxPoints.length-1];
  for (let i = 0; i < gpxPoints.length - 1; i++) {
    const A = gpxPoints[i];
    const B = gpxPoints[i+1];
    const dx = B.lon - A.lon;
    const dy = B.lat - A.lat;
    if (dx === 0 && dy === 0) continue;
    const t = ((userPos.lat - A.lat) * dy + (userPos.lon - A.lon) * dx) / (dx*dx + dy*dy);
    const tClamped = Math.max(0, Math.min(1, t));
    const proj = { lat: A.lat + tClamped * dy, lon: A.lon + tClamped * dx };
    const dist = Math.hypot(userPos.lat - proj.lat, userPos.lon - proj.lon);
    if (dist < minDist) {
      minDist = dist;
      nextPoint = B;
    }
  }
  return nextPoint;
}

// 🔄 Restafstand vanaf huidige positie tot eind GPX
function remainingDistanceKm(userPos, gpxPoints) {
  if (gpxPoints.length < 2) return 0;

  let minDist = Infinity;
  let segmentIndex = 0;
  let projPoint = gpxPoints[0];

  // Dichtstbijzijnde segment en projectie
  for (let i = 0; i < gpxPoints.length - 1; i++) {
    const A = gpxPoints[i];
    const B = gpxPoints[i+1];
    const dx = B.lon - A.lon;
    const dy = B.lat - A.lat;
    if (dx === 0 && dy === 0) continue;
    const t = ((userPos.lat - A.lat) * dy + (userPos.lon - A.lon) * dx) / (dx*dx + dy*dy);
    const tClamped = Math.max(0, Math.min(1, t));
    const proj = { lat: A.lat + tClamped * dy, lon: A.lon + tClamped * dx };
    const dist = Math.hypot(userPos.lat - proj.lat, userPos.lon - proj.lon);
    if (dist < minDist) {
      minDist = dist;
      segmentIndex = i;
      projPoint = proj;
    }
  }

  // Restafstand vanaf projectie tot eind
  let remaining = distanceKm(projPoint, gpxPoints[segmentIndex + 1]);
  for (let i = segmentIndex + 1; i < gpxPoints.length - 1; i++) {
    remaining += distanceKm(gpxPoints[i], gpxPoints[i+1]);
  }
  return remaining;
}

// 🔄 Pijl draaien en restafstand tonen
function updateArrow() {
  if (!currentPosition || gpxPoints.length === 0) return;
  const target = nextGPXPoint(currentPosition, gpxPoints);
  currentBearing = getBearing(currentPosition.lat, currentPosition.lon, target.lat, target.lon);

  // Vloeiende rotatie
  let targetRotation = currentBearing - currentHeading;
  let delta = targetRotation - displayedRotation;
  displayedRotation += ((delta + 540) % 360) - 180;
  document.getElementById("arrow").style.transform = `rotate(${displayedRotation}deg)`;

  // Restafstand
  const rest = remainingDistanceKm(currentPosition, gpxPoints);
  document.getElementById("distance").innerText = `Restafstand: ${rest.toFixed(2)} km`;

  // debug-update
  updateDebugInfo(currentBearing, currentHeading, displayedRotation);
}

// debug-update
function updateDebugInfo(currentBearing, currentHeading, displayedRotation) {
  if (!currentPosition || gpxPoints.length === 0) return;

  // Vind dichtstbijzijnde segment en projectiepunt
  let minDist = Infinity;
  let segmentIndex = 0;
  let projPoint = gpxPoints[0];
  for (let i = 0; i < gpxPoints.length - 1; i++) {
    const A = gpxPoints[i];
    const B = gpxPoints[i+1];
    const dx = B.lon - A.lon;
    const dy = B.lat - A.lat;
    if (dx === 0 && dy === 0) continue;
    const t = ((currentPosition.lat - A.lat) * dy + (currentPosition.lon - A.lon) * dx) / (dx*dx + dy*dy);
    const tClamped = Math.max(0, Math.min(1, t));
    const proj = { lat: A.lat + tClamped * dy, lon: A.lon + tClamped * dx };
    const dist = Math.hypot(currentPosition.lat - proj.lat, currentPosition.lon - proj.lon);
    if (dist < minDist) {
      minDist = dist;
      segmentIndex = i;
      projPoint = proj;
    }
  }

  const debugDiv = document.getElementById("debug");
  debugDiv.innerHTML = `
    <b>Debug Info:</b><br>
    Huidige positie: lat ${currentPosition.lat.toFixed(6)}, lon ${currentPosition.lon.toFixed(6)}<br>
    Dichtstbijzijnde segment: index ${segmentIndex} → ${segmentIndex+1}<br>
    Segmentpunten: A(${gpxPoints[segmentIndex].lat.toFixed(6)},${gpxPoints[segmentIndex].lon.toFixed(6)}) 
                    B(${gpxPoints[segmentIndex+1].lat.toFixed(6)},${gpxPoints[segmentIndex+1].lon.toFixed(6)})<br>
    Projectiepunt op segment: lat ${projPoint.lat.toFixed(6)}, lon ${projPoint.lon.toFixed(6)}<br>
    Restafstand: ${remainingDistanceKm(currentPosition, gpxPoints).toFixed(3)} km<br>
    currentHeading: ${currentHeading.toFixed(2)}°<br>
    currentBearing: ${currentBearing.toFixed(2)}°<br>
    displayedRotation: ${displayedRotation.toFixed(2)}°
  `;
}

// ▶️ Start knop
document.getElementById("startButton").addEventListener("click", async () => {
  await enableCompass();
});

// 📦 Service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js');
}
