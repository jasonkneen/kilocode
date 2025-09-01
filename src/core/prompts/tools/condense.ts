/**
 * Tool description for condensing the current context window
 */
export function getCondenseDescription(): string {
	return `## condense

Request to condense the current context window by summarizing previous conversation history and removing redundant information while preserving important context and task state.

This tool is automatically available and does not require parameters. It helps manage token limits by:
- Summarizing completed tasks and their outcomes
- Preserving current task state and todo lists
- Removing redundant tool outputs and intermediate steps
- Maintaining essential context for ongoing work

Usage:
<condense>
</condense>

The condensation process will:
1. Analyze the current conversation for key information
2. Summarize completed tasks and preserve their outcomes
3. Maintain context for ongoing work
4. Reset the conversation with condensed history
5. Continue from the current state with reduced token usage

Note: This tool is particularly useful during long-running tasks or when approaching context limits.`
}
