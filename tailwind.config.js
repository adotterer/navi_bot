/** @type {import('tailwindcss').Config} */
export default {
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
