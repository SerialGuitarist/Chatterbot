import { ChatOpenAI } from "@langchain/openai";
import type { ChatterbotPluginSettings, ModelType } from "./settings";

/**
 * Factory function to create the appropriate LangChain chat model
 * based on the selected model type and configuration
 */
export async function createChatModel(settings: ChatterbotPluginSettings) {
	const { modelType, openai, anthropic, ollama } = settings;

	switch (modelType) {
		case 'openai':
			return new ChatOpenAI({
				apiKey: openai.apiKey,
				model: "gpt-4o-mini",
				temperature: 0.7,
			});

		case 'anthropic':
			// Future: Uncomment when @langchain/anthropic is available
			// import { ChatAnthropic } from "@langchain/anthropic";
			// return new ChatAnthropic({
			// 	apiKey: anthropic.apiKey,
			// 	model: "claude-3-5-sonnet-20241022",
			// 	temperature: 0.7,
			// });
			throw new Error('Anthropic support coming soon - currently requires @langchain/anthropic package');

		case 'ollama':
			// Future: Use Ollama API or OllamaEmbeddings
			// For now, you can use fetch directly or a custom implementation
			throw new Error('Ollama support coming soon - custom implementation needed');

		default:
			throw new Error(`Unknown model type: ${modelType}`);
	}
}

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
