
// import { messages } from "./state/chat";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";

// import { tool } from "langchain";
import { tool } from "@langchain/core/tools";
import * as z from "zod";


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
	rag: any; // RAGStore
	onStatus?: (status: LlamaStatus) => void;
	onStreamToken?: (token: string) => void; // Callback for streaming tokens
	systemMessage: any = null;
	
	constructor(apiKey: string, rag: any = null, onStatus?: (s: LlamaStatus) => void, skipModelInit: boolean = false) {
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
		this.rag = rag;
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

	async ask(messages: any) {
		try {
			// my attempts to decouple this code as much as possible
			// has lead me down some dark dark paths such as this code block

			// 1. get retriever
			this.status({ phase: "retrieving" });
			const retriever = this.rag.getRetriever();

			// 2. get last user query
			const lastUserMessage = messages[messages.length - 1].content;

			// 3. use that to get the context documents
			this.status({ phase: "thinking", detail: "Constructing context" });
			const output = await retriever.invoke(lastUserMessage);
			const contexts = output.map((doc: any) => doc.pageContent );
			const context = {role: "system", content: "Context: " + contexts.join("\n---\n")};

			// 4. append that to the messages
			const augmentedMessages = [
				this.systemMessage,
				...messages,
				context
			].map(toLC);

			this.status({ phase: "calling_model"});
			const result = await this.model!.invoke(augmentedMessages);
			this.status({ phase: "idle"});

			return {
				reply: result.content,
				context: context
			};
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

// agentic implementation doesnt work on obsidian for some reason
// need to implement tool calls manually
export class ManualLlama extends Llama {
	tooledModel: any;
	retrieveTool: any;

	constructor(
		apiKey: string,
		rag: any = null,
		onStatus?: (s: LlamaStatus) => void
	) {
		super(apiKey, rag, onStatus);
		this.status({ phase: "thinking", detail: "Setting up model"});


		this.systemMessage = {
			role: "system",
			content: "You are ChatterBot, a helpful AI assistant attached to an Obsidian Vault, a note-taking knowledge base. Your primary role is to help users with questions about this vault. If a user asks a question about something you\'re unsure about, you MUST use the \`retrieve\` tool to query the vault for relevant context documents."
		};

		this.retrieveTool = tool(
			async ({ query } : { query: string }) => {
				this.status({ phase: "thinking", detail: "Retrieving: " + query  });
				console.log("Retrieving: " + query);
				const retriever = this.rag.getRetriever();
				const documents = await retriever.invoke(query);
				const collatedDocuments = documents.map(d => d.pageContent).join("\n---\n");

				// -- testing the effectiveness of having the llm restructure the output --
				// const messages = [{"role": "user", "content": "Summarize the following: " + collatedDocuments}].map(toLC);
				// const response = await this.model.invoke(messages)
				// return response.content;
				// -- as it turns out, doesn't add a lot while making it much slower

				return collatedDocuments;

			}, 
			{
				name: "retrieve",
				description: "Retrieve relevant documents from Obsidian vault",
				schema: z.object({
					query: z.string().describe("Search query for the vault")
				}),
			}
		);

		this.tooledModel = this.model!.bindTools([this.retrieveTool]);
		this.status({ phase: "idle"});
	}


	override async ask(originalMessages: any) {
		try {
			this.status({ phase: "thinking", detail: "Agent reasoning" });
			let context = "";

			for (let i = 0; i < 5; i++) {
				let messages = [
					this.systemMessage,
					...originalMessages,
					{role: "system", content: "Context: " + context}
				].map(toLC);

				const response = await this.tooledModel.invoke(messages)

				if (response.tool_calls) {
					for (const toolCall of response.tool_calls) {
						// console.log(toolCall);
						let query = toolCall.args.query;
						context += "Output of \`retrieve\` tool with query \"" + query + "\": " + await this.retrieveTool.invoke({ query }) + "\n---\n";
						// console.log(context);
					}
					this.status({ phase: "thinking", detail: "Agent reasoning with retrieved context" });
					continue;
				}

				this.status({ phase: "idle" });
				return {
					reply: response.content,
					context: context
				};
			}

			let messages = [
				this.systemMessage,
				...originalMessages,
				{role: "system", content: "Context: " + context}
			].map(toLC);

			const response = await this.model!.invoke(messages)
			this.status({ phase: "idle" });
			return {
				reply: response.content,
				context: context
			};


		} catch (err) {
			this.status({ phase: "error", message: String(err) });
			throw err;
		}
	}

	override async test() {
		// Step 1: Model generates tool calls
		// const messages = [{"role": "user", "content": "What is Governance of Iron's relation with Public Universal Friend"}].map(toLC);
		const messages = [{"role": "user", "content": "Wazzap"}].map(toLC);

		const response = await this.model!.invoke(messages)

		// Step 2: Execute tools and collect results
		for (const toolCall of response.tool_calls) {
			console.log(toolCall);
		}

		console.log(response);
	}



}

/**
 * Mirror provider - echoes back whatever the user sends
 * Useful for testing and debugging
 */
export class MirrorLlama extends Llama {
	constructor(
		apiKey: string,
		rag: any = null,
		onStatus?: (s: LlamaStatus) => void
	) {
		super(apiKey, rag, onStatus);
		this.systemMessage = {
			role: "system",
			content: "You are a mirror. You echo back whatever the user sends, nothing more."
		};
		this.status({ phase: "idle"});
	}

	override async ask(messages: any) {
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
			return {
				reply: lastMessage.content,
				context: ""
			};
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
 */
export class OllamaLlama extends Llama {
	baseUrl: string;
	ollamaModel: string;

	constructor(
		apiKey: string,
		rag: any = null,
		onStatus?: (s: LlamaStatus) => void,
		baseUrl?: string,
		model?: string
	) {
		// Skip ChatOpenAI initialization - we use HTTP calls directly
		super(apiKey, rag, onStatus, true);
		this.baseUrl = baseUrl || "http://localhost:11434";
		this.ollamaModel = model || "llama2";
	}

	override async ask(messages: any) {
		try {
			this.status({ phase: "retrieving" });
			
			// Get last user query
			const lastUserMessage = messages[messages.length - 1].content;
			let context = "";

			// Try to retrieve context, but gracefully skip if embeddings aren't available
			try {
				const retriever = this.rag.getRetriever();
				this.status({ phase: "thinking", detail: "Constructing context" });
				const output = await retriever.invoke(lastUserMessage);
				const contexts = output.map((doc: any) => doc.pageContent);
				context = contexts.join("\n---\n");
			} catch (retrievalError: any) {
				// If retrieval fails (e.g., no embeddings configured), continue without context
				console.warn("Context retrieval failed, continuing without context:", retrievalError.message);
				this.status({ phase: "thinking", detail: "No context available" });
			}

			// Build prompt with context and system message
			const fullPrompt = `${this.systemMessage.content}

${context ? `Context from vault:\n${context}\n` : ''}

User question: ${lastUserMessage}`;

			this.status({ phase: "calling_model" });
			
			// Call Ollama via HTTP with streaming enabled
			const response = await fetch(`${this.baseUrl}/api/generate`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: this.ollamaModel,
					prompt: fullPrompt,
					stream: true, // Enable streaming
				}),
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Ollama API error (${response.status}): ${errorText || response.statusText}. Model: ${this.ollamaModel}, URL: ${this.baseUrl}/api/generate`);
			}

			// Handle streaming response
			let fullReply = "";
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
							fullReply += data.response;
							// Emit streaming token for real-time updates
							if (this.onStreamToken) {
								this.onStreamToken(fullReply);
							}
						}
					} catch (e) {
						// Skip invalid JSON lines
					}
				}
			}

			this.status({ phase: "idle" });

			return {
				reply: fullReply,
				context: { role: "system", content: "Context: " + context }
			};
		} catch (error) {
			this.status({ phase: "error", message: String(error) });
			throw error;
		}
	}

	override async test() {
		try {
			this.status({ phase: "calling_model" });
			const response = await fetch(`${this.baseUrl}/api/generate`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: this.ollamaModel,
					prompt: "Hello, what is 2+2?",
					stream: false,
				}),
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Ollama API error (${response.status}): ${errorText || response.statusText}. Make sure Ollama is running and the model "${this.ollamaModel}" exists.`);
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









