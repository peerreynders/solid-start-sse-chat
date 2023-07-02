// file src/routes/index.tsx

import { onCleanup, For } from 'solid-js';
import { FormError } from 'solid-start';
import { formatUTCTimeOnly } from '~/lib/shame';
import { disposeMessages, useMessages } from '~/components/message-context';

// --- BEGIN server side ---
import {
	createServerAction$,
	ServerError,
	type ServerFunctionEvent,
} from 'solid-start/server';

import { fromFetchEventClientId, send } from '~/server/pub-sub';

async function sendFn(form: FormData, event: ServerFunctionEvent) {
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

	const clientId = fromFetchEventClientId(event);
	if (!clientId) return new ServerError('Missing Client ID', { status: 400 });

	send(message, clientId);
}

// --- END server side ---

function showClientId(messages: ReturnType<typeof useMessages>) {
	const id = messages.id;
	return typeof id === 'string' ? id : '???';
}

const MESSAGE_ERROR =
	'At least one non-whitespace character is required to send';

function onMessageInvalid(event: Event) {
	if (!(event.target instanceof HTMLInputElement)) return;

	event.target.setCustomValidity(MESSAGE_ERROR);
	event.stopPropagation();
}

function onMessageInput(event: Event) {
	if (!(event.target instanceof HTMLInputElement)) return;

	event.target.setCustomValidity('');
	event.stopPropagation();
}

export default function Home() {
	const messages = useMessages();
	onCleanup(disposeMessages);
	const [sending, sendMessage] = createServerAction$(sendFn);

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
			<main class="messages">
				<h1>Client: {showClientId(messages)}</h1>
				<sendMessage.Form ref={$form} onsubmit={clearAfterSubmit}>
					<label>
						Message:
						<input
							type="text"
							name="message"
							required
							pattern="^.*\S.*$"
							oninput={onMessageInput}
							oninvalid={onMessageInvalid}
							title={MESSAGE_ERROR}
						/>
					</label>
					<button type="submit" disabled={sending.pending}>
						Send
					</button>
				</sendMessage.Form>
				<ul role="list">
					<For each={messages.history}>
						{({ timestamp, from, body }) => {
							const chatTime = formatUTCTimeOnly(timestamp);
							return (
								<li>
									<time datetime={chatTime}>{chatTime}</time>
									<span class="message__from">{from}</span>
									{body}
								</li>
							);
						}}
					</For>
				</ul>
			</main>
		</>
	);
}
