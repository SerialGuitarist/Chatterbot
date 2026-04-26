/**
 * Represents a single chat conversation
 */
export class Chat {
	id: string;
	title: string;
	messages: Array<{ role: string; content: string }>;
	draftText: string; // Text currently being typed in the chat input
	createdAt: number;
	updatedAt: number;
	isArchived: boolean;

	constructor(id?: string, title?: string) {
		this.id = id || Date.now().toString() + Math.random().toString(36).substr(2, 9);
		this.title = title || 'New Chat';
		this.messages = [];
		this.draftText = '';
		this.createdAt = Date.now();
		this.updatedAt = Date.now();
		this.isArchived = false;
	}

	/**
	 * Add a message to the chat with optional metadata
	 */
	addMessage(
		role: string, 
		content: string,
		metadata?: {
			toolName?: string;
			displayMessage?: string;
			fullData?: any;
			displayArgs?: Record<string, any>; // ???
			isExpanded?: boolean;
		}
	): void {
		const message: any = { role, content };
		if (metadata) {
			if (metadata.toolName) message.toolName = metadata.toolName;
			if (metadata.displayMessage) message.displayMessage = metadata.displayMessage;
			if (metadata.fullData) message.fullData = metadata.fullData;
			if (metadata.displayArgs) message.displayArgs = metadata.displayArgs;
			if (metadata.isExpanded !== undefined) message.isExpanded = metadata.isExpanded;
		}
		this.messages.push(message);
		this.updatedAt = Date.now();
	}

	/**
	 * Get the last message content (for preview)
	 */
	getLastMessagePreview(): string {
		if (this.messages.length === 0) return '';
		const lastMessage = this.messages[this.messages.length - 1];
		// Return a short snippet, truncate at 60 chars
		return lastMessage.content.substring(0, 60);
	}

	/**
	 * Update the draft text (what user is typing)
	 */
	updateDraft(text: string): void {
		this.draftText = text;
	}

	/**
	 * Serialize to JSON
	 */
	toJSON() {
		return {
			id: this.id,
			title: this.title,
			messages: this.messages,
			draftText: this.draftText,
			createdAt: this.createdAt,
			updatedAt: this.updatedAt,
			isArchived: this.isArchived,
		};
	}

	/**
	 * Deserialize from JSON
	 */
	static fromJSON(data: any): Chat {
		const chat = new Chat(data.id, data.title);
		chat.messages = data.messages || [];
		chat.draftText = data.draftText || '';
		chat.createdAt = data.createdAt || Date.now();
		chat.updatedAt = data.updatedAt || Date.now();
		chat.isArchived = data.isArchived || false;
		return chat;
	}
}

/**
 * Manages all chats and persistent storage
 */
export class ChatStore {
	private chats: Map<string, Chat> = new Map();
	private archivedChats: Map<string, Chat> = new Map();
	private currentChatId: string | null = null;
	private plugin: any; // Reference to plugin for persistence

	constructor(plugin: any) {
		this.plugin = plugin;
	}

	/**
	 * Load chats from persistent storage
	 */
	async load(): Promise<void> {
		const data = await this.plugin.loadData();
		const chatsData = data?.chats || [];
		const archivedData = data?.archivedChats || [];

		// Load active chats
		chatsData.forEach((chatData: any) => {
			const chat = Chat.fromJSON(chatData);
			if (!chat.isArchived) {
				this.chats.set(chat.id, chat);
			}
		});

		// Load archived chats
		archivedData.forEach((chatData: any) => {
			const chat = Chat.fromJSON(chatData);
			this.archivedChats.set(chat.id, chat);
		});

		// Set first chat as current if any exist
		if (this.chats.size > 0) {
			this.currentChatId = Array.from(this.chats.keys())[0];
		}
		// If no chats exist, leave currentChatId as null until user creates one
	}

