import { Plugin, Notice } from "obsidian";
import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { OpenAIEmbeddings } from "@langchain/openai";
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";

// ---------------- hashing stuffs have been deprecated in current implementation
// import xxhash64 from "xxhash-wasm";
// // might move ower to something called a noncryptographic hash like xxhash
// // if this turns out to be too slow
// async function sha256(str: string) {
	// const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
	// return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, "0")).join("");
// }
// 
// // let xx: ((input: string, seed?: number) => string) | null = null;
// let xx: any = null;
// 
// async function getXX() {
	// if (!xx) {
		// xx = await xxhash64();
	// }
	// return xx;
// }
// 
// async function xxhash(str: string): Promise<string> {
	// const { h64 } = await getXX();
	// return h64(str); // returns hex string
// }
// -----------------------------------------------------------------------------

interface PersistedChunk {
	// id: string;				// provided by document spliiter
	file: string;          	// original markdown path
	// hash: string;			// checksum of the chunk
	embedding: number[];    // embedding vector
	content: string;		// yahoo
	// position: number;      	// chunk index inside the file
}



export class RAGStore {
	plugin: Plugin;
	vectorStore: MemoryVectorStore | null = null;
	embeddings: OpenAIEmbeddings;
	chunks: PersistedChunk[] = [];
	// hashFunction: (input: string) => Promise<string>;
	persistedFiles: string[] = [];
	lastUpdate: number = 0;


	constructor(plugin: Plugin) {
	// constructor(plugin: Plugin, hashFunction = xxhash) {
		this.plugin = plugin;
		this.embeddings = new OpenAIEmbeddings({
			model: "text-embedding-3-large",
			apiKey: plugin.settings.apiKey
		});
		// this.hashFunction = hashFunction;
	}

	// read persistence from disk
	async load() {
		const data = await this.plugin.loadData();
		// data?. ony chains if data is not null otherwise is null
		// ?? [] returns [] if null
		this.chunks = (data?.chunks ?? []) as PersistedChunk[];
		this.lastUpdate = data?.lastUpdate ?? 0 // of type timestamp
		this.persistedFiles = data?.persistedFiles ?? [] // of type [string] denoting file paths
		console.log("RAG: loaded", this.chunks.length, "chunks");

		this.vectorStore = new MemoryVectorStore(this.embeddings);

		if (this.chunks.length === 0) return;

		await this.vectorStore.addVectors(
			this.chunks.map(c => c.embedding),
			this.chunks.map(
				c =>
					new Document({
					pageContent: c.content,
					metadata: {
						// id: c.id,
						file: c.file,
						// hash: c.hash,
						// position: c.position,
					},
				})
			)
		);
	}

	// save vector store as json into data.json
	async save() {
		const data = await this.plugin.loadData() ?? {};
		data.chunks = this.chunks;
		data.lastUpdate = this.lastUpdate;
		data.persistedFiles = this.persistedFiles;
		await this.plugin.saveData(data);
		console.log("RAG: saved", this.chunks.length, "chunks");
	}

