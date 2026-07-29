// Auto Bingo — route-based streetview spotting bingo.
// All state lives in localStorage; no backend. Google Maps JS API is only
// needed for creating/editing routes. Playing works with just geolocation.

const STORAGE_KEYS = {
  apiKey: 'autoBingo.apiKey',
  games: 'autoBingo.games',
  progressPrefix: 'autoBingo.progress.',
};

const SCORE_RADIUS_M = 1000;

// ---------- storage helpers ----------

function loadApiKey() {
  return localStorage.getItem(STORAGE_KEYS.apiKey) || '';
}
function saveApiKey(key) {
  localStorage.setItem(STORAGE_KEYS.apiKey, key);
}
function loadGames() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.games) || '[]');
  } catch {
    return [];
  }
}
function saveGames(games) {
  localStorage.setItem(STORAGE_KEYS.games, JSON.stringify(games));
}
function loadProgress(gameId) {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.progressPrefix + gameId) || '{"scored":{}}');
  } catch {
    return { scored: {} };
  }
}
function saveProgress(gameId, progress) {
  localStorage.setItem(STORAGE_KEYS.progressPrefix + gameId, JSON.stringify(progress));
}

// ---------- utils ----------

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function distMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(m) {
  if (m == null || Number.isNaN(m)) return '?';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3000);
}

function utf8ToB64(str) {
  return window.btoa(unescape(encodeURIComponent(str)));
}
function b64ToUtf8(str) {
  return decodeURIComponent(escape(window.atob(str)));
}
function toUrlSafeB64(b64) {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromUrlSafeB64(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return s;
}

function streetViewThumbUrl(el, size = '160x120') {
  const apiKey = loadApiKey();
  if (!apiKey) return null;
  const params = new URLSearchParams({
    size,
    location: `${el.lat},${el.lng}`,
    key: apiKey,
  });
  if (el.heading != null) params.set('heading', el.heading);
  if (el.pitch != null) params.set('pitch', el.pitch);
  params.set('fov', '90');
  return `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`;
}

function resizeImageFile(file, maxWidth = 640, quality = 0.6) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---------- app state ----------

let games = loadGames();
let currentGame = null; // draft being created/edited
let currentGameId = null; // for detail/play
let editingElementId = null; // set when svModal edits an existing element

let map, directionsService, directionsRenderer, placesAutocomplete;
let elementMarkers = [];
let svPanorama;
let pendingLocation = null; // {lat,lng} being placed in svModal

let geoWatchId = null;
let currentPos = null;
let currentScoreElementId = null;
let lastBingoLineCount = 0;

let gmapsLoaded = false;

// ---------- screen management ----------

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.getElementById('navHomeBtn').hidden = id === 'screen-home';
}

// ---------- Google Maps loading ----------

