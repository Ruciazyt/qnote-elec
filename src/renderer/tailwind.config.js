/** @type {import('tailwindcss').Config} */
export default {
	darkMode: ["class"],
	content: [
		"./index.html",
		"./sticky-note.html",
		"./island.html",
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
			// DESIGN.md 的字阶 —— Tailwind 默认阶梯只有 12 / 14 / 16 / 18 / 20，
			// 而设计规范还要 10 / 11 / 13 / 15 四档，过去全靠 text-[Npx] 硬写。
			// 这里登记成 token，新代码一律用类名（text-micro / text-label /
			// text-subhead / text-title）；12 与 14 继续用 Tailwind 自带的
			// text-xs / text-sm，20 用 text-xl。
			// 已有的 text-[Npx] 不批量返工（2026-11-05 定案）。
			// 口径见 docs/UI-GUIDELINES.md 第二节。
			fontSize: {
				micro: ['10px', { lineHeight: '1.4' }],   // micro 10px —— 超小副信息
				label: ['11px', { lineHeight: '1.4' }],   // label 11px —— 副标题、徽章
				subhead: ['13px', { lineHeight: '1.45' }], // subhead 13px —— 分组小标题
				title: ['15px', { lineHeight: '1.3' }],    // title 15px —— 卡片标题
			},
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
					foreground: 'hsl(var(--primary-foreground))',
					// 品牌色「作文字」用的深档（--primary-strong）：同一个 195° 色相，深一档。
					// --primary 自己当文字色：白底 4.93:1、98% 底 4.72:1（取更差 4.72:1）已过 AA，
					// 但任何品牌底纹都不过线（/5 是 4.42、/10 是 4.14）；这一档是 5.75:1（/10 底纹上 5.05:1）。
					// 品牌底纹上限 /15（strong 压 /20 是 4.41:1，禁用）。口径见 docs/UI-GUIDELINES.md 第二节。
					strong: 'hsl(var(--primary-strong))'
				},
				secondary: {
					DEFAULT: 'hsl(var(--secondary))',
					foreground: 'hsl(var(--secondary-foreground))'
				},
				destructive: {
					DEFAULT: 'hsl(var(--destructive))',
					foreground: 'hsl(var(--destructive-foreground))'
				},
				// 成功 / 已完成 / 通过 —— 语义色一组，位置紧跟 destructive 之后。
				// 命名与 CSS 变量同名（--success → success），改一处两处都对得上。
				success: {
					DEFAULT: 'hsl(var(--success))',
					foreground: 'hsl(var(--success-foreground))'
				},
				// 警告 / 中等难度 —— index.css 里 --warning / --warning-foreground 早就有了
				// （明暗两套主题各一份），只是没注册进 Tailwind，用 bg-warning / text-warning
				// 生成不出规则。注册在这里，语义色就齐了。
				warning: {
					DEFAULT: 'hsl(var(--warning))',
					foreground: 'hsl(var(--warning-foreground))'
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
				link: 'hsl(var(--link))',
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
