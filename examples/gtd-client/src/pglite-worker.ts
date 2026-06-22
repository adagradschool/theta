import { PGlite } from "@electric-sql/pglite";
import { worker } from "@electric-sql/pglite/worker";

await worker({
	init: async (options) => new PGlite(options),
});
