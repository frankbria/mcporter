import Fuse from 'fuse.js';
import { minimatch } from 'minimatch';
import type { ServerDefinition } from '../config-schema.js';
import type { ServerToolInfo } from '../runtime.js';

/**
 * Search configuration for filtering servers and tools.
 */
export interface SearchConfig {
  /** Glob pattern for filtering (e.g., "*github*", "slack.*message*") */
  filter?: string;
  /** Fuzzy search query (e.g., "send slack message", "github issues") */
  search?: string;
}

/**
 * A server with its discovered tools for search purposes.
 */
export interface ServerWithTools {
  server: ServerDefinition;
  tools: ServerToolInfo[];
}

/**
 * Result of filtering - includes matched tools per server.
 */
export interface FilteredServer {
  server: ServerDefinition;
  tools: ServerToolInfo[];
  /** Tools that matched the filter (subset of tools) */
  matchedTools: ServerToolInfo[];
}

/**
 * Filter servers using glob pattern matching.
 * Matches against: server name, server description, tool names, tool descriptions.
 *
 * Pattern examples:
 * - "*github*" - matches servers/tools containing "github"
 * - "slack.*" - matches anything starting with "slack."
 * - "*message*" - matches anything containing "message"
 */
export function filterByGlob(servers: ServerWithTools[], pattern: string): FilteredServer[] {
  const normalizedPattern = pattern.toLowerCase();
  const results: FilteredServer[] = [];

  for (const { server, tools } of servers) {
    const serverNameMatches = minimatch(server.name.toLowerCase(), normalizedPattern, { partial: true });
    const serverDescMatches = server.description
      ? minimatch(server.description.toLowerCase(), normalizedPattern, { partial: true })
      : false;

    // If server itself matches, include all tools
    if (serverNameMatches || serverDescMatches) {
      results.push({ server, tools, matchedTools: tools });
      continue;
    }

    // Otherwise, check individual tools
    const matchedTools = tools.filter((tool) => {
      const toolSelector = `${server.name}.${tool.name}`.toLowerCase();
      const toolDesc = (tool.description ?? '').toLowerCase();

      return (
        minimatch(toolSelector, normalizedPattern, { partial: true }) ||
        minimatch(tool.name.toLowerCase(), normalizedPattern, { partial: true }) ||
        minimatch(toolDesc, normalizedPattern, { partial: true })
      );
    });

    if (matchedTools.length > 0) {
      results.push({ server, tools, matchedTools });
    }
  }

  return results;
}

/**
 * Search servers using fuzzy matching.
 * More forgiving than glob - handles typos and natural language queries.
 *
 * Query examples:
 * - "send slack msg" - finds Slack message sending tools
 * - "github isues" - finds GitHub issue tools despite typo
 * - "create pr" - finds pull request creation tools
 */
export function searchFuzzy(servers: ServerWithTools[], query: string): FilteredServer[] {
  // Build a flat list of searchable items
  interface SearchItem {
    serverIndex: number;
    toolIndex: number;
    server: ServerDefinition;
    tool: ServerToolInfo;
    searchText: string;
  }

  const searchItems: SearchItem[] = [];

  servers.forEach(({ server, tools }, serverIndex) => {
    tools.forEach((tool, toolIndex) => {
      searchItems.push({
        serverIndex,
        toolIndex,
        server,
        tool,
        searchText: `${server.name} ${tool.name} ${tool.description ?? ''} ${server.description ?? ''}`,
      });
    });
  });

  const fuse = new Fuse(searchItems, {
    keys: ['searchText'],
    threshold: 0.4, // 0 = exact, 1 = match anything
    includeScore: true,
    ignoreLocation: true,
  });

  const results = fuse.search(query);

  // Group results by server
  const serverMap = new Map<string, FilteredServer>();

  for (const result of results) {
    const { server, tool } = result.item;
    const existing = serverMap.get(server.name);

    if (existing) {
      if (!existing.matchedTools.some((t) => t.name === tool.name)) {
        existing.matchedTools.push(tool);
      }
    } else {
      const serverWithTools = servers.find((s) => s.server.name === server.name);
      if (serverWithTools) {
        serverMap.set(server.name, {
          server,
          tools: serverWithTools.tools,
          matchedTools: [tool],
        });
      }
    }
  }

  return Array.from(serverMap.values());
}

/**
 * Apply search configuration to filter servers and tools.
 * If both filter and search are provided, filter is applied first, then search.
 */
export function applySearch(servers: ServerWithTools[], config: SearchConfig): FilteredServer[] {
  if (!config.filter && !config.search) {
    return servers.map(({ server, tools }) => ({ server, tools, matchedTools: tools }));
  }

  let results: FilteredServer[];

  if (config.filter) {
    results = filterByGlob(servers, config.filter);
  } else {
    results = servers.map(({ server, tools }) => ({ server, tools, matchedTools: tools }));
  }

  if (config.search) {
    // Convert FilteredServer back to ServerWithTools for fuzzy search
    const toSearch: ServerWithTools[] = results.map(({ server, matchedTools }) => ({
      server,
      tools: matchedTools,
    }));
    results = searchFuzzy(toSearch, config.search);
  }

  return results;
}

/**
 * Format a summary of search results for display.
 */
export function formatSearchSummary(
  original: ServerWithTools[],
  filtered: FilteredServer[],
  config: SearchConfig
): string {
  const totalServers = original.length;
  const totalTools = original.reduce((sum, s) => sum + s.tools.length, 0);
  const matchedServers = filtered.length;
  const matchedTools = filtered.reduce((sum, s) => sum + s.matchedTools.length, 0);

  const parts: string[] = [];

  if (config.filter) {
    parts.push(`filter: "${config.filter}"`);
  }
  if (config.search) {
    parts.push(`search: "${config.search}"`);
  }

  const criteria = parts.join(', ');
  return `Found ${matchedTools} tool(s) across ${matchedServers} server(s) matching ${criteria} (from ${totalTools} tools in ${totalServers} servers)`;
}
