import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';

import  ChatterUI from '../ui/ChatterUI.svelte';
import { mount, unmount } from 'svelte';

import { messages, status } from "../chat";
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
		try {
			const abortController = new AbortController();
			const llama = (this as any).plugin.llama;
			(llama as any).abortController = abortController;
			
			const chatHistory = get(messages);
			
			// Set up streaming callback
			llama.onStreamToken = (token: string) => {
				messages.update(m => {
					const updated = [...m];
					// Update the last assistant message if it exists
					if (updated.length > 0 && updated[updated.length - 1].role === "assistant") {
						updated[updated.length - 1].content = token;
					}
					return updated;
				});
			};
			
			// Call LLM - now returns array of ChatMessage objects
			const resultMessages = await (this as any).plugin.askLlama(chatHistory);
			
			llama.onStreamToken = undefined;
			(llama as any).abortController = null;
			
			// Add each result message to UI and chat store
			for (const msg of resultMessages) {
				// Add to messages store for UI
				messages.update(m => [...m, msg]);
				
				// Save to chat store with metadata
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
			
		} catch (error) {
			const isAbort = error instanceof Error && (error.name === "AbortError" || error.message.includes("aborted"));
			if (isAbort) {
				console.log("Model execution halted");
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


