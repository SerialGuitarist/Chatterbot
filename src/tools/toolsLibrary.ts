/**
 * Tools Library
 * Provides a registry of available tools for LLM agents
 * Allows configuration of which tools are enabled
 */

import { tool } from "@langchain/core/tools";
import * as z from "zod";

export interface LLMTool {
	name: string;
	description: string;
	schema: z.ZodSchema;
	fn: (args: any) => Promise<string>;
}

export interface ToolsConfig {
	retrieve: boolean;
	// Future tools can be added here
}

export const DEFAULT_TOOLS_CONFIG: ToolsConfig = {
	retrieve: true,
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
	): any {
		return tool(
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
	}

	/**
	 * Create tools array based on configuration
	 */
	static createTools(
		config: ToolsConfig,
		rag: any,
		onStatus?: (s: any) => void
	): any[] {
		const tools = [];

		if (config.retrieve && rag) {
			tools.push(this.createRetrieveTool(rag, onStatus));
		}

		return tools;
	}

	/**
	 * Get tool descriptions for use in system prompts
	 */
	static getToolDescriptions(config: ToolsConfig): string {
		const descriptions: string[] = [];

		if (config.retrieve) {
			descriptions.push(
				"- retrieve: Retrieve relevant documents from Obsidian vault for context"
			);
		}

		return descriptions.length > 0
			? "You have access to the following tools:\n" + descriptions.join("\n")
			: "";
	}
}
