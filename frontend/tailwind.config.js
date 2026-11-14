/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          black: '#0F0F11',       // Deep Base Black (App background)
          surface: '#1A1A1E',     // Elevated Charcoal (Cards, Modals)
          border: '#2A2A30',      // Outlines and dividers
          orange: '#FF6B00',      // Core Electric Orange (Primary CTA)
          amber: '#FF8800',       // Hover and secondary interactive
          tangerine: '#FFA240',   // Highlights, badges, offer tags
          muted: '#A1A1AA',       // Secondary descriptive text
          white: '#FFFFFF',       // Primary crisp headings
        },
      },
    },
  },
  plugins: [],
};

