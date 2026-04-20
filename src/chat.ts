// shared storage for ChatterUI.svelte and view.ts

import { writable } from "svelte/store";
import type { LlamaStatus } from "./llama";

export interface ChatMessage {
	role: "user" | "assistant";
	content: string;
}

export const messages = writable<ChatMessage[]>([]);

export const status = writable<LlamaStatus>({ phase: "idle" });
