let gpxPoints = [];
let gpxBounds = null;

let currentHeading = 0;
let currentBearing = 0;
let displayedRotation = 0;

let currentPosition = null;
let gpsHeading = null;
let gpsSpeed = null;
let gpsSince = NaN;
let gpsAccuracy = null;
let gpsUpdate = null;

let watchId = null;
let orientationActive = false;

let inactivityTimeout = null;
const INACTIVITY_LIMIT = 30000; // 30 sec
let inactivityHandler = null;
let resume = true;

let lastSegmentIndex = -1;
let currentSegmentIndex = 0;
let lastUpdate = null;
let currentView = "compassView";

let mapCtx = null;
let elevCtx = null;
let routePath = null;
let traveledPath = null;
let remainingPath = null;
let canvasReady = false;
let elevProfile = [];
let elevMin = -430; // Oevers Dode Zee
let elevMax = 8850; // Mount Everest

// HTML elements
const overlay = document.getElementById("userGestureOverlay");
const startButton = document.getElementById("startButton");
const uploadButton = document.getElementById("gpxUpload");
const toggleViewButton = document.getElementById("toggleViewButton");

const arrow = document.getElementById("arrow");
const arrowRotationText = document.getElementById("arrowRotation");
const distanceText = document.getElementById("distance");
const elevation = document.getElementById("elevation");
const nextTurnEl = document.getElementById("nextTurn");
const nextTurnArrow = document.getElementById("nextTurnArrow");
const nextTurnDistance = document.getElementById("nextTurnDistance");
const debugHTML = document.getElementById("debug");

const mapCanvas = document.getElementById("mapCanvas");
const elevCanvas = document.getElementById("elevationCanvas");
const userDot = document.getElementById("userDot");

// HELPERS
function degToRad(φ) {
  return φ * Math.PI / 180;
}

function radToDeg(φ) {
  return (φ * 180 / Math.PI + 360) % 360;
}

function radSqToMeters(φ) {
  return Math.sqrt(φ) * 6371000;
}

function distanceMeters(a, b) {
  const x = degToRad(b.lon - a.lon) * Math.cos(degToRad((a.lat + b.lat) / 2));
  const y = degToRad(b.lat - a.lat);
  return 6371000 * Math.sqrt(x*x + y*y);
}

function angleDiff(a, b) {
  let d = Math.abs(a - b + 360) % 360;
  return Math.min(d, 360 - d);
}


// START
async function startTracking() {
  // Compass toestemming
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

  // Start GPS
  if (watchId === null) {
    watchId = navigator.geolocation.watchPosition(
      (pos) => { // on update:
        const previousPosition = currentPosition;
        currentPosition = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude
        };

        gpsHeading = pos.coords.heading;
        gpsSpeed = pos.coords.speed * 3.6; // m/s -> km/h
        gpsAccuracy = pos.coords.accuracy;
        gpsUpdate = Date.now();

        if (gpsSpeed < 2) {
          gpsSince = NaN;
        } else {
          if (isNaN(gpsSince)) {
            gpsSince = Date.now();
          }
          else if (previousPosition !== null && gpsHeading === null && Date.now() - gpsSince >= 3000) {
            // Hier moeten we een aparte functie voor maken.
            const lat1 = degToRad(previousPosition.lat);
            const lat2 = degToRad(currentPosition.lat);
            const dLon = degToRad(currentPosition.lon - previousPosition.lon);
            const y = Math.sin(dLon) * Math.cos(lat2);
            const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
            gpsHeading = radToDeg(Math.atan2(y, x));
          }
        }
      
        if (currentView === "compassView") updateArrow();
        else updateMap();
      },
      (err) => console.error(err),
      { // Configureer GPS:
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 30000
      }
    );
  }
  
  // Start User Inactivity Listeners
  if (!inactivityHandler) {
    ["mousedown", "touchstart"].forEach(event => {
      document.addEventListener(event, () => {
        if (inactivityTimeout) clearTimeout(inactivityTimeout);
        inactivityTimeout = setTimeout(stopTracking, INACTIVITY_LIMIT);
      }, { passive: true });
    });
  }
  
  // Start User Inactivity Timer
  if (inactivityTimeout) clearTimeout(inactivityTimeout);
  inactivityTimeout = setTimeout(stopTracking, INACTIVITY_LIMIT);

  // Verwijder overlay
  overlay.style.display = "none";
  overlay.style.pointerEvents = "none";
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
  
  gpsSpeed = null;
  gpsSince += INACTIVITY_LIMIT;
  
  // Stop timer
  if (inactivityTimeout) {
    clearTimeout(inactivityTimeout);
    inactivityTimeout = null;
  }
  
  // fullscreen "overlay button" listener
  overlay.style.display = "block";
  overlay.style.pointerEvents = "auto";

  // Eerstvolgende meting negeren
  resume = false;
}

