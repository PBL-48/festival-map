import { supabase } from './supabaseClient.js';
import { requireAuth } from './sessionGuard.js';

const whoEl = document.getElementById('who');
const logoutBtn = document.getElementById('logout-btn');
const messageEl = document.getElementById('map-message');
const eventSelectWrap = document.getElementById('event-select-wrap');
const eventSelect = document.getElementById('event-select');
const groupCheckboxesEl = document.getElementById('group-checkboxes');
const onshiftListEl = document.getElementById('onshift-list');
const addBoothBtn = document.getElementById('add-booth-btn');
const placeHint = document.getElementById('place-hint');
const boothNameModal = document.getElementById('booth-name-modal');
const newBoothNameInput = document.getElementById('new-booth-name-input');
const confirmBoothBtn = document.getElementById('confirm-booth-btn');
const cancelBoothBtn = document.getElementById('cancel-booth-btn');

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
function formatTime(t) { return t ? t.slice(0, 5) : ''; }

// ---------- 状態 ----------
let currentUser = null;
let allUserGroups = [];   // {id, name, eventId}
let currentEventId = null;
let groupsForEvent = [];
let selectedGroupIds = new Set();
let booths = [];
let programs = [];
let shifts = [];
let leafletMap = null;
let markerLayer = null;
let placingMode = false;
let pendingLatLng = null;

// ---------- データ取得 ----------
async function loadUserGroups(userId) {
  const { data, error } = await supabase
    .from('group_members')
    .select('groups(id, name, event_id, events(name))')
    .eq('user_id', userId);

  if (error) { showMessage(translateError(error), 'error'); return []; }
  return (data || [])
    .filter((row) => row.groups)
    .map((row) => ({
      id: row.groups.id,
      name: row.groups.name,
      eventId: row.groups.event_id,
      eventName: row.groups.events?.name ?? '',
    }));
}

async function loadBooths(eventId) {
  const { data, error } = await supabase.from('booths').select('id, name, lat, lng').eq('event_id', eventId);
  if (error) { showMessage(translateError(error), 'error'); return []; }
  return (data || []).filter((b) => b.lat != null && b.lng != null);
}

async function loadPrograms(boothIds) {
  if (boothIds.length === 0) return [];
  const { data, error } = await supabase.from('programs').select('id, booth_id, name, organizer, start_time, end_time').in('booth_id', boothIds);
  if (error) { showMessage(translateError(error), 'error'); return []; }
  return data || [];
}

async function loadShifts(groupIds) {
  if (groupIds.length === 0) return [];
  const { data, error } = await supabase
    .from('shifts')
    .select('id, group_id, booth_id, shift_date, start_time, end_time, note, profiles(display_name)')
    .in('group_id', groupIds);
  if (error) { showMessage(translateError(error), 'error'); return []; }
  return data || [];
}

// ---------- グループチェックボックス ----------
function renderGroupCheckboxes() {
  groupCheckboxesEl.innerHTML = '';
  if (groupsForEvent.length === 0) {
    groupCheckboxesEl.innerHTML = '<p class="group-empty">このイベントに参加しているグループがありません</p>';
    return;
  }

  for (const g of groupsForEvent) {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedGroupIds.has(g.id);
    checkbox.addEventListener('change', async () => {
      if (checkbox.checked) selectedGroupIds.add(g.id);
      else selectedGroupIds.delete(g.id);
      await refreshShiftsAndPanels();
    });
    label.append(checkbox, document.createTextNode(g.name));
    groupCheckboxesEl.appendChild(label);
  }
}

// ---------- 現在シフト中パネル ----------
function renderOnShiftPanel() {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const nowTime = now.toTimeString().slice(0, 5);

  const active = shifts.filter((s) =>
    s.shift_date === todayStr &&
    selectedGroupIds.has(s.group_id) &&
    s.start_time?.slice(0, 5) <= nowTime &&
    nowTime <= s.end_time?.slice(0, 5)
  );

  onshiftListEl.innerHTML = '';
  if (active.length === 0) {
    onshiftListEl.innerHTML = '<p class="group-empty">現在シフト中のメンバーはいません</p>';
    return;
  }

  for (const s of active) {
    const booth = booths.find((b) => b.id === s.booth_id);
    const div = document.createElement('div');
    div.className = 'onshift-item';
    div.innerHTML = `
      <span>${escapeHtml(s.profiles?.display_name ?? '')}</span>
      <span class="booth">${escapeHtml(booth?.name ?? '場所未設定')}</span>
    `;
    onshiftListEl.appendChild(div);
  }
}

