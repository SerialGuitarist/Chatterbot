<script lang="ts">
	import { messages } from "../chat";

	export let view;

	let input = "wallahi";

	function send() {
		// ignore empty inputs
		if (!input.trim()) return;
	
		// update svelte store
		messages.update(m => [...m, {role: "user", content: input}]);

		const toSend = input;

		// fake reply
		setTimeout(() => {
			messages.update(m => [
				...m,
				{role: "assistant", content:"Hello, you said: " + toSend}
			]);
		}, 300);

		input = "";
	}

</script>

<div class="chat-container">
  <div class="messages">
    {#each $messages as msg}
      <div class="bubble {msg.role}">
        {msg.content}
      </div>
    {/each}
  </div>

  <input
    bind:value={input}
    placeholder="Type a message..."
    on:keydown={(e) => e.key === "Enter" && send()}
  />

  <button on:click={view.test}>Test</button>
  <button on:click={view.clear}>Clear</button>
  <button on:click={view.openai}>OpenAI</button>
</div>


<style>

</style>