	// update index by embedding only changed chunks
	async updateFromVault() {
		// possible changes:
		// - normal editing => captured by last modified => delete chunks from this file and regenerate them from the file
		// - created file => captured by last modified => delete chunks from this file and regenerate them from the file
		// - deleted file => internal indexing contains a list of filepaths that are currently up to date in the index
		//					=> turn that into a map of path to boolean and while iterating through the entire vault
		//					   be checking them as true then afterwards, filter for the stuff we didn't see then delete
		//					   the records of all of those at the end
		// - moved files => assumed to be solved by procedures identical to deletd then created elsewhere

		// -----------------------
		// 1. one pass over all the files
		//		add all files into another set, allCurrentFiles, for deleted file purposes
		//		if file has with last modified dates later than lastUpdate
		//			adds them all into some set, toEmbed

		// 2. one pass over all the persisted files
		//		see if theyre in allCurrentFiles, if not, means deleted, add them to deletedFiles

		// 3. one pass over persisted chunks
		//		if from a file in deletedFiles, delete (ie, dont add to the new persisted chunks)

		// 4. one pass over toEmbed files
		//		split them, embed them, add them to persisted chunks

		// 5. turn persisted chunks into vectorstore
		// save question mark
		// ------------------------

		// -------------- 0. setting up
		// warm up. go do some stretches and run a few klicks and then some more stretches
		new Notice("Chatterbot: Updating from vault")

		// -------------- 1. pass over the current files
		const allCurrentFiles = new Set<string>();
		const filesToEmbed = new Set<TFile>();

		const vault = this.plugin.app.vault;
		const vaultFiles = vault.getMarkdownFiles();
		const persistedFilesSet: Set<string> = new Set(this.persistedFiles);
		new Notice("1/6: Passing over " + vaultFiles.length + " vault files.");
		for (const file of vaultFiles) {

			allCurrentFiles.add(file.path);
			// console.log(file)

			if (file.stat.mtime > this.lastUpdate || !persistedFilesSet.has(file.path)) {
				filesToEmbed.add(file);
			}
		}

		// -------------- 2. pass over the persisted files
		const deletedFiles = new Set<string>();
		new Notice("2/6: Passing over " + this.persistedFiles.length + " persisted files.")
		for (const file of this.persistedFiles) {
			if (!allCurrentFiles.has(file)) {
				deletedFiles.add(file);
			}
		}

		// -------------- 3. pass over persisted chunks
		const newChunks: PersistedChunk[] = [];
		const changedFiles = new Set<string>(Array.from(filesToEmbed).map(f => f.path));
		new Notice("3/6: Passing over " + this.chunks.length + " persisted chunks.")
		for (const chunk of this.chunks) {
			if (!deletedFiles.has(chunk.file) && !changedFiles.has(chunk.file)) {
				newChunks.push(chunk);
			}
		}

		// -------------- 4. one pass over toEmbed files
		const splitter = new RecursiveCharacterTextSplitter({
			chunkSize: 1000,
			chunkOverlap: 200,
		});
		new Notice("4/6: Passing over " + filesToEmbed.size + " files to embed.")
		for (const file of filesToEmbed) {
			const text = await vault.cachedRead(file);

			const splits = await splitter.splitText(text);

			// chunk indexing doesnt have anything to d owith
			// chunk sizing so we index them by 0s 1s and 2s
			// let position = 0;
			for (const chunkText of splits) {
				// we dont care if this was modified or newly created
				// embed new chunk
				const embedding = await this.embeddings.embedQuery(chunkText);

				newChunks.push({
					file: file.path,
					embedding,
					content: chunkText,
				});
			}
		}

		// -------------- 5. persisted chunks -> vector store
		this.chunks = newChunks;
		new Notice("5/6: Rebuilding vector store from " + this.chunks.length + " chunks.");

		// rebuild vector store
		this.vectorStore = new MemoryVectorStore(this.embeddings);
		await this.vectorStore.addVectors(
			this.chunks.map(c => c.embedding),
			this.chunks.map(
				c =>
					new Document({
					pageContent: c.content,
					metadata: {
						// id: c.id,
						file: c.file,
						// hash: c.hash,
						// position: c.position,
					},
				})
			)
		);

		// -------------- 6. final cleanups
		new Notice("6/6: Applying final changes");
		this.lastUpdate = Date.now();
		this.persistedFiles = Array.from(allCurrentFiles);
		await this.save();
		new Notice("Chatterbot RAG updated!");
	}


	// turn into a retriever
	getRetriever(k = 5) {
		if (!this.vectorStore)
			throw new Error("RAG not loaded — call rag.load() first");
		return this.vectorStore.asRetriever({
			searchType: "mmr",
			searchKwargs: {
				fetchK: k
			}
		});
	}

	async deprecatedUpdateFromVault() {
		const vault = this.plugin.app.vault;

		// build a lookup map for chunk reuse
		// const existingByHash = new Map();
		// for (const c of this.chunks) {
			// existingByHash.set(c.hash, c);
		// }
		// fancy one liner version
		const existingByHash = new Map(this.chunks.map(c => [c.hash, c]));

		const splitter = new RecursiveCharacterTextSplitter({
			chunkSize: 1000,
			chunkOverlap: 200,
		});

		const newChunks: PersistedChunk[] = [];

		// we rechunk every file
		// TODO: change this to rechunking only the files who has
		// last modification dates later than whenever we did all
		// the chunking? but then that doesnt take care of deletions
		for (const file of vault.getMarkdownFiles()) {
			const text = await vault.cachedRead(file);

			const splits = await splitter.splitText(text);

			// chunk indexing doesnt have anything to d owith
			// chunk sizing so we index them by 0s 1s and 2s
			let position = 0;
			// then we see if the checksums of each of the chunks
			// exist in our old chunks
			for (const chunkText of splits) {
				const hash = await this.hashFunction(chunkText);

				// if we already have a cjunk with this hash, reuse it
				const existing = existingByHash.get(hash);
				if (existing) {
					// gotta account for files that were moved around
					// which changes hteir metadata but doesnt change
					// the hash
					const reused = { ...existing, file: file.path, position };
					newChunks.push(reused);
				} else {
					// we dont care if this was modified or newly created
					// embed new chunk
					const embedding = await this.embeddings.embedQuery(chunkText);

					newChunks.push({
						id: crypto.randomUUID(),
						file: file.path,
						hash,
						embedding,
						content: chunkText,
						position,
					});
				}

				position++;
			}
		}

		// replace old chunks
		// we are leaving out the chunks present in old chunk
		// that didnt have a matching checksum becuase they were edited
		this.chunks = newChunks;

		// rebuild vector store
		this.vectorStore = new MemoryVectorStore(this.embeddings);
		await this.vectorStore.addVectors(
			this.chunks.map(c => c.embedding),
			this.chunks.map(
				c =>
					new Document({
					pageContent: c.content,
					metadata: {
						id: c.id,
						file: c.file,
						hash: c.hash,
						position: c.position,
					},
				})
			)
		);

		await this.save();
	}
}

