import { defineAstroPaperConfig } from "./src/types/config";

export default defineAstroPaperConfig({
  site: {
    url: "https://blog.sabti.dev/",
    title: "SABTI Riad",
    description: "I write about internals, and my take on different topics",
    author: "SABTI RIad",
    profile: "https://blog.sabti.dev/",
    ogImage: "default-og.jpg",
    lang: "en",
    timezone: "Africa/Casablanca",
    dir: "ltr",
  },
  posts: {
    perPage: 4,
    perIndex: 4,
    scheduledPostMargin: 15 * 60 * 1000,
  },
  features: {
    lightAndDarkMode: true,
    dynamicOgImage: true,
    showArchives: true,
    showBackButton: true,
    editPost: {
      enabled: false, 
    //  url: "https://github.com/satnaing/astro-paper/edit/main/",
    },
    search: "pagefind",
  },
  socials: [
    { name: "github",   url: "https://github.com/RiadSab" },
    { name: "x",        url: "https://x.com/riad_sab" },
    { name: "linkedin", url: "https://www.linkedin.com/in/sabti-riad/" },
    { name: "mail",     url: "mailto:riad@sabti.dev" },
  ],
  // shareLinks: [
  //   { name: "whatsapp", url: "https://wa.me/?text=" },
  //   { name: "facebook", url: "https://www.facebook.com/sharer.php?u=" },
  //   { name: "x",        url: "https://x.com/intent/post?url=" },
  //   { name: "telegram", url: "https://t.me/share/url?url=" },
  //   { name: "pinterest", url: "https://pinterest.com/pin/create/button/?url=" },
  //   { name: "mail",     url: "mailto:?subject=See%20this%20post&body=" },
  // ],
});