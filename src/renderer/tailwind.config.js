/** @type {import('tailwindcss').Config} */
export default {
	darkMode: ["class"],
	content: [
		"./index.html",
		"./*.{js,ts,jsx,tsx}",
		"./{components,hooks,lib,pages,styles,utils}/**/*.{js,ts,jsx,tsx}",
	],
	theme: {
		container: {
			center: true,
			padding: "2rem",
			screens: {
				"2xl": "1400px",
			},
		},
		extend: {
			borderRadius: {
				lg: 'var(--radius)',
				md: 'calc(var(--radius) - 2px)',
				sm: 'calc(var(--radius) - 4px)'
			},
			colors: {
				border: 'hsl(var(--border))',
				input: 'hsl(var(--input))',
				ring: 'hsl(var(--ring))',
				background: 'hsl(var(--background))',
				foreground: 'hsl(var(--foreground))',
				primary: {
					DEFAULT: 'hsl(var(--primary))',
					foreground: 'hsl(var(--primary-foreground))'
				},
				secondary: {
					DEFAULT: 'hsl(var(--secondary))',
					foreground: 'hsl(var(--secondary-foreground))'
				},
				destructive: {
					DEFAULT: 'hsl(var(--destructive))',
					foreground: 'hsl(var(--destructive-foreground))'
				},
				muted: {
					DEFAULT: 'hsl(var(--muted))',
					foreground: 'hsl(var(--muted-foreground))'
				},
				accent: {
					DEFAULT: 'hsl(var(--accent))',
					foreground: 'hsl(var(--accent-foreground))'
				},
				popover: {
					DEFAULT: 'hsl(var(--popover))',
					foreground: 'hsl(var(--popover-foreground))'
				},
				card: {
					DEFAULT: 'hsl(var(--card))',
					foreground: 'hsl(var(--card-foreground))'
				},
				chart: {
					'1': 'hsl(var(--chart-1))',
					'2': 'hsl(var(--chart-2))',
					'3': 'hsl(var(--chart-3))',
					'4': 'hsl(var(--chart-4))',
					'5': 'hsl(var(--chart-5))'
				},
				sidebar: {
					DEFAULT: 'hsl(var(--sidebar-background))',
					foreground: 'hsl(var(--sidebar-foreground))',
					border: 'hsl(var(--sidebar-border))',
					primary: 'hsl(var(--sidebar-primary))',
					'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
					accent: 'hsl(var(--sidebar-accent))',
					'accent-foreground': 'hsl(var(--sidebar-accent-foreground))'
				}
			},
			keyframes: {
				"fade-in": {
					"0%": { opacity: "0", transform: "translateY(10px)" },
					"100%": { opacity: "1", transform: "translateY(0)" },
				},
				"popup-appear": {
					"from": { opacity: "0", transform: "scale(0.95) translateY(10px)" },
					"to": { opacity: "1", transform: "scale(1) translateY(0)" },
				},
				"popup-disappear": {
					"from": { opacity: "1", transform: "scale(1) translateY(0)" },
					"to": { opacity: "0", transform: "scale(0.95) translateY(10px)" },
				},
				"dot-wave": {
					"0%, 60%, 100%": { transform: "translateY(0)" },
					"30%": { transform: "translateY(-4px)" },
				},
				"pulse-ring": {
					"0%, 100%": { opacity: "0.4", transform: "scale(1)" },
					"50%": { opacity: "0.8", transform: "scale(1.05)" },
				},
			},
			animation: {
				"fade-in": "fade-in 0.3s ease-in-out",
				"popup-appear": "popup-appear 200ms cubic-bezier(0.22, 1, 0.36, 1) forwards",
				"popup-disappear": "popup-disappear 150ms ease-in forwards",
				"dot-wave": "dot-wave 1.2s ease-in-out infinite",
				"pulse-ring": "pulse-ring 2s ease-in-out infinite",
			},
		}
	},
	plugins: [require("tailwindcss-animate")],
}
