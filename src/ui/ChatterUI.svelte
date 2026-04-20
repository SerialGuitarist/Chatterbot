<script lang="ts">
	import { marked } from "marked";
	import { afterUpdate } from "svelte";
	import { messages, status } from "../chat";
	import type { Chat } from "../chatManager";

	export let view: any;

	let input = "";
	let chats: Chat[] = [];
	let archivedChats: Chat[] = [];
	let currentChat: Chat | null = null;
	let showArchived = false;
	let isEditingTitle = false;
	let editingTitle = "";
	let newChatText = ""; // Text in the new chat input
	let messagesContainer: HTMLElement;
	
	// Track which tool results are expanded
	let expandedToolMessages = new Set<number>();
	
	// Track message count to only scroll when new messages arrive
	let lastMessageCount = 0;

	// Initialize chats on mount
	async function init() {
		updateChatsList();
	}

	function updateChatsList() {
		// Get all chats and filter out empty ones (no messages)
		const allChats = view.plugin.chatStore.getChats();
		chats = allChats.filter(chat => chat.messages.length > 0);
		archivedChats = view.plugin.chatStore.getArchivedChats();
		// Explicitly trigger reactivity
		chats = chats;
		archivedChats = archivedChats;
	}

	async function selectChat(chat: Chat) {
		currentChat = chat;
		messages.set(chat.messages);
		input = chat.draftText || "";
		expandedToolMessages = new Set();
		lastMessageCount = chat.messages.length;
		// Scroll to bottom after component updates
		await new Promise(resolve => setTimeout(resolve, 0));
		scrollToBottom();
	}

	function scrollToBottom() {
		if (messagesContainer) {
			messagesContainer.scrollTop = messagesContainer.scrollHeight;
		}
	}

	// Auto-scroll to bottom only when new messages arrive
	afterUpdate(() => {
		if ($messages.length > lastMessageCount) {
			lastMessageCount = $messages.length;
			scrollToBottom();
		}
	});

	function backToChatList() {
		// Save current chat's draft and title
		if (currentChat) {
			view.plugin.chatStore.updateCurrentChatDraft(input);
			if (isEditingTitle && editingTitle.trim()) {
				view.plugin.chatStore.updateChatTitle(currentChat.id, editingTitle);
			}
		}
		currentChat = null;
		isEditingTitle = false;
		updateChatsList();
	}

	async function archiveChat(chatId: string, e: Event) {
		e.stopPropagation();
		await view.plugin.chatStore.archiveChat(chatId);
		updateChatsList();
	}

	async function unarchiveChat(chatId: string, e: Event) {
		e.stopPropagation();
		await view.plugin.chatStore.unarchiveChat(chatId);
		updateChatsList();
	}

	async function deleteChat(chatId: string, e: Event) {
		e.stopPropagation();
		e.preventDefault();
		await view.plugin.chatStore.deleteChat(chatId);
		updateChatsList();
	}

	async function startTypingNewChat() {
		// Only create a new chat if there's actual text being typed
		if (newChatText.trim()) {
			const newChat = await view.plugin.chatStore.createChat();
			// Don't select the chat yet - keep user in chat list view
			// They'll switch to chat interface after sending the first message
		}
	}

	async function sendNewChatMessage() {
		// block if not idle
		if ($status.phase !== "idle") return;

		// ignore empty inputs
		if (!newChatText.trim()) return;

		// Get or create a new chat
		if (!currentChat) {
			const newChat = await view.plugin.chatStore.createChat();
			currentChat = newChat;
		}

		// Add message to chat and update store
		await view.plugin.chatStore.addMessageToCurrentChat("user", newChatText);
		// Set messages to the updated chat.messages array to trigger store updates
		messages.set([...currentChat.messages]);

		// Clear input and reset
		newChatText = "";

		// Update chat list so new chat appears when returning
		updateChatsList();

		// Now switch to chat interface view
		// (currentChat is already set, so the UI will switch)

		// Call LLM after view has switched
		await new Promise(resolve => setTimeout(resolve, 0));
		view.llama();
	}

	async function send() {
		// block if not idle
		if ($status.phase !== "idle") return;

		// ignore empty inputs
		if (!input.trim()) return;

		if (!currentChat) return;

		// Add message to chat
		await view.plugin.chatStore.addMessageToCurrentChat("user", input);
		// Set messages to the updated chat.messages array to trigger store updates
		// Use spread operator to create new reference for reactivity
		messages.set([...currentChat.messages]);

		// Clear input and save draft
		input = "";
		await view.plugin.chatStore.updateCurrentChatDraft("");

		// Call LLM after store has updated
		await new Promise(resolve => setTimeout(resolve, 0));
		view.llama();
	}

	function startEditingTitle() {
		if (currentChat) {
			isEditingTitle = true;
			editingTitle = currentChat.title;
		}
	}

	async function saveTitle() {
		if (currentChat && editingTitle.trim()) {
			await view.plugin.chatStore.updateChatTitle(currentChat.id, editingTitle);
			currentChat.title = editingTitle;
		}
		isEditingTitle = false;
	}

	function cancelEditingTitle() {
		isEditingTitle = false;
	}

	function toggleToolMessage(index: number) {
		if (expandedToolMessages.has(index)) {
			expandedToolMessages.delete(index);
		} else {
			expandedToolMessages.add(index);
		}
		// Create a new Set reference to trigger Svelte reactivity
		expandedToolMessages = new Set(expandedToolMessages);
	}

	function expandAllToolMessages() {
		$messages.forEach((msg, idx) => {
			if (msg.role === "tool_result") {
				expandedToolMessages.add(idx);
			}
		});
		expandedToolMessages = new Set(expandedToolMessages);
	}

	function collapseAllToolMessages() {
		$messages.forEach((msg, idx) => {
			if (msg.role === "tool_result") {
				expandedToolMessages.delete(idx);
			}
		});
		expandedToolMessages = new Set(expandedToolMessages);
	}

	// Initialize on component mount
	init();
