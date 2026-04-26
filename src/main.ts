import { Plugin, Notice, WorkspaceLeaf } from "obsidian";

// of dubious necessity
import { App, Editor, MarkdownView, Modal, PluginSettingTab, Setting } from 'obsidian';

import { ChatterbotView, VIEW_TYPE } from './view/view';
import { OpenAILlama, MirrorLlama, OllamaLlama } from './llama/llama';
import type { Llama } from './llama/llama';
import { ToolsFactory } from "./tools/toolsLibrary";
import { RAGStore } from "./tools/ragStore";
import { status } from "./chats/chat";
import type { ChatterbotPluginSettings, ModelType } from './settings';
import { DEFAULT_SETTINGS } from './settings';
import { isModelConfigValid } from './modelFactory';
import { ChatStore } from './chats/chatManager';

export default class ChatterbotPlugin extends Plugin {
	settings: ChatterbotPluginSettings;
	llama: Llama;
	rag: RAGStore;
	chatStore: ChatStore;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new ChatterBotSettingTab(this.app, this));

		// Validate that the selected model has proper configuration
		if (!isModelConfigValid(this.settings)) {
			new Notice("Configure your model in Chatterbot settings and reload the plugin");
			return;
		}


		//// rag stuffs
		this.rag = new RAGStore(this);
		await this.rag.load();
		// await this.rag.updateFromVault();
		/////

		// Initialize chat store
		this.chatStore = new ChatStore(this);
		await this.chatStore.load();

		// Initialize the appropriate LLM based on model type
		this.llama = this.createLlama();

		this.registerView(
			VIEW_TYPE,
			(leaf) => new ChatterbotView(leaf, this)
		);

		this.addRibbonIcon('message-square', 'Chatterbot view', () => {
			this.activateView();
		});

		this.app.workspace.onLayoutReady(() => {
			this.activateView();
		});
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
			if (leaf) {
				await leaf.setViewState({ type: VIEW_TYPE, active: true });
			}
		}

		// "Reveal" the leaf in case it is in a collapsed sidebar
		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	onunload() {
		
	}

	async loadSettings() {
		const data = await this.loadData();
		const savedSettings = data?.settings;

		if (!savedSettings) {
			// No saved settings, use defaults
			this.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
			return;
		}

		// Start with defaults and merge saved settings (handles migration from old format)
		this.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

		// Migrate old settings format (if apiKey exists in old format)
		if (savedSettings.apiKey && !savedSettings.openai?.apiKey) {
			this.settings.openai.apiKey = savedSettings.apiKey;
		}

		// Merge in any new settings that were saved
		if (savedSettings.modelType) {
			this.settings.modelType = savedSettings.modelType;
		}
		if (savedSettings.openai) {
			this.settings.openai = { ...this.settings.openai, ...savedSettings.openai };
		}
		if (savedSettings.anthropic) {
			this.settings.anthropic = { ...this.settings.anthropic, ...savedSettings.anthropic };
		}
		if (savedSettings.ollama) {
			this.settings.ollama = { ...this.settings.ollama, ...savedSettings.ollama };
		}
		if (savedSettings.embeddings) {
			this.settings.embeddings = { ...this.settings.embeddings, ...savedSettings.embeddings };
		}
	}

	async saveSettings() {
		const data = await this.loadData() ?? {};
		data.settings = this.settings;
		await this.saveData(data);
		
		// Reinitialize the LLM in case API keys or model type changed
		if (this.llama) {
			this.llama = this.createLlama();
		}
	}

	/**
	 * Get the appropriate API key or credential for the selected model
	 */
	private getApiKeyForModel(): string {
		const { modelType, openai, anthropic } = this.settings;

		switch (modelType) {
			case 'openai':
				return openai.apiKey;
			case 'anthropic':
				return anthropic.apiKey;
			case 'ollama':
			case 'mirror':
				return ''; // These don't need API keys
			default:
				return '';
		}
	}

	/**
	 * Create the appropriate Llama instance based on model type
	 */
	private createLlama(): Llama {
		const apiKey = this.getApiKeyForModel();
		const statusCallback = (s: any) => status.set(s);
		const streamCallback = (token: string) => {
			// Append token to current chat message for streaming display
			const currentChat = this.chatStore.getCurrentChat();
			if (currentChat && currentChat.messages.length > 0) {
				const lastMessage = currentChat.messages[currentChat.messages.length - 1];
				if (lastMessage.role === 'assistant') {
					lastMessage.content += token;
				}
			}
		};
		const toolsConfig = this.settings.tools;

		let llama: Llama;
		
		switch (this.settings.modelType) {
			case 'mirror':
				llama = new MirrorLlama(apiKey, statusCallback);
				break;
			case 'ollama':
				llama = new OllamaLlama(apiKey, this.rag, statusCallback, this.settings.ollama.baseUrl, this.settings.ollama.model, toolsConfig);
				break;
			case 'openai':
			case 'anthropic':
			default:
				llama = new OpenAILlama(apiKey, this.rag, statusCallback, toolsConfig);
		}
		
		// Set the stream token callback
		llama.onStreamToken = streamCallback;
		
		return llama;
	}

	async triggerEmbeddingsUpdate() {
		try {
			new Notice("Starting embeddings update...");
			await this.rag.updateFromVault();
			this.settings.embeddings.lastUpdated = Date.now();
			await this.saveSettings();
			new Notice("Embeddings updated successfully!");
		} catch (error) {
			console.error("Embeddings update failed:", error);
			new Notice("Failed to update embeddings. See console for details.");
		}
	}
	

	async askLlama(messages: any) {
		// let mainResult = await this.llama.ask(messages)
		let mainResult = await this.llama.askWithTools(messages)
		// console.log("mainresult:", mainResult);
		return mainResult;
	}

	async update() {
		await this.rag.updateFromVault();
	}

	async test() {
		console.log("Testing test function called");
		new Notice('This is a notice!');
		// this.llama.test();
		// const retriever = this.rag.getRetriever();
		// const output = await retriever.invoke("Who is Governance of Iron");
		// console.log(output);
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

		// Model Selection Section
		const modelSection = containerEl.createDiv({ cls: 'setting-section' });
		this.addModelSection(modelSection);

		// Model-specific Configuration
		const configSection = containerEl.createDiv({ cls: 'setting-section' });
		this.addOpenAISection(configSection);
		this.addAnthropicSection(configSection);
		this.addOllamaSection(configSection);

		// Embeddings Section
		const embeddingsSection = containerEl.createDiv({ cls: 'setting-section' });
		this.addEmbeddingsSection(embeddingsSection);

		// Tools Section
		const toolsSection = containerEl.createDiv({ cls: 'setting-section' });
		this.addToolsSection(toolsSection);
	}

	private addModelSection(containerEl: HTMLElement): void {
		const heading = containerEl.createEl('h3', { cls: 'setting-section-header', text: 'Model Selection' });

		new Setting(containerEl)
			.setName('Select Model')
			.setDesc('Choose which LLM provider to use')
			.addDropdown(dropdown => dropdown
				.addOption('openai', 'OpenAI')
				.addOption('anthropic', 'Anthropic')
				.addOption('ollama', 'Ollama (Local)')
				.addOption('mirror', 'Mirror (Testing)')
				.setValue(this.plugin.settings.modelType)
				.onChange(async (value: string) => {
					this.plugin.settings.modelType = value as ModelType;
					await this.plugin.saveSettings();
					this.display(); // Refresh to show relevant sections
				}));
	}

	private addOpenAISection(containerEl: HTMLElement): void {
		if (this.plugin.settings.modelType !== 'openai') return;

		const heading = containerEl.createEl('h3', { cls: 'setting-section-header', text: 'OpenAI Configuration' });

		new Setting(containerEl)
			.setName('API Key')
			.setDesc('Your OpenAI API key (sk-...)')
			.addText(text => text
				.setPlaceholder('sk-...')
				.setValue(this.plugin.settings.openai.apiKey)
				.onChange(async (value) => {
					this.plugin.settings.openai.apiKey = value;
					await this.plugin.saveSettings();
				}));
	}

	private addAnthropicSection(containerEl: HTMLElement): void {
		if (this.plugin.settings.modelType !== 'anthropic') return;

		const heading = containerEl.createEl('h3', { cls: 'setting-section-header', text: 'Anthropic Configuration' });

		new Setting(containerEl)
			.setName('API Key')
			.setDesc('Your Anthropic API key')
			.addText(text => text
				.setPlaceholder('Enter your Anthropic API key')
				.setValue(this.plugin.settings.anthropic.apiKey)
				.onChange(async (value) => {
					this.plugin.settings.anthropic.apiKey = value;
					await this.plugin.saveSettings();
				}));
	}

	private addOllamaSection(containerEl: HTMLElement): void {
		if (this.plugin.settings.modelType !== 'ollama') return;

		const heading = containerEl.createEl('h3', { cls: 'setting-section-header', text: 'Ollama Configuration' });

		new Setting(containerEl)
			.setName('Base URL')
			.setDesc('The address where Ollama is running (e.g., http://localhost:11434)')
			.addText(text => text
				.setPlaceholder('http://localhost:11434')
				.setValue(this.plugin.settings.ollama.baseUrl)
				.onChange(async (value) => {
					this.plugin.settings.ollama.baseUrl = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Model Name')
			.setDesc('The Ollama model to use (e.g., llama2, gemma2, neural-chat)')
			.addText(text => text
				.setPlaceholder('llama2')
				.setValue(this.plugin.settings.ollama.model)
				.onChange(async (value) => {
					this.plugin.settings.ollama.model = value;
					await this.plugin.saveSettings();
				}));
	}

	private addEmbeddingsSection(containerEl: HTMLElement): void {
		const heading = containerEl.createEl('h3', { cls: 'setting-section-header', text: 'Embeddings' });

		new Setting(containerEl)
			.setName('Update Embeddings')
			.setDesc('Generate embeddings for your vault to improve search and context retrieval')
			.addButton(button => button
				.setButtonText('Trigger Update')
				.onClick(async () => {
					button.setDisabled(true);
					button.setButtonText('Updating...');
					try {
						await this.plugin.triggerEmbeddingsUpdate();
					} finally {
						button.setDisabled(false);
						button.setButtonText('Trigger Update');
					}
				}));

		// Show last update time if available
		if (this.plugin.settings.embeddings.lastUpdated) {
			const lastUpdated = new Date(this.plugin.settings.embeddings.lastUpdated);
			const lastUpdateEl = containerEl.createEl('p', { 
				text: `Last updated: ${lastUpdated.toLocaleString()}` 
			});
			lastUpdateEl.style.color = 'var(--text-muted)';
			lastUpdateEl.style.fontSize = '0.85em';
			lastUpdateEl.style.marginTop = '-10px';
		}
	}

	private addToolsSection(containerEl: HTMLElement): void {
		const heading = containerEl.createEl('h3', { cls: 'setting-section-header', text: 'Agent Tools' });

		const toolMetadata = ToolsFactory.getAllToolMetadata();

		for (const tool of toolMetadata) {
			new Setting(containerEl)
				.setName(tool.settingName)
				.setDesc(tool.settingDescription)
				.addToggle(toggle => toggle
					.setValue((this.plugin.settings.tools as any)[tool.toolName] ?? tool.defaultEnabled)
					.onChange(async (value) => {
						(this.plugin.settings.tools as any)[tool.toolName] = value;
						await this.plugin.saveSettings();
					}));
		}
	}
}
