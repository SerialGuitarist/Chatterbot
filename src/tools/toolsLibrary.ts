/**
 * Tools Library
 * Provides a registry of available tools for LLM agents
 * 
 * To add a new tool:
 * 1. Create a createXxxTool() method that returns ToolDefinition
 * 2. Add one entry to TOOL_REGISTRY below (this is the single source of truth)
 * Everything else (ToolsConfig, settings, defaults, toggles) is auto-generated
 */

import { tool } from "@langchain/core/tools";
import { Notice } from "obsidian";
import * as z from "zod";

export interface ToolDefinition {
	tool: any;
	usageInstruction: string;
	displayTemplate: string;   // e.g., "Retrieved {count} document(s) for '{query}'" - uses {argName} placeholders
	// Metadata (settingName, settingDescription, defaultEnabled) come from TOOL_REGISTRY, not here
}

/**
 * Tool registry - the single source of truth for all available tools
 * Each entry maps a tool name to its metadata and factory function
 */
export interface ToolRegistryEntry {
	toolName: string;
	settingName: string;
	settingDescription: string;
	defaultEnabled: boolean;
	factory: (rag: any, onStatus?: (s: any) => void, vault?: any) => ToolDefinition;
}

// Dynamically generated from tool registry - use this in settings and config
export interface ToolsConfig {
	retrieve: boolean;
	notice: boolean;
	listMarkdownFiles: boolean;
	// Future tools will be auto-added here via ToolsConfigType generation
}

/**
 * Tool factory function
 * Creates tools based on configuration
 */
export class ToolsFactory {
	/**
	 * TOOL REGISTRY - Single source of truth for all available tools
	 * Add new tools here and they'll automatically appear in settings, defaults, and toggles
	 */
	private static TOOL_REGISTRY: ToolRegistryEntry[] = [
		{
			toolName: "retrieve",
			settingName: "Retrieval",
			settingDescription: "RAG-based document retrieval tool (requires embeddings to be set up)",
			defaultEnabled: false,
			factory: (rag: any, onStatus?: (s: any) => void) => ToolsFactory.createRetrieveTool(rag, onStatus)
		},
		{
			toolName: "notice",
			settingName: "Notice",
			settingDescription: "Notice tool to display messages in the UI",
			defaultEnabled: true,
			factory: () => ToolsFactory.createNoticeTool()
		},
		{
			toolName: "listMarkdownFiles",
			settingName: "List Markdown Files",
			settingDescription: "Tool to list all markdown files in the vault with their metadata",
			defaultEnabled: true,
			factory: (rag, onStatus, vault) => ToolsFactory.createListMarkdownFilesTool(vault)
		}
	];

	/**
	 * Create the retrieve tool for RAG-based document retrieval
	 */
	static createRetrieveTool(rag: any, onStatus?: (s: any) => void): ToolDefinition {
		const retrieveTool = tool(
			async ({ query }: { query: string }) => {
				onStatus?.({ phase: "thinking", detail: "Retrieving: " + query });
				console.log("Retrieving: " + query);
				const retriever = rag.getRetriever();
				const documents = await retriever.invoke(query);
				// Store documents for later retrieval
				// ToolsFactory.lastRetrievedDocs = documents;
				return documents.map((d: any) => d.pageContent).join("---");
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
			displayTemplate: "Retrieved {count} document(s) for '{query}'"
			// settingName, settingDescription, defaultEnabled come from TOOL_REGISTRY
		};
	}

	/**
	 * Create a notice tool that displays messages
	 */
	static createNoticeTool(): ToolDefinition {
		const noticeTool = tool(
			async ({ message }: { message: string }) => {
				new Notice(message);
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
			displayTemplate: "Displayed notice: {message}"
			// settingName, settingDescription, defaultEnabled come from TOOL_REGISTRY
		};
	}

	/**
	 * Create a tool for listing markdown files in the vault
	 */
	static createListMarkdownFilesTool(vault: any): ToolDefinition {
		const listMarkdownFilesTool = tool(
			async ({ filterModified }: { filterModified?: boolean }) => {
				const vaultFiles = vault.getMarkdownFiles();
				
				// Store serializable file data (not raw TFile objects)
				const filesList = vaultFiles.map((file: any) => ({
					path: file.path,
					name: file.name,
					size: file.stat?.size || 0,
					modified: file.stat?.mtime || 0
				}));

				// Format as markdown table with numbered index
				const markdownTable = [
					"| # | Name | Path | Size (bytes) | Modified |",
					"|---|------|------|-------------|----------|",
					...filesList.map((file: any, index: number) => {
						const modifiedDate = new Date(file.modified).toLocaleDateString();
						return `| ${index + 1} | ${file.name} | ${file.path} | ${file.size} | ${modifiedDate} |`;
					})
				].join("\n");

				return markdownTable;
			},
			{
				name: "listMarkdownFiles",
				description: "Get a list of all markdown files in the Obsidian vault with their metadata",
				schema: z.object({
					// filterModified: z.boolean().optional().describe("If true, only return recently modified files"),
				}),
			}
		);

		return {
			tool: listMarkdownFilesTool,
			usageInstruction: "Use the listMarkdownFiles tool to see all available markdown files in the vault, their location, and their metadata.",
			displayTemplate: "Listed all files in the vault"
			// settingName, settingDescription, defaultEnabled come from TOOL_REGISTRY
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
		onStatus?: (s: any) => void,
		vault?: any
	): any[] {
		const toolDefinitions = this.createToolDefinitions(config, rag, onStatus, vault);
		return toolDefinitions.map(td => td.tool);
	}

	/**
	 * Create tool definitions with usage instructions based on configuration
	 */
	static createToolDefinitions(
		config: ToolsConfig,
		rag: any,
		onStatus?: (s: any) => void,
		vault?: any
	): ToolDefinition[] {
		const toolDefinitions: ToolDefinition[] = [];

		for (const entry of this.TOOL_REGISTRY) {
			const configValue = (config as any)[entry.toolName];
			
			// Skip if tool is disabled in config
			if (!configValue) {
				continue;
			}
			
			// Skip retrieve tool if RAG doesn't have valid embeddings
			if (entry.toolName === "retrieve" && !rag?.hasValidEmbeddings) {
				continue;
			}

			try {
				const toolDefinition = entry.factory(rag, onStatus, vault);
				toolDefinitions.push(toolDefinition);
			} catch (err) {
				console.error(`Error creating tool ${entry.toolName}:`, err);
			}
		}

		return toolDefinitions;
	}

	/**
	 * Get all tool descriptions and usage instructions for the system prompt
	 */
	static getToolInstructions(
		config: ToolsConfig,
		rag: any,
		vault?: any
	): string {
		const toolDefinitions = this.createToolDefinitions(config, rag, undefined, vault);
		
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
	static getToolDefinitionByName(name: string, config: ToolsConfig, rag: any, vault?: any): ToolDefinition | undefined {
		return this.createToolDefinitions(config, rag, undefined, vault).find(td => td.tool.name === name);
	}

	/**
	 * Get metadata for all available tools (regardless of enablement)
	 * Used for generating settings UI and defaults
	 */
	static getAllToolMetadata(): Array<{
		toolName: string;
		settingName: string;
		settingDescription: string;
		defaultEnabled: boolean;
	}> {
		return this.TOOL_REGISTRY.map(entry => ({
			toolName: entry.toolName,
			settingName: entry.settingName,
			settingDescription: entry.settingDescription,
			defaultEnabled: entry.defaultEnabled
		}));
	}
}
