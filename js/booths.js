import { supabase } from './supabaseClient.js';
import { requireAuth } from './sessionGuard.js';
import { buildEventLabel, loadEventsWithRange } from './eventUtils.js';

const whoEl = document.getElementById('who');
const logoutBtn = document.getElementById('logout-btn');
const messageEl = document.getElementById('booth-message');

const eventSelect = document.getElementById('booth-event-select');
const createBoothForm = document.getElementById('create-booth-form');
const boothNameInput = document.getElementById('booth-name');
const boothCoordsText = document.getElementById('booth-coords');
const boothMapHintEl = document.getElementById('booth-map-hint');
const boothListEl = document.getElementById('booth-list');

let eventMap;
let selectedMarkerLayer;
let boothMarkerLayer;
let selectedLatLng = null;
let currentEventId = '';
let repositioningBoothId = null;

const boothIcon = L.divIcon({
  className: 'booth-pin',
  html: `<svg viewBox="0 0 24 32" xmlns="http://www.w3.org/2000/svg">
    <path style="fill:var(--color-accent)" d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z"/>
    <circle cx="12" cy="12" r="5" fill="#fff"/>
  </svg>`,
  iconSize: [28, 38],
  iconAnchor: [14, 38],
  tooltipAnchor: [0, -32],
});

const pendingBoothIcon = L.divIcon({
  className: 'booth-pin pending-pin',
  html: `<svg viewBox="0 0 24 32" xmlns="http://www.w3.org/2000/svg">
    <path style="fill:var(--color-success)" d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z"/>
    <circle cx="12" cy="12" r="5" fill="#fff"/>
  </svg>`,
  iconSize: [28, 38],
  iconAnchor: [14, 38],
  tooltipAnchor: [0, -32],
});

function showMessage(text, type) {
  messageEl.textContent = text;
  messageEl.className = `message ${type}`;
}
function translateError(error) {
  return `エラーが発生しました: ${error?.message || ''}`;
}
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

async function loadEvents() {
  const result = await loadEventsWithRange(supabase);
  if (result.error) showMessage(translateError(result.error), 'error');
  return result.events;
}

async function loadBooths(eventId) {
  if (!eventId) return [];
  const { data, error } = await supabase.from('booths').select('id, name, lat, lng').eq('event_id', eventId).order('name');
  if (error) { showMessage(translateError(error), 'error'); return []; }
  return data || [];
}

function updateBoothMapHint() {
  if (repositioningBoothId) return;
  boothCoordsText.textContent = selectedLatLng
    ? `座標: ${selectedLatLng.lat.toFixed(5)}, ${selectedLatLng.lng.toFixed(5)}`
    : '座標未設定';
}

function clearSelectedBoothMarker() {
  selectedMarkerLayer.clearLayers();
  selectedLatLng = null;
  updateBoothMapHint();
}

function setSelectedBoothMarker(latlng) {
  selectedLatLng = latlng;
  selectedMarkerLayer.clearLayers();
  L.marker(latlng, { icon: pendingBoothIcon }).addTo(selectedMarkerLayer);
  updateBoothMapHint();
}

function renderExistingBoothMarkers(booths) {
  boothMarkerLayer.clearLayers();
  for (const booth of booths) {
    if (booth.lat == null || booth.lng == null) continue;
    L.marker([booth.lat, booth.lng], { icon: boothIcon })
      .bindTooltip(escapeHtml(booth.name), { direction: 'top', className: 'booth-tooltip' })
      .addTo(boothMarkerLayer);
  }
}

function initEventMap() {
  eventMap = L.map('event-booth-map').setView([35.6812, 139.7671], 16);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(eventMap);
  boothMarkerLayer = L.layerGroup().addTo(eventMap);
  selectedMarkerLayer = L.layerGroup().addTo(eventMap);

  const resizeMap = () => eventMap.invalidateSize();
  window.addEventListener('resize', resizeMap);
  window.addEventListener('orientationchange', resizeMap);
  requestAnimationFrame(() => setTimeout(resizeMap, 50));

  eventMap.on('click', async (e) => {
    if (repositioningBoothId) {
      const boothId = repositioningBoothId;
      repositioningBoothId = null;
      boothMapHintEl.textContent = '地図をクリックしてブースの位置を決めてください';

      const { error } = await supabase.from('booths').update({ lat: e.latlng.lat, lng: e.latlng.lng }).eq('id', boothId);
      if (error) { showMessage(translateError(error), 'error'); return; }
      showMessage('ブースの位置を更新しました', 'success');
      await refreshSelectedEvent(currentEventId);
      return;
    }

    if (!currentEventId) {
      showMessage('先にイベントを選択してください', 'error');
      return;
    }
    setSelectedBoothMarker(e.latlng);
  });
}