function loadGoogleMaps(apiKey) {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.maps) {
      resolve();
      return;
    }
    window.__gmapsCallback = () => resolve();
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&callback=__gmapsCallback`;
    script.onerror = () => reject(new Error('Kon Google Maps niet laden. Controleer je API-sleutel.'));
    document.head.appendChild(script);
  });
}

async function ensureGoogleMaps() {
  const apiKey = loadApiKey();
  if (!apiKey) {
    showScreen('screen-apikey');
    return false;
  }
  if (gmapsLoaded) return true;
  try {
    await loadGoogleMaps(apiKey);
    gmapsLoaded = true;
    return true;
  } catch (e) {
    toast(e.message);
    return false;
  }
}

// ---------- home screen ----------

function renderGamesList() {
  const list = document.getElementById('gamesList');
  list.innerHTML = '';
  if (games.length === 0) {
    list.innerHTML = '<p class="hint">Nog geen routes. Maak er een met "+ Nieuwe route".</p>';
    return;
  }
  games.forEach((g) => {
    const progress = loadProgress(g.id);
    const found = Object.keys(progress.scored || {}).length;
    const div = document.createElement('div');
    div.className = 'game-item';
    div.innerHTML = `
      <div>
        <div><strong>${escapeHtml(g.name)}</strong></div>
        <div class="meta">${g.gridSize}×${g.gridSize} · ${g.elements.length} plekken · ${found}/${g.elements.length} gevonden</div>
      </div>
      <div>›</div>
    `;
    div.addEventListener('click', () => openDetail(g.id));
    list.appendChild(div);
  });
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ---------- create/edit screen ----------

function blankDraft() {
  return {
    id: null,
    name: '',
    gridSize: 5,
    origin: null,
    destination: null,
    elements: [],
  };
}

async function openCreateScreen(existingGame) {
  const ok = await ensureGoogleMaps();
  if (!ok) return;

  currentGame = existingGame
    ? JSON.parse(JSON.stringify(existingGame))
    : blankDraft();

  document.getElementById('gameNameInput').value = currentGame.name;
  document.getElementById('originInput').value = currentGame.origin?.address || '';
  document.getElementById('destinationInput').value = currentGame.destination?.address || '';
  document.getElementById('gridSizeSelect').value = String(currentGame.gridSize);
  document.getElementById('placeSearchInput').value = '';
  document.getElementById('routeInfo').textContent = '';

  showScreen('screen-create');
  initMapIfNeeded();
  updateElementCounter();
  renderElementsList();

  if (currentGame.origin && currentGame.destination) {
    drawRoute(currentGame.origin, currentGame.destination);
  }
}

function initMapIfNeeded() {
  const mapEl = document.getElementById('map');
  if (!map) {
    map = new google.maps.Map(mapEl, {
      center: { lat: 52.1, lng: 5.3 },
      zoom: 7,
      streetViewControl: false,
    });
    directionsRenderer = new google.maps.DirectionsRenderer({ map, suppressMarkers: true });
    directionsService = new google.maps.DirectionsService();

    map.addListener('click', (e) => {
      openSvModal(e.latLng.lat(), e.latLng.lng(), '');
    });

    const searchInput = document.getElementById('placeSearchInput');
    placesAutocomplete = new google.maps.places.Autocomplete(searchInput);
    placesAutocomplete.bindTo('bounds', map);
    placesAutocomplete.addListener('place_changed', () => {
      const place = placesAutocomplete.getPlace();
      if (!place.geometry) return;
      const loc = place.geometry.location;
      map.panTo(loc);
      map.setZoom(15);
      openSvModal(loc.lat(), loc.lng(), place.name || '');
      searchInput.value = '';
    });
  } else {
    google.maps.event.trigger(map, 'resize');
  }
  redrawElementMarkers();
}

function planRoute() {
  const originText = document.getElementById('originInput').value.trim();
  const destText = document.getElementById('destinationInput').value.trim();
  if (!originText || !destText) {
    toast('Vul vertrekpunt en bestemming in.');
    return;
  }
  directionsService.route(
    { origin: originText, destination: destText, travelMode: 'DRIVING' },
    (result, status) => {
      if (status !== 'OK') {
        toast('Route plannen mislukt: ' + status);
        return;
      }
      directionsRenderer.setDirections(result);
      const legs = result.routes[0].legs;
      const first = legs[0];
      const last = legs[legs.length - 1];
      currentGame.origin = {
        address: originText,
        lat: first.start_location.lat(),
        lng: first.start_location.lng(),
      };
      currentGame.destination = {
        address: destText,
        lat: last.end_location.lat(),
        lng: last.end_location.lng(),
      };
      const distanceKm = legs.reduce((s, l) => s + l.distance.value, 0) / 1000;
      const durationMin = legs.reduce((s, l) => s + l.duration.value, 0) / 60;
      document.getElementById('routeInfo').textContent =
        `${distanceKm.toFixed(0)} km · ongeveer ${(durationMin / 60).toFixed(1)} uur rijden`;
    }
  );
}

function drawRoute(origin, destination) {
  directionsService.route(
    {
      origin: { lat: origin.lat, lng: origin.lng },
      destination: { lat: destination.lat, lng: destination.lng },
      travelMode: 'DRIVING',
    },
    (result, status) => {
      if (status === 'OK') directionsRenderer.setDirections(result);
    }
  );
}

function redrawElementMarkers() {
  elementMarkers.forEach((m) => m.setMap(null));
  elementMarkers = [];
  if (!map || !currentGame) return;
  currentGame.elements.forEach((el) => {
    const marker = new google.maps.Marker({
      position: { lat: el.lat, lng: el.lng },
      map,
      label: { text: '📍', fontSize: '18px' },
      title: el.name,
    });
    marker.addListener('click', () => openSvModal(el.lat, el.lng, el.name, el.id));
    elementMarkers.push(marker);
  });
}

function updateElementCounter() {
  const gridSize = Number(document.getElementById('gridSizeSelect').value);
  document.getElementById('elementCount').textContent = currentGame.elements.length;
  document.getElementById('elementNeeded').textContent = gridSize * gridSize;
}

function renderElementsList() {
  const list = document.getElementById('elementsList');
  list.innerHTML = '';
  currentGame.elements.forEach((el) => {
    const row = document.createElement('div');
    row.className = 'element-item';
    const thumb = streetViewThumbUrl(el, '96x72');
    row.innerHTML = `
      ${thumb ? `<img src="${thumb}" alt="">` : ''}
      <input class="el-name" type="text" value="${escapeHtml(el.name)}">
      <button class="el-remove" title="Verwijderen">✕</button>
    `;
    row.querySelector('.el-name').addEventListener('input', (e) => {
      el.name = e.target.value;
    });
    row.querySelector('.el-remove').addEventListener('click', () => {
      currentGame.elements = currentGame.elements.filter((x) => x.id !== el.id);
      renderElementsList();
      redrawElementMarkers();
      updateElementCounter();
    });
    list.appendChild(row);
  });
  updateElementCounter();
}

// ---------- street view "adjust & add" modal ----------

function openSvModal(lat, lng, suggestedName, existingId) {
  pendingLocation = { lat, lng };
  editingElementId = existingId || null;
  document.getElementById('svNameInput').value = suggestedName || '';
  document.getElementById('svModal').hidden = false;

  const panoEl = document.getElementById('svPano');
  if (!svPanorama) {
    svPanorama = new google.maps.StreetViewPanorama(panoEl, {
      position: { lat, lng },
      addressControl: false,
      showRoadLabels: false,
      fullscreenControl: false,
    });
  } else {
    svPanorama.setPosition({ lat, lng });
    google.maps.event.trigger(svPanorama, 'resize');
  }

  if (existingId) {
    const el = currentGame.elements.find((x) => x.id === existingId);
    if (el && el.heading != null) {
      svPanorama.setPov({ heading: el.heading, pitch: el.pitch || 0 });
    }
  }

  if (!suggestedName && window.google) {
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ location: { lat, lng } }, (results, status) => {
      if (status === 'OK' && results[0]) {
        const nameInput = document.getElementById('svNameInput');
        if (!nameInput.value) nameInput.value = results[0].formatted_address;
      }
    });
  }
}

function closeSvModal() {
  document.getElementById('svModal').hidden = true;
  pendingLocation = null;
  editingElementId = null;
}

function saveSvElement() {
  const name = document.getElementById('svNameInput').value.trim() || 'Onbekende plek';
  const pov = svPanorama.getPov();
  const pos = svPanorama.getPosition();
  const lat = pos ? pos.lat() : pendingLocation.lat;
  const lng = pos ? pos.lng() : pendingLocation.lng;

  if (editingElementId) {
    const el = currentGame.elements.find((x) => x.id === editingElementId);
    Object.assign(el, { name, lat, lng, heading: pov.heading, pitch: pov.pitch });
  } else {
    currentGame.elements.push({
      id: uid(),
      name,
      lat,
      lng,
      heading: pov.heading,
      pitch: pov.pitch,
    });
  }
  renderElementsList();
  redrawElementMarkers();
  closeSvModal();
}

function saveGame() {
  const name = document.getElementById('gameNameInput').value.trim();
  const gridSize = Number(document.getElementById('gridSizeSelect').value);
  const needed = gridSize * gridSize;

  if (!name) return toast('Geef de route een naam.');
  if (!currentGame.origin || !currentGame.destination) return toast('Plan eerst de route.');
  if (currentGame.elements.length !== needed) {
    return toast(`Je hebt precies ${needed} bingo-elementen nodig (nu ${currentGame.elements.length}).`);
  }

  currentGame.name = name;
  currentGame.gridSize = gridSize;

  if (currentGame.id) {
    const idx = games.findIndex((g) => g.id === currentGame.id);
    games[idx] = currentGame;
  } else {
    currentGame.id = uid();
    currentGame.createdAt = Date.now();
    games.push(currentGame);
  }
  saveGames(games);
  openDetail(currentGame.id);
}

// ---------- detail screen ----------

function openDetail(gameId) {
  currentGameId = gameId;
  const game = games.find((g) => g.id === gameId);
  document.getElementById('detailGameName').textContent = game.name;
  document.getElementById('shareLinkBox').hidden = true;
  showScreen('screen-detail');
}

function shareGame() {
  const game = games.find((g) => g.id === currentGameId);
  const shareData = {
    v: 1,
    name: game.name,
    gridSize: game.gridSize,
    elements: game.elements.map((e) => ({ id: e.id, name: e.name, lat: e.lat, lng: e.lng, heading: e.heading, pitch: e.pitch })),
  };
  const encoded = toUrlSafeB64(utf8ToB64(JSON.stringify(shareData)));
  const url = `${location.origin}${location.pathname}#share=${encoded}`;
  const box = document.getElementById('shareLinkBox');
  const output = document.getElementById('shareLinkOutput');
  output.value = url;
  box.hidden = false;
  output.select();
}

