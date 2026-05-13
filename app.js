/* Festival Map — app.js
  - Places CSV: id,name,lat,lng
  - Stalls CSV: name,place,owner,content
  - Shifts CSV: name,stall_name,date,start,end
    date can be empty (then treated as today)
    time format: HH:MM (24h)
*/

const MAP_CENTER = [35.7113, 139.7614];
const MAP_ZOOM = 15;

const MARKER_STYLE_DEFAULT = {
  radius: 8,
  color: '#636363',
  weight: 2,
  fillColor: '#bdbdbd',
  fillOpacity: 0.85
};

const MARKER_STYLE_ACTIVE = {
  radius: 10,
  color: '#8a1010',
  weight: 3,
  fillColor: '#e63946',
  fillOpacity: 1
};

const MARKER_STYLE_ACTIVE_BLINK = {
  radius: 10,
  color: '#8a1010',
  weight: 3,
  fillColor: '#ff7b84',
  fillOpacity: 1
};

let map;
let placeMarkers = new Map();
let places = [];
let stallsByName = new Map();
let stallsByPlace = new Map();
let shifts = [];
let stagedShifts = null;
let activePlaceIds = new Set();
let blinkOn = true;
let popupCloseTimer = null;

const LS_KEY = 'festival_shifts_json_v1';

function normalizePlaceName(value){
  return String(value ?? '')
    .trim()
    .split('・')
    .map(part => {
      const cleaned = part.trim().replace(/\u3000/g, '');
      const letterNumber = cleaned.match(/^(.*?)([A-Za-z]+)(\d+)$/);
      if (letterNumber) {
        return `${letterNumber[1]}${letterNumber[3]}${letterNumber[2]}`;
      }
      return cleaned;
    })
    .join('・');
}

function placeNamesMatch(left, right){
  return normalizePlaceName(left) === normalizePlaceName(right);
}

function cancelPopupCloseTimer(){
  if (popupCloseTimer) {
    clearTimeout(popupCloseTimer);
    popupCloseTimer = null;
  }
}

function schedulePopupClose(marker){
  cancelPopupCloseTimer();
  popupCloseTimer = setTimeout(()=>{
    marker.closePopup();
    popupCloseTimer = null;
  }, 140);
}

function init() {
  map = L.map('map').setView(MAP_CENTER, MAP_ZOOM);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
  }).addTo(map);

  document.getElementById('shiftsFile').addEventListener('change', onShiftsFile);
  document.getElementById('saveShifts').addEventListener('click', saveShifts);
  document.getElementById('clearShifts').addEventListener('click', clearSavedShifts);

  loadSavedShifts();
  loadEmbeddedPlaces();
  loadEmbeddedStalls();
  loadSampleShiftPreview();
  startMarkerBlinkLoop();
  refreshLoop();
}

function loadSampleShiftPreview(){
  fetch('shifts.csv').then(r=>r.text()).then(txt=>{
    const res = Papa.parse(txt, { header:true, skipEmptyLines:true });
    renderSampleShiftPreview(res.data.map(normalizeShiftRow));
  }).catch(err=>{
    console.warn('shifts.csv preview load failed', err);
    renderSampleShiftPreview(loadSampleShiftFallback());
  });
}

function loadSampleShiftFallback(){
  return [
    { name: 'Taro', stall_name: '軽音ライブ', date: '2026-05-12', start: '10:00', end: '12:30' },
    { name: 'Hanako', stall_name: 'クラス2-A', date: '2026-05-12', start: '11:00', end: '13:00' },
    { name: 'Jiro', stall_name: 'DJステージ', date: '2026-05-12', start: '21:00', end: '23:00' }
  ];
}

function renderSampleShiftPreview(rows){
  const host = document.getElementById('sampleShiftPreview');
  if (!host) return;

  const tableRows = rows.map(shift => {
    return `<tr>
      <td>${escapeHtml(shift.name || '')}</td>
      <td>${escapeHtml(shift.stall_name || '')}</td>
      <td>${escapeHtml(shift.date || '当日')}</td>
      <td>${escapeHtml(shift.start || '')}</td>
      <td>${escapeHtml(shift.end || '')}</td>
    </tr>`;
  }).join('');

  host.innerHTML = `
    <div class="table-responsive">
        <table class="table table-bordered table-striped table-sm align-middle mb-0 sample-table">
        <thead>
          <tr>
            <th>name</th>
            <th>stall_name</th>
            <th>date</th>
            <th>start</th>
            <th>end</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  `;
}

