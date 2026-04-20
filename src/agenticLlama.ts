

/* 
ignore this class. trying to compile gives this error:
> chatterbot@0.0.1 dev
> node esbuild.config.mjs

✘ [ERROR] Could not resolve "node:async_hooks"
  node_modules/@langchain/langgraph/dist/setup/async_local_storage.js:2:34:
    2 │ import { AsyncLocalStorage } from "node:async_hooks";
      ╵                                   ~~~~~~~~~~~~~~~~~~

The package "node:async_hooks" wasn't found on the file system but is built into node.
This is because it's expecting to run on node but obsidian plugins run in electron.

Disabling this class for now until we can fix the dependencies.

export class AgenticLlama extends Llama {
	agent: any;

	constructor(
		apiKey: string,
		rag: RAGStore = null,
		onStatus?: (s: LlamaStatus) => void
	) {
		super(apiKey, rag, onStatus);
		this.status({ phase: "thinking", detail: "Setting up model"});


		this.systemMessage = {
			role: "system",
			content: "You are a helpful assistant attached to an Obsidian Vault, a note-taking knowledge base. Your primary role is to help users with questions about this vault. If a user asks a question about something you\'re unsure about, you MUST use the \`retrieve\` tool to query the vault for relevant context documents."
		};

		const retrieve = tool(
			async ({ query } : { query: string }) => {
				this.status({ phase: "thinking", detail: "Retrieving: " + query  });
				console.log("Retrieving: " + query);
				const retriever = this.rag.getRetriever();
				const documents = await retriever.invoke(query);
				// const contexts = output.map((doc) => doc.pageContent );
				// return contexts;
				return documents.map(d => d.pageContent).join("\n---\n");
			}, 
			{
				name: "retrieve",
				description: "Retrieve relevant documents from Obsidian vault",
				schema: z.object({
					query: z.string().describe("Search query for the vault")
				}),
			}
		);

		this.agent = createAgent({
			model: ChatOpenAI({
				apiKey: apiKey,
				model: "gpt-4o-mini",
				temperature: 0.7
			}),
			tools: [retrieve],
		})

		this.status({ phase: "idle"});
	}


	override async ask(messages) {
		try {
			this.status({ phase: "thinking", detail: "Agent reasoning" });

			const result = await this.agent.invoke({
				messages: [
					this.systemMessage,
					...messages
				].map(toLC),
			});

			this.status({ phase: "idle" });

			return {
				reply: result.output ?? result,
			};
		} catch (err) {
			this.status({ phase: "error", message: String(err) });
			throw err;
		}
	}
}
*/
