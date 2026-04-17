let currentPosition = null;
let currentHeading = 0;
let currentBearing = 0;
let gpxPoints = [];
let displayedRotation = 0;

// 🗺 GPX upload en opslag
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
if (savedGPX) {
  gpxPoints = JSON.parse(savedGPX);
}

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

// 📏 Afstand tot lijnstuk
function distanceToSegment(P, A, B) {
  const dx = B.lon - A.lon;
  const dy = B.lat - A.lat;
  if (dx === 0 && dy === 0) return Math.hypot(P.lat - A.lat, P.lon - A.lon);
  const t = ((P.lat - A.lat) * dy + (P.lon - A.lon) * dx) / (dx*dx + dy*dy);
  const tClamped = Math.max(0, Math.min(1, t));
  const proj = { lat: A.lat + tClamped * dy, lon: A.lon + tClamped * dx };
  return Math.hypot(P.lat - proj.lat, P.lon - proj.lon);
}

// 🔄 Kies “meest logische” punt
function nextGPXPoint(userPos, gpxPoints) {
  let minDist = Infinity;
  let nextPoint = gpxPoints[gpxPoints.length-1];
  for (let i = 0; i < gpxPoints.length - 1; i++) {
    const d = distanceToSegment(userPos, gpxPoints[i], gpxPoints[i+1]);
    if (d < minDist) {
      minDist = d;
      nextPoint = gpxPoints[i+1];
    }
  }
  return nextPoint;
}

// 🔄 Pijl draaien vloeiend
function updateArrow() {
  if (!currentPosition || gpxPoints.length === 0) return;
  const target = nextGPXPoint(currentPosition, gpxPoints);
  currentBearing = getBearing(currentPosition.lat, currentPosition.lon, target.lat, target.lon);
  let targetRotation = currentHeading - currentBearing;
  let delta = targetRotation - displayedRotation;
  displayedRotation += ((delta + 540) % 360) - 180;
  document.getElementById("arrow").style.transform = `rotate(${displayedRotation}deg)`;
}

// ▶️ Start knop
document.getElementById("startButton").addEventListener("click", async () => {
  await enableCompass();
});

// 📦 Service worker registreren
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js');
}
