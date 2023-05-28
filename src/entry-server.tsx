import {
	createHandler,
	renderAsync,
	StartServer,
} from 'solid-start/entry-server';

// solid-start-sse-support
import { listen } from '~/server/solid-start-sse-support';

// solid-start-sse-support
listen();

export default createHandler(
	renderAsync((event) => <StartServer event={event} />)
);
