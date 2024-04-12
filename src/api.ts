// file: src/api.ts
import { getRequestEvent } from 'solid-js/web';
import { action } from '@solidjs/router';
import { send as broadcast } from './server/pub-sub';

export { MESSAGES_LAST_EVENT_ID, SSE_FALLBACK_SEARCH_PAIR } from './server/api';

const NAME_SEND_MESSAGE = 'send-message';

const sendMessage = action<[data: FormData], boolean>(
	async (data: FormData) => {
		'use server';
		const message = data.get('message');
		if (typeof message !== 'string' || message.trim().length < 1) return false;

		const event = getRequestEvent();

		if (!event || !event.locals.clientId) return false;

		broadcast(message, event.locals.clientId);
		return true;
	},
	NAME_SEND_MESSAGE
);

export { sendMessage };
