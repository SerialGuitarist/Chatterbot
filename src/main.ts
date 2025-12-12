import { Plugin, Notice, WorkspaceLeaf } from "obsidian";

// of dubious necessity
import { App, Editor, MarkdownView, Modal, PluginSettingTab, Setting } from 'obsidian';

import { ChatterbotView, VIEW_TYPE } from './view/view';
import Llama from './llama';
import { RAGStore } from "./ragStore";

interface ChatterbotPluginSettings {
	apiKey: string;
}


const DEFAULT_SETTINGS: ChatterbotPluginSettings = {
	apiKey: 'sk-1234567890'
}

export default class ChatterbotPlugin extends Plugin {
	settings: ChatterbotPluginSettings;
	llama: Llama;
	rag: RAGStore;

	async onload() {
		await this.loadSettings();


		//// rag stuffs
		this.rag = new RAGStore(this);
		await this.rag.load();
		await this.rag.updateFromVault();
		/////

		this.llama = new Llama(this.settings.apiKey, this.rag);

		this.registerView(
			VIEW_TYPE,
			(leaf) => new ChatterbotView(leaf, this)
		);

		this.addRibbonIcon('dice', 'Chatterbot view', () => {
			this.activateView();
		});

		this.addSettingTab(new ChatterBotSettingTab(this.app, this));
		this.activateView();
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE);

		if (leaves.length > 0) {
			// A leaf with our view already exists, use that
			leaf = leaves[0];
		} else {
			// Our view could not be found in the workspace, create a new leaf
			// in the right sidebar for it
			leaf = workspace.getRightLeaf(false);
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
		}

		// "Reveal" the leaf in case it is in a collapsed sidebar
		workspace.revealLeaf(leaf);
	}

	onunload() {

	}

	async loadSettings() {
		const data = await this.loadData();
		this.settings = data?.settings ?? DEFAULT_SETTINGS;
	}

	async saveSettings() {
		const data = await this.loadData() ?? {};
		data.settings = this.settings;
		await this.saveData(this.data);
	}
	

	async askLlama(messages) {
		let mainResult = await this.llama.ask(messages)
		// console.log("mainresult:", mainResult);
		return mainResult;
	}

	async update() {
		await this.rag.updateFromVault();
	}

	async test() {
		const retriever = this.rag.getRetriever();
		const output = await retriever.invoke("Who is Governance of Iron");
		console.log(output);
	}
}

class ChatterBotSettingTab extends PluginSettingTab {
	plugin: ChatterbotPlugin;

	constructor(app: App, plugin: ChatterbotPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('API Key')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.apiKey)
				.onChange(async (value) => {
					this.plugin.settings.apiKey = value;
					await this.plugin.saveSettings();
				}));
	}
}
