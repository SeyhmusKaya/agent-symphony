import { createServer, type Server } from "node:http";
import type { AgentRegistry } from "./registry.js";

// F1.3b (Secenek B): runSpecialist subprocess akisi kaldirildi, bu HTTP
// endpoint'in arkasi yok. Disardan POST /agent gelirse 410 Gone donulur;
// signature main.ts startExposeServer cagrisini kirmamak icin korunur.
// Eski davranisa donus icin SDK Agent tool'unu HTTP transport ile sarmak gerek;
// o yapilana kadar endpoint kapali.

export function startExposeServer(
  port: number,
  token: string,
  registry: AgentRegistry,
): Server {
  void token;
  void registry;
  const server = createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/agent") {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(410, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error:
          "Bu endpoint F1.3 (Secenek B) ile devre disi birakildi. Architect chief artik native SDK Agent tool ile uzman spawn ediyor; harici HTTP specialist erisimi kaldirildi.",
      }),
    );
  });
  server.listen(port, "0.0.0.0");
  return server;
}
