import { supabase } from './supabaseClient.js';
import { requireAuth } from './sessionGuard.js';
import { buildEventLabel, loadEventsWithRange } from './eventUtils.js';

const whoEl = document.getElementById('who');
const logoutBtn = document.getElementById('logout-btn');
const messageEl = document.getElementById('event-message');

const createEventModal = document.getElementById('create-event-modal');
const openCreateEventModalBtn = document.getElementById('open-create-event-modal');
const closeCreateEventModalBtn = document.getElementById('close-create-event-modal');
const createEventForm = document.getElementById('create-event-form');
const eventNameInput = document.getElementById('event-name');
const eventStartDateInput = document.getElementById('event-start-date');
const eventEndDateInput = document.getElementById('event-end-date');

const adminEventSelect = document.getElementById('admin-event-select');
const eventDetailLink = document.getElementById('event-detail-link');

const createBoothForm = document.getElementById('create-booth-form');
const boothNameInput = document.getElementById('booth-name');
const boothCoordsText = document.getElementById('booth-coords');

const createProgramForm = document.getElementById('create-program-form');
const programBoothSelect = document.getElementById('program-booth-select');
const programNameInput = document.getElementById('program-name');
const programOrganizerInput = document.getElementById('program-organizer');

let eventMap;
let selectedMarkerLayer;
let boothMarkerLayer;
let selectedLatLng = null;
let currentEventId = '';
let eventSchema = 'range';

function showMessage(text, type) {
  messageEl.textContent = text;
  messageEl.className = `message ${type}`;
}

function translateError(error) {
  return `エラーが発生しました: ${error?.message || ''}`;
}

async function loadEvents() {
  const result = await loadEventsWithRange(supabase);
  if (result.error) {
    showMessage(translateError(result.error), 'error');
  }
  eventSchema = result.schema;
  return result.events;
}

async function loadBooths(eventId) {
  if (!eventId) return [];
  const { data, error } = await supabase.from('booths').select('id, name, lat, lng').eq('event_id', eventId).order('name');
  if (error) {
    showMessage(translateError(error), 'error');
    return [];
  }
  return data || [];
}

function updateBoothMapHint() {
  if (!selectedLatLng) {
    boothCoordsText.textContent = '座標未設定';
    return;
  }
  boothCoordsText.textContent = `座標: ${selectedLatLng.lat.toFixed(5)}, ${selectedLatLng.lng.toFixed(5)}`;
}

function clearSelectedBoothMarker() {
  selectedMarkerLayer.clearLayers();
  selectedLatLng = null;
  updateBoothMapHint();
}

function setSelectedBoothMarker(latlng) {
  selectedLatLng = latlng;
  selectedMarkerLayer.clearLayers();
  L.marker(latlng).addTo(selectedMarkerLayer);
  updateBoothMapHint();
}

