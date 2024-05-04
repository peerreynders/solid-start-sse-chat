// file: src/server/api.ts
const MESSAGES_LAST_EVENT_ID = 'lastEventId';
const SSE_FALLBACK_SEARCH_PAIR = 'sseLongPoll=1';

const LONGPOLL_PAIR = SSE_FALLBACK_SEARCH_PAIR.split('=').map((v) => v.trim());

export { LONGPOLL_PAIR, MESSAGES_LAST_EVENT_ID, SSE_FALLBACK_SEARCH_PAIR };
