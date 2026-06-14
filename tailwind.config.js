/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Legacy Heres.* names kept; values now resolve to the Quiet Ledger
        // palette via channel vars (rgb(... / <alpha-value>) keeps opacity
        // utilities like bg-Heres-card/60 working). Purple is retired to ash.
        Heres: {
          bg: 'rgb(var(--ink-rgb) / <alpha-value>)',
          surface: 'rgb(var(--surface-rgb) / <alpha-value>)',
          card: 'rgb(var(--card-rgb) / <alpha-value>)',
          border: 'var(--hair)',
          accent: 'rgb(var(--gold-rgb) / <alpha-value>)',
          accentDim: 'var(--gold-dim)',
          purple: 'rgb(var(--ash-rgb) / <alpha-value>)',
          purpleDim: 'rgb(var(--ash-rgb) / 0.18)',
          cyan: 'rgb(var(--gold-rgb) / <alpha-value>)',
          muted: 'rgb(var(--ash-rgb) / <alpha-value>)',
          white: 'rgb(var(--vellum-rgb) / <alpha-value>)',
          brand: 'rgb(var(--gold-rgb) / <alpha-value>)',
        },
        // First-class Quiet Ledger tokens (names that do not collide with
        // Tailwind defaults; brand = the cyan accent).
        ink: 'rgb(var(--ink-rgb) / <alpha-value>)',
        surface: 'rgb(var(--surface-rgb) / <alpha-value>)',
        card: 'rgb(var(--card-rgb) / <alpha-value>)',
        vellum: 'rgb(var(--vellum-rgb) / <alpha-value>)',
        ash: 'rgb(var(--ash-rgb) / <alpha-value>)',
        brand: 'rgb(var(--gold-rgb) / <alpha-value>)',
        danger: 'rgb(var(--danger-rgb) / <alpha-value>)',
        warn: 'rgb(var(--warn-rgb) / <alpha-value>)',
        hair: 'var(--hair)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'sans-serif'],
        serif: ['var(--font-serif)', 'Georgia', 'serif'],
        grotesk: ['var(--font-grotesk)', 'system-ui', 'sans-serif'],
      },
      animation: {
        'fade-in-up': 'fadeInUp 0.7s ease-out forwards',
        'fade-in': 'fadeIn 0.6s ease-out forwards',
        'float': 'float 6s ease-in-out infinite',
        'glow-pulse': 'glowPulse 3s ease-in-out infinite',
        'shimmer': 'shimmer 2.5s linear infinite',
        'grain': 'grain 8s steps(10) infinite',
      },
      keyframes: {
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(32px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-16px)' },
        },
        glowPulse: {
          '0%, 100%': { opacity: '0.5' },
          '50%': { opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        grain: {
          '0%, 100%': { transform: 'translate(0, 0)' },
          '10%': { transform: 'translate(-5%, -10%)' },
          '20%': { transform: 'translate(-15%, 5%)' },
          '30%': { transform: 'translate(7%, -25%)' },
          '40%': { transform: 'translate(-5%, 25%)' },
          '50%': { transform: 'translate(-15%, 10%)' },
          '60%': { transform: 'translate(15%, 0%)' },
          '70%': { transform: 'translate(0%, 15%)' },
          '80%': { transform: 'translate(3%, 35%)' },
          '90%': { transform: 'translate(-10%, 10%)' },
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'hero-glow': 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(34, 211, 238, 0.15), transparent 50%), radial-gradient(ellipse 60% 40% at 80% 50%, rgba(167, 139, 250, 0.12), transparent 50%)',
      },
      boxShadow: {
        'glow-cyan': '0 0 40px rgba(34, 211, 238, 0.2)',
        'glow-purple': '0 0 40px rgba(167, 139, 250, 0.2)',
        'glow-cyan-lg': '0 0 80px rgba(34, 211, 238, 0.15)',
        'card-hover': '0 24px 48px -12px rgba(0, 0, 0, 0.5)',
        'bento': '0 0 0 1px rgba(255,255,255,0.05), 0 2px 20px rgba(0,0,0,0.3)',
        'bento-hover': '0 0 0 1px rgba(34,211,238,0.2), 0 8px 40px rgba(0,0,0,0.4)',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
    },
  },
  plugins: [],
}
