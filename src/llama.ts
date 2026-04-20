
// import { messages } from "./state/chat";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";

// import { tool } from "langchain";
import { tool } from "@langchain/core/tools";
import * as z from "zod";
import { ToolsFactory, type ToolsConfig } from "./tools/toolsLibrary";
import type { ChatMessage } from "./chat";


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

export class Llama {
	model: ChatOpenAI | null;
	onStatus?: (status: LlamaStatus) => void;
	onStreamToken?: (token: string) => void; // Callback for streaming tokens
	systemMessage: any = null;
	abortSignal?: AbortSignal; // Signal to abort ongoing requests
	
	constructor(apiKey: string, onStatus?: (s: LlamaStatus) => void, skipModelInit: boolean = false) {
		if (skipModelInit) {
			// For OllamaLlama and other providers that don't use ChatOpenAI
			this.model = null;
		} else {
			// For OpenAI and Anthropic
			const config: any = {
				apiKey: apiKey,
				model: "gpt-4o-mini",
				temperature: 0.7
			};
			this.model = new ChatOpenAI(config);
		}
		this.onStatus = onStatus;
		this.systemMessage =  {
			role: "system",
			content: "You are ChatterBot, a helpful AI assistant attached to an Obsidian Vault, a note-taking knowledge base. Your primary role is to help users with questions about this vault."
		};
		this.status({ phase: "idle"});
	}

	// if someone cares about its progress, it will notify them through this
	protected status(s: LlamaStatus) {
		// ?.(s) calls the function only if it exists with the argument s
		this.onStatus?.(s);
	}

	async ask(messages: any): Promise<ChatMessage[]> {
		try {
			const augmentedMessages = [
				this.systemMessage,
				...messages
			].map(toLC);

			this.status({ phase: "calling_model"});
			const result = await this.model!.invoke(augmentedMessages);
			this.status({ phase: "idle"});

			// Handle content that might be string or array
			let contentStr = typeof result.content === 'string' ? result.content : String(result.content);

			return [{
				role: "assistant",
				content: contentStr
			}];
		} catch (error) {
			this.status({ phase: "error", message: String(error)});
			throw error;
		}
	}

	async test() {
		console.log("calling test");
		const aiMsg = await this.model!.invoke([])
		console.log(aiMsg)
	}

}

/**
 * ManualLlama - Base class for manual tool use implementation
 * Agentic tool use with @langchain/langgraph doesn't work in Obsidian due to Node.js built-in
 * dependencies, so we implement the agent loop manually for provider-agnostic tool support.
 * 
 * RAG and tools are specific to ManualLlama - the base Llama class provides simple chat.
 * Subclasses should implement initializeModel() to set up their specific LLM provider.
 */
export abstract class ManualLlama extends Llama {
	tooledModel: any;
	tools: any[] = [];
	rag: any; // RAGStore
	toolsConfig: ToolsConfig;

	constructor(
		apiKey: string,
		rag: any = null,
		onStatus?: (s: LlamaStatus) => void,
		toolsConfig?: ToolsConfig
	) {
		// Skip default OpenAI init - providers will set up their own model
		super(apiKey, onStatus, true);
		this.apiKey = apiKey;
		this.rag = rag;
		this.toolsConfig = toolsConfig || { retrieve: true };
		
		this.status({ phase: "thinking", detail: "Setting up model"});

		// Build system message with tool descriptions
		const toolInstructions = ToolsFactory.getToolInstructions(this.toolsConfig, this.rag);
		
		this.systemMessage = {
			role: "system",
			content: `You are ChatterBot, a helpful AI assistant attached to an Obsidian Vault, a note-taking knowledge base. Your primary role is to help users with questions about this vault.${
				toolInstructions ? " " + toolInstructions : ""
			}`
		};

		this.initializeTools();
		this.initializeModel();
		this.status({ phase: "idle"});
	}

	apiKey: string;

	/**
	 * Initialize tools based on configuration
	 */
	private initializeTools() {
		this.tools = ToolsFactory.createTools(
			this.toolsConfig,
			this.rag,
			(s: any) => this.status(s)
		);
	}

	/**
	 * Provider-specific model initialization
	 * Subclasses must implement this to set up their model and tooledModel
	 */
	protected abstract initializeModel(): void;

	/**
	 * Provider-specific tool invocation
	 * Subclasses must implement how to invoke a model with tools
	 */
	protected abstract invokeTooledModel(messages: any[]): Promise<any>;

