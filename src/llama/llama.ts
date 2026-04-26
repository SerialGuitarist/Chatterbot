
// import { messages } from "./state/chat";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";

// import { tool } from "langchain";
import { tool } from "@langchain/core/tools";
import * as z from "zod";
import { ToolsFactory, type ToolsConfig } from "../tools/toolsLibrary";
import type { ChatMessage } from "../chats/chat";


function toLC(msg: any) {
	if (msg.role === "assistant") return new AIMessage(msg.content);
	if (msg.role === "system") return new SystemMessage(msg.content);
	return new HumanMessage(msg.content);
}

export type LlamaStatus =
	| { phase: "idle" }
	| { phase: "retrieving" }
	| { phase: "calling_model" }
	| { phase: "thinking"; detail?: string }
	| { phase: "done" }
	| { phase: "error"; message: string };

// backwards compatibility lol
export type Llama = ManualLlama;

/**
 * ManualLlama - Base class for manual tool use implementation
 * Agentic tool use with @langchain/langgraph doesn't work in Obsidian due to Node.js built-in
 * dependencies, so we implement the agent loop manually for provider-agnostic tool support.
 * 
 * RAG and tools are specific to ManualLlama - the base Llama class provides simple chat.
 * Subclasses should implement initializeModel() to set up their specific LLM provider.
 */
export abstract class ManualLlama {
	model: ChatOpenAI | null = null; // ChatOpenAI for OpenAI, null for others (handled per-provider)
	providerName: string; // e.g. "OpenAI", "Ollama", "Mirror"
	modelName: string; // e.g. "gpt-4o-mini", "gemma2", "mirror"
	onStatus?: (status: LlamaStatus) => void; // callback for status updates the little text box above the chat input
	onStreamToken?: (token: string) => void; // Callback for streaming tokens
	systemMessage: any = null;
	abortSignal?: AbortSignal; // Signal to abort ongoing requests
	tooledModel: any;
	tools: any[] = [];
	protected tokenStreaming: boolean = false; // If true, extractContent returns individual tokens; if false, returns cumulative content
	rag?: any; // RAGStore // embed this into the tool itself? maybe not, since some providers might want to use it for retrieval in the agent loop instead of a tool call
	toolsConfig: ToolsConfig; // which of the tools are toggled on
	tooledSystemMessage: string; // base message + tool descriptions for the model when tools are enabled
	apiKey: string;
	maxAgentIterations: number = 10; // Max iterations for the agent loop to prevent infinite loops

	constructor(
		apiKey: string,
		providerName: string,
		modelName: string,
		onStatus?: (s: LlamaStatus) => void,
		rag?: any,
		toolsConfig?: ToolsConfig,
		maxAgentIterations: number = 10
	) {
		this.apiKey = apiKey;
		this.providerName = providerName;
		this.modelName = modelName;
		this.rag = rag;
		this.toolsConfig = toolsConfig || { retrieve: false, notice: true, listMarkdownFiles: true };
		this.maxAgentIterations = maxAgentIterations;
		
		this.onStatus = onStatus;
		this.status({ phase: "thinking", detail: "Setting up model"});

		this.systemMessage =  {
			role: "system",
			content: 
			"You are ChatterBot, a helpful AI assistant attached to an Obsidian Vault, " +
			"a note-taking knowledge base." + 
			"Your primary role is to help users with questions about this vault." +
			`You are running on ${this.providerName} ${this.modelName}.\n`
		};

		// Build system message with tool descriptions
		const toolInstructions = ToolsFactory.getToolInstructions(this.toolsConfig, this.rag, this.rag?.vault);
		
		this.tooledSystemMessage = this.systemMessage.content + (toolInstructions ? " " + toolInstructions : "");
		// console.log("Tooled system message:", this.tooledSystemMessage);
		// console.log(this.toolsConfig);


		this.initializeTools();
		// console.log(this.tools);
		this.initializeModel();
		this.status({ phase: "idle"});
	}

	// if someone cares about its progress, it will notify them through this
	protected status(s: LlamaStatus) {
		// ?.(s) calls the function only if it exists with the argument s
		this.onStatus?.(s);
	}

	/**
	 * Initialize tools based on configuration
	 */
	private initializeTools() {
		this.tools = ToolsFactory.createTools(
			this.toolsConfig,
			this.rag,
			(s: any) => this.status(s),
			this.rag?.vault
		);
	}

	/**
	 * Provider-specific model initialization
	 * Subclasses must implement this to set up their model and tooledModel
	 */
	protected abstract initializeModel(): void;

