export async function loadEventsWithRange(supabase) {
  const modern = await supabase
    .from('events')
    .select('id, name, start_date, end_date')
    .order('start_date', { ascending: true });

  if (!modern.error) {
    return {
      schema: 'range',
      events: (modern.data || []).map((event) => ({
        id: event.id,
        name: event.name,
        startDate: event.start_date,
        endDate: event.end_date ?? event.start_date,
      })),
      error: null,
    };
  }

  const legacy = await supabase
    .from('events')
    .select('id, name, event_date')
    .order('event_date', { ascending: true });

  if (legacy.error) {
    return { schema: 'unknown', events: [], error: modern.error };
  }

  return {
    schema: 'single',
    events: (legacy.data || []).map((event) => ({
      id: event.id,
      name: event.name,
      startDate: event.event_date,
      endDate: event.event_date,
    })),
    error: null,
  };
}

export function formatEventRange(event) {
  if (!event?.startDate) return '';
  if (!event.endDate || event.startDate === event.endDate) return event.startDate;
  return `${event.startDate} 〜 ${event.endDate}`;
}

export function buildEventLabel(event) {
  const rangeText = formatEventRange(event);
  return rangeText ? `${event.name} (${rangeText})` : event.name;
}
