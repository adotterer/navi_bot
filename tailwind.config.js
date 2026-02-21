/** @type {import('tailwindcss').Config} */
export default {
    darkMode: 'class',
    content: ['src/admin/**/*.js', 'server-admin.js'],
    theme: {
        extend: {
            fontFamily: {
                sans: ['Inter', 'system-ui', 'sans-serif'],
                mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
            },
        },
    },
    plugins: [],
};
