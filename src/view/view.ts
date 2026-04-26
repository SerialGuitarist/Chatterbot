import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';

import  ChatterUI from '../ui/ChatterUI.svelte';
import { mount, unmount } from 'svelte';

import { messages, status } from "../chats/chat";
import type { ChatMessage } from "../chats/chat";
import { get } from "svelte/store";
import type ChatterbotPlugin from '../main';

export const VIEW_TYPE = 'chatterbot-view';

export class ChatterbotView extends ItemView {
	chatterUI: ReturnType<typeof ChatterUI> | undefined;
	plugin: ChatterbotPlugin;
	unsubscribe: () => void;
	abortController: AbortController | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: ChatterbotPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return VIEW_TYPE;
	}

	getIcon() {
		return 'message-square';
	}

	getDisplayText() {
		return 'Chatterbot';
	}

	async onOpen() {
		this.chatterUI = mount(ChatterUI, {
			target: this.contentEl,
			props: {view: this}
		});

		this.unsubscribe = messages.subscribe(m => {
			// console.log("messages changed:", m);
		});


	}

	async onClose() {
		if (this.unsubscribe) this.unsubscribe();
		if (this.chatterUI) unmount(this.chatterUI);
	}

	test = async () => {
		// messages.update(m => [...m, {role: "user", content: "test appended"}]);
		this.plugin.test();
	}


	async clear() {
		messages.update(m => []);
		// Clear the messages in the current chat
		const currentChat = this.plugin.chatStore.getCurrentChat();
		if (currentChat) {
			currentChat.messages = [];
			await this.plugin.chatStore.save();
		}
	}

	update = async () => {
		// messages.update(m => [...m, {role: "user", content: "test appended"}]);
		this.plugin.update();
	}

	// methods lose their context for "this" when passed around as callbacks
	// so the svelte button calling this thinks "this" refers to something svelte
	// async openai() {
	// os instead the arrow function methods auto binds this
		// this.llama.test();
	// }
	llama = async () => {
		let streamingMessageIndex = -1;
		let isStreaming = false;

		try {
			const abortController = new AbortController();
			const llama = (this as any).plugin.llama;
			llama.abortSignal = abortController.signal;
			(llama as any).abortController = abortController;

			const chatHistory = get(messages);

			llama.onStreamToken = (token: string) => {
				messages.update(m => {
					if (!isStreaming) {
						isStreaming = true;
						streamingMessageIndex = m.length;
						return [...m, { role: "assistant" as const, content: token }];
					}
					const updated = [...m];
					if (streamingMessageIndex >= 0 && streamingMessageIndex < updated.length) {
						updated[streamingMessageIndex].content += token;
					}
					return updated;
				});
			};

			const resultMessages = await (this as any).plugin.askLlama(chatHistory);

			llama.onStreamToken = undefined;
			(llama as any).abortController = null;

			if (streamingMessageIndex >= 0) {
				if (resultMessages.length > 0) {
					// Replace streaming placeholder with final results
					messages.update(m => {
						const updated = [...m];
						updated.splice(streamingMessageIndex, 1);
						return updated;
					});
					for (const msg of resultMessages) {
						messages.update(m => [...m, msg]);
						await (this as any).plugin.chatStore.addMessageToCurrentChat(
							msg.role,
							msg.content,
							{
								toolName: (msg as any).toolName,
								displayMessage: (msg as any).displayMessage,
								fullData: (msg as any).fullData,
								displayArgs: (msg as any).displayArgs,
								isExpanded: (msg as any).isExpanded
							}
						);
					}
				} else {
					// Halted mid-stream — keep visible, save partial content
					let currentMessages: ChatMessage[] = [];
					const unsubscribe = messages.subscribe(m => { currentMessages = m; });
					unsubscribe();
					if (streamingMessageIndex < currentMessages.length) {
						const haltedMsg = currentMessages[streamingMessageIndex];
						if (haltedMsg.content?.trim()) {
							await (this as any).plugin.chatStore.addMessageToCurrentChat(
								"assistant",
								haltedMsg.content,
								{}
							);
						}
					}
				}
			}
		} catch (error) {
			const isAbort = error instanceof Error && (
				error.name === "AbortError" ||
				error.message.includes("aborted") ||
				error.message.includes("Aborted")
			);
			if (isAbort) {
				// Save partial streaming content before idling
				if (streamingMessageIndex >= 0) {
					let currentMessages: ChatMessage[] = [];
					const unsubscribe = messages.subscribe(m => { currentMessages = m; });
					unsubscribe();
					if (streamingMessageIndex < currentMessages.length) {
						const haltedMsg = currentMessages[streamingMessageIndex];
						if (haltedMsg.content?.trim()) {
							await (this as any).plugin.chatStore.addMessageToCurrentChat(
								"assistant",
								haltedMsg.content,
								{}
							);
						}
					}
				}
				status.set({ phase: "idle" });
			} else {
				console.error("Error:", error);
			}
		} finally {
			const llama = (this as any).plugin.llama;
			(llama as any).abortController = null;
		}
	}

	halt = async () => {
		const llama = (this as any).plugin.llama;
		if ((llama as any).abortController) {
			(llama as any).abortController.abort();
			(llama as any).abortController = null;
		}
	}

	summarize = async () => {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice("No file open");
			return;
		}

		const content = await this.app.vault.read(file);
		// console.log(content);

		const chatHistory = [
			...get(messages),
			{role: "user", content: "Summarize"},
			{role: "user", content: "Document to summarize: " + content},
		];
		// console.log(chatHistory);
		const resultMessages = await this.plugin.askLlama(chatHistory);

		// TODO: error handling here
		for (const msg of resultMessages) {
			messages.update(m => [...m, msg]);
			await this.plugin.chatStore.addMessageToCurrentChat(
				msg.role,
				msg.content,
				{
					toolName: (msg as any).toolName,
					displayMessage: (msg as any).displayMessage,
					fullData: (msg as any).fullData,
					displayArgs: (msg as any).displayArgs,
				}
			);
		}
	}


}


