import { ItemView, WorkspaceLeaf } from 'obsidian';

import  ChatterUI from '../ui/ChatterUI.svelte';
import { mount, unmount } from 'svelte';

import { messages } from "../chat";

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

	async test() {
		messages.update(m => [...m, {role: "user", content: "test appended"}]);
	}

	async clear() {
		messages.update(m => []);
	}

	// methods lose their context for "this" when passed around as callbacks
	// so the svelte button calling this thinks "this" refers to something svelte
	// async openai() {
	// os instead the arrow function methods auto binds this
		// this.llama.test();
	// }
	openai = async () => {
		console.log("calling backend");

		const result = await this.plugin.askLlama([
			{ role: "user", content: "Hey!" }
		]);

		console.log("LLM result:", result);
	}



}


