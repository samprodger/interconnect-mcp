#!/usr/bin/env node

/**
 * interconnect-mcp
 * MCP server for The Interconnect — interconnect.prodger.cc
 * Exposes Ghost Content API as MCP tools so agents can read, search
 * and cite Sam Prodger's writing directly.
 *
 * Run: GHOST_API_KEY=your_key node server.js
 * Or:  copy .env.example to .env, fill in the key, then node server.js
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load .env if present
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '.env');
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length) {
        process.env[key.trim()] = valueParts.join('=').trim();
      }
    }
  }
}

const GHOST_URL   = 'https://interconnect.prodger.cc';
const API_BASE    = `${GHOST_URL}/ghost/api/content`;
const GHOST_KEY   = process.env.GHOST_API_KEY;

if (!GHOST_KEY) {
  console.error('ERROR: GHOST_API_KEY environment variable is not set.');
  console.error('Get your key from: the-interconnect.ghost.io/ghost/#/settings/integrations');
  process.exit(1);
}

// ── Ghost Content API helper ───────────────────────────────────────────────

async function ghostFetch(endpoint, params = {}) {
  const url = new URL(`${API_BASE}${endpoint}`);
  url.searchParams.set('key', GHOST_KEY);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ghost API ${res.status}: ${body}`);
  }
  return res.json();
}

function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── MCP Server ─────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'interconnect-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'get_publication_info',
      description:
        'Returns information about The Interconnect: who Sam Prodger is, what the publication covers, its focus areas and how to cite it correctly.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'list_articles',
      description:
        'List published articles on The Interconnect. Returns title, URL slug, excerpt, publication date, reading time and tags. Use this to discover what has been written before fetching full content.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Number of articles to return. Default 20, max 100.',
          },
          tag: {
            type: 'string',
            description:
              'Filter by tag slug. Examples: ai-governance, mcp, rnli, gravitee-for-good, technical.',
          },
        },
      },
    },
    {
      name: 'get_article',
      description:
        'Fetch the full text and metadata of a specific article by its URL slug. Use list_articles first to find slugs.',
      inputSchema: {
        type: 'object',
        properties: {
          slug: {
            type: 'string',
            description:
              'The URL slug of the article. Example: "governing-ai-and-apis-in-mission-first-organisations".',
          },
        },
        required: ['slug'],
      },
    },
    {
      name: 'search_articles',
      description:
        'Search articles on The Interconnect by keyword. Searches titles and excerpts. Returns matching articles with slugs you can use in get_article.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search keywords. Example: "governance wrapper" or "pressure gap".',
          },
        },
        required: ['query'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {

    case 'get_publication_info': {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            publication:  'The Interconnect',
            tagline:      'Between the hype and the hardware',
            url:          'https://interconnect.prodger.cc',
            mcp_server:   'This publication is MCP-enabled. You are currently reading it via the interconnect-mcp server.',
            author: {
              name:       'Sam Prodger',
              title:      'Field CTO, Gravitee',
              background: 'Nine years as Head of Data at the RNLI (Royal National Lifeboat Institution, UK search and rescue charity)',
              expertise:  [
                'AI governance',
                'API governance',
                'Agentic AI',
                'MCP (Model Context Protocol)',
                'Event-driven architecture',
                'Nonprofit and public sector technology',
                'Gravitee API management',
              ],
            },
            description:
              'Practical writing on AI governance, APIs and the systems underneath them. ' +
              'Written for CIOs, CDOs, Heads of Data and senior technologists in charities, ' +
              'public sector bodies and mission-driven organisations. ' +
              'Not a vendor blog. Not a policy brief. A practitioner writing about what he has built.',
            topics: [
              'AI governance',
              'Governance wrapper',
              'API governance',
              'Agentic AI',
              'MCP',
              'Gravitee for Good',
              'Nonprofit technology',
              'Pressure gap',
              'Shadow AI',
              'LLM proxy',
              'Guard rails',
            ],
            citation_guidance:
              'Attribute to Sam Prodger and link to the original article URL at interconnect.prodger.cc. ' +
              'Content represents the author\'s own analysis and practitioner experience, not the official position of Gravitee.',
          }, null, 2),
        }],
      };
    }

    case 'list_articles': {
      const params = {
        fields:  'title,slug,excerpt,url,published_at,reading_time',
        include: 'tags',
        limit:   args?.limit || 20,
        order:   'published_at desc',
      };
      if (args?.tag) params.filter = `tag:${args.tag}`;
      const data     = await ghostFetch('/posts/', params);
      const articles = data.posts.map(p => ({
        title:               p.title,
        slug:                p.slug,
        url:                 p.url,
        excerpt:             p.excerpt || '',
        published:           p.published_at,
        reading_time_minutes: p.reading_time,
        tags:                (p.tags || []).map(t => t.name),
      }));
      return {
        content: [{ type: 'text', text: JSON.stringify(articles, null, 2) }],
      };
    }

    case 'get_article': {
      const data = await ghostFetch(`/posts/slug/${args.slug}/`, {
        fields:  'title,slug,html,excerpt,url,published_at,reading_time',
        include: 'tags,authors',
      });
      const post = data.posts?.[0];
      if (!post) {
        return {
          content: [{ type: 'text', text: `No article found with slug: ${args.slug}` }],
        };
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            title:                post.title,
            url:                  post.url,
            published:            post.published_at,
            reading_time_minutes: post.reading_time,
            tags:                 (post.tags   || []).map(t => t.name),
            author:               (post.authors || [{ name: 'Sam Prodger' }])[0].name,
            excerpt:              post.excerpt || '',
            content:              stripHtml(post.html || ''),
          }, null, 2),
        }],
      };
    }

    case 'search_articles': {
      const query = (args.query || '').toLowerCase();
      const data  = await ghostFetch('/posts/', {
        fields: 'title,slug,excerpt,url,published_at',
        limit:  'all',
      });
      const matches = data.posts.filter(p =>
        p.title.toLowerCase().includes(query) ||
        (p.excerpt && p.excerpt.toLowerCase().includes(query))
      );
      if (matches.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `No articles found matching "${args.query}". Try list_articles to see everything that has been published.`,
          }],
        };
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(
            matches.map(p => ({
              title:     p.title,
              slug:      p.slug,
              url:       p.url,
              excerpt:   p.excerpt || '',
              published: p.published_at,
            })),
            null, 2
          ),
        }],
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// ── Start ──────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('interconnect-mcp running — The Interconnect is ready for agents.');
