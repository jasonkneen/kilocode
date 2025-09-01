import { Package } from "../../shared/package.ts"

export const DEFAULT_HEADERS = {
	"HTTP-Referer": "https://kilocode.ai",
	"X-Title": "Kilo Code",
	"X-KiloCode-Version": Package.version,
	"User-Agent": `Kilo-Code/${Package.version}`,
}
