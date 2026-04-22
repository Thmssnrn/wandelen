let gpxPoints = [];
let gpxBounds = null;

let currentHeading = 0;
let headingOffset = 0;
let hasOffset = false;

let displayedRotation = 0;
let currentBearing = 0;

let currentPosition = null;
let gpsHeading = null;
let gpsSpeed = 0;
let gpsSince = null;
const GPS_MIN_DURATION = 3000; // 3 sec

let watchId = null;
let orientationActive = false;

let inactivityTimeout = null;
const INACTIVITY_LIMIT = 30000; // 30 sec

let currentSegmentIndex = 0;
let lastUpdate = 0;
let currentView = "compassView";

// HELPERS
function degToRad(φ) {
  return φ * Math.PI / 180;
}

function radToDeg(φ) {
  return φ * 180 / Math.PI;
}

// START
async function startTracking() {
  // Compass toestemming (iOS)
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

  // Start compass
  if (!orientationActive) {
    window.addEventListener("deviceorientation", handleOrientation);
    orientationActive = true;
  }
  
  // Reset offset
  hasOffset = false;

  // Start GPS
  if (watchId === null) {
    watchId = navigator.geolocation.watchPosition(
      (pos) => { // on update:
          currentPosition = {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude
          };

          gpsHeading = pos.coords.heading;
          gpsSpeed = pos.coords.speed;

          if (gpsSpeed > 0.5) { // 1,8 km/h
            gpsSince ??= Date.now(); // alleen wijzigen als gpsSince === null, anders laten staan
          } else gpsSince = null;
        
          if (currentView === "compassView") updateArrow();
          else updateMap();
      },
      (err) => console.error(err),
      { // Configureer GPS:
        enableHighAccuracy: true,
        maximumAge: 3000,
        timeout: 5000
      }
    );
  }

  // Start User Inactivity Listeners
  const events = ["mousedown", "touchstart"];
  events.forEach(event => {
    document.addEventListener(event, () => {
      if (inactivityTimeout) clearTimeout(inactivityTimeout);
      inactivityTimeout = setTimeout(stopTracking, INACTIVITY_LIMIT);
    }, { passive: true });
  });

  // Start User Inactivity Timer
  if (inactivityTimeout) clearTimeout(inactivityTimeout);
  inactivityTimeout = setTimeout(stopTracking, INACTIVITY_LIMIT);
}

// PAUZE
function stopTracking() {
  // Stop compass
  if (orientationActive) {
    window.removeEventListener("deviceorientation", handleOrientation);
    orientationActive = false;
  }

  // Stop GPS
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  
  // Stop timer
  if (inactivityTimeout) {
    clearTimeout(inactivityTimeout);
    inactivityTimeout = null;
  }
  
  // fullscreen "overlay button" listener
  const overlay = document.getElementById("userGestureOverlay");
  overlay.style.display = "block";
  overlay.style.pointerEvents = "auto";
  
  overlay.addEventListener("click", () => {
    overlay.style.display = "none";
    overlay.style.pointerEvents = "none";
    startTracking();
  }, { once: true });
}

// COMPASS
function handleOrientation(event) {
  if (currentView !== "compassView") return;
  
  let heading = null;

  if (!isNaN(event.webkitCompassHeading)) {
    heading = event.webkitCompassHeading;
  } else if (!isNaN(event.alpha)) {
    heading = event.alpha;
  } else return;

  if (hasOffset) {
    currentHeading = (heading - headingOffset + 360) % 360;
  } else {
    headingOffset = heading;
    hasOffset = true;
    currentHeading = 0;
  }
  if (gpsHeading !== null && gpsSpeed > 0.5) {
    currentHeading = 0.9 * currentHeading + 0.1 * gpsHeading; // smoothing, maar ik betwijfel of het iets doet
  }
  updateArrow();
}

