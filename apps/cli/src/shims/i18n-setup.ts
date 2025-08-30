// Minimal i18n shim for CLI bundle
type I18n = {
	language: string
	init: (opts?: any) => void
	changeLanguage: (lng: string) => void
	t: (key: string, options?: Record<string, any>) => string
}

const i18n: I18n = {
	language: "en",
	init: () => {},
	changeLanguage(lng: string) {
		this.language = lng
	},
	t(key: string, _options?: Record<string, any>) {
		return key
	},
}

export default i18n
