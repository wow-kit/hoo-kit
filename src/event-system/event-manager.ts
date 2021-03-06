import { requireCustomEventModules, customEventModules } from './custom-events';
import { HookitEvent } from '../types';
import { mainProcess, MainProcessEvents } from '../main-process';
import { notifyResourceChanged, Resource } from '../resources';

export default function () {
	requireCustomEventModules();
	notifyResourceChanged(Resource.Events);
}

export const defaultEvents = ['general/start', 'general/end', 'time/interval', 'filesystem/on', 'git/on'];
export const loadedEvents = new Map<string, HookitEvent>();

mainProcess.on(MainProcessEvents.Close, flushEvents);

function flushEvents() {
	loadedEvents.forEach((event) => {
		if (event.flush) {
			event.flush();
		}
	});
}

export function getEventByPath(eventPath: string): HookitEvent {
	let event: HookitEvent;
	if (loadedEvents.has(eventPath)) {
		event = loadedEvents.get(eventPath);
	} else {
		const names = eventPath.split('/');
		const categoryName = names[0];
		const eventName = names[1];
		if (customEventModules.has(categoryName)) {
			// this category is in a custom events module
			event = customEventModules.get(categoryName)[eventName];
		} else {
			// catergory is a default catergory
			// this will be a default event so we require it from our local files
			// since we use require instead of import to be synchronous we get
			// the default export because we know it is a ES5 module
			event = require('../events/' + eventPath).default;
		}

		if (event.prerequisite) {
			event.prerequisite();
		}
		loadedEvents.set(eventPath, event);
	}
	return event;
}
