import { supabase } from './supabaseClient.js';
import { requireAuth } from './sessionGuard.js';

const whoEl = document.getElementById('who');
const logoutBtn = document.getElementById('logout-btn');
const messageEl = document.getElementById('event-message');

const createEventForm = document.getElementById('create-event-form');
const eventNameInput = document.getElementById('event-name');
const eventDateInput = document.getElementById('event-date');

const adminEventSelect = document.getElementById('admin-event-select');
const eventBoothList = document.getElementById('event-booth-list');
const eventProgramList = document.getElementById('event-program-list');

const createBoothForm = document.getElementById('create-booth-form');
const boothNameInput = document.getElementById('booth-name');
const boothCoordsText = document.getElementById('booth-coords');

const createProgramForm = document.getElementById('create-program-form');
const programBoothSelect = document.getElementById('program-booth-select');
const programNameInput = document.getElementById('program-name');
const programOrganizerInput = document.getElementById('program-organizer');
const programStartInput = document.getElementById('program-start');
const programEndInput = document.getElementById('program-end');

let eventMap;
let eventMarkerLayer;
let selectedLatLng = null;
let currentEventId = '';

function showMessage(text, type) {
  messageEl.textContent = text;
  messageEl.className = `message ${type}`;
}

function translateError(error) {
  return `エラーが発生しました: ${error?.message || ''}`;
}

function formatTime(t) {
  return t ? t.slice(0, 5) : '';
}

async function loadEvents() {
  const { data, error } = await supabase.from('events').select('id, name, event_date').order('event_date', { ascending: true });
  if (error) {
    showMessage(translateError(error), 'error');
    return [];
  }
  return data || [];
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

async function loadPrograms(boothIds) {
  if (boothIds.length === 0) return [];
  const { data, error } = await supabase
    .from('programs')
    .select('id, name, organizer, start_time, end_time, booth_id, booths(name)')
    .in('booth_id', boothIds)
    .order('start_time', { ascending: true });

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

function clearBoothMarker() {
  eventMarkerLayer.clearLayers();
  selectedLatLng = null;
  updateBoothMapHint();
}

function setBoothMarker(latlng) {
  selectedLatLng = latlng;
  eventMarkerLayer.clearLayers();
  L.marker(latlng).addTo(eventMarkerLayer);
  updateBoothMapHint();
}

function initEventMap() {
  eventMap = L.map('event-booth-map').setView([35.6812, 139.7671], 16);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(eventMap);
  eventMarkerLayer = L.layerGroup().addTo(eventMap);

  eventMap.on('click', (e) => {
    if (!currentEventId) {
      showMessage('先にイベントを選択してください', 'error');
      return;
    }
    setBoothMarker(e.latlng);
  });
}

function renderEventSummary(booths, programs) {
  eventBoothList.innerHTML = '';
  eventProgramList.innerHTML = '';

  if (!currentEventId) {
    eventBoothList.innerHTML = '<li class="group-empty">イベントを選ぶと表示されます</li>';
    eventProgramList.innerHTML = '<li class="group-empty">イベントを選ぶと表示されます</li>';
    return;
  }

  if (booths.length === 0) {
    eventBoothList.innerHTML = '<li class="group-empty">まだブースがありません</li>';
  } else {
    for (const booth of booths) {
      const li = document.createElement('li');
      li.textContent = booth.name;
      eventBoothList.appendChild(li);
    }
  }

  if (programs.length === 0) {
    eventProgramList.innerHTML = '<li class="group-empty">まだ企画がありません</li>';
  } else {
    for (const program of programs) {
      const li = document.createElement('li');
      const parts = [program.name];
      if (program.booths?.name) parts.push(program.booths.name);
      if (program.start_time) parts.push(`${formatTime(program.start_time)}〜${formatTime(program.end_time)}`);
      li.textContent = parts.join(' / ');
      eventProgramList.appendChild(li);
    }
  }
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
  const programs = await loadPrograms(booths.map((booth) => booth.id));

  fillProgramBoothSelect(booths);
  renderEventSummary(booths, programs);
  clearBoothMarker();

  if (!eventId) {
    eventMap.setView([35.6812, 139.7671], 16);
    return;
  }

  const boothPoints = booths.filter((booth) => booth.lat != null && booth.lng != null).map((booth) => [booth.lat, booth.lng]);
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
    opt.textContent = event.event_date ? `${event.name} (${event.event_date})` : event.name;
    adminEventSelect.appendChild(opt);
  }

  if (preferredEventId && events.some((event) => event.id === preferredEventId)) {
    adminEventSelect.value = preferredEventId;
  } else if (events.length > 0) {
    adminEventSelect.value = events[0].id;
  }

  await refreshSelectedEvent(adminEventSelect.value);
}

createEventForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const name = eventNameInput.value.trim();
  const eventDate = eventDateInput.value;
  if (!name || !eventDate) return;

  const { data, error } = await supabase.from('events').insert({ name, event_date: eventDate }).select('id').single();
  if (error) {
    showMessage(translateError(error), 'error');
    return;
  }

  eventNameInput.value = '';
  eventDateInput.value = '';
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
    start_time: programStartInput.value || null,
    end_time: programEndInput.value || null,
  });

  if (error) {
    showMessage(translateError(error), 'error');
    return;
  }

  programNameInput.value = '';
  programOrganizerInput.value = '';
  programStartInput.value = '';
  programEndInput.value = '';
  showMessage('企画を登録しました', 'success');
  await refreshSelectedEvent(currentEventId);
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