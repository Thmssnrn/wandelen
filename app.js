let gpxPoints = [];
let currentPosition = null;

let currentHeading = 0;
let headingOffset = 0;
let hasOffset = false;

let displayedRotation = 0;
let currentBearing = 0;

// Snap buffer in meters
const SNAP_RADIUS_METERS = 10;


// GPX UPLOAD
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

// START
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

// COMPASS
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

// GPS
function onGPS(pos) {
  currentPosition = {
    lat: pos.coords.latitude,
    lon: pos.coords.longitude
  };

  updateArrow();
}

// BEARING
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

// GPX: VOLGENDE TARGET (SEGMENT-GEBASEERD + SNAP)
function nextGPXPoint(pos, points) {
  if (points.length === 0) return null;

  let minDist = Infinity;
  let targetIndex = points.length - 1; // fallback: laatste punt

  // Vind het dichtstbijzijnde segment
  for (let i = 0; i < points.length - 1; i++) {
    const A = points[i];
    const B = points[i + 1];

    const dx = B.lon - A.lon;
    const dy = B.lat - A.lat;
    const t = ((pos.lat - A.lat) * dy + (pos.lon - A.lon) * dx) / (dx*dx + dy*dy);
    const tClamped = Math.max(0, Math.min(1, t));
    const proj = { lat: A.lat + tClamped*dy, lon: A.lon + tClamped*dx };

    const d = distanceMeters(pos.lat, pos.lon, proj.lat, proj.lon);

    if (d < minDist) {
      minDist = d;
      targetIndex = i + 1; // altijd het **tweede punt van het segment**
    }
  }

  // Pas snap buffer toe: als we dichtbij het **huidige target** zijn, spring naar **het volgende segment**
  if (targetIndex < points.length - 1) {
    const target = points[targetIndex];
    if (distanceMeters(pos.lat, pos.lon, target.lat, target.lon) <= SNAP_RADIUS_METERS) {
      targetIndex += 1;
    }
  }

  // Veiligheid: index nooit buiten array
  if (targetIndex >= points.length) targetIndex = points.length - 1;

  return points[targetIndex];
}

// REMAINING DISTANCE VANAF PROJECTIE OP SEGMENT
function remainingDistanceKm(pos, points) {
  if (points.length === 0) return 0;

  let minDist = Infinity;
  let segmentIndex = 0;
  let projPoint = points[0];

  // Vind dichtstbijzijnde segment en projectie
  for (let i = 0; i < points.length - 1; i++) {
    const A = points[i];
    const B = points[i + 1];
    const dx = B.lon - A.lon;
    const dy = B.lat - A.lat;
    const t = ((pos.lat - A.lat) * dy + (pos.lon - A.lon) * dx) / (dx*dx + dy*dy);
    const tClamped = Math.max(0, Math.min(1, t));
    const proj = { lat: A.lat + tClamped*dy, lon: A.lon + tClamped*dx };
    const d = distanceMeters(pos.lat, pos.lon, proj.lat, proj.lon);

    if (d < minDist) {
      minDist = d;
      segmentIndex = i;
      projPoint = proj;
    }
  }

  // Bereken restafstand vanaf projectiepunt
  let dist = 0;

  // afstand van projectiepunt naar eindpunt van het segment
  const nextPoint = points[segmentIndex + 1];
  dist += distanceMeters(projPoint.lat, projPoint.lon, nextPoint.lat, nextPoint.lon);

  // afstand van resterende punten tot het einde van de track
  for (let i = segmentIndex + 1; i < points.length - 1; i++) {
    dist += distanceMeters(points[i].lat, points[i].lon, points[i + 1].lat, points[i + 1].lon);
  }

  return dist / 1000; // km
}

// HULPFUNCTIE: Afstand in meters
function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // aarde radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
}

// UPDATE ARROW
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
  displayedRotation = ((targetRotation + 540) % 360) - 180;

  document.getElementById("arrow").style.transform = `rotate(${displayedRotation}deg)`;
  document.getElementById("arrowRotation").innerText = 
    Math.abs(displayedRotation) < 2.5 ?
    "0°" : `${Math.round(-displayedRotation)}°`;

  const rest = remainingDistanceKm(currentPosition, gpxPoints);
  document.getElementById("distance").innerText =
    rest >= .995 ? // Grens bij 995 m (groter -> 1,0 km; kleiner -> 990 m)
    `Restafstand: ${Math.round(rest * 10) / 10} km`.replace('.', ',') :
    `Restafstand: ${Math.round(rest * 100) * 10} m`.replace('.', ',');

  updateDebug(target);
}

// DEBUG
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

// START BUTTON
document.getElementById("startButton").addEventListener("click", startCompass);


// SERVICE WORKER
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("service-worker.js");
}