function loadEmbeddedPlaces(){
  fetch('places.csv').then(r=>r.text()).then(txt=>{
    const res = Papa.parse(txt, { header:true, skipEmptyLines:true });
    places = res.data.map(normalizePlaceRow);
    renderPlaces();
  }).catch(err=>{
    console.warn('places.csv load failed', err);
    loadSamplePlaces();
  });
}

function loadEmbeddedStalls(){
  fetch('stalls.csv').then(r=>r.text()).then(txt=>{
    const res = Papa.parse(txt, { header:true, skipEmptyLines:true });
    setStalls(res.data.map(normalizeStallRow));
    renderPlaces();
  }).catch(err=>{
    console.warn('stalls.csv load failed', err);
    loadSampleStalls();
  });
}

function setStalls(stallRows){
  stallsByName = new Map();
  stallsByPlace = new Map();
  stallRows.forEach(stall => {
    if (!stall.name) return;
    stallsByName.set(stall.name, stall);
    const placeKey = normalizePlaceName(stall.place);
    if (!stallsByPlace.has(placeKey)) {
      stallsByPlace.set(placeKey, []);
    }
    stallsByPlace.get(placeKey).push(stall);
  });
}

function onShiftsFile(e) {
  const f = e.target.files[0];
  if (!f) return;
  Papa.parse(f, {
    header:true,
    skipEmptyLines:true,
    complete: (res)=>{
      const parsedShifts = res.data.map(normalizeShiftRow);
      const validationErrors = validateShiftRows(parsedShifts);
      if (validationErrors.length > 0) {
        stagedShifts = null;
        shifts = shifts.slice();
        alert(['シフトCSVの内容を確認してください。', ...validationErrors, '企画名は stalls.csv の name と完全一致が必要です。'].join('\n'));
        return;
      }
      stagedShifts = parsedShifts;
      shifts = stagedShifts.slice();
      renderPlaces();
      updateMarkersWithShifts();
    }
  });
}

function normalizeShiftRow(r){
  return {
    name: String(r.name ?? '').trim(),
    stall_name: String(r.stall_name ?? '').trim(),
    date: String(r.date ?? '').trim(),
    start: String(r.start ?? '').trim(),
    end: String(r.end ?? '').trim()
  };
}

function validateShiftRows(shiftRows){
  const errors = [];
  const stallNames = new Set(stallsByName.keys());

  shiftRows.forEach((shift, index)=>{
    const line = `${index + 2}行目`;
    if (!shift.name) {
      errors.push(`${line}: 名前が空です。`);
    }
    if (!shift.stall_name) {
      errors.push(`${line}: 企画名が空です。`);
    } else if (stallNames.size > 0 && !stallNames.has(shift.stall_name)) {
      errors.push(`${line}: 企画名「${shift.stall_name}」は stalls.csv の name にありません。`);
    }
    if (!shift.start || !shift.end) {
      errors.push(`${line}: 開始時刻と終了時刻を入力してください。`);
    }
  });

  return errors;
}

function loadSamplePlaces(){
  const csv = `id,name,lat,lng\n1,ステージ,35.6815,139.7669\n2,フード,35.6820,139.7680\n3,案内所,35.6808,139.7678`;
  const res = Papa.parse(csv, { header:true, skipEmptyLines:true });
  places = res.data.map(normalizePlaceRow);
  renderPlaces();
}

function loadSampleStalls(){
  const csv = `name,place,owner,content\n軽音ライブ,ステージ,軽音部,焼きそば\nクラス2-A,フード,2年A組,たこ焼き\n案内所,案内所,実行委員会,パンフレット配布\nDJステージ,ステージ,有志,DJ`;
  const res = Papa.parse(csv, { header:true, skipEmptyLines:true });
  setStalls(res.data.map(normalizeStallRow));
  renderPlaces();
}

function normalizePlaceRow(r){
  return {
    id: String(r.id ?? '').trim(),
    name: String(r.name ?? '').trim(),
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lng)
  };
}

function normalizeStallRow(r){
  return {
    name: String(r.name ?? '').trim(),
    place: String(r.place ?? '').trim(),
    owner: String(r.owner ?? '').trim(),
    content: String(r.content ?? '').trim()
  };
}

