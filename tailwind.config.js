/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.tsx"],
  theme: {
    extend: {
      colors: {
        red: "#ff0000",
        dark: "#2a2a2a",
        darker: "#1a1a1a",
      },
    },
  },
  plugins: [],
};
