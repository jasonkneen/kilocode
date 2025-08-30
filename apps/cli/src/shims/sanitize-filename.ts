export default function sanitize(input: string): string {
	// Very simple sanitizer: replace path separators and control chars
	return input.replace(/[\\/:*?"<>|\x00-\x1F]/g, "_").slice(0, 255)
}