function renderExistingBoothMarkers(booths) {
  boothMarkerLayer.clearLayers();
  for (const booth of booths) {
    if (booth.lat == null || booth.lng == null) continue;
    L.marker([booth.lat, booth.lng]).bindTooltip(booth.name, { direction: 'top' }).addTo(boothMarkerLayer);
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

  eventMap.on('click', (e) => {
    if (!currentEventId) {
      showMessage('先にイベントを選択してください', 'error');
      return;
    }
    setSelectedBoothMarker(e.latlng);
  });
}

function fillProgramBoothSelect(booths) {
  programBoothSelect.innerHTML = '<option value="">ブースを選択してください</option>';
  for (const booth of booths) {
    const opt = document.createElement('option');
    opt.value = booth.id;
    opt.textContent = booth.name;
    programBoothSelect.appendChild(opt);
  }
}

async function refreshSelectedEvent(eventId) {
  currentEventId = eventId;
  const booths = await loadBooths(eventId);

  fillProgramBoothSelect(booths);
  renderExistingBoothMarkers(booths);
  clearSelectedBoothMarker();

  eventDetailLink.href = currentEventId
    ? `event-details.html?eventId=${encodeURIComponent(currentEventId)}`
    : 'event-details.html';

  if (!eventId) {
    eventMap.setView([35.6812, 139.7671], 16);
    return;
  }

  const boothPoints = booths
    .filter((booth) => booth.lat != null && booth.lng != null)
    .map((booth) => [booth.lat, booth.lng]);

  if (boothPoints.length > 0) {
    eventMap.fitBounds(boothPoints, { padding: [40, 40], maxZoom: 18 });
  } else {
    eventMap.setView([35.6812, 139.7671], 16);
  }
}

async function refreshAdminEventOptions(events, preferredEventId = '') {
  adminEventSelect.innerHTML = '<option value="">イベントを選択してください</option>';
  for (const event of events) {
    const opt = document.createElement('option');
    opt.value = event.id;
    opt.textContent = buildEventLabel(event);
    adminEventSelect.appendChild(opt);
  }

  if (preferredEventId && events.some((event) => event.id === preferredEventId)) {
    adminEventSelect.value = preferredEventId;
  } else if (events.length > 0) {
    adminEventSelect.value = events[0].id;
  }

  await refreshSelectedEvent(adminEventSelect.value);
}

function openCreateEventModal() {
  createEventModal.hidden = false;
}

function closeCreateEventModal() {
  createEventModal.hidden = true;
}

openCreateEventModalBtn.addEventListener('click', openCreateEventModal);
closeCreateEventModalBtn.addEventListener('click', closeCreateEventModal);

createEventForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const name = eventNameInput.value.trim();
  const startDate = eventStartDateInput.value;
  const endDate = eventEndDateInput.value;
  if (!name || !startDate || !endDate) return;
  if (startDate > endDate) {
    showMessage('開始日は終了日以前にしてください', 'error');
    return;
  }

  if (eventSchema === 'single' && startDate !== endDate) {
    showMessage('複数日イベントには start_date / end_date 対応のDB定義が必要です', 'error');
    return;
  }

  const insertPayload = eventSchema === 'single'
    ? { name, event_date: startDate }
    : { name, start_date: startDate, end_date: endDate };

  const { data, error } = await supabase.from('events').insert(insertPayload).select('id').single();
  if (error) {
    showMessage(translateError(error), 'error');
    return;
  }

  eventNameInput.value = '';
  eventStartDateInput.value = '';
  eventEndDateInput.value = '';
  closeCreateEventModal();
  showMessage('イベントを作成しました', 'success');
  const events = await loadEvents();
  await refreshAdminEventOptions(events, data.id);
});

adminEventSelect.addEventListener('change', async () => {
  await refreshSelectedEvent(adminEventSelect.value);
});

createBoothForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentEventId) {
    showMessage('先にイベントを選択してください', 'error');
    return;
  }
  if (!selectedLatLng) {
    showMessage('地図をクリックして位置を設定してください', 'error');
    return;
  }

  const name = boothNameInput.value.trim();
  if (!name) return;

  const { error } = await supabase
    .from('booths')
    .insert({
      name,
      event_id: currentEventId,
      lat: selectedLatLng.lat,
      lng: selectedLatLng.lng,
    });

  if (error) {
    showMessage(translateError(error), 'error');
    return;
  }

  boothNameInput.value = '';
  showMessage('ブースを登録しました', 'success');
  await refreshSelectedEvent(currentEventId);
});

createProgramForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const boothId = programBoothSelect.value;
  const name = programNameInput.value.trim();
  if (!currentEventId || !boothId || !name) return;

  const { error } = await supabase.from('programs').insert({
    booth_id: boothId,
    name,
    organizer: programOrganizerInput.value.trim() || null,
  });

  if (error) {
    showMessage(translateError(error), 'error');
    return;
  }

  programNameInput.value = '';
  programOrganizerInput.value = '';
  showMessage('企画を登録しました', 'success');
});

const user = await requireAuth();
if (user) {
  const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', user.id).single();
  whoEl.textContent = `${profile?.display_name ?? user.email} でログイン中`;

  initEventMap();
  const events = await loadEvents();
  await refreshAdminEventOptions(events);

  if (events.length === 0) {
    showMessage('イベントを先に作成してください。', 'error');
  }
}

logoutBtn.addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.href = 'auth.html';
});