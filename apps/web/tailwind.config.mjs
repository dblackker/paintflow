/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        paint: {
          bg: '#f6f7f4',
          surface: '#ffffff',
          muted: '#f1f4ef',
          border: '#dfe6dd',
          ink: '#17201b',
          sage: '#176b5b',
          ocean: '#365f91',
          clay: '#a85f3f',
        },
      },
      boxShadow: {
        paint: '0 1px 2px rgb(23 32 27 / 0.06), 0 10px 28px rgb(23 32 27 / 0.05)',
      },
      borderRadius: {
        paint: '0.625rem',
      },
    },
  },
  plugins: [],
};
