// file: src/server/session.ts
import { getSession, updateSession } from 'vinxi/http';
import { customAlphabet } from 'nanoid';
import type { Session, SessionConfig } from 'vinxi/http';
import type { FetchEvent } from '@solidjs/start/server';

export type SessionRecord = {
	clientId: string;
};

const CLIENT_SESSION_NAME = '__session';
const CLIENT_SESSION_KEY = 'clientId';
// https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#define_the_lifetime_of_a_cookie

const config: SessionConfig = (() => {
	if (
		typeof process.env.SESSION_SECRET !== 'string' ||
		process.env.SESSION_SECRET.length < 32
	)
		throw Error('SESSION_SECRET must be set and at least 32 characters long');

	// $ head -c32 /dev/urandom | base64

	const config: SessionConfig = {
		cookie: {
			// domain?: string | undefined
			// encode?: (value: string) => string
			// expires?: Date | undefined
			httpOnly: true,
			// maxAge?: number | undefined
			path: '/',
			// priority?: "low" | "medium" | "high" | undefined
			sameSite: 'lax',
			secure: true,
		},
		password: process.env.SESSION_SECRET,
		// maxAge?: number | undefined used to set `expires` on cookie
		name: CLIENT_SESSION_NAME,
	};
	// see unjs/h3 and unjs/cookie-es documentation

	return config;
})();

const makeClientId = customAlphabet('1234567890abcdef', 7);

const sessionFromEvent = async (event: FetchEvent) =>
	await getSession<SessionRecord>(event.nativeEvent, config);

const sessionClientId = (session: Session<SessionRecord>) =>
	session.data[CLIENT_SESSION_KEY];

async function refreshClientId(event: FetchEvent) {
	const clientId = makeClientId();
	await updateSession(event.nativeEvent, config, { clientId });
	return clientId;
}

export { refreshClientId, sessionFromEvent, sessionClientId };
