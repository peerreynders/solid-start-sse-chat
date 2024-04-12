// file: src/server/api-server.ts
import { getRequestEvent } from 'solid-js/web';
import { send } from './pub-sub';

function broadcast(data: FormData) {
	const message = data.get('message');
	if (typeof message !== 'string' || message.trim().length < 1) return false;

	const event = getRequestEvent();
	if (!event || !event.locals.clientId) return false;

	send(message, event.locals.clientId);
	return true;
}

export { broadcast };