	/**
	 * Template method: Handle provider-specific message formatting
	 * Subclasses must implement to format messages for their provider
	 */
	protected abstract formatMessages(messages: any[]): any;

	/**
	 * Template method: Get a stream from the provider
	 * @param formattedMessages - Messages in provider format (from formatMessages)
	 * @param useTools - Whether tools should be available
	 */
	protected abstract getStream(formattedMessages: any, useTools: boolean): Promise<AsyncIterable<any>>;

	/**
	 * Template method: Extract content string from a provider stream chunk
	 * Different providers may return chunks in different formats
	 */
	protected abstract extractContent(chunk: any): string;

	/**
	 * Template method: Parse tool calls from raw response content
	 * For providers like Ollama that return text-based tool calls.
	 * Return undefined/null if no tool calls found or if provider returns structured tool_calls
	 */
	protected parseRawToolCalls(content: string): any[] | undefined {
		return undefined; // Override in subclass if needed
	}

	/**
	 * Template method: Get structured tool calls from response object (if provider returns them)
	 * For providers like OpenAI that return structured tool_calls in response
	 */
	protected getStructuredToolCalls(response: any): any[] | undefined {
		return response.tool_calls || response.additional_kwargs?.tool_calls;
	}

	/**
	 * Template method orchestrating streaming without tools
	 */
	protected async invokeModel(messages: any[]): Promise<string> {
		this.status({ phase: "calling_model" });
		const formattedMessages = this.formatMessages(messages);
		
		const stream = await this.getStream(formattedMessages, false);

		let fullContent = "";
		for await (const chunk of stream) {
			// Check if aborted during streaming
			if (this.abortSignal?.aborted) {
				break;
			}

			if (this.tokenStreaming) {
				// Provider returns individual tokens (e.g. Ollama /api/generate)
				const token = this.extractContent(chunk);
				if (token) {
					fullContent += token;
					if (this.onStreamToken) this.onStreamToken(token);
				}
			} else {
				// Provider returns cumulative content (e.g. OpenAI via LangChain)
				const contentStr = this.extractContent(chunk);
				const newContent = contentStr.slice(fullContent.length);
				if (newContent) {
					fullContent = contentStr;
					if (this.onStreamToken) this.onStreamToken(newContent);
				}
			}
		}
		return fullContent;
	}

	/**
	 * Simple chat - no tool handling
	 */
	async ask(originalMessages: any): Promise<ChatMessage[]> {
		try {
			const messages = [
				this.systemMessage,
				...originalMessages
			].map(toLC);

			const content = await this.invokeModel(messages);

			this.status({ phase: "idle" });
			return [{
				role: "assistant",
				content: content
			}];
		} catch (error) {
			this.status({ phase: "error", message: String(error) });
			throw error;
		}
	}

	/**
	 * Template method orchestrating streaming with tools
	 */
	protected async invokeTooledModel(messages: any[]): Promise<any> {
		this.status({ phase: "calling_model" });
		const formattedMessages = this.formatMessages(messages);
		const stream = await this.getStream(formattedMessages, true);

		let fullContent = "";
		let lastResponse: any = null;

		for await (const chunk of stream) {
			// Check if aborted during streaming
			if (this.abortSignal?.aborted) {
				break;
			}

			if (this.tokenStreaming) {
				const token = this.extractContent(chunk);
				if (token) {
					fullContent += token;
					if (this.onStreamToken) this.onStreamToken(token);
				}
			} else {
				const contentStr = this.extractContent(chunk);
				const newContent = contentStr.slice(fullContent.length);
				if (newContent) {
					fullContent = contentStr;
					if (this.onStreamToken) this.onStreamToken(newContent);
				}
			}
			lastResponse = chunk;
		}

		// Extract tool calls: try structured first, then raw text-based
		let toolCalls = this.getStructuredToolCalls(lastResponse);
		if (!toolCalls) {
			toolCalls = this.parseRawToolCalls(fullContent);
		}

		
		let returnObject =  {
			content: fullContent,
			tool_calls: toolCalls,
			raw_response: lastResponse
		};
		console.log(returnObject); // TODO remove after testing
		return returnObject;
	}

