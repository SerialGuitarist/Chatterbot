import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';

import  ChatterUI from '../ui/ChatterUI.svelte';
import { mount, unmount } from 'svelte';

import { messages } from "../chat";
import { get } from "svelte/store";

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

	getDisplayText() {
		return 'Chatterbot Display Text';
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
		// console.log("calling backend");
		// const result = await this.plugin.askLlama([{ role: "user", content: "Hey!" }]);
		const chatHistory = get(messages);
		// console.log(chatHistory);
		const result = await this.plugin.askLlama(chatHistory);
		const reply = result.reply;
		
		// TODO: handle context here


		// TODO: error handling here
		messages.update(m => [...m, {role: "assistant", content: reply.content}]);
		// console.log("LLM result:", result);
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
		messages.update(m => [...m, {role: "assistant", content: reply.content}]);
		// console.log("LLM result:", result);
	}


}


