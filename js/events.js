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
const boothMapHintEl = document.getElementById('booth-map-hint');
const boothListEl = document.getElementById('booth-list');

const createProgramForm = document.getElementById('create-program-form');
const programBoothSelect = document.getElementById('program-booth-select');
const programNameInput = document.getElementById('program-name');
const programOrganizerInput = document.getElementById('program-organizer');
const programListEl = document.getElementById('program-list');

let eventMap;
let selectedMarkerLayer;
let boothMarkerLayer;
let selectedLatLng = null;
let currentEventId = '';
let eventSchema = 'range';
let repositioningBoothId = null;

// ピンのアイコン(登録済みブース用・配置中プレビュー用)
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

async function loadPrograms(boothIds) {
  if (boothIds.length === 0) return [];
  const { data, error } = await supabase
    .from('programs')
    .select('id, booth_id, name, organizer')
    .in('booth_id', boothIds)
    .order('name');
  if (error) {
    showMessage(translateError(error), 'error');
    return [];
  }
  return data || [];
}

function updateBoothMapHint() {
  if (repositioningBoothId) return; // 移動モード中のヒントは上書きしない
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

  eventMap.on('click', async (e) => {
    if (repositioningBoothId) {
      const boothId = repositioningBoothId;
      repositioningBoothId = null;
      boothMapHintEl.textContent = '地図をクリックしてブースの位置を決めてください';

      const { error } = await supabase.from('booths').update({ lat: e.latlng.lat, lng: e.latlng.lng }).eq('id', boothId);
      if (error) {
        showMessage(translateError(error), 'error');
        return;
      }
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

function fillProgramBoothSelect(booths) {
  programBoothSelect.innerHTML = '<option value="">ブースを選択してください</option>';
  for (const booth of booths) {
    const opt = document.createElement('option');
    opt.value = booth.id;
    opt.textContent = booth.name;
    programBoothSelect.appendChild(opt);
  }
}

// ---------- ブース一覧(編集・削除・位置変更) ----------
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

// ---------- 企画一覧(編集・削除) ----------
function renderProgramList(programs, booths) {
  programListEl.innerHTML = '';
  if (programs.length === 0) {
    programListEl.innerHTML = '<li class="group-empty">まだ企画がありません</li>';
    return;
  }

  for (const program of programs) {
    const booth = booths.find((b) => b.id === program.booth_id);
    const li = document.createElement('li');
    li.className = 'group-item';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'name';
    nameSpan.textContent = program.organizer ? `${program.name}(${program.organizer})` : program.name;
    if (booth) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = booth.name;
      nameSpan.appendChild(badge);
    }

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'button-secondary';
    editBtn.textContent = '編集';
    editBtn.addEventListener('click', () => startEditProgram(li, program));

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'button-secondary';
    deleteBtn.textContent = '削除';
    deleteBtn.addEventListener('click', () => deleteProgram(program.id));

    const actions = document.createElement('div');
    actions.className = 'item-actions';
    actions.append(editBtn, deleteBtn);

    li.append(nameSpan, actions);
    programListEl.appendChild(li);
  }
}

function startEditProgram(li, program) {
  li.innerHTML = '';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = program.name;
  nameInput.placeholder = '企画名';

  const organizerInput = document.createElement('input');
  organizerInput.type = 'text';
  organizerInput.value = program.organizer ?? '';
  organizerInput.placeholder = '主催';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'button-secondary';
  saveBtn.textContent = '保存';
  saveBtn.addEventListener('click', async () => {
    const newName = nameInput.value.trim();
    if (!newName) return;
    const { error } = await supabase
      .from('programs')
      .update({ name: newName, organizer: organizerInput.value.trim() || null })
      .eq('id', program.id);
    if (error) { showMessage(translateError(error), 'error'); return; }
    showMessage('企画を更新しました', 'success');
    await refreshSelectedEvent(currentEventId);
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'link-button';
  cancelBtn.textContent = 'キャンセル';
  cancelBtn.addEventListener('click', () => refreshSelectedEvent(currentEventId));

  const row = document.createElement('div');
  row.className = 'item-edit-row';
  row.append(nameInput, organizerInput, saveBtn, cancelBtn);
  li.appendChild(row);
}

async function deleteProgram(programId) {
  if (!confirm('この企画を削除しますか?')) return;
  const { error } = await supabase.from('programs').delete().eq('id', programId);
  if (error) { showMessage(translateError(error), 'error'); return; }
  showMessage('企画を削除しました', 'success');
  await refreshSelectedEvent(currentEventId);
}

async function refreshSelectedEvent(eventId) {
  currentEventId = eventId;
  const booths = await loadBooths(eventId);

  fillProgramBoothSelect(booths);
  renderExistingBoothMarkers(booths);
  renderBoothList(booths);
  clearSelectedBoothMarker();

  const programs = await loadPrograms(booths.map((b) => b.id));
  renderProgramList(programs, booths);

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