	/**
	 * Parse response content and split into text/tool segments for interweaving
	 */
	protected parseAndInterleaveToolCalls(content: string, toolCalls: any[]): Array<{ type: 'text' | 'tool'; content: string; toolCall?: any }> {
		const segments: Array<{ type: 'text' | 'tool'; content: string; toolCall?: any }> = [];
		const toolRegex = /<tool(?:_(?:call|use))?>.*?<\/tool(?:_(?:call|use))?>/g;
		
		let lastIndex = 0;
		let match;
		
		while ((match = toolRegex.exec(content)) !== null) {
			// Add text before this tool call
			const textBefore = content.slice(lastIndex, match.index).trim();
			if (textBefore) {
				segments.push({ type: 'text', content: textBefore });
			}
			
			// Find matching tool call in toolCalls array
			// Extract tool name from the XML tag
			const toolMatch = match[0].match(/<tool(?:_(?:call|use))?>( \w+)/);
			if (toolMatch) {
				const toolName = toolMatch[1].trim();
				const toolCall = toolCalls.find((tc: any) => tc.name === toolName);
				if (toolCall) {
					segments.push({ type: 'tool', content: match[0], toolCall });
				}
			}
			
			lastIndex = match.index + match[0].length;
		}
		
		// Add remaining text after last tool call
		const remainingText = content.slice(lastIndex).trim();
		if (remainingText) {
			segments.push({ type: 'text', content: remainingText });
		}
		
		return segments;
	}

	/**
	 * Core agent loop with tool use - returns array of ChatMessage objects including tool results
	 */
	async askWithTools(originalMessages: any): Promise<ChatMessage[]> {
		try {
			this.status({ phase: "thinking", detail: "Agent reasoning" });
			const resultMessages: ChatMessage[] = [];
			let contextStr = "";

			// Agent loop with max iterations
			for (let i = 0; i < this.maxAgentIterations; i++) {
				// Check if aborted - exit gracefully keeping accumulated messages
				if (this.abortSignal?.aborted) {
					this.status({ phase: "idle" });
					return resultMessages;
				}

				const messages = [
					this.tooledSystemMessage ? { role: "system", content: this.tooledSystemMessage } : this.systemMessage,
					...originalMessages,
					{ role: "system", content: contextStr ? "Context from tool results:\n" + contextStr : "" }
				].map(toLC);

				const response = await this.invokeTooledModel(messages);
				const toolCalls = response.tool_calls;

				if (toolCalls && toolCalls.length > 0) {
					const segments = this.parseAndInterleaveToolCalls(response.content, toolCalls);
					resultMessages.length = 0;

					for (const segment of segments) {
						if (this.abortSignal?.aborted) {
							this.status({ phase: "idle" });
							return resultMessages;
						}

						if (segment.type === 'text') {
							resultMessages.push({ role: "assistant", content: segment.content });
						} else if (segment.type === 'tool' && segment.toolCall) {
							const tool = this.tools.find((t: any) => t.name === segment.toolCall.name);
							if (tool) {
								const result = await tool.invoke(segment.toolCall.args);

								contextStr += `Output of \`${segment.toolCall.name}\` tool:\n${result}\n---\n`;

								const toolResultMsg: ChatMessage = {
									role: "tool_result",
									toolName: segment.toolCall.name,
									content: result,
									displayArgs: segment.toolCall.args,
									isExpanded: false
								};

								const displayMetadata = (tool as any).displayMetadata;
								if (displayMetadata) {
									const fullData = displayMetadata.extractFullData?.();
									const displayMsg = ToolsFactory.formatDisplayMessage(
										displayMetadata.displayTemplate,
										{ ...segment.toolCall.args, count: fullData?.length || 0 }
									);
									toolResultMsg.displayMessage = displayMsg;
									toolResultMsg.fullData = fullData;
								}

								resultMessages.push(toolResultMsg);
							}
						}
					}

					this.status({ phase: "thinking", detail: "Agent reasoning with context" });
					continue;
				}

				// No tool calls — agent is done
				resultMessages.length = 0;
				if (response.content?.trim()) {
					resultMessages.push({ role: "assistant", content: response.content.trim() });
				}

				this.status({ phase: "idle" });
				return resultMessages;
			}

			// Max iterations reached — do a final non-tool response
			const finalMessages = [
				this.systemMessage,
				...originalMessages,
				{ role: "system", content: contextStr ? "Context from tool results:\n" + contextStr : "" }
			].map(toLC);

			const content = await this.invokeModel(finalMessages);

			resultMessages.length = 0;
			if (content?.trim()) {
				resultMessages.push({ role: "assistant", content: content.trim() });
			}

			this.status({ phase: "idle" });
			return resultMessages;

		} catch (err) {
			this.status({ phase: "error", message: String(err) });
			throw err;
		}
	}

	async test() {
		console.log("Manual tool use test");
	}
}

/**
 * OpenAILlama - OpenAI provider with manual tool use
 * Uses ChatOpenAI with bindTools() for structured tool invocation
 */
