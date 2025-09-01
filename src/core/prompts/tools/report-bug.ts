/**
 * Tool description for reporting bugs from CLI environment
 */
export function getReportBugDescription(): string {
	return `## report_bug

Request to report a bug or issue encountered during CLI usage. This tool captures system information, error details, and context to help with troubleshooting and bug reports.

Parameters:
- title: (required) A brief, descriptive title for the bug report
- description: (required) Detailed description of the issue, including steps to reproduce, expected behavior, and actual behavior

Usage:
<report_bug>
<title>Bug title here</title>
<description>
Detailed description of the issue:

Steps to reproduce:
1. Step one
2. Step two
3. Step three

Expected behavior:
What should have happened

Actual behavior:
What actually happened

Additional context:
Any relevant information, error messages, or system details
</description>
</report_bug>

Example: Reporting a tool execution issue
<report_bug>
<title>search_files tool fails with regex patterns containing backslashes</title>
<description>
When using the search_files tool with regex patterns containing escaped characters, the tool fails with a regex parsing error.

Steps to reproduce:
1. Run search_files with regex pattern "\\d+"
2. Tool returns "Invalid regex" error

Expected behavior:
Should successfully search for digit patterns

Actual behavior:
Fails with regex parsing error

Additional context:
This occurs specifically with escaped characters in regex patterns. Simple patterns work fine.
</description>
</report_bug>`
}