function renderPlaces(){
  placeMarkers.forEach(obj=>{
    map.removeLayer(obj.marker);
    if (obj.highlight) map.removeLayer(obj.highlight);
  });
  placeMarkers.clear();

  const referencedPlaceNames = new Set();
  shifts.forEach(shift=>{
    const stall = stallsByName.get(shift.stall_name);
    if (stall && stall.place) referencedPlaceNames.add(stall.place);
  });

  const showAll = referencedPlaceNames.size === 0;

  places.forEach(place=>{
    if (!showAll && !Array.from(referencedPlaceNames).some(name => placeNamesMatch(place.name, name))) return;

    const marker = L.circleMarker([place.lat, place.lng], MARKER_STYLE_DEFAULT).addTo(map);
    marker.bindPopup(`<strong>${escapeHtml(place.name)}</strong>`, { className: 'festival-popup' });
    marker.on('mouseover', ()=> {
      cancelPopupCloseTimer();
      showPopupForPlace(place);
    });
    marker.on('mouseout', ()=> schedulePopupClose(marker));
    marker.on('popupopen', event=>{
      const popupEl = event.popup.getElement();
      if (!popupEl) return;
      popupEl.addEventListener('mouseenter', cancelPopupCloseTimer);
      popupEl.addEventListener('mouseleave', ()=> schedulePopupClose(marker));
    });
    placeMarkers.set(place.id, { place, marker, highlight: null });
  });

  updateMarkersWithShifts();
}

function showPopupForPlace(place){
  cancelPopupCloseTimer();
  const placeStalls = stallsByPlace.get(normalizePlaceName(place.name)) || [];
  const stallBlocks = [];

  if (placeStalls.length === 0) {
    stallBlocks.push({ name: '未設定', owner: '未設定', content: '未設定', shifts: [] });
  } else {
    placeStalls.forEach(stall=>{
      const stallShifts = shifts.filter(shift=>shift.stall_name === stall.name);
      stallBlocks.push({ ...stall, shifts: stallShifts });
    });
  }

  const html = stallBlocks.map(stall=>{
    const shiftHtml = stall.shifts && stall.shifts.length > 0
      ? stall.shifts.map(shift=>{
          const isNow = shiftAppliesNow(shift, false);
          const activeClass = isNow ? ' is-active' : '';
          const activeBadge = isNow ? '<span class="popup-shift-badge">NOW</span>' : '';
          return `<li class="popup-shift-item${activeClass}">${activeBadge}<span class="popup-shift-text">${escapeHtml(shift.name)}: ${formatDateLabel(shift.date)} ${shift.start}~${shift.end}</span></li>`;
        }).join('')
      : '<li class="popup-shift-empty"><em>予定なし</em></li>';

    return (
      `<div class="popup-slot">`
      + `<div class="popup-title">${escapeHtml(stall.name)}</div>`
      + `<div class="popup-meta">`
      + `<span class="popup-tag">${escapeHtml(stall.owner || '未設定')}</span>`
      + `<span class="popup-tag">${escapeHtml(stall.content || '未設定')}</span>`
      + `</div>`
      + `<ul class="popup-shift-list">${shiftHtml}</ul>`
      + `</div>`
    );
  }).join('<hr style="margin:8px 0"/>');

  const markerEntry = placeMarkers.get(place.id);
  if (!markerEntry) return;
  markerEntry.marker.setPopupContent(`<div class="popup-card">${html}</div>`);
  markerEntry.marker.openPopup();
}

function formatDateLabel(isoDate){
  if (!isoDate || !String(isoDate).trim()) return '当日';
  const d = parseDate(String(isoDate).trim());
  if (Number.isNaN(d.getTime())) return '当日';
  return `${d.getDate()}日`;
}

function updateMarkersWithShifts(){
  const active = shifts.filter(s=> shiftAppliesNow(s,false));
  const activePlaceIds = new Set();

  active.forEach(shift=>{
    const stall = stallsByName.get(shift.stall_name);
    if (!stall) return;
    places.forEach(place=>{
      if (placeNamesMatch(place.name, stall.place)) {
        activePlaceIds.add(place.id);
      }
    });
  });

  placeMarkers.forEach(obj=>{
    obj.marker.setStyle(activePlaceIds.has(obj.place.id) ? (blinkOn ? MARKER_STYLE_ACTIVE : MARKER_STYLE_ACTIVE_BLINK) : MARKER_STYLE_DEFAULT);
  });

  renderActiveList(active);
}

