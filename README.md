# Fens

Fens crawls web applications to build an interactive graph of screens, user journeys, and accessibility/SEO issues in FalkorDB. Specialized AI agents navigate this graph, use graph algorithms and multi-hop reasoning to propose fixes, and simulate changes on throwaway graph copies to resolve conflicting goals.

---

## Setup

```bash
# 1. Start FalkorDB and FalkorDB Browser
cd fens-api && docker compose up -d

# 2. Install dependencies & Playwright
for p in fens-api fens-dashboard fens-demo-shop fens-explorer; do (cd $p && npm install && cp .env.example .env); done
cd fens-explorer && npx playwright install chromium && cd ..

# 3. Start Demo App, Crawl into FalkorDB, and Launch API & Dashboard
cd fens-demo-shop && npm run dev &
cd ../fens-explorer && npm run crawl -- --graph demo-shop-v1 --url http://localhost:5174 --reset &
cd ../fens-api && npm run dev &
cd ../fens-dashboard && npm run dev
```

---

## FalkorDB Tools & Capabilities Used

### Graph Database & Visual Inspection
- **FalkorDB Engine (Docker):** Powers the core graph datastore with low-latency in-memory graph operations accessed via Redis protocol.
- **FalkorDB Browser:** Built-in web UI (`http://localhost:3000`) for querying, visualizing screen topologies, and inspecting nodes and edges interactively.

### Graph Cloning & Sandboxed Simulation
- **`GRAPH.COPY` & `GRAPH.DELETE`:** Instantly clones full graphs for multi-tenant isolation and powers the arbitration decider. The decider spins up temporary simulation graphs (`sim-<id>`), applies proposed fixes directly to the graph, evaluates impact, and immediately discards the sandbox copy.

### Built-in Graph Algorithms
- **PageRank (`algo.pageRank`):** Ranks screen importance based on inbound flow edges to highlight high-traffic hub pages.
- **Betweenness Centrality (`algo.betweenness`):** Pinpoints critical navigational bottlenecks that multiple user paths depend on.
- **Shortest Path (`shortestPath`):** Compares ideal click paths against recorded user journeys to identify detours and friction points.
- **Community Detection (`algo.labelPropagation`):** Clusters tightly connected screens into functional areas (like checkout funnels or catalog browsing).

### Vector Search Index
- **Vector Search Indexing (`db.idx.vector`):** Uses cosine similarity over page text embeddings to find semantically similar screens and identify items placed under mismatched categories.

### Multi-Hop Reasoning
- Traverses complex relationships linking screens to component instances, design system templates, guideline violations, and conflicting rules in a single query. This traces how one root component bug impacts multiple screens and exposes UX vs. SEO trade-offs.

### Episodic & Semantic Graph Memory
- **Episodic Memory:** Stores a chronological timeline of past scans, user decisions, and agent investigations so agents avoid repeating prior work.
- **Semantic Memory:** Maintains evolving facts and rules in structured statements, automatically linking newer updates to the older statements they supersede.
