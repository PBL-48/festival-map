import { supabase } from './supabaseClient.js';
import { requireAuth } from './sessionGuard.js';
import { buildEventLabel, loadEventsWithRange } from './eventUtils.js';

const whoEl = document.getElementById('who');
const logoutBtn = document.getElementById('logout-btn');
const messageEl = document.getElementById('event-detail-message');
const eventSelect = document.getElementById('detail-event-select');
const boothListEl = document.getElementById('detail-booth-list');
const programListEl = document.getElementById('detail-program-list');

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
  return result.events;
}

async function loadBooths(eventId) {
  if (!eventId) return [];
  const { data, error } = await supabase.from('booths').select('id, name').eq('event_id', eventId).order('name');
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
    .select('id, name, organizer, booth_id, booths(name)')
    .in('booth_id', boothIds)
    .order('name');

  if (error) {
    showMessage(translateError(error), 'error');
    return [];
  }
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
      const details = [program.name];
      if (program.booths?.name) details.push(program.booths.name);
      if (program.organizer) details.push(program.organizer);
      li.textContent = details.join(' / ');
      programListEl.appendChild(li);
    }
  }
}

async function refreshEventDetails(eventId) {
  const booths = await loadBooths(eventId);
  const programs = await loadPrograms(booths.map((booth) => booth.id));
  renderDetails(eventId, booths, programs);
}

const user = await requireAuth();
if (user) {
  const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', user.id).single();
  whoEl.textContent = `${profile?.display_name ?? user.email} でログイン中`;

  const events = await loadEvents();
  eventSelect.innerHTML = '<option value="">イベントを選択してください</option>';
  for (const event of events) {
    const opt = document.createElement('option');
    opt.value = event.id;
    opt.textContent = buildEventLabel(event);
    eventSelect.appendChild(opt);
  }

  const params = new URLSearchParams(window.location.search);
  const requestedEventId = params.get('eventId');
  if (requestedEventId && events.some((event) => event.id === requestedEventId)) {
    eventSelect.value = requestedEventId;
  } else if (events.length > 0) {
    eventSelect.value = events[0].id;
  }

  await refreshEventDetails(eventSelect.value);

  if (events.length === 0) {
    showMessage('イベントがありません。先にイベントを作成してください。', 'error');
  }
}

eventSelect.addEventListener('change', async () => {
  await refreshEventDetails(eventSelect.value);
});

logoutBtn.addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.href = 'auth.html';
});
