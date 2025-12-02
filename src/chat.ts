// shared storage for ChatterUI.svelte and view.ts

import { writable } from "svelte/store";

export interface ChatMessage {
	role: "user" | "assistant";
	content: string;
}

export const messages = writable<ChatMessage[]>([]);
