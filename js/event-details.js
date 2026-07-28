import { supabase } from './supabaseClient.js';
import { requireAuth } from './sessionGuard.js';
import { buildEventLabel, loadEventsWithRange } from './eventUtils.js';

const whoEl = document.getElementById('who');
const logoutBtn = document.getElementById('logout-btn');
const messageEl = document.getElementById('event-detail-message');
const eventSelect = document.getElementById('detail-event-select');
const boothListEl = document.getElementById('detail-booth-list');
const programListEl = document.getElementById('detail-program-list');

const eventEditSection = document.getElementById('event-edit-section');
const editEventForm = document.getElementById('edit-event-form');
const editEventName = document.getElementById('edit-event-name');
const editEventStart = document.getElementById('edit-event-start');
const editEventEnd = document.getElementById('edit-event-end');
const deleteEventBtn = document.getElementById('delete-event-btn');

let allEvents = [];
let currentEventId = '';

function showMessage(text, type) {
  messageEl.textContent = text;
  messageEl.className = `message ${type}`;
}
function hideMessage() {
  messageEl.className = 'message';
  messageEl.textContent = '';
}
function translateError(error) {
  return `エラーが発生しました: ${error?.message || ''}`;
}

async function loadEvents() {
  const result = await loadEventsWithRange(supabase);
  if (result.error) showMessage(translateError(result.error), 'error');
  return result.events;
}

async function loadBooths(eventId) {
  if (!eventId) return [];
  const { data, error } = await supabase
    .from('booths').select('id, name').eq('event_id', eventId).order('name');
  if (error) { showMessage(translateError(error), 'error'); return []; }
  return data || [];
}

async function loadPrograms(boothIds) {
  if (boothIds.length === 0) return [];
  const { data, error } = await supabase
    .from('programs')
    .select('id, name, organizer, booth_id, booths(name)')
    .in('booth_id', boothIds)
    .order('name');
  if (error) { showMessage(translateError(error), 'error'); return []; }
  return data || [];
}

function renderDetails(eventId, booths, programs) {
  boothListEl.innerHTML = '';
  programListEl.innerHTML = '';

  if (!eventId) {
    boothListEl.innerHTML = '<li class="group-empty">イベントを選ぶと表示されます</li>';
    programListEl.innerHTML = '<li class="group-empty">イベントを選ぶと表示されます</li>';
    return;
  }

  if (booths.length === 0) {
    boothListEl.innerHTML = '<li class="group-empty">まだブースがありません</li>';
  } else {
    for (const booth of booths) {
      const li = document.createElement('li');
      li.textContent = booth.name;
      boothListEl.appendChild(li);
    }
  }

  if (programs.length === 0) {
    programListEl.innerHTML = '<li class="group-empty">まだ企画がありません</li>';
  } else {
    for (const program of programs) {
      const li = document.createElement('li');
      const parts = [program.name];
      if (program.booths?.name) parts.push(program.booths.name);
      if (program.organizer) parts.push(program.organizer);
      li.textContent = parts.join(' / ');
      programListEl.appendChild(li);
    }
  }
}

// 編集フォームに選択中イベントの値をセット
function fillEditForm(eventId) {
  const event = allEvents.find((ev) => ev.id === eventId);
  if (!event) {
    eventEditSection.hidden = true;
    return;
  }
  editEventName.value = event.name;
  editEventStart.value = event.startDate ?? '';
  editEventEnd.value = event.endDate ?? '';
  eventEditSection.hidden = false;
}

async function refreshEventDetails(eventId) {
  currentEventId = eventId;
  hideMessage();
  fillEditForm(eventId);
  const booths = await loadBooths(eventId);
  const programs = await loadPrograms(booths.map((b) => b.id));
  renderDetails(eventId, booths, programs);
}

// ---------- 編集 ----------
editEventForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentEventId) return;

  const name = editEventName.value.trim();
  const startDate = editEventStart.value;
  const endDate = editEventEnd.value;

  if (!name || !startDate || !endDate) return;
  if (startDate > endDate) {
    showMessage('開始日は終了日以前にしてください', 'error');
    return;
  }

  const { error } = await supabase
    .from('events')
    .update({ name, start_date: startDate, end_date: endDate })
    .eq('id', currentEventId);

  if (error) {
    showMessage(translateError(error), 'error');
    return;
  }

  // ローカルのallEventsも更新してセレクトを再描画
  const idx = allEvents.findIndex((ev) => ev.id === currentEventId);
  if (idx !== -1) {
    allEvents[idx] = { ...allEvents[idx], name, startDate, endDate };
  }
  rebuildEventSelect(currentEventId);
  showMessage('イベントを更新しました', 'success');
});

// ---------- 削除 ----------
deleteEventBtn.addEventListener('click', async () => {
  const event = allEvents.find((ev) => ev.id === currentEventId);
  if (!event) return;

  const confirmed = confirm(
    `「${event.name}」を削除しますか?\n\n` +
    `このイベントに紐づくブース・企画もすべて削除されます。\nシフトのブース/企画情報はNULLになります。`
  );
  if (!confirmed) return;

  const { error } = await supabase.from('events').delete().eq('id', currentEventId);
  if (error) {
    showMessage(translateError(error), 'error');
    return;
  }

  allEvents = allEvents.filter((ev) => ev.id !== currentEventId);
  rebuildEventSelect('');
  showMessage('イベントを削除しました', 'success');
  eventEditSection.hidden = true;
  renderDetails('', [], []);
});

// ---------- セレクト再描画 ----------
function rebuildEventSelect(selectId) {
  eventSelect.innerHTML = '<option value="">イベントを選択してください</option>';
  for (const ev of allEvents) {
    const opt = document.createElement('option');
    opt.value = ev.id;
    opt.textContent = buildEventLabel(ev);
    eventSelect.appendChild(opt);
  }
  if (selectId && allEvents.some((ev) => ev.id === selectId)) {
    eventSelect.value = selectId;
  } else if (allEvents.length > 0) {
    eventSelect.value = allEvents[0].id;
    refreshEventDetails(eventSelect.value);
  }
}

// ---------- 初期化 ----------
const user = await requireAuth();
if (user) {
  const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', user.id).single();
  whoEl.textContent = `${profile?.display_name ?? user.email} でログイン中`;

  allEvents = await loadEvents();
  rebuildEventSelect('');

  const params = new URLSearchParams(window.location.search);
  const requestedId = params.get('eventId');
  if (requestedId && allEvents.some((ev) => ev.id === requestedId)) {
    eventSelect.value = requestedId;
  } else if (allEvents.length > 0) {
    eventSelect.value = allEvents[0].id;
  }

  await refreshEventDetails(eventSelect.value);

  if (allEvents.length === 0) {
    showMessage('イベントがありません。先にイベントを作成してください。', 'error');
  }
}

eventSelect.addEventListener('change', () => refreshEventDetails(eventSelect.value));

logoutBtn.addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.href = 'auth.html';
});