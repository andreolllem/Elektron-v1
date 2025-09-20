(function () {
  const CHAT_GOOGLE = 'google';
  const CHAT_DECUPAGEM = 'decupagem';
  const CHAT_CHATEK = 'chatek';
  const CHAT_FFMPEG = 'ffmpeg';

  const messagesEl = document.getElementById("messages");
  const inputEl = document.getElementById("input");
  const sendBtn = document.getElementById("send");
  const searchEl = document.getElementById("search");
  const collapseBtn = document.getElementById("collapse");
  const folderGoogleBtn = document.getElementById("folder-google");
  const folderDecupagemBtn = document.getElementById("folder-decupagem");
  const folderFfmpegBtn = document.getElementById('folder-ffmpeg');
  const folderChatekBtn = document.getElementById("folder-chatek");
  const mmEmbed = document.getElementById('mm-embed');
  const mmWebview = null; // substituído por BrowserView (main)
  const calRail = document.getElementById('calendar-rail');
  const calendarPane = document.getElementById('calendar-pane');
  const calendarBoardEl = document.getElementById('calendar-board');
  const calendarRangeEl = document.getElementById('calendar-range');
  const calendarViewSwitch = document.getElementById('calendar-view-switch');
  const calendarTodayBtn = document.getElementById('calendar-today');
  const calendarPrevBtn = document.getElementById('calendar-prev');
  const calendarNextBtn = document.getElementById('calendar-next');
  const deleteEventModal = document.getElementById('event-delete-modal');
  const deleteEventMessage = document.getElementById('event-delete-message');
  const deleteEventCancelBtn = document.getElementById('event-delete-cancel');
  const deleteEventConfirmBtn = document.getElementById('event-delete-confirm');
  const eventContextMenu = document.getElementById('event-context-menu');
  const eventDeleteAction = document.getElementById('event-delete-action');
  const deleteModalCloseEls = deleteEventModal ? deleteEventModal.querySelectorAll('[data-close]') : [];
  const attachBtn = document.getElementById('attach-btn');
  const fileInput = document.getElementById('file-input');
  const openScheduleBtn = document.getElementById("openSchedule");
  const openSettingsBtn = document.getElementById("openSettings");
  const modal = document.getElementById("schedule-modal");
  const modalCloseEls = modal ? modal.querySelectorAll("[data-close]") : [];
  const schTitle = document.getElementById("sch-title");
  const schDateText = document.getElementById("sch-date-text");
  const schDate = document.getElementById("sch-date");
  const schTime = document.getElementById("sch-time");
  const schDuration = document.getElementById("sch-duration");
  const timeBtn = document.getElementById("time-btn");
  const durBtn = document.getElementById("dur-btn");
  const schAttendees = document.getElementById("sch-attendees");
  const schDesc = document.getElementById("sch-desc");
  const schSubmit = document.getElementById("sch-submit");

  // State
  const messages = [];
  let activeChat = (() => {
    try { return localStorage.getItem('cleoActiveChat') || CHAT_GOOGLE; } catch { return CHAT_GOOGLE; }
  })();
  const pendingFiles = [];
  const googleView = {
    events: [], // lista normalizada usada na UI
    eventMap: new Map(), // chave → evento normalizado
    monthBase: new Date(),
    selectedDate: null, // 'YYYY-MM-DD'
    mode: 'day',
  };
  let selectedEventKey = null;
  let pendingDeleteKey = null;

  function ymd(d){
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const da = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${da}`;
  }
  function toDateOnly(iso){
    if (!iso) return '';
    return String(iso).slice(0,10);
  }
  function monthStart(d){
    const x = new Date(d.getFullYear(), d.getMonth(), 1);
    return x;
  }
  function monthEnd(d){
    return new Date(d.getFullYear(), d.getMonth()+1, 0);
  }
  function fromYmd(str){
    if (!str) return null;
    const parts = String(str).split('-').map(Number);
    if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  function ensureSelectedDate(){
    if (!googleView.selectedDate){
      const today = new Date();
      googleView.selectedDate = ymd(today);
      googleView.monthBase = monthStart(today);
    }
  }
  const EVENT_DELETE_TOKENS = new Set([
    'delete',
    'deleted',
    'remove',
    'removed',
    'cancel',
    'cancelled',
    'canceled',
  ]);
  function firstString(...vals){
    for (const val of vals){
      if (typeof val === 'string' && val.trim()) return val.trim();
    }
    return '';
  }
  function coerceDateTime(val){
    if (!val) return '';
    if (typeof val === 'string') return val.trim();
    if (typeof val === 'object'){
      if (typeof val.dateTime === 'string') return val.dateTime.trim();
      if (typeof val.datetime === 'string') return val.datetime.trim();
      if (typeof val.date_time === 'string') return val.date_time.trim();
      if (typeof val.date === 'string') return val.date.trim();
      if (typeof val.value === 'string') return val.value.trim();
    }
    return '';
  }
  const formatFileSize = (n) => {
    if (typeof n !== 'number' || Number.isNaN(n)) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let idx = 0;
    let value = n;
    while (value >= 1024 && idx < units.length - 1){
      value /= 1024;
      idx++;
    }
    const fixed = value < 10 && idx > 0 ? value.toFixed(1) : value.toFixed(0);
    return `${fixed} ${units[idx]}`;
  };
  const pathJoin = (...segments) => {
    return segments
      .filter((part) => typeof part === 'string' && part.length)
      .map((part, index, arr) => {
        let clean = part.replace(/\\/g, '/');
        if (index > 0) clean = clean.replace(/^\/+/, '');
        if (index < arr.length - 1) clean = clean.replace(/\/+$/, '');
        try { clean = decodeURI(clean); } catch {}
        return clean;
      })
      .join('/');
  };
  async function extractFirstFramePoster(file){
    if (!file || typeof window.createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') return null;
    try {
      const bitmap = await createImageBitmap(file, { frameIndex: 0 });
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0);
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.6 });
      const buf = await blob.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      return `data:${blob.type};base64,${base64}`;
    } catch {
      return null;
    }
  }
  function firstDateTime(...vals){
    for (const val of vals){
      const dt = coerceDateTime(val);
      if (dt) return dt;
    }
    return '';
  }
  function computeEventKey(info){
    if (!info || typeof info !== 'object') return null;
    const id = firstString(
      info.id,
      info.eventId,
      info.event_id,
      info.uid,
      info.iCalUID,
      info.icalUID,
      info.icalUid,
      info.key,
      info.link,
      info.htmlLink,
      info.hangoutLink,
      info.conferenceUri,
      info.conferenceURL,
      info.conferenceUrl
    );
    if (id) return id;
    const start = firstString(info.start, info.startDate, info.startTime);
    if (start){
      const summary = firstString(info.summary, info.title, info.name);
      return `${start}|${summary}`.toLowerCase();
    }
    return null;
  }
  function normalizeEventPayload(raw){
    if (!raw || typeof raw !== 'object') return null;
    const base = (raw.event && typeof raw.event === 'object') ? raw.event : raw;
    const dataObj = (raw.data && typeof raw.data === 'object') ? raw.data : null;
    const nested = (dataObj && typeof dataObj.event === 'object') ? dataObj.event : null;
    const lookup = (...args) => firstString(...args);
    const lookupBool = (...args) => args.some((v) => v === true);
    const start = firstDateTime(
      raw.start,
      raw.startDate,
      raw.startTime,
      base.start,
      base.startDate,
      base.startTime,
      base.start?.dateTime,
      base.start?.datetime,
      base.start?.date,
      dataObj?.start,
      dataObj?.start?.dateTime,
      dataObj?.start?.date,
      nested?.start,
      nested?.start?.dateTime,
      nested?.start?.date
    );
    const end = firstDateTime(
      raw.end,
      raw.endDate,
      raw.endTime,
      base.end,
      base.endDate,
      base.endTime,
      base.end?.dateTime,
      base.end?.date,
      dataObj?.end,
      dataObj?.end?.dateTime,
      dataObj?.end?.date,
      nested?.end,
      nested?.end?.dateTime,
      nested?.end?.date
    );
    const summary = lookup(
      raw.summary,
      raw.title,
      base.summary,
      base.title,
      dataObj?.summary,
      dataObj?.title,
      nested?.summary,
      nested?.title,
      raw.name,
      base.name,
      dataObj?.name
    );
    const description = lookup(
      raw.description,
      base.description,
      dataObj?.description,
      nested?.description,
      raw.details,
      base.details,
      dataObj?.details
    );
    const durationMinutesRaw = raw.durationMinutes ?? base.durationMinutes ?? dataObj?.durationMinutes ?? nested?.durationMinutes;
    const durationMinutes = typeof durationMinutesRaw === 'number'
      ? durationMinutesRaw
      : parseInt(typeof durationMinutesRaw === 'string' ? durationMinutesRaw : '', 10);
    const timeZone = lookup(
      raw.timeZone,
      base.timeZone,
      dataObj?.timeZone,
      nested?.timeZone
    );
    const link = lookup(
      raw.link,
      raw.htmlLink,
      raw.hangoutLink,
      raw.meetingLink,
      base.link,
      base.htmlLink,
      base.hangoutLink,
      dataObj?.link,
      dataObj?.htmlLink,
      dataObj?.hangoutLink,
      nested?.link,
      nested?.htmlLink,
      nested?.hangoutLink,
      raw?.conferenceData?.entryPoints?.[0]?.uri,
      base?.conferenceData?.entryPoints?.[0]?.uri,
      dataObj?.conferenceData?.entryPoints?.[0]?.uri
    );
    const hangoutLink = lookup(
      raw.hangoutLink,
      base.hangoutLink,
      dataObj?.hangoutLink,
      nested?.hangoutLink
    );
    const id = lookup(
      raw.id,
      raw.eventId,
      raw.event_id,
      raw.iCalUID,
      raw.icalUID,
      raw.uid,
      base.id,
      base.eventId,
      base.iCalUID,
      base.icalUID,
      base.uid,
      dataObj?.id,
      dataObj?.eventId,
      dataObj?.iCalUID,
      dataObj?.uid,
      nested?.id,
      nested?.eventId,
      nested?.iCalUID,
      nested?.uid
    );
    const statusRaw = lookup(
      raw.status,
      raw.eventStatus,
      raw.lifecycleState,
      base.status,
      dataObj?.status,
      nested?.status
    );
    const actionRaw = lookup(
      raw.action,
      raw.changeType,
      raw.operationType,
      raw.lifecycleState,
      base.action,
      dataObj?.action,
      nested?.action
    );
    const statusNormalized = statusRaw ? statusRaw.toLowerCase() : '';
    const actionNormalized = actionRaw ? actionRaw.toLowerCase() : '';
    const typeNormalized = (lookup(raw.type, base.type, dataObj?.type) || '').toLowerCase();
    const deletionFlag = lookupBool(
      raw.deleted,
      raw.cancelled,
      raw.canceled,
      raw.removed,
      raw.isDeleted,
      raw.isRemoved,
      base.deleted,
      base.cancelled,
      base.canceled,
      base.removed,
      dataObj?.deleted,
      dataObj?.cancelled,
      dataObj?.canceled,
      dataObj?.removed,
      nested?.deleted,
      nested?.cancelled,
      nested?.canceled,
      nested?.removed
    );
    const isDeletion =
      deletionFlag ||
      EVENT_DELETE_TOKENS.has(statusNormalized) ||
      EVENT_DELETE_TOKENS.has(actionNormalized) ||
      typeNormalized.includes('delete') ||
      typeNormalized.includes('cancel');
    const key = computeEventKey({
      id,
      eventId: raw.eventId,
      start,
      startTime: raw.startTime,
      summary,
      title: raw.title,
      link,
      htmlLink: raw.htmlLink,
      hangoutLink,
      uid: raw.uid,
      iCalUID: raw.iCalUID,
    });
    const origin = firstString(
      raw.origin,
      raw.__origin,
      base.origin,
      dataObj?.origin,
      nested?.origin
    );
    const ack = Boolean(
      raw.ack === true ||
      raw.isAck === true ||
      base.ack === true ||
      dataObj?.ack === true ||
      nested?.ack === true ||
      raw?.meta?.ack === true
    );
    const event = {
      type: 'event',
      id: id || undefined,
      key: key || undefined,
      start: start || undefined,
      end: end || undefined,
      summary: summary || undefined,
      title: lookup(raw.title, base.title, summary),
      description: description || undefined,
      durationMinutes: Number.isFinite(durationMinutes) ? durationMinutes : undefined,
      timeZone: timeZone || undefined,
      link: link || hangoutLink || undefined,
      hangoutLink: hangoutLink || undefined,
      status: statusNormalized || undefined,
      action: actionNormalized || undefined,
      origin: origin || undefined,
      ack: ack || undefined,
      raw,
    };
    return { key: event.key || key || null, event, isDeletion };
  }
  function buildHistoryEventPayload(normalized){
    if (!normalized || !normalized.event) return null;
    const { event, isDeletion } = normalized;
    const payload = {
      type: 'event',
      summary: event.summary || event.title || '',
      description: event.description || '',
      start: event.start || '',
      end: event.end || undefined,
      durationMinutes: event.durationMinutes,
      timeZone: event.timeZone,
      link: event.link,
      id: event.id,
      key: event.key,
      status: event.status,
      action: event.action,
      deleted: isDeletion || undefined,
    };
    Object.keys(payload).forEach((k) => {
      if (payload[k] === undefined || payload[k] === '') delete payload[k];
    });
    return payload;
  }
  function updateGoogleEvents(normalized, opts = {}){
    if (!normalized || !normalized.event) return { changed: false };
    if (!googleView.eventMap || !(googleView.eventMap instanceof Map)) {
      googleView.eventMap = new Map();
    }
    const { key, event, isDeletion } = normalized;
    if (!key) return { changed: false };
    const { persist = false, render = true, rebuildList = true } = opts;
    const existing = googleView.eventMap.get(key);
    let changed = false;
    if (isDeletion){
      changed = googleView.eventMap.delete(key);
    } else {
      googleView.eventMap.set(key, { ...event, key });
      changed = true;
    }
    if (rebuildList){
      const list = Array.from(googleView.eventMap.values());
      list.sort((a, b) => {
        const ta = a && a.start ? new Date(a.start).getTime() : 0;
        const tb = b && b.start ? new Date(b.start).getTime() : 0;
        return ta - tb;
      });
      googleView.events = list;
    }
    if (persist && changed){
      const payload = buildHistoryEventPayload({
        key,
        event: isDeletion && existing ? existing : { ...event, key },
        isDeletion,
      });
      if (payload){
        try {
          histAppend({
            role: 'assistant',
            kind: 'event',
            data: payload,
            ts: Date.now(),
            chat: CHAT_GOOGLE,
          });
        } catch {}
      }
    }
    if (render && changed && activeChat === CHAT_GOOGLE){
      renderGoogleEventsFeed();
      renderMiniCalendar();
    }
    if (isDeletion && key === selectedEventKey) {
      selectedEventKey = null;
    }
    return { changed, event };
  }
  function getEventByKey(key){
    if (!key || !googleView.eventMap) return null;
    return googleView.eventMap.get(key) || null;
  }
  function applySelectionToBoard(){
    if (!calendarBoardEl) return;
    const nodes = calendarBoardEl.querySelectorAll('[data-event-key]');
    nodes.forEach((node) => {
      if (selectedEventKey && node.dataset.eventKey === selectedEventKey){
        node.classList.add('is-selected');
      } else {
        node.classList.remove('is-selected');
      }
    });
  }
  function selectEventByKey(key){
    selectedEventKey = key || null;
    applySelectionToBoard();
  }
  function closeEventContextMenu(){
    if (!eventContextMenu) return;
    eventContextMenu.hidden = true;
    eventContextMenu.style.left = '';
    eventContextMenu.style.top = '';
    eventContextMenu.dataset.eventKey = '';
    pendingDeleteKey = null;
  }
  function openEventContextMenu(key, anchorEl, x, y){
    if (!eventContextMenu || !key) return;
    closeEventContextMenu();
    pendingDeleteKey = key;
    eventContextMenu.hidden = false;
    eventContextMenu.dataset.eventKey = key;
    // Mede dimensões após mostrar
    const rect = eventContextMenu.getBoundingClientRect();
    const width = rect.width || 160;
    const height = rect.height || 60;
    const margin = 8;
    const left = Math.min(Math.max(margin, x), window.innerWidth - width - margin);
    const top = Math.min(Math.max(margin, y), window.innerHeight - height - margin);
    eventContextMenu.style.left = `${left}px`;
    eventContextMenu.style.top = `${top}px`;
  }
  function closeDeleteEventModal(){
    pendingDeleteKey = null;
    if (deleteEventModal) deleteEventModal.hidden = true;
  }
  function formatEventForModal(ev){
    if (!ev) return 'Tem certeza de que deseja excluir este evento?';
    const title = ev.summary || ev.title || 'evento';
    let when = '';
    if (ev.start){
      const start = new Date(ev.start);
      if (!Number.isNaN(start.valueOf())){
        const dateLabel = capitalize(dayMonthYearFormatter.format(start));
        const timeLabel = timeFormatter.format(start);
        when = ` em ${dateLabel} às ${timeLabel}`;
      }
    }
    return `Tem certeza de que deseja excluir "${title}"${when}?`;
  }
  function openDeleteEventModal(key){
    const event = getEventByKey(key);
    if (!event){
      addMessage('system', 'Evento não encontrado para exclusão.', { persist: false });
      return;
    }
    closeEventContextMenu();
    pendingDeleteKey = key;
    if (deleteEventMessage) deleteEventMessage.textContent = formatEventForModal(event);
    if (deleteEventModal) deleteEventModal.hidden = false;
  }
  async function performEventDeletion(){
    const key = pendingDeleteKey;
    pendingDeleteKey = null;
    if (!key) {
      closeDeleteEventModal();
      return;
    }
    const event = getEventByKey(key);
    closeDeleteEventModal();
    closeEventContextMenu();
    if (!event){
      addMessage('system', 'Evento não encontrado para exclusão.', { persist: false });
      return;
    }
    const snapshot = { ...event };
    const normalized = { key, event: { ...event, origin: 'local' }, isDeletion: true };
    updateGoogleEvents(normalized, { persist: false });
    selectEventByKey(null);
    const cfg = loadCfg();
    try {
      await api.deleteEvent(
        {
          action: 'delete',
          eventId: event.id,
          key,
          summary: event.summary || event.title || '',
          description: event.description || '',
          start: event.start || '',
          end: event.end || '',
          link: event.link || '',
          timeZone: event.timeZone || '',
        },
        {
          url: cfg.url,
          method: cfg.method || 'POST',
          headers: cfg.auth ? { Authorization: cfg.auth } : {},
        }
      );
      const historyPayload = buildHistoryEventPayload({ key, event: { ...snapshot, key }, isDeletion: true });
      if (historyPayload){
        try {
          histAppend({
            role: 'assistant',
            kind: 'event',
            data: historyPayload,
            ts: Date.now(),
            chat: CHAT_GOOGLE,
          });
        } catch {}
      }
    } catch (err) {
      updateGoogleEvents({ key, event: { ...snapshot, origin: 'local' }, isDeletion: false }, { persist: false });
      selectEventByKey(key);
      addMessage('system', `Não foi possível excluir o evento: ${err?.message || err}`, { persist: false });
    }
  }
  function eventNodeFromTarget(target){
    if (!target || typeof target.closest !== 'function') return null;
    return target.closest('[data-event-key]');
  }
  function handleCalendarClick(ev){
    const node = eventNodeFromTarget(ev.target);
    if (!node){
      closeEventContextMenu();
      selectEventByKey(null);
      return;
    }
    const key = node.dataset.eventKey;
    if (!key) return;
    selectEventByKey(key);
    closeEventContextMenu();
  }
  function handleCalendarContextMenu(ev){
    const node = eventNodeFromTarget(ev.target);
    if (!node) return;
    const key = node.dataset.eventKey;
    if (!key) return;
    ev.preventDefault();
    selectEventByKey(key);
    openEventContextMenu(key, node, ev.clientX, ev.clientY);
  }
  function handleDocumentClick(ev){
    if (!eventContextMenu || eventContextMenu.hidden) return;
    if (eventContextMenu.contains(ev.target)) return;
    closeEventContextMenu();
  }
  function handleGlobalKeydown(ev){
    if (ev.key === 'Escape') {
      if (deleteEventModal && !deleteEventModal.hidden) {
        closeDeleteEventModal();
      }
      closeEventContextMenu();
      return;
    }
    if (ev.key !== 'Delete') return;
    if (deleteEventModal && !deleteEventModal.hidden) return;
    const tag = (ev.target?.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || ev.target?.isContentEditable) return;
    if (!selectedEventKey) return;
    ev.preventDefault();
    openDeleteEventModal(selectedEventKey);
  }
  function startOfDay(date){
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }
  function startOfWeek(date){
    const ref = startOfDay(date);
    const dow = ref.getDay();
    ref.setDate(ref.getDate() - dow);
    return ref;
  }
  function endOfWeek(date){
    const ref = startOfWeek(date);
    ref.setDate(ref.getDate() + 6);
    return ref;
  }
  function capitalize(str){
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
  const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const weekdayLongFormatter = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' });
  const weekdayShortFormatter = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' });
  const dayMonthFormatter = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long' });
  const dayMonthYearFormatter = new Intl.DateTimeFormat('pt-BR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const monthYearFormatter = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });

  function formatWeekdayLong(date){
    return capitalize(weekdayLongFormatter.format(date));
  }
  function formatWeekdayShort(date){
    return capitalize(weekdayShortFormatter.format(date));
  }
  function formatRangeLabel(mode, baseDate){
    if (!(baseDate instanceof Date) || Number.isNaN(baseDate.valueOf())) return '';
    switch (mode) {
      case 'day':
        return capitalize(dayMonthYearFormatter.format(baseDate));
      case 'week': {
        const start = startOfWeek(baseDate);
        const end = endOfWeek(baseDate);
        const startLabel = dayMonthFormatter.format(start);
        const endLabel = dayMonthYearFormatter.format(end);
        return `Semana de ${startLabel} a ${endLabel}`;
      }
      case 'month':
        return capitalize(monthYearFormatter.format(baseDate));
      case 'year':
        return String(baseDate.getFullYear());
      case 'agenda': {
        const label = dayMonthYearFormatter.format(baseDate);
        return `Programação a partir de ${capitalize(label)}`;
      }
      default:
        return capitalize(dayMonthYearFormatter.format(baseDate));
    }
  }
  function formatTimeRange(startISO, endISO){
    const start = startISO ? new Date(startISO) : null;
    const end = endISO ? new Date(endISO) : null;
    if (!start || Number.isNaN(start.valueOf())) return '';
    const startLabel = timeFormatter.format(start);
    if (!end || Number.isNaN(end.valueOf())) return startLabel;
    const endLabel = timeFormatter.format(end);
    if (startLabel === endLabel) return startLabel;
    return `${startLabel} – ${endLabel}`;
  }
  async function collectEventsFromHistory(){
    googleView.events = [];
    googleView.eventMap = new Map();
    // Tenta usar a API de histórico (persistente); fallback para localStorage
    try{
      const all = await histLoadAll();
      if (Array.isArray(all)){
        all.forEach(e => {
          const chat = e?.chat || CHAT_GOOGLE;
          if (chat !== CHAT_GOOGLE) return;
          if (e?.kind === 'event' && e?.data){
            const normalized = normalizeEventPayload(e.data);
            if (normalized) updateGoogleEvents(normalized, { persist: false, render: false, rebuildList: false });
          }
        });
        googleView.events = Array.from(googleView.eventMap.values()).sort((a, b) => {
          const ta = a && a.start ? new Date(a.start).getTime() : 0;
          const tb = b && b.start ? new Date(b.start).getTime() : 0;
          return ta - tb;
        });
        return;
      }
    }catch{}
    try{
      const all = JSON.parse(localStorage.getItem('cleoLocalHist')||'[]');
      (all||[]).forEach(e => {
        const chat = e?.chat || CHAT_GOOGLE;
        if (chat !== CHAT_GOOGLE) return;
        if (e?.kind === 'event' && e?.data){
          const normalized = normalizeEventPayload(e.data);
          if (normalized) updateGoogleEvents(normalized, { persist: false, render: false, rebuildList: false });
        }
      });
      googleView.events = Array.from(googleView.eventMap.values()).sort((a, b) => {
        const ta = a && a.start ? new Date(a.start).getTime() : 0;
        const tb = b && b.start ? new Date(b.start).getTime() : 0;
        return ta - tb;
      });
    }catch{}
  }
  function setSelectedDate(date){
    if (!(date instanceof Date) || Number.isNaN(date.valueOf())) return;
    googleView.selectedDate = ymd(date);
    googleView.monthBase = monthStart(date);
    renderMiniCalendar();
    renderGoogleEventsFeed();
  }
  function updateCalendarToolbar(){
    if (!calendarRangeEl) return;
    ensureSelectedDate();
    const base = fromYmd(googleView.selectedDate) || new Date();
    const mode = googleView.mode || 'day';
    calendarRangeEl.textContent = formatRangeLabel(mode, base);
    if (calendarViewSwitch){
      const buttons = calendarViewSwitch.querySelectorAll('.cal-view-btn');
      buttons.forEach((btn) => {
        const targetMode = btn?.dataset?.calView;
        const isActive = targetMode === mode;
        btn.classList.toggle('is-active', isActive);
        btn.setAttribute('aria-selected', String(isActive));
        btn.setAttribute('tabindex', isActive ? '0' : '-1');
      });
    }
  }
  function renderMiniCalendar(){
    ensureSelectedDate();
    if (!calRail) return;
    calRail.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'mini-cal';
    const header = document.createElement('div');
    header.className = 'cal-header';
    const monthLabel = document.createElement('div');
    monthLabel.textContent = new Intl.DateTimeFormat('pt-BR', { month:'long', year:'numeric' }).format(googleView.monthBase).replace(/^(.)/, m=>m.toUpperCase());
    const nav = document.createElement('div');
    nav.className = 'cal-nav';
    const prev = document.createElement('button'); prev.textContent = '‹';
    const next = document.createElement('button'); next.textContent = '›';
    prev.addEventListener('click', () => { googleView.monthBase = new Date(googleView.monthBase.getFullYear(), googleView.monthBase.getMonth()-1, 1); renderMiniCalendar(); });
    next.addEventListener('click', () => { googleView.monthBase = new Date(googleView.monthBase.getFullYear(), googleView.monthBase.getMonth()+1, 1); renderMiniCalendar(); });
    nav.appendChild(prev); nav.appendChild(next);
    header.appendChild(monthLabel); header.appendChild(nav);
    wrap.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'grid';
    const dows = ['D','S','T','Q','Q','S','S'];
    dows.forEach(d => { const el = document.createElement('div'); el.className='dow'; el.textContent=d; grid.appendChild(el); });
    const ms = monthStart(googleView.monthBase);
    const me = monthEnd(googleView.monthBase);
    const firstDow = ms.getDay(); // 0..6 (Domingo)
    const daysInMonth = me.getDate();
    const eventsByDay = {};
    (googleView.events||[]).forEach(ev => { const k = toDateOnly(ev.start); eventsByDay[k] = (eventsByDay[k]||0)+1; });

    // Leading blanks (prev month)
    for (let i=0;i<firstDow;i++){
      const blank = document.createElement('div'); blank.className='day out'; blank.textContent=''; grid.appendChild(blank);
    }
    for (let i=1;i<=daysInMonth;i++){
      const d = new Date(ms.getFullYear(), ms.getMonth(), i);
      const key = ymd(d);
      const el = document.createElement('div');
      el.className = 'day' + (googleView.selectedDate===key ? ' sel' : '') + (eventsByDay[key] ? ' has' : '');
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = String(i);
      el.appendChild(num);
      el.addEventListener('click', () => {
        onClickDay(new Date(d));
      });
      grid.appendChild(el);
    }
    wrap.appendChild(grid);
    calRail.appendChild(wrap);
  }
  function onClickDay(date){
    const key = ymd(date);
    // Hook opcional
    try { if (typeof window.onSelectDate === 'function') window.onSelectDate(key); } catch {}
    setSelectedDate(date);
  }
  const viewButtons = calendarViewSwitch ? Array.from(calendarViewSwitch.querySelectorAll('.cal-view-btn')) : [];
  viewButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn?.dataset?.calView;
      if (!mode || googleView.mode === mode) return;
      googleView.mode = mode;
      updateCalendarToolbar();
      renderGoogleEventsFeed();
    });
  });
  function shiftCalendar(direction){
    ensureSelectedDate();
    const base = fromYmd(googleView.selectedDate) || new Date();
    const mode = googleView.mode || 'day';
    const next = new Date(base);
    if (mode === 'week') {
      next.setDate(next.getDate() + 7 * direction);
    } else if (mode === 'month') {
      next.setMonth(next.getMonth() + direction);
    } else if (mode === 'year') {
      next.setFullYear(next.getFullYear() + direction);
    } else {
      next.setDate(next.getDate() + direction);
    }
    setSelectedDate(next);
  }
  calendarTodayBtn?.addEventListener('click', () => {
    setSelectedDate(new Date());
  });
  calendarPrevBtn?.addEventListener('click', () => shiftCalendar(-1));
  calendarNextBtn?.addEventListener('click', () => shiftCalendar(1));
  calendarBoardEl?.addEventListener('click', handleCalendarClick);
  calendarBoardEl?.addEventListener('contextmenu', handleCalendarContextMenu);
  document.addEventListener('click', handleDocumentClick);
  document.addEventListener('keydown', handleGlobalKeydown);
  window.addEventListener('resize', closeEventContextMenu);
  window.addEventListener('blur', closeEventContextMenu);
  document.addEventListener('scroll', closeEventContextMenu, true);
  eventContextMenu?.addEventListener('contextmenu', (ev) => ev.preventDefault());
  eventDeleteAction?.addEventListener('click', () => {
    const key = selectedEventKey || eventContextMenu?.dataset?.eventKey;
    if (!key) return;
    closeEventContextMenu();
    openDeleteEventModal(key);
  });
  deleteEventConfirmBtn?.addEventListener('click', (ev) => {
    ev.preventDefault();
    performEventDeletion();
  });
  deleteModalCloseEls.forEach((el) => {
    el.addEventListener('click', (ev) => {
      ev.preventDefault();
      closeDeleteEventModal();
    });
  });
  function renderGoogleEventsFeed(){
    ensureSelectedDate();
    if (!calendarBoardEl) return;

    const mode = googleView.mode || 'day';
    const baseDate = fromYmd(googleView.selectedDate) || new Date();
    const board = calendarBoardEl;
    const events = Array.isArray(googleView.events) ? googleView.events.slice() : [];
    events.sort((a, b) => {
      const aStart = a?.start ? new Date(a.start) : new Date(a?.end || 0);
      const bStart = b?.start ? new Date(b.start) : new Date(b?.end || 0);
      return aStart - bStart;
    });

    updateCalendarToolbar();

    board.dataset.mode = mode;
    board.classList.remove('empty');
    board.innerHTML = '';
    closeEventContextMenu();

    const showEmpty = (message) => {
      board.classList.add('empty');
      board.textContent = message;
      selectEventByKey(null);
    };
    const getEventDate = (ev) => {
      if (!ev || typeof ev !== 'object') return null;
      const start = ev.start ? new Date(ev.start) : null;
      if (start && !Number.isNaN(start.valueOf())) return start;
      const end = ev.end ? new Date(ev.end) : null;
      if (end && !Number.isNaN(end.valueOf())) return end;
      return null;
    };
    const getEventLink = (ev) => {
      if (!ev || typeof ev !== 'object') return '';
      const candidates = [
        ev.hangoutLink,
        ev.meetingLink,
        ev.meetingUrl,
        ev.meetingURI,
        ev.htmlLink,
        ev.link,
      ];
      const found = candidates.find((url) => typeof url === 'string' && url.startsWith('http'));
      if (found) return found;
      const entry = Array.isArray(ev?.conferenceData?.entryPoints)
        ? ev.conferenceData.entryPoints.find((p) => typeof p?.uri === 'string')
        : null;
      if (entry && entry.uri) return entry.uri;
      return '';
    };
    const buildEventCard = (ev) => {
      const card = document.createElement('div');
      card.className = 'cal-event-card';
      const eventKey = ev?.key || computeEventKey(ev) || computeEventKey(ev?.raw) || null;
      if (eventKey) card.dataset.eventKey = eventKey;
      if (ev?.title || ev?.summary) card.dataset.eventTitle = ev.title || ev.summary;
      if (ev?.start) card.dataset.eventStart = ev.start;
      if (ev?.end) card.dataset.eventEnd = ev.end;
      card.tabIndex = 0;
      const time = document.createElement('div');
      time.className = 'cal-event-time';
      time.textContent = formatTimeRange(ev?.start, ev?.end) || 'Dia todo';
      const title = document.createElement('div');
      title.className = 'cal-event-title';
      title.textContent = ev?.title || ev?.summary || 'Evento';
      const descText = ev?.description || ev?.descricao || ev?.notes || '';
      if (time.textContent) card.appendChild(time);
      card.appendChild(title);
      if (descText){
        const desc = document.createElement('div');
        desc.className = 'cal-event-desc';
        desc.textContent = descText;
        card.appendChild(desc);
      }
      const link = getEventLink(ev);
      if (link){
        const anchor = document.createElement('a');
        anchor.className = 'cal-event-link';
        anchor.href = link;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.textContent = 'Abrir conferência';
        card.appendChild(anchor);
      }
      return card;
    };

    const eventsByDay = new Map();
    events.forEach((ev) => {
      const when = getEventDate(ev);
      if (!when) return;
      const key = ymd(when);
      const list = eventsByDay.get(key) || [];
      list.push(ev);
      eventsByDay.set(key, list);
    });
    eventsByDay.forEach((list, key) => {
      list.sort((a, b) => {
        const aStart = a?.start ? new Date(a.start) : new Date(a?.end || 0);
        const bStart = b?.start ? new Date(b.start) : new Date(b?.end || 0);
        return aStart - bStart;
      });
    });

    if (mode === 'day') {
      const key = ymd(baseDate);
      const dayEvents = eventsByDay.get(key) || [];
      if (!dayEvents.length) {
        showEmpty(`Sem eventos em ${formatRangeLabel('day', baseDate)}.`);
        return;
      }
      const wrap = document.createElement('div');
      wrap.className = 'cal-event-day';
      const header = document.createElement('div');
      header.className = 'cal-event-day-header';
      const label = document.createElement('span');
      label.textContent = `${formatWeekdayLong(baseDate)} • ${capitalize(dayMonthFormatter.format(baseDate))}`;
      const count = document.createElement('span');
      count.textContent = dayEvents.length === 1 ? '1 evento' : `${dayEvents.length} eventos`;
      header.appendChild(label);
      header.appendChild(count);
      const stack = document.createElement('div');
      stack.className = 'cal-event-stack';
      dayEvents.forEach((ev) => stack.appendChild(buildEventCard(ev)));
      wrap.appendChild(header);
      wrap.appendChild(stack);
      board.appendChild(wrap);
      applySelectionToBoard();
      return;
    }

    if (mode === 'week') {
      const startWeek = startOfWeek(baseDate);
      const fragment = document.createDocumentFragment();
      for (let i = 0; i < 7; i++){
        const day = new Date(startWeek.getFullYear(), startWeek.getMonth(), startWeek.getDate() + i);
        const dayKey = ymd(day);
        const list = eventsByDay.get(dayKey) || [];
        const column = document.createElement('div');
        column.className = 'cal-week-day';
        const header = document.createElement('div');
        header.className = 'cal-week-day-header';
        const name = document.createElement('span');
        name.textContent = formatWeekdayShort(day);
        const num = document.createElement('span');
        num.textContent = day.getDate();
        header.appendChild(name);
        header.appendChild(num);
        column.appendChild(header);
        if (!list.length){
          const empty = document.createElement('div');
          empty.className = 'cal-week-empty';
          empty.textContent = 'Sem eventos';
          column.appendChild(empty);
        } else {
          list.forEach((ev) => column.appendChild(buildEventCard(ev)));
        }
        fragment.appendChild(column);
      }
      board.appendChild(fragment);
      applySelectionToBoard();
      return;
    }

    if (mode === 'month') {
      const monthAnchor = monthStart(baseDate);
      const gridStart = startOfWeek(monthAnchor);
      const totalCells = 42; // 6 semanas
      for (let i = 0; i < totalCells; i++){
        const day = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
        const key = ymd(day);
        const cell = document.createElement('div');
        cell.className = 'cal-month-cell';
        if (day.getMonth() !== monthAnchor.getMonth()) cell.classList.add('is-out');
        const label = document.createElement('div');
        label.className = 'cal-month-date';
        label.textContent = day.getDate();
        cell.appendChild(label);
        const list = eventsByDay.get(key) || [];
        list.slice(0, 3).forEach((ev) => {
          const mini = document.createElement('div');
          mini.className = 'cal-mini-event';
          const timeLabel = formatTimeRange(ev?.start, ev?.end);
          const title = ev?.title || ev?.summary || 'Evento';
          mini.textContent = timeLabel ? `${timeLabel} • ${title}` : title;
          const keyChip = ev?.key || computeEventKey(ev) || computeEventKey(ev?.raw) || null;
          if (keyChip) mini.dataset.eventKey = keyChip;
          if (ev?.title || ev?.summary) mini.dataset.eventTitle = title;
          if (ev?.start) mini.dataset.eventStart = ev.start;
          if (ev?.end) mini.dataset.eventEnd = ev.end;
          mini.tabIndex = 0;
          cell.appendChild(mini);
        });
        if (list.length > 3){
          const extra = document.createElement('div');
          extra.className = 'cal-mini-event';
          extra.textContent = `+${list.length - 3} eventos`;
          cell.appendChild(extra);
        }
        board.appendChild(cell);
      }
      applySelectionToBoard();
      return;
    }

    if (mode === 'year') {
      const targetYear = baseDate.getFullYear();
      for (let month = 0; month < 12; month++){
        const monthDate = new Date(targetYear, month, 1);
        const label = document.createElement('div');
        label.className = 'cal-year-month';
        const title = document.createElement('strong');
        title.textContent = capitalize(new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(monthDate));
        const summary = document.createElement('span');
        const count = events.filter((ev) => {
          const when = getEventDate(ev);
          return when && when.getFullYear() === targetYear && when.getMonth() === month;
        }).length;
        summary.textContent = count ? `${count} evento${count > 1 ? 's' : ''}` : 'Sem eventos';
        label.appendChild(title);
        label.appendChild(summary);
        board.appendChild(label);
      }
      applySelectionToBoard();
      return;
    }

    // Agenda (lista)
    const agendaStart = startOfDay(baseDate);
    const agendaItems = events.filter((ev) => {
      const when = getEventDate(ev);
      return when && when >= agendaStart;
    });
    if (!agendaItems.length){
      showEmpty(`Sem eventos na programação após ${formatRangeLabel('day', baseDate)}.`);
      return;
    }
    agendaItems.forEach((ev) => {
      const when = getEventDate(ev) || agendaStart;
      const item = document.createElement('div');
      item.className = 'cal-agenda-item';
      const key = ev?.key || computeEventKey(ev) || computeEventKey(ev?.raw) || null;
      if (key) item.dataset.eventKey = key;
      if (ev?.title || ev?.summary) item.dataset.eventTitle = ev.title || ev.summary;
      if (ev?.start) item.dataset.eventStart = ev.start;
      if (ev?.end) item.dataset.eventEnd = ev.end;
      item.tabIndex = 0;
      const dateBox = document.createElement('div');
      dateBox.className = 'agenda-date';
      const dow = document.createElement('div');
      dow.textContent = formatWeekdayShort(when);
      const dayText = document.createElement('div');
      dayText.textContent = capitalize(dayMonthYearFormatter.format(when));
      dateBox.appendChild(dow);
      dateBox.appendChild(dayText);
      const main = document.createElement('div');
      main.className = 'agenda-main';
      const title = document.createElement('div');
      title.className = 'agenda-title';
      title.textContent = ev?.title || ev?.summary || 'Evento';
      const time = document.createElement('div');
      time.className = 'agenda-time';
      time.textContent = formatTimeRange(ev?.start, ev?.end) || 'Dia todo';
      main.appendChild(title);
      main.appendChild(time);
      if (ev?.description){
        const desc = document.createElement('div');
        desc.className = 'cal-event-desc';
        desc.textContent = ev.description;
        main.appendChild(desc);
      }
      const link = getEventLink(ev);
      if (link){
        const anchor = document.createElement('a');
        anchor.className = 'agenda-link';
        anchor.href = link;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.textContent = 'Abrir conferência';
        main.appendChild(anchor);
      }
      item.appendChild(dateBox);
      item.appendChild(main);
      board.appendChild(item);
    });
    applySelectionToBoard();
  }

  function renderAttachPreview(){
    const attachPreview = document.getElementById('attach-preview');
    if (!attachPreview) return;
    attachPreview.innerHTML = '';
    const mk = (tag, cls) => { const el = document.createElement(tag); if (cls) el.className = cls; return el; };
    pendingFiles.forEach((pf, idx) => {
      const isVideo = pf.fileKind === 'video';
      const chip = mk('div', `attach-chip ${pf.fileKind||''}`);
      const previewWrap = mk('div', 'chip-preview');
      if (isVideo && pf.poster){
        const img = document.createElement('img');
        img.src = pf.poster;
        img.alt = pf.name;
        previewWrap.appendChild(img);
      } else {
        previewWrap.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><rect x="3" y="3" width="18" height="14" rx="2" fill="currentColor"></rect><path d="M8 15l3-4 3 4" stroke="#1f2937" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
      }
      const metaWrap = mk('div', 'chip-meta');
      const name = mk('div', 'chip-name');
      name.textContent = pf.name;
      const size = mk('div', 'chip-size');
      size.textContent = pf.sizeLabel;
      metaWrap.appendChild(name);
      metaWrap.appendChild(size);
      const rm = mk('button', 'chip-remove');
      rm.setAttribute('aria-label', 'Remover');
      rm.innerText = '✕';
      rm.addEventListener('click', () => {
        pendingFiles.splice(idx, 1);
        renderAttachPreview();
      });
      chip.appendChild(previewWrap);
      chip.appendChild(metaWrap);
      chip.appendChild(rm);
      attachPreview.appendChild(chip);
    });
  }

  // Garante que o preview comece limpo ao iniciar
  try {
    renderAttachPreview();
  } catch {}

  // Config helpers (per-chat)
  function loadCfgByChat(chat) {
    try {
      const all = JSON.parse(localStorage.getItem('cleoCfgByChat') || '{}');
      return all[chat] || {};
    } catch { return {}; }
  }
  function saveCfgByChat(chat, cfg) {
    try {
      const all = JSON.parse(localStorage.getItem('cleoCfgByChat') || '{}');
      all[chat] = cfg || {};
      localStorage.setItem('cleoCfgByChat', JSON.stringify(all));
    } catch {}
  }
  function loadCfg() {
    // Migrate legacy single cfg → google
    try {
      const allRaw = localStorage.getItem('cleoCfgByChat');
      if (!allRaw) {
        const legacy = JSON.parse(localStorage.getItem('cleoCfg') || '{}');
        const seed = {};
        if (legacy && Object.keys(legacy).length) seed[CHAT_GOOGLE] = legacy;
        localStorage.setItem('cleoCfgByChat', JSON.stringify(seed));
        localStorage.removeItem('cleoCfg');
      }
    } catch {}
    // Ensure Decupagem default URL exists
    try {
      const all = JSON.parse(localStorage.getItem('cleoCfgByChat') || '{}');
      if (!all[CHAT_DECUPAGEM] || !all[CHAT_DECUPAGEM].url) {
        all[CHAT_DECUPAGEM] = {
          ...(all[CHAT_DECUPAGEM] || {}),
          url: 'https://whats-bot-n8n.6pqq0m.easypanel.host/webhook/c6968886-e12e-44e3-ac42-816cfe6c0bce',
          method: (all[CHAT_DECUPAGEM]?.method) || 'POST',
        };
        localStorage.setItem('cleoCfgByChat', JSON.stringify(all));
      }
    } catch {}
    return loadCfgByChat(activeChat);
  }
  function saveCfg(cfg) {
    saveCfgByChat(activeChat, cfg || {});
  }

  // Mock API to simulate REST (POST/GET)
  const api = {
    async getMessages() {
      return [];
    },
    async postMessage(userText) {
      // Simula latência e resposta da assistente
      await wait(500 + Math.random() * 600);
      const canned = [
        `Olá! Eu sou a Cléo. Como posso ajudar?`,
        `Entendi. Posso detalhar propostas, atualizar agenda e consultar dados quando integrar ao n8n.`,
        `Perfeito! Se quiser, descreva sua necessidade que eu preparo uma resposta.`,
      ];
      const pick = canned[Math.floor(Math.random() * canned.length)];
      // Simula um pequeno eco contextual
      const suffix = userText?.trim()
        ? `\n\nVocê disse: “${truncate(userText, 120)}”`
        : "";
      return `${pick}${suffix}`;
    },
    async scheduleMeeting(payload, options) {
      if (!window.cleo || !window.cleo.scheduleMeeting) {
        throw new Error("Integração n8n não disponível");
      }
      return window.cleo.scheduleMeeting(payload, options);
    },
    async deleteEvent(payload, options) {
      if (!window.cleo || !window.cleo.deleteEvent) {
        throw new Error('Integração n8n não disponível');
      }
      return window.cleo.deleteEvent(payload, options);
    },
    async generateFfmpegCommand(payload) {
      if (window.cleo?.ffmpeg?.generateCommand) {
        return window.cleo.ffmpeg.generateCommand(payload);
      }
      if (window.cleo?.openai?.ffmpegCommand) {
        return window.cleo.openai.ffmpegCommand(payload);
      }
      throw new Error('Integração do ChatGPT não disponível');
    },
    async processVideoFFmpeg(payload) {
      if (!window.cleo || !window.cleo.ffmpeg || typeof window.cleo.ffmpeg.processVideo !== 'function') {
        throw new Error('Integração FFmpeg não disponível');
      }
      return window.cleo.ffmpeg.processVideo(payload);
    },
  };

  function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
  function truncate(s, n) {
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }
  function pad(n) {
    return n.toString().padStart(2, "0");
  }
  function toDateISOFromBR(br) {
    const m = (br || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    const d = parseInt(m[1], 10),
      mo = parseInt(m[2], 10),
      y = parseInt(m[3], 10);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${pad(mo)}-${pad(d)}`;
  }
  function toBRFromISO(iso) {
    if (!iso) return "";
    const [y, mo, d] = iso.split("-");
    if (!y || !mo || !d) return "";
    return `${pad(parseInt(d, 10))}/${pad(parseInt(mo, 10))}/${y}`;
  }

  // Global settings (e.g., hist limit)
  function globalCfgLoad(){
    // Migrate legacy histLimit from cleoCfg → cleoCfgGlobal
    try{
      const g = JSON.parse(localStorage.getItem('cleoCfgGlobal')||'{}');
      if (g && Object.prototype.hasOwnProperty.call(g,'histLimit')) return g;
      const legacy = JSON.parse(localStorage.getItem('cleoCfg')||'{}');
      if (legacy && Object.prototype.hasOwnProperty.call(legacy,'histLimit')){
        const out = { histLimit: legacy.histLimit };
        localStorage.setItem('cleoCfgGlobal', JSON.stringify(out));
        return out;
      }
    }catch{}
    return {};
  }
  function globalCfgSave(cfg){
    try{ localStorage.setItem('cleoCfgGlobal', JSON.stringify(cfg||{})); }catch{}
  }
  function histLimit(){
    try{ const g = globalCfgLoad(); return parseInt((g.histLimit ?? '500'),10)||500; }catch{ return 500; }
  }

  // History helpers (bridge or localStorage fallback)
  async function histLoadAll(){
    try{
      if (window.cleo?.history?.load){
        const hist = await window.cleo.history.load();
        return Array.isArray(hist) ? hist : [];
      }
    }catch{}
    // Fallback: localStorage
    try{ return JSON.parse(localStorage.getItem('cleoLocalHist')||'[]'); }catch{ return []; }
  }
  function histSaveAll(list){
    try{
      if (!window.cleo?.history?.load){
        localStorage.setItem('cleoLocalHist', JSON.stringify(list||[]));
      }
    }catch{}
  }
  function histAppend(entry){
    const limit = histLimit();
    try{
      if (window.cleo?.history?.append){
        return window.cleo.history.append(entry, { limit });
      }
    }catch{}
    // Fallback local
    const all = Array.isArray(JSON.parse(localStorage.getItem('cleoLocalHist')||'[]'))
      ? JSON.parse(localStorage.getItem('cleoLocalHist')||'[]')
      : [];
    all.push(entry);
    while (all.length > limit) all.shift();
    histSaveAll(all);
  }

  function addMessage(role, text, opts) {
    const options = opts || {};
    const msg = { id: Date.now() + Math.random(), role, text };
    messages.push(msg);
    renderMessage(msg);
    scrollToBottom();
    try{
      if (options.persist !== false && role !== 'system'){
        histAppend({ role, kind:'text', text, ts: Date.now(), chat: activeChat });
      }
    }catch{}
    return msg;
  }

  function renderMessage(msg) {
    // Mensagens de sistema: linha simples, sem balão
    if (msg.role === 'system') {
      const line = document.createElement('div');
      line.className = 'system-line';
      line.textContent = msg.text;
      messagesEl.appendChild(line);
      return;
    }

    const wrap = document.createElement("div");
    wrap.className = `msg ${msg.role}`;

    const bubble = document.createElement("div");
    bubble.className = "bubble";

    const text = document.createElement("div");
    text.textContent = msg.text;
    bubble.appendChild(text);

    wrap.appendChild(bubble);
    messagesEl.appendChild(wrap);
  }

  // Divider helper (between same-kind info blocks)
  function addChatDivider(kind) {
    try{
      if (!messagesEl) return;
      // Procura o último item relevante (ignora divisores e linhas de sistema)
      let last = messagesEl.lastElementChild;
      while (last && (last.classList?.contains('chat-divider') || !last.dataset?.kind)) {
        last = last.previousElementSibling;
      }
      const lastKind = last?.dataset?.kind || null;
      if (lastKind && kind && lastKind === kind) {
        const div = document.createElement('div');
        div.className = 'chat-divider';
        messagesEl.appendChild(div);
      }
    }catch{}
  }

  function renderFileMessage(role, meta){
    addChatDivider('decupagem');
    const wrap = document.createElement('div');
    wrap.className = `msg ${role}`;
    try { wrap.dataset.kind = 'decupagem'; } catch {}
    const bubble = document.createElement('div');
    bubble.className = 'bubble';

    const card = document.createElement('div');
    const kind = meta.fileKind || 'doc';
    card.className = `file-card ${kind}`;
    const icon = document.createElement('div');
    icon.className = 'file-icon';
    icon.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" fill="currentColor" stroke="none"></path><path d="M14 3v5h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;
    const metaBox = document.createElement('div');
    metaBox.className = 'file-meta';
    const nameEl = document.createElement('div');
    nameEl.className = 'file-name';
    nameEl.textContent = meta.name || '(arquivo)';
    const sizeEl = document.createElement('div');
    sizeEl.className = 'file-size';
    const kindLabel = (kind || '').toUpperCase();
    sizeEl.textContent = [kindLabel, meta.sizeLabel].filter(Boolean).join(' • ');

    metaBox.appendChild(nameEl);
    metaBox.appendChild(sizeEl);
    card.appendChild(icon);
    card.appendChild(metaBox);
    bubble.appendChild(card);
    wrap.appendChild(bubble);
    messagesEl.appendChild(wrap);
    scrollToBottom();
    lastDividerKind = 'decupagem';
    return wrap;
  }

  // Loaders para o fluxo de Decupagem
  const decupagemLoaders = [];
  function addDecLoaderAfter(node){
    try{
      const line = document.createElement('div');
      line.className = 'loader-line';
      const spin = document.createElement('div');
      spin.className = 'spinner';
      const text = document.createElement('div');
      text.textContent = 'Decupagem em andamento…';
      line.appendChild(spin);
      line.appendChild(text);
      // Garante que o loader fique sempre dentro da lista de mensagens
      if (messagesEl && node && node.parentNode === messagesEl) {
        messagesEl.insertBefore(line, node.nextSibling);
      } else if (messagesEl) {
        messagesEl.appendChild(line);
      } else if (node && node.parentNode) {
        node.parentNode.insertBefore(line, node.nextSibling);
      }
      decupagemLoaders.push(line);
      scrollToBottom();
      return line;
    }catch{}
    return null;
  }
  function clearDecLoaders(){
    try{
      while (decupagemLoaders.length){
        const el = decupagemLoaders.pop();
        el?.parentNode?.removeChild?.(el);
      }
    }catch{}
  }

  // Loader específico para agendamento (Google Agenda)
  const scheduleLoaders = [];
  let scheduleDelayUntil = 0;
  let schedulePending = [];
  let scheduleFlushTimer = null;
  function addScheduleLoader(){
    const line = document.createElement('div');
    line.className = 'loader-line';
    const spin = document.createElement('div');
    spin.className = 'spinner';
    const text = document.createElement('div');
    text.textContent = 'Agendando...';
    line.appendChild(spin);
    line.appendChild(text);
    messagesEl.appendChild(line);
    scrollToBottom();
    scheduleLoaders.push(line);
    return line;
  }
  function clearScheduleLoaders(){
    while (scheduleLoaders.length){
      const el = scheduleLoaders.pop();
      el?.parentNode?.removeChild?.(el);
    }
  }
  function scheduleFlush(){
    if (scheduleFlushTimer) { clearTimeout(scheduleFlushTimer); scheduleFlushTimer = null; }
    const wait = Math.max(0, scheduleDelayUntil - Date.now());
    scheduleFlushTimer = setTimeout(() => {
      clearScheduleLoaders();
      const items = schedulePending.slice();
      schedulePending = [];
      for (const msg of items){
        if (activeChat === CHAT_GOOGLE) {
          const normalized = normalizeEventPayload(msg);
          if (normalized) updateGoogleEvents(normalized, { persist: false });
        }
      }
    }, wait);
  }

  // (Google Agenda loader desativado por solicitação)

  function renderFfmpegResult(result){
    if (!messagesEl) return;
    addChatDivider('ffmpeg');
    const wrap = document.createElement('div');
    wrap.className = 'msg assistant';
    try { wrap.dataset.kind = 'ffmpeg'; } catch {}
    const bubble = document.createElement('div');
    bubble.className = 'bubble';

    const heading = document.createElement('div');
    heading.textContent = '🎬 FFmpeg';
    heading.style.fontWeight = '600';
    heading.style.marginBottom = '6px';
    bubble.appendChild(heading);

    const addRow = (label, value, node) => {
      if (!value && !node) return;
      const row = document.createElement('div');
      const strong = document.createElement('span');
      strong.style.color = 'var(--muted)';
      strong.textContent = `${label} `;
      row.appendChild(strong);
      if (node) row.appendChild(node);
      else {
        const span = document.createElement('span');
        span.textContent = value;
        row.appendChild(span);
      }
      bubble.appendChild(row);
    };

    addRow('Arquivo:', result?.videoName || '(desconhecido)');
    const sizeLabel = result?.videoSizeLabel || (typeof result?.videoSize === 'number' ? formatFileSize(result.videoSize) : '');
    if (sizeLabel) addRow('Tamanho:', sizeLabel);

    if (result?.mode === 'custom') {
      if (result?.description) addRow('Descrição:', result.description);
      if (result?.command){
        const pre = document.createElement('pre');
        pre.textContent = result.command;
        pre.style.whiteSpace = 'pre-wrap';
        pre.style.margin = '6px 0';
        addRow('Comando:', '', pre);
      }
      const outputs = Array.isArray(result?.outputs) ? result.outputs : [];
      if (outputs.length){
        const list = document.createElement('ul');
        list.style.margin = '4px 0 6px';
        list.style.paddingLeft = '18px';
        outputs.slice(0, 10).forEach((file) => {
          const item = document.createElement('li');
          item.textContent = file;
          list.appendChild(item);
        });
        if (outputs.length > 10){
          const extra = document.createElement('li');
          extra.textContent = `… +${outputs.length - 10} arquivos`;
          list.appendChild(extra);
        }
        addRow('Saídas:', '', list);
      }
      if (!outputs.length && result?.description){
        addRow('Observação:', 'O comando foi executado, mas nenhum arquivo foi encontrado no diretório de saída.');
      }
    } else {
      if (typeof result?.frameCount === 'number') addRow('Frames extraídos:', String(result.frameCount));
      if (typeof result?.frameCount === 'number' && result.frameCount === 0) {
        addRow('Observação:', 'Nenhuma mudança de cena identificada com o limiar atual.');
      }
      const frames = Array.isArray(result?.frames) ? result.frames : [];
      if (frames.length){
        const preview = frames.slice(0, 5).join(', ');
        addRow('Prévia:', preview + (frames.length > 5 ? '…' : ''));
        if (result?.framesTruncated || frames.length > 50) {
          addRow('Observação:', 'Lista de frames truncada para exibição. Consulte a pasta para todos os arquivos.');
        }
      } else {
        addRow('Observação:', 'Nenhuma mudança de cena identificada com o limiar atual.');
      }
      if (result?.description) addRow('Descrição:', result.description);
    }

    if (result?.outputDir){
      const btn = document.createElement('button');
      btn.className = 'btn ghost';
      btn.textContent = result?.mode === 'scene-detect' ? 'Abrir pasta de frames' : 'Abrir pasta de saída';
      btn.addEventListener('click', () => {
        const tryOpen = async () => {
          const paths = [];
          if (result.outputDirUrl) paths.push(result.outputDirUrl);
          if (result.outputDir) {
            if (result.outputDir.startsWith('file://')) paths.push(result.outputDir);
            else paths.push(`file://${encodeURI(result.outputDir)}`);
          }
          const outputs = Array.isArray(result?.outputs) ? result.outputs : [];
          if (outputs.length && result.outputDir){
            const first = outputs[0];
            const full = pathJoin(result.outputDir, first);
            paths.push(`file://${encodeURI(full)}`);
          }
          if (window.cleo?.openExternal){
            for (const target of paths){
              try {
                await window.cleo.openExternal(target);
                return;
              } catch {}
            }
          }
          addMessage('system', 'Não foi possível abrir a pasta. Abra manualmente via Finder/Explorer.', { persist:false });
        };
        tryOpen();
      });
      addRow('Saídas em:', result.outputDir, btn);
    }

    wrap.appendChild(bubble);
    messagesEl.appendChild(wrap);
    scrollToBottom();
  }


  function renderDecupagemResult(result){
    addChatDivider('decupagem');
    clearDecLoaders();
    const norm = (s) => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
    const pickTitleFlexible = (o) => {
      if (!o || typeof o !== 'object') return '';
      // Chaves explícitas comuns
      const direct = o.title || o.titulo || o.tituloDecupagem || o.Titulo || o['Título da Decupagem'] || o['Título'] || o['Titulo da Decupagem'] || '';
      if (direct) return direct;
      // Fallback: normaliza chaves
      for (const k of Object.keys(o)){
        const nk = norm(k);
        if (nk === 'titulodadecupagem' || nk === 'titulo') return o[k];
      }
      return '';
    };
    const title = pickTitleFlexible(result);
    const linkRaw = result?.spreadsheetUrl || result?.[' spreadsheetUrl'] || '';
    const link = typeof linkRaw === 'string' ? linkRaw.trim() : '';
    const wrap = document.createElement('div');
    wrap.className = 'msg assistant';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';

    const heading = document.createElement('div');
    heading.textContent = 'Decupagem';
    heading.style.marginBottom = '6px';
    heading.style.fontWeight = '600';
    bubble.appendChild(heading);

    const addRow = (label, value, node) => {
      const row = document.createElement('div');
      const b = document.createElement('span');
      b.style.color = 'var(--muted)';
      b.textContent = `${label} `;
      row.appendChild(b);
      if (node) row.appendChild(node);
      else {
        const v = document.createElement('span');
        v.textContent = value || '—';
        row.appendChild(v);
      }
      bubble.appendChild(row);
    };

    if (title) addRow('Título da Decupagem:', title);
    if (link) {
      const a = document.createElement('a');
      a.href = link;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.className = 'meet-link';
      a.textContent = link;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.cleo && typeof window.cleo.openExternal === 'function') {
          window.cleo.openExternal(link);
        } else {
          window.open(link, '_blank', 'noopener');
        }
      });
      addRow('Link da Planilha:', '', a);
    }

    wrap.appendChild(bubble);
    try { wrap.dataset.kind = 'decupagem'; } catch {}
    messagesEl.appendChild(wrap);
    scrollToBottom();
    lastDividerKind = 'decupagem';
  }

  // Helpers para extrair resultado do Decupagem de respostas variadas
  function toDecupagemResult(payload){
    try{
      const norm = (s) => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
      const pickTitle = (o) => {
        if (!o || typeof o !== 'object') return '';
        const direct = o.title || o.titulo || o.tituloDecupagem || o.Titulo || o['Título da Decupagem'] || o['Título'] || o['Titulo da Decupagem'] || '';
        if (direct) return direct;
        for (const k of Object.keys(o)){
          const nk = norm(k);
          if (nk === 'titulodadecupagem' || nk === 'titulo') return o[k];
        }
        return '';
      };
      const pickSheet = (o) => {
        if (!o || typeof o !== 'object') return '';
        // aceita variações, inclusive chave com espaço inicial
        let v = o.spreadsheetUrl ?? o[' spreadsheetUrl'] ?? '';
        if (!v){
          // fallback: busca chave normalizada contendo 'spreadsheeturl'
          for (const k of Object.keys(o)){
            if (norm(k) === 'spreadsheeturl') { v = o[k]; break; }
          }
        }
        return typeof v === 'string' ? v.trim() : '';
      };
      const fromObj = (o) => {
        const sheet = pickSheet(o);
        const title = pickTitle(o);
        if (sheet || title) return { title, spreadsheetUrl: sheet };
        return null;
      };
      if (Array.isArray(payload)){
        // Procura o primeiro item com spreadsheetUrl
        for (const item of payload){
          const r = fromObj(item);
          if (r && r.spreadsheetUrl) return r;
        }
        // Se nenhum tem link, usa o primeiro item para título
        return fromObj(payload[0]);
      }
      if (payload && typeof payload === 'object'){
        // Alguns webhooks retornam { data: [...] }
        if (Array.isArray(payload.data)) return toDecupagemResult(payload.data);
        if (Array.isArray(payload.payload)) return toDecupagemResult(payload.payload);
        return fromObj(payload);
      }
    }catch{}
    return null;
  }

  function scrollToBottom() {
    messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: "smooth" });
  }

  // Carrega histórico do chat ativo
  async function renderHistoryForChat(chat){
    let rendered = 0;
    try{
      const hist = await histLoadAll();
      if (Array.isArray(hist)){
        lastDividerKind = null;
        for (const entry of hist){
          const hasChat = entry && Object.prototype.hasOwnProperty.call(entry, 'chat');
          const eChat = hasChat ? entry.chat : chat; // itens antigos (sem chat) aparecem no chat atual
          if (eChat !== chat) continue;
          if (entry?.kind === 'event'){
            appendChatMessage(entry.data);
            rendered++;
          } else if (entry?.kind === 'file' && entry?.role){
            renderFileMessage(entry.role, entry.meta || {});
            rendered++;
          } else if (entry?.kind === 'decupagemResult' && entry?.data){
            renderDecupagemResult(entry.data);
            rendered++;
          } else if (entry?.kind === 'ffmpegResult' && entry?.data){
            renderFfmpegResult(entry.data);
            rendered++;
          } else if (typeof entry?.text === 'string' && entry?.role){
            addMessage(entry.role, entry.text, { persist:false });
            lastDividerKind = null;
            rendered++;
          }
        }
        scrollToBottom();
      }
    }catch{}
    return rendered;
  }

  (async function loadHistory(){
    if (messagesEl) messagesEl.innerHTML = '';
    lastDividerKind = null;
    clearDecLoaders();
    const count = await renderHistoryForChat(activeChat);
    try{
      const p = await window.cleo?.history?.path?.();
      if (typeof p === 'string' && !count){
        addMessage('system', `Histórico vazio em: ${p}`, { persist:false });
      }
    }catch{}
  })();

  // Recebe respostas do webhook (bridge) e renderiza no chat correto
  if (window.cleo && typeof window.cleo.receive === "function") {
    window.cleo.receive("chat:reply", (mensagem) => {
      const targetChat = (mensagem && typeof mensagem === 'object' && mensagem.chat) ? mensagem.chat : activeChat;
      // Detecta resposta do Decupagem (título/planilha)
      if (targetChat === CHAT_DECUPAGEM){
        const dec = toDecupagemResult(mensagem);
        if (dec && (dec.spreadsheetUrl || dec.title)){
          try{ histAppend({ role:'assistant', kind:'decupagemResult', data: dec, ts: Date.now(), chat: targetChat }); }catch{}
          if (targetChat === activeChat) renderDecupagemResult(dec);
          return;
        }
      }
      // Resposta de agendamento (Google) com atraso de 5s quando loader estiver ativo
      if (targetChat === CHAT_GOOGLE && mensagem && typeof mensagem === 'object'){
        const normalized = normalizeEventPayload(mensagem);
        if (normalized && normalized.key){
          const shouldPersist = normalized.isDeletion && !normalized.event?.ack;
          updateGoogleEvents(normalized, { persist: shouldPersist });
          if (normalized.isDeletion) selectEventByKey(null);
          return;
        }
      }
      // Padrão: evento genérico
      try{ histAppend({ role:'assistant', kind:'event', data: mensagem, ts: Date.now(), chat: targetChat }); }catch{}
      if (targetChat === activeChat) appendChatMessage(mensagem);
    });
  }

  // Apply initial chat selection UI
  function applyActiveChatUI(){
    try{
      folderGoogleBtn?.classList.toggle('selected', activeChat === CHAT_GOOGLE);
      folderDecupagemBtn?.classList.toggle('selected', activeChat === CHAT_DECUPAGEM);
      folderFfmpegBtn?.classList.toggle('selected', activeChat === CHAT_FFMPEG);
      folderChatekBtn?.classList.toggle('selected', activeChat === CHAT_CHATEK);
      // Marca body com a classe do chat ativo para estilizar a toolbar
      document.body.classList.toggle('chat-google', activeChat === CHAT_GOOGLE);
      document.body.classList.toggle('chat-decupagem', activeChat === CHAT_DECUPAGEM);
      document.body.classList.toggle('chat-ffmpeg', activeChat === CHAT_FFMPEG);
      document.body.classList.toggle('chat-chatek', activeChat === CHAT_CHATEK);
      // Mostra/oculta o mini calendário para Google Agenda
      if (calRail) calRail.hidden = activeChat !== CHAT_GOOGLE;
      if (calendarPane) calendarPane.hidden = activeChat !== CHAT_GOOGLE;
      if (activeChat === CHAT_GOOGLE){
        (async () => {
          await collectEventsFromHistory();
          renderMiniCalendar();
          renderGoogleEventsFeed();
        })();
      }
      // Controla o BrowserView no processo principal
      try {
        if (activeChat === CHAT_CHATEK) {
          window.cleo?.chatek?.show('http://localhost:8065');
          syncSidebarWidth();
      } else {
        window.cleo?.chatek?.hide?.();
      }
      } catch {}
      if (attachBtn) {
        const isDec = activeChat === CHAT_DECUPAGEM;
        const isFfmpeg = activeChat === CHAT_FFMPEG;
        attachBtn.disabled = !(isDec || isFfmpeg);
        const title = isDec
          ? 'Anexar arquivo'
          : isFfmpeg
          ? 'Enviar vídeo'
          : 'Disponível apenas nos chats Decupagem e FFmpeg';
        attachBtn.title = title;
        attachBtn.setAttribute('aria-label', title);
      }
      if (fileInput) {
        if (activeChat === CHAT_DECUPAGEM) {
          fileInput.accept = '.doc,.docx,.pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf';
        } else if (activeChat === CHAT_FFMPEG) {
          fileInput.accept = 'video/*';
        } else {
          fileInput.accept = '';
        }
      }
      if (activeChat !== CHAT_DECUPAGEM) {
        pendingFiles.splice(0, pendingFiles.length);
        renderAttachPreview();
      }
    }catch{}
  }
  applyActiveChatUI();

  function switchChat(chat){
    if (chat !== CHAT_GOOGLE && chat !== CHAT_DECUPAGEM && chat !== CHAT_CHATEK && chat !== CHAT_FFMPEG) return;
    if (chat === activeChat) return;
    activeChat = chat;
    try { localStorage.setItem('cleoActiveChat', activeChat); } catch {}
    // Clear and render selected chat history
    if (messagesEl) messagesEl.innerHTML = '';
    lastDividerKind = null;
    clearDecLoaders();
    if (activeChat !== CHAT_CHATEK) {
      renderHistoryForChat(activeChat);
    }
    addMessage('system',
      chat === CHAT_GOOGLE
        ? 'Chat: Google Agenda'
        : chat === CHAT_DECUPAGEM
        ? 'Chat: Decupagem'
        : chat === CHAT_FFMPEG
        ? 'Chat: FFmpeg'
        : 'Chat: ChatEK (Mattermost)',
      { persist:false }
    );
    applyActiveChatUI();
    // Limpa loaders de agendamento ao trocar de chat
    clearScheduleLoaders();
    closeEventContextMenu();
    selectEventByKey(null);
  }

  folderGoogleBtn?.addEventListener('click', () => switchChat(CHAT_GOOGLE));
  folderDecupagemBtn?.addEventListener('click', () => switchChat(CHAT_DECUPAGEM));
  folderFfmpegBtn?.addEventListener('click', () => switchChat(CHAT_FFMPEG));
  folderChatekBtn?.addEventListener('click', () => switchChat(CHAT_CHATEK));

  // Informa a largura da sidebar ao main para posicionar o BrowserView
  function syncSidebarWidth(){
    const collapsed = document.body.classList.contains('sidebar-collapsed');
    const w = collapsed ? 64 : 224; // manter em sincronia com o CSS
    try { window.cleo?.chatek?.setSidebarWidth?.(w); } catch {}
  }
  // Inicial
  syncSidebarWidth();
  // Quando colapsar/expandir
  collapseBtn?.addEventListener('click', () => {
    setTimeout(syncSidebarWidth, 0);
  });
  window.addEventListener('resize', () => {
    // Em telas estreitas a sidebar vira 64px pelo CSS; reflete isso
    syncSidebarWidth();
  });

  // Upload de arquivo (apenas Decupagem)
  attachBtn?.addEventListener('click', (e) => {
    if (attachBtn.disabled) return;
    fileInput?.click();
  });
  fileInput?.addEventListener('change', async () => {
    try{
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      const reset = () => { try{ fileInput.value = ''; }catch{} };
      const ext = (file.name.split('.').pop()||'').toLowerCase();
      const isDoc = ext === 'doc' || ext === 'docx' || file.type === 'application/msword' || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      const isPdf = ext === 'pdf' || file.type === 'application/pdf';
      const toBase64 = (blob) => new Promise((res, rej) => {
        const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = rej; fr.readAsDataURL(blob);
      });
      if (activeChat === CHAT_DECUPAGEM){
        const dataBase64 = await toBase64(file);
        const fileKind = isPdf ? 'pdf' : (isDoc ? 'doc' : 'doc');
        const preview = {
          name: file.name,
          type: file.type,
          size: file.size,
          sizeLabel: formatFileSize(file.size),
          dataBase64,
          fileKind,
          blob: file,
        };
        pendingFiles.push(preview);
        renderAttachPreview();
        reset();
        return;
      }
      if (activeChat === CHAT_FFMPEG){
        const isVideo = file.type.startsWith('video/') || ['mp4','mov','mkv','avi','m4v','mpg','mpeg','webm','wmv','flv'].includes(ext);
        if (!isVideo){
          addMessage('system', 'Envie um arquivo de vídeo válido para processar no FFmpeg.', { persist:false });
          reset();
          return;
        }
        const dataBase64 = await toBase64(file);
        const preview = {
          name: file.name,
          type: file.type,
          size: file.size,
          sizeLabel: formatFileSize(file.size),
          dataBase64,
          fileKind: 'video',
          blob: file,
        };
        try { preview.poster = await extractFirstFramePoster(file); } catch {}
        pendingFiles.push(preview);
        renderAttachPreview();
        addMessage('system', 'Vídeo pronto. Clique em Enviar para extrair os frames.', { persist:false });
        reset();
        return;
      }
      addMessage('system', 'Anexo disponível apenas nos chats Decupagem ou FFmpeg.', { persist:false });
      reset();
      return;
    }catch(err){
      addMessage('system', `Erro no upload: ${err?.message||err}`, { persist:false });
    }
  });

  async function uploadFileMultipart(pf, chat){
    const cfg = loadCfg();
    if (!cfg?.url){ throw new Error('Webhook URL não configurada para este chat'); }
    const form = new FormData();
    form.append('chat', chat);
    form.append('filename', pf.name);
    form.append('mimetype', pf.type || 'application/octet-stream');
    form.append('filesize', String(pf.size || 0));
    form.append('filekind', pf.fileKind || 'doc');
    const blob = pf.blob || (pf.dataBase64 ? base64ToBlob(pf.dataBase64, pf.type) : null);
    if (!blob) throw new Error('Arquivo inválido');
    form.append('file', blob, pf.name);
    const headers = {};
    if (cfg.auth) headers['Authorization'] = cfg.auth;
    const res = await fetch(cfg.url, { method: 'POST', headers, body: form });
    if (!res.ok){ throw new Error(`HTTP ${res.status}`); }
    let data = null;
    try { data = await res.json(); } catch {}
    // Se a resposta contiver título/link, renderiza e persiste
    if (chat === CHAT_DECUPAGEM && data){
      const dec = toDecupagemResult(data);
      if (dec && (dec.spreadsheetUrl || dec.title)){
        renderDecupagemResult(dec);
        try{ histAppend({ role:'assistant', kind:'decupagemResult', data: dec, ts: Date.now(), chat }); }catch{}
      }
    }
    return data;
  }
  function base64ToBlob(b64, mime){
    const bin = atob(b64);
    const len = bin.length;
    const arr = new Uint8Array(len);
    for (let i=0; i<len; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime || 'application/octet-stream' });
  }

  async function handleSend() {
    const raw = inputEl.value;
    const text = raw.replace(/\n+$/, "").trim();
    if (!text && pendingFiles.length === 0) return;
    inputEl.value = "";
    inputEl.style.height = "auto";

    const filesToSend = pendingFiles.slice();
    pendingFiles.splice(0, pendingFiles.length);
    renderAttachPreview();

    if (text) addMessage("user", text);

    if (activeChat === CHAT_FFMPEG){
      const videoFiles = filesToSend.filter((pf) => pf.fileKind === 'video');
      if (!videoFiles.length){
        addMessage('system', 'Envie um arquivo de vídeo antes de solicitar um comando FFmpeg.', { persist:false });
        return;
      }
      if (!text){
        addMessage('system', 'Descreva em linguagem natural o que deseja que o FFmpeg faça.', { persist:false });
        return;
      }
      if (videoFiles.length > 1){
        addMessage('system', 'Processando apenas o primeiro vídeo anexado.', { persist:false });
      }
      const video = videoFiles[0];
      let commandPlan;
      try {
        commandPlan = await api.generateFfmpegCommand({
          prompt: text,
          video: { name: video.name, mime: video.type, size: video.size },
        });
      } catch (err) {
        addMessage('system', `Não consegui gerar o comando FFmpeg: ${err?.message || err}`, { persist:false });
        return;
      }

      if (!commandPlan || !Array.isArray(commandPlan.args) || commandPlan.args.length === 0){
        const msg = commandPlan?.description || 'Comando FFmpeg não pôde ser gerado.';
        addMessage('system', msg, { persist:false });
        return;
      }

      try {
        const result = await api.processVideoFFmpeg({
          name: video.name,
          mime: video.type,
          size: video.size,
          dataBase64: video.dataBase64,
          commandPlan,
        });
        if (activeChat === CHAT_FFMPEG) {
          const payload = {
            ...result,
            videoSizeLabel: formatFileSize(video.size),
            commandPlan,
          };
          renderFfmpegResult(payload);
          try{
            histAppend({ role:'assistant', kind:'ffmpegResult', data: payload, ts: Date.now(), chat: CHAT_FFMPEG });
          }catch{}
        }
      } catch (err) {
        addMessage('system', `Falha ao processar o vídeo: ${err?.message || err}`, { persist:false });
      }
      return;
    }

    if (activeChat === CHAT_DECUPAGEM && filesToSend.length){
      for (const pf of filesToSend){
        const wrap = renderFileMessage('user', { name: pf.name, type: pf.type, sizeLabel: pf.sizeLabel, fileKind: pf.fileKind });
        addDecLoaderAfter(wrap);
        try{ histAppend({ role:'user', kind:'file', meta: { name: pf.name, type: pf.type, size: pf.size, sizeLabel: pf.sizeLabel, fileKind: pf.fileKind }, ts: Date.now(), chat: activeChat }); }catch{}
      }
    }

    if (activeChat !== CHAT_FFMPEG && window.cleo && typeof window.cleo.sendChat === 'function') {
      try {
        const cfg = loadCfg();
        if (text) await window.cleo.sendChat({ text, chat: activeChat, cfg });
        if (activeChat === CHAT_DECUPAGEM && filesToSend.length){
          for (const pf of filesToSend){ await uploadFileMultipart(pf, activeChat); }
        }
        if (filesToSend.length === 0 || activeChat !== CHAT_DECUPAGEM) return;
        return;
      } catch (err) {
        addMessage("system", `Falha ao enviar ao webhook (${activeChat}): ${err?.message || err}`);
      }
    }

    if (text){
      const reply = await api.postMessage(text).catch(() => "Desculpe, tive um problema ao responder.");
      addMessage("assistant", reply);
    }

    if (activeChat === CHAT_DECUPAGEM && filesToSend.length){
      for (const pf of filesToSend){
        try { await uploadFileMultipart(pf, activeChat); }
        catch(err){ addMessage('system', `Falha no upload: ${err?.message||err}`, { persist:false }); }
      }
    }
  }

  // Auto-resize textarea and enter-to-send
  inputEl.addEventListener("input", () => {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 180) + "px";
  });
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });
  sendBtn.addEventListener("click", handleSend);

  // Atalho: Enter no campo de busca foca a caixa de mensagem
  if (searchEl) {
    searchEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        inputEl.focus();
      }
    });
  }

  // Collapse/expand sidebar com persistência
  const SIDEBAR_KEY = "sidebarCollapsed";
  function setChevron() {
    collapseBtn
      ?.querySelector("path")
      ?.setAttribute(
        "d",
        document.body.classList.contains("sidebar-collapsed")
          ? "M10 7l5 5-5 5"
          : "M14 7l-5 5 5 5"
      );
  }
  // Estado inicial
  try {
    const saved = localStorage.getItem(SIDEBAR_KEY);
    if (saved === "1") {
      document.body.classList.add("sidebar-collapsed");
    }
  } catch {}
  setChevron();

  if (collapseBtn) {
    collapseBtn.addEventListener("click", () => {
      document.body.classList.toggle("sidebar-collapsed");
      setChevron();
      try {
        localStorage.setItem(
          SIDEBAR_KEY,
          document.body.classList.contains("sidebar-collapsed") ? "1" : "0"
        );
      } catch {}
    });
  }

  // Modal handlers
  function openModal() {
    if (modal) {
      // Pré-preenche data/hora se vazio
      if (schDate && !schDate.value) {
        const now = new Date();
        const iso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
          now.getDate()
        )}`;
        schDate.value = iso;
        if (schDateText) schDateText.value = toBRFromISO(iso);
      }
      if (schTime && !schTime.value) {
        const now = new Date();
        schTime.value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      }
      modal.hidden = false;
      schTitle?.focus();
    }
  }
  function closeModal() {
    if (modal) modal.hidden = true;
  }
  function resetScheduleForm(){
    try {
      if (schTitle) schTitle.value = '';
      if (schDateText) schDateText.value = '';
      if (schDate) schDate.value = '';
      if (schTime) schTime.value = '09:00';
      if (schDuration) schDuration.value = '30';
      if (schAttendees) schAttendees.value = '';
      if (schDesc) schDesc.value = '';
    } catch {}
  }
  openScheduleBtn?.addEventListener("click", openModal);
  modalCloseEls.forEach((el) => el.addEventListener("click", closeModal));

  // Sync data inputs
  schDate?.addEventListener("change", () => {
    if (schDateText && schDate && schDate.value) {
      schDateText.value = toBRFromISO(schDate.value);
    }
  });
  schDateText?.addEventListener("blur", () => {
    const iso = toDateISOFromBR(schDateText.value.trim());
    if (iso && schDate) {
      schDate.value = iso;
    }
  });
  timeBtn?.addEventListener('click', () => {
    if (schTime && typeof schTime.showPicker === 'function') schTime.showPicker();
    else schTime?.focus();
  });
  durBtn?.addEventListener('click', () => {
    // Cicla entre durações comuns: 15 -> 30 -> 45 -> 60 -> 15
    const seq = [15,30,45,60];
    const cur = parseInt(schDuration?.value || '30', 10);
    const idx = Math.max(0, seq.indexOf(cur));
    const next = seq[(idx + 1) % seq.length];
    if (schDuration) schDuration.value = String(next);
    schDuration?.focus();
  });
  const dateBtn = document.getElementById('date-btn');
  dateBtn?.addEventListener('click', () => {
    if (schDate && typeof schDate.showPicker === 'function') schDate.showPicker();
    else schDate?.focus();
  });

  schSubmit?.addEventListener("click", async () => {
    try {
      // Monta início a partir de Data/Hora
      let dateISO =
        schDate?.value || toDateISOFromBR(schDateText?.value || "") || "";
      let time = (schTime?.value || "").trim();
      if (!time) time = "09:00";
      const start = dateISO ? `${dateISO}T${time}:00` : "";
      const duration = parseInt(schDuration?.value || "30", 10);
      if (!start) return alert("Informe a data e hora.");
      const tzAuto = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';
      const payload = {
        title: (schTitle?.value || "Reunião").trim(),
        summary: (schTitle?.value || "Reunião").trim(),
        description: (schDesc?.value || "").trim(),
        start,
        date: dateISO,
        dateBR: schDateText?.value || toBRFromISO(dateISO),
        time,
        durationMinutes: duration,
        attendees: (schAttendees?.value || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        timeZone: tzAuto,
      };

      // Inicia loader no chat e aplica atraso de 5s para a resposta
      scheduleDelayUntil = Date.now() + 5000;
      addScheduleLoader();
      scheduleFlush();
      const cfg = loadCfg();
      const res = await api.scheduleMeeting(payload, {
        url: cfg.url,
        method: cfg.method || "POST",
        headers: cfg.auth ? { Authorization: cfg.auth } : {},
      });
      closeModal();
      resetScheduleForm();
      // Não mostramos o balão textual aqui; o main envia um
      // objeto de evento via 'chat:reply' que já é renderizado
      // com o layout completo e link clicável.
    } catch (err) {
      clearScheduleLoaders();
      addMessage(
        "assistant",
        `Não consegui criar a reunião: ${err?.message || err}`
      );
    }
  });

  // Settings modal
  const settingsModal = document.getElementById("settings-modal");
  const cfgUrl = document.getElementById("cfg-url");
  const cfgMethod = document.getElementById("cfg-method");
  const cfgAuth = document.getElementById("cfg-auth");
  const cfgHist = document.getElementById("cfg-hist");
  const cfgClear = document.getElementById("cfg-clear");
  const cfgSave = document.getElementById("cfg-save");
  const cfgTest = document.getElementById("cfg-test");

  function openSettings() {
    const cfg = loadCfg();
    if (cfgUrl) cfgUrl.value = cfg.url || "";
    if (cfgMethod) cfgMethod.value = cfg.method || "POST";
    if (cfgAuth) cfgAuth.value = cfg.auth || "";
    const g = globalCfgLoad();
    if (cfgHist) cfgHist.value = String(parseInt(g.histLimit ?? 500, 10) || 500);
    if (settingsModal) settingsModal.hidden = false;
  }
  function closeSettings() {
    if (settingsModal) settingsModal.hidden = true;
  }
  openSettingsBtn?.addEventListener("click", openSettings);
  settingsModal
    ?.querySelectorAll("[data-close]")
    ?.forEach((el) => el.addEventListener("click", closeSettings));
  cfgSave?.addEventListener("click", () => {
    const cfg = {
      url: cfgUrl?.value?.trim(),
      method: cfgMethod?.value || "POST",
      auth: cfgAuth?.value?.trim(),
    };
    saveCfg(cfg);
    // Save global hist limit
    const newLimit = parseInt(cfgHist?.value || '500', 10) || 500;
    const g = globalCfgLoad();
    globalCfgSave({ ...g, histLimit: newLimit });
    closeSettings();
  });
  cfgClear?.addEventListener('click', async () => {
    try{
      // Try bridge-specific clear by chat if available
      if (window.cleo?.history?.clearByChat){
        await window.cleo.history.clearByChat(activeChat);
      } else {
        const all = await histLoadAll();
        const filtered = (all||[]).filter(e => (e?.chat || CHAT_GOOGLE) !== activeChat);
        histSaveAll(filtered);
      }
      if (messagesEl) messagesEl.innerHTML = '';
      addMessage('system', 'Histórico limpo para este chat.', { persist:false });
    }catch(err){
      addMessage('system', `Falha ao limpar histórico: ${err?.message||err}`, { persist:false });
    }
  });
  cfgTest?.addEventListener("click", async () => {
    const cfg = {
      url: cfgUrl?.value?.trim(),
      method: cfgMethod?.value || "POST",
      auth: cfgAuth?.value?.trim(),
    };
    try {
      addMessage("system", "Testando webhook…");
      const res = await api.scheduleMeeting(
        { ping: true, ts: Date.now() },
        {
          url: cfg.url,
          method: cfg.method,
          headers: cfg.auth ? { Authorization: cfg.auth } : {},
        }
      );
      addMessage("system", `Webhook OK: ${JSON.stringify(res).slice(0, 200)}…`);
    } catch (err) {
      addMessage("system", `Falha no teste: ${err?.message || err}`);
    }
  });

  // Sem mensagem inicial automática
})();

// Exemplo para receber mensagens externas do nó "Response" do webhook
// Usa window.cleo.receive se existir; caso contrário, ignora silenciosamente.
// (moved into IIFE above)

function appendChatMessage(texto) {
  // Se existir um container com id chat-box, usa-o (exemplo do usuário)
  const chatBox = document.getElementById("chat-box");
  if (chatBox) {
    const msg = document.createElement("div");
    msg.className = "bot-message";
    msg.innerText = typeof texto === 'string' ? texto : JSON.stringify(texto);
    chatBox.appendChild(msg);
    return;
  }

  // Render no chat padrão do app
  const messagesEl = document.getElementById("messages");
  if (!messagesEl) return;
  const wrap = document.createElement("div");
  wrap.className = "msg assistant";
  const bubble = document.createElement("div");
  bubble.className = "bubble";

  // Evento estruturado → render formatado em pt-BR
  if (texto && typeof texto === "object" && texto.type === "event") {
    try{
      const container = document.getElementById('messages');
      let last = container?.lastElementChild;
      // pula divisores/linhas auxiliares e encontra o último bloco visível
      while (last && (
        last.classList?.contains('chat-divider') ||
        last.classList?.contains('loader-line') ||
        last.classList?.contains('system-line')
      )) {
        last = last.previousElementSibling;
      }
      if (last) {
        const div = document.createElement('div');
        div.className = 'chat-divider';
        container.appendChild(div);
      }
    }catch{}
    const title = texto.summary || "(sem título)";
    const desc = texto.description || "—";
    const link = texto.link || "";
    const tz = texto.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const toDate = (iso) => (iso ? new Date(iso) : null);
    const startD = toDate(texto.start);
    const endD = toDate(texto.end);

    const dateLabel = startD
      ? new Intl.DateTimeFormat("pt-BR", {
          weekday: "long",
          day: "numeric",
          month: "long",
          timeZone: tz,
        })
          .format(startD)
          .replace(/^(.)/, (m) => m.toUpperCase())
      : "";

    const fmtHM = (d) =>
      new Intl.DateTimeFormat("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: tz,
      })
        .format(d)
        .replace(":", "h");

    let timeLabel = "";
    if (startD && endD) {
      timeLabel = `${fmtHM(startD)} – ${fmtHM(endD)}`;
    } else if (startD && texto.durationMinutes) {
      const endAuto = new Date(startD.getTime() + Number(texto.durationMinutes) * 60000);
      timeLabel = `${fmtHM(startD)} – ${fmtHM(endAuto)}`;
    } else if (startD) {
      timeLabel = fmtHM(startD);
    }

    const heading = document.createElement("div");
    heading.textContent = "📅 Evento:";
    heading.style.marginBottom = "6px";
    heading.style.fontWeight = "600";
    bubble.appendChild(heading);

    const addRow = (label, value, node) => {
      const row = document.createElement("div");
      const b = document.createElement("span");
      b.style.color = "var(--muted)";
      b.textContent = `${label} `;
      row.appendChild(b);
      if (node) row.appendChild(node);
      else {
        const v = document.createElement("span");
        v.textContent = value;
        row.appendChild(v);
      }
      bubble.appendChild(row);
    };

    addRow("Titulo:", title);
    addRow("Descrição:", desc);
    if (dateLabel) addRow("Data:", dateLabel);
    if (timeLabel) addRow("Horário:", timeLabel);
    if (link) {
      const a = document.createElement("a");
      a.href = link;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className = "meet-link";
      a.textContent = link;
      // Força abrir no navegador padrão do sistema
      a.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.cleo && typeof window.cleo.openExternal === 'function') {
          window.cleo.openExternal(link);
        } else {
          window.open(link, '_blank', 'noopener');
        }
      });
      addRow("🔗 Link da videoconferência:", "", a);
    }
    try { wrap.dataset.kind = 'google'; } catch {}
  } else {
    // Texto simples vindo do main → tratar como mensagem de sistema (sem balão)
    const line = document.createElement('div');
    line.className = 'system-line';
    line.textContent = typeof texto === 'string' ? texto : JSON.stringify(texto);
    messagesEl.appendChild(line);
    return;
  }

  wrap.appendChild(bubble);
  messagesEl.appendChild(wrap);
}