// COMPASS
function handleOrientation(event) {
  if (currentView !== "compassView") return;
  let UPDATE_INTERVAL = 250;
  if (gpsSpeed > 2 && angleDiff(currentHeading, lastHeading) <= 30) {
    UPDATE_INTERVAL = 1000;
  }
  
  const now = Date.now();
  if (now - lastUpdate < UPDATE_INTERVAL) return;
  lastUpdate = now;
  
  if (!isNaN(event.webkitCompassHeading)) {
    currentHeading = event.webkitCompassHeading;
  } else if (gpsHeading !== null && Date.now() - gpsSince >= 3000) {
    currentHeading = gpsHeading
  } else return;

  updateArrow();
}

// GPX
function nextGPXPoint(pos, points) {
  if (points.length === 0) return null;

  let minDist = Infinity;
  let bestIndex = currentSegmentIndex;
  let bestProj = pos;

  const BACKWARD_WINDOW = 3;
  const FORWARD_WINDOW = 10;

  const start = Math.max(0, currentSegmentIndex - BACKWARD_WINDOW);
  const end = Math.min(points.length - 1, currentSegmentIndex + FORWARD_WINDOW);

  const cosLat = Math.cos(degToRad(pos.lat));

  // Zoek lokaal
  for (let i = start; i < end; i++) {
    // Projectie -> afstand tot het segment ipv het punt
    const point = points[i];
    
    const t = ((pos.lat - point.lat) * point.dy + (pos.lon - point.lon) * point.dx) / point.lenSq;
    const tClamped = Math.max(0, Math.min(1, t));

    const projLat = point.lat + tClamped * point.dy;
    const projLon = point.lon + tClamped * point.dx / point.scale;

    const x = degToRad(projLon - pos.lon) * cosLat;
    const y = degToRad(projLat - pos.lat);
    const d = x*x + y*y;

    if (d < minDist) {
      minDist = d;
      bestIndex = i + 1;
      bestProj = {
        lat: projLat,
        lon: projLon,
        t: tClamped
      }
    }
  }

  // Fallback als we te ver weg zitten → global search
  if (radSqToMeters(minDist) > 50) {
    for (let i = 0; i < points.length - 1; i++) {
      if (i >= start && i < end) continue;
      
      // Projectie -> afstand tot het segment ipv het punt
      const point = points[i];
  
      const t = ((pos.lat - point.lat) * point.dy + (pos.lon - point.lon) * point.dx) / point.lenSq;
      const tClamped = Math.max(0, Math.min(1, t));

      const projLat = point.lat + tClamped * point.dy;
      const projLon = point.lon + tClamped * point.dx / point.scale;

      const x = degToRad(projLon - pos.lon) * cosLat;
      const y = degToRad(projLat - pos.lat);
      const d = x*x + y*y;

      if (d < minDist) {
        minDist = d;
        bestIndex = i + 1;
        bestProj = {
          lat: projLat,
          lon: projLon,
          t: tClamped
        }
      }
    }
  }
 
  // Update progress (maar voorkom onrealistische sprongen naar achteren)
  if (bestIndex > currentSegmentIndex - 5) {
    currentSegmentIndex = Math.min(bestIndex, points.length - 1);
  }

  let target = { ...gpxPoints[currentSegmentIndex] }; // Maak een kopie
  const distanceToRoute = radSqToMeters(minDist)
  
  if (distanceToRoute > 1000) {
    stopTracking();
    alert("**Let op!**\nKlik pas op *start* als je echt gaat starten!")
    return null;
  } else if (distanceToRoute > Math.max(15, gpsAccuracy + 5)) {
    bestProj.lat = pos.lat
    bestProj.lon = pos.lon
  } 

  const distanceToTarget = distanceMeters(target, bestProj)

  // LOOK-AHEAD LOGICA bij bochten
  if (currentSegmentIndex < gpxPoints.length - 1 && distanceToTarget < 50) {
    let lookAheadMeters = 30 - distanceToTarget;
    if (Date.now() - gpsUpdate > 300) lookAheadMeters += 10;
    if (gpsSpeed > 4) lookAheadMeters += 10;
    
    if (lookAheadMeters > 0) {
      const segmentDist = radSqToMeters(target.lenSq);
      const t = Math.min(1, lookAheadMeters / segmentDist); // Waarom is dit nodig?
  
      target.lon += target.dx * t;
      target.lat += target.dy * t / target.scale
    }
  }

  return {
    target,
    navPosition: bestProj,
    distanceToRoute,
    distanceToTarget
  }
}


