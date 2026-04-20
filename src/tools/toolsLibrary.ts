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

export interface ToolDefinition {
	tool: any;
	usageInstruction: string;
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
			usageInstruction: "Use the retrieve tool when you need context from the vault."
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
			usageInstruction: "Use the notice tool to display messages in the UI when appropriate."
		};
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
}
