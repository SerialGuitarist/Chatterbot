// shared storage for ChatterUI.svelte and view.ts

import { writable } from "svelte/store";
import type { LlamaStatus } from "./llama";

export interface ChatMessage {
	role: "user" | "assistant" | "tool_result";
	content: string;
	// Tool-specific fields (optional, for tool_result messages)
	toolName?: string;                    // Name of tool that was invoked
	displayMessage?: string;              // User-facing text like "Retrieved context for 'query'"
	fullData?: any;                       // Raw/full data for expandable display
	displayArgs?: Record<string, any>;    // Args used to format displayMessage template
	isExpanded?: boolean;                 // UI state for expansion
}

export const messages = writable<ChatMessage[]>([]);

export const status = writable<LlamaStatus>({ phase: "idle" });
