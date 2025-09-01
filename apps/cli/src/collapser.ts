// Simple collapsible output manager for the CLI
// - Registers collapsed blocks and prints a single-line preview
// - Ctrl+R expands the most recent collapsed block by printing full content

export type CollapsedEntry = {
	id: number
	title: string
	preview: string
	full: string
	expanded: boolean
}

export class Collapser {
	private entries: CollapsedEntry[] = []
	private nextId = 1

	constructor(private out: NodeJS.WriteStream = process.stdout) {}

	// Register a collapsed block and print its one-line preview
	add(title: string, preview: string, full: string): number {
		const id = this.nextId++
		const entry: CollapsedEntry = { id, title, preview, full, expanded: false }
		this.entries.push(entry)
		this.printPreview(entry)
		return id
	}

	// Update the most recent collapsed entry with new content (horizontal updates only)
	updateLast(newPreview: string, newFull: string): void {
		if (this.entries.length === 0) return
		const lastEntry = this.entries[this.entries.length - 1]
		if (!lastEntry.expanded) {
			lastEntry.preview = newPreview
			lastEntry.full = newFull
			// Just update the internal content - avoid vertical cursor manipulation
			// The preview was already shown and will be available for expansion
		}
	}

	// Expand the most recent collapsed entry
	expandLast(): void {
		for (let i = this.entries.length - 1; i >= 0; i--) {
			const e = this.entries[i]
			if (!e.expanded) {
				this.out.write(`\n${e.full}\n`)
				e.expanded = true
				return
			}
		}
	}

	// Expand by 1-based index (order added)
	expandByIndex(index: number): void {
		const e = this.entries[index - 1]
		if (!e) return
		if (!e.expanded) {
			this.out.write(`\n${e.full}\n`)
			e.expanded = true
		}
	}

	// List collapsed entries with indices and titles
	list(): string {
		if (this.entries.length === 0) return "No collapsed blocks."
		const dim = "\u001b[2m"
		const reset = "\u001b[22m"
		return this.entries
			.map((e, i) => `${i + 1}. ${e.title} ${dim}${e.expanded ? "(expanded)" : "(collapsed)"}${reset}`)
			.join("\n")
	}

	private printPreview(e: CollapsedEntry) {
		const dim = "\u001b[2m"
		const reset = "\u001b[22m"
		const idx = this.entries.indexOf(e) + 1
		this.out.write(`[${idx}] ${e.title}\n  ⎿  ${dim}${e.preview}${reset}\n`)
	}
}
