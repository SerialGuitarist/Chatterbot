# LLM Provider Architecture
## Class Hierarchy

```
Llama (base - simple chat)
├── ManualLlama (abstract - manual tool use with RAG & tools)
│   ├── OpenAILlama (OpenAI provider with tool use)
│   └── OllamaLlama (Local Ollama with tool use)
└── MirrorLlama (test provider - no RAG/tools)
```

## Architecture Details

### 1. **Llama** (Base Class - Simple Chat)
- No RAG, no tools - just basic LLM chat
- Takes `apiKey` and `onStatus` callback (no RAG parameter)
- Handles message formatting and model invocation
- Status notifications for UI updates
- All RAG/tool concerns removed

### 2. **ManualLlama** (Abstract Base for Tool-Capable Providers)
Since `@langchain/langgraph` requires Node.js built-ins that don't exist in Electron, tool use is implemented manually:

- **Core Responsibility**: Implements the agent loop
  - Iterates up to 5 times
  - On each iteration, invokes the model to get responses and tool calls
  - Executes tool calls by name (currently: `retrieve`)
  - Continues loop if tools were called, returns final response otherwise
  
- **Dependencies**:
  - Requires `rag` (RAGStore) for context retrieval
  - Takes `toolsConfig` to determine which tools are enabled
  - Uses `ToolsFactory` to create tools dynamically
  
- **Abstract Methods** (subclasses must implement):
  - `initializeModel()`: Set up provider-specific LLM instance
  - `invokeTooledModel(messages)`: Call the LLM and get tool calls

- **Tool System**:
  - Uses `ToolsFactory` to create tools based on config
  - Current tools: `retrieve` (query vault via RAG)
  - All tools stored in `this.tools` array
  - Agent loop invokes tools generically by name

### 3. **Tools System** (`src/tools/toolsLibrary.ts`)
Centralizes tool management and configuration:

**ToolsFactory** provides:
- `createRetrieveTool()`: Factory for RAG retrieval tool
- `createTools()`: Instantiate all enabled tools based on `ToolsConfig`
- `getToolDescriptions()`: Build tool descriptions for system prompts

**ToolsConfig** (in `src/settings.ts`):
```typescript
interface ToolsSettings {
  retrieve: boolean;  // Enable/disable RAG-based retrieval
  // Future tools can be added here
}
```

**Extensibility Pattern**:
To add a new tool (e.g., web search, code execution):
1. Add config flag to `ToolsSettings`
2. Create factory method in `ToolsFactory`
3. Update `createTools()` to conditionally create it
4. Update `getToolDescriptions()` for system prompt

### 4. **Settings Integration**
Updated `ChatterbotPluginSettings`:
```typescript
{
  modelType: 'openai' | 'anthropic' | 'ollama' | 'mirror',
  // ... model-specific config ...
  tools: {
    retrieve: boolean;  // Toggle tools on/off
  }
}
```

This allows users to:
- Enable/disable specific tools
- Customize agent behavior without code changes
- Future: UI toggle for each tool in settings tab

### 5. **OpenAILlama** (OpenAI Provider)
- Uses `ChatOpenAI` with `.bindTools(this.tools)`
- Inherits agent loop from `ManualLlama`
- Minimal implementation - only 2 methods:
  - `initializeModel()`: Creates ChatOpenAI instance with API key
  - `invokeTooledModel()`: Calls `tooledModel.invoke(messages)`

### 6. **OllamaLlama** (Local Ollama Provider)
- Uses HTTP calls to local Ollama instance
- Implements custom tool call parsing (looks for `<tool_call>` markers)
- Inherits agent loop from `ManualLlama`
- Implements:
  - `initializeModel()`: Sets `model = null` (uses HTTP)
  - `invokeTooledModel()`: Sends prompt to Ollama, parses responses

### 7. **MirrorLlama** (Test Provider)
- Simple echo-back provider for testing
- Extends base `Llama` (no tool/RAG support)
- No dependencies on RAG or complex state

## Key Separations of Concerns

| Layer | Responsibilities |
|-------|------------------|
| **Llama** | Basic chat, model invocation |
| **ManualLlama** | Agent loop, tool iteration, RAG integration |
| **ToolsFactory** | Tool instantiation, configuration |
| **Settings** | User configuration, tool toggles |
| **Provider** (OpenAI/Ollama) | Model-specific API calls, tool parsing |

## Adding New LLM Providers

To add Anthropic, Grok, or other LLMs:

1. Create class extending `ManualLlama`:
   ```typescript
   export class AnthropicLlama extends ManualLlama {
     protected initializeModel(): void {
       this.model = new ChatAnthropic({ apiKey: this.apiKey });
       this.tooledModel = this.model.bindTools(this.tools);
     }

     protected async invokeTooledModel(messages: any[]): Promise<any> {
       return await this.tooledModel.invoke(messages);
     }
   }
   ```

2. Update `main.ts` `createLlama()` switch statement

3. Add to model settings if needed (e.g., `AnthropicSettings`)

## Adding New Tools

To add a new tool (semantic search, code execution, web search, etc.):

1. **Add to `ToolsSettings`** in `settings.ts`:
   ```typescript
   export interface ToolsSettings {
     retrieve: boolean;
     semanticSearch: boolean;  // New tool
   }
   ```

2. **Create factory method** in `ToolsFactory`:
   ```typescript
   static createSemanticSearchTool(rag: any, onStatus?: (s: any) => void): any {
     return tool(
       async ({ query }: { query: string }) => {
         // Implementation
         return results;
       },
       { name: "semantic_search", description: "..." }
     );
   }
   ```

3. **Update `createTools()`** to instantiate it:
   ```typescript
   if (config.semanticSearch && rag) {
     tools.push(this.createSemanticSearchTool(rag, onStatus));
   }
   ```

4. **Update `getToolDescriptions()`**:
   ```typescript
   if (config.semanticSearch) {
     descriptions.push("- semantic_search: ...");
   }
   ```

5. Tools are automatically available to agents via ManualLlama's agent loop

## Key Benefits

✅ **No dependency conflicts**: Avoids Node.js built-ins that break in Electron  
✅ **DRY principle**: Agent loop shared across all providers  
✅ **User configurable**: Tools toggleable via settings  
✅ **Easy to extend**: New providers/tools only need minimal code  
✅ **Flexible tool parsing**: Each provider can parse tool calls differently  
✅ **Testable**: Simple interfaces enable mocking  
✅ **RAG decoupled**: Only included where needed (ManualLlama)  
✅ **Future-proof**: Tool system ready for web search, code execution, etc.