</script>

<div class="chatterbot-container">
	{#if !currentChat}
		<!-- Chat List View -->
		<div class="chat-list-full">
			<div class="chat-list-header">
				<h2>Chats</h2>
			</div>

			<div class="chats-list">
				{#each chats as chat (chat.id)}
					<div
						class="chat-item"
						on:click={() => selectChat(chat)}
						role="button"
						tabindex="0"
					>
						<div class="chat-item-content">
							<div class="chat-title">{chat.title}</div>
							<div class="chat-preview">{chat.getLastMessagePreview() || "No messages yet"}</div>
						</div>
						<button
							class="archive-btn"
							on:click={(e) => archiveChat(chat.id, e)}
							title="Archive chat"
						>
							📦
						</button>
					</div>
				{/each}
			</div>

			<!-- Archive Section -->
			<div class="archive-section">
				<button
					class="archive-header"
					on:click={() => (showArchived = !showArchived)}
				>
					<span class="archive-toggle">{showArchived ? '▼' : '▶'}</span>
					Archive
				</button>

				{#if showArchived}
					<div class="archived-chats-list">
						{#each archivedChats as chat (chat.id)}
							<div
								class="chat-item archived"
								on:click={() => unarchiveChat(chat.id, new Event('click'))}
								role="button"
								tabindex="0"
							>
								<div class="chat-item-content">
									<div class="chat-title">{chat.title}</div>
									<div class="chat-preview">{chat.getLastMessagePreview() || "No messages"}</div>
								</div>
								<button
									class="delete-btn"
									on:click={(e) => deleteChat(chat.id, e)}
									title="Delete permanently"
								>
									🗑️
								</button>
							</div>
						{/each}
						{#if archivedChats.length === 0}
							<div class="empty-archived">No archived chats</div>
						{/if}
					</div>
				{/if}
			</div>

			<!-- New Chat Input -->
			<div class="new-chat-input-section">
				<textarea
					class="new-chat-input"
					placeholder="Type a message to start a new chat..."
					bind:value={newChatText}
					on:keydown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							sendNewChatMessage();
						}
					}}
				></textarea>
			</div>
		</div>
	{:else}
		<!-- Chat Interface View -->
		<div class="chat-interface-full">
			<div class="chat-header">
				<button class="back-btn" on:click={backToChatList} title="Back to chats">
					← Back
				</button>
				{#if isEditingTitle}
					<input
						type="text"
						class="title-input"
						bind:value={editingTitle}
						on:blur={saveTitle}
						on:keydown={(e) => {
							if (e.key === 'Enter') saveTitle();
							if (e.key === 'Escape') cancelEditingTitle();
						}}
						autofocus
					/>
				{:else}
					<div class="chat-title-display" on:click={startEditingTitle} role="button" tabindex="0">
						{currentChat.title}
					</div>
				{/if}
			</div>

			<div class="messages" bind:this={messagesContainer}>
				{#each $messages as msg, idx}
					{#if msg.role === "tool_result"}
						<!-- Tool Result Message (expandable) -->
						<div class="bubble tool_result">
							<div 
								class="tool-header"
								on:click={() => toggleToolMessage(idx)}
								role="button"
								tabindex="0"
								on:keydown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										toggleToolMessage(idx);
									}
								}}
							>
								<span class="tool-icon">{expandedToolMessages.has(idx) ? "▼" : "▶"}</span>
								<span class="tool-name">{msg.toolName}:</span>
								<span class="tool-display">{msg.displayMessage || msg.content}</span>
							</div>
							
							{#if expandedToolMessages.has(idx) && msg.fullData}
								<div class="tool-expanded">
									{#if Array.isArray(msg.fullData)}
										{#each msg.fullData as doc, docIdx}
											<div class="tool-document">
												{#if doc.pageContent}
													<!-- RAG document -->
													<div class="doc-title">{doc.metadata?.source || `Document ${docIdx + 1}`}</div>
													<div class="doc-content">{doc.pageContent}</div>
												{:else if doc.path}
													<!-- File entry -->
													<div class="doc-title">{doc.path}</div>
												{:else}
													<div class="doc-content">{JSON.stringify(doc)}</div>
												{/if}
											</div>
										{/each}
									{:else}
										<pre>{JSON.stringify(msg.fullData, null, 2)}</pre>
									{/if}
								</div>
							{/if}
						</div>
					{:else}
						<!-- Regular User/Assistant Message -->
						<div class="bubble {msg.role}">
							{@html marked(msg.content)}
						</div>
					{/if}
				{/each}
			</div>

			<div class="status">
				{#if $status.phase === "idle"}
					Ready
				{:else if $status.phase === "retrieving"}
					Retrieving context…
				{:else if $status.phase === "thinking"}
					{$status.detail ?? "Thinking…"}
				{:else if $status.phase === "calling_model"}
					Calling model…
				{:else if $status.phase === "error"}
					⚠ {$status.message}
				{/if}
			</div>

			<textarea
				class="chat-input"
				bind:value={input}
				placeholder="Type a message..."
				on:change={() => view.plugin.chatStore.updateCurrentChatDraft(input)}
				on:keydown={(e) => {
					if (e.key === "Enter" && !e.shiftKey) {
						e.preventDefault();
						send();
					}
				}}
			></textarea>

			<div class="buttons">
				<button 
					on:click={view.halt}
					disabled={$status.phase === "idle"}
					title={$status.phase === "idle" ? "No model running" : "Stop the model"}
				>
					Halt
				</button>
				<button on:click={view.test}>Test</button>
				<button on:click={view.clear}>Clear</button>
			</div>

			<!-- Tool Controls Row (4th row with 2 columns) -->
			<div class="buttons tool-controls">
				<button 
					on:click={expandAllToolMessages}
					title="Expand all tool result messages"
				>
					Expand All
				</button>
				<button 
					on:click={collapseAllToolMessages}
					title="Collapse all tool result messages"
				>
					Collapse All
				</button>
			</div>
		</div>
	{/if}
</div>

<style>
	:global(.chatterbot-container) {
		display: flex;
		height: 100%;
		width: 100%;
		gap: 0;
	}

	/* Chat List View Styles */
	.chat-list-full {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		background: var(--background-primary);
	}

	.chat-list-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 12px 16px;
		border-bottom: 1px solid var(--divider-color);
		background: var(--background-secondary);
		flex-shrink: 0;
	}

	.chat-list-header h2 {
		margin: 0;
		font-size: 16px;
		font-weight: 600;
	}

	.chats-list {
		flex: 1;
		overflow-y: auto;
		padding: 8px 0;
	}

	.chat-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 10px 12px;
		margin: 4px 8px;
		border-radius: 6px;
		cursor: pointer;
		transition: background 0.15s;
	}

	.chat-item:hover {
		background: var(--background-modifier-hover);
	}

	.chat-item-content {
		flex: 1;
		min-width: 0;
	}

	.chat-title {
		font-weight: 600;
		font-size: 13px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.chat-preview {
		font-size: 12px;
		color: var(--text-faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		margin-top: 2px;
	}

	.archive-btn,
	.delete-btn {
		background: none;
		border: none;
		cursor: pointer;
		padding: 4px 6px;
		font-size: 14px;
		opacity: 0.6;
		transition: opacity 0.15s;
		margin-left: 8px;
	}

	.archive-btn:hover,
	.delete-btn:hover {
		opacity: 1;
	}

	.archive-section {
		border-top: 1px solid var(--divider-color);
		padding: 8px 0;
		flex-shrink: 0;
	}

	.archive-header {
		width: 100%;
		background: none;
		border: none;
		padding: 10px 16px;
		text-align: left;
		cursor: pointer;
		color: var(--text-faint);
		font-size: 12px;
		transition: color 0.15s;
	}

	.archive-header:hover {
		color: var(--text-normal);
	}

	.archive-toggle {
		margin-right: 6px;
		display: inline-block;
		transition: transform 0.2s;
	}

	.archived-chats-list {
		padding: 0;
		max-height: 300px;
		overflow-y: auto;
	}

	.chat-item.archived {
		opacity: 0.7;
	}

	.empty-archived {
		padding: 12px 16px;
		text-align: center;
		color: var(--text-faint);
		font-size: 12px;
	}

	.new-chat-input-section {
		border-top: 1px solid var(--divider-color);
		padding: 12px 16px;
		background: var(--background-secondary);
		flex-shrink: 0;
	}

	.new-chat-input {
		width: 100%;
		box-sizing: border-box;
		padding: 10px 12px;
		border: 1px solid var(--background-modifier-border);
		background: var(--background-primary);
		color: var(--text-normal);
		font-family: inherit;
		border-radius: 4px;
		resize: vertical;
		min-height: 40px;
		max-height: 80px;
		outline: none;
	}

	.new-chat-input:focus {
		background: var(--background-primary-alt);
	}

	/* Chat Interface View Styles */
	.chat-interface-full {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		background: var(--background-primary);
	}

	.chat-header {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 16px;
		border-bottom: 1px solid var(--divider-color);
		background: var(--background-secondary);
		flex-shrink: 0;
	}

	.back-btn {
		background: none;
		border: 1px solid var(--background-modifier-border);
		color: var(--text-normal);
		padding: 6px 12px;
		border-radius: 4px;
		cursor: pointer;
		font-size: 12px;
		flex-shrink: 0;
	}

	.back-btn:hover {
		background: var(--background-modifier-hover);
	}

	.title-input {
		flex: 1;
		background: var(--background-primary);
		color: var(--text-normal);
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		padding: 6px 10px;
		font-size: 14px;
		font-weight: 600;
		outline: none;
	}

	.title-input:focus {
		border-color: var(--interactive-accent);
	}

	.chat-title-display {
		flex: 1;
		font-weight: 600;
		font-size: 14px;
		cursor: pointer;
		padding: 6px 10px;
		border-radius: 4px;
		transition: background 0.15s;
	}

	.chat-title-display:hover {
		background: var(--background-modifier-hover);
	}

	.messages {
		flex: 1;
		overflow-y: auto;
		padding: 16px 20px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.bubble {
		max-width: 85%;
		padding: 10px 14px;
		border-radius: 8px;
		word-wrap: break-word;
		user-select: text;
		cursor: text;
		flex-shrink: 0;
	}

	.bubble.user {
		align-self: flex-end;
		background: var(--interactive-accent);
		color: var(--text-on-accent);
	}

	.bubble.assistant {
		align-self: flex-start;
		background: var(--background-secondary);
		color: var(--text-normal);
	}

	.status {
		padding: 8px 20px;
		font-size: 12px;
		color: var(--text-faint);
		border-top: 1px solid var(--divider-color);
		flex-shrink: 0;
	}

	.chat-input {
		padding: 10px 16px;
		border-top: 1px solid var(--divider-color);
		border-bottom: 1px solid var(--divider-color);
		background: var(--background-primary);
		color: var(--text-normal);
		font-family: inherit;
		resize: vertical;
		min-height: 60px;
		max-height: 120px;
		outline: none;
		flex-shrink: 0;
		width: 100%;
		box-sizing: border-box;
	}

	.chat-input:focus {
		background: var(--background-primary-alt);
	}

	.buttons {
		display: flex;
		gap: 6px;
		padding: 12px 16px;
		background: var(--background-secondary);
		border-top: 1px solid var(--divider-color);
		flex-wrap: wrap;
		flex-shrink: 0;
		width: 100%;
		box-sizing: border-box;
	}

	.buttons button {
		padding: 6px 12px;
		border: 1px solid var(--background-modifier-border);
		background: var(--background-primary-alt);
		border-radius: 4px;
		cursor: pointer;
		font-size: 12px;
		transition: background 0.2s;
	}

	.buttons button:hover {
		background: var(--background-modifier-hover);
	}

	/* Tool Result Message Styles */
	.bubble.tool_result {
		align-self: flex-start;
		background: var(--background-tertiary);
		color: var(--text-normal);
		padding: 0;
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		overflow: hidden;
		max-width: 85%;
	}

	.tool-header {
		padding: 10px 14px;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 8px;
		user-select: none;
		transition: background 0.15s;
	}

	.tool-header:hover {
		background: var(--background-modifier-hover);
	}

	.tool-icon {
		display: inline-block;
		font-size: 12px;
		font-weight: bold;
		min-width: 16px;
		text-align: center;
	}

	.tool-name {
		font-weight: 600;
		color: var(--interactive-accent);
		min-width: 70px;
	}

	.tool-display {
		color: var(--text-normal);
		flex: 1;
		word-break: break-word;
	}

	.tool-expanded {
		background: var(--background-primary);
		padding: 12px 14px;
		border-top: 1px solid var(--background-modifier-border);
		max-height: 400px;
		overflow-y: auto;
		font-size: 12px;
	}

	.tool-document {
		margin-bottom: 12px;
		padding: 10px;
		background: var(--background-secondary);
		border-radius: 4px;
		border-left: 3px solid var(--interactive-accent);
	}

	.doc-title {
		font-weight: 600;
		font-size: 11px;
		color: var(--interactive-accent);
		margin-bottom: 4px;
		text-transform: uppercase;
	}

	.doc-content {
		color: var(--text-normal);
		white-space: pre-wrap;
		word-wrap: break-word;
		line-height: 1.4;
	}

	.tool-expanded pre {
		background: var(--background-primary);
		padding: 8px;
		border-radius: 4px;
		overflow-x: auto;
		font-size: 11px;
	}

	/* Tool Controls Row (4th row - 2 column grid) */
	.buttons.tool-controls {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
		padding: 6px 16px;
		background: var(--background-secondary);
		border-top: 1px solid var(--divider-color);
		flex-shrink: 0;
	}

	.buttons.tool-controls button {
		width: 100%;
	}
</style>