function importSharedGame(hashOrUrl) {
  let hash = hashOrUrl;
  const idx = hashOrUrl.indexOf('#share=');
  if (idx !== -1) hash = hashOrUrl.slice(idx + '#share='.length);
  else if (hash.startsWith('share=')) hash = hash.slice('share='.length);

  try {
    const json = b64ToUtf8(fromUrlSafeB64(hash));
    const data = JSON.parse(json);
    const game = {
      id: uid(),
      name: data.name,
      gridSize: data.gridSize,
      origin: null,
      destination: null,
      elements: data.elements,
      createdAt: Date.now(),
      imported: true,
    };
    games.push(game);
    saveGames(games);
    openDetail(game.id);
    toast('Route geïmporteerd!');
  } catch (e) {
    toast('Kon deze link niet lezen.');
  }
}

// ---------- play screen ----------

function startPlay(gameId) {
  currentGameId = gameId;
  const game = games.find((g) => g.id === gameId);
  document.getElementById('playGameName').textContent = game.name;
  renderBingoGrid(game);
  updateProgressBadge(game);
  if (currentPos) updateDistances(game);
  startGeolocation(game);
  showScreen('screen-play');
}

function stopPlay() {
  if (geoWatchId != null) {
    navigator.geolocation.clearWatch(geoWatchId);
    geoWatchId = null;
  }
}

