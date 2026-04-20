/**
 * Tools Library
 * Provides a registry of available tools for LLM agents
 * Allows configuration of which tools are enabled
 */

import { tool } from "@langchain/core/tools";
import { Notice } from "obsidian";
import * as z from "zod";

export interface LLMTool {
	name: string;
	description: string;
	schema: z.ZodSchema;
	fn: (args: any) => Promise<string>;
}

export interface ToolsConfig {
	retrieve: boolean;
	notice?: boolean;
	// Future tools can be added here
}

/**
 * Tool display metadata - how to show results to the user
 */
export interface ToolDisplayMetadata {
	displayTemplate: string;   // e.g., "Retrieved {count} document(s) for '{query}'" - uses {argName} placeholders
	collapseLabel?: string;    // Optional custom label
	expandLabel?: string;
	extractFullData?: () => any;  // Extract what to store as fullData
}

export interface ToolDefinition {
	tool: any;
	usageInstruction: string;
	displayMetadata: ToolDisplayMetadata;  // NEW: how to display results to user
}

export const DEFAULT_TOOLS_CONFIG: ToolsConfig = {
	retrieve: true,
	notice: true,
};

/**
 * Tool factory function
 * Creates tools based on configuration
 */
export class ToolsFactory {
	// Static storage for last documents retrieved
	private static lastRetrievedDocs: any[] = [];

	/**
	 * Create the retrieve tool for RAG-based document retrieval
	 */
	static createRetrieveTool(
		rag: any,
		onStatus?: (s: any) => void
	): ToolDefinition {
		const retrieveTool = tool(
			async ({ query }: { query: string }) => {
				onStatus?.({ phase: "thinking", detail: "Retrieving: " + query });
				console.log("Retrieving: " + query);
				const retriever = rag.getRetriever();
				const documents = await retriever.invoke(query);
				// Store documents for later retrieval
				ToolsFactory.lastRetrievedDocs = documents;
				return documents.map((d: any) => d.pageContent).join("\n---\n");
			},
			{
				name: "retrieve",
				description: "Retrieve relevant documents from Obsidian vault",
				schema: z.object({
					query: z.string().describe("Search query for the vault"),
				}),
			}
		);

		return {
			tool: retrieveTool,
			usageInstruction: "Use the retrieve tool when you need context from the vault.",
			displayMetadata: {
				displayTemplate: "Retrieved {count} document(s) for '{query}'",
				expandLabel: "Show documents",
				collapseLabel: "Hide documents",
				extractFullData: () => ToolsFactory.lastRetrievedDocs
			}
		};
	}

	/**
	 * Create a notice tool that displays messages
	 */
	static createNoticeTool(): ToolDefinition {
		const noticeTool = tool(
			async ({ message }: { message: string }) => {
				new Notice(message);
				console.log("Notice:", message);
				return `Notice displayed: ${message}`;
			},
			{
				name: "notice",
				description: "Display a notice message in Obsidian",
				schema: z.object({
					message: z.string().describe("The message to display in the notice"),
				}),
			}
		);

		return {
			tool: noticeTool,
			usageInstruction: "Use the notice tool to display messages in the UI when appropriate.",
			displayMetadata: {
				displayTemplate: "Displayed notice: {message}",
				extractFullData: () => null  // Notices don't need expanded data
			}
		};
	}

	/**
	 * Format display message using template and args
	 * e.g., formatDisplayMessage("Retrieved {count} for '{query}'", { count: 3, query: "foo" })
	 */
	static formatDisplayMessage(template: string, args: Record<string, any>): string {
		return template.replace(/{(\w+)}/g, (match, key) => {
			const val = args[key];
			if (val === undefined) return match;
			return typeof val === 'string' ? val : JSON.stringify(val);
		});
	}

	/**
	 * Create tools array based on configuration
	 */
	static createTools(
		config: ToolsConfig,
		rag: any,
		onStatus?: (s: any) => void
	): any[] {
		const toolDefinitions = this.createToolDefinitions(config, rag, onStatus);
		return toolDefinitions.map(td => td.tool);
	}

	/**
	 * Create tool definitions with usage instructions based on configuration
	 */
	static createToolDefinitions(
		config: ToolsConfig,
		rag: any,
		onStatus?: (s: any) => void
	): ToolDefinition[] {
		const toolDefinitions: ToolDefinition[] = [];

		if (config.retrieve && rag?.hasValidEmbeddings) {
			toolDefinitions.push(this.createRetrieveTool(rag, onStatus));
		}

		if (config.notice) {
			toolDefinitions.push(this.createNoticeTool());
		}

		return toolDefinitions;
	}

	/**
	 * Get all tool descriptions and usage instructions for the system prompt
	 */
	static getToolInstructions(
		config: ToolsConfig,
		rag: any
	): string {
		const toolDefinitions = this.createToolDefinitions(config, rag);
		
		if (toolDefinitions.length === 0) {
			return "";
		}

		const descriptions = toolDefinitions
			.map(td => `- ${td.tool.name}: ${td.tool.description}`)
			.join("\n");

		const instructions = toolDefinitions
			.map(td => td.usageInstruction)
			.join(" ");

		return `You have access to the following tools:\n${descriptions}\n${instructions}`;
	}

	/**
	 * Get tool definition by name
	 */
	static getToolDefinitionByName(name: string, config: ToolsConfig, rag: any): ToolDefinition | undefined {
		return this.createToolDefinitions(config, rag).find(td => td.tool.name === name);
	}
}
