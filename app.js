// app.js

let gpxPoints = [];
let currentPosition = null;
let currentHeading = 0;
let currentBearing = 0;
let displayedRotation = 0;
let headingOffset = 0;

// GPX upload
document.getElementById("gpxUpload").addEventListener("change", function(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(event) {
    const parser = new DOMParser();
    const xml = parser.parseFromString(event.target.result, "text/xml");
    const trkpts = xml.getElementsByTagName("trkpt");
    gpxPoints = [];
    for (let i = 0; i < trkpts.length; i++) {
      const pt = trkpts[i];
      gpxPoints.push({
        lat: parseFloat(pt.getAttribute("lat")),
        lon: parseFloat(pt.getAttribute("lon"))
      });
    }
    localStorage.setItem("gpxPoints", JSON.stringify(gpxPoints));
    alert(`GPX geladen met ${gpxPoints.length} punten`);
  };
  reader.readAsText(file);
});

// Load GPX from localStorage
const saved = localStorage.getItem("gpxPoints");
if (saved) gpxPoints = JSON.parse(saved);

// Start compass
function startCompass() {
  if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
    DeviceOrientationEvent.requestPermission().then(state => {
      if (state === "granted") {
        window.addEventListener("deviceorientation", handleOrientation);
      } else alert("Geen toestemming voor compass");
    });
  } else {
    window.addEventListener("deviceorientation", handleOrientation);
  }

  // Neem huidige alpha als 0° referentie
  headingOffset = getCurrentAlpha() || 0;

  // Start geolocatie
  if (navigator.geolocation) {
    navigator.geolocation.watchPosition(pos => {
      currentPosition = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude
      };
      updateArrow();
    }, err => console.error(err), { enableHighAccuracy: true, maximumAge: 1000 });
  }
}

// Device orientation handler
function handleOrientation(event) {
  let alpha;
  if (event.absolute && !isNaN(event.alpha)) {
    alpha = event.alpha;
  } else if (event.webkitCompassHeading) {
    alpha = event.webkitCompassHeading;
  } else {
    alpha = event.alpha;
  }

  if (alpha !== null) {
    currentHeading = (alpha - headingOffset + 360) % 360;
    updateArrow();
  }
}

// Huidige alpha ophalen (voor offset)
function getCurrentAlpha() {
  // Voor browsers zonder DeviceOrientationEvent API
  return currentHeading;
}

// Vloeiende pijl-update
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

  // Debug
  updateDebugInfo();
}

// Bereken bearing (graden)
function getBearing(lat1, lon1, lat2, lon2) {
  const φ1 = lat1 * Math.PI/180;
  const φ2 = lat2 * Math.PI/180;
  const Δλ = (lon2 - lon1) * Math.PI/180;
  const y = Math.sin(Δλ)*Math.cos(φ2);
  const x = Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ);
  let θ = Math.atan2(y, x)*180/Math.PI;
  return (θ + 360) % 360;
}

// Vind volgende GPX punt (meest logische)
function nextGPXPoint(pos, points) {
  if (points.length === 0) return null;
  let minDist = Infinity;
  let target = points[points.length-1];
  for (let i = 0; i < points.length-1; i++) {
    const A = points[i], B = points[i+1];
    const dx = B.lon - A.lon, dy = B.lat - A.lat;
    const t = ((pos.lat-A.lat)*dy + (pos.lon-A.lon)*dx)/(dx*dx+dy*dy);
    const tClamped = Math.max(0, Math.min(1, t));
    const proj = { lat: A.lat + tClamped*dy, lon: A.lon + tClamped*dx };
    const dist = Math.hypot(pos.lat - proj.lat, pos.lon - proj.lon);
    if (dist < minDist) {
      minDist = dist;
      target = B; // hoogste index van het segment
    }
  }
  return target;
}

