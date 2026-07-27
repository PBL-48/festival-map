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
const boothManageLink = document.getElementById('booth-manage-link');
const programManageLink = document.getElementById('program-manage-link');

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
  if (result.error) showMessage(translateError(result.error), 'error');
  eventSchema = result.schema;
  return result.events;
}

function updateManageLinks(eventId) {
  const suffix = eventId ? `?eventId=${encodeURIComponent(eventId)}` : '';
  eventDetailLink.href = `event-details.html${suffix}`;
  boothManageLink.href = `booths.html${suffix}`;
  programManageLink.href = `programs.html${suffix}`;
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

  updateManageLinks(adminEventSelect.value);
}

function openCreateEventModal() { createEventModal.hidden = false; }
function closeCreateEventModal() { createEventModal.hidden = true; }

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
  if (error) { showMessage(translateError(error), 'error'); return; }

  eventNameInput.value = '';
  eventStartDateInput.value = '';
  eventEndDateInput.value = '';
  closeCreateEventModal();
  showMessage('イベントを作成しました', 'success');
  const events = await loadEvents();
  await refreshAdminEventOptions(events, data.id);
});

adminEventSelect.addEventListener('change', () => {
  updateManageLinks(adminEventSelect.value);
});

const user = await requireAuth();
if (user) {
  const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', user.id).single();
  whoEl.textContent = `${profile?.display_name ?? user.email} でログイン中`;

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