// GPX
function nextGPXPoint(pos, points) {
  if (points.length === 0) return null;

  let minDist = Infinity;
  let bestIndex = currentSegmentIndex;

  const BACKWARD_WINDOW = 3;
  const FORWARD_WINDOW = 10;

  const start = Math.max(0, currentSegmentIndex - BACKWARD_WINDOW);
  const end = Math.min(points.length - 1, currentSegmentIndex + FORWARD_WINDOW);

  // Zoek lokaal
  for (let i = start; i < end; i++) {
    // Projectie -> afstand tot het segment ipv het punt
    const A = points[i];
    const B = points[i + 1];

    const scale = Math.cos(degToRad(A.lat + B.lat) / 2);
    const dx = (B.lon - A.lon) * scale;
    const dy = B.lat - A.lat;

    const t = ((pos.lat - A.lat) * dy + (pos.lon - A.lon) * dx) / (dx*dx + dy*dy);
    const tClamped = Math.max(0, Math.min(1, t));

    const proj = {
      lat: A.lat + tClamped * dy,
      lon: A.lon + tClamped * dx / scale
    };

    const d = distanceMeters(pos, proj);

    if (d < minDist) {
      minDist = d;
      bestIndex = i + 1;
    }
  }

  // Fallback als we te ver weg zitten → globale search
  if (minDist > 33) {
    for (let i = 0; i < points.length - 1; i++) {
      // Projectie -> afstand tot het segment ipv het punt
      const A = points[i];
      const B = points[i + 1];

      const dx = B.lon - A.lon;
      const dy = B.lat - A.lat;

      const t = ((pos.lat - A.lat) * dy + (pos.lon - A.lon) * dx) / (dx*dx + dy*dy);
      const tClamped = Math.max(0, Math.min(1, t));

      const proj = {
        lat: A.lat + tClamped * dy,
        lon: A.lon + tClamped * dx
      };

      const d = distanceMeters(pos, proj);

      if (d < minDist) {
        minDist = d;
        bestIndex = i + 1;
      }
    }
  }

  // Update progress (maar voorkom onrealistische sprongen naar achteren)
  if (bestIndex > currentSegmentIndex - 5) {
    currentSegmentIndex = Math.min(bestIndex, points.length - 1);
  }

  let target = { ...gpxPoints[currentSegmentIndex] }; // Maak een kopie

  // LOOK-AHEAD LOGICA bij bochten
  if (currentSegmentIndex < gpxPoints.length - 1) {
    const distToNext = distanceMeters(currentPosition, target);

    if (distToNext < 15) {
      const lookAheadMeters = Math.max(0, 15 - distToNext);

      const nextNext = gpxPoints[currentSegmentIndex + 1];
      const dx = nextNext.lon - target.lon;
      const dy = nextNext.lat - target.lat;

      const segmentDist = distanceMeters(target, nextNext);
      const t = Math.min(1, lookAheadMeters / segmentDist);

      target.lat += t * dy;
      target.lon += t * dx;
    }
  }

  return target
}

// AFSTAND TUSSEN TWEE PUNTEN
function distanceMeters(loc1, loc2) {
  const φ1 = degToRad(loc1.lat);
  const φ2 = degToRad(loc2.lat);
  const Δφ = degToRad(loc2.lat - loc1.lat);
  const Δλ = degToRad(loc2.lon - loc1.lon);

  const a = Math.sin(Δφ / 2) ** 2 +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return 6371000 * c; // straal aarde in meters
}

