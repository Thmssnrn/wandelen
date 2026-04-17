const amsterdam = { lat: 52.3676, lon: 4.9041 };

let currentPosition = null;
let currentHeading = 0;
let currentBearing = 0;

// 📍 GPS ophalen
navigator.geolocation.watchPosition(pos => {
  currentPosition = {
    lat: pos.coords.latitude,
    lon: pos.coords.longitude
  };

  updateBearing();
});

// 🧮 richting berekenen
function getBearing(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;

  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.cos(toRad(lon2 - lon1));

  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function updateBearing() {
  if (!currentPosition) return;

  currentBearing = getBearing(
    currentPosition.lat,
    currentPosition.lon,
    amsterdam.lat,
    amsterdam.lon
  );
}

// 🧭 Kompas activeren (iPhone-proof)
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
function updateArrow() {
  const rotation = currentHeading - currentBearing;

  document.getElementById("arrow").style.transform =
    `rotate(${rotation}deg)`;
}

// ▶️ Start knop
document.getElementById("startButton").addEventListener("click", async () => {
  await enableCompass();
});

// 📦 Service worker registreren
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js');
}