function renderBingoGrid(game) {
  const grid = document.getElementById('bingoGrid');
  grid.style.gridTemplateColumns = `repeat(${game.gridSize}, 1fr)`;
  grid.innerHTML = '';
  const progress = loadProgress(game.id);

  game.elements.forEach((el) => {
    const cell = document.createElement('div');
    cell.className = 'bingo-cell';
    cell.dataset.elementId = el.id;
    if (progress.scored[el.id]) cell.classList.add('scored');

    const thumb = streetViewThumbUrl(el, '200x200');
    cell.innerHTML = `
      ${thumb ? `<img src="${thumb}" alt="">` : `<div class="placeholder-name">${escapeHtml(el.name)}</div>`}
      <div class="cell-badge">–</div>
      <div class="cell-label">${escapeHtml(el.name)}</div>
    `;
    cell.addEventListener('click', () => openScoreModal(el.id));
    grid.appendChild(cell);
  });

  lastBingoLineCount = applyBingoLines(game);
}

function updateProgressBadge(game) {
  const progress = loadProgress(game.id);
  const found = Object.keys(progress.scored || {}).length;
  document.getElementById('playProgress').textContent = `${found} / ${game.elements.length} gevonden`;
}

function startGeolocation(game) {
  const statusEl = document.getElementById('geoStatus');
  if (!navigator.geolocation) {
    statusEl.textContent = '⚠️ Geolocatie wordt niet ondersteund door deze browser.';
    return;
  }
  stopPlay();
  geoWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      currentPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      statusEl.textContent = `📍 Locatie gevonden (nauwkeurigheid ±${Math.round(pos.coords.accuracy)} m)`;
      updateDistances(game);
    },
    (err) => {
      statusEl.textContent = `⚠️ Kon locatie niet ophalen: ${err.message}`;
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
  );
}

function updateDistances(game) {
  const progress = loadProgress(game.id);
  let nearest = null;

  game.elements.forEach((el) => {
    const cell = document.querySelector(`.bingo-cell[data-element-id="${el.id}"]`);
    if (!cell) return;
    const d = currentPos ? distMeters(currentPos.lat, currentPos.lng, el.lat, el.lng) : null;
    const badge = cell.querySelector('.cell-badge');
    badge.textContent = d != null ? formatDistance(d) : '–';
    const inRange = d != null && d <= SCORE_RADIUS_M;
    cell.classList.toggle('in-range', inRange && !progress.scored[el.id]);

    if (!progress.scored[el.id] && d != null && (nearest == null || d < nearest.d)) {
      nearest = { el, d };
    }
  });

  if (nearest) {
    const extra = nearest.d <= SCORE_RADIUS_M ? ' — binnen bereik, druk maar!' : '';
    document.getElementById('geoStatus').textContent =
      `📍 Dichtstbijzijnde: ${nearest.el.name} (${formatDistance(nearest.d)})${extra}`;
  }

  if (currentScoreElementId) updateScoreModalDistance(game);
}

