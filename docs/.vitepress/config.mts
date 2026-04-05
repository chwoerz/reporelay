import { defineConfig } from "vitepress";
import { withMermaid } from "vitepress-plugin-mermaid";

export default withMermaid(
  defineConfig({
    title: "RepoRelay",
    description: "Self-hosted, MCP-native code context engine for private repositories",
    base: "/reporelay/",

    head: [["link", { rel: "icon", type: "image/svg+xml", href: "/reporelay/logo.svg" }]],

    vite: {
      optimizeDeps: {
        include: ["mermaid", "dayjs"],
      },
    },

    themeConfig: {
      logo: "/logo.svg",

      nav: [
        { text: "Guide", link: "/guide/why-reporelay" },
        { text: "Reference", link: "/reference/api" },
        {
          text: "GitHub",
          link: "https://github.com/chwoerz/reporelay",
        },
      ],

      sidebar: {
        "/guide/": [
          {
            text: "Introduction",
            items: [
              { text: "Why RepoRelay?", link: "/guide/why-reporelay" },
              { text: "Getting Started", link: "/guide/getting-started" },
            ],
          },
          {
            text: "Features",
            items: [
              { text: "Indexing Pipeline", link: "/guide/indexing-pipeline" },
              { text: "MCP Integration", link: "/guide/mcp-integration" },
              {
                text: "Supported Languages",
                link: "/guide/supported-languages",
              },
              {
                text: "Embedding Providers",
                link: "/guide/embedding-providers",
              },
            ],
          },
          {
            text: "Operations",
            items: [
              { text: "Admin Dashboard", link: "/guide/admin-dashboard" },
              { text: "Configuration", link: "/guide/configuration" },
              { text: "Database Design", link: "/guide/database-design" },
            ],
          },
        ],
        "/reference/": [
          {
            text: "Reference",
            items: [
              { text: "REST API", link: "/reference/api" },
              { text: "MCP Tools", link: "/reference/mcp-tools" },
              { text: "Project Structure", link: "/reference/project-structure" },
              { text: "Tech Stack", link: "/reference/tech-stack" },
            ],
          },
        ],
      },

      socialLinks: [
        {
          icon: "github",
          link: "https://github.com/chwoerz/reporelay",
        },
      ],

      footer: {
        message: "Released under the MIT License.",
        copyright: "Copyright 2025-present",
      },

      search: {
        provider: "local",
      },

      outline: {
        level: [2, 3],
      },
    },

    mermaid: {},
  }),
);
