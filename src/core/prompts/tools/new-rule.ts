/**
 * Tool description for creating new rules dynamically
 */
export function getNewRuleDescription(): string {
	return `## new_rule

Request to create a new rule file for custom instructions or constraints. This tool allows dynamic rule creation that can be applied to the current project or mode.

Parameters:
- title: (required) The title/name of the rule
- description: (required) Detailed description of what the rule enforces
- target_file: (optional) Specific file pattern this rule applies to (e.g., "*.ts", "src/**/*.js")
- instructions: (optional) Specific instructions or constraints to apply

Usage:
<new_rule>
<title>Rule title here</title>
<description>Detailed description of the rule here</description>
<target_file>File pattern (optional)</target_file>
<instructions>Specific instructions (optional)</instructions>
</new_rule>

Example: Creating a TypeScript coding standard rule
<new_rule>
<title>TypeScript Strict Mode</title>
<description>Enforce strict TypeScript configuration and coding standards</description>
<target_file>*.ts</target_file>
<instructions>Use strict types, avoid 'any', prefer interfaces over types for object definitions</instructions>
</new_rule>`
}
