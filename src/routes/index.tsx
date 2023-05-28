// file src/routes/index.tsx

import { For } from 'solid-js';
import { FormError } from 'solid-start';
import {
	createServerAction$,
	type ServerFunctionEvent,
} from 'solid-start/server';
import { useMessages } from '~/components/message-context';

// --- BEGIN server side ---

async function sendFn(form: FormData, _event: ServerFunctionEvent) {
	const messageData = form.get('message');
	const message = typeof messageData === 'string' ? messageData : undefined;

	if (!message) {
		const options = {
			fields: {
				message: messageData,
			},
			fieldErrors: {
				message: 'Invalid Message',
			},
		};

		throw new FormError(options.fieldErrors.message, options);
	}

	console.log('Message', message);
}

// --- END server side ---

function showClientId(messages: ReturnType<typeof useMessages>) {
	const id = messages.id;
	return id ? id : '???';
}

export default function Home() {
	const messages = useMessages();
	const [sending, send] = createServerAction$(sendFn);

	let $form: HTMLFormElement | undefined;
	const clearFormTask = () => $form?.reset();
	const clearAfterSubmit = (event: SubmitEvent) => {
		if (event.currentTarget !== $form) return;

		setTimeout(clearFormTask);
		event.stopPropagation();
	};

	return (
		<>
			<header>
				Visit{' '}
				<a href="https://start.solidjs.com" target="_blank">
					start.solidjs.com
				</a>{' '}
				to learn how to build SolidStart apps.
			</header>
			<main>
				<h1>Chat Client: {showClientId(messages)}</h1>
				<send.Form ref={$form} onsubmit={clearAfterSubmit}>
					<label>Messages</label>
					<input type="text" name="message" />
					<button type="submit" disabled={sending.pending}>
						Send
					</button>
				</send.Form>
				<ul>
					<For each={messages.history}>{({ body }) => <li>{body}</li>}</For>
				</ul>
			</main>
		</>
	);
}