	/**
	 * Save all chats to persistent storage
	 * Filters out empty chats (chats with no messages)
	 */
	async save(): Promise<void> {
		const data = await this.plugin.loadData() ?? {};
		// Only save chats that have at least one message
		data.chats = Array.from(this.chats.values())
			.filter(c => c.messages.length > 0)
			.map(c => c.toJSON());
		data.archivedChats = Array.from(this.archivedChats.values()).map(c => c.toJSON());
		await this.plugin.saveData(data);
	}

	/**
	 * Create a new chat
	 */
	async createChat(title?: string): Promise<Chat> {
		const chat = new Chat(undefined, title);
		this.chats.set(chat.id, chat);
		this.currentChatId = chat.id;
		await this.save();
		return chat;
	}

	/**
	 * Get all active chats, sorted by most recent first
	 */
	getChats(): Chat[] {
		return Array.from(this.chats.values()).sort((a, b) => b.updatedAt - a.updatedAt);
	}

	/**
	 * Get all archived chats, sorted by most recent first
	 */
	getArchivedChats(): Chat[] {
		return Array.from(this.archivedChats.values()).sort((a, b) => b.updatedAt - a.updatedAt);
	}

	/**
	 * Get the currently active chat
	 */
	getCurrentChat(): Chat | null {
		return this.currentChatId ? this.chats.get(this.currentChatId) || null : null;
	}

	/**
	 * Set the current chat
	 */
	setCurrentChat(chatId: string): void {
		if (this.chats.has(chatId)) {
			this.currentChatId = chatId;
		}
	}

	/**
	 * Archive a chat
	 */
	async archiveChat(chatId: string): Promise<void> {
		const chat = this.chats.get(chatId);
		if (chat) {
			chat.isArchived = true;
			this.chats.delete(chatId);
			this.archivedChats.set(chatId, chat);

			// Move to next chat if archiving current
			if (this.currentChatId === chatId) {
				const remaining = Array.from(this.chats.keys());
				this.currentChatId = remaining.length > 0 ? remaining[0] : null;
			}

			await this.save();
		}
	}

	/**
	 * Unarchive a chat (move back to active)
	 */
	async unarchiveChat(chatId: string): Promise<void> {
		const chat = this.archivedChats.get(chatId);
		if (chat) {
			chat.isArchived = false;
			chat.updatedAt = Date.now(); // Update timestamp to move it to top
			this.archivedChats.delete(chatId);
			this.chats.set(chatId, chat);
			this.currentChatId = chatId;
			await this.save();
		}
	}

	/**
	 * Delete a chat permanently (from archive or any location)
	 */
	async deleteChat(chatId: string): Promise<void> {
		// Remove from both maps to ensure complete deletion
		this.chats.delete(chatId);
		this.archivedChats.delete(chatId);
		// If this was the current chat, clear it
		if (this.currentChatId === chatId) {
			this.currentChatId = null;
		}
		await this.save();
	}

	/**
	 * Update chat title
	 */
	async updateChatTitle(chatId: string, title: string): Promise<void> {
		const chat = this.chats.get(chatId);
		if (chat) {
			chat.title = title;
			chat.updatedAt = Date.now();
			await this.save();
		}
	}

	/**
	 * Add a message to the current chat with optional metadata
	 */
	async addMessageToCurrentChat(
		role: string, 
		content: string,
		metadata?: {
			toolName?: string;
			displayMessage?: string;
			fullData?: any;
			displayArgs?: Record<string, any>;
			isExpanded?: boolean;
		}
	): Promise<void> {
		const chat = this.getCurrentChat();
		if (chat) {
			chat.addMessage(role, content, metadata);
			await this.save();
		}
	}

	/**
	 * Update draft text of the current chat
	 */
	async updateCurrentChatDraft(text: string): Promise<void> {
		const chat = this.getCurrentChat();
		if (chat) {
			chat.updateDraft(text);
			await this.save();
		}
	}
}