// Restafstand berekenen
function remainingDistanceKm(pos, points) {
  let dist = 0;
  if (points.length === 0) return dist;
  let minIndex = 0;
  let minDist = Infinity;
  for (let i = 0; i < points.length-1; i++) {
    const A = points[i], B = points[i+1];
    const dx = B.lon - A.lon, dy = B.lat - A.lat;
    const t = ((pos.lat-A.lat)*dy + (pos.lon-A.lon)*dx)/(dx*dx+dy*dy);
    const tClamped = Math.max(0, Math.min(1, t));
    const proj = { lat: A.lat + tClamped*dy, lon: A.lon + tClamped*dx };
    const d = Math.hypot(pos.lat - proj.lat, pos.lon - proj.lon);
    if (d < minDist) { minDist = d; minIndex = i; }
  }
  // Sommeer afstand van projectiepunt naar eindpunt
  const A = points[minIndex], B = points[minIndex+1];
  const dx = B.lon - A.lon, dy = B.lat - A.lat;
  const t = ((pos.lat-A.lat)*dy + (pos.lon-A.lon)*dx)/(dx*dx+dy*dy);
  const tClamped = Math.max(0, Math.min(1, t));
  const proj = { lat: A.lat + tClamped*dy, lon: A.lon + tClamped*dx };
  // afstand van projectiepunt naar eindpunt van GPX
  for (let i = minIndex; i < points.length-1; i++) {
    const p1 = (i === minIndex)? proj : points[i];
    const p2 = points[i+1];
    dist += Math.hypot(p2.lat - p1.lat, p2.lon - p1.lon);
  }
  // Omrekenen naar km (approx)
  return dist * 111; 
}

// Debug info
function updateDebugInfo() {
  if (!currentPosition || gpxPoints.length === 0) return;

  let minDist = Infinity;
  let segmentIndex = 0;
  let projPoint = gpxPoints[0];
  for (let i = 0; i < gpxPoints.length-1; i++) {
    const A = gpxPoints[i], B = gpxPoints[i+1];
    const dx = B.lon-A.lon, dy = B.lat-A.lat;
    const t = ((currentPosition.lat-A.lat)*dy + (currentPosition.lon-A.lon)*dx)/(dx*dx+dy*dy);
    const tClamped = Math.max(0, Math.min(1, t));
    const proj = { lat: A.lat+tClamped*dy, lon: A.lon+tClamped*dx };
    const d = Math.hypot(currentPosition.lat-proj.lat, currentPosition.lon-proj.lon);
    if (d < minDist) { minDist = d; segmentIndex = i; projPoint = proj; }
  }

  const debugDiv = document.getElementById("debug");
  debugDiv.innerHTML = `
    <b>Debug Info:</b><br>
    Huidige positie: lat ${currentPosition.lat.toFixed(6)}, lon ${currentPosition.lon.toFixed(6)}<br>
    Dichtstbijzijnde segment: index ${segmentIndex} → ${segmentIndex+1}<br>
    Segmentpunten: A(${gpxPoints[segmentIndex].lat.toFixed(6)}, ${gpxPoints[segmentIndex].lon.toFixed(6)}) 
                   B(${gpxPoints[segmentIndex+1].lat.toFixed(6)}, ${gpxPoints[segmentIndex+1].lon.toFixed(6)})<br>
    Projectiepunt op segment: lat ${projPoint.lat.toFixed(6)}, lon ${projPoint.lon.toFixed(6)}<br>
    Restafstand: ${remainingDistanceKm(currentPosition, gpxPoints).toFixed(3)} km<br>
    <b>Pijl rotatie debug:</b><br>
    currentHeading: ${currentHeading.toFixed(2)}°<br>
    currentBearing: ${currentBearing.toFixed(2)}°<br>
    displayedRotation: ${displayedRotation.toFixed(2)}°
  `;
}

// ▶️ Start knop
document.getElementById("startButton").addEventListener("click", async () => {
  await startCompass();
});

// 📦 Service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js');
}