function applyBingoLines(game) {
  const progress = loadProgress(game.id);
  const n = game.gridSize;
  const scoredMatrix = [];
  for (let r = 0; r < n; r++) {
    scoredMatrix.push(game.elements.slice(r * n, r * n + n).map((el) => !!progress.scored[el.id]));
  }

  const linesCells = new Set();
  for (let r = 0; r < n; r++) {
    if (scoredMatrix[r].every(Boolean)) {
      for (let c = 0; c < n; c++) linesCells.add(r * n + c);
    }
  }
  for (let c = 0; c < n; c++) {
    if (scoredMatrix.every((row) => row[c])) {
      for (let r = 0; r < n; r++) linesCells.add(r * n + c);
    }
  }
  if (scoredMatrix.every((row, i) => row[i])) {
    for (let i = 0; i < n; i++) linesCells.add(i * n + i);
  }
  if (scoredMatrix.every((row, i) => row[n - 1 - i])) {
    for (let i = 0; i < n; i++) linesCells.add(i * n + (n - 1 - i));
  }

  const cells = document.querySelectorAll('#bingoGrid .bingo-cell');
  cells.forEach((cell, i) => cell.classList.toggle('bingo-line', linesCells.has(i)));
  return linesCells.size;
}

function openScoreModal(elementId) {
  currentScoreElementId = elementId;
  const game = games.find((g) => g.id === currentGameId);
  const el = game.elements.find((e) => e.id === elementId);
  const progress = loadProgress(game.id);
  const scored = progress.scored[elementId];

  document.getElementById('scoreModalName').textContent = el.name;
  const thumb = streetViewThumbUrl(el, '400x300');
  const img = document.getElementById('scoreModalImg');
  if (thumb) {
    img.src = thumb;
    img.hidden = false;
  } else {
    img.hidden = true;
  }

  document.getElementById('scoreModalActions').hidden = !!scored;
  const doneEl = document.getElementById('scoreModalDone');
  if (scored) {
    const time = new Date(scored.timestamp).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
    doneEl.hidden = false;
    doneEl.textContent = scored.method === 'photo' ? `✅ Gescoord met foto om ${time}` : `✅ Gemeld om ${time}`;
  } else {
    doneEl.hidden = true;
  }

  document.getElementById('scoreModal').hidden = false;
  updateScoreModalDistance(game);
}

function updateScoreModalDistance(game) {
  const el = game.elements.find((e) => e.id === currentScoreElementId);
  const distEl = document.getElementById('scoreModalDistance');
  const scoreBtn = document.getElementById('scoreBtn');
  if (!currentPos) {
    distEl.textContent = 'Locatie nog niet bekend...';
    distEl.className = 'distance-info';
    return;
  }
  const d = distMeters(currentPos.lat, currentPos.lng, el.lat, el.lng);
  const inRange = d <= SCORE_RADIUS_M;
  distEl.textContent = inRange
    ? `✅ Je bent binnen bereik (${formatDistance(d)})`
    : `Je moet binnen 1 km zijn — nu ${formatDistance(d)}`;
  distEl.className = 'distance-info ' + (inRange ? 'ok' : 'far');
  if (scoreBtn) scoreBtn.disabled = !inRange;
  const photoInput = document.getElementById('scorePhotoInput');
  if (photoInput) photoInput.disabled = !inRange;
}

function markScored(elementId, data) {
  const game = games.find((g) => g.id === currentGameId);
  const progress = loadProgress(game.id);
  progress.scored[elementId] = data;
  saveProgress(game.id, progress);

  const cell = document.querySelector(`.bingo-cell[data-element-id="${elementId}"]`);
  if (cell) cell.classList.add('scored');

  updateProgressBadge(game);
  const linesBefore = lastBingoLineCount;
  const linesAfter = applyBingoLines(game);
  lastBingoLineCount = linesAfter;

  const totalScored = Object.keys(progress.scored).length;
  if (totalScored === game.elements.length) {
    toast('🏆 Volledige bingokaart compleet!');
  } else if (linesAfter > linesBefore) {
    toast('🎉 Bingo! Je hebt een lijn compleet.');
  }
}

