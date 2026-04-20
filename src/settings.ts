export type ModelType = 'openai' | 'anthropic' | 'ollama' | 'mirror';

export interface OpenAISettings {
	apiKey: string;
}

export interface AnthropicSettings {
	apiKey: string;
}

export interface OllamaSettings {
	baseUrl: string; // e.g., http://localhost:11434
	model: string; // e.g., llama2, gemma2, etc.
}

export interface MirrorSettings {
	// Mirror provider doesn't need any configuration
}

export interface ChatterbotPluginSettings {
	modelType: ModelType;
	openai: OpenAISettings;
	anthropic: AnthropicSettings;
	ollama: OllamaSettings;	mirror: MirrorSettings;	embeddings: {
		enabled: boolean;
		lastUpdated?: number;
	};
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
	},	mirror: {},	embeddings: {
		enabled: false,
		lastUpdated: undefined,
	},
};
