
// import { messages } from "./state/chat";
import { ChatOpenAI } from "@langchain/openai";


export default class Llama {
	model: ChatOpenAI;
	apiKey: string;
	
	constructor(apiKey: string) {
		this.apiKey = apiKey;
		console.log(this.apiKey);
		this.model = new ChatOpenAI({
			// apparently obsidian hides your environmental variables from plugins
			// openAIApiKey: process.env.OPENAI_API_KEY,
			// reading it from settings in main and passing it here
			apiKey: this.apiKey,
			model: "gpt-4o-mini",
			temperature: 0.7
			// other params...
		})
	}

	async ask(messages) {
		return await this.model.invoke(messages);
	}

	async test() {
		console.log("calling test");
		const aiMsg = await this.model.invoke()
		console.log(aiMsg)
	}
}