function scoreByButton() {
  markScored(currentScoreElementId, { method: 'button', timestamp: Date.now() });
  closeScoreModalSoon();
}

async function scoreByPhoto(file) {
  const photo = await resizeImageFile(file);
  markScored(currentScoreElementId, { method: 'photo', timestamp: Date.now(), photo });
  closeScoreModalSoon();
}

function closeScoreModalSoon() {
  setTimeout(() => {
    document.getElementById('scoreModal').hidden = true;
    currentScoreElementId = null;
  }, 600);
}

// ---------- wire up UI ----------

function init() {
  const apiKeyInput = document.getElementById('apiKeyInput');
  apiKeyInput.value = loadApiKey();

  document.getElementById('settingsBtn').addEventListener('click', () => showScreen('screen-apikey'));
  document.getElementById('navHomeBtn').addEventListener('click', () => {
    stopPlay();
    renderGamesList();
    showScreen('screen-home');
  });
  document.getElementById('backFromApiKeyBtn').addEventListener('click', () => showScreen('screen-home'));
  document.getElementById('saveApiKeyBtn').addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    saveApiKey(key);
    toast('Sleutel opgeslagen. Pagina wordt herladen...');
    setTimeout(() => location.reload(), 800);
  });

  document.getElementById('newRouteBtn').addEventListener('click', () => openCreateScreen(null));
  document.getElementById('cancelCreateBtn').addEventListener('click', () => {
    if (currentGame.elements.length > 0 && !confirm('Weet je zeker dat je wilt annuleren? Niet-opgeslagen wijzigingen gaan verloren.')) return;
    renderGamesList();
    showScreen('screen-home');
  });
  document.getElementById('saveGameBtn').addEventListener('click', saveGame);
  document.getElementById('planRouteBtn').addEventListener('click', planRoute);
  document.getElementById('gridSizeSelect').addEventListener('change', updateElementCounter);

  document.getElementById('svCancelBtn').addEventListener('click', closeSvModal);
  document.getElementById('svSaveBtn').addEventListener('click', saveSvElement);

  document.getElementById('playGameBtn').addEventListener('click', () => startPlay(currentGameId));
  document.getElementById('editGameBtn').addEventListener('click', () => openCreateScreen(games.find((g) => g.id === currentGameId)));
  document.getElementById('deleteGameBtn').addEventListener('click', () => {
    if (!confirm('Deze route en alle voortgang verwijderen?')) return;
    games = games.filter((g) => g.id !== currentGameId);
    saveGames(games);
    localStorage.removeItem(STORAGE_KEYS.progressPrefix + currentGameId);
    renderGamesList();
    showScreen('screen-home');
  });
  document.getElementById('shareGameBtn').addEventListener('click', shareGame);
  document.getElementById('copyShareLinkBtn').addEventListener('click', () => {
    const output = document.getElementById('shareLinkOutput');
    output.select();
    navigator.clipboard?.writeText(output.value).then(() => toast('Link gekopieerd!'));
  });
  document.getElementById('backFromDetailBtn').addEventListener('click', () => {
    renderGamesList();
    showScreen('screen-home');
  });

  document.getElementById('backFromPlayBtn').addEventListener('click', () => {
    stopPlay();
    showScreen('screen-detail');
  });

  document.getElementById('scoreBtn').addEventListener('click', scoreByButton);
  document.getElementById('scorePhotoInput').addEventListener('change', (e) => {
    if (e.target.files[0]) scoreByPhoto(e.target.files[0]);
  });
  document.getElementById('scoreModalCloseBtn').addEventListener('click', () => {
    document.getElementById('scoreModal').hidden = true;
    currentScoreElementId = null;
  });

  document.getElementById('importLinkBtn').addEventListener('click', () => {
    const val = document.getElementById('importLinkInput').value.trim();
    if (val) importSharedGame(val);
  });

  let openedFromShareLink = false;
  if (location.hash.includes('share=')) {
    importSharedGame(location.hash);
    history.replaceState(null, '', location.pathname);
    openedFromShareLink = true;
  }

  renderGamesList();
  if (!openedFromShareLink) showScreen('screen-home');
}

document.addEventListener('DOMContentLoaded', init);
