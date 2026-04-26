import type { ChatterbotPluginSettings } from "./settings";


/**
 * Validate that the selected model is properly configured
 */
export function isModelConfigValid(settings: ChatterbotPluginSettings): boolean {
	const { modelType, openai, anthropic, ollama } = settings;

	switch (modelType) {
		case 'openai':
			return openai.apiKey.trim() !== '';
		case 'anthropic':
			return anthropic.apiKey.trim() !== '';
		case 'ollama':
			return ollama.baseUrl.trim() !== '';
		case 'mirror':
			return true; // Mirror doesn't need configuration
		default:
			return false;
	}
}
