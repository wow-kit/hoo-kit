import * as dgram from 'dgram';
import { getArgument } from './config';
import { ApiCall, handleApiCall } from './ipc-api';
import { mainProcess, MainProcessEvents } from './main-process';
import { UUID } from './types';

const port = Number(getArgument('udpPort') || '41234');

type ListenerCallback = (data: unknown) => void;

export type IPCMessage = { event: string; data: unknown };

class IPC {
	public port = port;

	public initialized = false;

	private subscribedClients = new Map<string, dgram.RemoteInfo[]>();

	private listeners = new Map<string, { filter?: string; cb: ListenerCallback }>();

	private server: dgram.Socket;

	public onInit: () => void;

	constructor() {
		this.initUdpServer();
	}

	initUdpServer() {
		this.server = dgram.createSocket({ type: 'udp4', reuseAddr: true });

		const closeServer = () => {
			if (this.server) {
				console.log('Shutting down ipc');
				this.server.close();
				this.server = null;
			}
		};

		this.server.on('message', (data, rinfo) => {
			this.handleMsg(data, rinfo);
		});

		this.server.on('error', (err) => {
			console.log(`ipc server error:\n${err.stack}`);
			closeServer();
		});

		this.server.on('listening', () => {
			this.onInit();
		});

		this.server.bind(port);

		mainProcess.on(MainProcessEvents.AfterClose, () => {
			closeServer();
		});
	}

	private sendPrivate(client: dgram.RemoteInfo, msg: IPCMessage) {
		this.server.send(JSON.stringify(msg), client.port, client.address);
	}

	handleMsg(msg: Buffer, sender: dgram.RemoteInfo) {
		try {
			const message = JSON.parse(msg.toString()) as IPCMessage;
			if (message.event) {
				if (message.event === 'HOOKIT_DEBUG') {
					this.handleMsg(
						Buffer.from(JSON.stringify({ event: 'HOOKIT_API_CALL', data: { id: '12345689', api: 'setConfig' } })),
						sender
					);
					return;
				}
				if (message.event === 'SUBSCRIBE_FOR') {
					const eventToSubscribeFor = message.data as string;
					if (!this.subscribedClients.has(eventToSubscribeFor)) {
						this.subscribedClients.set(eventToSubscribeFor, []);
					}
					this.subscribedClients.get(eventToSubscribeFor).push(sender);
					return;
				}
				if (message.event === 'HOOKIT_API_CALL') {
					handleApiCall(message.data as ApiCall, this.sendPrivate.bind(this, sender));
					return;
				}
				this.listeners.forEach((listener) => {
					if (listener.filter) {
						if (listener.filter !== message.event) {
							return;
						}
					}
					listener.cb(message.data);
				});
			} else {
				throw 'No event in message';
			}
		} catch (ex) {
			console.log('invalid ipc message received', ex);
		}
	}

	on(id: UUID, cb: ListenerCallback, filter?: string) {
		this.listeners.set(id, { filter, cb });
	}

	off(id: UUID) {
		this.listeners.delete(id);
	}

	broadcast(msg: IPCMessage) {
		const data = JSON.stringify(msg);
		this.subscribedClients.forEach((subscribers) => {
			subscribers.forEach((subscriber) => {
				this.server.send(data, subscriber.port, subscriber.address);
			});
		});
	}

	send(msg: IPCMessage) {
		return new Promise((res) => {
			// send to subscribers
			const data = JSON.stringify(msg);
			const subscribers = this.subscribedClients.get(msg.event);
			if (subscribers) {
				subscribers.forEach((subscriber) => {
					this.server.send(data, subscriber.port, subscriber.address, res);
				});
			}
		});
	}
}

export let mainIpc: IPC;
export function initIPC() {
	if (!mainIpc) {
		mainIpc = new IPC();
	}
}

export function waitForIpcInit() {
	return new Promise((res) => {
		mainIpc.onInit = res;
	});
}
