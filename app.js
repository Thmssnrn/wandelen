let currentPosition = null;
let currentHeading = 0;
let currentBearing = 0;
let gpxPoints = [];

// 📍 GPX bestand laden
async function loadGPX(url) {
  const res = await fetch(url);
  const text = await res.text();
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  const trkpts = Array.from(xml.querySelectorAll('trkpt')).map(pt => ({
    lat: parseFloat(pt.getAttribute('lat')),
    lon: parseFloat(pt.getAttribute('lon'))
  }));
  return trkpts;
}

// 🧮 richting berekenen
function getBearing(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
            Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.cos(toRad(lon2 - lon1));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// 📏 afstand tot lijnstuk (Pythagoras)
function distanceToSegment(P, A, B) {
  const dx = B.lon - A.lon;
  const dy = B.lat - A.lat;
  if (dx === 0 && dy === 0) return Math.hypot(P.lat - A.lat, P.lon - A.lon);

  const t = ((P.lat - A.lat) * dy + (P.lon - A.lon) * dx) / (dx*dx + dy*dy);
  const tClamped = Math.max(0, Math.min(1, t));

  const proj = { lat: A.lat + tClamped * dy, lon: A.lon + tClamped * dx };
  return Math.hypot(P.lat - proj.lat, P.lon - proj.lon);
}

// 🔄 kies “meest logische” punt op GPX
function nextGPXPoint(userPos, gpxPoints) {
  let minDist = Infinity;
  let nextPoint = gpxPoints[gpxPoints.length-1];

  for (let i = 0; i < gpxPoints.length - 1; i++) {
    const d = distanceToSegment(userPos, gpxPoints[i], gpxPoints[i+1]);
    if (d < minDist) {
      minDist = d;
      nextPoint = gpxPoints[i+1]; // hoogste index van segment
    }
  }
  return nextPoint;
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

// 🔄 Pijl draaien
let displayedRotation = 0;
function updateArrow() {
  if (!currentPosition || gpxPoints.length === 0) return;
  const target = nextGPXPoint(currentPosition, gpxPoints);
  currentBearing = getBearing(currentPosition.lat, currentPosition.lon, target.lat, target.lon);
  let delta = currentHeading - currentBearing;
  delta = ((desired + 540) % 360) - 180; // normaliseer naar -180..180 (kortste richting)
  displayedRotation += delta;
  document.getElementById("arrow").style.transform =
    `rotate(${displayedRotation}deg)`;
}

// ▶️ Start knop
document.getElementById("startButton").addEventListener("click", async () => {
  await enableCompass();
});

// 📍 GPS volgen
navigator.geolocation.watchPosition(pos => {
  currentPosition = {
    lat: pos.coords.latitude,
    lon: pos.coords.longitude
  };
  updateArrow();
});

// 🗺 GPX laden
loadGPX('./route.gpx').then(points => { gpxPoints = points; });

// 📦 Service worker registreren
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js');
}
