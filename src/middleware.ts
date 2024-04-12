// src/middleware.ts
import { createMiddleware } from '@solidjs/start/middleware';
import { sessionFromEvent, refreshClientId } from './server/session';
import type { FetchEvent } from '@solidjs/start/server';

async function copyClientId(event: FetchEvent) {
	const session = await sessionFromEvent(event);
	const record = session.data;
	event.locals.clientId = record.clientId
		? record.clientId
		: await refreshClientId(event);
}

export default createMiddleware({
	onRequest: [copyClientId],
	onBeforeResponse: [],
});