function renderBoothList(booths) {
  boothListEl.innerHTML = '';
  if (booths.length === 0) {
    boothListEl.innerHTML = '<li class="group-empty">まだブースがありません</li>';
    return;
  }

  for (const booth of booths) {
    const li = document.createElement('li');
    li.className = 'group-item';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'name';
    nameSpan.textContent = booth.name;

    const moveBtn = document.createElement('button');
    moveBtn.type = 'button';
    moveBtn.className = 'button-secondary';
    moveBtn.textContent = '位置を変更';
    moveBtn.addEventListener('click', () => {
      repositioningBoothId = booth.id;
      boothMapHintEl.textContent = `地図をクリックして「${booth.name}」の新しい位置を選んでください`;
    });

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'button-secondary';
    editBtn.textContent = '名前を編集';
    editBtn.addEventListener('click', () => startEditBoothName(li, booth));

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'button-secondary';
    deleteBtn.textContent = '削除';
    deleteBtn.addEventListener('click', () => deleteBooth(booth.id, booth.name));

    const actions = document.createElement('div');
    actions.className = 'item-actions';
    actions.append(moveBtn, editBtn, deleteBtn);

    li.append(nameSpan, actions);
    boothListEl.appendChild(li);
  }
}

function startEditBoothName(li, booth) {
  li.innerHTML = '';
  const input = document.createElement('input');
  input.type = 'text';
  input.value = booth.name;

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'button-secondary';
  saveBtn.textContent = '保存';
  saveBtn.addEventListener('click', async () => {
    const newName = input.value.trim();
    if (!newName) return;
    const { error } = await supabase.from('booths').update({ name: newName }).eq('id', booth.id);
    if (error) { showMessage(translateError(error), 'error'); return; }
    showMessage('ブース名を更新しました', 'success');
    await refreshSelectedEvent(currentEventId);
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'link-button';
  cancelBtn.textContent = 'キャンセル';
  cancelBtn.addEventListener('click', () => refreshSelectedEvent(currentEventId));

  const row = document.createElement('div');
  row.className = 'item-edit-row';
  row.append(input, saveBtn, cancelBtn);
  li.appendChild(row);
}

async function deleteBooth(boothId, boothName) {
  if (!confirm(`「${boothName}」を削除しますか?関連する企画も削除されます。`)) return;
  const { error } = await supabase.from('booths').delete().eq('id', boothId);
  if (error) { showMessage(translateError(error), 'error'); return; }
  showMessage('ブースを削除しました', 'success');
  await refreshSelectedEvent(currentEventId);
}

async function refreshSelectedEvent(eventId) {
  currentEventId = eventId;
  const booths = await loadBooths(eventId);

  renderExistingBoothMarkers(booths);
  renderBoothList(booths);
  clearSelectedBoothMarker();

  if (!eventId) {
    eventMap.setView([35.6812, 139.7671], 16);
    return;
  }

  const boothPoints = booths.filter((b) => b.lat != null && b.lng != null).map((b) => [b.lat, b.lng]);
  if (boothPoints.length > 0) {
    eventMap.fitBounds(boothPoints, { padding: [40, 40], maxZoom: 18 });
  } else {
    eventMap.setView([35.6812, 139.7671], 16);
  }
}

async function initEventSelect() {
  const events = await loadEvents();
  eventSelect.innerHTML = '<option value="">イベントを選択してください</option>';
  for (const ev of events) {
    const opt = document.createElement('option');
    opt.value = ev.id;
    opt.textContent = buildEventLabel(ev);
    eventSelect.appendChild(opt);
  }

  const params = new URLSearchParams(window.location.search);
  const paramEventId = params.get('eventId');

  if (paramEventId && events.some((ev) => ev.id === paramEventId)) {
    eventSelect.value = paramEventId;
  } else if (events.length > 0) {
    eventSelect.value = events[0].id;
  }

  await refreshSelectedEvent(eventSelect.value);
}

eventSelect.addEventListener('change', () => refreshSelectedEvent(eventSelect.value));

createBoothForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentEventId) { showMessage('先にイベントを選択してください', 'error'); return; }
  if (!selectedLatLng) { showMessage('地図をクリックして位置を設定してください', 'error'); return; }

  const name = boothNameInput.value.trim();
  if (!name) return;

  const { error } = await supabase.from('booths').insert({
    name,
    event_id: currentEventId,
    lat: selectedLatLng.lat,
    lng: selectedLatLng.lng,
  });

  if (error) { showMessage(translateError(error), 'error'); return; }

  boothNameInput.value = '';
  showMessage('ブースを登録しました', 'success');
  await refreshSelectedEvent(currentEventId);
});

const user = await requireAuth();
if (user) {
  const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', user.id).single();
  whoEl.textContent = `${profile?.display_name ?? user.email} でログイン中`;

  initEventMap();
  await initEventSelect();
}

logoutBtn.addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.href = 'auth.html';
});