// UPDATE ARROW
function updateArrow() {
  if (currentView !== "compassView") return;
  const UPDATE_INTERVAL = gpsSpeed >= 0.5 ? 1000 : 250;  // m/s en ms
  const now = Date.now();
  if (now - lastUpdate < UPDATE_INTERVAL) return;
  if (!currentPosition || gpxPoints.length === 0) return;
  lastUpdate = now;

  // Bepaal het "huidige target"
  let target = nextGPXPoint(currentPosition, gpxPoints);
  if (!target) return;

  // GET BEARING
  const φ1 = degToRad(currentPosition.lat);
  const φ2 = degToRad(target.lat);
  const Δλ = degToRad(target.lon - currentPosition.lon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

  currentBearing = radToDeg(Math.atan2(y, x));
  currentBearing = (currentBearing + 360) % 360;


  // Richting pijl aanpassen op basis van compass
  const prevRotation = displayedRotation;
  const targetRotation = currentBearing - currentHeading;
  displayedRotation = ((targetRotation + 540) % 360) - 180;

  const arrow = document.getElementById("arrow");

  if (gpsSpeed > 0.5) {
    arrow.style.transition = "transform 1s linear";
  } else {
    arrow.style.transition = "transform 0.25s linear";
  }
  document.getElementById("arrow").style.transform = `rotate(${displayedRotation}deg)`;
  document.getElementById("arrowRotation").innerText = `${Math.round(-displayedRotation)}°`;

  // GEKLEURDE ACHTERGROND
  if (gpsSince !== null && gpsHeading !== null && now - gpsSince >= GPS_MIN_DURATION) {
    let diff = Math.abs(currentBearing - gpsHeading) % 360;
    if (diff > 45 || 360 - diff > 45) { // graden
      document.getElementById("arrow").style.backgroundColor = "red";
      navigator.vibrate?.(200);
    } else {
      document.getElementById("arrow").style.backgroundColor = "white";
    }
  }

  // RESTERENDE AFSTAND
  const rest = target.remainingDistance + distanceMeters(currentPosition, target);
  document.getElementById("distance").innerText =
    rest >= 995 ?
    `Nog ${Math.round(rest / 100) / 10} km`.replace('.', ',') :
    `Nog ${Math.round(rest / 10) * 10} m`.replace('.', ',');

  // HOOGTEMETERS
  const elev = gpxPoints[currentSegmentIndex];
  document.getElementById("elevation").innerText =
    `⭡ ${elev.remainingAscent} m, ⭣ ${elev.remainingDescent} m`;

  // DEBUG
  document.getElementById("debug").innerHTML = `
    <b>Positie</b><br>
    ${currentPosition.lat.toFixed(6)}, ${currentPosition.lon.toFixed(6)}<br><br>

    <b>Kompas</b><br>
    heading: ${currentHeading.toFixed(2)}°<br>
    offset: ${headingOffset.toFixed(2)}<br>
    hasOffset: ${hasOffset}<br><br>

    <b>Routing</b><br>
    bearing: ${currentBearing.toFixed(2)}°<br>
    rotatie: ${displayedRotation.toFixed(2)}°<br>
    segment: ${currentSegmentIndex}<br><br>

    <b>Target</b><br>
    ${target.lat.toFixed(6)}, ${target.lon.toFixed(6)}<br><br>

    <b>Restafstand</b><br>
    ${rest.toFixed(1)} m<br><br>
    
    <b>Hoogtemeters</b><br>
    Ascent: ${gpxPoints[currentSegmentIndex].remainingAscent}<br>
    Descent: ${gpxPoints[currentSegmentIndex].remainingDescent}
  `;
}

// PROJECTIE
function project(lat, lon, bounds, width, height) {
  const x = (lon - bounds.minLon) / (bounds.maxLon - bounds.minLon);
  const y = (lat - bounds.minLat) / (bounds.maxLat - bounds.minLat);

  return {
    x: x * width,
    y: height - (y * height)
  };
}

// OVERZICHTSKAART
function updateMap() {
  if (currentView !== "mapView") return;
  const UPDATE_INTERVAL = 60000;  // ms
  const now = Date.now();
  if (now - lastUpdate < UPDATE_INTERVAL) return;
  if (!currentPosition || gpxPoints.length === 0) return;
  lastUpdate = now;
    
  const canvas = document.getElementById("mapCanvas");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // ROUTE
  ctx.lineWidth = 4;

  // afgelegd
  ctx.beginPath();
  for (let i = 0; i <= currentSegmentIndex; i++) {
    const { x, y } = project(gpxPoints[i].lat, gpxPoints[i].lon, gpxBounds, ctx.canvas.width, ctx.canvas.height);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "#007AFF";
  ctx.stroke();

  // resterend
  ctx.beginPath();
  for (let i = currentSegmentIndex; i < gpxPoints.length; i++) {
    const { x, y } = project(gpxPoints[i].lat, gpxPoints[i].lon, gpxBounds, ctx.canvas.width, ctx.canvas.height);
    if (i === currentSegmentIndex) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "#ccc";
  ctx.stroke();

  // USER LOCATION
  let { x, y } = project(
    currentPosition.lat,
    currentPosition.lon,
    gpxBounds,
    ctx.canvas.width,
    ctx.canvas.height
  );

  ctx.beginPath();
  ctx.arc(x, y, 8, 0, Math.PI * 2);
  ctx.fillStyle = "red";
  ctx.fill();
  
  // HOOGTEPRROFIEL
  const elevCtx = document.getElementById("elevationCanvas").getContext("2d");
  const maxElev = Math.max(...gpxPoints.map(p => p.ele));
  const minElev = Math.min(...gpxPoints.map(p => p.ele));

  elevCtx.beginPath();

  gpxPoints.forEach((p, i) => {
    x = (i / gpxPoints.length) * elevCtx.canvas.width;
    y = (1 - (p.ele - minElev) / (maxElev - minElev)) * elevCtx.canvas.height;

    if (i === 0) elevCtx.moveTo(x, y);
    else elevCtx.lineTo(x, y);
  });

  elevCtx.strokeStyle = "#666";
  elevCtx.stroke();

  // huidige positie
  x = (currentSegmentIndex / gpxPoints.length) * elevCtx.canvas.width;
  elevCtx.beginPath();
  elevCtx.moveTo(x, 0);
  elevCtx.lineTo(x, elevCtx.canvas.height);
  elevCtx.strokeStyle = "red";
  elevCtx.stroke();
  
  document.getElementById("progressText").innerText = `${Math.round((currentSegmentIndex - 1) / gpxPoints.length * 100)}% voltooid`;
  document.getElementById("remainingText").innerText = `Nog ${(gpxPoints[currentSegmentIndex].remainingDistance/1000).toFixed(1)} km`;
}


// START BUTTON
document.getElementById("startButton").addEventListener("click", startTracking);


// GPX UPLOAD
document.getElementById("gpxUpload").addEventListener("change", function(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(event) {
    const parser = new DOMParser();
    const xml = parser.parseFromString(event.target.result, "text/xml");
    
    let trkpts = xml.getElementsByTagName("trkpt");
    if (xml.getElementsByTagName("parsererror").length > 0) {
      alert("Fout bij het lezen van GPX-bestand");
      return;
    }
    if (trkpts.length === 0) {
      trkpts = xml.getElementsByTagName("rtept");
      if (trkpts.length === 0) {
        alert("Dit GPX-bestand bevat geen trackpunten");
        return;
      }
    }

    gpxPoints = [];
    for (let i = 0; i < trkpts.length; i++) {
      const eleNode = trkpts[i].getElementsByTagName("ele")[0];      
      gpxPoints.push({
        lat: parseFloat(trkpts[i].getAttribute("lat")),
        lon: parseFloat(trkpts[i].getAttribute("lon")),
        ele: eleNode ? parseFloat(eleNode.textContent) : 0,
        remainingAscent:  null, // vul later
        remainingDescent: null, // vul later
        remainingDistance: null // vul later
      });
    }
    
    // Bereken alvast de hoogtemeters
    let ascent = 0;
    let descent = 0;
    
    for (let i = gpxPoints.length - 1; i >= 0; i--) {
      gpxPoints[i].remainingAscent = ascent;
      gpxPoints[i].remainingDescent = descent;
    
      if (i > 0) {
        const delta = gpxPoints[i].ele - gpxPoints[i - 1].ele;
        if (delta > 0) ascent += delta;
        else descent -= delta; // - (negatieve delta) === + positieve delta
      }
    }

    // Verberg de hoogtemeter-data bij vlakke routes
    if (ascent < 75 && descent < 75) {
      document.getElementById("elevation").style.display = "none";
    } else {
      document.getElementById("elevation").style.display = "block";
    }

    // Bereken alvast de afstand
    let distance = 0
    for (let i = gpxPoints.length - 1; i >= 0; i--) {
      gpxPoints[i].remainingDistance = distance;
    
      if (i > 0) {
        distance += distanceMeters(gpxPoints[i], gpxPoints[i - 1]);
      }
    }

    // Bereken alvast de bounds voor de kaart
    gpxBounds = {
      minLat: Infinity,
      maxLat: -Infinity,
      minLon: Infinity,
      maxLon: -Infinity
    };
    
    gpxPoints.forEach(p => {
      gpxBounds.minLat = Math.min(gpxBounds.minLat, p.lat);
      gpxBounds.maxLat = Math.max(gpxBounds.maxLat, p.lat);
      gpxBounds.minLon = Math.min(gpxBounds.minLon, p.lon);
      gpxBounds.maxLon = Math.max(gpxBounds.maxLon, p.lon);
    });
    
    // marge toevoegen
    gpxBounds.minLat -= gpxPoints.length / 100000;
    gpxBounds.maxLat += gpxPoints.length / 100000;
    gpxBounds.minLon -= gpxPoints.length / 100000;
    gpxBounds.maxLon += gpxPoints.length / 100000;
    
    // globaal opslaan    
    localStorage.setItem("gpxPoints", JSON.stringify(gpxPoints));
    currentSegmentIndex = 0;
    alert(`GPX geladen met ${gpxPoints.length} punten`);
  };

  reader.readAsText(file);
});

// Load saved GPX
const saved = localStorage.getItem("gpxPoints");
if (saved) gpxPoints = JSON.parse(saved);


// VISIBILITY API
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopTracking();
  } else {
    startTracking();
  }
});

// SERVICE WORKER
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("service-worker.js");
}

// TOGGLE VIEW
document.getElementById("toggleViewButton").onclick = () => {
  const otherView = currentView === "compassView" ? "mapView" : "compassView";
  document.getElementById(otherView).classList.add("active");
  document.getElementById(currentView).classList.remove("active");

  currentView = otherView;
};