// ---------- 地図上のブース(ツールチップ) ----------
function boothTooltipHtml(booth) {
  const boothPrograms = programs.filter((p) => p.booth_id === booth.id);
  const boothShifts = shifts.filter((s) => s.booth_id === booth.id && selectedGroupIds.has(s.group_id));

  let html = `<div class="booth-popup"><h3>${escapeHtml(booth.name)}</h3>`;

  html += '<div class="popup-section"><span class="label">企画</span>';
  html += boothPrograms.length
    ? boothPrograms.map((p) => {
        const time = p.start_time ? ` (${formatTime(p.start_time)}〜${formatTime(p.end_time)})` : '';
        return `${escapeHtml(p.name)}${time}`;
      }).join('<br>')
    : '未登録';
  html += '</div>';

  html += '<div class="popup-section"><span class="label">シフト</span>';
  html += boothShifts.length
    ? boothShifts.map((s) => `${escapeHtml(s.profiles?.display_name ?? '')} ${escapeHtml(s.shift_date)} ${formatTime(s.start_time)}〜${formatTime(s.end_time)}`).join('<br>')
    : 'なし';
  html += '</div></div>';

  return html;
}

function renderMarkers() {
  markerLayer.clearLayers();
  for (const booth of booths) {
    const marker = L.marker([booth.lat, booth.lng]);
    marker.bindTooltip(() => boothTooltipHtml(booth), { sticky: true, direction: 'top' });
    marker.addTo(markerLayer);
  }

  if (booths.length > 0) {
    const bounds = L.latLngBounds(booths.map((b) => [b.lat, b.lng]));
    leafletMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 18 });
  }
}

// ---------- ブース追加(地図クリックで配置) ----------
function initBoothAdding() {
  addBoothBtn.addEventListener('click', () => {
    placingMode = !placingMode;
    addBoothBtn.classList.toggle('is-active', placingMode);
    addBoothBtn.textContent = placingMode ? 'クリックして配置' : '＋ブースを追加';
    placeHint.hidden = !placingMode;
  });

  leafletMap.on('click', (e) => {
    if (!placingMode) return;
    pendingLatLng = e.latlng;
    boothNameModal.hidden = false;
    newBoothNameInput.value = '';
    newBoothNameInput.focus();
  });

  cancelBoothBtn.addEventListener('click', () => {
    boothNameModal.hidden = true;
    pendingLatLng = null;
  });

  confirmBoothBtn.addEventListener('click', async () => {
    const name = newBoothNameInput.value.trim();
    if (!name || !pendingLatLng || !currentEventId) return;

    const { data, error } = await supabase
      .from('booths')
      .insert({ name, event_id: currentEventId, lat: pendingLatLng.lat, lng: pendingLatLng.lng })
      .select('id, name, lat, lng')
      .single();

    if (error) { showMessage(translateError(error), 'error'); return; }

    booths.push(data);
    renderMarkers();
    boothNameModal.hidden = true;
    pendingLatLng = null;

    // 追加モードは1回で終える(連続で置きたい場合は再度ボタンを押してもらう)
    placingMode = false;
    addBoothBtn.classList.remove('is-active');
    addBoothBtn.textContent = '＋ブースを追加';
    placeHint.hidden = true;
  });
}

// ---------- イベント切り替え時のデータ読み込み ----------
async function refreshShiftsAndPanels() {
  shifts = await loadShifts([...selectedGroupIds]);
  renderOnShiftPanel();
  renderMarkers(); // ツールチップの内容(シフト情報)を最新化するため再生成
}

async function loadEventData(eventId) {
  currentEventId = eventId;
  groupsForEvent = allUserGroups.filter((g) => g.eventId === eventId);
  selectedGroupIds = new Set(groupsForEvent.map((g) => g.id));
  renderGroupCheckboxes();

  booths = await loadBooths(eventId);
  programs = await loadPrograms(booths.map((b) => b.id));
  shifts = await loadShifts([...selectedGroupIds]);

  renderMarkers();
  renderOnShiftPanel();
}

function initLeafletMap() {
  leafletMap = L.map('leaflet-map').setView([35.6812, 139.7671], 16); // 初期値: 東京駅付近。ブースがあれば自動でフィットする
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(leafletMap);
  markerLayer = L.layerGroup().addTo(leafletMap);
}

// ---------- 初期化 ----------
currentUser = await requireAuth();
if (currentUser) {
  const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', currentUser.id).single();
  whoEl.textContent = `${profile?.display_name ?? currentUser.email} でログイン中`;

  allUserGroups = await loadUserGroups(currentUser.id);
  const eventMap = new Map();
  for (const g of allUserGroups) {
    if (g.eventId) eventMap.set(g.eventId, g.eventName);
  }
  const eventList = [...eventMap.entries()].map(([id, name]) => ({ id, name }));

  initLeafletMap();
  initBoothAdding();

  if (eventList.length === 0) {
    showMessage('まだどのグループにも参加していません。先に「グループ」からグループの作成・参加を行ってください。', 'error');
  } else {
    if (eventList.length > 1) {
      eventSelectWrap.hidden = false;
      eventSelect.innerHTML = eventList.map((ev) => `<option value="${ev.id}">${escapeHtml(ev.name)}</option>`).join('');
      eventSelect.addEventListener('change', () => loadEventData(eventSelect.value));
    }
    await loadEventData(eventList[0].id);
  }
}

logoutBtn.addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.href = 'auth.html';
});