# Resilience Mesh ⚡

Offline-first Incident Command PWA for disaster response teams.

**Target users:** Volunteer teams (CERT, ham radio, small agencies), ICS field staff

## Core Features

| Feature | ICS Form | Status |
|---|---|---|
| Incident Snapshots | ICS-209 | ✅ Phase 1 |
| Activity Log | ICS-214 | ✅ Phase 1 |
| Resource Requests | — | ✅ Phase 1 |
| Dispatcher Triage | — | ✅ Phase 1 |
| Offline Sync | — | ✅ Phase 1 |
| Conflict Resolution | — | ✅ Phase 1 |
| Audit Trail | — | ✅ Phase 1 |
| JSON Export/Import | — | ✅ Phase 1 |
| WebEOC Bridge | — | ⏳ Phase 2 |
| P2P Mesh Sync | — | ⏳ Phase 2 |

## Architecture

```
sync topology: star (field → central RxDB/CouchDB server)
conflict strategy: hybrid CRDT/LWW
  - CRDT auto-merge: structured fields (counts, enums, timestamps)
  - LWW + audit trail: free-text fields (narrative, notes)
target device: PWA, touch-first (48px+ targets, bottom-sheet forms)
adoption wedge: volunteer-first → professional EOC in Phase 2
```

## Quick Start

### Review harness (runs in any browser, no build needed)

Open `index.html` directly in Chrome, Firefox, Safari, or Edge.

### Development

**Requirements:** Node.js 18+, npm

```bash
# Install dependencies
npm install

# Start Vite dev server
npm run dev

# Run tests
npm test

# Build for production
npm run build
```

### Docker (full stack)

```bash
cd docker
docker compose up --build
```

## Project Structure

```
resilience-mesh/
├── index.html                 # Standalone review harness
├── package.json               # Dependencies and scripts
├── tsconfig.json              # TypeScript config
├── .env.example               # Environment variables
├── src/
│   ├── utils/
│   │   └── schema-audit.ts    # Field-level merge strategy table
│   ├── stores/
│   │   └── conflictHandler.ts # Hybrid CRDT/LWW conflict handler
│   ├── components/            # React components (Phase 1.1)
│   ├── types/                 # TypeScript type definitions
│   └── styles/                # CSS modules
├── server/
│   └── src/
│       ├── routes/            # Express/Fastify API routes
│       └── db/                # PostgreSQL migrations
├── tests/
│   └── conflictHandler.test.ts # Vitest test suite
├── docker/
│   ├── docker-compose.yml     # Full stack orchestration
│   ├── Dockerfile.client      # Nginx-based client image
│   └── Dockerfile.server      # Node.js server image
└── docs/
    ├── USER_GUIDE.md          # User documentation
    ├── ARCHITECTURE.md        # System architecture
    ├── API.md                 # API reference
    └── DEPLOYMENT.md          # Deployment instructions
```

## Schema Audit — Merge Strategy

### ICS-209 (Incident Snapshot)

| Field | Strategy | Rationale |
|---|---|---|
| incidentName | LWW+audit | Free-text; unique |
| incidentNumber | CRDT ($set) | Unique key |
| incidentType | CRDT ($set) | Enum |
| operationalPeriodStart/End | CRDT ($set) | Single authoritative time |
| sizeAcres | CRDT ($max) | Conservative: highest |
| percentContained | CRDT ($max) | Conservative: highest |
| personnel.* | CRDT ($set) | Map; independent edits |
| equipment.* | CRDT ($set) | Map; independent edits |
| fuelType | CRDT ($set) | Enum |
| hazards | LWW+audit | Free-text |
| situationSummary | LWW+audit | **Human judgment** |
| remarks | LWW+audit | **Human judgment** |
| changeHistory | CRDT ($push) | Append-only |

### ICS-214 (Activity Log)

| Field | Strategy | Rationale |
|---|---|---|
| logEntryId | CRDT ($set) | UUID |
| operatorName | LWW+audit | Free-text |
| activityDescription | LWW+audit | **Human judgment** |
| operationalPeriod | CRDT ($set) | Enum |
| timestamp | CRDT ($set) | Authoritative |
| handoffNotes | LWW+audit | **Human judgment** |
| resourceAssignments | CRDT ($push) | Append-only |

## Test Suite

```bash
npm test
```

Tests cover the `HybridConflictHandler`:

- ✅ Auto-merges CRDT-safe numeric fields without conflict
- ✅ Auto-merges CRDT-safe enum fields
- ✅ Flags LWW+audit text fields as conflicts
- ✅ Flags ICS-214 activity descriptions
- ✅ Applies chosen version on resolution
- ✅ Preserves audit trail after resolution
- ✅ Handles multiple conflicts independently
- ✅ Returns null for already-resolved conflicts

## Environment Variables

See `.env.example`:

| Variable | Description | Default |
|---|---|---|
| JWT_SECRET | Auth signing secret | (required) |
| DB_HOST | PostgreSQL host | localhost |
| DB_PORT | PostgreSQL port | 5432 |
| DB_NAME | Database name | resilience_mesh |
| DB_USER | Database user | mesh_user |
| DB_PASSWORD | Database password | (required) |
| VITE_SYNC_URL | Sync server URL | http://localhost:5984 |
| VITE_OFFLINE_CACHE_TTL | Offline cache TTL | 259200000 (72h) |

## Deployment

**Client:** Static hosting (Vercel, Netlify, Cloudflare Pages, S3+CloudFront)

**Server:** Docker container (ECS, Fly.io, Railway, or any VPS)

**Database:** PostgreSQL 16+

## License

ISC — Internal Council Standard