// UPDATE ARROW
function updateArrow() {
  if (!currentPosition || gpxPoints.length === 0) return;
  
  // Bepaal het huidige target
  const nav = nextGPXPoint(currentPosition, gpxPoints);
  if (!nav) return;
  
  // Eerste meting na hervatten negeren
  if (!resume) {
    resume = true;
    return;
  }

  const { target, navPosition, distanceToRoute, distanceToTarget } = nav;

  // GET BEARING
  const φ1 = degToRad(navPosition.lat);
  const φ2 = degToRad(target.lat);
  const Δλ = degToRad(target.lon - navPosition.lon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

  currentBearing = radToDeg(Math.atan2(y, x));


  // Richting pijl aanpassen op basis van compass
  const prevRotation = displayedRotation;
  
  let heading = currentHeading;

  // Gebruik GPS-heading als die vrijwel gelijk is aan de compass-heading
  if (gpsHeading !== null && Date.now() - gpsSince >= 3000 && angleDiff(currentHeading, gpsHeading) < 20) {
    heading = gpsHeading;
  }
  
  const delta = ((currentBearing - heading - prevRotation + 540) % 360) - 180;
  displayedRotation += delta * 0.75; // Smoothing

  // -180º -> 180º weergeven
  const normalized = ((displayedRotation + 180) % 360 + 360) % 360 - 180;

  if (gpsSpeed > 2) {
    arrow.style.transition = "transform 1s linear";
  } else {
    arrow.style.transition = "transform 0.25s linear";
  }
  arrow.style.transform = `rotate(${displayedRotation}deg)`;
  arrowRotationText.innerText = `${-Math.round(normalized)}°`;

  // GEKLEURDE ACHTERGROND
  if (gpsHeading !== null && Date.now() - gpsSince >= 3000) {
    if (angleDiff(currentBearing, gpsHeading) > 45 || distanceToRoute > Math.max(25, gpsAccuracy + 5)) {
      document.body.style.backgroundColor = "red";
      if (inactivityTimeout) clearTimeout(inactivityTimeout);
      inactivityTimeout = setTimeout(stopTracking, INACTIVITY_LIMIT);
    } else {
      document.body.style.backgroundColor = "white";
    }
  }

  // TOON VOLGENDE BOCHT

  // Zoek eerstvolgende relevante bocht
  let nextTurn = null;
  for (let i = currentSegmentIndex; i < gpxPoints.length - 1; i++) {
    const angle = gpxPoints[i].turnAngle;
    if (!angle) {
      console.log(`Index ${i} heeft geen turnAngle`);
      continue;
    } else if (Math.abs(angle) > 45) {
      nextTurn = { index: i, angle };
      break;
    }
  }
  
  if (!nextTurn) {
    nextTurnEl.classList.add("hidden");
  } else {
    // Afstand tot de bocht berekenen
    const dist = distanceMeters(navPosition, gpxPoints[currentSegmentIndex])
      + target.remainingDistance - gpxPoints[turnIndex].remainingDistance;
  
    if (dist > 200) {
      nextTurnEl.classList.add("hidden");
    } else {
      nextTurnEl.classList.remove("hidden");
      element.style.transform = `rotate(90deg) scaleX(${nextTurn.angle < 0 ? -1 : 1})`;
      nextTurnDistance.innerText = `Over ${Math.round(dist / 5) * 5} m`;
    }
  }

  // RESTERENDE AFSTAND
  const rest = target.remainingDistance + distanceMeters(currentPosition, target);
  distanceText.innerText =
    rest >= 995 ?
    `Nog ${Math.round(rest / 100) / 10} km`.replace('.', ',') :
    `Nog ${Math.round(rest / 10) * 10} m`.replace('.', ',');

  // HOOGTEMETERS
  const elev = gpxPoints[currentSegmentIndex];
  elevation.style.display = (gpxPoints[0].remainingAscent > 75 && gpxPoints[0].remainingDescent > 75) ? "block" : "none";
  elevation.innerText = `⭡ ${Math.round(elev.remainingAscent)} m, ⭣ ${Math.round(elev.remainingDescent)} m`;
  
  // DEBUG
  debugHTML.innerHTML = `
    <b>Positie en kompas</b><br>
    ${currentPosition.lat.toFixed(6)}, ${currentPosition.lon.toFixed(6)}<br>
    heading: ${currentHeading.toFixed(2)}°<br><br>

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

// Route Path2D bouwen
function buildPath(path, start, end, scaleX, scaleY, offsetX, offsetY) {
  if (end - start < 2) return;

  function getX(p) { return (p.lon - gpxBounds.minLon) * scaleX + offsetX; }
  function getY(p) { return (gpxBounds.maxLat - p.lat) * scaleY + offsetY; }

  path.moveTo(getX(gpxPoints[start]), getY(gpxPoints[start]));

  for (let i = start + 1; i < end - 1; i++) {
    const currX = getX(gpxPoints[i]);
    const currY = getY(gpxPoints[i]);
    const nextX = getX(gpxPoints[i + 1]);
    const nextY = getY(gpxPoints[i + 1]);

    const midX = (currX + nextX) / 2;
    const midY = (currY + nextY) / 2;

    path.quadraticCurveTo(currX, currY, midX, midY);
    console.log({currX, currY, midX, midY, nextX, nextY});
  }

  // Laatste punt
  path.lineTo(getX(gpxPoints[end - 1]), getY(gpxPoints[end - 1]));
}

// OVERZICHTSKAART
function updateMap() {
  if (!canvasReady) {
    const dpr = window.devicePixelRatio || 1;
    const rect = mapCanvas.getBoundingClientRect();

    mapCanvas.width = rect.width * dpr;
    mapCanvas.height = rect.height * dpr;

    mapCtx = mapCanvas.getContext("2d");
    mapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    mapCtx.lineCap = "round";
    mapCtx.lineJoin = "round";

    canvasReady = true;
  }

  if (!gpxBounds || !currentPosition) return;

  // --- Correcte schaal en offset ---
  const canvasWidth = mapCanvas.clientWidth;
  const canvasHeight = mapCanvas.clientHeight;
  
  const cosLat = Math.cos(degToRad((gpxBounds.minLat + gpxBounds.maxLat) / 2));
  const scaleY = Math.min(
    canvasWidth / ((gpxBounds.maxLon - gpxBounds.minLon) * cosLat),
    canvasHeight / (gpxBounds.maxLat - gpxBounds.minLat)
  );
  const scaleX = scaleY * cosLat;

  // scaleY > scaleX
  const offsetX = 0 // (canvasWidth  - (gpxBounds.maxLon - gpxBounds.minLon) * scaleX) / 2 - 45;
  const offsetY = 0 // (canvasHeight - (gpxBounds.maxLat - gpxBounds.minLat) * scaleY) / 2 - 35;

  // --- Paths bijwerken als segment verandert ---
  if (currentSegmentIndex !== lastSegmentIndex) {
    traveledPath = new Path2D();
    remainingPath = new Path2D();

    buildPath(traveledPath, 0, currentSegmentIndex, scaleX, scaleY, offsetX, offsetY);
    buildPath(remainingPath, currentSegmentIndex, gpxPoints.length, scaleX, scaleY, offsetX, offsetY);

    lastSegmentIndex = currentSegmentIndex;
  }

  mapCtx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);

  // ===== Resterende route =====
  mapCtx.strokeStyle = "#D1D1D6";
  mapCtx.lineWidth = 6;
  mapCtx.stroke(remainingPath);

  // ===== Traveled route halo =====
  mapCtx.strokeStyle = "white";
  mapCtx.lineWidth = 10;
  mapCtx.stroke(traveledPath);

  // ===== Traveled route =====
  mapCtx.strokeStyle = "#0A84FF";
  mapCtx.lineWidth = 6;
  mapCtx.stroke(traveledPath);

  // ===== User Dot =====
  const pX = (currentPosition.lon - gpxBounds.minLon) * scaleX + offsetX;
  const pY = (gpxBounds.maxLat - currentPosition.lat) * scaleY + offsetY;
  userDot.style.left = `${pX}px`;
  userDot.style.top = `${pY}px`;

  // ===== Hoogteprofiel indicator =====
  if (gpxPoints[0].remainingAscent > 75 && gpxPoints[0].remainingDescent > 75) {
    const x = (currentSegmentIndex / gpxPoints.length) * elevCtx.canvas.clientWidth;

    elevCtx.beginPath();
    elevCtx.moveTo(x, 0);
    elevCtx.lineTo(x, elevCtx.canvas.clientHeight);
    elevCtx.strokeStyle = "#FF3B30";
    elevCtx.lineWidth = 2;
    elevCtx.stroke();
  }
}


// START BUTTON
startButton.addEventListener("click", startTracking);


// GPX UPLOAD
uploadButton.addEventListener("change", function(e) {
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
        remainingAscent:  null,
        remainingDescent: null,
        remainingDistance: null,
        dx: null, dy: null,
        scale: null, lenSq: null,
        turnAngle: null
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

    elevProfile = gpxPoints.map(p => p.ele);
    elevMin = Math.min(...elevProfile);
    elevMax = Math.max(...elevProfile);

    // Bereken alvast de afstand
    let distance = 0
    for (let i = gpxPoints.length - 1; i >= 0; i--) {
      gpxPoints[i].remainingDistance = distance;
    
      if (i > 0) {
        distance += distanceMeters(gpxPoints[i], gpxPoints[i - 1]);
      }
    }

    // Bereken alvast dx, dy, scale, lenSq (voor nextGPXPoint)
    for (let i = 0; i < gpxPoints.length - 1; i++) {
      const A = gpxPoints[i];
      const B = gpxPoints[i + 1];

      A.scale = Math.cos(degToRad(A.lat + B.lat) / 2)
      A.dx = (B.lon - A.lon) * A.scale;
      A.dy = B.lat - A.lat;
      A.lenSq = A.dx ** 2 + A.dy ** 2;
    }

    // Bereken alvast de hoeken tussen de segmenten
    for (let i = 1; i < gpxPoints.length - 1; i++) {
      const A = gpxPoints[i - 1];
      const B = gpxPoints[i];
      
      const bearingA = radToDeg(Math.atan2(A.dy, A.dx));
      const bearingB = radToDeg(Math.atan2(B.dy, B.dx));
        
      B.turnAngle = ((bearingB - bearingA + 540) % 360) - 180; // -180 → 180
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
    

    // Teken hoogteprofiel
    const dpr = window.devicePixelRatio || 1;
    const rect = elevCanvas.getBoundingClientRect();
  
    elevCanvas.width = rect.width * dpr;
    elevCanvas.height = rect.height * dpr;
  
    elevCtx = elevCanvas.getContext("2d");
    elevCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    
    const w = elevCtx.canvas.clientWidth;
    const h = elevCtx.canvas.clientHeight;

    elevCtx.clearRect(0, 0, w, h);

    const xScale = w / (elevProfile.length - 1);
    const yScale = h / (elevMax - elevMin || 1);

    elevCtx.beginPath();

    for (let i = 0; i < elevProfile.length; i++) {
      const x = i * xScale;
      const y = h - (elevProfile[i] - elevMin) * yScale;

      if (i === 0) elevCtx.moveTo(x, y);
      else elevCtx.lineTo(x, y);
    }

    // fill (Apple-style)
    elevCtx.lineTo(w, h);
    elevCtx.lineTo(0, h);
    elevCtx.closePath();

    elevCtx.fillStyle = "#E5E5EA";
    elevCtx.fill();

    elevCtx.strokeStyle = "#8E8E93";
    elevCtx.lineWidth = 2;
    elevCtx.stroke();

    // Voltooien
    currentSegmentIndex = 0;
    lastSegmentIndex = -1;
    alert(`GPX geladen met ${gpxPoints.length} punten`);
  };

  reader.readAsText(file);
});

// Load saved GPX
let saved = localStorage.getItem("gpxPoints");
if (saved) gpxPoints = JSON.parse(saved);
saved = localStorage.getItem("gpxBounds");
if (saved) gpxBounds = JSON.parse(saved);

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
toggleViewButton.onclick = () => {
  document.getElementById(currentView).classList.remove("active");
  lastUpdate = 0;
  
  if (currentView === "compassView") {
    document.getElementById("mapView").classList.add("active");
    currentView = "mapView";

    toggleViewButton.innerText = "Verberg kaart";

    // Stop kompas en timer
    if (orientationActive) {
      window.removeEventListener("deviceorientation", handleOrientation);
      orientationActive = false;
    }
    if (inactivityTimeout) {
      clearTimeout(inactivityTimeout);
      inactivityTimeout = null;
    }
    updateMap();
    
  } else {
    document.getElementById("compassView").classList.add("active");    
    currentView = "compassView";
    
    toggleViewButton.innerText = "Toon kaart";
    
    startTracking();
  }
};

// OVERLAY LISTENER
overlay.addEventListener("click", startTracking);

// Verbeterpunten tijdens ontwikkelen:
// * Baterijoptimalisatie:
// - Als de gebruiker beweegt kijkt hij niet naar de app maar om zich heen; alleen als hij stilstaat hoef je de informatie bij te werken.
// - Je kunt ook stoppen met het updaten van de DOM, maar ik vraag me af of dat verschil maakt.
// - Je kunt een energiebesparende modus toevoegen, die HighAccuracy op false zet en de huidige locatie vrijwel altijd projecteert op de route.
// * Het label van de 'toon kaart'-knop moet bijgewerkt worden als de kaart al getoond wordt.
// * Veel listeners staan er dubbel in.
// * Is het nog nodig om het GPS-pollen te stoppen als de kaart wordt getoond?
// * Als de route alleen omhoog/omlaag gaat, ook hoogteprofiel en hoogte-informatie tonen.
// * We kunnen een simpeler alternatief gebruiken voor de haversine-functie.

// Verbeterpunten tijdens testen 1:
// * We kunnen ook een knop toevoegen dat de gebruiker ergens al geweest is, die de currentSegmentIndex verhoogt, en/of een knop die aangeeft dat de kant die de pijl op wijst niet mogelijk is (geen pad), die het zoekbereik tijdelijk uitschakelt.
// * Resterende tijd tonen a.d.h.v. de GPX-data (geen moving average, want ik wil het ook gebruiken in de bergen e.d.) + percentage van de tijd tonen die je gelopen hebt op dit punt volgens de GPX-data.
// * Resterende afstand tot volgende punt tonen (maar met ondersteuning voor de draaihoek op punt volgende punt X: als |hoek|<20 dan (afstand huidige positie → X) + (afstand X→X+1) i.p.v. alleen huidig→X).
// * Totale afstand tonen?

// Verbeterpunten tijdens testen 2:
// * Beperkt aantal verhogingen segment-index per minuut?
// * Iets doen bij aankomst: functioneel of voor het gevoel of een combinatie daarvan.

// Verbeterpunten tijdens testen 3:
// * Bij look ahead tonen “over N meter”, of is dat verwarrend?
// * Afwijking als gebruiker telefoon scheef houdt voor bepaalde tijd met bepaalde weging gebruiken als standaardafwijking (zodat bij afslag pijl 90º draait i.p.v. 80º)?
// - Of toon, als de gebruiker nog minder dan bijv. 20° is gedraaid t.o.v. de vorige heading en zich minder dan 20 meter vanaf het punt bevindt, het verschil tussen de huidige bearing en de volgende?????
// - Of toon dat als extra pijl bovenin het scherm met het bijschrift: “Over N meter” o.i.d....
// * Als de laatste GPS-update meer dan N seconden geleden is, een laden-overlay tonen.
