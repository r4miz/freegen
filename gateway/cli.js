#!/usr/bin/env node
// freegen CLI: start | status | set-backend <url> [token] | set-providers a,b,c | routes
import { getConfig, savePersisted } from './config.js';

const [cmd, ...args] = process.argv.slice(2);
const cfg = getConfig();

async function main() {
  switch (cmd) {
    case 'start': {
      const { startServer } = await import('./server.js');
      startServer(cfg.port);
      console.log(`[freegen] gateway listening on ${cfg.publicBase}`);
      console.log(`[freegen] providers: ${cfg.providers.join(' > ')}  comfy: ${cfg.comfyUrl || 'not set'}`);
      break;
    }
    case 'set-backend': {
      if (!args[0]) throw new Error('usage: freegen set-backend <comfy-url> [token]');
      savePersisted({ comfyUrl: args[0].replace(/\/+$/, ''), ...(args[1] ? { comfyToken: args[1] } : {}) });
      console.log(`saved comfyUrl=${args[0]}${args[1] ? ' (+token)' : ''}`);
      break;
    }
    case 'set-providers': {
      savePersisted({ providers: args[0] });
      console.log(`saved providers=${args[0]}`);
      break;
    }
    case 'status': {
      const r = await fetch(`${cfg.publicBase}/freegen/status`).catch(() => null);
      if (!r) { console.log(`gateway not running at ${cfg.publicBase}. Start with: npm start`); break; }
      const s = await r.json();
      console.log(JSON.stringify({ config: s.config, providers: s.providers }, null, 2));
      const wf = s.providers?.comfy?.workflows || {};
      const live = Object.entries(wf).filter(([, v]) => v.ok).map(([k]) => k);
      console.log(`\nComfy workflows live: ${live.length ? live.join(', ') : 'none'}`);
      break;
    }
    case 'routes': {
      const { allRoutes } = await import('./routes.js');
      for (const r of allRoutes()) console.log(`${r.endpoint.padEnd(40)} ${r.kind.padEnd(8)} ${r.workflows.join(' > ')}`);
      break;
    }
    default:
      console.log('freegen <start|status|set-backend <url> [token]|set-providers a,b,c|routes>');
  }
}
main().catch(e => { console.error(e.message); process.exit(1); });
