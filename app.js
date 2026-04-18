let gpxPoints = [];
let currentPosition = null;

let currentHeading = 0;
let headingOffset = 0;
let hasOffset = false;

let displayedRotation = 0;
let currentBearing = 0;

// Snap buffer in meters
const SNAP_RADIUS_METERS = 5;

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
// COMPASS
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

  updateArrow();
}

// =========================
// GPS
// =========================
function onGPS(pos) {
  currentPosition = {
    lat: pos.coords.latitude,
    lon: pos.coords.longitude
  };

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
// DISTANCE
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
// NEXT GPX POINT MET SNAP BUFFER
// =========================
function nextGPXPoint(pos, points) {
  if (points.length === 0) return null;

  const scale = Math.cos(pos.lat * Math.PI/180);

  for (let i = 0; i < points.length - 1; i++) {
    const target = points[i + 1];
    const d = distanceMeters(pos.lat, pos.lon, target.lat, target.lon);

    if (d <= SNAP_RADIUS_METERS) {
      return points[i + 2] || target; // snap naar volgende
    }
  }

  // fallback: het dichtstbijzijnde punt
  let minDist = Infinity;
  let closest = points[points.length - 1];
  for (const p of points) {
    const d = distanceMeters(pos.lat, pos.lon, p.lat, p.lon);
    if (d < minDist) {
      minDist = d;
      closest = p;
    }
  }
  return closest;
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
    const d = distanceMeters(pos.lat, pos.lon, points[i].lat, points[i].lon);

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

  const targetRotation = currentBearing - currentHeading;

  // smooth rotation
  const smooth = 0.15;
  let delta = ((targetRotation - displayedRotation + 540) % 360) - 180;
  displayedRotation += delta * smooth;

  document.getElementById("arrow").style.transform =
    `rotate(${displayedRotation}deg)`;

  // Rotatie boven pijl
  document.getElementById("arrowRotation").innerText =
    `${Math.round(-displayedRotation)}°`;

  // Haptische feedback
  if ('vibrate' in navigator && Math.abs(displayedRotation) < 2) {
    navigator.vibrate(100);
  }

  const rest = remainingDistanceKm(currentPosition, gpxPoints);
  document.getElementById("distance").innerText =
    `Restafstand: ${rest.toFixed(2)} km`;

  updateDebug(target);
}

// =========================
// DEBUG
// =========================
function updateDebug(target) {
  if (!currentPosition || !target) return;

  const debugDiv = document.getElementById("debug");

  debugDiv.innerHTML = `
    <b>Positie</b><br>
    ${currentPosition.lat.toFixed(6)}, ${currentPosition.lon.toFixed(6)}<br><br>

    <b>Kompas</b><br>
    heading: ${currentHeading.toFixed(2)}°<br>
    offset: ${headingOffset.toFixed(2)}<br>
    hasOffset: ${hasOffset}<br><br>

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