function startMarkerBlinkLoop(){
  setInterval(()=>{
    blinkOn = !blinkOn;
    updateMarkersWithShifts();
  }, 700);
}

function renderActiveList(active){
  const ul = document.getElementById('activeList');
  ul.innerHTML = '';

  active
    .slice()
    .sort((a, b) => String(a.start).localeCompare(String(b.start)))
    .forEach(shift=>{
    const stall = stallsByName.get(shift.stall_name);
    const li = document.createElement('li');
    li.className = 'list-group-item list-group-item-action px-2 py-2';
    const stallLabel = stall ? stall.name : shift.stall_name;
    const placeLabel = stall ? stall.place : '未設定';
    li.innerHTML = `
      <div class="fw-bold text-primary">${escapeHtml(shift.name)}</div>
      <div class="small text-muted">${escapeHtml(stallLabel)} / ${escapeHtml(placeLabel)}</div>
      <div class="small text-success">${escapeHtml(shift.start)}〜${escapeHtml(shift.end)}</div>
    `;
    li.addEventListener('click', ()=>{
      if (!stall) return;
      const firstMatch = places.find(place => placeNamesMatch(place.name, stall.place));
      if (!firstMatch) return;
      const pl = placeMarkers.get(firstMatch.id);
      if (pl) {
        map.setView([pl.place.lat, pl.place.lng], 18);
        pl.marker.openPopup();
      }
    });
    ul.appendChild(li);
  });

  if (active.length === 0) {
    const li = document.createElement('li');
    li.className = 'list-group-item px-2 py-2 text-muted';
    li.innerHTML = '<em>現在シフト中の人はいません</em>';
    ul.appendChild(li);
  }
}

function shiftAppliesNow(s, forHover=false){
  const now = new Date();
  const targetDate = s.date && s.date.trim() ? parseDate(s.date) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!forHover) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (targetDate.getTime() !== today.getTime()) return false;
  }
  const start = parseTimeOnDate(targetDate, s.start);
  const end = parseTimeOnDate(targetDate, s.end);
  return now >= start && now <= end;
}

function parseDate(s){
  const parts = s.split('-').map(x=>parseInt(x,10));
  if (parts.length < 3) return new Date();
  return new Date(parts[0], parts[1]-1, parts[2]);
}

function parseTimeOnDate(date, t){
  const p = (t || '00:00').split(':').map(x=>parseInt(x,10));
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), p[0] || 0, p[1] || 0);
}

function loadSavedShifts(){
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    if (Array.isArray(data)) shifts = data.map(normalizeShiftRow);
  } catch(e) {
    console.warn('saved shifts parse error, attempting CSV fallback');
    try {
      const res = Papa.parse(raw, { header:true, skipEmptyLines:true });
      shifts = res.data.map(normalizeShiftRow);
    } catch(e2) { /* ignore */ }
  }
  updateMarkersWithShifts();
}

function saveShifts(){
  if (!stagedShifts || stagedShifts.length === 0) {
    alert('保存するシフトがありません。ファイルを選択してください。');
    return;
  }
  const validationErrors = validateShiftRows(stagedShifts);
  if (validationErrors.length > 0) {
    alert(['保存できません。', ...validationErrors, '企画名は stalls.csv の name と完全一致で入力してください。'].join('\n'));
    return;
  }
  shifts = stagedShifts.slice();
  localStorage.setItem(LS_KEY, JSON.stringify(shifts));
  stagedShifts = null;
  renderPlaces();
  updateMarkersWithShifts();
  alert('シフトをlocalStorageに保存しました（このブラウザのみ）。');
}

function clearSavedShifts(){
  localStorage.removeItem(LS_KEY);
  shifts = [];
  stagedShifts = null;
  renderPlaces();
  updateMarkersWithShifts();
  alert('保存したシフトをクリアしました。');
}

function refreshLoop(){
  updateMarkersWithShifts();
  setTimeout(refreshLoop, 30_000);
}

function escapeHtml(s){
  if (!s) return '';
  return String(s).replace(/[&<>\"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c] || c));
}

window.addEventListener('load', init);