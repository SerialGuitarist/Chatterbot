import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';

import  ChatterUI from '../ui/ChatterUI.svelte';
import { mount, unmount } from 'svelte';

import { messages } from "../chat";
import { get } from "svelte/store";
import type ChatterbotPlugin from '../main';

export const VIEW_TYPE = 'chatterbot-view';

export class ChatterbotView extends ItemView {
	chatterUI: ReturnType<typeof ChatterUI> | undefined; 
	unsubscribe: () => void;

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
			// console.log("calling backend");
			// const result = await this.plugin.askLlama([{ role: "user", content: "Hey!" }]);
			const chatHistory = get(messages);
			// console.log(chatHistory);
			
			// Add empty assistant message that we'll stream into
			messages.update(m => [...m, {role: "assistant", content: ""}]);
			
			// Set up streaming callback
			const llama = (this as any).plugin.llama;
			llama.onStreamToken = (token: string) => {
				// Update the last (assistant) message with the accumulated response
				messages.update(m => {
					const updated = [...m];
					if (updated.length > 0 && updated[updated.length - 1].role === "assistant") {
						updated[updated.length - 1].content = token;
					}
					return updated;
				});
			};
			
			const result = await (this as any).plugin.askLlama(chatHistory);
			const reply = result.reply;
			
			// Clean up callback
			llama.onStreamToken = undefined;
			
			// Update with final response (in case streaming wasn't complete)
			messages.update(m => {
				const updated = [...m];
				if (updated.length > 0 && updated[updated.length - 1].role === "assistant") {
					updated[updated.length - 1].content = reply;
				}
				return updated;
			});
			
			// Save assistant response to chat store
			await (this as any).plugin.chatStore.addMessageToCurrentChat("assistant", reply);
			// console.log("LLM result:", result);
		} catch (error) {
			console.error("Error during llama call:", error);
			// Remove the empty message if something went wrong
			messages.update(m => m.slice(0, -1));
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
		const result = await this.plugin.askLlama(chatHistory);
		const reply = result.reply;

		// TODO: error handling here
		messages.update(m => [...m, {role: "assistant", content: reply}]);
		
		// Save to chat store
		await this.plugin.chatStore.addMessageToCurrentChat("assistant", reply);
		// console.log("LLM result:", result);
	}


}


