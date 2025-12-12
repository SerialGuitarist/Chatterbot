
// import { messages } from "./state/chat";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";


function toLC(msg) {
	if (msg.role === "assistant") return new AIMessage(msg.content);
	if (msg.role === "system") return new SystemMessage(msg.content);
	return new HumanMessage(msg.content);
}

export default class Llama {
	model: ChatOpenAI;
	apiKey: string;
	rag: RAGStore;
	
	constructor(apiKey: string, rag: RAGStore = null) {
		this.apiKey = apiKey;
		// console.log(this.apiKey);
		this.model = new ChatOpenAI({
			// apparently obsidian hides your environmental variables from plugins
			// openAIApiKey: process.env.OPENAI_API_KEY,
			// reading it from settings in main and passing it here
			apiKey: this.apiKey,
			model: "gpt-4o-mini",
			temperature: 0.7
			// other params...
		})
		this.rag = rag;
	}

	async ask(messages) {
		// my attempts to decouple this code as much as possible
		// has lead me down some dark dark paths such as this code block

		// 1. get retriever
		const retriever = this.rag.getRetriever();

		// 2. get last user query
		const lastUserMessage = messages[messages.length - 1].content;

		// 3. use that to get the context documents
		const output = await retriever.invoke(lastUserMessage);
		const contexts = output.map((doc) => doc.pageContent );
		const context = {role: "system", content: "Context: " + contexts.join("\n---\n")};

		// 4. append that to the messages
		const augmentedMessages = [
			...messages,
			context
		];

		const formatted = augmentedMessages.map(toLC);
		const result = await this.model.invoke(formatted);

		return {
			reply: result,
			context: context
		};
	}

	async test() {
		console.log("calling test");
		const aiMsg = await this.model.invoke()
		console.log(aiMsg)
	}

}

