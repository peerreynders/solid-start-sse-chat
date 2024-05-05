// file: src/api.ts
import { getRequestEvent } from 'solid-js/web';
import { action } from '@solidjs/router';
import { broadcast as bcst } from './server/pub';
import { makeServerWelcome } from './server/sub';
export { MESSAGES_LAST_EVENT_ID, SSE_FALLBACK_SEARCH_PAIR } from './server/api';

const NAME_SEND_MESSAGE = 'send-message';

// This is only for use during SSR; placed here
// for a clear bundler boundary (decoupling)
function welcomeSSR() {
	'use server';
	const event = getRequestEvent();
	if (!event || !event.locals.clientId)
		throw new Error('No request or clientId');

	return makeServerWelcome(event.locals.clientId);
}

const broadcast = action<[data: FormData], boolean>(async (data: FormData) => {
	'use server';
	const message = data.get('message');
	if (typeof message !== 'string' || message.trim().length < 1) return false;

	return bcst(message);
}, NAME_SEND_MESSAGE);

export { broadcast, welcomeSSR };
