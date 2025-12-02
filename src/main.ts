import { Plugin, Notice, WorkspaceLeaf } from "obsidian";

// of dubious necessity
import { App, Editor, MarkdownView, Modal, PluginSettingTab, Setting } from 'obsidian';

import { ChatterbotView, VIEW_TYPE } from './view/view';
import Llama from './llama';

// Remember to rename these classes and interfaces!

interface ChatterbotPluginSettings {
	apiKey: string;
}


const DEFAULT_SETTINGS: ChatterbotPluginSettings = {
	apiKey: 'sk-1234567890'
}

export default class ChatterbotPlugin extends Plugin {
	settings: ChatterbotPluginSettings;
	llama: Llama;

	async onload() {
		await this.loadSettings();

		this.llama = new Llama(this.settings.apiKey);

		this.registerView(
			VIEW_TYPE,
			(leaf) => new ChatterbotView(leaf, this)
		);

		this.addRibbonIcon('dice', 'wallahi view', () => {
			this.activateView();
		});

		this.addSettingTab(new SampleSettingTab(this.app, this));
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
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS, 
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
	

	async askLlama(messages) {
		let mainResult = await this.llama.ask(messages)
		console.log("mainresult:", mainResult);
		return mainResult;
	}
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class SampleSettingTab extends PluginSettingTab {
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

		// new Setting(containerEl)
			// .setName('Setting #1')
			// .setDesc('It\'s a secret')
			// .addText(text => text
				// .setPlaceholder('Enter your secret')
				// .setValue(this.plugin.settings.mySetting)
				// .onChange(async (value) => {
					// this.plugin.settings.mySetting = value;
					// await this.plugin.saveSettings();
				// }));
	}
}
