let gpxPoints = [];
let currentPosition = null;

let currentHeading = 0;
let headingOffset = 0;
let hasOffset = false;

let displayedRotation = 0;
let lastPosition = null;

// =========================
// GPX UPLOAD
// =========================
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
      gpxPoints.push({
        lat: parseFloat(trkpts[i].getAttribute("lat")),
        lon: parseFloat(trkpts[i].getAttribute("lon"))
      });
    }

    localStorage.setItem("gpxPoints", JSON.stringify(gpxPoints));
    alert(`GPX geladen: ${gpxPoints.length} punten`);
  };

  reader.readAsText(file);
});

// Load saved GPX
const saved = localStorage.getItem("gpxPoints");
if (saved) gpxPoints = JSON.parse(saved);

// =========================
// COMPASS
// =========================
async function startCompass() {
  if (
    typeof DeviceOrientationEvent !== "undefined" &&
    typeof DeviceOrientationEvent.requestPermission === "function"
  ) {
    const state = await DeviceOrientationEvent.requestPermission();
    if (state !== "granted") {
      alert("Geen compass toestemming");
      return;
    }
  }

  window.addEventListener("deviceorientation", handleOrientation);

  // GPS
  navigator.geolocation.watchPosition(onGPS, console.error, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 5000
  });
}

function handleOrientation(event) {
  let alpha = event.webkitCompassHeading ?? event.alpha;

  if (alpha == null) return;

  if (!hasOffset) {
    headingOffset = alpha;
    hasOffset = true;
  }

  currentHeading = (alpha - headingOffset + 360) % 360;
}

// =========================
// GPS (met filtering)
// =========================
function onGPS(pos) {
  const newPos = {
    lat: pos.coords.latitude,
    lon: pos.coords.longitude
  };

  // Filter kleine jitter (< 5 meter)
  if (lastPosition) {
    const d = distanceMeters(
      lastPosition.lat,
      lastPosition.lon,
      newPos.lat,
      newPos.lon
    );
    if (d < 5) return;
  }

  lastPosition = newPos;
  currentPosition = newPos;

  updateArrow();
}

// =========================
// Haversine distance
// =========================
function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) ** 2;

  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// =========================
// BEARING
// =========================
function getBearing(lat1, lon1, lat2, lon2) {
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// =========================
// ROUTE LOGIC (LOOK AHEAD)
// =========================
function getClosestSegmentIndex(pos, points) {
  let minDist = Infinity;
  let index = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const d = distanceMeters(
      pos.lat,
      pos.lon,
      points[i].lat,
      points[i].lon
    );

    if (d < minDist) {
      minDist = d;
      index = i;
    }
  }

  return index;
}

// Kijk ~30 meter vooruit op route
function getLookAheadPoint(pos, points) {
  const startIndex = getClosestSegmentIndex(pos, points);

  let dist = 0;

  for (let i = startIndex; i < points.length - 1; i++) {
    const d = distanceMeters(
      points[i].lat,
      points[i].lon,
      points[i + 1].lat,
      points[i + 1].lon
    );

    dist += d;

    if (dist > 30) {
      return points[i + 1];
    }
  }

  return points[points.length - 1];
}

// =========================
// REMAINING DISTANCE
// =========================
function remainingDistanceKm(pos, points) {
  const startIndex = getClosestSegmentIndex(pos, points);

  let dist = 0;

  for (let i = startIndex; i < points.length - 1; i++) {
    dist += distanceMeters(
      points[i].lat,
      points[i].lon,
      points[i + 1].lat,
      points[i + 1].lon
    );
  }

  return dist / 1000;
}

// =========================
// UI UPDATE
// =========================
function updateArrow() {
  if (!currentPosition || gpxPoints.length === 0) return;

  const target = getLookAheadPoint(currentPosition, gpxPoints);

  const bearing = getBearing(
    currentPosition.lat,
    currentPosition.lon,
    target.lat,
    target.lon
  );

  const targetRotation = bearing - currentHeading;

  // Smooth rotation
  const smoothFactor = 0.15;
  let delta = ((targetRotation - displayedRotation + 540) % 360) - 180;
  displayedRotation += delta * smoothFactor;

  document.getElementById("arrow").style.transform =
    `rotate(${displayedRotation}deg)`;

  // Distance
  const rest = remainingDistanceKm(currentPosition, gpxPoints);
  document.getElementById("distance").innerText =
    `Restafstand: ${rest.toFixed(2)} km`;

  updateDebug(target, bearing);
}

// =========================
// DEBUG
// =========================
function updateDebug(target, bearing) {
  const el = document.getElementById("debug");

  el.innerHTML = `
    <b>Debug</b><br>
    Heading: ${currentHeading.toFixed(1)}°<br>
    Bearing: ${bearing.toFixed(1)}°<br>
    Rotatie: ${displayedRotation.toFixed(1)}°<br>
    Target: ${target.lat.toFixed(5)}, ${target.lon.toFixed(5)}
  `;
}

// =========================
// START BUTTON
// =========================
document.getElementById("startButton").addEventListener("click", startCompass);

// =========================
// SERVICE WORKER
// =========================
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("service-worker.js");
}
