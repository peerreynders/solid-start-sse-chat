// file: src/api.ts
import { action } from '@solidjs/router';
import { broadcast } from './server/api-server';

export { MESSAGES_LAST_EVENT_ID, SSE_FALLBACK_SEARCH_PAIR } from './server/api';

const NAME_SEND_MESSAGE = 'send-message';

const sendMessage = action<[data: FormData], boolean>(
	async (data: FormData) => {
		'use server';
		return broadcast(data);
	}, NAME_SEND_MESSAGE);

export { sendMessage };
