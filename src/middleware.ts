// src/middleware.ts
import { createMiddleware } from '@solidjs/start/middleware';
import { makeAppStore } from './app-store';
import { sessionFromEvent, refreshClientId } from './server/session';

import type { FetchEvent } from '@solidjs/start/server';

async function attachAppStore(event: FetchEvent) {
	const session = await sessionFromEvent(event);
	const record = session.data;
	event.locals.clientId = record.clientId
		? record.clientId
		: await refreshClientId(event);
	event.locals.appStore = makeAppStore();
	console.log('MW', event.locals.clientId);
}

export default createMiddleware({
	onRequest: [attachAppStore],
	onBeforeResponse: [],
});
