# Chatterbot

An intelligent chatbot plugin for Obsidian that lets you talk to your vault and (coming soon) request changes made.
- Built with Svelte
- Powered primarily by LangChain
- Supports agentic tool use.

## Features

- **Interactive Chat UI** built using Svelte
- **AI-Powered Conversations** with the ability to have multiple separate chats with their own contexts
- **Agentic Tool Use** extends the LLM's ability to interact with your vault
- **Granular Tool Control** allowing toggling of individual tools on/off
- **Multiple Providers** (coming soon)

## Installation

1. Navigate to `{Vault}/.obsidian/plugins`
1. Run `$ git clone https://github.com/SerialGuitarist/Chatterbot.git` to clone this repository
2. Run `npm install && npm run build` to install dependencies and compile
4. Reload Obsidian and enable the plugin

## Configuration

### Provider Setup

#### Ollama (Local)
1. [Install and run Ollama](https://ollama.ai)
2. Pull a model: `ollama pull llama2` (or your preferred model)
3. In Obsidian, open **Settings > Chatterbot**
4. Select "Ollama" as your provider
5. Enter the base URL for API requests (eg. `http://localhost:11434`)
6. Enter the model name of your choice with Ollama (eg. `gemma2`)

#### OpenAI (Cloud) (coming soon)
1. Get an API key from [OpenAI](https://platform.openai.com/api-keys)
2. In Obsidian, open **Settings > Chatterbot**
3. Select "OpenAI" as your provider
4. Paste your API key in the provided field
5. Choose your preferred model (e.g., `gpt-4`, `gpt-3.5-turbo`) (coming soon)

#### Claude (coming soon)

### Tool Configuration

**Settings > Chatterbot** provides you with a checklist toggling individual tools for the chatbot, allowing you to control just how much control the agent has over your vault.

## Available Tools

### Notice
Sends a highlighted notice with the chatbot's response message directly into your vault view.

### List Markdown Files
Gives the output of `vault.getMarkdownFiles()` (list of the md files in your vault) to the chatbot