	/**
	 * Core agent loop - returns array of ChatMessage objects including tool results
	 */
	override async ask(originalMessages: any): Promise<ChatMessage[]> {
		try {
			this.status({ phase: "thinking", detail: "Agent reasoning" });
			const resultMessages: ChatMessage[] = [];
			let contextStr = "";

			// Agent loop with max 5 iterations
			for (let i = 0; i < 5; i++) {
				let messages = [
					this.systemMessage,
					...originalMessages,
					{role: "system", content: contextStr ? "Context from tool results:\n" + contextStr : ""}
				].map(toLC);

				const response = await this.invokeTooledModel(messages);

				console.log("Agent response:", {
					content: response.content,
					tool_calls: response.tool_calls,
				});

				// Check for tool_calls
				let toolCalls = response.tool_calls || response.additional_kwargs?.tool_calls;
				
				// Parse text-based tool calls from content
				let contentToolCalls: any[] = [];
				if (!toolCalls && response.content && typeof response.content === 'string') {
					const toolCallRegex = /<tool_call>(\w+)\|(\{.*?\})<\/tool_call>/g;
					let match;
					while ((match = toolCallRegex.exec(response.content)) !== null) {
						try {
							const toolName = match[1];
							const args = JSON.parse(match[2]);
							contentToolCalls.push({ name: toolName, args });
						} catch (e) {
							console.error("Failed to parse tool call:", match[0], e);
						}
					}
				}
				
				toolCalls = toolCalls || (contentToolCalls.length > 0 ? contentToolCalls : null);
				
				if (toolCalls && toolCalls.length > 0) {
					// STEP 1: Clean content by removing tool_call markers
					let cleanContent = response.content;
					if (contentToolCalls.length > 0) {
						cleanContent = response.content.replace(/<tool_call>.*?<\/tool_call>/g, '').trim();
						console.log("Cleaned content:", cleanContent);
					}
					
					// STEP 2: Add clean content as assistant message if non-empty
					if (cleanContent.length > 0) {
						resultMessages.push({
							role: "assistant",
							content: cleanContent
						});
					}
					
					// STEP 3: Process each tool invocation and create tool_result messages
					for (const toolCall of toolCalls) {
						const tool = this.tools.find((t: any) => t.name === toolCall.name);
						if (tool) {
							console.log(`Invoking tool: ${toolCall.name}`, toolCall.args);
							const result = await tool.invoke(toolCall.args);
							
							// For LLM context (internal - raw result)
							contextStr += `Output of \`${toolCall.name}\` tool:\n${result}\n---\n`;
							
							// Create tool_result message for user display
							const toolResultMsg: ChatMessage = {
								role: "tool_result",
								toolName: toolCall.name,
								content: result,  // Raw content LLM sees
								displayArgs: toolCall.args,
								isExpanded: false
							};
							
							// Get display template and metadata from tool definition
							const toolDef = ToolsFactory.getToolDefinitionByName(
								toolCall.name, 
								this.toolsConfig, 
								this.rag
							);
							
							if (toolDef) {
								// Format display message using template
								const displayMsg = ToolsFactory.formatDisplayMessage(
									toolDef.displayMetadata.displayTemplate,
									{
										...toolCall.args,
										count: toolDef.displayMetadata.extractFullData?.()?.length || 0
									}
								);
								toolResultMsg.displayMessage = displayMsg;
								toolResultMsg.fullData = toolDef.displayMetadata.extractFullData?.();
								console.log("Tool result display:", displayMsg);
							}
							
							resultMessages.push(toolResultMsg);
						}
					}
					
					this.status({ phase: "thinking", detail: "Agent reasoning with context" });
					continue;
				}

				// No tool calls - agent is done
				if (response.content && response.content.trim().length > 0) {
					resultMessages.push({
						role: "assistant",
						content: response.content.trim()
					});
				}
				
				this.status({ phase: "idle" });
				return resultMessages;
			}

			// Max iterations reached - do final response
			const finalMessages = [
				this.systemMessage,
				...originalMessages,
				{role: "system", content: contextStr ? "Context from tool results:\n" + contextStr : ""}
			].map(toLC);

			const response = await this.model!.invoke(finalMessages);
			
			// Handle content that might be string or array
			const contentStr = typeof response.content === 'string' ? response.content : String(response.content);
			
			if (contentStr && contentStr.trim().length > 0) {
				resultMessages.push({
					role: "assistant",
					content: contentStr.trim()
				});
			}
			
			this.status({ phase: "idle" });
			return resultMessages;

		} catch (err) {
			this.status({ phase: "error", message: String(err) });
			throw err;
		}
	}