export class OpenAILlama extends ManualLlama {
	constructor(
		apiKey: string,
		rag: any = null,
		onStatus?: (s: LlamaStatus) => void,
		toolsConfig?: ToolsConfig
	) {
		super(
			apiKey, // apiKey
			"OpenAI", // providerName
			"gpt-4o-mini", // modelName
			onStatus, // onStatus
			rag, // rag
			toolsConfig // toolsConfig
		);
	}

	protected initializeModel(): void {
		const config: any = {
			apiKey: this.apiKey,
			model: "gpt-4o-mini",
			temperature: 0.7
		};
		this.model = new ChatOpenAI(config);
		console.log("OpenAI tools being bound:", this.tools.map((t: any) => ({ name: t.name, description: t.description })));
		this.tooledModel = this.model!.bindTools(this.tools);
	}

	protected formatMessages(messages: any[]): any {
		// LC messages are already in the right format
		return messages;
	}

	protected async getStream(formattedMessages: any, useTools: boolean): Promise<AsyncIterable<any>> {
		const model = useTools ? this.tooledModel : this.model!;
		try {
			return await model.stream(formattedMessages);
		} catch (error) {
			console.error("Streaming error:", error);
			// Fallback: return a generator wrapping the invoke result
			const response = await model.invoke(formattedMessages);
			return (async function* () {
				yield response;
			})();
		}
	}

	protected extractContent(chunk: any): string {
		if (!chunk.content) return "";
		const content = chunk.content;
		// Handle content that might be string or array
		return typeof content === 'string' ? content : (Array.isArray(content) ? content.map((c: any) => c.text || '').join('') : String(content));
	}

	override async test() {
		console.log("OpenAI tool use test");
		const messages = [{"role": "user", "content": "Test message"}].map(toLC);
		const response = await this.model!.invoke(messages);
		console.log("Response:", response.content);
	}
}

/**
 * Mirror provider - echoes back whatever the user sends
 * Useful for testing and debugging
 */
export class MirrorLlama extends ManualLlama {
	constructor(
		apiKey: string,
		onStatus?: (s: LlamaStatus) => void
	) {
		super(
			"", // apiKey
			"Mirror", // providerName
			"mirror", // modelName
			onStatus, // onStatus
			undefined, // rag
			undefined // toolsConfig
		);
		this.systemMessage = {
			role: "system",
			content: "You are a mirror. You echo back whatever the user sends, nothing more."
		};
		this.status({ phase: "idle"});
	}

	protected initializeModel(): void {
		// Mirror doesn't need a real model
		this.model = null;
		this.tooledModel = null;
	}

	protected formatMessages(messages: any[]): any {
		return messages;
	}

	protected async getStream(formattedMessages: any, useTools: boolean): Promise<AsyncIterable<any>> {
		const lastMessage = formattedMessages[formattedMessages.length - 1];
		if (!lastMessage) {
			return (async function* () {})();
		}
		return (async function* () {
			yield { content: lastMessage.content };
		})();
	}

	protected extractContent(chunk: any): string {
		return chunk.content || "";
	}

	override async ask(messages: any): Promise<ChatMessage[]> {
		try {
			this.status({ phase: "thinking", detail: "Mirroring your message" });

			const lastMessage = messages[messages.length - 1];
			if (!lastMessage) {
				throw new Error("No message found");
			}

			let content: string;
			if (lastMessage.role === "user" || lastMessage._type === "human" || lastMessage.content) {
				content = lastMessage.content;
			} else {
				throw new Error("Last message has no content");
			}

			const words = content.split(/(\s+)/);
			for (const word of words) {
				if (this.abortSignal?.aborted) break;
				if (word.trim() && this.onStreamToken) {
					this.onStreamToken(word + ' ');
					await new Promise(resolve => setTimeout(resolve, 50));
				}
			}

			this.status({ phase: "idle" });
			return [{ role: "assistant", content }];
		} catch (error) {
			this.status({ phase: "error", message: String(error) });
			throw error;
		}
	}

	override async test() {
		console.log("Mirror test - just echoing back");
	}
}

/**
 * Ollama provider - uses local Ollama instance
 * Handles streaming responses from Ollama's /api/generate endpoint
 * Extends ManualLlama to support tool use (retrieve) with manual implementation
 */
export class OllamaLlama extends ManualLlama {
	baseUrl: string;

