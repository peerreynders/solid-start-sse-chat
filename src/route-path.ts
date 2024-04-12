// file: src/route-path.ts
import { isServer } from 'solid-js/web';

function basepathToMessages() {
	if (!isServer) {
		const { protocol, host } = self.location;
		return `${protocol}//${host}/api/messages`;
	}
	throw new Error('Do not use on server side');
}

export { basepathToMessages };
