export type ModelType = 'openai' | 'anthropic' | 'ollama' | 'mirror';

export interface OpenAISettings {
	apiKey: string;
}

export interface AnthropicSettings {
	apiKey: string;
}

export interface OllamaSettings {
	baseUrl: string; // e.g., http://localhost:11434
	model: string; // e.g., llama2, gemma2, gemma3, etc.
}

export interface MirrorSettings {
	// Mirror provider doesn't need any configuration
}

// Tools configuration is a record of tool names to enabled/disabled
// Tool names and defaults come from toolsLibrary.ts > ToolsFactory.TOOL_REGISTRY
// This allows adding new tools without modifying this file
export interface ToolsSettings extends Record<string, boolean> {
	// Tool-specific properties (all required, will be set by DEFAULT_SETTINGS from registry)
	retrieve: boolean;
	notice: boolean;
	listMarkdownFiles: boolean;
}

export interface ChatterbotPluginSettings {
	modelType: ModelType;
	openai: OpenAISettings;
	anthropic: AnthropicSettings;
	ollama: OllamaSettings;
	mirror: MirrorSettings;
	embeddings: {
		enabled: boolean;
		lastUpdated?: number;
	};
	tools: ToolsSettings;
}

export const DEFAULT_SETTINGS: ChatterbotPluginSettings = {
	modelType: 'openai',
	openai: {
		apiKey: '',
	},
	anthropic: {
		apiKey: '',
	},
	ollama: {
		baseUrl: 'http://localhost:11434',
		model: 'llama2',
	},
	mirror: {},
	embeddings: {
		enabled: false,
		lastUpdated: undefined,
	},
	tools: {
		// Defaults match toolsLibrary.ts > ToolsFactory.TOOL_REGISTRY
		// Add new tools to TOOL_REGISTRY instead of here
		retrieve: false,
		notice: true,
		listMarkdownFiles: true,
	},
};
