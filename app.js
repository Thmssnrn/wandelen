let gpxPoints = [];
let currentPosition = null;

let currentHeading = 0;
let headingOffset = 0;
let hasOffset = false;

let displayedRotation = 0;
let currentBearing = 0;
let currentSegmentIndex = 0;

let gpsHeading = null;
let gpsSpeed = 0;

let watchId = null;
let orientationActive = false;

let inactivityTimeout = null;
const INACTIVITY_LIMIT = 30 * 1000; // 30 sec

let lastUpdate = 0;

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

          updateArrow();
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
  const events = ["mousemove", "mousedown", "touchstart", "keydown", "scroll"];
  events.forEach(event => {
    document.addEventListener(event, resetUserInactivityTimer, { passive: true });
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
  overlay.style.display = "block"; // Maak overlay klikbaar
  
  overlay.onclick = () => {
    overlay.style.display = "none";
    startTracking();
  };
}

// COMPASS
function handleOrientation(event) {
  // Gebruik GPS heading als we bewegen
  if (gpsHeading !== null && gpsSpeed > 1) {
    currentHeading = gpsHeading;
  } else {
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
  const UPDATE_INTERVAL = gpsSpeed > 1 ? 1000 : 250;  // ms
  const now = Date.now();
  if (now - lastUpdate < UPDATE_INTERVAL) return;
  if (!currentPosition ||gpxPoints.length === 0) return;
  lastUpdate = now;

  // Bepaal het "huidige target"
  let target = { ...nextGPXPoint(currentPosition, gpxPoints) }; // Maak een kopie
  if (!target) return;

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

  if (gpsSpeed > 1) {
    arrow.style.transition = "transform 1s linear";
  } else {
    arrow.style.transition = "transform 0.25s linear";
  }
  document.getElementById("arrow").style.transform = `rotate(${displayedRotation}deg)`;
  
  if (Math.abs(displayedRotation - prevRotation) >= 1) {
    document.getElementById("arrowRotation").innerText = `${Math.round(-displayedRotation)}°`;
  }

  // RESTERENDE AFSTAND
  const rest = target.remainingDistance + distanceMeters(currentPosition, target);
  document.getElementById("distance").innerText =
    rest >= 995 ?
    `Nog ${Math.round(rest / 100) / 10} km`.replace('.', ',') :
    `Nog ${Math.round(rest / 10) * 10} m`.replace('.', ',');

  // Hoogtemeters
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
    
    const trkpts = xml.getElementsByTagName("trkpt");
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
