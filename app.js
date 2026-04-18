let gpxPoints = [];
let currentPosition = null;

let currentHeading = 0;
let headingOffset = 0;
let hasOffset = false;

let displayedRotation = 0;
let currentBearing = 0;

let lastPosition = null;
let gpsHeading = 0;

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
    alert(`GPX geladen met ${gpxPoints.length} punten`);
  };

  reader.readAsText(file);
});

// Load saved GPX
const saved = localStorage.getItem("gpxPoints");
if (saved) gpxPoints = JSON.parse(saved);

// =========================
// START
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

  navigator.geolocation.watchPosition(onGPS, console.error, {
    enableHighAccuracy: true,
    maximumAge: 0
  });
}

// =========================
// COMPASS (iOS FIX)
// =========================
function handleOrientation(event) {
  let heading = null;

  if (event.webkitCompassHeading !== undefined) {
    heading = event.webkitCompassHeading;
  } else if (event.alpha !== null) {
    heading = event.alpha;
  }

  if (heading == null || isNaN(heading)) return;

  if (!hasOffset) {
    headingOffset = heading;
    hasOffset = true;
  }

  currentHeading = (heading - headingOffset + 360) % 360;

  updateArrow(); // 🔥 belangrijk!
}

// =========================
// GPS
// =========================
function onGPS(pos) {
  const newPos = {
    lat: pos.coords.latitude,
    lon: pos.coords.longitude
  };

  // GPS heading (fallback)
  if (lastPosition) {
    gpsHeading = getBearing(
      lastPosition.lat,
      lastPosition.lon,
      newPos.lat,
      newPos.lon
    );
  }

  lastPosition = newPos;
  currentPosition = newPos;

  updateArrow();
}

// =========================
// BEARING
// =========================
function getBearing(lat1, lon1, lat2, lon2) {
  const φ1 = lat1 * Math.PI/180;
  const φ2 = lat2 * Math.PI/180;
  const Δλ = (lon2 - lon1) * Math.PI/180;

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1)*Math.sin(φ2) -
    Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ);

  return (Math.atan2(y, x)*180/Math.PI + 360) % 360;
}

// =========================
// DISTANCE (meters)
// =========================
function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const φ1 = lat1 * Math.PI/180;
  const φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2 - lat1) * Math.PI/180;
  const Δλ = (lon2 - lon1) * Math.PI/180;

  const a =
    Math.sin(Δφ/2)**2 +
    Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;

  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// =========================
// NEXT GPX POINT (jouw logica + fix)
// =========================
function nextGPXPoint(pos, points) {
  if (points.length === 0) return null;

  let minDist = Infinity;
  let target = points[points.length - 1];

  const scale = Math.cos(pos.lat * Math.PI/180);

  for (let i = 0; i < points.length - 1; i++) {
    const A = points[i];
    const B = points[i + 1];

    const dx = (B.lon - A.lon) * scale;
    const dy = (B.lat - A.lat);

    const t =
      ((pos.lat - A.lat)*dy + (pos.lon - A.lon)*dx) /
      (dx*dx + dy*dy);

    const tClamped = Math.max(0, Math.min(1, t));

    const proj = {
      lat: A.lat + tClamped*dy,
      lon: A.lon + tClamped*dx
    };

    const dist = distanceMeters(pos.lat, pos.lon, proj.lat, proj.lon);

    if (dist < minDist) {
      minDist = dist;
      target = B;
    }
  }

  return target;
}

// =========================
// REMAINING DISTANCE
// =========================
function remainingDistanceKm(pos, points) {
  let dist = 0;

  if (points.length === 0) return dist;

  let minIndex = 0;
  let minDist = Infinity;

  for (let i = 0; i < points.length - 1; i++) {
    const d = distanceMeters(
      pos.lat,
      pos.lon,
      points[i].lat,
      points[i].lon
    );

    if (d < minDist) {
      minDist = d;
      minIndex = i;
    }
  }

  for (let i = minIndex; i < points.length - 1; i++) {
    dist += distanceMeters(
      points[i].lat,
      points[i].lon,
      points[i+1].lat,
      points[i+1].lon
    );
  }

  return dist / 1000;
}

// =========================
// UPDATE ARROW
// =========================
function updateArrow() {
  if (!currentPosition || gpxPoints.length === 0) return;

  const target = nextGPXPoint(currentPosition, gpxPoints);
  if (!target) return;

  currentBearing = getBearing(
    currentPosition.lat,
    currentPosition.lon,
    target.lat,
    target.lon
  );

  // 🔥 fallback als kompas niet werkt
  const heading = hasOffset ? currentHeading : gpsHeading;

  const targetRotation = currentBearing - heading;

  // smooth
  const smooth = 0.15;
  let delta = ((targetRotation - displayedRotation + 540) % 360) - 180;
  displayedRotation += delta * smooth;

  document.getElementById("arrow").style.transform =
    `rotate(${displayedRotation}deg)`;

  const rest = remainingDistanceKm(currentPosition, gpxPoints);
  document.getElementById("distance").innerText =
    `Restafstand: ${rest.toFixed(2)} km`;

  updateDebug(target);
}

// =========================
// DEBUG (volledig terug)
// =========================
function updateDebug(target) {
  const debugDiv = document.getElementById("debug");

  debugDiv.innerHTML = `
    <b>Positie</b><br>
    ${currentPosition?.lat?.toFixed(6)}, ${currentPosition?.lon?.toFixed(6)}<br><br>

    <b>Kompas</b><br>
    heading: ${currentHeading.toFixed(2)}°<br>
    offset: ${headingOffset.toFixed(2)}<br>
    hasOffset: ${hasOffset}<br><br>

    <b>GPS heading (fallback)</b><br>
    ${gpsHeading.toFixed(2)}°<br><br>

    <b>Routing</b><br>
    bearing: ${currentBearing.toFixed(2)}°<br>
    rotatie: ${displayedRotation.toFixed(2)}°<br><br>

    <b>Target</b><br>
    ${target.lat.toFixed(6)}, ${target.lon.toFixed(6)}<br><br>

    <b>Restafstand</b><br>
    ${remainingDistanceKm(currentPosition, gpxPoints).toFixed(3)} km
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
