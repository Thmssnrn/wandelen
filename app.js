let gpxPoints = [];
let currentPosition = null;

let currentHeading = 0;
let headingOffset = 0;
let hasOffset = false;

let displayedRotation = 0;
let currentBearing = 0;
let currentSegmentIndex = 0;

let watchId = null;
let orientationActive = false;

let inactivityTimeout = null;
const INACTIVITY_LIMIT = 30 * 1000; // 30 sec

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
    watchId = navigator.geolocation.watchPosition(onGPS, console.error, {
      enableHighAccuracy: true,
      maximumAge: 3000,
      timeout: 5000
    });
  }

  // Start User Inactivity Listeners
  const events = ["mousemove", "mousedown", "touchstart", "keydown", "scroll"];
  events.forEach(event => {
    document.addEventListener(event, resetUserInactivityTimer, { passive: true });
  });

  // Start User Inactivity Timer
  if (inactivityTimeout) clearTimeout(inactivityTimeout);
  inactivityTimeout = setTimeout(() => {
    stopTracking();
    alert("Tracking automatisch gepauzeerd wegens 30 seconden geen interactie.");
  }, INACTIVITY_LIMIT);
  
}

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

// GPS
let gpsHeading = null;
let gpsSpeed = 0;

function onGPS(pos) {
  currentPosition = {
    lat: pos.coords.latitude,
    lon: pos.coords.longitude
  };

  gpsHeading = pos.coords.heading;
  gpsSpeed = pos.coords.speed;

  if (gpsSpeed > 1) {
    if (orientationActive) {
      window.removeEventListener("deviceorientation", handleOrientation);
      orientationActive = false;
    }
  } else {
    if (!orientationActive) {
      window.addEventListener("deviceorientation", handleOrientation);
      orientationActive = true;
    }
  }

  updateArrow();
}

// GPX UPLOAD
document.getElementById("gpxUpload").addEventListener("change", function(e) {
  alert("Welkom, nieuw bestand!");
  const file = e.target.files[0];
  if (!file) return;

  alert("Het bestand wordt geleden...");

  const reader = new FileReader();
  reader.onload = function(event) {
    alert("File loaded");
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

    alert("gpxPoints gevonden");

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

    alert("hoogte-data toegevoegd");

    // Bereken alvast de afstand
    let distance = 0
    for (let i = gpxPoints.length - 1; i >= 0; i--) {
      gpxPoints[i].remainingDistance = distance;
    
      if (i > 0) {
        distance += distanceMeters(gpxPoints[i].lat, gpxPoints[i].lon, gpxPoints[i - 1].lat, gpxPoints[i - 1].lon);
      }
    }

    alert("afstanden berekend");
    
    localStorage.setItem("gpxPoints", JSON.stringify(gpxPoints));
    currentSegmentIndex = 0;
    alert(`GPX geladen met ${gpxPoints.length} punten`);
  };

  reader.readAsText(file);
});

// Load saved GPX
const saved = localStorage.getItem("gpxPoints");
if (saved) gpxPoints = JSON.parse(saved);

// GPX: VOLGENDE TARGET (SEGMENT-GEBASEERD + SNAP)
function nextGPXPoint(pos, points) {
  if (points.length === 0) return null;

  let minDist = Infinity;
  let bestIndex = currentSegmentIndex;

  const BACKWARD_WINDOW = 7;
  const FORWARD_WINDOW = 25;

  const start = Math.max(0, currentSegmentIndex - BACKWARD_WINDOW);
  const end = Math.min(points.length - 1, currentSegmentIndex + FORWARD_WINDOW);

  // Zoek lokaal
  for (let i = start; i < end; i++) {
    // Projectie -> afstand tot het segment ipv het punt
    const A = points[i];
    const B = points[i + 1];

    const scale = Math.cos((A.lat + B.lat) / 2 * Math.PI/180);
    const dx = (B.lon - A.lon) * scale;
    const dy = B.lat - A.lat;

    const t = ((pos.lat - A.lat) * dy + (pos.lon - A.lon) * dx) / (dx*dx + dy*dy);
    const tClamped = Math.max(0, Math.min(1, t));

    const proj = {
      lat: A.lat + tClamped * dy,
      lon: A.lon + tClamped * dx / scale
    };

    const d = distanceMeters(pos.lat, pos.lon, proj.lat, proj.lon);

    if (d < minDist) {
      minDist = d;
      bestIndex = i + 1;
    }
  }

  // Fallback als we te ver weg zitten → globale search
  if (minDist > 50) {
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

      const d = distanceMeters(pos.lat, pos.lon, proj.lat, proj.lon);

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

  return gpxPoints[currentSegmentIndex];
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
let lastUpdate = 0;
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
    const distToNext = distanceMeters(currentPosition.lat, currentPosition.lon, target.lat, target.lon);

    if (distToNext < 15) {
      const lookAheadMeters = Math.max(0, 15 - distToNext);

      const nextNext = gpxPoints[currentSegmentIndex + 1];
      const dx = nextNext.lon - target.lon;
      const dy = nextNext.lat - target.lat;

      const segmentDist = distanceMeters(target.lat, target.lon, nextNext.lat, nextNext.lon);
      const t = Math.min(1, lookAheadMeters / segmentDist);

      target.lat += t * dy;
      target.lon += t * dx;
    }
  }

  const prevRotation = displayedRotation; 

  // Richting pijl aanpassen op basis van compass
  currentBearing = getBearing(currentPosition.lat, currentPosition.lon, target.lat, target.lon);
  const targetRotation = currentBearing - currentHeading;
  displayedRotation = ((targetRotation + 540) % 360) - 180;

  document.getElementById("arrow").style.transform = `rotate(${displayedRotation}deg)`;
  
  if (Math.abs(displayedRotation - prevRotation) >= 1) {
    document.getElementById("arrowRotation").innerText = `${Math.round(-displayedRotation)}°`;
  }

  // RESTAFSTAND
  const rest = target.remainingDistance + distanceMeters(currentPosition.lat, currentPosition.lon, target.lat, target.lon);
  document.getElementById("distance").innerText =
    rest >= 995 ?
    `Restafstand: ${Math.round(rest / 100) / 10} km`.replace('.', ',') :
    `Restafstand: ${Math.round(rest / 10) * 10} m`.replace('.', ',');

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