	override async test() {
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
		toolsConfig?: any
	) {
		super(apiKey, rag, onStatus, toolsConfig);
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

	protected async invokeTooledModel(messages: any[]): Promise<any> {
		return await this.tooledModel.invoke(messages);
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
export class MirrorLlama extends Llama {
	constructor(
		apiKey: string,
		onStatus?: (s: LlamaStatus) => void
	) {
		super(apiKey, onStatus);
		this.systemMessage = {
			role: "system",
			content: "You are a mirror. You echo back whatever the user sends, nothing more."
		};
		this.status({ phase: "idle"});
	}

	override async ask(messages: any): Promise<ChatMessage[]> {
		try {
			this.status({ phase: "thinking", detail: "Mirroring your message" });
			
			// Get the last user message
			const lastMessage = messages[messages.length - 1];
			if (!lastMessage || lastMessage.role !== "user") {
				throw new Error("No user message found");
			}

			// Simulate a brief delay to make it feel more natural
			await new Promise(resolve => setTimeout(resolve, 100));

			this.status({ phase: "idle" });
			return [{
				role: "assistant",
				content: lastMessage.content
			}];
		} catch (error) {
			this.status({ phase: "error", message: String(error)});
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
	ollamaModel: string;

	constructor(
		apiKey: string,
		rag: any = null,
		onStatus?: (s: LlamaStatus) => void,
		baseUrl?: string,
		model?: string,
		toolsConfig?: any
	) {
		super(apiKey, rag, onStatus, toolsConfig);
		this.baseUrl = baseUrl || "http://localhost:11434";
		this.ollamaModel = model || "llama2";
	}

	protected initializeModel(): void {
		// Ollama doesn't use ChatOpenAI - we'll handle tool invocation specially
		this.model = null;
		this.tooledModel = null;
	}

	protected async invokeTooledModel(messages: any[]): Promise<any> {
		// Build prompt from messages with tool definitions
		const messageTexts = messages.map(m => {
			const role = m._type === "system" ? "system" : (m._type === "ai" ? "assistant" : "user");
			return `${role}: ${m.content}`;
		}).join("\n");

		const systemPrompt = `You are a helpful assistant that can use tools. You have access to the following tool:
- retrieve: Retrieve relevant documents from Obsidian vault. Use this when you need context for the user's question.

When you want to use the retrieve tool, respond with: <tool_call>retrieve|{"query": "your search query"}</tool_call>
Then wait for the tool output before continuing.`;

		const fullPrompt = `${systemPrompt}

${messageTexts}`;

		try {
			const fetchInit: any = {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					model: this.ollamaModel,
					prompt: fullPrompt,
					stream: true,  // Enable streaming
				}),
			};

			// Add abort signal if one was set
			if (this.abortSignal) {
				fetchInit.signal = this.abortSignal;
			}

			const response = await fetch(`${this.baseUrl}/api/generate`, fetchInit);

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Ollama API error (${response.status}): ${errorText}`);
			}

			// Handle streaming response
			let fullContent = "";
			const reader = response.body!.getReader();
			const decoder = new TextDecoder();

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				// Decode the chunk and split by newlines (each line is a JSON object)
				const chunk = decoder.decode(value);
				const lines = chunk.split('\n').filter(line => line.trim());

				for (const line of lines) {
					try {
						const data = JSON.parse(line);
						if (data.response) {
							fullContent += data.response;
							// Emit streaming token callback
							if (this.onStreamToken) {
								this.onStreamToken(fullContent);
							}
						}
					} catch (e) {
						// Skip invalid JSON lines
					}
				}
			}

			let content = fullContent;

			// Parse tool calls from response
			const toolCallRegex = /<tool_call>retrieve\|(\{.*?\})<\/tool_call>/g;
			const toolCalls: any[] = [];
			let match;

			while ((match = toolCallRegex.exec(content)) !== null) {
				try {
					const args = JSON.parse(match[1]);
					toolCalls.push({
						name: "retrieve",
						args: args
					});
				} catch (e) {
					// Skip parsing errors
				}
			}

			// Clean tool call markers from content
			content = content.replace(toolCallRegex, "").trim();

			return {
				content: content,
				tool_calls: toolCalls.length > 0 ? toolCalls : undefined
			};
		} catch (error) {
			throw new Error(`Failed to invoke Ollama model: ${error}`);
		}
	}

	override async ask(originalMessages: any) {
		// Use ManualLlama's agent loop but with Ollama's API
		return super.ask(originalMessages);
	}

	override async test() {
		try {
			this.status({ phase: "calling_model" });
			
			const fetchInit: any = {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					model: this.ollamaModel,
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
				throw new Error(`Ollama API error (${response.status}): ${errorText}. Make sure Ollama is running and model "${this.ollamaModel}" exists.`);
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









