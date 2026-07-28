export async function loadEventsWithRange(supabase, eventIds = null) {
  // start_date/end_date対応版を試みる
  let modernQuery = supabase
    .from('events')
    .select('id, name, start_date, end_date')
    .order('start_date', { ascending: true });

  if (eventIds && eventIds.length > 0) {
    modernQuery = modernQuery.in('id', eventIds);
  }

  const modern = await modernQuery;

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

  // フォールバック: 旧event_dateカラム
  let legacyQuery = supabase
    .from('events')
    .select('id, name, event_date')
    .order('event_date', { ascending: true });

  if (eventIds && eventIds.length > 0) {
    legacyQuery = legacyQuery.in('id', eventIds);
  }

  const legacy = await legacyQuery;

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