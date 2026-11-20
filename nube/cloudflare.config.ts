// Robot de Cuándo viene: lee fechas, arma calendarios y manda avisos.
import { bindings, defineConfig, triggers } from "cf/config";
import * as entrypoint from "./worker.js" with { type: "cf-worker" };

export default defineConfig({
	worker: {
		name: "cuando-viene",
		compatibilityDate: "2026-11-13",
		entrypoint,
		env: {
			DB: bindings.d1({ id: "a2ce3d09-608d-416d-97d5-eb9f03f7fbe5", name: "cuando-viene" }),
		},
		// cada minuto: despacha avisos pendientes; las fuentes se leen en el minuto 0 y 30
		triggers: [triggers.scheduled({ schedule: "* * * * *" })],
	},
});