	constructor(
		apiKey: string,
		rag: any = null,
		onStatus?: (s: LlamaStatus) => void,
		baseUrl?: string,
		model?: string,
		toolsConfig?: ToolsConfig
	) {
		const modelName = model || "llama2";
		super(
			apiKey, // apiKey
			"Ollama", // providerName
			modelName, // modelName
			onStatus, // onStatus
			rag, // rag
			toolsConfig // toolsConfig
		);
		this.baseUrl = baseUrl || "http://localhost:11434";
	}

	protected initializeModel(): void {
		// Ollama returns individual tokens per chunk, not cumulative content
		this.tokenStreaming = true;
		this.model = null;
		this.tooledModel = null;
	}

	protected formatMessages(messages: any[]): { messageTexts: string } {
		const messageTexts = messages.map(m => {
			const role = m._type === "system" ? "system" : (m._type === "ai" ? "assistant" : "user");
			return `${role}: ${m.content}`;
		}).join("\n");
		
		return { messageTexts };
	}

	protected async getStream(formattedMessages: any, useTools: boolean): Promise<AsyncIterable<any>> {
		const { messageTexts } = formattedMessages;
		const systemPrompt = this.systemMessage;
		
		let fullPrompt: string;
		if (useTools) {
			const toolDescriptions = this.tools.map((t: any) => `Tool: ${t.name}\nDescription: ${t.description}`).join("\n");
			fullPrompt = `${systemPrompt}\n\n${toolDescriptions}\n\n${messageTexts}`;
		} else {
			fullPrompt = `${systemPrompt}\n\n${messageTexts}`;
		}

		try {
			const fetchInit: any = {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					model: this.modelName,
					prompt: fullPrompt,
					stream: true,
				}),
			};

			if (this.abortSignal) {
				fetchInit.signal = this.abortSignal;
			}

			const response = await fetch(`${this.baseUrl}/api/generate`, fetchInit);

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Ollama API error (${response.status}): ${errorText}`);
			}

			// Return an async generator that yields parsed JSON lines
			return (async function* () {
				const reader = response.body!.getReader();
				const decoder = new TextDecoder();

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					const chunk = decoder.decode(value);
					const lines = chunk.split('\n').filter(line => line.trim());

					for (const line of lines) {
						try {
							const data = JSON.parse(line);

							yield data;
						} catch (e) {
							// Skip invalid JSON lines
						}
					}
				}
			})();
		} catch (error) {
			throw new Error(`Failed to invoke Ollama model: ${error}`);
		}
	}

	protected extractContent(chunk: any): string {
		if (!chunk.response) return "";
		return chunk.response;
	}

	protected parseRawToolCalls(content: string): any[] | undefined {
		// Parse tool calls from response - support both formats:
		// 1. <tool_call>name|{args}</tool_call> - with arguments
		// 2. <tool_use>name</tool_use> - without arguments
		const toolCalls: any[] = [];
		
		// Try format with arguments first
		const toolCallWithArgsRegex = /<tool(?:_(?:call|use))?>( \w+)\|(\{.*?\})<\/tool(?:_(?:call|use))?>/g;
		let match;
		while ((match = toolCallWithArgsRegex.exec(content)) !== null) {
			try {
				const toolName = match[1].trim();
				const args = JSON.parse(match[2]);
				toolCalls.push({
					name: toolName,
					args: args
				});
			} catch (e) {
				// Skip parsing errors
			}
		}
		
		// Then try format without arguments
		const toolCallNoArgsRegex = /<tool(?:_(?:call|use))?>( \w+)<\/tool(?:_(?:call|use))?>/g;
		while ((match = toolCallNoArgsRegex.exec(content)) !== null) {
			const toolName = match[1].trim();
			if (!toolCalls.some(tc => tc.name === toolName)) {
				toolCalls.push({
					name: toolName,
					args: {}
				});
			}
		}

		return toolCalls.length > 0 ? toolCalls : undefined;
	}

	override async test() {
		try {
			this.status({ phase: "calling_model" });
			
			const fetchInit: any = {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					model: this.modelName,
					prompt: "Hello, what is 2+2?",
					stream: false,
				}),
			};

			// Add abort signal if one was set
			if (this.abortSignal) {
				fetchInit.signal = this.abortSignal;
			}

			const response = await fetch(`${this.baseUrl}/api/generate`, fetchInit);

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Ollama API error (${response.status}): ${errorText}. Make sure Ollama is running and model "${this.modelName}" exists.`);
			}

			const data = await response.json();
			console.log("Ollama response:", data.response);
			this.status({ phase: "idle" });
		} catch (error) {
			console.error("Ollama test failed:", error);
			this.status({ phase: "error", message: String(error) });
		}
	}
}









